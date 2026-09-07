import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import { createPeriodRowsQuery } from "@/data-access/franchisee-billing-screen-queries";
import * as schema from "@/db/schema";

describe("createPeriodRowsQuery discount-notice marker", () => {
  it("reads the last delivered notice from the email log, per billing row", () => {
    const { sql: text } = createPeriodRowsQuery(
      drizzle.mock({ schema }),
      { year: 2026, month: 8 },
      new Map(),
    ).toSQL();

    expect(text).toContain("email_log");
    expect(text).toContain("franchisee_billing_discount_notice");
    // Only a delivered one counts — a queued or failed send is not a notice.
    expect(text).toContain("'sent'");
  });
});

describe("formatNoticeSentAt", () => {
  it("reads the stamp as UTC and shows it in Israel time", async () => {
    const { formatNoticeSentAt } = await import(
      "@/components/franchisee-billing-discount-email"
    );

    // The real send: 09:16 UTC is 12:16 in Israel.
    expect(formatNoticeSentAt("2026-09-07T09:16:09Z")).toContain("12:16");
  });
});
