/**
 * Merchant onboarding lifecycle.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * The controlling rules from that record, made executable here:
 *
 *   - NRMS activation never implies payment activation. Subscribing creates a
 *     local shell that submits nothing and can accept no money.
 *   - Local administrator approval is never provider activation. Approving
 *     reaches SUBMISSION_QUEUED and stops. Only a verified provider result may
 *     set ACTIVE, and nothing in this module can.
 *   - A correction after review creates a NEW application version rather than
 *     editing reviewed evidence, so an approval can always be traced to the
 *     exact package the reviewer saw.
 *   - Acceptance is tied to the exact policy version and content hash.
 *
 * No owner-entered field reaches the database unless it appears in
 * OWNER_ENTERED_FIELDS below. Provider account security contacts are taken
 * from the Owner account only after that email or phone has been verified.
 */

import { createHash } from "node:crypto";

import { checkOrchestrationGate } from "./config.js";
import { checkAcceptedVersion, loadMerchantPolicy } from "./policy.js";

/**
 * Application identity fields included in the frozen payload hash. The
 * separately declared owner-entered subset controls which of these may arrive
 * from the application form.
 */
export const EDITABLE_FIELDS = [
  "legalName",
  "tradingName",
  "registrationNumber",
  "tin",
  "country",
  "contactEmail",
  "contactPhone",
] as const;

/**
 * Values the Owner may type into the payment application. Email and phone are
 * deliberately absent: provider MFA and recovery must not be redirected to an
 * employee or arbitrary address through this form.
 */
/**
 * The parts of an application an admin can flag when returning it.
 *
 * A return used to carry only free text, so an owner was told "needs changes"
 * and had to guess which of five things to look at. Flagging areas turns that
 * into a checklist, and the owner UI can open exactly those sections.
 *
 * Stored on the APPLICATION_RETURN audit row's `metadata`, which already
 * exists: the flagged areas are part of the decision, and the audit row is the
 * decision record. Nothing new is needed on the application itself.
 */
export const CORRECTION_AREAS = [
  "BUSINESS_IDENTITY",
  "TAX_IDENTIFIERS",
  "CONTACT_DETAILS",
  "DOCUMENTS",
  "POLICY_ACCEPTANCE",
] as const;
export type CorrectionArea = (typeof CORRECTION_AREAS)[number];

export const OWNER_ENTERED_FIELDS = [
  "legalName",
  "tradingName",
  "registrationNumber",
  "tin",
  "country",
] as const satisfies readonly EditableField[];

export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type MerchantDraft = Partial<Record<EditableField, string | null>>;

/** Fields that must be present before an application can be reviewed. */
const REQUIRED_FOR_SUBMISSION: EditableField[] = [
  "legalName",
  "registrationNumber",
  "tin",
  "country",
  "contactEmail",
  "contactPhone",
];

/**
 * KYC evidence an application must carry.
 *
 * These are the same document types the Owner Workspace already collects, per
 * `OWNER_DOCUMENT_TYPES` in lib/userDocumentSecurity.ts. Onboarding links to
 * those uploads instead of asking for them again: an owner who has already
 * satisfied NoLSAF's own verification should not have to re-supply the same
 * licence to become payable.
 */
export const REQUIRED_DOCUMENT_TYPES = ["BUSINESS_LICENCE", "TIN_CERTIFICATE"] as const;
export type RequiredDocumentType = (typeof REQUIRED_DOCUMENT_TYPES)[number];

/**
 * The Owner Workspace accepts both spellings of "licence", so both are folded
 * onto one canonical type here rather than being treated as two documents.
 */
function canonicalDocumentType(raw: unknown): string {
  const value = String(raw ?? "").trim().toUpperCase();
  return value === "BUSINESS_LICENSE" ? "BUSINESS_LICENCE" : value;
}

export type LinkedDocument = {
  userDocumentId: number;
  documentType: string;
  /** PENDING, APPROVED or REJECTED, as recorded by the Owner Workspace. */
  status: string;
  uploadedAt: Date | null;
  expiresAt: Date | null;
};

function documentExpiry(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const values = metadata as Record<string, unknown>;
  const raw = values.expiresAt ?? values.expires_on ?? values.expiresOn;
  if (!raw) return null;
  const parsed = new Date(String(raw));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function documentIsExpired(document: LinkedDocument, at: Date = new Date()): boolean {
  return document.documentType === "BUSINESS_LICENCE"
    && Boolean(document.expiresAt)
    && document.expiresAt!.getTime() <= at.getTime();
}

/**
 * The owner's existing KYC uploads, reduced to the newest per type.
 *
 * Returns identifiers and review state only. The storage URL is deliberately
 * never read here: this module decides whether evidence exists, not where it
 * lives, and a document location that is never loaded is a document location
 * that cannot leak through this path.
 */
export async function loadOwnerDocuments(db: any, ownerUserId: number): Promise<LinkedDocument[]> {
  const rows = await db.userDocument.findMany({
    where: { userId: ownerUserId },
    orderBy: { id: "desc" },
    select: { id: true, type: true, status: true, createdAt: true, metadata: true },
  });

  const newestByType = new Map<string, LinkedDocument>();
  for (const row of rows as Array<{ id: number; type: string | null; status: string; createdAt: Date; metadata?: unknown }>) {
    const documentType = canonicalDocumentType(row.type);
    if (!documentType || newestByType.has(documentType)) continue;
    newestByType.set(documentType, {
      userDocumentId: row.id,
      documentType,
      status: String(row.status ?? "PENDING").toUpperCase(),
      uploadedAt: row.createdAt ?? null,
      expiresAt: documentExpiry(row.metadata),
    });
  }
  return [...newestByType.values()];
}

/**
 * Required document types that are absent or were rejected.
 *
 * A rejected upload counts as missing: submitting an application on evidence
 * NoLSAF has already turned down wastes the reviewer's time and the owner's.
 */
export function missingRequiredDocuments(documents: LinkedDocument[], at: Date = new Date()): RequiredDocumentType[] {
  return REQUIRED_DOCUMENT_TYPES.filter((required) => {
    const found = documents.find((doc) => doc.documentType === required);
    return !found || found.status === "REJECTED" || documentIsExpired(found, at);
  });
}

/** Application states the owner may still edit. */
const OWNER_EDITABLE_STATUSES = new Set(["DRAFT", "ACTION_REQUIRED"]);

/** States where a correction must open a new version instead of editing. */
const REQUIRES_NEW_VERSION = new Set(["ACTION_REQUIRED"]);

/** States an admin may decide on. */
const DECIDABLE_STATUSES = new Set(["READY_FOR_ADMIN_REVIEW"]);

export type OnboardingRefusal = {
  ok: false;
  code:
    | "orchestration_disabled"
    | "production_not_authorized"
    | "policy_not_configured"
    | "policy_unreadable"
    | "policy_version_stale"
    | "policy_not_accepted"
    | "already_subscribed"
    | "not_subscribed"
    | "already_submitted"
    | "not_subscribed"
    | "not_editable"
    | "incomplete_application"
    | "not_decidable"
    | "self_review_forbidden"
    | "not_administrator"
    | "owner_tin_not_configured"
    | "owner_tin_mismatch"
    | "owner_contact_not_verified"
    | "merchant_not_reusable"
    | "package_altered"
    | "no_connection";
  message: string;
};

/**
 * Second, independent tenancy check.
 *
 * The route layer already proves ownership by loading the property under the
 * owner's tenant scope and reaching the merchant through it. This repeats the
 * check against the merchant row itself, so the service cannot be made to
 * mutate someone else's merchant if it is ever called from a new route, a
 * worker or a script that forgets the first check. Tenancy enforced in exactly
 * one layer is tenancy that survives exactly until someone adds a second
 * caller.
 */
async function assertAdministers(
  db: any,
  merchantId: number,
  ownerUserId: number
): Promise<OnboardingRefusal | null> {
  const merchant = await db.merchantLegalEntity.findUnique({
    where: { id: merchantId },
    select: { administeredById: true },
  });
  if (!merchant || merchant.administeredById !== ownerUserId) {
    return {
      ok: false,
      code: "not_administrator",
      message: "You do not have access to this merchant.",
    };
  }
  return null;
}

/**
 * Canonical hash of the reviewed package.
 *
 * Keys are sorted so the same content always hashes the same way regardless of
 * property order, which is what lets the hash prove the submitted package was
 * not altered between review and provider submission.
 */
export function applicationPayloadHash(draft: MerchantDraft): string {
  const canonical = EDITABLE_FIELDS.reduce<Record<string, string>>((acc, field) => {
    acc[field] = String(draft[field] ?? "");
    return acc;
  }, {});
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

/** Keeps only allowlisted keys, trimming strings and normalising blanks to null. */
export function sanitizeDraft(input: Record<string, unknown>): MerchantDraft {
  const draft: MerchantDraft = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (raw === null || raw === undefined) {
      draft[field] = null;
      continue;
    }
    const value = String(raw).trim();
    draft[field] = value.length === 0 ? null : value;
  }
  return draft;
}

export function missingRequiredFields(draft: MerchantDraft): EditableField[] {
  return REQUIRED_FOR_SUBMISSION.filter((field) => !draft[field]);
}

/** Keeps only fields the Owner is permitted to type in this workflow. */
export function sanitizeOwnerDraft(input: Record<string, unknown>): MerchantDraft {
  const draft: MerchantDraft = {};
  for (const field of OWNER_ENTERED_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (raw === null || raw === undefined) {
      draft[field] = null;
      continue;
    }
    const value = String(raw).trim();
    draft[field] = value.length === 0 ? null : value;
  }
  return draft;
}

export type OwnerWorkspaceTinStatus = "MATCH" | "MISMATCH" | "NOT_ON_FILE" | "NOT_ENTERED";

/** Formatting differences do not make two copies of the same TIN disagree. */
export function normalizeTinForMatch(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function ownerWorkspaceTinStatus(
  ownerWorkspaceTin: unknown,
  candidateTin: unknown
): OwnerWorkspaceTinStatus {
  const ownerTin = normalizeTinForMatch(ownerWorkspaceTin);
  if (!ownerTin) return "NOT_ON_FILE";
  const candidate = normalizeTinForMatch(candidateTin);
  if (!candidate) return "NOT_ENTERED";
  return ownerTin === candidate ? "MATCH" : "MISMATCH";
}

type OwnerAccountIdentity = {
  tin?: string | null;
  email?: string | null;
  phone?: string | null;
  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
};

export type OwnerSecurityContact = {
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

export function ownerSecurityContact(owner: OwnerAccountIdentity | null | undefined): OwnerSecurityContact {
  const email = String(owner?.email ?? "").trim().toLowerCase() || null;
  const phone = String(owner?.phone ?? "").trim() || null;
  return {
    email,
    phone,
    emailVerified: Boolean(email && owner?.emailVerifiedAt),
    phoneVerified: Boolean(phone && owner?.phoneVerifiedAt),
  };
}

function providerContactDraft(contact: OwnerSecurityContact): Pick<MerchantDraft, "contactEmail" | "contactPhone"> {
  return {
    contactEmail: contact.emailVerified ? contact.email : null,
    contactPhone: contact.phoneVerified ? contact.phone : null,
  };
}

/**
 * Compares a candidate only with the authenticated owner's own workspace TIN.
 * The stored value is never returned, so this cannot be used to discover a TIN.
 */
export async function matchOwnerWorkspaceTin(
  db: any,
  input: { ownerUserId: number; tin: string },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; status: OwnerWorkspaceTinStatus } | OnboardingRefusal> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const owner = await db.user.findUnique({
    where: { id: input.ownerUserId },
    select: { tin: true },
  });
  if (!owner) {
    return { ok: false, code: "not_administrator", message: "You do not have access to this merchant." };
  }
  return { ok: true, status: ownerWorkspaceTinStatus(owner.tin, input.tin) };
}

function gate(env: NodeJS.ProcessEnv): OnboardingRefusal | null {
  const result = checkOrchestrationGate(env);
  return result.ok ? null : { ok: false, code: result.code, message: result.message };
}

async function currentApplication(db: any, merchantId: number, connectionId: number) {
  const rows = await db.merchantApplication.findMany({
    where: { merchantId, connectionId },
    orderBy: { version: "desc" },
    take: 1,
  });
  return (rows as any[])[0] ?? null;
}

async function audit(
  db: any,
  input: {
    entityType: string;
    entityId: number;
    action: string;
    actorKind?: "USER" | "SYSTEM" | "PROVIDER";
    actorUserId?: number | null;
    previousState?: string | null;
    nextState?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  await db.merchantAuditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorKind: input.actorKind ?? "USER",
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata ?? undefined,
      previousState: input.previousState ?? null,
      nextState: input.nextState ?? null,
      reason: input.reason ?? null,
    },
  });
}

/**
 * Resolves the provider connection onboarding targets.
 *
 * Read from the database rather than named in code, so adding or switching a
 * provider is configuration and not a deploy.
 */
export async function activeConnection(db: any, env: NodeJS.ProcessEnv = process.env) {
  const environment = checkOrchestrationGate(env);
  if (!environment.ok) return null;
  return db.providerConnection.findFirst({
    where: { environment: environment.config.environment, isEnabled: true },
    orderBy: { id: "asc" },
    select: { id: true, provider: true, environment: true },
  });
}

/**
 * A merchant this owner already administers, offered for reuse.
 *
 * A merchant represents a legal entity, not a property. One registered company
 * that operates several properties needs one KYC package and one provider
 * account, not one per property: the provider assesses a taxpayer, and sending
 * it the same TIN several times produces duplicate applications it will reject.
 * Properties therefore link to an existing merchant, and a new merchant is
 * created only when the owner declares a genuinely different company.
 */
export type ReusableMerchant = {
  merchantId: number;
  legalName: string;
  tradingName: string | null;
  status: string;
  applicationStatus: string | null;
  providerStatus: string | null;
  /** Properties currently covered by this merchant. */
  propertyCount: number;
};

export type LinkedProperty = { propertyId: number; title: string | null };

/** Merchants the owner administers, with the state of each. */
export async function listOwnerMerchants(
  db: any,
  ownerUserId: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReusableMerchant[]> {
  const connection = await activeConnection(db, env);
  if (!connection) return [];

  const merchants = await db.merchantLegalEntity.findMany({
    where: { administeredById: ownerUserId, status: { not: "CLOSED" } },
    orderBy: { id: "asc" },
    select: { id: true, legalName: true, tradingName: true, status: true },
  });

  const rows: ReusableMerchant[] = [];
  for (const merchant of merchants as Array<{
    id: number;
    legalName: string;
    tradingName: string | null;
    status: string;
  }>) {
    const application = await currentApplication(db, merchant.id, connection.id);
    const providerAccount = await db.merchantProviderAccount.findUnique({
      where: { merchantId_connectionId: { merchantId: merchant.id, connectionId: connection.id } },
      select: { status: true },
    });
    const propertyCount = await db.merchantPropertyLink.count({
      where: { merchantId: merchant.id, effectiveTo: null },
    });

    rows.push({
      merchantId: merchant.id,
      legalName: merchant.legalName,
      tradingName: merchant.tradingName ?? null,
      status: merchant.status,
      applicationStatus: application?.status ?? null,
      providerStatus: providerAccount?.status ?? null,
      propertyCount: Number(propertyCount ?? 0),
    });
  }
  return rows;
}

/** The properties a merchant currently covers. */
export async function linkedProperties(db: any, merchantId: number): Promise<LinkedProperty[]> {
  const links = await db.merchantPropertyLink.findMany({
    where: { merchantId, effectiveTo: null },
    orderBy: { propertyId: "asc" },
    select: { propertyId: true, property: { select: { title: true } } },
  });
  return (links as Array<{ propertyId: number; property?: { title?: string | null } | null }>).map((link) => ({
    propertyId: link.propertyId,
    title: link.property?.title ?? null,
  }));
}

export type OverviewResult =
  | {
      ok: true;
      subscribed: boolean;
      merchant: ({ id: number; status: string } & MerchantDraft) | null;
      application: {
        id: number;
        version: number;
        status: string;
        submittedAt: Date | null;
        decisionReason: string | null;
        correctionAreas: string[];
      } | null;
      providerAccount: { status: string; statusReason: string | null; activatedAt: Date | null } | null;
      ownerSecurityContact: OwnerSecurityContact;
      policy: { policyId: string; policyVersion: string; accepted: boolean } | null;
      /** Offered before subscribing, so a second property can join an existing company. */
      reusableMerchants: ReusableMerchant[];
      /** Every property this merchant covers, once subscribed. */
      linkedProperties: LinkedProperty[];
      documents: LinkedDocument[];
      checklist: {
        missingFields: EditableField[];
        missingDocuments: RequiredDocumentType[];
        policyAccepted: boolean;
        ownerTinStatus: OwnerWorkspaceTinStatus;
        canSubmit: boolean;
      };
    }
  | OnboardingRefusal;

/**
 * The owner's view of where onboarding stands.
 *
 * Returns no provider secrets and no document contents or locations, only
 * status and the owner's own submitted values.
 */
export async function getMerchantOverview(
  db: any,
  input: { propertyId: number; ownerUserId: number },
  env: NodeJS.ProcessEnv = process.env
): Promise<OverviewResult> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const connection = await activeConnection(db, env);
  if (!connection) {
    return { ok: false, code: "no_connection", message: "Online payment is not available yet." };
  }

  const link = await db.merchantPropertyLink.findFirst({
    where: { propertyId: input.propertyId, outletId: null, effectiveTo: null },
    select: { merchantId: true },
  });

  // Documents belong to the owner, not the merchant, so they are visible even
  // before subscribing. That lets the page tell an owner what they already
  // have on file rather than presenting an empty checklist.
  const documents = await loadOwnerDocuments(db, input.ownerUserId);
  const missingDocuments = missingRequiredDocuments(documents);
  const owner = await db.user.findUnique({
    where: { id: input.ownerUserId },
    select: { tin: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  const securityContact = ownerSecurityContact(owner);

  if (!link) {
    return {
      ok: true,
      subscribed: false,
      merchant: null,
      application: null,
      providerAccount: null,
      ownerSecurityContact: securityContact,
      policy: policySummary(env, false),
      reusableMerchants: await listOwnerMerchants(db, input.ownerUserId, env),
      linkedProperties: [],
      documents,
      checklist: {
        missingFields: [...REQUIRED_FOR_SUBMISSION],
        missingDocuments,
        policyAccepted: false,
        ownerTinStatus: ownerWorkspaceTinStatus(owner?.tin, null),
        canSubmit: false,
      },
    };
  }

  const merchant = await db.merchantLegalEntity.findUnique({
    where: { id: link.merchantId },
    select: {
      id: true,
      status: true,
      legalName: true,
      tradingName: true,
      registrationNumber: true,
      tin: true,
      country: true,
      contactEmail: true,
      contactPhone: true,
    },
  });

  const application = await currentApplication(db, link.merchantId, connection.id);
  const providerAccount = await db.merchantProviderAccount.findUnique({
    where: { merchantId_connectionId: { merchantId: link.merchantId, connectionId: connection.id } },
    select: { status: true, statusReason: true, activatedAt: true },
  });

  const accepted = await hasCurrentPolicyAcceptance(db, link.merchantId, env);
  const draft = {
    ...sanitizeDraft(merchant ?? {}),
    ...providerContactDraft(securityContact),
  };
  const missing = missingRequiredFields(draft);
  const ownerTinStatus = ownerWorkspaceTinStatus(owner?.tin, draft.tin);

  // Cheap and skipped entirely unless the owner actually has work to do.
  let correctionAreas: string[] = [];
  if (application?.status === "ACTION_REQUIRED") {
    const lastReturn = await db.merchantAuditEvent.findFirst({
      where: { entityType: "APPLICATION", entityId: application.id, action: "APPLICATION_RETURN" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const raw = (lastReturn?.metadata as { correctionAreas?: unknown } | null)?.correctionAreas;
    correctionAreas = Array.isArray(raw)
      ? raw.filter((area): area is CorrectionArea => CORRECTION_AREAS.includes(area as CorrectionArea))
      : [];
  }

  return {
    ok: true,
    subscribed: true,
    merchant: merchant ? { ...draft, id: merchant.id, status: merchant.status } : null,
    application: application
      ? {
          id: application.id,
          version: application.version,
          status: application.status,
          submittedAt: application.submittedAt ?? null,
          decisionReason: application.decisionReason ?? null,
          // Which sections the reviewer flagged, so the owner gets a checklist
          // instead of one sentence and a guess. Read from the most recent
          // return on this application, and only while it is theirs to fix.
          correctionAreas: application.status === "ACTION_REQUIRED" ? correctionAreas : [],
        }
      : null,
    providerAccount: providerAccount ?? null,
    ownerSecurityContact: securityContact,
    policy: policySummary(env, accepted),
    reusableMerchants: [],
    linkedProperties: await linkedProperties(db, link.merchantId),
    documents,
    checklist: {
      missingFields: missing,
      missingDocuments,
      policyAccepted: accepted,
      ownerTinStatus,
      canSubmit:
        missing.length === 0 &&
        missingDocuments.length === 0 &&
        accepted &&
        ownerTinStatus === "MATCH" &&
        Boolean(application) &&
        OWNER_EDITABLE_STATUSES.has(application.status),
    },
  };
}

function policySummary(env: NodeJS.ProcessEnv, accepted: boolean) {
  const policy = loadMerchantPolicy(env);
  if (!policy.ok) return null;
  return {
    policyId: policy.policy.policyId,
    policyVersion: policy.policy.policyVersion,
    accepted,
  };
}

async function hasCurrentPolicyAcceptance(
  db: any,
  merchantId: number,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const policy = loadMerchantPolicy(env);
  if (!policy.ok) return false;
  const row = await db.policyAcceptance.findFirst({
    where: {
      merchantId,
      policyId: policy.policy.policyId,
      policyVersion: policy.policy.policyVersion,
      contentHash: policy.policy.contentHash,
      supersededAt: null,
    },
    select: { id: true },
  });
  return Boolean(row);
}

const ACTIVE_PROPERTY_SCOPE_CONSTRAINT = "merchant_property_link_activeScopeKey_key";

function activePropertyScopeKey(propertyId: number): string {
  return `${propertyId}:ALL`;
}

/** Only translate the uniqueness error for the property scope we intentionally claim. */
function isActivePropertyScopeConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || (error as { code?: string }).code !== "P2002") {
    return false;
  }

  const prismaError = error as { meta?: { target?: unknown }; message?: string };
  const target = Array.isArray(prismaError.meta?.target)
    ? prismaError.meta.target.join(",")
    : String(prismaError.meta?.target ?? "");
  const detail = `${target} ${prismaError.message ?? ""}`;
  return detail.includes("activeScopeKey") || detail.includes(ACTIVE_PROPERTY_SCOPE_CONSTRAINT);
}

async function createActivePropertyLink(
  tx: any,
  input: { merchantId: number; propertyId: number; effectiveFrom: Date }
): Promise<void> {
  const activeScopeKey = activePropertyScopeKey(input.propertyId);

  // Older detach code closed the history row without releasing its unique
  // active key. Repair that legacy state before claiming the live scope.
  await tx.merchantPropertyLink.updateMany({
    where: { activeScopeKey, effectiveTo: { not: null } },
    data: { activeScopeKey: null },
  });

  await tx.merchantPropertyLink.create({
    data: {
      merchantId: input.merchantId,
      propertyId: input.propertyId,
      outletId: null,
      effectiveFrom: input.effectiveFrom,
      activeScopeKey,
    },
  });
}

const ALREADY_SUBSCRIBED: OnboardingRefusal = {
  ok: false,
  code: "already_subscribed",
  message: "This property is already subscribed.",
};

/**
 * Creates the local merchant shell.
 *
 * Deliberately inert: it submits no KYC, creates no provider wallet, enables
 * no checkout and can accept no payment. The provider account starts at DRAFT
 * and only a verified provider result can ever move it to ACTIVE.
 */
/**
 * Undoes a subscribe, so the owner can go back to the "which company operates
 * this property?" choice.
 *
 * Picking a company is a one-click decision with lasting consequences, and it
 * was irreversible: choose wrong and the property was tied to that legal
 * entity with no way back from this screen.
 *
 * The link is closed, never deleted, so the history of what this property was
 * attached to survives. The merchant itself is left alone: it may carry other
 * properties, and a draft one reappears in the owner's reusable list so they
 * can rejoin it.
 *
 * Only permitted while nothing has been submitted. Once a package is with
 * NoLSAF or the provider, the attachment is part of a record under review and
 * an owner must not be able to pull it out from underneath that.
 */
export async function detachPropertyFromMerchant(
  db: any,
  input: { propertyId: number; at?: Date },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; merchantId: number } | OnboardingRefusal> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const link = await db.merchantPropertyLink.findFirst({
    where: { propertyId: input.propertyId, outletId: null, effectiveTo: null },
    select: { id: true, merchantId: true },
  });
  if (!link) {
    return { ok: false, code: "not_subscribed", message: "This property is not attached to a company." };
  }

  const application = await db.merchantApplication.findFirst({
    where: { merchantId: link.merchantId },
    orderBy: { version: "desc" },
    select: { status: true, submittedAt: true },
  });
  if (application && (application.submittedAt || application.status !== "DRAFT")) {
    return {
      ok: false,
      code: "already_submitted",
      message: "This application has already been submitted. Contact NoLSAF support to change the company.",
    };
  }

  const at = input.at ?? new Date();
  await db.$transaction(async (tx: any) => {
    // activeScopeKey must be released with the link, not just dated. It holds
    // the "one active mapping per scope" unique index, so a closed row that
    // kept its key blocked the property from ever being attached again.
    await tx.merchantPropertyLink.update({
      where: { id: link.id },
      data: { effectiveTo: at, activeScopeKey: null },
    });
    await audit(tx, {
      entityType: "MERCHANT",
      entityId: link.merchantId,
      action: "PROPERTY_DETACHED",
      reason: `Property ${input.propertyId} detached before submission`,
      metadata: { propertyId: input.propertyId },
    });
  });

  return { ok: true, merchantId: link.merchantId };
}

export async function subscribeMerchant(
  db: any,
  input: { ownerUserId: number; propertyId: number; merchantId?: number | null; at?: Date },
  env: NodeJS.ProcessEnv = process.env
): Promise<
  { ok: true; merchantId: number; applicationId: number; reusedMerchant: boolean } | OnboardingRefusal
> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const connection = await activeConnection(db, env);
  if (!connection) {
    return { ok: false, code: "no_connection", message: "Online payment is not available yet." };
  }

  const existing = await db.merchantPropertyLink.findFirst({
    where: { propertyId: input.propertyId, outletId: null, effectiveTo: null },
    select: { merchantId: true },
  });
  if (existing) {
    return ALREADY_SUBSCRIBED;
  }

  // Joining a company the owner already runs. No second KYC package and no
  // second review: the provider assessed this legal entity once, and the new
  // property inherits whatever state that assessment reached.
  if (input.merchantId) {
    return linkPropertyToMerchant(db, {
      ownerUserId: input.ownerUserId,
      propertyId: input.propertyId,
      merchantId: input.merchantId,
      connectionId: connection.id,
      at: input.at ?? new Date(),
    });
  }

  const owner = await db.user.findUnique({
    where: { id: input.ownerUserId },
    select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  if (!owner) {
    return { ok: false, code: "not_administrator", message: "You do not have access to this merchant." };
  }
  const contactDraft = providerContactDraft(ownerSecurityContact(owner));

  const at = input.at ?? new Date();

  try {
    return await db.$transaction(async (tx: any) => {
      const merchant = await tx.merchantLegalEntity.create({
        data: {
          administeredById: input.ownerUserId,
          // Placeholder until the owner supplies real details. Never inferred
          // from the property, which is a listing and not a legal entity.
          legalName: "",
          ...contactDraft,
          status: "DRAFT",
        },
        select: { id: true },
      });

      await createActivePropertyLink(tx, {
        merchantId: merchant.id,
        propertyId: input.propertyId,
        effectiveFrom: at,
      });

      await tx.merchantProviderAccount.create({
        data: { merchantId: merchant.id, connectionId: connection.id, status: "DRAFT" },
      });

      const application = await tx.merchantApplication.create({
        data: { merchantId: merchant.id, connectionId: connection.id, version: 1, status: "DRAFT" },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "MERCHANT",
        entityId: merchant.id,
        action: "MERCHANT_SUBSCRIBED",
        actorUserId: input.ownerUserId,
        nextState: "DRAFT",
      });

      return {
        ok: true as const,
        merchantId: merchant.id,
        applicationId: application.id,
        reusedMerchant: false,
      };
    });
  } catch (error) {
    // The pre-check above is for a friendly fast path. The unique index stays
    // authoritative when two subscription requests race for the same scope.
    if (isActivePropertyScopeConflict(error)) return ALREADY_SUBSCRIBED;
    throw error;
  }
}

/**
 * Adds a property to a merchant the owner already administers.
 *
 * Creates the link and nothing else where the merchant is already set up. The
 * application and provider account belong to the legal entity, so they are only
 * created when this connection has none yet, and an approved or active merchant
 * is never dragged back into DRAFT by a new property joining it.
 */
async function linkPropertyToMerchant(
  db: any,
  input: {
    ownerUserId: number;
    propertyId: number;
    merchantId: number;
    connectionId: number;
    at: Date;
  }
): Promise<
  { ok: true; merchantId: number; applicationId: number; reusedMerchant: boolean } | OnboardingRefusal
> {
  const forbidden = await assertAdministers(db, input.merchantId, input.ownerUserId);
  if (forbidden) return forbidden;

  const merchant = await db.merchantLegalEntity.findUnique({
    where: { id: input.merchantId },
    select: { status: true },
  });
  if (String(merchant?.status ?? "").toUpperCase() === "CLOSED") {
    return {
      ok: false,
      code: "merchant_not_reusable",
      message: "That company can no longer take on new properties.",
    };
  }

  const application = await currentApplication(db, input.merchantId, input.connectionId);
  const providerAccount = await db.merchantProviderAccount.findUnique({
    where: {
      merchantId_connectionId: { merchantId: input.merchantId, connectionId: input.connectionId },
    },
    select: { status: true },
  });

  try {
    return await db.$transaction(async (tx: any) => {
      await createActivePropertyLink(tx, {
        merchantId: input.merchantId,
        propertyId: input.propertyId,
        effectiveFrom: input.at,
      });

      if (!providerAccount) {
        await tx.merchantProviderAccount.create({
          data: { merchantId: input.merchantId, connectionId: input.connectionId, status: "DRAFT" },
        });
      }

      let applicationId = application?.id ?? null;
      if (!applicationId) {
        const created = await tx.merchantApplication.create({
          data: {
            merchantId: input.merchantId,
            connectionId: input.connectionId,
            version: 1,
            status: "DRAFT",
          },
          select: { id: true },
        });
        applicationId = created.id;
      }

      await audit(tx, {
        entityType: "MERCHANT",
        entityId: input.merchantId,
        action: "PROPERTY_LINKED",
        actorUserId: input.ownerUserId,
        reason: `property:${input.propertyId}`,
      });

      return {
        ok: true as const,
        merchantId: input.merchantId,
        applicationId: applicationId as number,
        reusedMerchant: true,
      };
    });
  } catch (error) {
    if (isActivePropertyScopeConflict(error)) return ALREADY_SUBSCRIBED;
    throw error;
  }
}

/**
 * Applies owner edits.
 *
 * Editing an application that was returned for correction opens a NEW version
 * rather than overwriting the one the reviewer saw, which is what keeps the
 * reviewed evidence intact.
 */
export async function updateMerchantDraft(
  db: any,
  input: { ownerUserId: number; merchantId: number; draft: MerchantDraft },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; applicationId: number; version: number } | OnboardingRefusal> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const forbidden = await assertAdministers(db, input.merchantId, input.ownerUserId);
  if (forbidden) return forbidden;

  const connection = await activeConnection(db, env);
  if (!connection) {
    return { ok: false, code: "no_connection", message: "Online payment is not available yet." };
  }

  const application = await currentApplication(db, input.merchantId, connection.id);
  if (!application) {
    return { ok: false, code: "not_subscribed", message: "This property is not subscribed." };
  }
  if (!OWNER_EDITABLE_STATUSES.has(application.status)) {
    return {
      ok: false,
      code: "not_editable",
      message: "This application is under review and cannot be edited.",
    };
  }

  const owner = await db.user.findUnique({
    where: { id: input.ownerUserId },
    select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  if (!owner) {
    return { ok: false, code: "not_administrator", message: "You do not have access to this merchant." };
  }
  const ownerDraft = sanitizeOwnerDraft(input.draft as Record<string, unknown>);
  const contactDraft = providerContactDraft(ownerSecurityContact(owner));

  return db.$transaction(async (tx: any) => {
    await tx.merchantLegalEntity.update({
      where: { id: input.merchantId },
      // Only allowlisted keys reached the draft, so this cannot write status,
      // administeredById or anything else on the model.
      data: { ...ownerDraft, ...contactDraft },
    });

    let applicationId = application.id;
    let version = application.version;

    if (REQUIRES_NEW_VERSION.has(application.status)) {
      const next = await tx.merchantApplication.create({
        data: {
          merchantId: input.merchantId,
          connectionId: connection.id,
          version: application.version + 1,
          status: "DRAFT",
        },
        select: { id: true, version: true },
      });
      applicationId = next.id;
      version = next.version;
    }

    await audit(tx, {
      entityType: "APPLICATION",
      entityId: applicationId,
      action: "APPLICATION_EDITED",
      actorUserId: input.ownerUserId,
      nextState: "DRAFT",
    });

    return { ok: true as const, applicationId, version };
  });
}

/**
 * Records acceptance of the current policy version.
 *
 * The client states which version it displayed; the server decides whether
 * that is still current and supplies the hash itself, so an owner can never be
 * recorded as accepting terms that changed while the page sat open, and a
 * crafted request cannot claim acceptance of a hash it invented.
 */
export async function acceptMerchantPolicy(
  db: any,
  input: {
    ownerUserId: number;
    merchantId: number;
    acceptedVersion: string;
    scopePropertyId?: number | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; policyVersion: string } | OnboardingRefusal> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const forbidden = await assertAdministers(db, input.merchantId, input.ownerUserId);
  if (forbidden) return forbidden;

  const policy = loadMerchantPolicy(env);
  if (!policy.ok) return { ok: false, code: policy.code, message: policy.message };

  const versionCheck = checkAcceptedVersion(policy.policy, input.acceptedVersion);
  if (!versionCheck.ok) {
    return { ok: false, code: versionCheck.code, message: versionCheck.message };
  }

  return db.$transaction(async (tx: any) => {
    // A material policy change supersedes rather than overwrites, so the
    // history of what was accepted when stays intact.
    await tx.policyAcceptance.updateMany({
      where: { merchantId: input.merchantId, policyId: policy.policy.policyId, supersededAt: null },
      data: { supersededAt: new Date() },
    });

    await tx.policyAcceptance.create({
      data: {
        merchantId: input.merchantId,
        acceptedByUserId: input.ownerUserId,
        policyId: policy.policy.policyId,
        policyVersion: policy.policy.policyVersion,
        contentHash: policy.policy.contentHash,
        scopePropertyId: input.scopePropertyId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      },
    });

    await audit(tx, {
      entityType: "MERCHANT",
      entityId: input.merchantId,
      action: "POLICY_ACCEPTED",
      actorUserId: input.ownerUserId,
      reason: `${policy.policy.policyId} ${policy.policy.policyVersion}`,
    });

    return { ok: true as const, policyVersion: policy.policy.policyVersion };
  });
}

/**
 * Freezes the application for review.
 *
 * The payload hash is computed here, from the values actually stored, so the
 * reviewer's decision is anchored to a package that can be proven unchanged at
 * provider-submission time.
 */
export async function submitMerchantApplication(
  db: any,
  input: { ownerUserId: number; merchantId: number },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; applicationId: number; version: number } | OnboardingRefusal> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const forbidden = await assertAdministers(db, input.merchantId, input.ownerUserId);
  if (forbidden) return forbidden;

  const connection = await activeConnection(db, env);
  if (!connection) {
    return { ok: false, code: "no_connection", message: "Online payment is not available yet." };
  }

  const application = await currentApplication(db, input.merchantId, connection.id);
  if (!application) {
    return { ok: false, code: "not_subscribed", message: "This property is not subscribed." };
  }
  if (!OWNER_EDITABLE_STATUSES.has(application.status)) {
    return { ok: false, code: "not_editable", message: "This application has already been submitted." };
  }

  if (!(await hasCurrentPolicyAcceptance(db, input.merchantId, env))) {
    return {
      ok: false,
      code: "policy_not_accepted",
      message: "Accept the current payment policy before submitting.",
    };
  }

  const merchant = await db.merchantLegalEntity.findUnique({
    where: { id: input.merchantId },
    select: EDITABLE_FIELDS.reduce<Record<string, boolean>>((acc, field) => {
      acc[field] = true;
      return acc;
    }, {}),
  });

  const owner = await db.user.findUnique({
    where: { id: input.ownerUserId },
    select: { tin: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
  });
  const securityContact = ownerSecurityContact(owner);
  if (!securityContact.emailVerified || !securityContact.phoneVerified) {
    return {
      ok: false,
      code: "owner_contact_not_verified",
      message: "Verify the Owner Workspace email and phone before submitting.",
    };
  }

  const contactDraft = providerContactDraft(securityContact);
  const draft = { ...sanitizeDraft(merchant ?? {}), ...contactDraft };
  const missing = missingRequiredFields(draft);
  if (missing.length > 0) {
    return {
      ok: false,
      code: "incomplete_application",
      message: `Complete every required field before submitting: ${missing.join(", ")}.`,
    };
  }

  const ownerTinStatus = ownerWorkspaceTinStatus(owner?.tin, draft.tin);
  if (ownerTinStatus === "NOT_ON_FILE") {
    return {
      ok: false,
      code: "owner_tin_not_configured",
      message: "Add the Company TIN to Owner Workspace before submitting.",
    };
  }
  if (ownerTinStatus !== "MATCH") {
    return {
      ok: false,
      code: "owner_tin_mismatch",
      message: "The Company TIN must match the TIN saved in Owner Workspace.",
    };
  }

  // Evidence comes from the Owner Workspace uploads rather than being asked
  // for a second time here.
  const documents = await loadOwnerDocuments(db, input.ownerUserId);
  const missingDocuments = missingRequiredDocuments(documents);
  if (missingDocuments.length > 0) {
    return {
      ok: false,
      code: "incomplete_application",
      message: `Upload or replace these documents in your account before submitting: ${missingDocuments.join(", ")}.`,
    };
  }

  const now = new Date();

  return db.$transaction(async (tx: any) => {
    await tx.merchantLegalEntity.update({
      where: { id: input.merchantId },
      data: contactDraft,
    });
    await tx.merchantApplication.update({
      where: { id: application.id },
      data: {
        status: "READY_FOR_ADMIN_REVIEW",
        payloadHash: applicationPayloadHash(draft),
        frozenAt: now,
        submittedAt: now,
      },
    });

    // Snapshot which uploads formed this package. Replacing them later in the
    // Owner Workspace must not silently change what a reviewer approved, so
    // the link and its state at submission are recorded here. Re-created from
    // scratch on each submission so a resubmitted version reflects the
    // evidence actually attached to it.
    await tx.merchantApplicationDocument.deleteMany({ where: { applicationId: application.id } });
    for (const document of documents) {
      if (!(REQUIRED_DOCUMENT_TYPES as readonly string[]).includes(document.documentType)) continue;
      await tx.merchantApplicationDocument.create({
        data: {
          applicationId: application.id,
          userDocumentId: document.userDocumentId,
          documentType: document.documentType,
          // The Owner Workspace's own review state, carried across as it stood.
          verificationState: document.status === "APPROVED" ? "VERIFIED" : "PENDING",
        },
      });
    }

    await audit(tx, {
      entityType: "APPLICATION",
      entityId: application.id,
      action: "APPLICATION_SUBMITTED",
      actorUserId: input.ownerUserId,
      previousState: application.status,
      nextState: "READY_FOR_ADMIN_REVIEW",
    });

    return { ok: true as const, applicationId: application.id, version: application.version };
  });
}

export type AdminDecision = "RETURN" | "REJECT" | "APPROVE";

const DECISION_STATUS: Record<AdminDecision, string> = {
  RETURN: "ACTION_REQUIRED",
  REJECT: "ADMIN_REJECTED",
  // Never ACTIVE. Approval queues provider submission and nothing more.
  APPROVE: "SUBMISSION_QUEUED",
};

const DECISION_NOTIFICATION: Record<AdminDecision, { title: string; body: string }> = {
  RETURN: {
    title: "Payment application needs attention",
    body: "NoLSAF returned your payment application for correction. Review the note and submit it again.",
  },
  REJECT: {
    title: "Payment application was not approved",
    body: "Review the decision note in Property payments for the next available action.",
  },
  APPROVE: {
    title: "Payment application approved by NoLSAF",
    body: "Secure provider submission is being prepared. Payment collection is not active yet.",
  },
};

/**
 * Records an administrator's decision.
 *
 * APPROVE queues a provider submission through the outbox; it does not
 * activate anything. Activation requires a verified provider result carrying
 * the merchant and wallet identifiers routing needs, and no code path in this
 * module can produce one.
 */
export async function decideMerchantApplication(
  db: any,
  input: {
    applicationId: number;
    adminUserId: number;
    decision: AdminDecision;
    reason: string;
    /** Only meaningful on RETURN: which sections the owner must correct. */
    correctionAreas?: readonly CorrectionArea[];
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; status: string } | OnboardingRefusal> {
  const blocked = gate(env);
  if (blocked) return blocked;

  const application = await db.merchantApplication.findUnique({
    where: { id: input.applicationId },
    select: {
      id: true,
      merchantId: true,
      connectionId: true,
      version: true,
      status: true,
      payloadHash: true,
      merchant: {
        select: {
          administeredById: true,
          ...EDITABLE_FIELDS.reduce<Record<string, boolean>>((acc, field) => {
            acc[field] = true;
            return acc;
          }, {}),
        },
      },
    },
  });
  if (!application || !DECIDABLE_STATUSES.has(application.status)) {
    return {
      ok: false,
      code: "not_decidable",
      message: "This application is not awaiting a decision.",
    };
  }

  // Separation of duties. An administrator who also administers the merchant
  // must not be able to approve their own application.
  if (application.merchant?.administeredById === input.adminUserId) {
    return {
      ok: false,
      code: "self_review_forbidden",
      message: "You cannot decide on an application for a merchant you administer.",
    };
  }

  // Approval is the step that sends the package to the provider, so the frozen
  // hash is re-verified against the merchant record as it stands right now. A
  // divergence means the reviewed package is not the stored one, and it must
  // stop the approval rather than be discovered after the provider has it.
  // Returning or rejecting an altered package stays allowed: both are safe, and
  // returning it is how the owner fixes it.
  if (input.decision === "APPROVE" && application.payloadHash) {
    const computed = applicationPayloadHash(sanitizeDraft(application.merchant ?? {}));
    if (computed !== application.payloadHash) {
      return {
        ok: false,
        code: "package_altered",
        message: "The stored details no longer match the package that was submitted. Return this application instead of approving it.",
      };
    }
  }

  const nextStatus = DECISION_STATUS[input.decision];

  return db.$transaction(async (tx: any) => {
    await tx.merchantApplication.update({
      where: { id: application.id },
      data: {
        status: nextStatus,
        reviewedById: input.adminUserId,
        reviewedAt: new Date(),
        decisionReason: input.reason.slice(0, 300),
      },
    });

    if (input.decision === "REJECT") {
      await tx.merchantProviderAccount.update({
        where: {
          merchantId_connectionId: {
            merchantId: application.merchantId,
            connectionId: application.connectionId,
          },
        },
        data: { status: "ADMIN_REJECTED", statusReason: input.reason.slice(0, 300) },
      });
    }

    if (input.decision === "APPROVE") {
      await tx.merchantProviderAccount.update({
        where: {
          merchantId_connectionId: {
            merchantId: application.merchantId,
            connectionId: application.connectionId,
          },
        },
        data: { status: "SUBMISSION_QUEUED" },
      });

      // Durable outbox, so the database state and the external submission
      // cannot silently diverge, and a timeout is retryable without creating a
      // second provider application.
      await tx.paymentOutboxJob.create({
        data: {
          jobType: "SUBMIT_MERCHANT_APPLICATION",
          targetType: "MERCHANT_APPLICATION",
          targetId: application.id,
          idempotencyKey: `submit-application:${application.id}:v${application.version}`,
        },
      });
    }

    // Areas ride on the decision's own audit row, so the record of what was
    // asked for cannot drift from the record of who asked and when.
    const flagged = input.decision === "RETURN"
      ? (input.correctionAreas ?? []).filter((area) => CORRECTION_AREAS.includes(area))
      : [];

    await audit(tx, {
      entityType: "APPLICATION",
      entityId: application.id,
      action: `APPLICATION_${input.decision}`,
      actorUserId: input.adminUserId,
      metadata: flagged.length ? { correctionAreas: flagged } : null,
      previousState: application.status,
      nextState: nextStatus,
      reason: input.reason.slice(0, 300),
    });

    const notification = DECISION_NOTIFICATION[input.decision];
    await tx.notification.create({
      data: {
        ownerId: application.merchant.administeredById,
        userId: application.merchant.administeredById,
        title: notification.title,
        body: notification.body,
        type: "invoice",
        meta: {
          kind: `merchant_application_${input.decision.toLowerCase()}`,
          applicationId: application.id,
          applicationVersion: application.version,
          actionUrl: "/owner/nrms/payments",
        },
      },
    });

    return { ok: true as const, status: nextStatus };
  });
}
