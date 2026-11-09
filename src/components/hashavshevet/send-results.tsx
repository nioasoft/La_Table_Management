import { previewCopy } from "@/lib/hashavshevet/copy";
import type { CompanySendResult } from "@/lib/hashavshevet/send-flow";
import { ToneBadge } from "./preview-groups";
import { describeRow, sendResultMessages, type ClientPreview, type CompanyResultView } from "./preview-state";

function RowErrors({ errors, preview }: { errors: CompanyResultView["rowErrors"]; preview?: ClientPreview }) {
  if (errors.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-destructive">
      {errors.map((e) => (
        <li key={e.rowKey}>
          {describeRow(preview, e.rowKey)}: {e.message}
        </li>
      ))}
    </ul>
  );
}

function CompanyResult({ item, preview }: { item: CompanyResultView; preview?: ClientPreview }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{item.companyName}</h4>
        <ToneBadge label={item.statusLabel} tone={item.tone} />
      </div>
      <p className="mt-1 text-sm">{item.message}</p>
      <RowErrors errors={item.rowErrors} preview={preview} />
    </li>
  );
}

/** What happened per company after the send (sent, failed with row errors, unknown, not reached). */
export function SendResults({ sends, preview }: { sends: CompanySendResult[]; preview?: ClientPreview }) {
  return (
    <section aria-live="polite" className="space-y-2">
      <h3 className="font-semibold">{previewCopy.resultTitle}</h3>
      <ul className="space-y-2">
        {sendResultMessages(sends).map((item, i) => (
          <CompanyResult key={`${item.companyName}:${i}`} item={item} preview={preview} />
        ))}
      </ul>
    </section>
  );
}
