/**
 * GET /api/cron/franchisee-alias-collision
 *
 * Layer 3 hardening — weekly cron that scans `franchisee.aliases` for
 * collisions where two different franchisees share an alias (after
 * normalization). Such overlaps are exactly the vector that produced
 * the 2026-05-10 Hatt-Netanzon → Vini-Azrieli misattribution: the
 * fuzzy matcher's bag-of-tokens pass scored multiple franchisees
 * equally, the tiebreaker picked the first-found, and the wrong one
 * silently won.
 *
 * Layer 1 raised the gate (matches now reject when alternatives are
 * within 0.05 of best). This cron prevents the situation from arising
 * in the first place by surfacing the overlap to a human BEFORE the
 * resolver hits it.
 *
 * Cron path: /api/cron/franchisee-alias-collision (registered in
 * vercel.json — Mondays 05:00).
 *
 * IMPORTANT: Vercel Cron sends GET, never POST.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { database } from "@/db";
import { franchisee, type Franchisee } from "@/db/schema";
import { normalizeName } from "@/lib/franchisee-matcher";
import { startCronLog } from "@/lib/cron-logger";
import { sendDirectEmail } from "@/lib/email/service";

interface Collision {
  alias: string;
  franchisees: Array<{ id: string; name: string }>;
}

function findCollisions(franchisees: Franchisee[]): Collision[] {
  // Bucket every (normalized alias) → list of franchisees holding it.
  // Includes the franchisee's primary name and code as implicit aliases —
  // the matcher treats them that way too.
  const bucket = new Map<
    string,
    { rawAlias: string; entries: Array<{ id: string; name: string }> }
  >();

  for (const f of franchisees) {
    if (!f.isActive) continue;
    const sources: string[] = [];
    if (f.name) sources.push(f.name);
    if (f.code) sources.push(f.code);
    for (const a of (f.aliases as string[] | null) ?? []) sources.push(a);

    // Dedup within a single franchisee — collisions only matter
    // ACROSS franchisees.
    const seenForThis = new Set<string>();
    for (const raw of sources) {
      const normalised = normalizeName(raw);
      if (!normalised || normalised.length < 3) continue;
      if (seenForThis.has(normalised)) continue;
      seenForThis.add(normalised);

      const existing = bucket.get(normalised);
      if (existing) {
        // Same alias already registered by another franchisee — record
        // the cross-franchisee duplicate (don't double-count the same
        // franchisee adding it twice via name/code/aliases).
        if (!existing.entries.some((e) => e.id === f.id)) {
          existing.entries.push({ id: f.id, name: f.name });
        }
      } else {
        bucket.set(normalised, {
          rawAlias: raw,
          entries: [{ id: f.id, name: f.name }],
        });
      }
    }
  }

  const collisions: Collision[] = [];
  for (const { rawAlias, entries } of bucket.values()) {
    if (entries.length >= 2) {
      collisions.push({ alias: rawAlias, franchisees: entries });
    }
  }
  // Most ambiguous (matched by most franchisees) first.
  collisions.sort((a, b) => b.franchisees.length - a.franchisees.length);
  return collisions;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(collisions: Collision[]): string {
  const rows = collisions
    .map(
      (c) => `
        <tr>
          <td style="padding:6px;border:1px solid #e5e7eb"><code>${escapeHtml(c.alias)}</code></td>
          <td style="padding:6px;border:1px solid #e5e7eb">${c.franchisees
            .map((f) => escapeHtml(f.name))
            .join(" + ")}</td>
        </tr>
      `,
    )
    .join("");

  return `<!doctype html>
<html dir="rtl" lang="he"><body style="font-family:Rubik,Arial,sans-serif;color:#111;max-width:900px;margin:0 auto;padding:16px">
  <h2>זיהוי חפיפת aliases של זכיינים</h2>
  <p style="color:#666">
    הזכיינים הבאים חולקים alias זהה לאחר normalization. זה הווקטור שגרם
    לתקלת Hatt-Netanzon ↔ Vini-Azrieli ב-10/5/2026 — fuzzy matcher
    ל-inbound emails עלול לבחור את הזכיין הלא-נכון כשהשם המופיע במייל
    תואם ל-alias המשותף. שקול לפצל את ה-alias או להוריד אותו מאחד
    הזכיינים.
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:0.9em" dir="rtl">
    <thead style="background:#f3f4f6">
      <tr>
        <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">Alias</th>
        <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">משותף בין</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#666;font-size:0.85em;margin-top:24px">
    דוח שבועי. עריכת aliases דרך /admin/franchisees.
  </p>
</body></html>`;
}

function getRecipients(): string[] {
  const fromEnv = process.env.ALERT_RECIPIENTS;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["asaf@giggsi.co.il"];
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const isManual = url.searchParams.get("source") === "manual";
  const skipEmail = url.searchParams.get("skip_email") === "true";

  const log = await startCronLog(
    "franchisee-alias-collision",
    isManual ? "manual" : "cron",
  );

  let emailsSent = 0;
  let emailsFailed = 0;

  try {
    const all = (await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, true))) as Franchisee[];

    const collisions = findCollisions(all);

    const shouldSend = collisions.length > 0 && !skipEmail;
    if (shouldSend) {
      const recipients = getRecipients();
      const subject = `[בדיקה שבועית] ${collisions.length} חפיפות aliases זוהו`;
      const html = renderHtml(collisions);
      const text = collisions
        .map(
          (c) =>
            `  ${c.alias}  →  ${c.franchisees.map((f) => f.name).join(" + ")}`,
        )
        .join("\n");
      for (const to of recipients) {
        const r = await sendDirectEmail({
          to,
          subject,
          html,
          text: `נמצאו ${collisions.length} חפיפות aliases:\n\n${text}\n`,
          entityType: "cron_alias_collision",
        });
        if (r.success) emailsSent++;
        else emailsFailed++;
      }
    }

    await log.complete({
      emailsSent,
      emailsFailed,
      totalProcessed: all.length,
      totalFailed: collisions.length,
      summary: {
        collisionCount: collisions.length,
        emailedRecipients: shouldSend ? getRecipients() : [],
      },
    });

    return NextResponse.json({
      ok: true,
      collisionCount: collisions.length,
      collisions,
      emailsSent,
      emailsFailed,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await log.complete({ totalFailed: 1 }, errorMessage);
    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: 500 },
    );
  }
}
