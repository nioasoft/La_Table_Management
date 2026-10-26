"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canUnlock, formatSentAt, rowLockView, unlockReasonLabel } from "@/app/(protected)/admin/hashavshevet/page-state";
import { formatShekel, sendsCopy } from "@/lib/hashavshevet/copy";
import { useUnlockRow, type SendDetailDto } from "@/queries/hashavshevet";
import { NoteDialog } from "./note-dialog";
import { EmptyBlock } from "./query-boundary";

type DetailRow = SendDetailDto["rows"][number];

function LockCell({ row, isSuperUser }: { row: DetailRow; isSuperUser: boolean }) {
  const { locked } = rowLockView(row, isSuperUser);
  if (locked) return <Badge variant="info">{sendsCopy.rowLocked}</Badge>;
  const reason = unlockReasonLabel(row.unlockReason);
  return (
    <div className="space-y-1">
      <Badge variant="outline">{sendsCopy.rowReleased}</Badge>
      <p className="max-w-64 text-xs text-muted-foreground">
        {sendsCopy.releasedBy(reason, row.unlockedBy)}
        {row.unlockedAt && ` · ${formatSentAt(row.unlockedAt)}`}
      </p>
    </div>
  );
}

function RowLine({ row, isSuperUser, busy, onUnlock }: { row: DetailRow; isSuperUser: boolean; busy: boolean; onUnlock: (rowId: string) => void }) {
  return (
    <TableRow>
      <TableCell>
        <div className="break-all font-mono text-xs" dir="ltr">
          {row.rowKey}
        </div>
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground">{sendsCopy.payloadToggle}</summary>
          <pre dir="ltr" className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </details>
      </TableCell>
      <TableCell>{formatShekel(row.amount)}</TableCell>
      <TableCell>
        <LockCell row={row} isSuperUser={isSuperUser} />
      </TableCell>
      {isSuperUser && (
        <TableCell>
          {rowLockView(row, isSuperUser).canUnlock && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onUnlock(row.id)}>
              {sendsCopy.unlockRow}
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

interface SendRowsTableProps {
  rows: DetailRow[];
  isSuperUser: boolean;
}

/** Every row the send locked. A super user can open (release) a row that is still locked, with a written reason. */
export function SendRowsTable({ rows, isSuperUser }: SendRowsTableProps) {
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const unlock = useUnlockRow();

  if (rows.length === 0) return <EmptyBlock title={sendsCopy.noRows} />;

  const confirmUnlock = (rowId: string, reason: string) =>
    unlock.mutate(
      { rowId, reason },
      {
        onSuccess: () => toast.success(sendsCopy.unlocked),
        onError: (err) => toast.error(err.message || sendsCopy.unlockFailed),
      },
    );

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{sendsCopy.rowKeyColumn}</TableHead>
            <TableHead>{sendsCopy.amountColumn}</TableHead>
            <TableHead>{sendsCopy.lockColumn}</TableHead>
            {isSuperUser && <TableHead>{sendsCopy.rowActionColumn}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <RowLine key={row.id} row={row} isSuperUser={isSuperUser} busy={unlock.isPending} onUnlock={setUnlockingId} />
          ))}
        </TableBody>
      </Table>
      {unlockingId && (
        <NoteDialog
          title={sendsCopy.unlockTitle}
          description={sendsCopy.unlockDescription}
          label={sendsCopy.unlockReasonLabel}
          placeholder={sendsCopy.unlockReasonPlaceholder}
          confirmLabel={sendsCopy.unlockConfirm}
          cancelLabel={sendsCopy.cancel}
          isValid={canUnlock}
          onConfirm={(reason) => confirmUnlock(unlockingId, reason)}
          onClose={() => setUnlockingId(null)}
        />
      )}
    </>
  );
}
