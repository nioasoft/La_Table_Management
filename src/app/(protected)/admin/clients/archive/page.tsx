"use client";

/**
 * ארכיון מסמכים — every file that reached the system, downloadable.
 *
 * Includes the files we did NOT file (blocked by the overwrite guard, rejected,
 * unparsable). Those never appear anywhere else, which is why "the invoice
 * never arrived" keeps turning out to be "it arrived and we dropped it".
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { AlertCircle, Download, Inbox, Loader2, Search } from "lucide-react";
import { useClients } from "@/queries/clients";
import { useFranchisees } from "@/queries/franchisees";

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

const DOC_TYPE_LABELS: Record<string, string> = {
  client_report: "דוח לקוח",
  tabit_report: "דוח טאביט",
  commission_invoice: "חשבונית עמלה",
  income_invoice: "חשבונית הכנסה",
};

const STATUS_LABELS: Record<string, string> = {
  auto_approved: "נקלט אוטומטית",
  approved: "אושר",
  needs_review: "ממתין לסקירה",
  pending: "ממתין",
  processing: "בעיבוד",
  rejected: "נדחה",
  auto_committed: "נקלט אוטומטית",
  failed: "נחסם / לא נקלט",
};

/**
 * A queue row with no linked document is not automatically a problem: 21 older
 * `auto_committed` rows simply predate the link column. Only failed/rejected/
 * needs_review rows are files we actually refused.
 */
function isUnfiled(row: ArchiveRow): boolean {
  return row.kind === "blocked" && row.status !== "auto_committed";
}

function statusLabel(row: ArchiveRow): string {
  if (row.kind === "blocked" && row.status === "auto_committed") {
    return "נקלט (ללא קישור למסמך)";
  }
  return STATUS_LABELS[row.status] ?? row.status;
}

interface ArchiveRow {
  id: string;
  kind: "saved" | "blocked";
  receivedAt: string;
  clientName: string | null;
  franchiseeName: string | null;
  documentType: string | null;
  periodMonth: number | null;
  periodYear: number | null;
  fileName: string;
  emailSubject: string | null;
  invoiceNumber: string | null;
  totalAmount: string | null;
  status: string;
  statusReason: string | null;
  downloadUrl: string | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatAmount(amount: string | null): string {
  if (!amount) return "—";
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** One line that says what the file is, for someone scanning the list. */
function describe(row: ArchiveRow): string {
  const parts = [
    row.documentType ? (DOC_TYPE_LABELS[row.documentType] ?? row.documentType) : null,
    row.periodMonth && row.periodYear
      ? `${MONTHS[row.periodMonth - 1]} ${row.periodYear}`
      : null,
    row.invoiceNumber ? `חשבונית ${row.invoiceNumber}` : null,
    row.totalAmount ? formatAmount(row.totalAmount) : null,
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

export default function DocumentArchivePage() {
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("all");
  const [franchiseeId, setFranchiseeId] = useState("all");
  const [kind, setKind] = useState("all");
  const [periodMonth, setPeriodMonth] = useState("all");
  const [periodYear, setPeriodYear] = useState("all");

  const { data: clients } = useClients();
  const { data: franchisees } = useFranchisees();

  const params = useMemo(() => {
    const p = new URLSearchParams({ months: "24", limit: "500" });
    if (clientId !== "all") p.set("clientId", clientId);
    if (franchiseeId !== "all") p.set("franchiseeId", franchiseeId);
    if (kind !== "all") p.set("kind", kind);
    if (periodMonth !== "all") p.set("periodMonth", periodMonth);
    if (periodYear !== "all") p.set("periodYear", periodYear);
    return p.toString();
  }, [clientId, franchiseeId, kind, periodMonth, periodYear]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["document-archive", params],
    queryFn: async (): Promise<ArchiveRow[]> => {
      const res = await fetch(`/api/clients/document-archive?${params}`);
      if (!res.ok) throw new Error("שגיאה בטעינת ארכיון המסמכים");
      const json = await res.json();
      return json.rows as ArchiveRow[];
    },
  });

  // Free text is filtered client-side so typing does not re-hit the server on
  // every keystroke; the server filters are the ones that bound the result set.
  const rows = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      [row.fileName, row.emailSubject, row.franchiseeName, row.clientName, row.invoiceNumber]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term)),
    );
  }, [data, search]);

  const unfiledCount = rows.filter(isUnfiled).length;

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">ארכיון מסמכים</h1>
        <p className="text-sm text-muted-foreground">
          כל המסמכים שהתקבלו במייל או הועלו — כולל אלה שנחסמו ולא נקלטו למערכת. לחיצה על שם
          הקובץ מורידה אותו.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">חיפוש</Label>
            <div className="relative">
              <Search className="absolute end-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="שם קובץ, נושא מייל, זכיין, מספר חשבונית"
                className="pe-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">לקוח</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הלקוחות</SelectItem>
                {(clients ?? []).map((c: { id: string; name: string }) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">זכיין</Label>
            <Select value={franchiseeId} onValueChange={setFranchiseeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הזכיינים</SelectItem>
                {(franchisees ?? []).map((f: { id: string; name: string }) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">תקופה</Label>
            <div className="flex gap-2">
              <Select value={periodMonth} onValueChange={setPeriodMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל החודשים</SelectItem>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={periodYear} onValueChange={setPeriodYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">סוג רשומה</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="saved">נקלטו למערכת</SelectItem>
                <SelectItem value="blocked">נחסמו / לא נקלטו</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Inbox className="h-5 w-5" />
            מסמכים
            <Badge variant="secondary" className="tabular-nums">{rows.length}</Badge>
            {unfiledCount > 0 && (
              <Badge variant="destructive" className="tabular-nums">
                {unfiledCount} לא נקלטו
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> טוען מסמכים…
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center gap-2 py-12 text-destructive">
              <AlertCircle className="h-4 w-4" /> שגיאה בטעינת המסמכים. נסי לרענן את הדף.
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              לא נמצאו מסמכים לפי הסינון הנוכחי.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-right pe-4">קובץ</TableHead>
                    <TableHead className="text-right">תיאור</TableHead>
                    <TableHead className="text-right">לקוח</TableHead>
                    <TableHead className="text-right">זכיין</TableHead>
                    <TableHead className="text-right">התקבל</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className={isUnfiled(row) ? "bg-destructive/5" : undefined}>
                      <TableCell className="pe-4">
                        {row.downloadUrl ? (
                          <a
                            href={row.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors"
                            title={`הורדה: ${row.fileName}`}
                          >
                            <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="max-w-[280px] truncate">{row.fileName}</span>
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">{row.fileName}</span>
                        )}
                        {row.emailSubject && (
                          <div className="max-w-[280px] truncate text-xs text-muted-foreground">
                            {row.emailSubject}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{describe(row)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.clientName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.franchiseeName ?? "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatDate(row.receivedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isUnfiled(row) ? "destructive" : "outline"} className="text-xs">
                          {statusLabel(row)}
                        </Badge>
                        {row.statusReason && (
                          <div className="mt-1 max-w-[320px] text-xs text-muted-foreground" title={row.statusReason}>
                            {row.statusReason.length > 90
                              ? `${row.statusReason.slice(0, 90)}…`
                              : row.statusReason}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
