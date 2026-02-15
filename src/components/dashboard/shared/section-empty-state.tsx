"use client";

import { CheckCircle2 } from "lucide-react";

interface SectionEmptyStateProps {
  message: string;
}

export function SectionEmptyState({ message }: SectionEmptyStateProps) {
  return (
    <div className="flex items-center gap-1.5 py-1 text-xs text-green-600 dark:text-green-400">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
