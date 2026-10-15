import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import { AdminEscalationEmail } from "@/emails/admin-escalation";

describe("AdminEscalationEmail", () => {
  it("names the supplier and lists the contact person separately", async () => {
    const text = await render(
      AdminEscalationEmail({
        supplier_name: 'טרז פזוס שיווק בע"מ',
        contact_name: "אורלי",
        contact_email: "orly@example.com",
        period: "רבעון 3 2026",
        original_sent_date: "12.10.2026",
        reminders_sent: "2",
      }),
      { plainText: true }
    );

    expect(text).toContain('הספק טרז פזוס שיווק בע"מ לא העלה');
    expect(text).toContain("איש קשר: אורלי (orly@example.com)");
    expect(text).not.toContain("הספק אורלי");
  });
});
