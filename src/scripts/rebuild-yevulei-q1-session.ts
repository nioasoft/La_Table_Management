/**
 * One-off: rebuild the stale יבולי גורמה Q1 2026 reconciliation session.
 *
 * The session (012bb53c) was created 2026-05-10, before ויני חדרה's BKMV year
 * data (2026-05-20) and the current supplier file (2026-06-04) existed, so its
 * comparison rows are frozen at franchisee_amount=0 / stale supplier amounts.
 * rebuildReconciliationSession archives it and creates a fresh run from current
 * data (supplier file + BKMV year table).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/rebuild-yevulei-q1-session.ts
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { rebuildReconciliationSession } from "@/data-access/reconciliation-v2";

const SOURCE_SESSION_ID = "012bb53c-51d5-425f-8791-041834db2322";
// Reut (super_user) — owner of the reconciliation workflow.
const USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";

async function main() {
  console.log(`Rebuilding session ${SOURCE_SESSION_ID}...`);
  const result = await rebuildReconciliationSession(SOURCE_SESSION_ID, USER_ID);
  if (!result) {
    console.error("Rebuild returned null");
    process.exit(1);
  }
  console.log("New session:", {
    id: result.id,
    runNumber: result.runNumber,
    parentSessionId: result.parentSessionId,
    totalFranchisees: result.totalFranchisees,
    totalSupplierAmount: result.totalSupplierAmount,
    totalFranchiseeAmount: result.totalFranchiseeAmount,
    totalDifference: result.totalDifference,
  });
  process.exit(0);
}

main().catch((err) => {
  console.error("Rebuild failed:", err);
  process.exit(1);
});
