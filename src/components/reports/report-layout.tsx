"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPES
// ============================================================================

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface ReportLayoutProps {
  /** Page title */
  title: string;
  /** Page description */
  description?: string;
  /** Breadcrumb items */
  breadcrumbs?: BreadcrumbItem[];
  /** Loading state */
  isLoading?: boolean;
  /** Refresh callback */
  onRefresh?: () => void;
  /** Additional actions in header */
  actions?: React.ReactNode;
  /** Children content */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReportLayout({
  title,
  description,
  breadcrumbs = [{ label: "ניהול", href: "/admin" }],
  isLoading = false,
  onRefresh,
  actions,
  children,
  className,
}: ReportLayoutProps) {
  return (
    <div className={cn("container mx-auto py-6 space-y-6", className)} dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          {/* Breadcrumb */}
          {breadcrumbs.length > 0 && (
            <nav className="flex items-center space-x-1 space-x-reverse text-sm text-muted-foreground mb-2">
              {breadcrumbs.map((item, index) => (
                <span key={index} className="flex items-center">
                  {index > 0 && (
                    <ChevronRight className="h-4 w-4 mx-1 rotate-180" />
                  )}
                  {item.href ? (
                    <Link href={item.href} className="hover:text-foreground">
                      {item.label}
                    </Link>
                  ) : (
                    <span className="text-foreground">{item.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Title */}
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>

          {/* Description */}
          {description && (
            <p className="text-muted-foreground mt-1">{description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              variant="outline"
              onClick={onRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("h-4 w-4 me-2", isLoading && "animate-spin")}
              />
              רענון
            </Button>
          )}
          {actions}
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

export interface ReportSectionProps {
  /** Section title */
  title?: string;
  /** Section description */
  description?: string;
  /** Children content */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
}

export function ReportSection({
  title,
  description,
  children,
  className,
}: ReportSectionProps) {
  return (
    <section className={cn("space-y-4", className)}>
      {(title || description) && (
        <div>
          {title && (
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export interface ReportLoadingOverlayProps {
  /** Whether to show the loading overlay */
  isLoading: boolean;
  /** Loading message */
  message?: string;
}

export function ReportLoadingOverlay({
  isLoading,
  message = "טוען נתונים...",
}: ReportLoadingOverlayProps) {
  if (!isLoading) return null;

  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>{message}</span>
      </div>
    </div>
  );
}

export interface ReportEmptyStateProps {
  /** Icon to display */
  icon?: React.ReactNode;
  /** Title */
  title?: string;
  /** Description */
  description?: string;
  /** Action button */
  action?: React.ReactNode;
}

export function ReportEmptyState({
  icon,
  title = "אין נתונים להצגה",
  description = "לא נמצאו נתונים להצגה. נסה לשנות את הסינון.",
  action,
}: ReportEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="mb-4 text-muted-foreground">{icon}</div>
      )}
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-md">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
