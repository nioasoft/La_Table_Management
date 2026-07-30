import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CollectionReportRow,
  DiscountReportRow,
  FranchiseeBillingReportPayload,
  FranchiseeBillingReportType,
  RoyaltyReportRow,
  TurnoverReportRow,
} from "@/schemas/franchisee-billing-reports";

interface FranchiseeBillingReportTableProps {
  readonly report: FranchiseeBillingReportPayload;
}

function amount(value: string): React.ReactNode {
  const formatted = new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(Number(value));
  return <bdi>{formatted} ₪</bdi>;
}

function rate(value: string): React.ReactNode {
  return (
    <bdi>
      {Number(value).toLocaleString("he-IL", { maximumFractionDigits: 2 })}%
    </bdi>
  );
}

function StatusBadge({ status }: { readonly status: "draft" | "approved" }) {
  return (
    <Badge variant={status === "approved" ? "success" : "outline"}>
      {status === "approved" ? "מאושר" : "טיוטה"}
    </Badge>
  );
}

function ReportHeaders({ reportType }: {
  readonly reportType: FranchiseeBillingReportType;
}) {
  return (
    <TableRow>
      <TableHead>זכיין</TableHead>
      <TableHead>מותג</TableHead>
      {reportType === "royalties" && (
        <>
          <TableHead>תמלוגים</TableHead>
          <TableHead>תעריף הסכם</TableHead>
          <TableHead>תעריף בפועל</TableHead>
          <TableHead>ערך הנחה</TableHead>
          <TableHead>סטטוס</TableHead>
        </>
      )}
      {reportType === "turnover" && (
        <>
          <TableHead>כולל מע״מ</TableHead>
          <TableHead>לפני מע״מ</TableHead>
          <TableHead>סטטוס</TableHead>
        </>
      )}
      {reportType === "collection" && (
        <>
          <TableHead>תמלוגים שנגבו</TableHead>
          <TableHead>שיווק שנגבה</TableHead>
        </>
      )}
      {reportType === "discounts" && <TableHead>ערך הנחות מצטבר</TableHead>}
    </TableRow>
  );
}

function RoyaltyRow({ row }: { readonly row: RoyaltyReportRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.franchiseeName}</TableCell>
      <TableCell>{row.brandName}</TableCell>
      <TableCell>{amount(row.royalty)}</TableCell>
      <TableCell>{rate(row.tierRate)}</TableCell>
      <TableCell>{rate(row.effectiveRate)}</TableCell>
      <TableCell>{amount(row.discountValue)}</TableCell>
      <TableCell><StatusBadge status={row.status} /></TableCell>
    </TableRow>
  );
}

function TurnoverRow({ row }: { readonly row: TurnoverReportRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.franchiseeName}</TableCell>
      <TableCell>{row.brandName}</TableCell>
      <TableCell>{amount(row.grossBase)}</TableCell>
      <TableCell>{amount(row.netBase)}</TableCell>
      <TableCell><StatusBadge status={row.status} /></TableCell>
    </TableRow>
  );
}

function CollectionRow({ row }: { readonly row: CollectionReportRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.franchiseeName}</TableCell>
      <TableCell>{row.brandName}</TableCell>
      <TableCell>{amount(row.royaltyCollected)}</TableCell>
      <TableCell>{amount(row.marketingCollected)}</TableCell>
    </TableRow>
  );
}

function DiscountRow({ row }: { readonly row: DiscountReportRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.franchiseeName}</TableCell>
      <TableCell>{row.brandName}</TableCell>
      <TableCell>{amount(row.discountValue)}</TableCell>
    </TableRow>
  );
}

function ReportRows({ report }: FranchiseeBillingReportTableProps) {
  if (report.reportType === "royalties") {
    return report.rows.map((row) => (
      <RoyaltyRow key={row.franchiseeId} row={row} />
    ));
  }
  if (report.reportType === "turnover") {
    return report.rows.map((row) => (
      <TurnoverRow key={row.franchiseeId} row={row} />
    ));
  }
  if (report.reportType === "collection") {
    return report.rows.map((row) => (
      <CollectionRow key={row.franchiseeId} row={row} />
    ));
  }
  return report.rows.map((row) => (
    <DiscountRow key={row.franchiseeId} row={row} />
  ));
}

export function FranchiseeBillingReportTable({
  report,
}: FranchiseeBillingReportTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <ReportHeaders reportType={report.reportType} />
        </TableHeader>
        <TableBody>
          <ReportRows report={report} />
        </TableBody>
      </Table>
    </div>
  );
}
