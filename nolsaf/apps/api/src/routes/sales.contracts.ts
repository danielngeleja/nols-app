// Partner-owned sales contract lifecycle.
//
// These routes intentionally do not require ACTIVE workspace access: a newly
// promoted partner must be able to read and accept the agreement before that
// entitlement can become ACTIVE. Ownership is still derived exclusively from
// the authenticated user's SalesPartnerProfile, never from request input.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import {
  buildAcceptanceHash,
  buildSalesContractFields,
  generateSalesContractPdf,
  normalizeLegalName,
  renderSalesContract,
  sha256,
} from "../lib/salesPartnerContract.js";
import { salesContractDownloadUrl } from "../lib/salesContractStorage.js";
import { hashSalesInvitationToken } from "../lib/salesContractInvitation.js";
import {
  limitSalesContractAccept,
  limitSalesContractRead,
} from "../middleware/rateLimit.js";

const router = Router();
const db = prisma as any;
router.use(requireAuth as RequestHandler);

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const acceptSchema = z
  .object({
    acceptedName: z.string().trim().min(3).max(160),
    expectedTermsHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmAuthority: z.literal(true),
    confirmIndependentContractor: z.literal(true),
    confirmMarketplaceExample: z.literal(true),
  })
  .strict();
const invitationSchema = z.object({
  token: z.string().trim().min(32).max(160).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

const contractSelect = {
  id: true,
  contractNumber: true,
  status: true,
  startsAt: true,
  expiresAt: true,
  nrmsCommissionRate: true,
  marketplaceRevenueRate: true,
  territory: true,
  contractVersion: true,
  contractFileUrl: true,
  sentAt: true,
  viewedAt: true,
  signedAt: true,
  activatedAt: true,
  terminatedAt: true,
  acceptedName: true,
  acceptanceHash: true,
  renderedContractBody: true,
  renderedFieldSnapshot: true,
  acceptedTermsHash: true,
  renderedBodyHash: true,
  pdfSha256: true,
  renewedByContractId: true,
  terminationReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

function invalid(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

async function ownProfile(userId: number) {
  return db.salesPartnerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      agentCode: true,
      status: true,
      region: true,
      territory: true,
      user: {
        select: {
          id: true,
          name: true,
          fullName: true,
          address: true,
          nin: true,
        },
      },
    },
  });
}

async function activeTrialDays(): Promise<number> {
  const now = new Date();
  const policy = await db.nrmsUsageChargePolicy.findFirst({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: "desc" },
    select: { trialDays: true },
  });
  return Number.isInteger(policy?.trialDays) ? policy.trialDays : 45;
}

function publicContract(contract: any) {
  const {
    contractFileUrl: _contractFileUrl,
    renderedContractBody: _renderedContractBody,
    renderedFieldSnapshot: _renderedFieldSnapshot,
    ...safe
  } = contract;
  return {
    ...safe,
    nrmsCommissionRate: Number(contract.nrmsCommissionRate),
    marketplaceRevenueRate: Number(contract.marketplaceRevenueRate),
    hasSignedPdf: Boolean(contract.contractFileUrl || contract.renderedContractBody),
  };
}

function timeline(contract: any) {
  const events = [
    { status: "CREATED", at: contract.createdAt },
    { status: "SENT", at: contract.sentAt },
    { status: "VIEWED", at: contract.viewedAt },
    { status: "SIGNED", at: contract.signedAt },
    { status: "ACTIVE", at: contract.activatedAt },
    { status: "TERMINATED", at: contract.terminatedAt },
  ].filter((event) => Boolean(event.at));

  const status = String(contract.status || "").toUpperCase();
  if (["EXPIRING", "EXPIRED", "RENEWED"].includes(status)) {
    events.push({
      status,
      at: status === "RENEWED" ? contract.updatedAt : contract.expiresAt,
    });
  }
  return events;
}

async function renderFor(contract: any, partner: any) {
  const trialDays = await activeTrialDays();
  const fields = buildSalesContractFields({ contract, partner, trialDays });
  const termsBody = renderSalesContract(fields);
  return { fields, termsBody, termsHash: sha256(termsBody), trialDays };
}

async function contractResponse(contract: any, partner: any) {
  let rendered;
  if (contract.renderedContractBody) {
    rendered = {
      content: contract.renderedContractBody,
      bodyHash: contract.renderedBodyHash || sha256(contract.renderedContractBody),
      termsHash:
        contract.acceptedTermsHash ||
        (contract.renderedFieldSnapshot as any)?.termsHash ||
        contract.renderedBodyHash ||
        sha256(contract.renderedContractBody),
      immutable: Boolean(contract.signedAt),
    };
  } else {
    const prepared = await renderFor(contract, partner);
    rendered = {
      content: prepared.termsBody,
      bodyHash: prepared.termsHash,
      termsHash: prepared.termsHash,
      immutable: false,
    };
  }

  return {
    partner: {
      agentCode: partner.agentCode,
      status: partner.status,
      legalName: partner.user?.fullName || partner.user?.name || null,
    },
    contract: publicContract(contract),
    rendered,
    timeline: timeline(contract),
  };
}

async function findOwnContract(userId: number, contractId: number) {
  const partner = await ownProfile(userId);
  if (!partner) return { partner: null, contract: null };
  const contract = await db.salesPartnerContract.findFirst({
    where: { id: contractId, salesPartnerId: partner.id },
    select: contractSelect,
  });
  return { partner, contract };
}

/**
 * POST /api/sales/contracts/invitation/resolve
 * Consumes a login-bound invitation. The raw token is never stored and does
 * not authorize signing; ownership still comes from the authenticated user.
 */
router.post("/contracts/invitation/resolve", limitSalesContractAccept as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = invitationSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid agreement invitation");

  const tokenHash = hashSalesInvitationToken(parsed.data.token);
  const now = new Date();
  const contract = await db.salesPartnerContract.findFirst({
    where: {
      invitationTokenHash: tokenHash,
      salesPartner: { is: { userId: req.user!.id } },
    },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      invitationExpiresAt: true,
      invitationUsedAt: true,
    },
  });
  if (!contract) {
    return res.status(404).json({ error: "This invitation is invalid or belongs to another account" });
  }
  if (contract.invitationUsedAt) {
    return res.status(410).json({
      error: "This invitation has already been used",
      code: "INVITATION_USED",
      entryPath: "/sales/contract",
    });
  }
  if (!contract.invitationExpiresAt || contract.invitationExpiresAt.getTime() <= now.getTime()) {
    return res.status(410).json({ error: "This invitation has expired", code: "INVITATION_EXPIRED" });
  }
  if (!["SENT", "VIEWED"].includes(String(contract.status))) {
    return res.status(409).json({
      error: "This agreement is no longer awaiting review",
      code: "INVITATION_NOT_OPEN",
      entryPath: "/sales/contract",
    });
  }

  const consumed = await db.salesPartnerContract.updateMany({
    where: {
      id: contract.id,
      invitationTokenHash: tokenHash,
      invitationUsedAt: null,
      invitationExpiresAt: { gt: now },
      status: { in: ["SENT", "VIEWED"] },
    },
    data: { invitationUsedAt: now },
  });
  if (consumed.count !== 1) {
    return res.status(409).json({ error: "This invitation was already processed. Open your agreement from your account." });
  }

  await audit(req, "SALES_CONTRACT_INVITATION_USED", "SALES_PARTNER_CONTRACT", null, {
    contractNumber: contract.contractNumber,
    usedAt: now,
  }, contract.id);

  return res.json({
    ok: true,
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    entryPath: "/sales/contract",
  });
}) as RequestHandler);

/** GET /api/sales/contract/current */
router.get("/contract/current", limitSalesContractRead as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const partner = await ownProfile(req.user!.id);
  if (!partner) return res.status(404).json({ error: "Sales partner profile not found" });
  const contract = await db.salesPartnerContract.findFirst({
    where: { salesPartnerId: partner.id },
    orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
    select: contractSelect,
  });
  if (!contract) return res.status(404).json({ error: "No sales partner contract found" });
  return res.json(await contractResponse(contract, partner));
}) as RequestHandler);

/** GET /api/sales/contracts */
router.get("/contracts", limitSalesContractRead as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.issues[0]?.message || "Invalid query");
  const partner = await ownProfile(req.user!.id);
  if (!partner) return res.status(404).json({ error: "Sales partner profile not found" });
  const { page, pageSize } = parsed.data;
  const where = { salesPartnerId: partner.id };
  const [total, contracts] = await Promise.all([
    db.salesPartnerContract.count({ where }),
    db.salesPartnerContract.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: contractSelect,
    }),
  ]);
  return res.json({
    total,
    page,
    pageSize,
    contracts: contracts.map(publicContract),
  });
}) as RequestHandler);

/** GET /api/sales/contracts/:id */
router.get("/contracts/:id", limitSalesContractRead as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) return invalid(res, "Invalid contract id");
  const { partner, contract } = await findOwnContract(req.user!.id, parsed.data.id);
  if (!partner || !contract) return res.status(404).json({ error: "Contract not found" });
  return res.json(await contractResponse(contract, partner));
}) as RequestHandler);

/** POST /api/sales/contracts/:id/view */
router.post("/contracts/:id/view", limitSalesContractAccept as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) return invalid(res, "Invalid contract id");
  const { partner, contract } = await findOwnContract(req.user!.id, parsed.data.id);
  if (!partner || !contract) return res.status(404).json({ error: "Contract not found" });

  if (contract.status === "SENT") {
    const now = new Date();
    const updated = await db.salesPartnerContract.updateMany({
      where: { id: contract.id, salesPartnerId: partner.id, status: "SENT" },
      data: { status: "VIEWED", viewedAt: now },
    });
    if (updated.count === 1) {
      await audit(req, "SALES_CONTRACT_VIEW", "SALES_PARTNER_CONTRACT", null, {
        contractNumber: contract.contractNumber,
        viewedAt: now,
      }, contract.id);
    }
  }
  return res.json({ ok: true });
}) as RequestHandler);

/** POST /api/sales/contracts/:id/accept */
router.post("/contracts/:id/accept", limitSalesContractAccept as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const body = acceptSchema.safeParse(req.body);
  if (!params.success) return invalid(res, "Invalid contract id");
  if (!body.success) return invalid(res, body.error.issues[0]?.message || "Invalid acceptance");

  const { partner, contract } = await findOwnContract(req.user!.id, params.data.id);
  if (!partner || !contract) return res.status(404).json({ error: "Contract not found" });

  if (["SIGNED", "ACTIVE", "EXPIRING", "RENEWED"].includes(String(contract.status))) {
    return res.json({ ok: true, alreadyAccepted: true, contract: publicContract(contract) });
  }
  if (!["SENT", "VIEWED"].includes(String(contract.status))) {
    return res.status(409).json({ error: "This contract is not open for acceptance" });
  }
  if (contract.expiresAt.getTime() <= Date.now()) {
    return res.status(409).json({ error: "This agreement has expired and can no longer be accepted" });
  }

  const legalName = String(partner.user?.fullName || partner.user?.name || "").trim();
  if (normalizeLegalName(body.data.acceptedName) !== normalizeLegalName(legalName)) {
    return res.status(400).json({ error: "Typed name must match the legal name on the agreement" });
  }

  let prepared;
  try {
    prepared = await renderFor(contract, partner);
  } catch (error: any) {
    return res.status(409).json({
      error: "Agreement is missing required identity or commercial information",
      details: process.env.NODE_ENV === "development" ? error?.message : undefined,
    });
  }
  if (body.data.expectedTermsHash !== prepared.termsHash) {
    return res.status(409).json({
      error: "The agreement changed after it was opened. Review the latest version before accepting.",
      code: "CONTRACT_CHANGED",
    });
  }

  const signedAt = new Date();
  const signedAtIso = signedAt.toISOString();
  const ipAddress = String(req.ip || req.socket.remoteAddress || "").slice(0, 64);
  const userAgent = String(req.get("user-agent") || "").slice(0, 255);
  const acceptanceHash = buildAcceptanceHash(prepared.termsBody, {
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    partnerId: partner.id,
    userId: req.user!.id,
    acceptedName: legalName,
    signedAt: signedAtIso,
    ipAddress,
    userAgent,
  });
  const signedFields = buildSalesContractFields({
    contract,
    partner,
    trialDays: prepared.trialDays,
    signedAt,
    acceptanceHash,
  });
  const renderedContractBody = renderSalesContract(signedFields);
  const renderedBodyHash = sha256(renderedContractBody);

  const updated = await db.salesPartnerContract.updateMany({
    where: {
      id: contract.id,
      salesPartnerId: partner.id,
      status: { in: ["SENT", "VIEWED"] },
      signedAt: null,
    },
    data: {
      status: "SIGNED",
      viewedAt: contract.viewedAt || signedAt,
      signedAt,
      acceptedIpAddress: ipAddress,
      acceptedUserAgent: userAgent,
      acceptedName: legalName,
      acceptanceHash,
      acceptedTermsHash: prepared.termsHash,
      renderedContractBody,
      renderedBodyHash,
      renderedFieldSnapshot: {
        ...signedFields,
        termsHash: prepared.termsHash,
      },
    },
  });
  if (updated.count !== 1) {
    return res.status(409).json({ error: "Contract acceptance was already processed. Refresh to continue." });
  }

  await audit(req, "SALES_CONTRACT_ACCEPT", "SALES_PARTNER_CONTRACT", null, {
    contractNumber: contract.contractNumber,
    signedAt,
    acceptanceHash,
    renderedBodyHash,
  }, contract.id);
  await Promise.all([
    notifyUser(req.user!.id, "sales_partner_contract_signed", {
      contractNumber: contract.contractNumber,
      signedAt,
      actionPath: "/sales/contract",
    }),
    notifyAdmins("sales_partner_contract_signed", {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      partnerId: partner.id,
      agentCode: partner.agentCode,
    }),
  ]);

  return res.json({
    ok: true,
    contract: {
      ...publicContract({ ...contract, status: "SIGNED", signedAt, acceptanceHash, renderedBodyHash }),
      acceptanceHash,
    },
  });
}) as RequestHandler);

/** GET /api/sales/contracts/:id/download */
router.get("/contracts/:id/download", limitSalesContractRead as any, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) return invalid(res, "Invalid contract id");
  const { partner, contract } = await findOwnContract(req.user!.id, parsed.data.id);
  if (!partner || !contract) return res.status(404).json({ error: "Contract not found" });

  if (contract.contractFileUrl) {
    const url = await salesContractDownloadUrl(contract.contractFileUrl);
    if (url) return res.redirect(302, url);
  }

  let body = contract.renderedContractBody;
  if (!body) {
    try {
      body = (await renderFor(contract, partner)).termsBody;
    } catch (error: any) {
      return res.status(409).json({
        error: "Agreement cannot be rendered until required profile information is complete",
        details: process.env.NODE_ENV === "development" ? error?.message : undefined,
      });
    }
  }
  const pdf = await generateSalesContractPdf(body);
  const filename = `${String(contract.contractNumber).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(pdf.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(pdf);
}) as RequestHandler);

export default router;
