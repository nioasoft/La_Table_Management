import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { previewCopy } from "@/lib/hashavshevet/copy";

export function LoadingState() {
  return (
    <div role="status" className="space-y-3 py-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" aria-hidden="true" />
        {previewCopy.loading}
      </p>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <p className="font-medium">{previewCopy.empty}</p>
      <p className="mt-1 text-sm text-muted-foreground">{previewCopy.emptyHint}</p>
    </div>
  );
}

/** A stale-or-failed answer with a way forward: `onRefresh` re-runs the preview. */
export function ErrorNotice({ message, onRefresh, actionLabel }: { message: string; onRefresh?: () => void; actionLabel?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="text-destructive">{message}</p>
      {onRefresh && (
        <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          {actionLabel ?? previewCopy.refresh}
        </Button>
      )}
    </div>
  );
}

export function BlockingNotice({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="font-medium text-destructive">{previewCopy.blockingTitle}</p>
      <ul className="mt-1 list-disc space-y-1 ps-5 text-destructive">
        {messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/** Non-blocking: rows that won't be sent because the franchisee has no company. */
export function SkippedNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300">
      {message}
    </p>
  );
}
