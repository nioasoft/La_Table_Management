/**
 * One-off: refresh the signature/brand footer stored inside every
 * `email_template.body_html` row so live emails carry the group's new name.
 *
 * Why this exists: sendEmailWithTemplateData() renders `template.bodyHtml`
 * straight from the database, NOT the React component in src/emails. Renaming
 * the component alone never reaches a recipient. A `seed-email-templates
 * --force` would fix the signature but also discard the hand edits several of
 * these rows carry (a removed heading prefix, a custom closing note), so this
 * script rewrites the footer region only and leaves the body untouched.
 *
 * The footer region is everything from the <hr> that precedes the signature
 * name to the end of the document. A trailing note that is not the standard
 * auto-reply notice is carried over verbatim.
 *
 *   npx dotenv -e .env -- npx tsx src/scripts/rebrand-email-template-signatures.ts          # dry run
 *   npx dotenv -e .env -- npx tsx src/scripts/rebrand-email-template-signatures.ts --apply
 */
import "dotenv/config";
import { database } from "../db";
import { emailTemplate } from "../db/schema";
import { eq } from "drizzle-orm";
import { emailTranslations } from "../lib/translations/emails";
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const SIG = emailTranslations.signature;
const BASE_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';
const AUTO_NOTICE = emailTranslations.layout.autoEmailNotice;

/** Names any stored footer may currently use for the signer / group. */
const OLD_NAMES = ["רעות לוי", "רעות"];
const OLD_COMPANY = ["קבוצת LA TABLE", "minna tōmei group®"];

function buildFooter(trailingNote: string): string {
  const width = Math.floor(100 / SIG.brands.length);
  const cells = SIG.brands
    .map(
      (b) =>
        `<td style="width: ${width}%; text-align: center;"><p style="color: ${b.color}; font-size: 12px; font-weight: 700; font-style: ${b.italic ? "italic" : "normal"}; margin: 0; letter-spacing: 1px;">${b.name}</p></td>`
    )
    .join("\n        ");

  return `
    <hr style="border: none; border-top: 1px solid #e6ebf1; margin: 30px 0 20px;" />
    <div style="text-align: right; padding: 0 20px;">
      <p style="color: #333333; font-size: 16px; font-weight: 700; margin: 0 0 2px; text-align: right; font-family: ${BASE_FONT};">${SIG.name}</p>
      <p style="color: #333333; font-size: 14px; font-weight: 600; margin: 0 0 8px; text-align: right; letter-spacing: 1px; font-family: ${BASE_FONT};">${SIG.company}</p>
      <p style="color: #666666; font-size: 12px; margin: 0 0 2px; text-align: right; font-family: ${BASE_FONT};">${SIG.address}</p>
      <p style="color: #666666; font-size: 12px; margin: 0; text-align: right; direction: ltr; font-family: ${BASE_FONT};">${SIG.phone}</p>
    </div>
    <hr style="border: none; border-top: 1px solid #e6ebf1; margin: 16px 0;" />
    <table style="width: 100%; text-align: center; padding: 0 20px;" cellpadding="0" cellspacing="0">
      <tr>
        ${cells}
      </tr>
    </table>
    <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 16px 0 8px;" />
    <p style="color: #8898aa; font-size: 11px; line-height: 16px; margin: 4px 0; text-align: center; font-family: ${BASE_FONT};">${trailingNote}</p>`;
}

/**
 * Literal renames applied to the body ABOVE the footer. Some stored rows are
 * stale snapshots of components that have since changed (admin_escalation still
 * carries a "מערכת La Table Management" line the component no longer renders),
 * so the footer rewrite alone does not reach them.
 */
const BODY_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["מערכת La Table Management", "מערכת minna tōmei group"],
  ["קבוצת LA TABLE", "minna tōmei group®"],
  ["קבוצת לה טייבל", "מינה טומאי גרופ"],
  ["La Table Management", "minna tōmei group"],
];

function renameInBody(body: string): string {
  return BODY_RENAMES.reduce((acc, [from, to]) => acc.split(from).join(to), body);
}

/** Index of the <hr> that opens the signature footer, or -1. */
function findFooterStart(html: string): number {
  for (const company of OLD_COMPANY) {
    const c = html.indexOf(company);
    if (c === -1) continue;
    // Walk back past the signature name to the <hr> that opens the block.
    const hr = html.lastIndexOf("<hr", c);
    return hr;
  }
  return -1;
}

/** The last visible paragraph of the footer, so a custom note survives. */
function extractTrailingNote(footer: string): string {
  const paragraphs = [...footer.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((m) =>
    m[1].trim()
  );
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const isBrandOrSignature =
    !last ||
    SIG.brands.some((b) => last === b.name) ||
    last === "NATANZON" ||
    last === "minna tomei" ||
    OLD_NAMES.includes(last) ||
    OLD_COMPANY.includes(last) ||
    last.includes("שדרות משה גושן") ||
    last.includes("04-875");
  return isBrandOrSignature ? AUTO_NOTICE : last;
}

const rows = await database.select().from(emailTemplate);
let changed = 0;

// Snapshot every row before touching production, so a bad rewrite is a
// paste-back rather than a restore from the nightly dump.
if (APPLY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `email-template-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`Backup written: ${file}\n`);
}

for (const row of rows) {
  const start = findFooterStart(row.bodyHtml);
  if (start === -1) {
    console.log(`⏭  ${row.code} — no signature footer found, left alone`);
    continue;
  }

  const note = extractTrailingNote(row.bodyHtml.slice(start));
  // trimEnd so re-running does not keep appending the footer's leading indent.
  const next =
    renameInBody(row.bodyHtml.slice(0, start)).trimEnd() + buildFooter(note);

  if (next === row.bodyHtml) {
    console.log(`=  ${row.code} — already current`);
    continue;
  }

  changed++;
  const strip = (h: string) =>
    h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log(`\n${APPLY ? "🔄" : "○ "} ${row.code}`);
  console.log(`   note kept : ${note}`);
  console.log(`   before    : …${strip(row.bodyHtml.slice(start)).slice(0, 150)}`);
  console.log(`   after     : …${strip(buildFooter(note)).slice(0, 150)}`);
  console.log(`   body above the footer: unchanged (${start} chars)`);

  if (APPLY) {
    await database
      .update(emailTemplate)
      .set({ bodyHtml: next, updatedAt: new Date() })
      .where(eq(emailTemplate.id, row.id));
  }
}

console.log(
  `\n${APPLY ? "Applied" : "Dry run"} — ${changed}/${rows.length} template(s) ${APPLY ? "updated" : "would change"}.`
);
if (!APPLY && changed > 0) console.log("Re-run with --apply to write.");
process.exit(0);
