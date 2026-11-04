import { periodLabel, formatSentAt } from "@/app/(protected)/admin/hashavshevet/page-state";
import { exportLabels, formatShekel, sendsCopy } from "@/lib/hashavshevet/copy";
import type { SendDto } from "@/queries/hashavshevet";

type Facts = Pick<SendDto, "companyName" | "exportType" | "params" | "rowCount" | "total" | "sentAt" | "sentBy">;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** What Reut compares to the temporary batch in Hashavshevet: company, export, period, row count and total. */
export function SendFacts({ send }: { send: Facts }) {
  return (
    <div className="space-y-1">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-5">
        <Fact label={sendsCopy.companyColumn} value={send.companyName} />
        <Fact label={sendsCopy.exportColumn} value={exportLabels[send.exportType]} />
        <Fact label={sendsCopy.periodColumn} value={periodLabel(send.exportType, send.params)} />
        <Fact label={sendsCopy.rowsColumn} value={sendsCopy.rowsCount(send.rowCount)} />
        <Fact label={sendsCopy.totalColumn} value={formatShekel(send.total)} />
      </dl>
      <p className="text-xs text-muted-foreground">{sendsCopy.sentBy(formatSentAt(send.sentAt), send.sentBy)}</p>
    </div>
  );
}
