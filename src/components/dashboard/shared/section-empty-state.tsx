"use client";

import { CheckCircle2 } from "lucide-react";

interface SectionEmptyStateProps {
  message: string;
}

export function SectionEmptyState({ message }: SectionEmptyStateProps) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 text-sm text-green-700 dark:text-green-400">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
