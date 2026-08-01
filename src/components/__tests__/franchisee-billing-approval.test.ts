import { describe, expect, it } from "vitest";

import {
  approvalPanelState,
  recipientsFor,
} from "@/components/franchisee-billing-approval";

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

describe("recipient defaulting", () => {
  // Regression: the selection map was initialised once at mount, so a deferral
  // entered afterwards left the map empty and the month was approved without
  // sending a single email. Absence must mean "every owner", not "nobody".
  const selectedFor = recipientsFor;

  const owners = [{ email: "a@example.com" }, { email: " b@example.com " }];

  it("selects every owner when the franchisee was never touched", () => {
    expect(selectedFor({}, "f1", owners)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("honours an explicit empty selection", () => {
    expect(selectedFor({ f1: [] }, "f1", owners)).toEqual([]);
  });

  it("honours a partial selection", () => {
    expect(selectedFor({ f1: ["a@example.com"] }, "f1", owners)).toEqual([
      "a@example.com",
    ]);
  });
});
