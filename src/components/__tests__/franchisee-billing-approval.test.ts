import { describe, expect, it } from "vitest";

import { approvalPanelState } from "@/components/franchisee-billing-approval";

const draft = { status: "draft" } as const;
const approved = { status: "approved" } as const;

describe("approvalPanelState", () => {
  it("hides itself for a month that has no billing rows at all", () => {
    // Regression: `rows.some(...)` is false for an empty list, which made an
    // untouched month announce "החודש כבר אושר" before anything was uploaded.
    expect(approvalPanelState([], 0)).toBe("hidden");
  });

  it("reports an approved month only when rows exist and none are drafts", () => {
    expect(approvalPanelState([approved], 0)).toBe("already-approved");
    expect(approvalPanelState([approved, approved], 0)).toBe(
      "already-approved",
    );
  });

  it("shows the form while any row is still a draft", () => {
    expect(approvalPanelState([draft], 0)).toBe("form");
    expect(approvalPanelState([approved, draft], 0)).toBe("form");
  });

  it("shows the form for email failures even with no rows left to approve", () => {
    expect(approvalPanelState([], 1)).toBe("form");
    expect(approvalPanelState([approved], 2)).toBe("form");
  });
});
