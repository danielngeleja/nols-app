/**
 * Accommodation capability bridge for the existing tour-operator ecosystem.
 *
 * This is intentionally additive: an established User(role=AGENT) keeps its
 * operator dashboard and Agent row. An ACTIVE UserWorkspaceAccess entitlement
 * plus a NrmsAgentAccount on the same user unlocks accommodation distribution.
 * Existing User(role=NRMS_AGENT) accounts keep their current portal behavior.
 */
import { auditRetentionFields } from "./auditRetention.js";
import { normalizeAgentDocuments } from "./nrmsAgentIdentity.js";

export const ACCOMMODATION_WORKSPACE = "ACCOMMODATION" as const;

export type AccommodationAccessReason =
  | "ROLE_NOT_SUPPORTED"
  | "CAPABILITY_REQUIRED"
  | "CAPABILITY_INACTIVE"
  | "CAPABILITY_EXPIRED"
  | "OPERATOR_INACTIVE"
  | "OPERATOR_PROFILE_NOT_APPROVED"
  | "AGENCY_IDENTITY_REQUIRED"
  | "AGENCY_INACTIVE";

export type AccommodationPortalAccess =
  | { ok: true }
  | { ok: false; reason: AccommodationAccessReason; message: string };

export type AccommodationPortalAccessInput = {
  role: string;
  capabilityStatus?: string | null;
  capabilityExpiresAt?: Date | null;
  operatorStatus?: string | null;
  operatorProfileReviewStatus?: string | null;
  hasAgencyIdentity: boolean;
  agencyStatus?: string | null;
  now?: Date;
};

/** Pure policy shared by route guards and unit tests. */
export function evaluateAccommodationPortalAccess(input: AccommodationPortalAccessInput): AccommodationPortalAccess {
  const role = String(input.role || "").toUpperCase();
  if (!input.hasAgencyIdentity) {
    return { ok: false, reason: "AGENCY_IDENTITY_REQUIRED", message: "Accommodation partner identity has not been activated." };
  }
  if (String(input.agencyStatus || "").toUpperCase() !== "ACTIVE") {
    return { ok: false, reason: "AGENCY_INACTIVE", message: "The accommodation partner identity is not active." };
  }

  // Existing sponsored agents retain their established access. The migration
  // records an explicit entitlement, but this fallback prevents deployment
  // ordering or a missed backfill from locking out a working account.
  if (role === "NRMS_AGENT") return { ok: true };
  if (role !== "AGENT") {
    return { ok: false, reason: "ROLE_NOT_SUPPORTED", message: "This account cannot use accommodation partnerships." };
  }

  const capability = String(input.capabilityStatus || "").toUpperCase();
  if (!capability) return { ok: false, reason: "CAPABILITY_REQUIRED", message: "Accommodation capability has not been granted." };
  if (capability !== "ACTIVE") return { ok: false, reason: "CAPABILITY_INACTIVE", message: "Accommodation capability is not active." };
  if (input.capabilityExpiresAt && input.capabilityExpiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return { ok: false, reason: "CAPABILITY_EXPIRED", message: "Accommodation capability has expired." };
  }
  if (String(input.operatorStatus || "").toUpperCase() !== "ACTIVE") {
    return { ok: false, reason: "OPERATOR_INACTIVE", message: "The operator account is not active." };
  }
  if (String(input.operatorProfileReviewStatus || "").toUpperCase() !== "APPROVED") {
    return { ok: false, reason: "OPERATOR_PROFILE_NOT_APPROVED", message: "The operator profile must be approved before accommodation access opens." };
  }
  return { ok: true };
}

const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const clean = (value: unknown): string | null => String(value ?? "").trim() || null;

type BridgeDb = {
  agent: { findUnique: (args: any) => Promise<any | null> };
  nrmsAgentAccount: { findUnique: (args: any) => Promise<any | null>; create: (args: any) => Promise<any>; update: (args: any) => Promise<any> };
  userWorkspaceAccess: { findUnique: (args: any) => Promise<any | null>; upsert: (args: any) => Promise<any> };
  auditLog: { create: (args: any) => Promise<any> };
};

export type OperatorAccommodationBridgeResult =
  | { ok: true; accountId: number; capability: typeof ACCOMMODATION_WORKSPACE; createdIdentity: boolean }
  | { ok: false; reason: "NOT_FOUND" | "OPERATOR_INACTIVE" | "PROFILE_NOT_APPROVED" | "APPROVED_EVIDENCE_REQUIRED" | "IDENTITY_BLOCKED" | "CAPABILITY_BLOCKED"; message: string };

/**
 * Grant an approved tour operator accommodation capability without changing its
 * User.role or creating another login. Approved UserDocument rows are reused as
 * the central KYC evidence snapshot; hotel relationships are not created here.
 */
export async function bridgeApprovedOperatorToAccommodation(
  tx: BridgeDb,
  params: { agentId: number; adminId: number; reason?: string | null; now?: Date },
): Promise<OperatorAccommodationBridgeResult> {
  const operator = await tx.agent.findUnique({
    where: { id: params.agentId },
    select: {
      id: true, userId: true, status: true, operatorProfile: true,
      user: {
        select: {
          id: true, name: true, fullName: true, email: true, phone: true, address: true, tin: true, nationality: true,
          documents: { where: { status: "APPROVED", url: { not: null } }, select: { type: true, url: true, createdAt: true } },
        },
      },
    },
  });
  if (!operator?.user) return { ok: false, reason: "NOT_FOUND", message: "Operator not found." };
  if (String(operator.status).toUpperCase() !== "ACTIVE") return { ok: false, reason: "OPERATOR_INACTIVE", message: "Only an active operator can receive accommodation capability." };

  const profile = record(operator.operatorProfile);
  const reviewStatus = String(profile.reviewStatus || record(profile.review).status || "").toUpperCase();
  if (reviewStatus !== "APPROVED") return { ok: false, reason: "PROFILE_NOT_APPROVED", message: "Approve the operator profile before granting accommodation capability." };
  if (!Array.isArray(operator.user.documents) || operator.user.documents.length === 0) {
    return { ok: false, reason: "APPROVED_EVIDENCE_REQUIRED", message: "At least one approved identity or business document is required." };
  }

  const now = params.now ?? new Date();
  let identity = await tx.nrmsAgentAccount.findUnique({ where: { primaryUserId: operator.userId } });
  let createdIdentity = false;
  if (identity && (String(identity.status).toUpperCase() !== "ACTIVE" || String(identity.verificationStatus).toUpperCase() === "REJECTED")) {
    return { ok: false, reason: "IDENTITY_BLOCKED", message: "The existing accommodation identity is suspended or rejected and must be reviewed separately." };
  }

  if (!identity) {
    const docs = normalizeAgentDocuments(operator.user.documents.map((document: any) => ({ type: document.type, url: document.url, uploadedAt: document.createdAt })));
    identity = await tx.nrmsAgentAccount.create({
      data: {
        primaryUserId: operator.userId,
        legalName: clean(profile.companyName) || clean(operator.user.fullName) || clean(operator.user.name) || `Operator ${operator.id}`,
        tradingName: clean(profile.companyName),
        registrationNo: clean(profile.businessRegistrationNumber),
        tin: clean(profile.tinNumber) || clean(operator.user.tin),
        licenseNo: clean(profile.tourismPermitNumber) || clean(profile.businessLicenseNumber),
        contactName: clean(profile.contactPersonName) || clean(operator.user.fullName) || clean(operator.user.name),
        contactEmail: (clean(profile.companyEmail) || clean(profile.contactPersonEmail) || clean(operator.user.email))?.toLowerCase() || null,
        contactPhone: clean(profile.companyPhone) || clean(profile.contactPersonPhone) || clean(operator.user.phone),
        address: clean(profile.businessAddress) || clean(operator.user.address),
        countryCode: String(profile.countryCode || "TZ").trim().toUpperCase().slice(0, 2) || "TZ",
        nationality: clean(profile.contactPersonNationality) || clean(operator.user.nationality),
        documents: docs,
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
        verifiedByAdminId: params.adminId,
        verifiedAt: now,
        verificationNote: `Reused approved operator KYC${params.reason?.trim() ? `: ${params.reason.trim()}` : ""}`.slice(0, 500),
      },
      select: { id: true, status: true, verificationStatus: true },
    });
    createdIdentity = true;
  } else if (String(identity.verificationStatus).toUpperCase() === "PENDING") {
    identity = await tx.nrmsAgentAccount.update({
      where: { id: identity.id },
      data: { verificationStatus: "VERIFIED", verifiedByAdminId: params.adminId, verifiedAt: now, verificationNote: "Reused approved operator KYC" },
      select: { id: true, status: true, verificationStatus: true },
    });
  }

  const existingAccess = await tx.userWorkspaceAccess.findUnique({ where: { userId_workspace: { userId: operator.userId, workspace: ACCOMMODATION_WORKSPACE } } });
  if (existingAccess && ["SUSPENDED", "REVOKED"].includes(String(existingAccess.status).toUpperCase())) {
    return { ok: false, reason: "CAPABILITY_BLOCKED", message: "Accommodation capability was suspended or revoked and cannot be silently restored." };
  }
  await tx.userWorkspaceAccess.upsert({
    where: { userId_workspace: { userId: operator.userId, workspace: ACCOMMODATION_WORKSPACE } },
    create: { userId: operator.userId, workspace: ACCOMMODATION_WORKSPACE, status: "ACTIVE", grantedById: params.adminId, grantedAt: now },
    update: { status: "ACTIVE", grantedById: params.adminId, grantedAt: now, suspendedAt: null, expiresAt: null, statusReason: params.reason?.trim() || null },
  });

  const action = "OPERATOR_ACCOMMODATION_CAPABILITY_GRANTED";
  await tx.auditLog.create({
    data: {
      actorId: params.adminId, actorRole: "ADMIN", action, entity: "NRMS_AGENT_ACCOUNT", entityId: identity.id,
      beforeJson: { operatorAgentId: operator.id, capability: existingAccess?.status ?? null },
      afterJson: { operatorAgentId: operator.id, capability: "ACTIVE", reusedOperatorKyc: true, createdIdentity },
      createdAt: now,
      ...auditRetentionFields(action, "NRMS_AGENT_ACCOUNT", now),
    },
  });
  return { ok: true, accountId: identity.id, capability: ACCOMMODATION_WORKSPACE, createdIdentity };
}
