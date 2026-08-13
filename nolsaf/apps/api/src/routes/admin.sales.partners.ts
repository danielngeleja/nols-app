// Sales Partner Workspace, admin: promote an existing user, and manage the
// resulting partner record.
//
// Promotion never creates a user and never changes User.role. It attaches a
// sales identity, a pending workspace entitlement and a first contract to an
// account that already exists. Access only becomes usable once the partner
// signs, which is handled in the contract routes.
//
// See docs/SALES_PARTNER_WORKSPACE.md sections 4, 9.6 and 13.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { audit } from "../lib/audit.js";
import { notifyUser } from "../lib/notifications.js";
import { sendMail } from "../lib/mailer.js";
import { salesAgreementInvitationEmail } from "../lib/salesPartnerEmails.js";
import { createSalesContractInvitation } from "../lib/salesContractInvitation.js";
import { sanitizeText } from "../lib/sanitize.js";
import {
  finalizeAcceptedSalesContractFields,
  generateSalesContractPdf,
  renderSalesContract,
  sha256,
} from "../lib/salesPartnerContract.js";
import { storeSalesContractPdf } from "../lib/salesContractStorage.js";
import {
  CONTRACT_TERM_DAYS,
  FALLBACK_MARKETPLACE_REVENUE_PERCENT,
  FALLBACK_NRMS_COMMISSION_PERCENT,
  SALES_PARTNER_STATUSES,
  buildAgentCode,
  maskPayoutAccount,
} from "../lib/salesPartner.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;

const DAY_MS = 24 * 60 * 60 * 1000;

function webOrigin(): string {
  const candidate =
    process.env.WEB_ORIGIN ||
    process.env.APP_ORIGIN ||
    process.env.APP_URL ||
    "https://www.nolsaf.com";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://www.nolsaf.com";
  }
}

async function deliverAgreementInvitation(input: {
  email: string;
  recipientName: string;
  agentCode: string;
  contractNumber: string;
  invitationToken: string;
  invitationExpiresAt: Date;
}) {
  const invitationUrl = `${webOrigin()}/sales/invite?t=${encodeURIComponent(input.invitationToken)}`;
  const email = salesAgreementInvitationEmail({
    recipientName: input.recipientName,
    agentCode: input.agentCode,
    contractNumber: input.contractNumber,
    invitationUrl,
    invitationExpiresAt: input.invitationExpiresAt,
  });
  return sendMail(input.email, email.subject, email.html, undefined, {
    // This is an account/contract action initiated by an administrator, not a
    // marketing notification. A user's optional notification preferences must
    // not silently suppress the agreement they are required to review.
    bypassEligibilityCheck: true,
    replyTo: "support@nolsaf.com",
    sensitiveContent: true,
  });
}

const reason = z.string().trim().min(5).max(300).transform(sanitizeText);
const rate = z.coerce.number().finite().min(0).max(100);

const promoteSchema = z.object({
  userId: z.coerce.number().int().positive(),
  region: z.string().trim().min(2).max(120).transform(sanitizeText),
  territory: z.string().trim().max(200).transform(sanitizeText).optional(),
  phone: z.string().trim().max(40).optional(),
  /** Omit to take the platform defaults from SystemSetting. */
  nrmsCommissionRate: rate.optional(),
  marketplaceRevenueRate: rate.optional(),
  startsAt: z.coerce.date().optional(),
  termDays: z.coerce.number().int().min(30).max(1095).default(CONTRACT_TERM_DAYS),
  reason,
});

const activateContractSchema = z
  .object({
    signatoryName: z.string().trim().min(3).max(160).transform(sanitizeText),
    signatoryTitle: z.string().trim().min(2).max(120).transform(sanitizeText),
    reason,
  })
  .strict();

const listSchema = z.object({
  status: z.enum(SALES_PARTNER_STATUSES).optional(),
  region: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

class PromotionConflictError extends Error {}

function fail(res: Response, parsed: { success: boolean; error?: any }): boolean {
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
    return true;
  }
  return false;
}

/** Platform default rates. The contract snapshots them, so later edits here never rewrite a signed agreement. */
async function defaultRates(): Promise<{ nrms: number; marketplace: number }> {
  const settings = await db.systemSetting.findFirst({
    select: { salesNrmsCommissionPercent: true, salesMarketplaceRevenuePercent: true },
  });
  return {
    nrms: Number(settings?.salesNrmsCommissionPercent ?? FALLBACK_NRMS_COMMISSION_PERCENT),
    marketplace: Number(settings?.salesMarketplaceRevenuePercent ?? FALLBACK_MARKETPLACE_REVENUE_PERCENT),
  };
}

/**
 * Next agent code for a region. Read inside the promotion transaction so two
 * concurrent promotions cannot mint the same code; the unique index on
 * agentCode is the backstop if they race anyway.
 */
async function nextAgentCode(tx: any, region: string): Promise<string> {
  const prefix = buildAgentCode(region, 0).slice(0, -4);
  const last = await tx.salesPartnerProfile.findFirst({
    where: { agentCode: { startsWith: prefix } },
    orderBy: { agentCode: "desc" },
    select: { agentCode: true },
  });
  const lastSeq = last ? Number(String(last.agentCode).slice(-4)) : 0;
  return buildAgentCode(region, (Number.isFinite(lastSeq) ? lastSeq : 0) + 1);
}

/**
 * GET /admin/sales/users/search
 * Find an existing registered user to promote. Deliberately narrow: it returns
 * only what is needed to identify the right person, plus whether they already
 * hold a partner profile.
 */
router.get("/users/search", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.status(400).json({ error: "Search term must be at least 3 characters" });

  const users = await db.user.findMany({
    where: {
      OR: [{ email: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }],
    },
    take: 20,
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      emailVerifiedAt: true,
      suspendedAt: true,
      isDisabled: true,
      address: true,
      nin: true,
      salesPartnerProfile: { select: { id: true, agentCode: true, status: true } },
    },
  });

  res.json({
    users: users.map((user: any) => {
      const missingSalesFields = [
        !user.suspendedAt && user.isDisabled !== true ? null : "active account",
        user.fullName || user.name ? null : "legal name",
        user.email && user.emailVerifiedAt ? null : "verified email address",
        user.address ? null : "address",
        user.nin ? null : "identity number",
      ].filter(Boolean);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt,
        alreadyPartner: Boolean(user.salesPartnerProfile),
        partner: user.salesPartnerProfile || null,
        salesProfileReady: missingSalesFields.length === 0,
        missingSalesFields,
      };
    }),
  });
}) as RequestHandler);

/**
 * POST /admin/sales/partners/promote
 * One atomic transaction: confirm the user exists, confirm no profile exists,
 * create the profile, mint the agent code, create PENDING workspace access, and
 * create the first contract in SENT.
 *
 * Access stays PENDING until the contract is signed. Nothing here grants entry.
 */
router.post("/partners/promote", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = promoteSchema.safeParse(req.body);
  if (fail(res, parsed)) return;
  const input = parsed.data!;
  const admin = req.user!;

  const rates = await defaultRates();
  const startsAt = input.startsAt || new Date();
  const expiresAt = new Date(startsAt.getTime() + input.termDays * DAY_MS);
  const nrmsRate = input.nrmsCommissionRate ?? rates.nrms;
  const marketplaceRate = input.marketplaceRevenueRate ?? rates.marketplace;
  const invitation = createSalesContractInvitation(expiresAt);
  const invitationToken = invitation.token;
  const invitationTokenHash = invitation.tokenHash;
  const invitationExpiresAt = invitation.expiresAt;

  try {
    const result = await db.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          name: true,
          fullName: true,
          email: true,
          emailVerifiedAt: true,
          address: true,
          nin: true,
          suspendedAt: true,
          isDisabled: true,
        },
      });
      if (!user) throw new PromotionConflictError("User not found");
      if (user.suspendedAt || user.isDisabled === true) {
        throw new PromotionConflictError("Cannot promote a suspended or disabled account");
      }
      const missingIdentity = [
        user.fullName || user.name ? null : "legal name",
        user.email && user.emailVerifiedAt ? null : "verified email address",
        user.address ? null : "address",
        user.nin ? null : "identity number",
      ].filter(Boolean);
      if (missingIdentity.length) {
        throw new PromotionConflictError(
          `Complete the user's ${missingIdentity.join(", ")} before sending an agreement`,
        );
      }

      const existing = await tx.salesPartnerProfile.findUnique({
        where: { userId: input.userId },
        select: { id: true, agentCode: true },
      });
      if (existing) throw new PromotionConflictError(`User is already a sales partner (${existing.agentCode})`);

      const agentCode = await nextAgentCode(tx, input.region);

      const profile = await tx.salesPartnerProfile.create({
        data: {
          userId: input.userId,
          agentCode,
          status: "PENDING",
          level: "STARTER",
          region: input.region,
          territory: input.territory || null,
          phone: input.phone || null,
        },
        select: { id: true, agentCode: true, status: true, region: true },
      });

      // Entitlement exists but is PENDING: it grants nothing until the contract
      // is signed and an admin activates it.
      await tx.userWorkspaceAccess.upsert({
        where: { userId_workspace: { userId: input.userId, workspace: "SALES" } },
        create: {
          userId: input.userId,
          workspace: "SALES",
          status: "PENDING",
          grantedById: admin.id,
          grantedAt: new Date(),
          expiresAt,
          statusReason: input.reason,
        },
        update: {
          status: "PENDING",
          grantedById: admin.id,
          grantedAt: new Date(),
          expiresAt,
          statusReason: input.reason,
          revokedAt: null,
          revokedById: null,
        },
      });

      const contractNumber = `NSC-${new Date().getFullYear()}-${String(profile.id).padStart(5, "0")}`;
      const contract = await tx.salesPartnerContract.create({
        data: {
          salesPartnerId: profile.id,
          contractNumber,
          status: "SENT",
          startsAt,
          expiresAt,
          nrmsCommissionRate: nrmsRate,
          marketplaceRevenueRate: marketplaceRate,
          territory: input.territory || null,
          contractVersion: "1.0.0",
          sentAt: new Date(),
          invitationTokenHash,
          invitationSentAt: new Date(),
          invitationExpiresAt,
          createdById: admin.id,
        },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          startsAt: true,
          expiresAt: true,
          nrmsCommissionRate: true,
          marketplaceRevenueRate: true,
        },
      });

      return { user, profile, contract };
    });

    await audit(
      req,
      "SALES_PARTNER_PROMOTE",
      "SALES_PARTNER_PROFILE",
      null,
      {
        userId: input.userId,
        agentCode: result.profile.agentCode,
        region: input.region,
        contractNumber: result.contract.contractNumber,
        nrmsCommissionRate: nrmsRate,
        marketplaceRevenueRate: marketplaceRate,
        reason: input.reason,
      },
      result.profile.id,
    );

    await notifyUser(input.userId, "sales_partner_contract_sent", {
      agentCode: result.profile.agentCode,
      contractNumber: result.contract.contractNumber,
      expiresAt: result.contract.expiresAt,
      actionPath: "/sales/contract",
    }).catch(() => {});

    let emailDelivery: { status: "SENT" | "FAILED"; provider?: string } = { status: "FAILED" };
    try {
      const delivery = await deliverAgreementInvitation({
        email: result.user.email,
        recipientName: result.user.fullName || result.user.name || "Partner",
        agentCode: result.profile.agentCode,
        contractNumber: result.contract.contractNumber,
        invitationToken,
        invitationExpiresAt,
      });
      emailDelivery = {
        status: delivery?.provider === "suppressed" ? "FAILED" : "SENT",
        provider: delivery?.provider,
      };
    } catch (emailError: any) {
      console.error("Sales agreement invitation email failed:", {
        userId: input.userId,
        contractId: result.contract.id,
        message: emailError?.message || "Unknown email error",
      });
    }

    return res.status(201).json({
      partner: result.profile,
      contract: result.contract,
      // Says plainly that promotion alone opens nothing.
      workspaceAccess: { status: "PENDING", activatesOn: "contract signature and admin activation" },
      invitation: { expiresAt: invitationExpiresAt, emailDelivery },
    });
  } catch (error: any) {
    if (error instanceof PromotionConflictError) {
      return res.status(409).json({ error: error.message });
    }
    console.error("Sales partner promotion failed:", error);
    return res.status(500).json({ error: "Could not promote user" });
  }
}) as RequestHandler);

/** GET /admin/sales/partners */
router.get("/partners", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (fail(res, parsed)) return;
  const { status, region, q, page, pageSize } = parsed.data!;

  const where: any = {};
  if (status) where.status = status;
  if (region) where.region = region;
  if (q) {
    where.OR = [
      { agentCode: { contains: q } },
      { user: { is: { name: { contains: q } } } },
      { user: { is: { email: { contains: q } } } },
    ];
  }

  const [total, partners, statusGroups] = await Promise.all([
    db.salesPartnerProfile.count({ where }),
    db.salesPartnerProfile.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        agentCode: true,
        status: true,
        level: true,
        region: true,
        activatedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { attributions: true, leads: true } },
      },
    }),
    db.salesPartnerProfile.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    statusGroups.map((item: any) => [item.status, Number(item._count?._all || 0)]),
  );
  res.json({ total, page, pageSize, partners, statusCounts });
}) as RequestHandler);

/** GET /admin/sales/partners/:id */
router.get("/partners/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });

  const partner = await db.salesPartnerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      agentCode: true,
      status: true,
      level: true,
      region: true,
      territory: true,
      phone: true,
      payoutName: true,
      payoutMethod: true,
      payoutAccount: true,
      activatedAt: true,
      suspendedAt: true,
      terminatedAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      contracts: {
        orderBy: { id: "desc" },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          startsAt: true,
          expiresAt: true,
          nrmsCommissionRate: true,
          marketplaceRevenueRate: true,
          signedAt: true,
          activatedAt: true,
          invitationSentAt: true,
          invitationExpiresAt: true,
          invitationUsedAt: true,
        },
      },
      _count: { select: { attributions: true, leads: true, commissions: true, payoutRequests: true } },
    },
  });
  if (!partner) return res.status(404).json({ error: "Partner not found" });

  const access = await db.userWorkspaceAccess.findUnique({
    where: { userId_workspace: { userId: partner.user.id, workspace: "SALES" } },
    select: { status: true, grantedAt: true, expiresAt: true, suspendedAt: true, revokedAt: true },
  });

  res.json({
    partner: {
      ...partner,
      // Admin sees the destination, not the number. Only the owning partner
      // sees their own account, and even then only the last four.
      payoutAccount: maskPayoutAccount(partner.payoutAccount),
    },
    workspaceAccess: access,
  });
}) as RequestHandler);

/**
 * POST /admin/sales/contracts/:id/resend-invitation
 * Rotate the single-use token first so any older invitation stops working.
 */
router.post("/contracts/:id/resend-invitation", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid contract id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (fail(res, parsed)) return;

  const contract = await db.salesPartnerContract.findUnique({
    where: { id },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      expiresAt: true,
      salesPartner: {
        select: {
          agentCode: true,
          user: { select: { id: true, name: true, fullName: true, email: true, emailVerifiedAt: true } },
        },
      },
    },
  });
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  if (!["SENT", "VIEWED"].includes(String(contract.status))) {
    return res.status(409).json({ error: "Only an unsigned agreement can receive a new invitation" });
  }
  if (!contract.salesPartner.user.email || !contract.salesPartner.user.emailVerifiedAt) {
    return res.status(409).json({ error: "The partner must have a verified email address" });
  }
  if (contract.expiresAt.getTime() <= Date.now()) {
    return res.status(409).json({ error: "This agreement has expired" });
  }

  const invitation = createSalesContractInvitation(contract.expiresAt);
  const invitationToken = invitation.token;
  const invitationTokenHash = invitation.tokenHash;
  const invitationExpiresAt = invitation.expiresAt;
  await db.salesPartnerContract.update({
    where: { id: contract.id },
    data: {
      invitationTokenHash,
      invitationSentAt: new Date(),
      invitationExpiresAt,
      invitationUsedAt: null,
    },
  });

  try {
    const delivery = await deliverAgreementInvitation({
      email: contract.salesPartner.user.email,
      recipientName: contract.salesPartner.user.fullName || contract.salesPartner.user.name || "Partner",
      agentCode: contract.salesPartner.agentCode,
      contractNumber: contract.contractNumber,
      invitationToken,
      invitationExpiresAt,
    });
    if (delivery?.provider === "suppressed") throw new Error("Email delivery is suppressed for this account");
    await audit(req, "SALES_CONTRACT_INVITATION_RESENT", "SALES_PARTNER_CONTRACT", null, {
      contractNumber: contract.contractNumber,
      invitationExpiresAt,
      provider: delivery?.provider,
      reason: parsed.data!.reason,
    }, contract.id);
    return res.json({
      ok: true,
      invitation: { expiresAt: invitationExpiresAt, emailDelivery: { status: "SENT", provider: delivery?.provider } },
    });
  } catch (error: any) {
    console.error("Sales agreement invitation resend failed:", {
      userId: contract.salesPartner.user.id,
      contractId: contract.id,
      message: error?.message || "Unknown email error",
    });
    return res.status(502).json({ error: "The invitation was rotated, but the email could not be delivered" });
  }
}) as RequestHandler);

/**
 * POST /admin/sales/contracts/:id/activate
 * Countersign a partner-signed agreement and atomically open the workspace.
 * A future-dated or expired agreement cannot be activated early/late.
 */
router.post("/contracts/:id/activate", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid contract id" });
  const parsed = activateContractSchema.safeParse(req.body);
  if (fail(res, parsed)) return;
  const input = parsed.data!;
  const now = new Date();

  const contract = await db.salesPartnerContract.findUnique({
    where: { id },
    select: {
      id: true,
      salesPartnerId: true,
      contractNumber: true,
      contractVersion: true,
      contractFileUrl: true,
      status: true,
      startsAt: true,
      expiresAt: true,
      nrmsCommissionRate: true,
      marketplaceRevenueRate: true,
      territory: true,
      signedAt: true,
      acceptanceHash: true,
      renderedFieldSnapshot: true,
      salesPartner: {
        select: {
          id: true,
          userId: true,
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
      },
    },
  });
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  if (contract.status === "ACTIVE") {
    return res.json({ ok: true, alreadyActive: true, contract: { id: contract.id, status: contract.status } });
  }
  if (contract.status !== "SIGNED" || !contract.signedAt || !contract.acceptanceHash) {
    return res.status(409).json({ error: "Only a partner-signed agreement can be activated" });
  }
  if (contract.startsAt.getTime() > now.getTime()) {
    return res.status(409).json({ error: "A future-dated agreement cannot be activated before its start date" });
  }
  if (contract.expiresAt.getTime() <= now.getTime()) {
    return res.status(409).json({ error: "An expired agreement cannot be activated" });
  }

  let fields: Record<string, string>;
  try {
    fields = finalizeAcceptedSalesContractFields(contract.renderedFieldSnapshot, {
      activatedAt: now,
      signatoryName: input.signatoryName,
      signatoryTitle: input.signatoryTitle,
    });
  } catch {
    return res.status(409).json({ error: "The immutable partner-signed field snapshot is missing" });
  }
  // Never rebuild signed commercial/legal terms from the current user,
  // profile, policy or defaults. Activation may append only NoLSAF's
  // countersignature fields to the snapshot the partner accepted.
  const renderedContractBody = renderSalesContract(fields);
  const renderedBodyHash = sha256(renderedContractBody);
  const pdf = await generateSalesContractPdf(renderedContractBody);
  const pdfSha256 = sha256(pdf);

  let contractFileUrl: string | null = null;
  try {
    contractFileUrl = await storeSalesContractPdf({
      partnerId: contract.salesPartnerId,
      contractNumber: contract.contractNumber,
      pdfSha256,
      pdf,
    });
  } catch (error: any) {
    console.error("Sales contract PDF storage failed:", error);
    return res.status(503).json({ error: "The signed PDF could not be stored; activation was not applied" });
  }

  try {
    await db.$transaction(async (tx: any) => {
      const activated = await tx.salesPartnerContract.updateMany({
        where: {
          id: contract.id,
          salesPartnerId: contract.salesPartnerId,
          status: "SIGNED",
          signedAt: { not: null },
          acceptanceHash: { not: null },
        },
        data: {
          status: "ACTIVE",
          activatedAt: now,
          renderedContractBody,
          renderedBodyHash,
          renderedFieldSnapshot: {
            ...((contract.renderedFieldSnapshot as Record<string, unknown> | null) || {}),
            ...fields,
          },
          pdfSha256,
          ...(contractFileUrl ? { contractFileUrl } : {}),
        },
      });
      if (activated.count !== 1) throw new PromotionConflictError("Contract was changed by another request");

      await tx.salesPartnerProfile.update({
        where: { id: contract.salesPartnerId },
        data: {
          status: "ACTIVE",
          activatedAt: now,
          suspendedAt: null,
          terminatedAt: null,
        },
      });
      await tx.userWorkspaceAccess.upsert({
        where: {
          userId_workspace: {
            userId: contract.salesPartner.userId,
            workspace: "SALES",
          },
        },
        create: {
          userId: contract.salesPartner.userId,
          workspace: "SALES",
          status: "ACTIVE",
          grantedById: req.user!.id,
          grantedAt: now,
          expiresAt: contract.expiresAt,
          statusReason: input.reason,
        },
        update: {
          status: "ACTIVE",
          grantedById: req.user!.id,
          grantedAt: now,
          expiresAt: contract.expiresAt,
          suspendedAt: null,
          revokedAt: null,
          revokedById: null,
          statusReason: input.reason,
        },
      });
    });
  } catch (error: any) {
    if (error instanceof PromotionConflictError) {
      return res.status(409).json({ error: error.message });
    }
    console.error("Sales contract activation failed:", error);
    return res.status(500).json({ error: "Could not activate contract" });
  }

  await audit(req, "SALES_CONTRACT_ACTIVATE", "SALES_PARTNER_CONTRACT", {
    status: contract.status,
  }, {
    status: "ACTIVE",
    activatedAt: now,
    signatoryName: input.signatoryName,
    signatoryTitle: input.signatoryTitle,
    pdfSha256,
    storedPrivately: Boolean(contractFileUrl),
    reason: input.reason,
  }, contract.id);
  await notifyUser(contract.salesPartner.userId, "sales_partner_workspace_activated", {
    contractNumber: contract.contractNumber,
    expiresAt: contract.expiresAt,
    actionPath: "/sales",
  }).catch(() => {});

  return res.json({
    ok: true,
    contract: {
      id: contract.id,
      contractNumber: contract.contractNumber,
      status: "ACTIVE",
      activatedAt: now,
      expiresAt: contract.expiresAt,
      pdfSha256,
      storedPrivately: Boolean(contractFileUrl),
    },
    workspaceAccess: { status: "ACTIVE", expiresAt: contract.expiresAt },
  });
}) as RequestHandler);

export default router;
