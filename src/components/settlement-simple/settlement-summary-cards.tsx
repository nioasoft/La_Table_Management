"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building2,
  Store,
  ArrowRightLeft,
  Percent,
} from "lucide-react";
import { formatCurrency } from "@/lib/translations";
import type { SettlementSummary } from "@/data-access/settlement-simple";

interface SettlementSummaryCardsProps {
  summary: SettlementSummary;
}

export function SettlementSummaryCards({ summary }: SettlementSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Supplier Amount */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">סה״כ ספקים</CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(summary.totalSupplierAmount)}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.totalCount} רשומות
          </p>
        </CardContent>
      </Card>

      {/* Total Franchisee Amount */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">סה״כ זכיינים</CardTitle>
          <Store className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(summary.totalFranchiseeAmount)}
          </div>
          <p className="text-xs text-muted-foreground">
            מקבצי BKMVDATA
          </p>
        </CardContent>
      </Card>

      {/* Total Difference */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">הפרש כולל</CardTitle>
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(summary.totalDifference)}
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="text-green-600">{summary.matchedCount} התאמות</span>
            {" | "}
            <span className="text-orange-600">{summary.unmatchedCount} פערים</span>
          </p>
        </CardContent>
      </Card>

      {/* Total Commission */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">עמלה לתשלום</CardTitle>
          <Percent className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(summary.totalCommissionAmount)}
          </div>
          <p className="text-xs text-muted-foreground">
            סה״כ עמלות מחושבות
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
