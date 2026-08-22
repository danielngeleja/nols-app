/**
 * NRMS Agent B2B — agency identity, KYC documents, central verification and the
 * lookup/claim that keeps one agency from being duplicated across hotels.
 *
 * Model: "verify once, approve many." The agency's identity + KYC lives once on
 * NrmsAgentAccount, is verified centrally by NoLSAF, and is reused by every
 * hotel that links it. Per-hotel commercial approval + terms are a separate
 * concern (NrmsAgentPropertyLink, hotel-side API). Nothing here is hotel-scoped.
 */

import { auditRetentionFields } from "./auditRetention.js";

export type AgentDocumentInput = { type?: string | null; url: string; uploadedAt?: string | Date | null };
export type AgentDocument = { type: string; url: string; uploadedAt: string };

/** Known KYC document types. Others are kept but normalised to OTHER. */
const KNOWN_DOC_TYPES = new Set(["TOURISM_LICENSE", "BUSINESS_LICENSE", "TIN_CERTIFICATE", "ID", "PASSPORT", "OTHER"]);

/** Normalise arbitrary document input into a clean, storable array. Drops entries with no URL. */
export function normalizeAgentDocuments(input: unknown): AgentDocument[] {
  if (!Array.isArray(input)) return [];
  const out: AgentDocument[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const url = String((raw as any).url ?? "").trim();
    if (!url) continue;
    const rawType = String((raw as any).type ?? "OTHER").trim().toUpperCase();
    const type = KNOWN_DOC_TYPES.has(rawType) ? rawType : "OTHER";
    const at = (raw as any).uploadedAt;
    const uploadedAt = at ? new Date(at) : new Date();
    out.push({ type, url, uploadedAt: (isNaN(uploadedAt.getTime()) ? new Date() : uploadedAt).toISOString() });
  }
  return out;
}

type Db = {
  nrmsAgentAccount: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  auditLog: { create: (args: any) => Promise<any> };
};

export type CreateAgentAccountInput = {
  primaryUserId: number;
  legalName: string;
  tradingName?: string | null;
  registrationNo?: string | null;
  tin?: string | null;
  licenseNo?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  countryCode?: string | null;
  nationality?: string | null;
  documents?: unknown;
  bankDetails?: unknown;
  notes?: string | null;
};

/**
 * Create the agency identity. The primaryUserId (an NRMS_AGENT user) is created
 * by the invite/auth flow and passed in. Starts PENDING central verification.
 */
export async function createAgentAccount(db: Db, input: CreateAgentAccountInput): Promise<{ id: number }> {
  const created = await db.nrmsAgentAccount.create({
    data: {
      primaryUserId: input.primaryUserId,
      legalName: input.legalName.trim(),
      tradingName: input.tradingName?.trim() || null,
      registrationNo: input.registrationNo?.trim() || null,
      tin: input.tin?.trim() || null,
      licenseNo: input.licenseNo?.trim() || null,
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      contactPhone: input.contactPhone?.trim() || null,
      address: input.address?.trim() || null,
      countryCode: (input.countryCode?.trim().toUpperCase() || "TZ").slice(0, 2),
      nationality: input.nationality?.trim() || null,
      documents: normalizeAgentDocuments(input.documents),
      bankDetails: input.bankDetails ?? undefined,
      notes: input.notes?.trim() || null,
      status: "ACTIVE",
      verificationStatus: "PENDING",
    },
    select: { id: true },
  });
  return { id: created.id };
}

export type AgencyMatchQuery = { registrationNo?: string | null; tin?: string | null; contactEmail?: string | null; excludeId?: number };
export type AgencyMatch = { id: number; legalName: string; tradingName: string | null; registrationNo: string | null; tin: string | null; verificationStatus: string; status: string; matchedOn: Array<"registrationNo" | "tin" | "contactEmail"> };

/**
 * Find existing agencies that look like the same entity, so a hotel onboarding a
 * new agent can CLAIM the existing identity instead of creating a duplicate.
 * Matches on registration number, TIN, or contact email (case-insensitive).
 * Returns an empty list when nothing distinctive was provided.
 */
export async function findAgencyMatches(db: Db, query: AgencyMatchQuery): Promise<AgencyMatch[]> {
  const reg = query.registrationNo?.trim();
  const tin = query.tin?.trim();
  const email = query.contactEmail?.trim().toLowerCase();
  const or: any[] = [];
  if (reg) or.push({ registrationNo: reg });
  if (tin) or.push({ tin });
  if (email) or.push({ contactEmail: email });
  if (or.length === 0) return [];

  const rows = await db.nrmsAgentAccount.findMany({
    where: { OR: or, ...(query.excludeId ? { id: { not: query.excludeId } } : {}) },
    select: { id: true, legalName: true, tradingName: true, registrationNo: true, tin: true, contactEmail: true, verificationStatus: true, status: true },
    take: 10,
  });
  return rows.map((r) => {
    const matchedOn: AgencyMatch["matchedOn"] = [];
    if (reg && r.registrationNo === reg) matchedOn.push("registrationNo");
    if (tin && r.tin === tin) matchedOn.push("tin");
    if (email && String(r.contactEmail ?? "").toLowerCase() === email) matchedOn.push("contactEmail");
    return { id: r.id, legalName: r.legalName, tradingName: r.tradingName, registrationNo: r.registrationNo, tin: r.tin, verificationStatus: r.verificationStatus, status: r.status, matchedOn };
  });
}

export type VerificationDecision = "VERIFIED" | "REJECTED";
export type VerifyResult = { ok: true; status: VerificationDecision } | { ok: false; reason: "NOT_FOUND" | "NO_CHANGE"; message: string };

/**
 * Central NoLSAF verification decision. Idempotent: re-applying the same decision
 * is a NO_CHANGE. Writes a generic AuditLog row (NRMS_AGENT_VERIFY) so the
 * decision, admin and note are traceable, in the same call as the state change.
 */
export async function decideAgentVerification(
  db: Db,
  params: { accountId: number; adminId: number; decision: VerificationDecision; note?: string | null },
): Promise<VerifyResult> {
  const account = await db.nrmsAgentAccount.findUnique({ where: { id: params.accountId }, select: { id: true, verificationStatus: true } });
  if (!account) return { ok: false, reason: "NOT_FOUND", message: "Agency not found." };
  if (account.verificationStatus === params.decision) return { ok: false, reason: "NO_CHANGE", message: `Agency is already ${params.decision}.` };

  const now = new Date();
  const changed = await db.nrmsAgentAccount.updateMany({
    where: { id: params.accountId, verificationStatus: { not: params.decision } },
    data: {
      verificationStatus: params.decision,
      verifiedByAdminId: params.adminId,
      verifiedAt: params.decision === "VERIFIED" ? now : null,
      verificationNote: params.note?.trim() || null,
    },
  });
  if (changed.count !== 1) return { ok: false, reason: "NO_CHANGE", message: "Verification did not change." };

  const action = "NRMS_AGENT_VERIFY";
  await db.auditLog.create({
    data: {
      actorId: params.adminId,
      actorRole: "ADMIN",
      action,
      entity: "NRMS_AGENT_ACCOUNT",
      entityId: params.accountId,
      beforeJson: { verificationStatus: account.verificationStatus },
      afterJson: { verificationStatus: params.decision, note: params.note?.trim() || null },
      createdAt: now,
      ...auditRetentionFields(action, "NRMS_AGENT_ACCOUNT", now),
    },
  });
  return { ok: true, status: params.decision };
}
