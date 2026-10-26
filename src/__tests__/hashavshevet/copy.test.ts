import { describe, it, expect } from "vitest";
import { copy, apiErrorMessage } from "@/lib/hashavshevet/copy";

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
    expect(copy.sentAwaitingApproval(3, 12345.5, "פט ויני")).toContain("₪12,345.50");
    expect(copy.sentApproved(1, 10, "פט ויני")).toContain("₪10.00");
    expect(copy.serverError("req-1")).toContain("req-1");
    expect(copy.noCompany).toBe("לזכיין אין חברה בחשבשבת");
  });
});
