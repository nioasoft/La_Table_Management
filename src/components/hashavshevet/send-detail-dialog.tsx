"use client";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { statusBadgeVariant } from "@/app/(protected)/admin/hashavshevet/page-state";
import { sendsCopy, sendStatusLabels } from "@/lib/hashavshevet/copy";
import { useSendDetail, type SendDetailDto } from "@/queries/hashavshevet";
import { QueryBoundary } from "./query-boundary";
import { SendFacts } from "./send-facts";
import { SendRowsTable } from "./send-rows-table";

function DetailBody({ send, isSuperUser }: { send: SendDetailDto; isSuperUser: boolean }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SendFacts send={send} />
        <Badge variant={statusBadgeVariant(send.status)}>{sendStatusLabels[send.status]}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {sendsCopy.fileLabel}: <span className="font-mono" dir="ltr">{send.targetFileName}</span>
      </p>
      {send.resolutionNote && (
        <p className="text-sm">
          <span className="text-muted-foreground">{sendsCopy.resolutionNote}: </span>
          {send.resolutionNote}
        </p>
      )}
      <section className="space-y-2">
        <h3 className="font-medium">{sendsCopy.rowsTitle}</h3>
        <SendRowsTable rows={send.rows} isSuperUser={isSuperUser} sendStatus={send.status} />
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">{sendsCopy.responseTitle}</h3>
        {send.response == null ? (
          <p className="text-sm text-muted-foreground">{sendsCopy.noResponse}</p>
        ) : (
          <pre dir="ltr" className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(send.response, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}

interface SendDetailDialogProps {
  sendId: string;
  isSuperUser: boolean;
  onClose: () => void;
}

/** Spec §9: one send in full: the numbers, every locked row (with release) and the raw H-Connect answer. Mount only while open. */
export function SendDetailDialog({ sendId, isSuperUser, onClose }: SendDetailDialogProps) {
  const detail = useSendDetail(sendId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sendsCopy.detailTitle}</DialogTitle>
          <DialogDescription>{sendsCopy.detailDescription}</DialogDescription>
        </DialogHeader>
        <QueryBoundary
          isPending={detail.isPending}
          isError={detail.isError}
          isEmpty={false}
          onRetry={() => detail.refetch()}
          loadingLabel={sendsCopy.detailLoading}
          errorMessage={sendsCopy.detailLoadFailed}
          retryLabel={sendsCopy.retry}
          empty={null}
        >
          {detail.data && <DetailBody send={detail.data} isSuperUser={isSuperUser} />}
        </QueryBoundary>
      </DialogContent>
    </Dialog>
  );
}
