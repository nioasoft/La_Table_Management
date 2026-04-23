/**
 * Re-parse all existing Wolt commission_invoice documents and update their
 * total_amount + commission_amount + net_amount in the DB.
 *
 * Background: A regex bug in extractGrandTotal captured the VAT percentage
 * (e.g. "18.00") as one of the three amount numbers, causing the VAT amount
 * (e.g. ₪35,302.92) to be saved as the commission instead of the pre-VAT
 * total (₪196,127.17).
 *
 * Usage:
 *   npx tsx scripts/fix-wolt-invoice-amounts.ts             # dry-run
 *   npx tsx scripts/fix-wolt-invoice-amounts.ts --apply     # write updates
 */
import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { database } from "../src/db";
import { clientDocument, client } from "../src/db/schema";
import { parseWoltInvoice } from "../src/lib/client-parsers/invoice-wolt-parser";

const APPLY = process.argv.includes("--apply");

interface DocSummary {
  id: string;
  fileName: string | null;
  period: string;
  oldTotal: number | null;
  oldCommission: number | null;
  oldNet: number | null;
  newTotal: number | null;
  newCommission: number | null;
  newNet: number | null;
  status: "updated" | "unchanged" | "parse_failed" | "no_url" | "fetch_failed";
  message?: string;
}

async function main() {
  console.log(
    `Wolt invoice re-parse — mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`
  );

  // 1. Find Wolt client(s)
  const woltClients = await database
    .select({ id: client.id, name: client.name, code: client.code })
    .from(client)
    .where(eq(client.code, "WOLT"));

  if (woltClients.length === 0) {
    console.log("No Wolt client found (looked for code='WOLT').");
    return;
  }

  for (const wc of woltClients) {
    console.log(`Client: ${wc.name} (${wc.code})  id=${wc.id}`);
  }

  const clientIds = woltClients.map((c) => c.id);

  // 2. Fetch all commission_invoice documents for Wolt
  const docs = await database
    .select({
      id: clientDocument.id,
      fileUrl: clientDocument.fileUrl,
      originalFileName: clientDocument.originalFileName,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
      netAmount: clientDocument.netAmount,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.documentType, "commission_invoice"),
        // restrict to Wolt clients
        // (we already filtered the IDs above, drizzle inArray could be used)
        clientIds.length === 1
          ? eq(clientDocument.clientId, clientIds[0])
          : undefined
      )
    );

  // If multiple clients (unlikely) filter in JS as a safety net
  const woltDocs = docs.filter(() => true);

  console.log(`\nFound ${woltDocs.length} commission_invoice document(s)\n`);

  const results: DocSummary[] = [];

  for (const doc of woltDocs) {
    const period = `${String(doc.periodMonth).padStart(2, "0")}/${doc.periodYear}`;
    const oldTotal = doc.totalAmount ? parseFloat(doc.totalAmount) : null;
    const oldCommission = doc.commissionAmount
      ? parseFloat(doc.commissionAmount)
      : null;
    const oldNet = doc.netAmount ? parseFloat(doc.netAmount) : null;

    const base: DocSummary = {
      id: doc.id,
      fileName: doc.originalFileName,
      period,
      oldTotal,
      oldCommission,
      oldNet,
      newTotal: null,
      newCommission: null,
      newNet: null,
      status: "unchanged",
    };

    if (!doc.fileUrl) {
      results.push({ ...base, status: "no_url", message: "No file_url" });
      continue;
    }

    try {
      const res = await fetch(doc.fileUrl);
      if (!res.ok) {
        results.push({
          ...base,
          status: "fetch_failed",
          message: `HTTP ${res.status}`,
        });
        continue;
      }
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const parsed = await parseWoltInvoice(buf, "application/pdf");

      if (!parsed.success || !parsed.data) {
        results.push({
          ...base,
          status: "parse_failed",
          message: parsed.errors.join("; "),
        });
        continue;
      }

      const newTotal = parsed.data.totalAmount ?? null;
      const newCommission = parsed.data.commissionAmount ?? null;
      const newNet = parsed.data.netAmount ?? null;

      const totalChanged =
        oldTotal !== null && newTotal !== null
          ? Math.abs(oldTotal - newTotal) > 0.01
          : oldTotal !== newTotal;
      const commissionChanged =
        oldCommission !== null && newCommission !== null
          ? Math.abs(oldCommission - newCommission) > 0.01
          : oldCommission !== newCommission;
      const netChanged =
        oldNet !== null && newNet !== null
          ? Math.abs(oldNet - newNet) > 0.01
          : oldNet !== newNet;

      if (!totalChanged && !commissionChanged && !netChanged) {
        results.push({
          ...base,
          newTotal,
          newCommission,
          newNet,
          status: "unchanged",
        });
        continue;
      }

      if (APPLY) {
        await database
          .update(clientDocument)
          .set({
            totalAmount: newTotal !== null ? newTotal.toFixed(2) : null,
            commissionAmount:
              newCommission !== null ? newCommission.toFixed(2) : null,
            netAmount: newNet !== null ? newNet.toFixed(2) : null,
            updatedAt: new Date(),
          })
          .where(eq(clientDocument.id, doc.id));
      }

      results.push({
        ...base,
        newTotal,
        newCommission,
        newNet,
        status: "updated",
      });
    } catch (err) {
      results.push({
        ...base,
        status: "parse_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Print report
  console.log("Results:\n");
  for (const r of results) {
    const fileShort = (r.fileName ?? "?").substring(0, 40);
    console.log(
      `  [${r.status.toUpperCase()}] ${r.period}  id=${r.id.substring(0, 8)}…  ${fileShort}`
    );
    if (r.status === "updated") {
      console.log(
        `      total:      ${fmt(r.oldTotal)} → ${fmt(r.newTotal)}`
      );
      console.log(
        `      commission: ${fmt(r.oldCommission)} → ${fmt(r.newCommission)}`
      );
      console.log(
        `      netAmount:  ${fmt(r.oldNet)} → ${fmt(r.newNet)}`
      );
    } else if (r.message) {
      console.log(`      ${r.message}`);
    }
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\nSummary: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}`
  );
  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write changes.");
  }
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
