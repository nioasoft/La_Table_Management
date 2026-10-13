"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * A page's active tab, kept in `?tab=` and pushed onto browser history.
 *
 * Tabs used to live in component state (or `replaceState`), so Back skipped
 * every tab switch and dropped Reut on the dashboard, and coming back to a
 * page from a detail screen reset it to its first tab (2026-10-13). With the
 * tab in the URL, Back walks back through the tabs she actually visited.
 *
 * Native `pushState` is synced into `useSearchParams` by Next.js, so a switch
 * re-renders instantly with no server round-trip.
 */
export function useUrlTab<T extends string>(
  tabs: readonly T[],
  fallback: T
): [T, (next: string) => void] {
  const raw = useSearchParams().get("tab");
  const tab = tabs.find((t) => t === raw) ?? fallback;

  const setTab = useCallback(
    (next: string) => {
      if (next === tab || !tabs.includes(next as T)) return;
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.pushState(null, "", url);
    },
    [tab, tabs]
  );

  return [tab, setTab];
}
