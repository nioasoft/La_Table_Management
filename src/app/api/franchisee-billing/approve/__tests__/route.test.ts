import { drizzle } from "drizzle-orm/node-postgres";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLockedApprovalRowsQuery,
  createPersistApprovalQuery,
  handleApproveFranchiseeBilling,
  type ApprovalBillingRow,
  type ApprovalEmailLog,
  type ApprovalEmailMessage,
  type ApprovalSourceReview,
  type ApprovalStore,
  type FranchiseeBillingApprovalOperations,
  type LedgerEntryInput,
  type PersistBillingApprovalInput,
  type RetryEmailContext,
} from "@/app/api/franchisee-billing/approve/route";
import * as schema from "@/db/schema";
import {
  canonicalStoredDecimal,
  type CanonicalApprovalCalculation,
} from "@/lib/franchisee-billing-approval";
import { calculateRoyalty } from "@/lib/royalty";
import type {
  FranchiseeBillingApproveInput,
  FranchiseeBillingApprovalInput,
  FranchiseeBillingRetryInput,
} from "@/schemas/franchisee-billing-approval";

const { requireSuperUser } = vi.hoisted(() => ({
  requireSuperUser: vi.fn(async () => ({
    session: { id: "session-1" },
    user: {
      id: "super-user-1",
      email: "super@example.com",
      name: "מנהלת על",
      role: "super_user",
      status: "active",
      isAdmin: true,
    },
  })),
}));

vi.mock("@/lib/api-middleware", () => ({
  requireSuperUser,
  isAuthError: vi.fn(() => false),
}));

const PERIOD = { year: 2026, month: 6 } as const;
function sourceReview(
  id: string,
  fileName: string,
): ApprovalSourceReview {
  return {
    id,
    fileName,
    metadata: {
      documentType: "franchisee_royalty_revenue",
      anomalies: [],
      approvedDifferences: [],
    },
  };
}

const SOURCE_BY_BRAND = new Map([
  ["brand-vini", sourceReview("source-vini", "ויני.xlsx")],
  ["brand-mina", sourceReview("source-mina", "מינה.xlsx")],
  ["brand-king-kong", sourceReview("source-king-kong", "קינג קונג.xlsx")],
]);

const SOURCE = sourceReview("source-vini", "ויני.xlsx");

function reviewedSource(
  source: ApprovalSourceReview,
  metadata: ApprovalSourceReview["metadata"],
): ApprovalSourceReview {
  return {
    ...source,
    metadata,
  };
}

interface CalculatedFixture {
  readonly row: ApprovalBillingRow;
  readonly calculated: CanonicalApprovalCalculation;
}

function calculatedFixture(
  id: string,
  franchiseeId: string,
  franchiseeName: string,
  ownerName: string,
  ownerEmail: string,
  discountRatePoints: number,
  brandId: string,
  sourceFileId: string,
): CalculatedFixture {
  const inputs = {
    receipts: 1180.123456,
    tips: 0,
    includeTips: false,
    tiers: [{ upTo: null, rate: 5 }],
    tierBasis: "gross" as const,
    marketingRate: 0.75,
    discountRatePoints,
    vat: 0.18,
  };
  const result = calculateRoyalty(inputs);
  const money = (value: number) => canonicalStoredDecimal(value, 6);
  const rate = (value: number) => canonicalStoredDecimal(value, 2);
  const calculated = {
    grossBase: money(result.grossBase),
    netBase: money(result.netBase),
    tierRate: rate(result.tierRate),
    effectiveRate: rate(result.effectiveRate),
    royaltyFull: money(result.royaltyFull),
    royalty: money(result.royalty),
    discountValue: money(result.discountValue),
    marketing: money(result.marketing),
    subtotal: money(result.subtotal),
    total: money(result.total),
  };
  return {
    calculated,
    row: {
      id,
      franchiseeId,
      franchiseeName,
      brandId,
      periodYear: PERIOD.year,
      periodMonth: PERIOD.month,
      receipts: money(inputs.receipts),
      tips: money(inputs.tips),
      includeTips: inputs.includeTips,
      discountRatePoints: rate(discountRatePoints),
      ...calculated,
      sourceFileId,
      status: "draft",
      royaltyTiers: [...inputs.tiers],
      royaltyTierBasis: inputs.tierBasis,
      royaltyTiersConfirmed: true,
      marketingFeeRate: rate(inputs.marketingRate),
      hashavshevetAccountKey: `account-${franchiseeId}`,
      owners: [{
        name: ownerName,
        phone: "",
        email: ownerEmail,
        ownershipPercentage: 100,
      }],
      tiersSnapshot: null,
      tierBasisSnapshot: null,
      marketingRateSnapshot: null,
      vatRateSnapshot: null,
      accountKeySnapshot: null,
    },
  };
}

class TransactionalApprovalHarness
  implements FranchiseeBillingApprovalOperations
{
  rows: ApprovalBillingRow[];
  ledger: LedgerEntryInput[] = [];
  approvals: PersistBillingApprovalInput[] = [];
  sent: ApprovalEmailMessage[] = [];
  logs: ApprovalEmailLog[] = [];
  sourcesByBrand: ReadonlyMap<string, ApprovalSourceReview> = SOURCE_BY_BRAND;
  failLedger = false;
  failingEmails = new Set<string>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(readonly fixtures = [
    calculatedFixture(
      "billing-1",
      "franchisee-1",
      "ויני יהוד",
      "דנה",
      "Dana@Example.com",
      1,
      "brand-vini",
      "source-vini",
    ),
    calculatedFixture(
      "billing-2",
      "franchisee-2",
      "מינה קריות",
      "יואב",
      "yoav@example.com",
      1,
      "brand-mina",
      "source-mina",
    ),
    calculatedFixture(
      "billing-3",
      "franchisee-3",
      "קינג עפולה",
      "נועה",
      "noa@example.com",
      0,
      "brand-king-kong",
      "source-king-kong",
    ),
  ]) {
    this.rows = fixtures.map(({ row }) => ({ ...row }));
  }

  async withTransaction<T>(
    work: (store: ApprovalStore) => Promise<T>,
  ): Promise<T> {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => gate);
    await previous;
    const stagedRows = this.rows.map((row) => ({ ...row }));
    const stagedLedger = [...this.ledger];
    const stagedApprovals = [...this.approvals];
    const store = this.transactionStore(
      stagedRows,
      stagedLedger,
      stagedApprovals,
    );
    try {
      const result = await work(store);
      this.rows = stagedRows;
      this.ledger = stagedLedger;
      this.approvals = stagedApprovals;
      return result;
    } finally {
      release();
    }
  }

  private transactionStore(
    rows: ApprovalBillingRow[],
    ledger: LedgerEntryInput[],
    approvals: PersistBillingApprovalInput[],
  ): ApprovalStore {
    return {
      loadRowsForUpdate: async () => rows,
      loadLatestSources: async () => this.sourcesByBrand,
      loadVatRate: async () => "0.1800",
      persistApproval: async (input) => {
        const index = rows.findIndex((row) => row.id === input.billingId);
        if (index < 0 || rows[index]?.status !== "draft") return false;
        const current = rows[index];
        if (!current) return false;
        rows[index] = {
          ...current,
          status: "approved",
          tiersSnapshot: input.tiersSnapshot,
          tierBasisSnapshot: input.tierBasisSnapshot,
          marketingRateSnapshot: input.marketingRateSnapshot,
          vatRateSnapshot: input.vatRateSnapshot,
          accountKeySnapshot: input.accountKeySnapshot,
        };
        approvals.push(input);
        return true;
      },
      insertLedger: async (entries) => {
        if (this.failLedger) throw new Error("ledger unavailable");
        ledger.push(...entries);
      },
    };
  }

  async loadRetryContext(
    input: FranchiseeBillingRetryInput,
  ): Promise<RetryEmailContext> {
    const ids = new Set(input.failures.map((failure) => failure.billingId));
    return {
      rows: this.rows.filter((row) => ids.has(row.id)),
      logs: this.logs,
    };
  }

  async sendEmail(
    message: ApprovalEmailMessage,
  ): Promise<{ readonly success: boolean; readonly error?: string }> {
    if (this.failingEmails.has(normalizeEmail(message.to))) {
      this.logs.unshift({
        entityId: message.billingId,
        toEmail: message.to,
        status: "failed",
        metadata: { messageKind: "franchisee_billing_approval" },
      });
      return { success: false, error: "provider rejected" };
    }
    this.sent.push(message);
    this.logs.unshift({
      entityId: message.billingId,
      toEmail: message.to,
      status: "sent",
      metadata: { messageKind: "franchisee_billing_approval" },
    });
    return { success: true };
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function approvalBody(): FranchiseeBillingApproveInput {
  return {
    action: "approve",
    periodYear: PERIOD.year,
    periodMonth: PERIOD.month,
    recipients: [
      { franchiseeId: "franchisee-1", emails: ["dana@example.com"] },
      { franchiseeId: "franchisee-2", emails: ["yoav@example.com"] },
      { franchiseeId: "franchisee-3", emails: ["noa@example.com"] },
    ],
  };
}

function postRequest(body: FranchiseeBillingApprovalInput): NextRequest {
  return new NextRequest(
    "http://localhost/api/franchisee-billing/approve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/franchisee-billing/approve", () => {
  beforeEach(() => requireSuperUser.mockClear());

  it("approves three brands with three live files and no stale rows", async () => {
    const operations = new TransactionalApprovalHarness();

    const response = await handleApproveFranchiseeBilling(
      postRequest(approvalBody()),
      operations,
    );

    expect(response.status).toBe(200);
    expect(operations.ledger.map((entry) => entry.amount)).toEqual(
      operations.fixtures
        .filter(({ calculated }) => Number(calculated.discountValue) > 0)
        .map(({ calculated }) => calculated.discountValue),
    );
    expect(operations.sent.map(({ billingId }) => billingId)).toEqual([
      "billing-1",
      "billing-2",
    ]);
    expect(operations.approvals[0]).toMatchObject({
      tiersSnapshot: [{ upTo: null, rate: 5 }],
      tierBasisSnapshot: "gross",
      marketingRateSnapshot: "0.75",
      vatRateSnapshot: "0.1800",
      accountKeySnapshot: "account-franchisee-1",
      approvedBy: "super-user-1",
    });
    const calculatedBalance = operations.fixtures.reduce(
      (balance, { calculated }) => balance + Number(calculated.discountValue),
      0,
    );
    const ledgerBalance = operations.ledger.reduce(
      (balance, entry) => balance + Number(entry.amount),
      0,
    );
    expect(ledgerBalance).toBe(calculatedBalance);
  });

  it("approves two brands when each row points to its own live file", async () => {
    const allFixtures = new TransactionalApprovalHarness().fixtures;
    const operations = new TransactionalApprovalHarness(allFixtures.slice(0, 2));
    const input = approvalBody();

    const response = await handleApproveFranchiseeBilling(
      postRequest({ ...input, recipients: input.recipients.slice(0, 2) }),
      operations,
    );

    expect(response.status).toBe(200);
    expect(operations.approvals).toHaveLength(2);
  });

  it("blocks only an old row from the re-uploaded brand", async () => {
    const operations = new TransactionalApprovalHarness();
    const first = operations.rows[0];
    if (!first) throw new Error("Missing fixture");
    operations.rows[0] = { ...first, sourceFileId: "source-vini-old" };

    const response = await handleApproveFranchiseeBilling(
      postRequest(approvalBody()),
      operations,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      error: expect.stringMatching(/ויני יהוד/u),
    });
    expect(JSON.stringify(body)).not.toMatch(/מינה קריות|קינג עפולה/u);
    expect(operations.approvals).toHaveLength(0);
  });

  it("blocks a stored financial mismatch and names the field and difference", async () => {
    const operations = new TransactionalApprovalHarness();
    const first = operations.rows[0];
    if (!first) throw new Error("Missing fixture");
    operations.rows[0] = { ...first, discountValue: first.royaltyFull };

    const response = await handleApproveFranchiseeBilling(
      postRequest(approvalBody()),
      operations,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      error: expect.stringMatching(/discountValue.*פער/u),
    });
    expect(operations.approvals).toHaveLength(0);
    expect(operations.ledger).toHaveLength(0);
  });

  it("rejects an email that is not owned by the requested franchisee", async () => {
    const operations = new TransactionalApprovalHarness();
    const input = approvalBody();
    const response = await handleApproveFranchiseeBilling(
      postRequest({
        ...input,
        recipients: input.recipients.map((recipient) =>
          recipient.franchiseeId === "franchisee-1"
            ? { ...recipient, emails: ["attacker@example.com"] }
            : recipient),
      }),
      operations,
    );

    expect(response.status).toBe(409);
    expect(operations.approvals).toHaveLength(0);
    expect(operations.ledger).toHaveLength(0);
    expect(operations.sent).toHaveLength(0);
  });

  it.each([
    {
      name: "blocking anomaly",
      mutate: (operations: TransactionalApprovalHarness) => {
        operations.sourcesByBrand = new Map([
          ...operations.sourcesByBrand,
          ["brand-vini", reviewedSource(SOURCE, {
            documentType: "franchisee_royalty_revenue",
            anomalies: [{
              code: "missing",
              rowIndex: 1,
              branchName: "יהוד",
              message: "חסר זכיין",
            }],
            approvedDifferences: [],
          })],
        ]);
      },
      error: /חריגות חוסמות/u,
    },
    {
      name: "unresolved approved difference",
      mutate: (operations: TransactionalApprovalHarness) => {
        operations.sourcesByBrand = new Map([
          ...operations.sourcesByBrand,
          ["brand-vini", reviewedSource(SOURCE, {
            documentType: "franchisee_royalty_revenue",
            anomalies: [],
            approvedDifferences: [{
              franchiseeId: "franchisee-1",
              status: "approved",
              differences: [{
                field: "receipts",
                approvedValue: 1,
                uploadedValue: 2,
              }],
            }],
          })],
        ]);
      },
      error: /פערים שטרם נפתרו/u,
    },
  ])("returns 409 without writes for $name", async ({ mutate, error }) => {
    const operations = new TransactionalApprovalHarness();
    mutate(operations);

    const response = await handleApproveFranchiseeBilling(
      postRequest(approvalBody()),
      operations,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false, error: expect.stringMatching(error) });
    expect(operations.approvals).toHaveLength(0);
    expect(operations.ledger).toHaveLength(0);
  });

  it("serializes two parallel approvals without duplicate ledger or email", async () => {
    const operations = new TransactionalApprovalHarness();

    const [first, second] = await Promise.all([
      handleApproveFranchiseeBilling(postRequest(approvalBody()), operations),
      handleApproveFranchiseeBilling(postRequest(approvalBody()), operations),
    ]);
    const bodies = await Promise.all([first.json(), second.json()]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ alreadyApproved: false }) }),
      expect.objectContaining({ data: expect.objectContaining({ alreadyApproved: true }) }),
    ]));
    expect(operations.ledger).toHaveLength(2);
    expect(operations.sent).toHaveLength(2);
  });

  it("rolls back every approval and ledger row when ledger insertion fails", async () => {
    const operations = new TransactionalApprovalHarness();
    operations.failLedger = true;

    const response = await handleApproveFranchiseeBilling(
      postRequest(approvalBody()),
      operations,
    );

    expect(response.status).toBe(500);
    expect(operations.rows.every((row) => row.status === "draft")).toBe(true);
    expect(operations.approvals).toHaveLength(0);
    expect(operations.ledger).toHaveLength(0);
    expect(operations.sent).toHaveLength(0);
  });

  it("returns failed recipients and retries them without approval or ledger writes", async () => {
    const operations = new TransactionalApprovalHarness();
    operations.failingEmails.add("dana@example.com");

    const first = await handleApproveFranchiseeBilling(
      postRequest(approvalBody()),
      operations,
    );
    const firstBody = await first.json();
    const approvals = operations.approvals.length;
    const ledger = operations.ledger.length;
    operations.failingEmails.clear();
    const failures = firstBody.data.emailFailures.map(
      ({ billingId, franchiseeId, email }: {
        readonly billingId: string;
        readonly franchiseeId: string;
        readonly email: string;
      }) => ({ billingId, franchiseeId, email }),
    );
    const retry: FranchiseeBillingRetryInput = {
      action: "retry_failed",
      periodYear: PERIOD.year,
      periodMonth: PERIOD.month,
      failures,
    };
    const second = await handleApproveFranchiseeBilling(
      postRequest(retry),
      operations,
    );

    expect(first.status).toBe(207);
    expect(firstBody).toMatchObject({
      success: false,
      data: {
        approvalCommitted: true,
        emailFailures: [{
          billingId: "billing-1",
          email: "Dana@Example.com",
          error: "provider rejected",
        }],
      },
    });
    expect(second.status).toBe(200);
    expect(operations.approvals).toHaveLength(approvals);
    expect(operations.ledger).toHaveLength(ledger);
    expect(operations.sent).toContainEqual(
      expect.objectContaining({ billingId: "billing-1", to: "Dana@Example.com" }),
    );
  });
});

describe("approval SQL", () => {
  it("uses the exact locking query", () => {
    const database = drizzle.mock({ schema });
    const query = createLockedApprovalRowsQuery(database, PERIOD).toSQL();

    expect(query.sql).toBe(
      "select \"franchisee_billing\".\"id\", \"franchisee_billing\".\"franchisee_id\", \"franchisee\".\"name\", \"franchisee\".\"brand_id\", \"franchisee_billing\".\"period_year\", \"franchisee_billing\".\"period_month\", \"franchisee_billing\".\"receipts\", \"franchisee_billing\".\"tips\", \"franchisee_billing\".\"include_tips\", \"franchisee_billing\".\"gross_base\", \"franchisee_billing\".\"net_base\", \"franchisee_billing\".\"tier_rate\", \"franchisee_billing\".\"discount_rate_points\", \"franchisee_billing\".\"effective_rate\", \"franchisee_billing\".\"royalty_full\", \"franchisee_billing\".\"royalty\", \"franchisee_billing\".\"discount_value\", \"franchisee_billing\".\"marketing\", \"franchisee_billing\".\"subtotal\", \"franchisee_billing\".\"total\", \"franchisee_billing\".\"source_file_id\", \"franchisee_billing\".\"status\", \"franchisee\".\"royalty_tiers\", \"franchisee\".\"royalty_tier_basis\", \"franchisee\".\"royalty_tiers_confirmed\", \"franchisee\".\"marketing_fee_rate\", \"franchisee\".\"hashavshevet_account_key\", \"franchisee\".\"owners\", \"franchisee_billing\".\"tiers_snapshot\", \"franchisee_billing\".\"tier_basis_snapshot\", \"franchisee_billing\".\"marketing_rate_snapshot\", \"franchisee_billing\".\"vat_rate_snapshot\", \"franchisee_billing\".\"account_key_snapshot\" from \"franchisee_billing\" inner join \"franchisee\" on \"franchisee_billing\".\"franchisee_id\" = \"franchisee\".\"id\" where (\"franchisee_billing\".\"period_year\" = $1 and \"franchisee_billing\".\"period_month\" = $2) for update",
    );
    expect(query.params).toEqual([PERIOD.year, PERIOD.month]);
  });

  it("updates only a still-draft row with the exact snapshot SQL", () => {
    const database = drizzle.mock({ schema });
    const input: PersistBillingApprovalInput = {
      billingId: "billing-1",
      tiersSnapshot: [{ upTo: null, rate: 5 }],
      tierBasisSnapshot: "gross",
      marketingRateSnapshot: "0.75",
      vatRateSnapshot: "0.1800",
      accountKeySnapshot: "account-1",
      approvedAt: new Date(2026, 5, 30, 12),
      approvedBy: "user-1",
    };
    const query = createPersistApprovalQuery(database, input).toSQL();

    expect(query.sql).toBe(
      "update \"franchisee_billing\" set \"tiers_snapshot\" = $1, \"tier_basis_snapshot\" = $2, \"marketing_rate_snapshot\" = $3, \"vat_rate_snapshot\" = $4, \"account_key_snapshot\" = $5, \"status\" = $6, \"approved_at\" = $7, \"approved_by\" = $8 where (\"franchisee_billing\".\"id\" = $9 and \"franchisee_billing\".\"status\" = $10) returning \"id\"",
    );
    expect(query.params).toEqual([
      JSON.stringify(input.tiersSnapshot),
      input.tierBasisSnapshot,
      input.marketingRateSnapshot,
      input.vatRateSnapshot,
      input.accountKeySnapshot,
      "approved",
      "2026-06-30T09:00:00.000Z",
      input.approvedBy,
      input.billingId,
      "draft",
    ]);
  });
});
