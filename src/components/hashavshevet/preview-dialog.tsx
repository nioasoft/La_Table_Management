"use client";

import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { previewCopy } from "@/lib/hashavshevet/copy";
import type { ExportType } from "@/lib/hashavshevet/types";
import { BlockingNotice, EmptyState, ErrorNotice, LoadingState } from "./preview-notices";
import { GroupSection } from "./preview-groups";
import {
  blockingMessages,
  canSend,
  groupTotals,
  resolveView,
  sendOutcome,
  type ClientPreview,
  type DialogView,
} from "./preview-state";
import { SendResults } from "./send-results";
import type { SendFlow } from "./use-send-flow";

function ReadyBody({ data }: { data: ClientPreview }) {
  const { newCount, newTotal } = groupTotals(data);
  return (
    <div className="space-y-3">
      <BlockingNotice messages={blockingMessages(data)} />
      {data.groups.map((g) => (
        <GroupSection key={g.companyId ?? "none"} group={g} />
      ))}
      <p className="text-sm font-medium">{previewCopy.grandTotal(newCount, newTotal)}</p>
    </div>
  );
}

interface BodyProps {
  view: DialogView;
  flow: SendFlow;
  sends: ReturnType<typeof sendOutcome>["sends"];
}

function DialogBody({ view, flow, sends }: BodyProps) {
  const data = flow.preview.data;
  switch (view) {
    case "loading":
      return <LoadingState />;
    case "error":
      return (
        <ErrorNotice
          message={flow.preview.error?.message ?? previewCopy.loadFailed}
          onRefresh={flow.refresh}
          actionLabel={previewCopy.retry}
        />
      );
    case "empty":
      return <EmptyState />;
    case "result":
      return <SendResults sends={sends} preview={data} />;
    case "ready":
      return data ? <ReadyBody data={data} /> : null;
  }
}

function DialogActions({ view, flow, onClose }: { view: DialogView; flow: SendFlow; onClose: () => void }) {
  const data = flow.preview.data;
  const can = data ? canSend(data) : { ok: false, reason: null };
  const sending = flow.send.isPending;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{view === "ready" && !can.ok ? can.reason : null}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={sending}>
          {previewCopy.close}
        </Button>
        {view === "ready" && (
          <Button type="button" onClick={flow.sendNow} disabled={!can.ok || sending}>
            {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {sending ? previewCopy.sending : previewCopy.send}
          </Button>
        )}
      </div>
    </div>
  );
}

interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exportType: ExportType;
  flow: SendFlow;
}

/** Spec §9: company, rows with colored status, blocking errors, totals, and a "send" that only enables when it can work. */
export function PreviewDialog({ open, onOpenChange, exportType, flow }: PreviewDialogProps) {
  const { preview, send } = flow;
  const outcome = sendOutcome(send.data, send.error);
  const view = resolveView({
    previewPending: preview.isPending,
    previewFailed: preview.isError,
    data: preview.data,
    hasSends: outcome.sends.length > 0,
  });
  // A send in flight must not be abandoned by closing: its outcome is what Reut needs to see.
  const handleOpenChange = (next: boolean) => {
    if (!send.isPending) onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir="rtl" className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{previewCopy.dialogTitle(exportType)}</DialogTitle>
          <DialogDescription>{previewCopy.dialogDescription}</DialogDescription>
        </DialogHeader>
        {outcome.errorMessage && (
          <ErrorNotice message={outcome.errorMessage} onRefresh={outcome.canRefresh ? flow.refresh : undefined} />
        )}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          <DialogBody view={view} flow={flow} sends={outcome.sends} />
        </div>
        <DialogActions view={view} flow={flow} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
