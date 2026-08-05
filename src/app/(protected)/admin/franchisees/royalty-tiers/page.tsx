"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { useState } from "react";

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
    throw new Error(`אישור הסולם של "${row.name}" נכשל. נסי שוב.`);
  }
}

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
            סולם התמלוגים של <bdi>{row?.name}</bdi>
          </DialogTitle>
          <DialogDescription>
            שינוי הסולם מבטל את האישור עד שתאשרי אותו מחדש.
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
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: loadRows });
  const confirm = useMutation({
    mutationFn: confirmRow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const rows = query.data ?? [];
  const confirmedCount = rows.filter((row) => row.royaltyTiersConfirmed).length;

  return (
    <ReportLayout
      title="אישור סולמות תמלוגים"
      description="עברי על הסולם של כל זכיין ואשרי אותו. עד לאישור, שורות החיוב של אותו זכיין נחסמות בקליטת קובץ טאבית."
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "זכיינים", href: "/admin/franchisees" },
        { label: "אישור סולמות" },
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

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          לא נמצאו זכיינים פעילים לחיוב.
        </div>
      )}

      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>מותג</TableHead>
              <TableHead>זכיין</TableHead>
              <TableHead>סולם תמלוגים</TableHead>
              <TableHead>בסיס</TableHead>
              <TableHead>שיווק</TableHead>
              <TableHead>טיפים בבסיס</TableHead>
              <TableHead>מצב</TableHead>
              <TableHead className="text-start">פעולה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const blocked = blockingReason(row);
              const isPending =
                confirm.isPending && confirm.variables?.id === row.id;
              return (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground">
                    {row.brand?.nameHe ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium">
                    <bdi>{row.name}</bdi>
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
                          אשרי סולם
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(row)}
                      >
                        <Pencil aria-hidden="true" />
                        {blocked ? "הגדירי סולם" : "ערכי"}
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
