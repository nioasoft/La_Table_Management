"use client";

import Link from "next/link";

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  colorClass?: string;
  accentColor?: "green" | "amber" | "red" | "blue" | "neutral";
  href?: string;
  scrollToId?: string;
}

const accentStyles = {
  green: "border-t-green-500 bg-green-50/50 dark:bg-green-950/20",
  amber: "border-t-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
  red: "border-t-red-500 bg-red-50/50 dark:bg-red-950/20",
  blue: "border-t-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
  neutral: "border-t-border bg-card",
};

const iconStyles = {
  green: "text-green-500/40",
  amber: "text-amber-500/40",
  red: "text-red-500/40",
  blue: "text-blue-500/40",
  neutral: "text-muted-foreground/20",
};

export function MetricCard({
  label,
  value,
  subtitle,
  icon,
  colorClass = "text-foreground",
  accentColor = "neutral",
  href,
  scrollToId,
}: MetricCardProps) {
  const isClickable = !!href || !!scrollToId;

  const handleClick = () => {
    if (scrollToId) {
      document
        .getElementById(scrollToId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const content = (
    <div
      className={`rounded-lg border border-t-2 p-3 transition-shadow hover:shadow-sm ${accentStyles[accentColor]} ${
        isClickable ? "cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" : ""
      }`}
      onClick={!href && scrollToId ? handleClick : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className={`text-xl font-bold leading-tight mt-0.5 ${colorClass}`}>
            {value}
          </p>
        </div>
        {icon && (
          <div className={`shrink-0 mt-0.5 ${iconStyles[accentColor]}`}>
            {icon}
          </div>
        )}
      </div>
      {subtitle && (
        <p className="mt-1.5 text-[11px] text-muted-foreground leading-tight">
          {subtitle}
        </p>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-lg border border-t-2 border-t-border bg-card p-3 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="h-3 w-16 rounded bg-muted" />
          <div className="h-6 w-12 rounded bg-muted mt-1.5" />
        </div>
        <div className="h-5 w-5 rounded bg-muted shrink-0 mt-0.5" />
      </div>
      <div className="h-3 w-24 rounded bg-muted mt-2" />
    </div>
  );
}
