import { describe, it, expect } from "vitest";
import { reportSlotPrecedence } from "../report-slot-precedence";

// 10bis self-billed periods (July 2026+): the client_report slot belongs to
// the franchisee's ezcount tax invoice. 10bis's own transaction report
// arrives in the SAME email and, when processed first, took the slot — the
// invoice (and its מספר הקצאה) was parked. קסטרא טומאיי, August 2026.
describe("reportSlotPrecedence", () => {
  it("lets an invoice replace a transaction report", () => {
    expect(
      reportSlotPrecedence({
        selfBilled: true,
        occupantInvoiceNumber: null,
        incomingInvoiceNumber: "10080",
      }),
    ).toBe("replace");
  });

  it("skips a transaction report when the invoice already holds the slot", () => {
    expect(
      reportSlotPrecedence({
        selfBilled: true,
        occupantInvoiceNumber: "10058",
        incomingInvoiceNumber: null,
      }),
    ).toBe("skip");
  });

  it("leaves two invoices to the overwrite guard", () => {
    expect(
      reportSlotPrecedence({
        selfBilled: true,
        occupantInvoiceNumber: "10058",
        incomingInvoiceNumber: "10059",
      }),
    ).toBe("default");
  });

  it("does nothing before the self-billed cutover", () => {
    expect(
      reportSlotPrecedence({
        selfBilled: false,
        occupantInvoiceNumber: null,
        incomingInvoiceNumber: "10080",
      }),
    ).toBe("default");
  });
});
