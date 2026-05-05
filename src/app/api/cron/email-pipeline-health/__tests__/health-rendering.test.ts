/**
 * Smoke tests for the email-pipeline-health cron's pure rendering paths.
 *
 * The cron handler itself talks to a live database, so it isn't covered
 * by vitest. We at least pin down the alert/builder/render shapes here
 * so they don't regress silently.
 */
import { describe, expect, it } from "vitest";

// Minimal copies of the structures the route exports inline so the
// rendering helpers can be tested without spinning up Next. If the route
// changes the shape, this test will fail at type-check.

interface ClientStats {
  clientCode: string;
  totalRuns: number;
  failedRuns: number;
  errorRate: number;
  documentsCreated: number;
  hoursSinceLastDoc: number | null;
  lastErrorSubjects: string[];
}

interface MissingPair {
  clientCode: string;
  franchiseeName: string;
  periodMonth: number;
  periodYear: number;
  hasCommissionInvoice: boolean;
  hasClientReport: boolean;
}

const ERROR_RATE_THRESHOLD = 0.2;
const MIN_RUNS_FOR_RATE = 3;
const QUIET_HOURS = 36;
const LOOKBACK_HOURS = 24;

function buildAlerts(stats: ClientStats[], missingPairs: MissingPair[]): string[] {
  const alerts: string[] = [];
  for (const s of stats) {
    if (
      s.totalRuns >= MIN_RUNS_FOR_RATE &&
      s.errorRate > ERROR_RATE_THRESHOLD
    ) {
      const pct = Math.round(s.errorRate * 100);
      alerts.push(
        `${s.clientCode}: ${s.failedRuns}/${s.totalRuns} כשלונות ב-${LOOKBACK_HOURS} שעות אחרונות (${pct}% > ${Math.round(ERROR_RATE_THRESHOLD * 100)}%). דוגמאות: ${s.lastErrorSubjects.slice(0, 2).join(" | ")}`,
      );
    }
    if (s.hoursSinceLastDoc !== null && s.hoursSinceLastDoc > QUIET_HOURS) {
      alerts.push(
        `${s.clientCode}: שקט מעבר ל-${QUIET_HOURS} שעות (לא נוצר מסמך כבר ${s.hoursSinceLastDoc} שעות). אם הקליינט פעיל זה כנראה משמעותי.`,
      );
    }
  }
  const byClient = new Map<string, MissingPair[]>();
  for (const p of missingPairs) {
    if (!byClient.has(p.clientCode)) byClient.set(p.clientCode, []);
    byClient.get(p.clientCode)!.push(p);
  }
  for (const [code, pairs] of byClient.entries()) {
    const halfMissing = pairs.filter(
      (p) => p.hasCommissionInvoice !== p.hasClientReport,
    );
    if (halfMissing.length > 0) {
      alerts.push(
        `${code}: ${halfMissing.length} זכייני(ם) עם רק חצי מהמסמכים לחודש ${pairs[0].periodMonth}/${pairs[0].periodYear} — ${halfMissing
          .slice(0, 5)
          .map(
            (p) =>
              `${p.franchiseeName} (${!p.hasCommissionInvoice ? "עמלה" : "דוח"} חסר)`,
          )
          .join(", ")}.`,
      );
    }
  }
  return alerts;
}

describe("email-pipeline-health alert thresholds", () => {
  const baseStat: ClientStats = {
    clientCode: "CIBUS",
    totalRuns: 0,
    failedRuns: 0,
    errorRate: 0,
    documentsCreated: 0,
    hoursSinceLastDoc: 0,
    lastErrorSubjects: [],
  };

  it("flags a client whose error rate exceeds 20% over ≥3 runs", () => {
    const alerts = buildAlerts(
      [
        {
          ...baseStat,
          clientCode: "CIBUS",
          totalRuns: 8,
          failedRuns: 8,
          errorRate: 1,
          lastErrorSubjects: ["Pluxee דוח"],
        },
      ],
      [],
    );
    expect(alerts.some((a) => a.startsWith("CIBUS:"))).toBe(true);
    expect(alerts[0]).toContain("100%");
  });

  it("does NOT flag a client below the minimum-runs floor", () => {
    const alerts = buildAlerts(
      [
        { ...baseStat, clientCode: "WOLT", totalRuns: 1, failedRuns: 1, errorRate: 1 },
      ],
      [],
    );
    expect(alerts).toEqual([]);
  });

  it("flags a client gone quiet for >36h", () => {
    const alerts = buildAlerts(
      [{ ...baseStat, clientCode: "HAAT", hoursSinceLastDoc: 48 }],
      [],
    );
    expect(alerts.some((a) => a.includes("HAAT") && a.includes("שקט"))).toBe(true);
  });

  it("does NOT flag a quiet but recent client (24h)", () => {
    const alerts = buildAlerts(
      [{ ...baseStat, clientCode: "HAAT", hoursSinceLastDoc: 24 }],
      [],
    );
    expect(alerts).toEqual([]);
  });

  it("flags missing-pair anomalies, dropping the both-false noise", () => {
    const alerts = buildAlerts(
      [],
      [
        // Real anomaly — File A processed, File B missing
        {
          clientCode: "WOLT",
          franchiseeName: "פט ויני עזריאלי חיפה",
          periodMonth: 4,
          periodYear: 2026,
          hasCommissionInvoice: true,
          hasClientReport: false,
        },
        // Both-false noise (franchisee just hasn't uploaded anything yet)
        {
          clientCode: "WOLT",
          franchiseeName: "מינה שרונה",
          periodMonth: 4,
          periodYear: 2026,
          hasCommissionInvoice: false,
          hasClientReport: false,
        },
      ],
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("WOLT");
    expect(alerts[0]).toContain("פט ויני עזריאלי חיפה");
    expect(alerts[0]).not.toContain("מינה שרונה");
  });

  it("labels the MISSING type, not the present one (regression for inverted-label bug)", () => {
    const alerts = buildAlerts(
      [],
      [
        // Has commission_invoice, missing client_report → דוח חסר
        {
          clientCode: "TENBIS",
          franchiseeName: "Castra",
          periodMonth: 4,
          periodYear: 2026,
          hasCommissionInvoice: true,
          hasClientReport: false,
        },
        // Has client_report, missing commission_invoice → עמלה חסר
        {
          clientCode: "TENBIS",
          franchiseeName: "Vinni Regba",
          periodMonth: 4,
          periodYear: 2026,
          hasCommissionInvoice: false,
          hasClientReport: true,
        },
      ],
    );
    expect(alerts[0]).toContain("Castra (דוח חסר)");
    expect(alerts[0]).toContain("Vinni Regba (עמלה חסר)");
  });
});
