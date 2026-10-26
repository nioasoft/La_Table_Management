"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { canReject, resolveActionsFor, statusBadgeVariant, type ResolveOutcome } from "@/app/(protected)/admin/hashavshevet/page-state";
import { sendsCopy, sendStatusLabels } from "@/lib/hashavshevet/copy";
import { useResolveSend, type SendDto } from "@/queries/hashavshevet";
import { NoteDialog } from "./note-dialog";
import { EmptyBlock } from "./query-boundary";
import { SendFacts } from "./send-facts";

function Notice({ text }: { text: string }) {
  return (
    <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      {text}
    </p>
  );
}

function QueueActions({ send, onOpen }: { send: SendDto; onOpen: (id: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const resolve = useResolveSend();

  const run = (outcome: ResolveOutcome, note?: string) =>
    resolve.mutate(
      { sendId: send.id, outcome, note },
      {
        onSuccess: () => toast.success(sendsCopy.resolved),
        onError: (err) => toast.error(err.message || sendsCopy.resolveFailed),
      },
    );

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {resolveActionsFor(send).map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.needsNote ? "outline" : "default"}
            disabled={resolve.isPending}
            onClick={() => (action.needsNote ? setRejecting(true) : run(action.outcome))}
          >
            {action.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onOpen(send.id)}>
          {sendsCopy.details}
        </Button>
      </div>
      {rejecting && (
        <NoteDialog
          title={sendsCopy.rejectTitle}
          description={sendsCopy.rejectDescription}
          label={sendsCopy.noteLabel}
          placeholder={sendsCopy.notePlaceholder}
          confirmLabel={sendsCopy.rejectConfirm}
          cancelLabel={sendsCopy.cancel}
          isValid={canReject}
          onConfirm={(note) => run("rejected", note)}
          onClose={() => setRejecting(false)}
        />
      )}
    </>
  );
}

function QueueItem({ send, onOpen }: { send: SendDto; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SendFacts send={send} />
          <Badge variant={statusBadgeVariant(send.status)}>{sendStatusLabels[send.status]}</Badge>
        </div>
        {send.status === "unknown" && <Notice text={sendsCopy.unknownNote} />}
        {send.stalePending && <Notice text={sendsCopy.staleWarning} />}
        <QueueActions send={send} onOpen={onOpen} />
      </CardContent>
    </Card>
  );
}

interface SendsQueueProps {
  sends: SendDto[];
  onOpen: (id: string) => void;
}

/** Spec §9: what waits for Reut, with the numbers she compares to the temporary batch and the buttons to settle it. */
export function SendsQueue({ sends, onOpen }: SendsQueueProps) {
  return (
    <section className="space-y-3" aria-labelledby="hashavshevet-queue-title">
      <div>
        <h2 id="hashavshevet-queue-title" className="text-lg font-semibold">
          {sendsCopy.queueTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{sendsCopy.queueHint}</p>
      </div>
      {sends.length === 0 ? (
        <EmptyBlock title={sendsCopy.queueEmpty} />
      ) : (
        sends.map((send) => <QueueItem key={send.id} send={send} onOpen={onOpen} />)
      )}
    </section>
  );
}
