"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

export interface SummaryCardData {
  /** Card title */
  title: string;
  /** Main value to display */
  value: string | number;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Icon component */
  icon?: LucideIcon;
  /** Optional trend indicator */
  trend?: {
    value: number;
    isPositive: boolean;
  };
  /** Value color class */
  valueClassName?: string;
  /** Card variant */
  variant?: "default" | "success" | "warning" | "danger";
}

export interface ReportSummaryCardsProps {
  /** Array of card data */
  cards: SummaryCardData[];
  /** Loading state */
  isLoading?: boolean;
  /** Number of columns on desktop */
  columns?: 2 | 3 | 4 | 5 | 6;
  /** Additional class name */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReportSummaryCards({
  cards,
  isLoading = false,
  columns = 4,
  className,
}: ReportSummaryCardsProps) {
  const gridCols = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-2 lg:grid-cols-4",
    5: "md:grid-cols-3 lg:grid-cols-5",
    6: "md:grid-cols-3 lg:grid-cols-6",
  };

  const variantStyles = {
    default: "",
    success: "border-green-500/50 bg-green-50/50 dark:bg-green-950/20",
    warning: "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20",
    danger: "border-red-500/50 bg-red-50/50 dark:bg-red-950/20",
  };

  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-1 gap-4", gridCols[columns], className)}>
        {Array.from({ length: cards.length || 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-4", gridCols[columns], className)}>
      {cards.map((card, index) => (
        <Card
          key={index}
          className={cn(variantStyles[card.variant || "default"])}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            {card.icon && (
              <card.icon className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", card.valueClassName)}>
              {card.value}
            </div>
            {card.subtitle && (
              <p className="text-xs text-muted-foreground">{card.subtitle}</p>
            )}
            {card.trend && (
              <div
                className={cn(
                  "flex items-center gap-1 text-xs mt-1",
                  card.trend.isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                )}
              >
                <span>{card.trend.isPositive ? "▲" : "▼"}</span>
                <span>{Math.abs(card.trend.value).toFixed(1)}%</span>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a summary card with formatted currency value
 */
export function createCurrencyCard(
  title: string,
  amount: number,
  icon?: LucideIcon,
  subtitle?: string
): SummaryCardData {
  const formatted = new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

  return {
    title,
    value: formatted,
    subtitle,
    icon,
  };
}

/**
 * Create a summary card with formatted number value
 */
export function createNumberCard(
  title: string,
  count: number,
  icon?: LucideIcon,
  subtitle?: string
): SummaryCardData {
  return {
    title,
    value: count.toLocaleString("he-IL"),
    subtitle,
    icon,
  };
}

/**
 * Create a summary card with percentage value
 */
export function createPercentCard(
  title: string,
  percent: number,
  icon?: LucideIcon,
  subtitle?: string
): SummaryCardData {
  return {
    title,
    value: `${percent.toFixed(2)}%`,
    subtitle,
    icon,
  };
}
