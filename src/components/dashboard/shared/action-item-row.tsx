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
    <div className="flex items-center justify-between py-1.5 px-1 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${iconBgClass}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm leading-tight truncate">{title}</p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground leading-tight truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 me-1">
        {badge}
        {href && (
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
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
