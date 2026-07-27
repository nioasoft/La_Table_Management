import { describe, it, expect } from "vitest";
import { withBack, resolveBackHref } from "../back-link";

const params = (query: string) => new URLSearchParams(query);
const FALLBACK = "/admin/bkmvdata/review";

describe("withBack", () => {
  it("adds the param with ? on a bare href", () => {
    expect(withBack("/admin/bkmvdata/review/abc", "/admin/bkmvdata?tab=history")).toBe(
      "/admin/bkmvdata/review/abc?back=%2Fadmin%2Fbkmvdata%3Ftab%3Dhistory"
    );
  });

  it("adds the param with & when the href already has a query", () => {
    expect(withBack("/admin/supplier-files/review/abc?reprocessed=1", "/admin/x")).toBe(
      "/admin/supplier-files/review/abc?reprocessed=1&back=%2Fadmin%2Fx"
    );
  });

  it("round-trips through resolveBackHref", () => {
    const href = withBack("/admin/bkmvdata/review/abc", "/admin/bkmvdata?tab=history");
    const query = href.slice(href.indexOf("?") + 1);
    expect(resolveBackHref(params(query), FALLBACK)).toBe("/admin/bkmvdata?tab=history");
  });
});

describe("resolveBackHref", () => {
  it("falls back when no back param is present", () => {
    expect(resolveBackHref(params(""), FALLBACK)).toBe(FALLBACK);
  });

  it("rejects off-site targets", () => {
    for (const evil of ["//evil.com", "https://evil.com", "javascript:alert(1)", "evil.com"]) {
      expect(resolveBackHref(params(`back=${encodeURIComponent(evil)}`), FALLBACK)).toBe(
        FALLBACK
      );
    }
  });

  it("rejects an empty back param", () => {
    expect(resolveBackHref(params("back="), FALLBACK)).toBe(FALLBACK);
  });
});
