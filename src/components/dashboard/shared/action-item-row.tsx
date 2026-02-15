"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

interface ActionItemRowProps {
  icon: React.ReactNode;
  iconBgClass: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  href?: string;
}

export function ActionItemRow({
  icon,
  iconBgClass,
  title,
  subtitle,
  badge,
  href,
}: ActionItemRowProps) {
  const content = (
    <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${iconBgClass}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge}
        {href && (
          <ChevronLeft className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}
