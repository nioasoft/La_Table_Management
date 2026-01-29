"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, X, AlertTriangle, Edit2, Search } from "lucide-react";
import { formatCurrency } from "@/lib/translations";
import type { SettlementLineItem } from "@/data-access/settlement-simple";

interface SettlementTableProps {
  items: SettlementLineItem[];
  onAdjust: (item: SettlementLineItem) => void;
}

export function SettlementTable({ items, onAdjust }: SettlementTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "matched" | "unmatched">("all");

  // Filter items based on search and status
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        item.supplierName.toLowerCase().includes(searchLower) ||
        item.franchiseeName.toLowerCase().includes(searchLower) ||
        item.brandNameHe.toLowerCase().includes(searchLower);

      // Status filter
      const matchesStatus =
        filterStatus === "all" ||
        (filterStatus === "matched" && item.isMatched) ||
        (filterStatus === "unmatched" && !item.isMatched);

      return matchesSearch && matchesStatus;
    });
  }, [items, searchQuery, filterStatus]);

  // Format percentage
  const formatPercent = (rate: number | null): string => {
    if (rate === null) return "-";
    return `${rate.toFixed(1)}%`;
  };

  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש לפי ספק, זכיין או מותג..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-10"
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant={filterStatus === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("all")}
          >
            הכל ({items.length})
          </Button>
          <Button
            variant={filterStatus === "matched" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("matched")}
            className={filterStatus === "matched" ? "bg-green-600 hover:bg-green-700" : ""}
          >
            התאמות ({items.filter((i) => i.isMatched).length})
          </Button>
          <Button
            variant={filterStatus === "unmatched" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus("unmatched")}
            className={filterStatus === "unmatched" ? "bg-orange-600 hover:bg-orange-700" : ""}
          >
            פערים ({items.filter((i) => !i.isMatched).length})
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-end w-[180px]">ספק</TableHead>
              <TableHead className="text-end w-[180px]">זכיין</TableHead>
              <TableHead className="text-end w-[100px]">מותג</TableHead>
              <TableHead className="text-end w-[120px]">סכום ספק</TableHead>
              <TableHead className="text-end w-[120px]">סכום זכיין</TableHead>
              <TableHead className="text-end w-[100px]">הפרש</TableHead>
              <TableHead className="text-end w-[80px]">% עמלה</TableHead>
              <TableHead className="text-end w-[100px]">עמלה</TableHead>
              <TableHead className="text-center w-[80px]">סטטוס</TableHead>
              <TableHead className="text-center w-[80px]">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  {searchQuery || filterStatus !== "all"
                    ? "אין תוצאות התואמות לחיפוש"
                    : "אין נתונים להצגה"}
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => (
                <TableRow
                  key={item.commissionId}
                  className={!item.isMatched ? "bg-orange-50/50" : undefined}
                >
                  <TableCell className="text-end font-medium">
                    {item.supplierName}
                  </TableCell>
                  <TableCell className="text-end">{item.franchiseeName}</TableCell>
                  <TableCell className="text-end text-sm text-muted-foreground">
                    {item.brandNameHe}
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {formatCurrency(item.supplierAmount)}
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {item.franchiseeAmount !== null ? (
                      formatCurrency(item.franchiseeAmount)
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`font-mono ${
                              item.isMatched
                                ? "text-green-600"
                                : item.difference > 100
                                  ? "text-red-600 font-semibold"
                                  : "text-orange-600"
                            }`}
                          >
                            {formatCurrency(item.difference)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {item.differencePercent !== null
                              ? `${formatPercent(item.differencePercent)} הפרש`
                              : "אין נתוני זכיין"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-end font-mono text-sm">
                    {formatPercent(item.commissionRate)}
                  </TableCell>
                  <TableCell className="text-end font-mono font-medium">
                    {formatCurrency(item.commissionAmount)}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.isMatched ? (
                      <Badge variant="success" className="bg-green-100 text-green-700">
                        <Check className="h-3 w-3 me-1" />
                        התאמה
                      </Badge>
                    ) : item.hasFranchiseeData ? (
                      <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                        <AlertTriangle className="h-3 w-3 me-1" />
                        פער
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <X className="h-3 w-3 me-1" />
                        חסר
                      </Badge>
                    )}
                    {item.hasAdjustment && (
                      <Badge variant="secondary" className="ms-1">
                        תיקון
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {!item.isMatched && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onAdjust(item)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit2 className="h-4 w-4" />
                        <span className="sr-only">תיקון</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      <div className="text-sm text-muted-foreground text-center">
        מציג {filteredItems.length} מתוך {items.length} רשומות
      </div>
    </div>
  );
}
