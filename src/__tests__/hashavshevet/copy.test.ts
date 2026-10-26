import { describe, it, expect } from "vitest";
import { copy, apiErrorMessage, previewCopy, sendsCopy } from "@/lib/hashavshevet/copy";

describe("hashavshevet copy", () => {
  it("translates api errors per spec §10", () => {
    expect(apiErrorMessage("permission", "movein", "פט ויני")).toBe(
      "אין הרשאה לממשק movein בחברה פט ויני. בדקו את הגדרות H-Connect",
    );
    expect(apiErrorMessage("not_in_service", "movein", "x")).toBe("השרת של חשבשבת לא זמין. נסו שוב מאוחר יותר");
    expect(apiErrorMessage("validation", "movein", "x")).toBe("חשבשבת דחתה את השורות. ראו את השגיאה ליד כל שורה");
    expect(apiErrorMessage("other", "movein", "x")).not.toBe("");
  });

  it("formats money in sent messages with he-IL grouping and a shekel sign", () => {
    expect(copy.sentAwaitingApproval(3, 12345.5, "פט ויני", 1)).toContain("₪12,345.50");
    expect(copy.sentApproved(1, 10, "פט ויני", 1)).toContain("₪10.00");
    expect(copy.serverError("req-1")).toContain("req-1");
    expect(copy.noCompany).toBe("לזכיין אין חברה בחשבשבת");
  });

  it("shows the number of requests only when a send was split (each may be its own temporary batch)", () => {
    expect(copy.sentAwaitingApproval(3, 10, "x", 1)).not.toContain("בקשות");
    expect(copy.sentAwaitingApproval(3, 10, "x", 2)).toContain("2 בקשות");
    expect(copy.sentApproved(3, 10, "x", 1)).not.toContain("בקשות");
    expect(copy.sentApproved(3, 10, "x", 3)).toContain("3 בקשות");
  });

  it("names a fresh pending send as still in flight: wait for it or for 15 minutes", () => {
    const text = copy.invalidTransition("rejected", "pending");
    expect(text).toContain("15 דקות");
    expect(text).not.toContain("כשהשליחה בשליחה");
  });

  it("words the 'arrived' outcome naturally in the 409 text", () => {
    const text = copy.invalidTransition("arrived", "rejected");
    expect(text).toContain("סימון שהגיעה לחשבשבת");
    expect(text).toContain("נדחתה");
  });

  // I4: rejecting or "לא הגיע" releases the rows for a resend; anything of the send left in Hashavshevet
  // (the temporary area, or a .dat that Masofon2 retries) would then arrive twice.
  it.each([
    ["rejectDescription", sendsCopy.rejectDescription],
    ["staleWarning", sendsCopy.staleWarning],
    ["unknownNote", sendsCopy.unknownNote],
  ])("%s says to clean the temporary area and the leftover .dat before releasing", (_name, text) => {
    expect(text).toContain("האזור הזמני");
    expect(text).toContain(".dat");
    expect(text).toContain("C:\\hash7\\Hconnect");
    expect(text).not.toContain("אם אינכם בטוחים");
  });

  it.each([
    ["staleWarning", sendsCopy.staleWarning],
    ["unknownNote", sendsCopy.unknownNote],
  ])("%s warns that earlier requests of a split send may have arrived", (_name, text) => {
    expect(text).toContain("כמה בקשות");
    expect(text).toContain('"הגיע"');
    expect(text).toContain('"לא הגיע"');
  });

  it("asks what was checked when the send did not arrive, not what was wrong with it", () => {
    expect(sendsCopy.notArrivedPlaceholder).not.toBe(sendsCopy.notePlaceholder);
    expect(sendsCopy.notArrivedPlaceholder).toContain(".dat");
  });

  it("names the reconciliation page's two by-franchisee sends (T14)", () => {
    expect(previewCopy.byFranchiseeSendWhat).toEqual({ franchisee_client_invoices: "חשבוניות", journal_entries: "תנועות יומן" });
  });
});
