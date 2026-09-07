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

/**
 * The branch column is pinned while the twelve months scroll past it, so its
 * width is fixed rather than content-driven — a sticky offset that disagrees
 * with the real column width paints over the neighbouring cell.
 */
const BRANCH_COLUMN = "w-64 min-w-64 max-w-64";
const MONTH_COLUMN = "w-[6.5rem] min-w-[6.5rem]";
const TOTAL_COLUMN = "w-32 min-w-32";

/** Whole shekels — the grid is read across, not reconciled cell by cell. */
function amount(value: string | null): React.ReactNode {
  if (value === null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <bdi>
      {new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(
        Number(value),
      )}
    </bdi>
  );
}

function percent(value: string | null): React.ReactNode {
  if (value === null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <bdi>
      {Number(value).toLocaleString("he-IL", { maximumFractionDigits: 2 })}%
    </bdi>
  );
}

interface GridRowProps {
  readonly row: FranchiseeBillingAnnualRow;
  readonly label: string;
  readonly withRate: boolean;
  readonly variant?: "brand" | "group";
}

/**
 * The pinned cell scrolls over the month columns, so its background has to be
 * fully opaque — a /50 tint lets the columns underneath show through it. Class
 * names are spelled out because Tailwind only sees literals.
 */
const ROW_SURFACE = {
  branch: { cell: "bg-background", row: "" },
  brand: {
    cell: "bg-muted font-semibold",
    row: "bg-muted hover:bg-muted [&>td]:border-t",
  },
  // muted, secondary and accent are the same grey in this theme, so the group
  // total separates itself by rule and weight rather than a second shade. The
  // border sits on the cells because border-separate ignores row borders.
  group: {
    cell: "bg-muted font-bold",
    row: "bg-muted hover:bg-muted [&>td]:border-t-2 [&>td]:border-t-foreground/40",
  },
} as const;

function GridRow({ row, label, withRate, variant }: GridRowProps) {
  const surface = ROW_SURFACE[variant ?? "branch"];
  const numeric = cn(
    "border-s tabular-nums whitespace-nowrap text-start",
    surface.cell,
  );
  return (
    <TableRow className={surface.row}>
      <TableCell
        className={cn(
          BRANCH_COLUMN,
          "sticky start-0 z-20 truncate",
          surface.cell,
          !variant && "font-medium",
        )}
        title={label}
      >
        {label}
      </TableCell>
      {row.months.map((value, index) => (
        <TableCell key={ANNUAL_MONTHS[index]} className={cn(numeric, MONTH_COLUMN)}>
          {amount(value)}
        </TableCell>
      ))}
      <TableCell className={cn(numeric, TOTAL_COLUMN, "font-semibold")}>
        {amount(row.total)}
      </TableCell>
      <TableCell className={cn(numeric, TOTAL_COLUMN)}>
        {amount(row.average)}
      </TableCell>
      {withRate && (
        <TableCell className={cn(numeric, "w-24 min-w-24")}>
          {percent(row.ratePercent)}
        </TableCell>
      )}
    </TableRow>
  );
}

function BrandSection({
  brand,
  columnCount,
  withRate,
}: {
  readonly brand: AnnualBrandSection;
  readonly columnCount: number;
  readonly withRate: boolean;
}) {
  return (
    <>
      <TableRow className="bg-primary/5 hover:bg-primary/5">
        <TableCell colSpan={columnCount} className="border-t-2 p-0">
          <div className="sticky start-0 w-fit px-4 py-2 text-base font-bold text-primary">
            {brand.brandName}
          </div>
        </TableCell>
      </TableRow>
      {brand.rows.map((row) => (
        <GridRow
          key={row.franchiseeId}
          row={row}
          label={row.franchiseeName}
          withRate={withRate}
        />
      ))}
      <GridRow
        row={brand.subtotal}
        label={`סה״כ ${brand.brandName}`}
        withRate={withRate}
        variant="brand"
      />
    </>
  );
}

/**
 * The yearly grid Reut used to keep by hand: branches under their brand,
 * twelve month columns, a subtotal per brand and one group total at the
 * bottom. The brand reads as a section heading rather than a repeated column,
 * which leaves the width for the months.
 */
export function FranchiseeBillingAnnualTable({
  report,
}: FranchiseeBillingAnnualTableProps) {
  const { brands, grandTotal } = groupAnnualRows(report.rows);
  const withRate = report.reportType === "royalties";
  const columnCount = 1 + ANNUAL_MONTHS.length + 2 + (withRate ? 1 : 0);
  const headCell = "border-s bg-muted text-start font-semibold whitespace-nowrap";

  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <Table className="border-separate border-spacing-0 [&_td]:border-b [&_th]:border-b">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              className={cn(
                BRANCH_COLUMN,
                "sticky start-0 z-30 bg-muted text-start font-semibold",
              )}
            >
              סניף
            </TableHead>
            {ANNUAL_MONTHS.map((month) => (
              <TableHead key={month} className={cn(headCell, MONTH_COLUMN)}>
                {month}
              </TableHead>
            ))}
            <TableHead className={cn(headCell, TOTAL_COLUMN)}>
              סה״כ שנתי
            </TableHead>
            <TableHead className={cn(headCell, TOTAL_COLUMN)}>ממוצע</TableHead>
            {withRate && (
              <TableHead className={cn(headCell, "w-24 min-w-24")}>%</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand) => (
            <BrandSection
              key={brand.brandName}
              brand={brand}
              columnCount={columnCount}
              withRate={withRate}
            />
          ))}
        </TableBody>
        <TableFooter className="bg-transparent">
          <GridRow
            row={grandTotal}
            label="סה״כ קבוצתי"
            withRate={withRate}
            variant="group"
          />
        </TableFooter>
      </Table>
    </div>
  );
}
