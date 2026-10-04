export type OwnerNrmsBillingRecord = {
  statementId: number;
  propertyId: number;
  propertyTitle: string;
  closedAt: string;
  paidAt: string | null;
  statementStatus: string;
  amount: number;
  currency: string;
  method: string | null;
  tokenReference: string | null;
  provider: string | null;
  providerReference: string | null;
  paymentStatus: string | null;
  verifiedAt: string | null;
  reconciliation: "MANUAL" | "PROVIDER" | "NONE";
  reconciledBy: string | null;
  reconciliationReason: string | null;
};

type BillingStatementRow = {
  id: number;
  status: string;
  amount: unknown;
  currency: string;
  closedAt: Date;
  paidAt: Date | null;
  account: { property: { id: number; title: string } };
  tokens: {
    id: number;
    token: string;
    status: string;
    method: string | null;
    payment: {
      provider: string;
      providerRef: string;
      status: string;
      verifiedAt: Date | null;
    } | null;
  }[];
};

type ManualReconciliationAudit = {
  details: unknown;
  admin: { name: string | null; email: string } | null;
};

/** Build report-safe statement evidence without returning a bearer payment token. */
export function buildOwnerNrmsBillingRecords(
  statements: BillingStatementRow[],
  manualAudits: ManualReconciliationAudit[],
): OwnerNrmsBillingRecord[] {
  const manualByTokenId = new Map<number, { adminName: string | null; reason: string | null }>();
  for (const row of manualAudits) {
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details)
      ? row.details as Record<string, unknown>
      : null;
    const tokenId = Number(details?.tokenId);
    if (!Number.isFinite(tokenId) || manualByTokenId.has(tokenId)) continue;
    manualByTokenId.set(tokenId, {
      adminName: row.admin?.name ?? row.admin?.email ?? null,
      reason: typeof details?.reason === "string" ? details.reason : null,
    });
  }

  return statements.map((statement) => {
    const token = statement.tokens.find(row => row.payment?.status === "MANUALLY_VERIFIED")
      ?? statement.tokens.find(row => row.payment?.status === "VERIFIED")
      ?? statement.tokens.find(row => ["PENDING", "PROCESSING", "PAID"].includes(row.status))
      ?? statement.tokens[0]
      ?? null;
    const manual = token ? manualByTokenId.get(token.id) : null;
    const reconciliation = token?.payment?.status === "MANUALLY_VERIFIED"
      ? "MANUAL" as const
      : token?.payment?.status === "VERIFIED"
        ? "PROVIDER" as const
        : "NONE" as const;

    return {
      statementId: statement.id,
      propertyId: statement.account.property.id,
      propertyTitle: statement.account.property.title,
      closedAt: statement.closedAt.toISOString(),
      paidAt: statement.paidAt?.toISOString() ?? null,
      statementStatus: statement.status,
      amount: Number(statement.amount),
      currency: statement.currency,
      method: token?.method ?? null,
      tokenReference: token ? `#${token.id} · …${token.token.slice(-6)}` : null,
      provider: token?.payment?.provider ?? null,
      providerReference: token?.payment?.providerRef ?? null,
      paymentStatus: token?.payment?.status ?? null,
      verifiedAt: token?.payment?.verifiedAt?.toISOString() ?? null,
      reconciliation,
      reconciledBy: manual?.adminName ?? null,
      reconciliationReason: manual?.reason ?? null,
    };
  });
}
