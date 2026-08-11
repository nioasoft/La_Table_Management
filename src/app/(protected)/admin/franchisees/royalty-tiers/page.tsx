"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AlertCircle, Check, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { FranchiseeRoyaltyTierEditor } from "@/components/franchisee-royalty-tier-editor";
import { ReportLayout } from "@/components/reports/report-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  blockingReason,
  describeRoyaltyTiers,
  royaltyBoardResponseSchema,
  type RoyaltyBoardRow,
} from "@/schemas/franchisee-royalty-board";
import { serializeFranchiseeRoyaltyPatch } from "@/schemas/franchisee-royalty";

const QUERY_KEY = ["franchisee-royalty-board"] as const;

async function loadRows(): Promise<readonly RoyaltyBoardRow[]> {
  const response = await fetchWithTimeout(
    "/api/franchisees?filter=active&category=regular",
    { timeout: 30_000 },
  );
  if (!response.ok) {
    throw new Error("טעינת הזכיינים נכשלה. נסי שוב.");
  }
  const parsed = royaltyBoardResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    console.error("Invalid franchisee royalty board response:", {
      issues: parsed.error.issues,
    });
    throw new Error("תשובת השרת אינה תקינה. רענני את העמוד.");
  }
  return [...parsed.data.franchisees].sort((first, second) =>
    (first.brand?.nameHe ?? "").localeCompare(second.brand?.nameHe ?? "", "he") ||
    first.name.localeCompare(second.name, "he"),
  );
}

/**
 * Confirms one scale through the existing franchisee PATCH, which takes the
 * complete royalty settings — the row's own values are echoed back untouched.
 */
async function confirmRow(row: RoyaltyBoardRow): Promise<void> {
  const response = await fetchWithTimeout(`/api/franchisees/${row.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
    body: serializeFranchiseeRoyaltyPatch({
      royaltyTiers: row.royaltyTiers ?? [],
      royaltyTierBasis: row.royaltyTierBasis ?? "gross",
      royaltyTiersConfirmed: true,
      royaltyIncludeTips: row.royaltyIncludeTips,
      hashavshevetAccountKey: row.hashavshevetAccountKey ?? null,
      marketingFeeRate: Number(row.marketingFeeRate ?? 0),
    }),
  });
  if (!response.ok) {
    throw new Error(`אישור המדרגות של "${row.name}" נכשל. נסי שוב.`);
  }
}

const ALL_BRANDS = "__all__";

function StatusCell({ row }: { readonly row: RoyaltyBoardRow }) {
  const blocked = blockingReason(row);
  if (row.royaltyTiersConfirmed) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Check className="h-3 w-3" aria-hidden="true" />
        מאושר
      </Badge>
    );
  }
  return blocked ? (
    <span className="text-sm text-destructive">{blocked}</span>
  ) : (
    <span className="text-sm text-muted-foreground">ממתין לאישור</span>
  );
}

/** The per-franchisee editor, reached without leaving the board. */
function RoyaltyEditorDialog({
  row,
  onClose,
  onSaved,
}: {
  readonly row: RoyaltyBoardRow | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir="rtl"
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>
            מדרגות התמלוגים של <bdi>{row?.name}</bdi>
          </DialogTitle>
          <DialogDescription>
            שמירה כאן גם מאשרת את המדרגות.
          </DialogDescription>
        </DialogHeader>
        {row && (
          <FranchiseeRoyaltyTierEditor
            key={row.id}
            franchiseeId={row.id}
            initialSettings={{
              royaltyTiers: row.royaltyTiers,
              royaltyTierBasis: row.royaltyTierBasis ?? "gross",
              royaltyTiersConfirmed: row.royaltyTiersConfirmed,
              royaltyIncludeTips: row.royaltyIncludeTips,
              hashavshevetAccountKey: row.hashavshevetAccountKey ?? null,
              marketingFeeRate: row.marketingFeeRate,
            }}
            normalizationNotes={row.royaltyTiersNote ?? null}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function FranchiseeRoyaltyTiersPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoyaltyBoardRow | null>(null);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState(ALL_BRANDS);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: loadRows });
  const confirm = useMutation({
    mutationFn: confirmRow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const confirmedCount = rows.filter((row) => row.royaltyTiersConfirmed).length;
  const brands = useMemo(
    () =>
      [...new Set(rows.map((row) => row.brand?.nameHe).filter(Boolean))].sort(
        (first, second) => first!.localeCompare(second!, "he"),
      ) as string[],
    [rows],
  );
  // Filtering client-side over the rows already loaded — the board holds ~20.
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (brand === ALL_BRANDS || row.brand?.nameHe === brand) &&
        (term === "" || row.name.toLowerCase().includes(term)),
    );
  }, [rows, search, brand]);

  return (
    <ReportLayout
      title="אישור מדרגות תמלוגים"
      description="עברי על המדרגות של כל זכיין ואשרי אותן. עד לאישור, שורות החיוב של אותו זכיין נחסמות בקליטת קובץ טאבית."
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "זכיינים", href: "/admin/franchisees" },
        { label: "אישור מדרגות" },
      ]}
      isLoading={query.isFetching}
      onRefresh={() => void query.refetch()}
      actions={
        rows.length > 0 ? (
          <Badge variant={confirmedCount === rows.length ? "secondary" : "outline"}>
            <ShieldCheck className="me-1 h-3 w-3" aria-hidden="true" />
            {confirmedCount} מתוך {rows.length} אושרו
          </Badge>
        ) : null
      }
    >
      {confirm.isError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>האישור נכשל</AlertTitle>
          <AlertDescription>
            {confirm.error instanceof Error
              ? confirm.error.message
              : "אירעה שגיאה לא צפויה."}
          </AlertDescription>
        </Alert>
      )}

      {query.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>טעינת הנתונים נכשלה</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error
              ? query.error.message
              : "אירעה שגיאה לא צפויה."}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              נסי שוב
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="royalty-board-search">חיפוש זכיין</Label>
            <Input
              id="royalty-board-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="שם הזכיין"
              dir="auto"
            />
          </div>
          <div className="min-w-48 space-y-2">
            <Label htmlFor="royalty-board-brand">מותג</Label>
            <Select dir="rtl" value={brand} onValueChange={setBrand}>
              <SelectTrigger id="royalty-board-brand" dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value={ALL_BRANDS}>כל המותגים</SelectItem>
                {brands.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {!query.isLoading && !query.isError && visibleRows.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "לא נמצאו זכיינים פעילים לחיוב."
            : "אין זכיינים שמתאימים לחיפוש."}
        </div>
      )}

      {visibleRows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>מותג</TableHead>
              <TableHead>זכיין</TableHead>
              <TableHead>מדרגות תמלוגים</TableHead>
              <TableHead>בסיס</TableHead>
              <TableHead>שיווק</TableHead>
              <TableHead>טיפים בבסיס</TableHead>
              <TableHead>מצב</TableHead>
              <TableHead className="text-start">פעולה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => {
              const blocked = blockingReason(row);
              const isPending =
                confirm.isPending && confirm.variables?.id === row.id;
              return (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground">
                    {row.brand?.nameHe ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/franchisees/${row.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      <bdi>{row.name}</bdi>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {describeRoyaltyTiers(row) ?? (
                      <span className="text-destructive">חסר</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.royaltyTierBasis === "net" ? "נטו" : "ברוטו"}
                  </TableCell>
                  <TableCell>
                    {row.marketingFeeRate === null
                      ? "—"
                      : `${Number(row.marketingFeeRate)}%`}
                  </TableCell>
                  <TableCell>{row.royaltyIncludeTips ? "כן" : "לא"}</TableCell>
                  <TableCell>
                    <StatusCell row={row} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {!row.royaltyTiersConfirmed && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(blocked) || confirm.isPending}
                          onClick={() => confirm.mutate(row)}
                        >
                          {isPending ? (
                            <Loader2
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <ShieldCheck aria-hidden="true" />
                          )}
                          אשרי מדרגות
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(row)}
                      >
                        <Pencil aria-hidden="true" />
                        {blocked ? "הגדירי מדרגות" : "ערכי"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <RoyaltyEditorDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        }}
      />
    </ReportLayout>
  );
}
