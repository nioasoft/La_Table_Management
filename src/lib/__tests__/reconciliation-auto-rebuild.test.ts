import { describe, expect, it } from "vitest";
import {
  humanWorkReason,
  type SessionWorkFacts,
} from "@/lib/reconciliation-auto-rebuild";

const untouchedRow = {
  status: "auto_approved",
  reviewedBy: null,
  reviewedAt: null,
  reviewNotes: null,
  notes: null,
};

function session(overrides: Partial<SessionWorkFacts> = {}): SessionWorkFacts {
  return {
    status: "in_progress",
    fileApprovedAt: null,
    fileRejectionReason: null,
    reviewQueueRows: 0,
    comparisons: [untouchedRow, { ...untouchedRow, status: "needs_review" }],
    ...overrides,
  };
}

describe("humanWorkReason", () => {
  it("is safe when nobody touched the session (the Biscotti Q3 case)", () => {
    expect(humanWorkReason(session())).toBeNull();
    expect(humanWorkReason(session({ comparisons: [] }))).toBeNull();
  });

  it("is safe for a 'completed' session built entirely from auto-approved rows", () => {
    expect(humanWorkReason(session({ status: "completed" }))).toBeNull();
  });

  it("keeps an approved or rejected file", () => {
    expect(humanWorkReason(session({ fileApprovedAt: new Date() }))).toMatch(/file approved/);
    expect(humanWorkReason(session({ fileRejectionReason: "סכומים שגויים" }))).toMatch(/file rejected/);
    // status alone is enough, even if the timestamp was lost
    expect(humanWorkReason(session({ status: "file_approved" }))).toMatch(/file approved/);
    expect(humanWorkReason(session({ status: "file_rejected" }))).toMatch(/file rejected/);
  });

  it("keeps a session with review-queue rows, resolved or not", () => {
    expect(humanWorkReason(session({ reviewQueueRows: 1 }))).toMatch(/review queue/);
  });

  it("keeps a session with any reviewed row", () => {
    const reviewed = { ...untouchedRow, status: "manually_approved", reviewedBy: "u1", reviewedAt: new Date() };
    expect(humanWorkReason(session({ comparisons: [untouchedRow, reviewed] }))).toMatch(/1 row/);
  });

  it("keeps a reviewed row even when the reviewer's user row was deleted", () => {
    // reviewed_by is ON DELETE SET NULL — reviewed_at and the status survive
    const orphaned = { ...untouchedRow, reviewedAt: new Date() };
    expect(humanWorkReason(session({ comparisons: [orphaned] }))).not.toBeNull();
    const manual = { ...untouchedRow, status: "manually_approved" };
    expect(humanWorkReason(session({ comparisons: [manual] }))).not.toBeNull();
    const queued = { ...untouchedRow, status: "sent_to_review_queue" };
    expect(humanWorkReason(session({ comparisons: [queued] }))).not.toBeNull();
  });

  it("keeps a session with notes or review notes", () => {
    expect(humanWorkReason(session({ comparisons: [{ ...untouchedRow, notes: "לבדוק מול רעות" }] }))).not.toBeNull();
    expect(humanWorkReason(session({ comparisons: [{ ...untouchedRow, reviewNotes: "אושר טלפונית" }] }))).not.toBeNull();
  });

  it("ignores notes that were cleared to blank", () => {
    expect(humanWorkReason(session({ comparisons: [{ ...untouchedRow, notes: "  ", reviewNotes: "" }] }))).toBeNull();
  });
});
