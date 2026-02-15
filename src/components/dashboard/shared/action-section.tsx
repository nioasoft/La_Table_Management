"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { SectionEmptyState } from "./section-empty-state";
import { SectionSkeleton } from "./section-skeleton";

interface ActionSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  linkHref?: string;
  linkText?: string;
  emptyMessage: string;
  maxPreviewItems?: number;
  priority?: "high" | "medium" | "low";
  isLoading?: boolean;
  children: React.ReactNode;
  totalItems?: number;
}

const borderColors = {
  high: "border-s-red-500",
  medium: "border-s-amber-500",
  low: "border-s-blue-500",
};

const countBadgeColors = {
  high: "bg-red-500 text-white hover:bg-red-500",
  medium: "bg-amber-500 text-white hover:bg-amber-500",
  low: "bg-blue-500 text-white hover:bg-blue-500",
};

export function ActionSection({
  title,
  icon,
  count,
  linkHref,
  linkText,
  emptyMessage,
  maxPreviewItems = 5,
  priority = "medium",
  isLoading,
  children,
  totalItems,
}: ActionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const showExpandButton = (totalItems ?? count) > maxPreviewItems;

  // When empty and not loading, render ultra-compact inline
  if (!isLoading && count === 0) {
    return (
      <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60">{icon}</span>
          <span className="text-xs text-muted-foreground">{title}</span>
        </div>
        <SectionEmptyState message={emptyMessage} />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-s-[3px] bg-card ${count > 0 ? borderColors[priority] : "border-s-transparent"}`}
    >
      <div className="px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{icon}</span>
            <h3 className="text-sm font-semibold">{title}</h3>
            {count > 0 && (
              <Badge
                className={`h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] font-bold ${countBadgeColors[priority]}`}
              >
                {count}
              </Badge>
            )}
          </div>
          {linkHref && linkText && count > 0 && (
            <Link href={linkHref}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {linkText}
                <ChevronLeft className="h-3 w-3 me-0.5" />
              </Button>
            </Link>
          )}
        </div>

        {/* Content */}
        <div className="mt-1">
          {isLoading ? (
            <SectionSkeleton />
          ) : (
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <div>{children}</div>
              {showExpandButton && (
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-center gap-1 w-full py-1 mt-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/60">
                    {isExpanded
                      ? "הצג פחות"
                      : `הצג עוד ${(totalItems ?? count) - maxPreviewItems}`}
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </CollapsibleTrigger>
              )}
            </Collapsible>
          )}
        </div>
      </div>
    </div>
  );
}
