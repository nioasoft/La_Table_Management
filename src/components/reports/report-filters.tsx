"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Loader2, Filter, ChevronDown, X, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterOption, ReportFilters, DatePreset } from "@/hooks/use-report-filters";
import { getDatePresets } from "@/hooks/use-report-filters";
import { ReportPeriodSelector } from "./report-period-selector";
import type { SettlementPeriodType } from "@/db/schema";

// ============================================================================
// TYPES
// ============================================================================

export interface StatusOption {
  value: string;
  label: string;
}

export interface ReportFiltersProps {
  /** Current filter values */
  filters: ReportFilters;
  /** Called when a filter changes */
  onFilterChange: <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => void;
  /** Called when period changes (for period selector) */
  onPeriodChange?: (periodType: SettlementPeriodType | "", periodKey: string) => void;
  /** Called when filters are applied */
  onApply: () => void;
  /** Called when filters are reset */
  onReset: () => void;
  /** Available brand options */
  brands?: FilterOption[];
  /** Available supplier options */
  suppliers?: FilterOption[];
  /** Available franchisee options */
  franchisees?: FilterOption[];
  /** Available status options */
  statusOptions?: StatusOption[];
  /** Whether to show period selector */
  showPeriodSelector?: boolean;
  /** Whether to show date filters (manual date inputs) */
  showDateFilters?: boolean;
  /** Whether to show brand filter */
  showBrandFilter?: boolean;
  /** Whether to show supplier filter */
  showSupplierFilter?: boolean;
  /** Whether to show franchisee filter */
  showFranchiseeFilter?: boolean;
  /** Whether to show status filter */
  showStatusFilter?: boolean;
  /** Whether to show date presets */
  showDatePresets?: boolean;
  /** Loading state */
  isLoading?: boolean;
  /** Number of active filters */
  activeFilterCount?: number;
  /** Whether filters panel is collapsible */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Title for the filter card */
  title?: string;
  /** Description for the filter card */
  description?: string;
  /** Additional class name */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReportFilters({
  filters,
  onFilterChange,
  onPeriodChange,
  onApply,
  onReset,
  brands = [],
  suppliers = [],
  franchisees = [],
  statusOptions = [],
  showPeriodSelector = false,
  showDateFilters = true,
  showBrandFilter = true,
  showSupplierFilter = true,
  showFranchiseeFilter = true,
  showStatusFilter = true,
  showDatePresets = true,
  isLoading = false,
  activeFilterCount = 0,
  collapsible = false,
  defaultCollapsed = false,
  title = "סינון",
  description = "סנן את הדוח לפי תאריכים, מותג, ספק או סטטוס",
  className,
}: ReportFiltersProps) {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);
  const [useCustomDateRange, setUseCustomDateRange] = useState(!filters.periodKey);
  const datePresets = getDatePresets();

  // Handle date preset selection
  const handleDatePreset = (preset: DatePreset) => {
    // Clear period selection when using presets
    if (onPeriodChange) {
      onPeriodChange("", "");
    }
    setUseCustomDateRange(true);
    onFilterChange("startDate", preset.startDate);
    onFilterChange("endDate", preset.endDate);
  };

  // Handle period change
  const handlePeriodChange = (periodType: SettlementPeriodType | "", periodKey: string) => {
    if (onPeriodChange) {
      onPeriodChange(periodType, periodKey);
    }
    // When a period is selected, we're not using custom range
    setUseCustomDateRange(!periodType);
  };

  // Handle custom range selection
  const handleCustomRangeSelect = () => {
    setUseCustomDateRange(true);
  };

  // Filter content
  const filterContent = (
    <div className="flex flex-wrap items-end gap-2">
      {/* Period Selector */}
      {showPeriodSelector && (
        <div className="flex-shrink-0">
          <ReportPeriodSelector
            periodType={filters.periodType || ""}
            periodKey={filters.periodKey || ""}
            onChange={handlePeriodChange}
            onCustomRangeSelect={handleCustomRangeSelect}
            showCustomRange={false}
            layout="horizontal"
            showLabels={true}
          />
        </div>
      )}

      {/* Brand Filter */}
      {showBrandFilter && (
        <div className="w-[110px]">
          <Label htmlFor="brand" className="text-xs mb-1 block">מותג</Label>
          <Select
            value={filters.brandId || "all"}
            onValueChange={(value) => onFilterChange("brandId", value === "all" ? "" : value)}
          >
            <SelectTrigger id="brand" dir="rtl" className="[&>span]:text-end h-9" aria-label="בחר מותג">
              <SelectValue placeholder="כל המותגים" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all" className="text-end">
                כל המותגים
              </SelectItem>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id} className="text-end">
                  {brand.nameHe || brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Supplier Filter */}
      {showSupplierFilter && (
        <div className="w-[110px]">
          <Label htmlFor="supplier" className="text-xs mb-1 block">ספק</Label>
          <Select
            value={filters.supplierId || "all"}
            onValueChange={(value) => onFilterChange("supplierId", value === "all" ? "" : value)}
          >
            <SelectTrigger id="supplier" dir="rtl" className="[&>span]:text-end h-9" aria-label="בחר ספק">
              <SelectValue placeholder="כל הספקים" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all" className="text-end">
                כל הספקים
              </SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id} className="text-end">
                  {supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Franchisee Filter */}
      {showFranchiseeFilter && (
        <div className="w-[110px]">
          <Label htmlFor="franchisee" className="text-xs mb-1 block">זכיין</Label>
          <Select
            value={filters.franchiseeId || "all"}
            onValueChange={(value) => onFilterChange("franchiseeId", value === "all" ? "" : value)}
          >
            <SelectTrigger id="franchisee" dir="rtl" className="[&>span]:text-end h-9" aria-label="בחר זכיין">
              <SelectValue placeholder="כל הזכיינים" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all" className="text-end">
                כל הזכיינים
              </SelectItem>
              {franchisees.map((franchisee) => (
                <SelectItem key={franchisee.id} value={franchisee.id} className="text-end">
                  {franchisee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Status Filter */}
      {showStatusFilter && statusOptions.length > 0 && (
        <div className="w-[110px]">
          <Label htmlFor="status" className="text-xs mb-1 block">סטטוס</Label>
          <Select
            value={filters.status || "all"}
            onValueChange={(value) => onFilterChange("status", value === "all" ? "" : value)}
          >
            <SelectTrigger id="status" dir="rtl" className="[&>span]:text-end h-9" aria-label="בחר סטטוס">
              <SelectValue placeholder="כל הסטטוסים" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all" className="text-end">
                כל הסטטוסים
              </SelectItem>
              {statusOptions.map((status) => (
                <SelectItem key={status.value} value={status.value} className="text-end">
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={onApply} disabled={isLoading} size="sm" className="h-9" aria-label="החל סינון">
          {isLoading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
          החל סינון
        </Button>
        <Button variant="outline" onClick={onReset} disabled={isLoading} size="sm" className="h-9" aria-label="איפוס סינון">
          <X className="h-4 w-4 me-2" />
          איפוס
        </Button>
      </div>
    </div>
  );

  // Collapsible wrapper
  if (collapsible) {
    return (
      <Card className={className}>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3 pt-4 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    {title}
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </CardTitle>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="px-4 pb-4">{filterContent}</CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  }

  // Non-collapsible card
  return (
    <Card className={className}>
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Filter className="h-4 w-4" />
          {title}
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">{filterContent}</CardContent>
    </Card>
  );
}
