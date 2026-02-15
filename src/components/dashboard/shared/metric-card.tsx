"use client";

import { Card, CardContent } from "@/components/ui/card";

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  colorClass?: string;
}

export function MetricCard({
  label,
  value,
  subtitle,
  icon,
  colorClass = "text-foreground",
}: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
          </div>
          {icon && (
            <div className="text-muted-foreground/30 shrink-0">{icon}</div>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground truncate">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
