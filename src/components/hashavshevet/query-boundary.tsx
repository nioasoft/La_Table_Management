"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { ErrorNotice } from "./preview-notices";

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-3 py-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" aria-hidden="true" />
        {label}
      </p>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function EmptyBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface QueryBoundaryProps {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  loadingLabel: string;
  errorMessage: string;
  retryLabel: string;
  /** Shown when the query succeeded with nothing in it. */
  empty: ReactNode;
  children: ReactNode;
}

/** Every screen has four states: loading, error (with a retry), empty, and the data. */
export function QueryBoundary(props: QueryBoundaryProps) {
  if (props.isPending) return <LoadingBlock label={props.loadingLabel} />;
  if (props.isError) return <ErrorNotice message={props.errorMessage} onRefresh={props.onRetry} actionLabel={props.retryLabel} />;
  if (props.isEmpty) return <>{props.empty}</>;
  return <>{props.children}</>;
}
