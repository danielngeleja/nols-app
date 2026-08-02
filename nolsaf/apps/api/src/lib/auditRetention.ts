export const AUDIT_RETENTION_DAYS = {
  OTP: 30,
  TECHNICAL: 90,
  SECURITY: 730,
  OPERATIONAL: 730,
  FINANCIAL: 2555,
  COMPLIANCE: 2555,
} as const;

export const LEGAL_HOLD_RELEASE_GRACE_DAYS = 30;

export type AuditRetentionClass = keyof typeof AUDIT_RETENTION_DAYS;

const OTP_PATTERN = /OTP/;
const COMPLIANCE_PATTERN = /KYC|AML|COMPLIANCE/;
const FINANCIAL_PATTERN = /PAYMENT|INVOICE|PAYOUT|REFUND|REVENUE|COMMISSION|LEDGER|RECEIPT|DISBURSEMENT|FX/;
const TECHNICAL_PATTERN = /CLIENT_ERROR|API_ERROR|HEALTH|OBSERVABILITY|DIAGNOSTIC/;
const SECURITY_PATTERN = /LOGIN|LOGOUT|AUTH|SESSION|PASSWORD|2FA|SECURITY|ACCESS|IMPERSONAT/;

export function classifyAuditRetention(action: string, entity = ""): AuditRetentionClass {
  const value = `${String(action || "")} ${String(entity || "")}`.toUpperCase();
  if (OTP_PATTERN.test(value)) return "OTP";
  if (COMPLIANCE_PATTERN.test(value)) return "COMPLIANCE";
  if (FINANCIAL_PATTERN.test(value)) return "FINANCIAL";
  if (TECHNICAL_PATTERN.test(value)) return "TECHNICAL";
  if (SECURITY_PATTERN.test(value)) return "SECURITY";
  return "OPERATIONAL";
}

export function retentionClassForActionCenter(category: string): AuditRetentionClass {
  return ["PAYMENTS", "CANCELLATIONS"].includes(String(category || "").toUpperCase())
    ? "FINANCIAL"
    : "OPERATIONAL";
}

export function retentionExpiresAt(retentionClass: AuditRetentionClass, createdAt = new Date()): Date {
  const expiresAt = new Date(createdAt);
  if (retentionClass === "FINANCIAL" || retentionClass === "COMPLIANCE") {
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 7);
    return expiresAt;
  }
  if (retentionClass === "SECURITY" || retentionClass === "OPERATIONAL") {
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 2);
    return expiresAt;
  }
  expiresAt.setUTCDate(expiresAt.getUTCDate() + AUDIT_RETENTION_DAYS[retentionClass]);
  return expiresAt;
}

export function retentionFields(retentionClass: AuditRetentionClass, createdAt = new Date()) {
  return {
    retentionClass,
    expiresAt: retentionExpiresAt(retentionClass, createdAt),
  };
}

export function auditRetentionFields(action: string, entity = "", createdAt = new Date()) {
  return retentionFields(classifyAuditRetention(action, entity), createdAt);
}

export function legalHoldReleaseExpiresAt(
  currentExpiresAt: Date | string | null | undefined,
  releasedAt = new Date()
): Date {
  const minimumExpiry = new Date(releasedAt);
  minimumExpiry.setUTCDate(minimumExpiry.getUTCDate() + LEGAL_HOLD_RELEASE_GRACE_DAYS);
  const current = currentExpiresAt ? new Date(currentExpiresAt) : null;
  return current && Number.isFinite(current.getTime()) && current.getTime() > minimumExpiry.getTime()
    ? current
    : minimumExpiry;
}
