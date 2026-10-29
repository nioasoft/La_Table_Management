import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatShekel, previewCopy } from "@/lib/hashavshevet/copy";
import { cn } from "@/lib/utils";
import {
  displayCell,
  displayColumns,
  statusBadge,
  statusDetail,
  type ClientGroup,
  type ClientRow,
  type Tone,
} from "./preview-state";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  muted: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  warning: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  dark: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900",
  danger: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};

export function ToneBadge({ label, tone }: { label: string; tone: Tone }) {
  return <Badge className={cn("border-transparent whitespace-nowrap", TONE_CLASS[tone])}>{label}</Badge>;
}

function StatusCell({ row, group }: { row: ClientRow; group: ClientGroup }) {
  const detail = statusDetail(row, group);
  return (
    <TableCell className="min-w-40 align-top">
      <ToneBadge {...statusBadge(row.status)} />
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </TableCell>
  );
}

function RowLine({ row, group, columns }: { row: ClientRow; group: ClientGroup; columns: string[] }) {
  return (
    <TableRow>
      <StatusCell row={row} group={group} />
      <TableCell className="align-top tabular-nums whitespace-nowrap">{formatShekel(row.amount)}</TableCell>
      {columns.map((c) => (
        <TableCell key={c} className="align-top whitespace-nowrap">
          {displayCell(row.display[c])}
        </TableCell>
      ))}
    </TableRow>
  );
}

function RowsTable({ group }: { group: ClientGroup }) {
  const columns = displayColumns(group.rows);
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead>{previewCopy.statusColumn}</TableHead>
          <TableHead>{previewCopy.amountColumn}</TableHead>
          {columns.map((c) => (
            <TableHead key={c}>{c}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {group.rows.map((row) => (
          <RowLine key={row.rowKey} row={row} group={group} columns={columns} />
        ))}
      </TableBody>
    </Table>
  );
}

/** One target company: its name, the approval reminder, the new-rows total and its rows. */
export function GroupSection({ group }: { group: ClientGroup }) {
  const newCount = group.rows.filter((r) => r.status === "new").length;
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{group.companyName ?? previewCopy.noCompanyGroup}</h3>
        <span className="text-sm text-muted-foreground">{previewCopy.groupSummary(newCount, group.totalNew)}</span>
      </header>
      {group.requiresApproval && <p className="text-sm text-amber-700 dark:text-amber-400">{previewCopy.requiresApprovalNote}</p>}
      <RowsTable group={group} />
    </section>
  );
}
