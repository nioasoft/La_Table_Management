"use client";

export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 py-1.5 animate-pulse"
        >
          <div className="h-6 w-6 rounded-full bg-muted" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-2.5 w-16 rounded bg-muted" />
          </div>
          <div className="h-4 w-8 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
