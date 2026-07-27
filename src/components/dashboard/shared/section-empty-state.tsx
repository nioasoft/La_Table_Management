"use client";

import { CheckCircle2, CircleDashed } from "lucide-react";

interface SectionEmptyStateProps {
  message: string;
  /** "neutral" = empty because there's no data yet, not because all is well */
  tone?: "success" | "neutral";
}

export function SectionEmptyState({
  message,
  tone = "success",
}: SectionEmptyStateProps) {
  const Icon = tone === "neutral" ? CircleDashed : CheckCircle2;
  const color =
    tone === "neutral"
      ? "text-muted-foreground"
      : "text-green-600 dark:text-green-400";

  return (
    <div className={`flex items-center gap-1.5 py-1 text-xs ${color}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
