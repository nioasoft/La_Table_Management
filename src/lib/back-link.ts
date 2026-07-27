/**
 * Shared "return to where I came from" helper for detail pages.
 *
 * Detail pages (file review screens) are reachable from many list pages, each
 * with its own tab/filter state. The entry link carries the return path in a
 * `?back=` param; the detail page reads it and falls back to its own queue.
 */

type ReadonlyParams = Pick<URLSearchParams, "get">;

/** Appends a return path to a detail-page href. */
export function withBack(href: string, back: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}back=${encodeURIComponent(back)}`;
}

/**
 * Reads `?back=`, rejecting anything that isn't a same-origin relative path.
 * The value comes from the URL, i.e. from the user — `//evil.com`,
 * `https://evil.com` and `javascript:` must never reach a Link href.
 */
export function resolveBackHref(
  params: ReadonlyParams,
  fallback: string
): string {
  const back = params.get("back");
  return back?.startsWith("/") && !back.startsWith("//") ? back : fallback;
}
