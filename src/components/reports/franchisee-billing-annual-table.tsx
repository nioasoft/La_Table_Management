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
 * Sixteen columns have to earn their width. The branch column is pinned while
 * the months scroll past it, so it is sized rather than content-driven — a
 * sticky offset that disagrees with the real width paints over its neighbour.
 */
const BRANCH_COLUMN = "w-44 min-w-44 max-w-44";
const MONTH_COLUMN = "w-[4.75rem] min-w-[4.75rem]";
const TOTAL_COLUMN = "w-24 min-w-24";
const RATE_COLUMN = "w-14 min-w-14";
const CELL_PADDING = "px-2 py-1.5";

/**
 * One band per brand, in the order the query sorts them, so the grid reads
 * like Reut's workbook. Assigned by position rather than by name: a new brand
 * takes the next colour instead of falling through to no colour at all. The
 * bands are opaque because the pinned cell scrolls over the month columns.
 */
const BRAND_TINTS = [
  { band: "bg-blue-100 dark:bg-blue-950", text: "text-blue-900 dark:text-blue-100" },
  { band: "bg-emerald-100 dark:bg-emerald-950", text: "text-emerald-900 dark:text-emerald-100" },
  { band: "bg-sky-100 dark:bg-sky-950", text: "text-sky-900 dark:text-sky-100" },
  { band: "bg-amber-100 dark:bg-amber-950", text: "text-amber-900 dark:text-amber-100" },
  { band: "bg-violet-100 dark:bg-violet-950", text: "text-violet-900 dark:text-violet-100" },
] as const;

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
  /** Opaque band for a totals row; branch rows sit on the plain background. */
  readonly surface?: string;
  readonly rule?: string;
}

function GridRow({ row, label, withRate, surface, rule }: GridRowProps) {
  const cell = cn(CELL_PADDING, surface ?? "bg-background", surface && "font-semibold", rule);
  const numeric = cn(cell, "border-s tabular-nums whitespace-nowrap text-start");
  return (
    // The band lives on the cells so the pinned one matches the rest of the
    // row; the row's own hover tint would only repaint the unpinned part.
    <TableRow className={surface ? "hover:bg-transparent" : undefined}>
      <TableCell
        className={cn(
          cell,
          BRANCH_COLUMN,
          "sticky start-0 z-20 truncate",
          !surface && "font-medium",
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
        <TableCell className={cn(numeric, RATE_COLUMN)}>
          {percent(row.ratePercent)}
        </TableCell>
      )}
    </TableRow>
  );
}

function BrandSection({
  brand,
  index,
  columnCount,
  withRate,
}: {
  readonly brand: AnnualBrandSection;
  readonly index: number;
  readonly columnCount: number;
  readonly withRate: boolean;
}) {
  const tint = BRAND_TINTS[index % BRAND_TINTS.length];
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={columnCount} className={cn(tint.band, "border-t-2 p-0")}>
          <div className={cn("sticky start-0 w-fit px-2 py-1.5 font-bold", tint.text)}>
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
        surface={tint.band}
      />
    </>
  );
}

/**
 * The yearly grid Reut used to keep by hand: branches under their brand band,
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
  const headCell = cn(
    CELL_PADDING,
    "border-s bg-muted text-start font-semibold whitespace-nowrap",
  );

  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <Table className="border-separate border-spacing-0 text-xs [&_td]:border-b [&_th]:border-b">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              className={cn(
                CELL_PADDING,
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
              <TableHead className={cn(headCell, RATE_COLUMN)}>%</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand, index) => (
            <BrandSection
              key={brand.brandName}
              brand={brand}
              index={index}
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
            surface="bg-muted"
            rule="border-t-2 border-t-foreground/40"
          />
        </TableFooter>
      </Table>
    </div>
  );
}
