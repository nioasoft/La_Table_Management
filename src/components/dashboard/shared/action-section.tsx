"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
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

const priorityColors = {
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
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

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="font-semibold text-sm">{title}</h3>
            {count > 0 && (
              <Badge className={`text-xs ${priorityColors[priority]}`}>
                {count}
              </Badge>
            )}
          </div>
          {linkHref && linkText && count > 0 && (
            <Link href={linkHref}>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                {linkText}
                <ChevronLeft className="h-3 w-3 me-1" />
              </Button>
            </Link>
          )}
        </div>

        {isLoading ? (
          <SectionSkeleton />
        ) : count === 0 ? (
          <SectionEmptyState message={emptyMessage} />
        ) : (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <div>{children}</div>
            {showExpandButton && (
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-1 h-7 text-xs text-muted-foreground"
                >
                  {isExpanded
                    ? "הצג פחות"
                    : `הצג עוד ${(totalItems ?? count) - maxPreviewItems}`}
                  <ChevronDown
                    className={`h-3 w-3 ms-1 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
            )}
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
