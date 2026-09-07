import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ANNUAL_MONTHS } from "@/lib/franchisee-billing-annual-export";
import {
  groupAnnualRows,
  type AnnualBrandSection,
} from "@/lib/franchisee-billing-annual-summary";
import { cn } from "@/lib/utils";
import type {
  FranchiseeBillingAnnualPayload,
  FranchiseeBillingAnnualRow,
} from "@/schemas/franchisee-billing-annual";

interface FranchiseeBillingAnnualTableProps {
  readonly report: FranchiseeBillingAnnualPayload;
}

/** Whole shekels — the grid is read across, not reconciled cell by cell. */
function amount(value: string | null): React.ReactNode {
  if (value === null) return null;
  return (
    <bdi>
      {new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(
        Number(value),
      )}
    </bdi>
  );
}

function percent(value: string | null): React.ReactNode {
  if (value === null) return null;
  return (
    <bdi>
      {Number(value).toLocaleString("he-IL", { maximumFractionDigits: 2 })}%
    </bdi>
  );
}

interface GridRowProps {
  readonly row: FranchiseeBillingAnnualRow;
  readonly brandLabel: string;
  readonly withRate: boolean;
  readonly emphasis?: "brand" | "group";
}

function GridRow({ row, brandLabel, withRate, emphasis }: GridRowProps) {
  const cellClass = cn(
    "whitespace-nowrap text-end tabular-nums",
    emphasis && "font-semibold",
  );
  return (
    <TableRow
      className={cn(
        emphasis === "brand" && "bg-muted/60",
        emphasis === "group" && "bg-muted",
      )}
    >
      <TableCell
        className={cn(
          "sticky start-0 z-10 whitespace-nowrap bg-inherit",
          emphasis && "font-semibold",
        )}
      >
        {brandLabel}
      </TableCell>
      <TableCell
        className={cn(
          "sticky start-[7.5rem] z-10 whitespace-nowrap bg-inherit",
          emphasis && "font-semibold",
        )}
      >
        {row.franchiseeName}
      </TableCell>
      {row.months.map((value, index) => (
        <TableCell key={ANNUAL_MONTHS[index]} className={cellClass}>
          {amount(value)}
        </TableCell>
      ))}
      <TableCell className={cn(cellClass, "font-semibold")}>
        {amount(row.total)}
      </TableCell>
      <TableCell className={cellClass}>{amount(row.average)}</TableCell>
      {withRate && (
        <TableCell className={cellClass}>{percent(row.ratePercent)}</TableCell>
      )}
    </TableRow>
  );
}

function BrandSection({
  brand,
  withRate,
}: {
  readonly brand: AnnualBrandSection;
  readonly withRate: boolean;
}) {
  return (
    <>
      {brand.rows.map((row, index) => (
        <GridRow
          key={row.franchiseeId}
          row={row}
          // The brand reads once per block, like the merged cell in the Excel.
          brandLabel={index === 0 ? brand.brandName : ""}
          withRate={withRate}
        />
      ))}
      <GridRow
        row={brand.subtotal}
        brandLabel=""
        withRate={withRate}
        emphasis="brand"
      />
    </>
  );
}

/**
 * The yearly grid Reut used to keep by hand: branches grouped by brand, twelve
 * month columns, a subtotal per brand and one group total at the bottom.
 */
export function FranchiseeBillingAnnualTable({
  report,
}: FranchiseeBillingAnnualTableProps) {
  const { brands, grandTotal } = groupAnnualRows(report.rows);
  const withRate = report.reportType === "royalties";

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky start-0 z-10 w-[7.5rem] bg-background">
              מותג
            </TableHead>
            <TableHead className="sticky start-[7.5rem] z-10 min-w-56 bg-background">
              סניף
            </TableHead>
            {ANNUAL_MONTHS.map((month) => (
              <TableHead key={month} className="text-end whitespace-nowrap">
                {month}
              </TableHead>
            ))}
            <TableHead className="text-end whitespace-nowrap">
              סה״כ שנתי
            </TableHead>
            <TableHead className="text-end whitespace-nowrap">ממוצע</TableHead>
            {withRate && <TableHead className="text-end">%</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand) => (
            <BrandSection
              key={brand.brandName}
              brand={brand}
              withRate={withRate}
            />
          ))}
        </TableBody>
        <TableFooter>
          <GridRow
            row={grandTotal}
            brandLabel=""
            withRate={withRate}
            emphasis="group"
          />
        </TableFooter>
      </Table>
    </div>
  );
}
