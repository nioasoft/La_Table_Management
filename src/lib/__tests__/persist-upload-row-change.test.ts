import { describe, it, expect, vi } from "vitest";
import { persistUploadRowChange } from "@/lib/persist-upload-row-change";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("persistUploadRowChange", () => {
  it("writes to the saved file once it exists (יוניקו, 2026-10-18)", async () => {
    // The anomaly dialog saves the file on confirm; a match changed after
    // that used to live only in page state and was lost.
    const fetcher = fakeFetch(200, { success: true, message: "התאמה עודכנה" });
    const result = await persistUploadRowChange(
      "file-1",
      { originalName: "M_-82 (מינה טומאיי)", franchiseeId: "odon", addAsAlias: true },
      fetcher
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/supplier-files/review/file-1",
      expect.objectContaining({ method: "PATCH" })
    );
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      originalName: "M_-82 (מינה טומאיי)",
      franchiseeId: "odon",
      addAsAlias: true,
      reevaluateStatus: true,
    });
    expect(result).toEqual({ ok: true, message: "התאמה עודכנה" });
  });

  it("fails loudly when the saved file rejects the change", async () => {
    const fetcher = fakeFetch(500, { error: "Internal server error" });
    const result = await persistUploadRowChange(
      "file-1",
      { originalName: "x", blacklist: true },
      fetcher
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("before save, only learns the alias", async () => {
    const fetcher = fakeFetch(200, { success: true });
    const result = await persistUploadRowChange(
      null,
      { originalName: "יהוד (מינה טומאיי)", franchiseeId: "yehud", addAsAlias: true },
      fetcher
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/franchisees/yehud/aliases",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ ok: true });
  });

  it("before save, surfaces an alias owned by another franchisee", async () => {
    const msg = 'הכינוי "M_-82 (מינה טומאיי)" כבר רשום אצל הזכיין "קסטרא טומאיי בע"מ"';
    const fetcher = fakeFetch(409, { error: msg });
    const result = await persistUploadRowChange(
      null,
      { originalName: "M_-82 (מינה טומאיי)", franchiseeId: "odon", addAsAlias: true },
      fetcher
    );
    expect(result).toEqual({ ok: true, warning: msg });
  });

  it("before save, an alias the franchisee already has is not a warning", async () => {
    const fetcher = fakeFetch(400, { error: "Alias already exists for this franchisee" });
    const result = await persistUploadRowChange(
      null,
      { originalName: "a", franchiseeId: "f", addAsAlias: true },
      fetcher
    );
    expect(result).toEqual({ ok: true });
  });

  it("before save without alias or blacklist, touches nothing", async () => {
    const fetcher = fakeFetch(200, {});
    expect(await persistUploadRowChange(null, { originalName: "a", blacklist: true }, fetcher)).toEqual({ ok: true });
    expect(
      await persistUploadRowChange(null, { originalName: "a", franchiseeId: "f", addAsAlias: false }, fetcher)
    ).toEqual({ ok: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
