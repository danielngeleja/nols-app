import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { audit } from "../lib/audit.js";
import {
  CHANNEL_TYPES,
  VERIFICATION_CATEGORIES,
  VERIFICATION_STATUSES,
  canPublishVerification,
  findForbiddenClaim,
  normalizeRegistrationNumber,
} from "../lib/trustVerification.js";
import { trustVerificationPublicEnabled } from "./public.trustVerification.js";

/**
 * Admin workspace for corporate verification records and authorised channels.
 *
 * Every state change is audited, because the question this feature answers in
 * an incident is "who said this was true, and when". Approving evidence and
 * publishing are separate actions on purpose: the person who checks a document
 * and the moment a claim goes public are different facts.
 *
 * Impersonated sessions are blocked outright. Publishing a corporate identity
 * claim is not something to do while wearing someone else's account.
 */
const router = Router();
router.use(
  requireAuth as RequestHandler,
  requireRole("ADMIN") as RequestHandler,
  blockImpersonated as RequestHandler,
);

const verificationInput = z.object({
  key: z.string().trim().min(3).max(80).regex(/^[A-Z0-9_]+$/, "Key must be uppercase letters, numbers, and underscores"),
  category: z.enum(VERIFICATION_CATEGORIES),
  displayName: z.string().trim().min(2).max(160),
  authorityName: z.string().trim().max(160).nullish(),
  authorityDomain: z.string().trim().max(160).nullish(),
  jurisdiction: z.string().trim().max(120).nullish(),
  registrationNumber: z.string().trim().max(120).nullish(),
  publicSummary: z.string().trim().max(4000).nullish(),
  status: z.enum(VERIFICATION_STATUSES).optional(),
  externalVerificationUrl: z.string().trim().url().max(500).nullish(),
  issuedAt: z.string().datetime().nullish(),
  expiresAt: z.string().datetime().nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const channelInput = z.object({
  channelType: z.enum(CHANNEL_TYPES),
  label: z.string().trim().min(2).max(160),
  value: z.string().trim().min(1).max(500),
  href: z.string().trim().url().max(500).nullish(),
  notes: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ── Verification records ────────────────────────────────────────────────────

router.get("/records", asyncHandler(async (_req: any, res: any) => {
  const records = await prisma.companyVerification.findMany({
    orderBy: [{ archivedAt: "asc" }, { category: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: {
      evidenceApprovedBy: { select: { id: true, name: true, email: true } },
      publishedBy: { select: { id: true, name: true, email: true } },
    },
  });
  // The flag travels with the list so the workspace can say plainly whether
  // anything published here is actually reachable by the public yet.
  return res.json({ ok: true, data: records, meta: { publicPageEnabled: trustVerificationPublicEnabled() } });
}));

router.post("/records", asyncHandler(async (req: any, res: any) => {
  const parsed = verificationInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid record" });
  }
  const input = parsed.data;

  const claim = findForbiddenClaim(input.displayName, input.publicSummary, input.authorityName);
  if (claim) return res.status(400).json({ ok: false, error: claim });

  const adminId = req.user?.id as number;
  const created = await prisma.companyVerification.create({
    data: {
      key: input.key,
      category: input.category,
      displayName: input.displayName,
      authorityName: input.authorityName ?? null,
      authorityDomain: input.authorityDomain ?? null,
      jurisdiction: input.jurisdiction ?? null,
      registrationNumber: input.registrationNumber ?? null,
      registrationNumberNormalized: normalizeRegistrationNumber(input.registrationNumber),
      publicSummary: input.publicSummary ?? null,
      // New records always start private and unpublished, whatever was sent.
      status: input.status ?? "DRAFT",
      visibility: "PRIVATE",
      externalVerificationUrl: input.externalVerificationUrl ?? null,
      issuedAt: toDate(input.issuedAt),
      expiresAt: toDate(input.expiresAt),
      sortOrder: input.sortOrder ?? 0,
      createdById: adminId,
      updatedById: adminId,
    },
  });

  await audit(req, "TRUST_VERIFICATION_RECORD_CREATE", `company_verification:${created.id}`, null, created, created.id);
  return res.status(201).json({ ok: true, data: created });
}));

router.patch("/records/:id", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid id" });

  const existing = await prisma.companyVerification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Record not found" });
  if (existing.archivedAt) return res.status(409).json({ ok: false, error: "Archived records cannot be edited." });

  const parsed = verificationInput.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid record" });
  }
  const input = parsed.data;

  const claim = findForbiddenClaim(input.displayName, input.publicSummary, input.authorityName);
  if (claim) return res.status(400).json({ ok: false, error: claim });

  /**
   * Editing the substance of a published claim retracts it. The alternative is
   * a record that says one thing publicly while its evidence describes another,
   * which is the exact failure this feature exists to prevent.
   */
  const substantiveKeys = [
    "displayName",
    "authorityName",
    "registrationNumber",
    "publicSummary",
    "externalVerificationUrl",
    "jurisdiction",
    "issuedAt",
    "expiresAt",
  ] as const;
  const substantiveChange = substantiveKeys.some(
    (field) => field in input && (input as any)[field] !== undefined,
  );
  const retract = substantiveChange && Boolean(existing.publishedAt);

  const adminId = req.user?.id as number;
  const updated = await prisma.companyVerification.update({
    where: { id },
    data: {
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.authorityName !== undefined ? { authorityName: input.authorityName ?? null } : {}),
      ...(input.authorityDomain !== undefined ? { authorityDomain: input.authorityDomain ?? null } : {}),
      ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction ?? null } : {}),
      ...(input.registrationNumber !== undefined
        ? {
            registrationNumber: input.registrationNumber ?? null,
            registrationNumberNormalized: normalizeRegistrationNumber(input.registrationNumber),
          }
        : {}),
      ...(input.publicSummary !== undefined ? { publicSummary: input.publicSummary ?? null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.externalVerificationUrl !== undefined
        ? { externalVerificationUrl: input.externalVerificationUrl ?? null }
        : {}),
      ...(input.issuedAt !== undefined ? { issuedAt: toDate(input.issuedAt) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: toDate(input.expiresAt) } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(retract
        ? {
            visibility: "PRIVATE",
            publishedAt: null,
            publishedById: null,
            evidenceApprovedAt: null,
            evidenceApprovedById: null,
          }
        : {}),
      updatedById: adminId,
    },
  });

  await audit(
    req,
    retract ? "TRUST_VERIFICATION_RECORD_EDIT_RETRACTED" : "TRUST_VERIFICATION_RECORD_UPDATE",
    `company_verification:${id}`,
    existing,
    updated,
    id,
  );
  return res.json({ ok: true, data: updated, retracted: retract });
}));

router.post("/records/:id/approve-evidence", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const note = String(req.body?.note || "").trim().slice(0, 1000);
  if (!note) return res.status(400).json({ ok: false, error: "Describe the evidence you checked." });

  const existing = await prisma.companyVerification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Record not found" });
  if (existing.archivedAt) return res.status(409).json({ ok: false, error: "Archived records cannot be approved." });

  const adminId = req.user?.id as number;
  const updated = await prisma.companyVerification.update({
    where: { id },
    data: { evidenceApprovedAt: new Date(), evidenceApprovedById: adminId, evidenceNote: note, updatedById: adminId },
  });

  await audit(req, "TRUST_VERIFICATION_EVIDENCE_APPROVE", `company_verification:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

router.post("/records/:id/publish", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const existing = await prisma.companyVerification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Record not found" });

  const gate = canPublishVerification(existing);
  if (!gate.ok) return res.status(409).json({ ok: false, error: gate.reason });

  const adminId = req.user?.id as number;
  const updated = await prisma.companyVerification.update({
    where: { id },
    data: { visibility: "PUBLIC", publishedAt: new Date(), publishedById: adminId, updatedById: adminId },
  });

  await audit(req, "TRUST_VERIFICATION_PUBLISH", `company_verification:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

/** One click, always available. A disputed claim must come down immediately. */
router.post("/records/:id/unpublish", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const existing = await prisma.companyVerification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Record not found" });

  const adminId = req.user?.id as number;
  const updated = await prisma.companyVerification.update({
    where: { id },
    data: { visibility: "PRIVATE", publishedAt: null, publishedById: null, updatedById: adminId },
  });

  await audit(req, "TRUST_VERIFICATION_UNPUBLISH", `company_verification:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

/** Archive, never delete: the history of what was claimed has to survive. */
router.post("/records/:id/archive", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const existing = await prisma.companyVerification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Record not found" });

  const adminId = req.user?.id as number;
  const updated = await prisma.companyVerification.update({
    where: { id },
    data: { archivedAt: new Date(), visibility: "PRIVATE", publishedAt: null, publishedById: null, updatedById: adminId },
  });

  await audit(req, "TRUST_VERIFICATION_ARCHIVE", `company_verification:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

// ── Authorised channels ─────────────────────────────────────────────────────

router.get("/channels", asyncHandler(async (_req: any, res: any) => {
  const channels = await prisma.officialCompanyChannel.findMany({
    orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: { confirmedBy: { select: { id: true, name: true, email: true } } },
  });
  return res.json({ ok: true, data: channels });
}));

router.post("/channels", asyncHandler(async (req: any, res: any) => {
  const parsed = channelInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid channel" });
  }
  const input = parsed.data;
  const adminId = req.user?.id as number;

  const created = await prisma.officialCompanyChannel.create({
    data: {
      channelType: input.channelType,
      label: input.label,
      value: input.value,
      href: input.href ?? null,
      notes: input.notes ?? null,
      sortOrder: input.sortOrder ?? 0,
      visibility: "PRIVATE",
      createdById: adminId,
      updatedById: adminId,
    },
  });

  await audit(req, "TRUST_CHANNEL_CREATE", `official_company_channel:${created.id}`, null, created, created.id);
  return res.status(201).json({ ok: true, data: created });
}));

router.post("/channels/:id/confirm", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const existing = await prisma.officialCompanyChannel.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Channel not found" });

  const adminId = req.user?.id as number;
  const updated = await prisma.officialCompanyChannel.update({
    where: { id },
    data: { confirmedAt: new Date(), confirmedById: adminId, updatedById: adminId },
  });

  await audit(req, "TRUST_CHANNEL_CONFIRM", `official_company_channel:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

router.post("/channels/:id/publish", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const existing = await prisma.officialCompanyChannel.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Channel not found" });
  if (existing.archivedAt) return res.status(409).json({ ok: false, error: "Archived channels cannot be published." });
  if (!existing.confirmedAt) {
    return res.status(409).json({ ok: false, error: "Confirm ownership of this channel before publishing it." });
  }

  const adminId = req.user?.id as number;
  const updated = await prisma.officialCompanyChannel.update({
    where: { id },
    data: { visibility: "PUBLIC", publishedAt: new Date(), updatedById: adminId },
  });

  await audit(req, "TRUST_CHANNEL_PUBLISH", `official_company_channel:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

router.post("/channels/:id/unpublish", asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const existing = await prisma.officialCompanyChannel.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Channel not found" });

  const adminId = req.user?.id as number;
  const updated = await prisma.officialCompanyChannel.update({
    where: { id },
    data: { visibility: "PRIVATE", publishedAt: null, updatedById: adminId },
  });

  await audit(req, "TRUST_CHANNEL_UNPUBLISH", `official_company_channel:${id}`, existing, updated, id);
  return res.json({ ok: true, data: updated });
}));

export default router;
