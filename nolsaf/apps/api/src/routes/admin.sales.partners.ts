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
import { approveInviteInPromotion, joinTeamOnActivation } from "../lib/salesTeamInvites.js";
import { earningRef, leadRef, propertyRef } from "../lib/salesReference.js";
import { clearBoardCache } from "../lib/salesLeaderboard.js";
import { CARD_PENDING_REVIEW, CARD_PHOTO_REJECTED, cardExpiry, cardToken, hashCardToken, newCardSalt } from "../lib/salesPartnerCard.js";
import {
  CONTRACT_EARNING_STATUSES,
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
  /** A team lead's invite this person accepted (ti_...). They join that team at activation. */
  teamInvite: z.string().trim().regex(/^ti_[A-Za-z0-9_-]{10,29}$/).optional(),
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

      if (input.teamInvite) {
        try {
          await approveInviteInPromotion(tx, { reference: input.teamInvite, userId: input.userId, partnerId: profile.id, adminId: admin.id, now: new Date() });
        } catch (error: any) {
          throw new PromotionConflictError(error?.message || "The team invite could not be approved");
        }
      }

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
        teamInvite: input.teamInvite || null,
        reason: input.reason,
      },
      result.profile.id,
    );

    if (input.teamInvite) {
      const invite = await db.salesTeamInvite.findUnique({
        where: { reference: input.teamInvite },
        select: { inviteeName: true, team: { select: { name: true, lead: { select: { userId: true } } } } },
      });
      if (invite) {
        await notifyUser(invite.team.lead.userId, "sales_partner_team_invite_approved", { inviteeName: invite.inviteeName, teamName: invite.team.name }).catch(() => {});
      }
    }

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
      payoutHoldAt: true,
      payoutHoldReason: true,
      payoutHoldFlags: true,
      withdrawalOtpLockedAt: true,
      user: { select: { id: true, name: true, fullName: true, email: true, phone: true } },
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
      idCards: {
        orderBy: { id: "desc" },
        take: 5,
        select: { id: true, cardNumber: true, status: true, photoUrl: true, issuedAt: true, expiresAt: true, revokedAt: true, revokeReason: true, verifyCount: true, lastVerifiedAt: true },
      },
    },
  });
  if (!partner) return res.status(404).json({ error: "Partner not found" });

  const [access, payoutsUnderReview, flaggedVisits, disputedProperties, ledTeam, photo] = await Promise.all([
    db.userWorkspaceAccess.findUnique({
      where: { userId_workspace: { userId: partner.user.id, workspace: "SALES" } },
      select: { status: true, grantedAt: true, expiresAt: true, suspendedAt: true, revokedAt: true },
    }),
    // What is waiting on an admin for this partner, so the record can lead with it.
    db.salesPayoutRequest.count({ where: { salesPartnerId: id, status: "UNDER_REVIEW" } }),
    db.salesLeadVisit.count({ where: { salesPartnerId: id, status: "FLAGGED", reviewedAt: null } }),
    db.propertySalesAttribution.count({ where: { salesPartnerId: id, status: "DISPUTED" } }),
    db.salesTeam.findUnique({ where: { leadPartnerId: id }, select: { name: true, status: true } }),
    db.user.findUnique({ where: { id: partner.user.id }, select: { avatarUrl: true } }),
  ]);

  // Why the partner is suspended: admin-only, read from the audit trail.
  const suspendAudit = partner.status === "SUSPENDED"
    ? await db.auditLog.findFirst({
        where: { action: "SALES_PARTNER_SUSPEND", entity: "SALES_PARTNER", entityId: id },
        orderBy: { id: "desc" },
        select: { afterJson: true, createdAt: true },
      }).catch(() => null)
    : null;
  const suspension = partner.status === "SUSPENDED"
    ? { at: partner.suspendedAt ?? suspendAudit?.createdAt ?? null, reason: (suspendAudit?.afterJson as any)?.reason ?? null }
    : null;

  // Why there is (or is not) a card, checked live with the same rules the
  // partner's ID card page uses, so admin never has to guess.
  const nowForCard = new Date();
  const cardReadiness = {
    activePartner: partner.status === "ACTIVE",
    activeContract: partner.contracts.some((c: any) => ["ACTIVE", "EXPIRING"].includes(c.status) && c.startsAt && c.expiresAt && new Date(c.startsAt) <= nowForCard && new Date(c.expiresAt) > nowForCard),
    profilePhoto: Boolean(photo?.avatarUrl),
    everIssued: partner.idCards.length > 0,
    photoPending: partner.idCards.some((c: any) => c.status === CARD_PENDING_REVIEW),
    // Latest card cancelled by NoLSAF: only an admin can issue the next one.
    cancelledByAdmin: partner.idCards[0]?.status === "REVOKED",
    // What a new card would carry, so admin checks the photo before issuing.
    currentPhotoUrl: photo?.avatarUrl || null,
  };

  res.json({
    partner: {
      ...partner,
      // Admin sees the destination, not the number. Only the owning partner
      // sees their own account, and even then only the last four.
      payoutAccount: maskPayoutAccount(partner.payoutAccount),
    },
    workspaceAccess: access,
    attention: {
      card: cardReadiness,
      payoutsUnderReview,
      flaggedVisits,
      disputedProperties,
      leadsTeam: ledTeam?.status === "ACTIVE" ? ledTeam.name : null,
      suspension,
    },
  });
}) as RequestHandler);

/**
 * GET /admin/sales/partners/:id/file
 * The partner's whole file for review, read only: account, leads, field
 * visits, attributed properties, commission ledger, withdrawals and the audit
 * history. Actions stay in the sections that own them (conversion review,
 * finance, agreements); this only opens the data. Rows carry opaque
 * references, never database ids.
 */
router.get("/partners/:id/file", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const partner = await db.salesPartnerProfile.findUnique({
    where: { id },
    select: {
      id: true, taxIdNumber: true, levelUpdatedAt: true, payoutName: true,
      user: { select: { id: true, createdAt: true, emailVerifiedAt: true, phoneVerifiedAt: true, avatarUrl: true } },
    },
  });
  if (!partner) return res.status(404).json({ error: "Partner not found" });

  const [leads, attributions, commissionTotals, commissions, payouts, visits, history] = await Promise.all([
    db.salesLead.findMany({
      where: { salesPartnerId: id },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true, propertyName: true, status: true, proposedProduct: true, region: true, district: true, contactPerson: true, contactPhone: true,
        createdAt: true, updatedAt: true, nextFollowUpAt: true, protectionExpiresAt: true, duplicateReviewStatus: true, conversionRequestedAt: true, convertedAt: true, lostReason: true,
        _count: { select: { activities: true, visits: true } },
      },
    }),
    db.propertySalesAttribution.findMany({
      where: { salesPartnerId: id },
      orderBy: { attributedAt: "desc" },
      take: 300,
      select: {
        propertyId: true, productType: true, status: true, attributedAt: true, verifiedAt: true, commissionStartsAt: true, commissionEndsAt: true, disputeReason: true, revokedAt: true,
        property: { select: { title: true, regionName: true, district: true, status: true } },
      },
    }),
    db.salesCommission.groupBy({ by: ["type", "status"], where: { salesPartnerId: id }, _sum: { commissionAmount: true }, _count: { _all: true } }),
    db.salesCommission.findMany({
      where: { salesPartnerId: id },
      orderBy: { earnedAt: "desc" },
      take: 200,
      select: {
        id: true, type: true, status: true, propertyId: true, commissionAmount: true, eligibleNetRevenue: true, commissionRate: true, currency: true, earnedAt: true, eligibleAt: true, paidAt: true,
        reversalReason: true, description: true, property: { select: { title: true } },
      },
    }),
    db.salesPayoutRequest.findMany({
      where: { salesPartnerId: id },
      orderBy: { requestedAt: "desc" },
      take: 100,
      select: {
        referenceNumber: true, status: true, lane: true, requestedAmount: true, approvedAmount: true, deductionAmount: true, withholdingTaxAmount: true, netPaidAmount: true,
        currency: true, payoutMethod: true, payoutAccount: true, requestedAt: true, approvedAt: true, paidAt: true, rejectedAt: true, rejectionReason: true, paymentReference: true,
      },
    }),
    db.salesLeadVisit.findMany({
      where: { salesPartnerId: id },
      orderBy: { capturedAt: "desc" },
      take: 100,
      select: { id: true, status: true, metWith: true, note: true, capturedAt: true, distanceMeters: true, accuracyMeters: true, flags: true, reviewedAt: true, reviewNote: true, lead: { select: { id: true, propertyName: true } } },
    }),
    db.auditLog.findMany({
      where: { entity: "SALES_PARTNER", entityId: id },
      orderBy: { id: "desc" },
      take: 150,
      select: { action: true, actorId: true, actorRole: true, afterJson: true, createdAt: true },
    }),
  ]);

  const actorIds = [...new Set(history.map((h: any) => h.actorId).filter((v: any) => Number.isInteger(v)))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, fullName: true } }) : [];
  const actorName = new Map<number, string>(actors.map((a: any) => [a.id, a.fullName || a.name || "Admin"]));
  // Lifetime earned per attributed property, from the whole ledger (not just the rows shown).
  const propertyIds = attributions.map((a: any) => a.propertyId);
  const perProperty = propertyIds.length
    ? await db.salesCommission.groupBy({
        by: ["propertyId"],
        where: { salesPartnerId: id, propertyId: { in: propertyIds }, status: { notIn: ["REVERSED", "CANCELLED"] } },
        _sum: { commissionAmount: true },
      })
    : [];
  const earnedByProperty = new Map<number, number>(perProperty.map((r: any) => [r.propertyId, Number(r._sum.commissionAmount || 0)]));
  const num = (v: unknown) => (v == null ? null : Number(v));

  return res.json({
    account: {
      taxIdNumber: partner.taxIdNumber ?? null,
      payoutName: partner.payoutName ?? null,
      levelUpdatedAt: partner.levelUpdatedAt ?? null,
      registeredAt: partner.user?.createdAt ?? null,
      emailVerified: Boolean(partner.user?.emailVerifiedAt),
      phoneVerified: Boolean(partner.user?.phoneVerifiedAt),
      hasPhoto: Boolean(partner.user?.avatarUrl),
      lastLoginAt: (partner.user as any)?.lastLoginAt ?? null,
    },
    leads: leads.map((l: any) => ({
      ref: leadRef(l.id),
      propertyName: l.propertyName,
      status: l.status,
      product: l.proposedProduct,
      area: [l.district, l.region].filter(Boolean).join(", "),
      contact: [l.contactPerson, l.contactPhone].filter(Boolean).join(" · ") || null,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      nextFollowUpAt: l.nextFollowUpAt,
      protectedUntil: l.protectionExpiresAt,
      possibleDuplicate: l.duplicateReviewStatus === "POSSIBLE_DUPLICATE",
      conversionRequestedAt: l.conversionRequestedAt,
      convertedAt: l.convertedAt,
      lostReason: l.lostReason,
      activities: l._count.activities,
      visits: l._count.visits,
    })),
    properties: attributions.map((a: any) => ({
      ref: propertyRef(a.propertyId),
      title: a.property?.title ?? "Property",
      area: [a.property?.district, a.property?.regionName].filter(Boolean).join(", "),
      listingStatus: a.property?.status ?? null,
      product: a.productType,
      status: a.status,
      attributedAt: a.attributedAt,
      verifiedAt: a.verifiedAt,
      earningFrom: a.commissionStartsAt,
      earningUntil: a.commissionEndsAt,
      disputeReason: a.disputeReason,
      revokedAt: a.revokedAt,
      earned: earnedByProperty.get(a.propertyId) ?? 0,
    })),
    earnings: {
      totals: commissionTotals.map((t: any) => ({ type: t.type, status: t.status, amount: Number(t._sum.commissionAmount || 0), count: t._count._all })),
      rows: commissions.map((c: any) => ({
        ref: earningRef(c.id),
        type: c.type,
        status: c.status,
        amount: Number(c.commissionAmount),
        basis: num(c.eligibleNetRevenue),
        rate: num(c.commissionRate),
        currency: c.currency,
        property: c.property?.title ?? null,
        description: c.description,
        earnedAt: c.earnedAt,
        eligibleAt: c.eligibleAt,
        paidAt: c.paidAt,
        reversalReason: c.reversalReason,
      })),
    },
    withdrawals: payouts.map((p: any) => ({
      reference: p.referenceNumber,
      status: p.status,
      lane: p.lane,
      requested: num(p.requestedAmount),
      approved: num(p.approvedAmount),
      deduction: num(p.deductionAmount),
      withholdingTax: num(p.withholdingTaxAmount),
      netPaid: num(p.netPaidAmount),
      currency: p.currency,
      destination: `${p.payoutMethod} ending ${maskPayoutAccount(p.payoutAccount) || "-"}`,
      requestedAt: p.requestedAt,
      approvedAt: p.approvedAt,
      paidAt: p.paidAt,
      rejectedAt: p.rejectedAt,
      rejectionReason: p.rejectionReason,
      paymentReference: p.paymentReference,
    })),
    visits: visits.map((v: any) => ({
      lead: v.lead ? { ref: leadRef(v.lead.id), propertyName: v.lead.propertyName } : null,
      status: v.status,
      metWith: v.metWith,
      note: v.note,
      capturedAt: v.capturedAt,
      distanceMeters: v.distanceMeters,
      accuracyMeters: v.accuracyMeters,
      flags: Array.isArray(v.flags) ? v.flags : [],
      reviewedAt: v.reviewedAt,
      reviewNote: v.reviewNote,
    })),
    history: history.map((h: any) => ({
      action: h.action,
      by: h.actorId ? actorName.get(h.actorId) || "Admin" : h.actorRole === "SYSTEM" ? "System" : h.actorRole || "System",
      reason: (h.afterJson as any)?.reason ?? null,
      at: h.createdAt,
    })),
  });
}) as RequestHandler);

/**
 * POST /admin/sales/partners/:id/card/revoke
 * Cancel the partner's active ID card at once: its QR link and code then tell
 * owners not to deal with this person on NoLSAF's behalf.
 */
router.post("/partners/:id/card/revoke", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (fail(res, parsed)) return;
  const now = new Date();
  const card = await db.salesPartnerCard.findFirst({
    where: { salesPartnerId: id, status: "ACTIVE" },
    select: { id: true, cardNumber: true, salesPartner: { select: { userId: true } } },
  });
  if (!card) return res.status(404).json({ error: "This partner has no active ID card" });
  const changed = await db.salesPartnerCard.updateMany({
    where: { id: card.id, status: "ACTIVE" },
    data: { status: "REVOKED", activeKey: null, revokedAt: now, revokedById: req.user!.id, revokeReason: parsed.data!.reason },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "The card was changed by another request" });
  await audit(req, "SALES_PARTNER_CARD_REVOKE", "SALES_PARTNER_CARD", { status: "ACTIVE" }, {
    status: "REVOKED",
    cardNumber: card.cardNumber,
    reason: parsed.data!.reason,
  }, card.id);
  // The reason stays on the admin record and audit log; the partner is only told.
  await notifyUser(card.salesPartner.userId, "sales_partner_card_revoked", {
    cardNumber: card.cardNumber,
    actionPath: "/sales/id-card",
  }).catch(() => {});
  return res.json({ ok: true, card: { cardNumber: card.cardNumber, status: "REVOKED", revokedAt: now } });
}) as RequestHandler);

/** The card waiting for a photo decision, newest first. */
async function pendingCardFor(partnerId: number) {
  return db.salesPartnerCard.findFirst({
    where: { salesPartnerId: partnerId, status: CARD_PENDING_REVIEW },
    orderBy: { id: "desc" },
    select: { id: true, cardNumber: true, salesPartner: { select: { userId: true } } },
  });
}

/**
 * POST /admin/sales/partners/:id/card/approve
 * The photo is a clear face of this person: the card starts verifying now and
 * any older active card is replaced at the same moment.
 */
router.post("/partners/:id/card/approve", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const now = new Date();
  const card = await pendingCardFor(id);
  if (!card) return res.status(404).json({ error: "No card is waiting for a photo check" });
  const result = await db.$transaction(async (tx: any) => {
    const replaced = await tx.salesPartnerCard.updateMany({
      where: { salesPartnerId: id, status: "ACTIVE" },
      data: { status: "REPLACED", activeKey: null, revokedAt: now, revokeReason: "Replaced by a new card" },
    });
    const approved = await tx.salesPartnerCard.updateMany({
      where: { id: card.id, status: CARD_PENDING_REVIEW },
      data: { status: "ACTIVE", activeKey: id },
    });
    if (approved.count !== 1) throw Object.assign(new Error("changed"), { code: "CARD_CHANGED" });
    return { replaced: replaced.count };
  }).catch((error: any) => {
    if (error?.code === "CARD_CHANGED" || error?.code === "P2002") return null;
    throw error;
  });
  if (!result) return res.status(409).json({ error: "The card was changed by another request" });
  await audit(req, "SALES_PARTNER_CARD_APPROVE", "SALES_PARTNER_CARD", { status: CARD_PENDING_REVIEW }, {
    status: "ACTIVE",
    cardNumber: card.cardNumber,
    replacedCards: result.replaced,
  }, card.id);
  await notifyUser(card.salesPartner.userId, "sales_partner_card_approved", {
    cardNumber: card.cardNumber,
    actionPath: "/sales/id-card",
  }).catch(() => {});
  return res.json({ ok: true, card: { cardNumber: card.cardNumber, status: "ACTIVE" } });
}) as RequestHandler);

/**
 * POST /admin/sales/partners/:id/card/reject
 * The photo is not a clear face of this person. The request ends; any older
 * active card keeps working, and the partner is told what to fix.
 */
router.post("/partners/:id/card/reject", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (fail(res, parsed)) return;
  const now = new Date();
  const card = await pendingCardFor(id);
  if (!card) return res.status(404).json({ error: "No card is waiting for a photo check" });
  const changed = await db.salesPartnerCard.updateMany({
    where: { id: card.id, status: CARD_PENDING_REVIEW },
    data: { status: CARD_PHOTO_REJECTED, revokedAt: now, revokedById: req.user!.id, revokeReason: parsed.data!.reason },
  });
  if (changed.count !== 1) return res.status(409).json({ error: "The card was changed by another request" });
  await audit(req, "SALES_PARTNER_CARD_PHOTO_REJECT", "SALES_PARTNER_CARD", { status: CARD_PENDING_REVIEW }, {
    status: CARD_PHOTO_REJECTED,
    cardNumber: card.cardNumber,
    reason: parsed.data!.reason,
  }, card.id);
  await notifyUser(card.salesPartner.userId, "sales_partner_card_photo_rejected", {
    cardNumber: card.cardNumber,
    reason: parsed.data!.reason,
    actionPath: "/sales/id-card",
  }).catch(() => {});
  return res.json({ ok: true, card: { cardNumber: card.cardNumber, status: CARD_PHOTO_REJECTED } });
}) as RequestHandler);

/**
 * POST /admin/sales/partners/:id/suspend
 * Pause a sales partner without touching the rest of their NoLSAF account:
 * the sales portal closes on the next request, the ID card stops verifying on
 * the next scan (it checks partner status live), any card waiting for a photo
 * check is withdrawn, and payouts stop (sending requires an ACTIVE partner).
 * Earnings already recorded stay on the ledger. The reason stays private.
 */
router.post("/partners/:id/suspend", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (fail(res, parsed)) return;
  const now = new Date();
  const partner = await db.salesPartnerProfile.findUnique({ where: { id }, select: { id: true, userId: true, status: true, agentCode: true } });
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  if (partner.status !== "ACTIVE") return res.status(409).json({ error: "Only an active partner can be suspended" });

  const result = await db.$transaction(async (tx: any) => {
    const moved = await tx.salesPartnerProfile.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "SUSPENDED", suspendedAt: now } });
    if (moved.count !== 1) return null;
    const access = await tx.userWorkspaceAccess.updateMany({
      where: { userId: partner.userId, workspace: "SALES", status: "ACTIVE" },
      data: { status: "SUSPENDED", suspendedAt: now },
    });
    const withdrawn = await tx.salesPartnerCard.updateMany({
      where: { salesPartnerId: id, status: CARD_PENDING_REVIEW },
      data: { status: "REPLACED", revokedAt: now, revokeReason: "Withdrawn: partner suspended" },
    });
    return { accessClosed: access.count, cardRequestsWithdrawn: withdrawn.count };
  });
  if (!result) return res.status(409).json({ error: "The partner was changed by another request" });

  clearBoardCache();
  await audit(req, "SALES_PARTNER_SUSPEND", "SALES_PARTNER", { status: "ACTIVE" }, {
    status: "SUSPENDED",
    agentCode: partner.agentCode,
    reason: parsed.data!.reason,
    ...result,
  }, id);
  // The partner is told it happened, never why.
  await notifyUser(partner.userId, "sales_partner_workspace_suspended", { actionPath: "/sales" }).catch(() => {});
  return res.json({ ok: true, partner: { status: "SUSPENDED", suspendedAt: now }, ...result });
}) as RequestHandler);

/**
 * POST /admin/sales/partners/:id/reinstate
 * Undo a suspension: the portal reopens and the current card verifies again
 * (if it has not expired and the agreement is still current).
 */
router.post("/partners/:id/reinstate", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (fail(res, parsed)) return;
  const partner = await db.salesPartnerProfile.findUnique({ where: { id }, select: { id: true, userId: true, status: true, agentCode: true } });
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  if (partner.status !== "SUSPENDED") return res.status(409).json({ error: "This partner is not suspended" });

  const result = await db.$transaction(async (tx: any) => {
    const moved = await tx.salesPartnerProfile.updateMany({ where: { id, status: "SUSPENDED" }, data: { status: "ACTIVE", suspendedAt: null } });
    if (moved.count !== 1) return null;
    const access = await tx.userWorkspaceAccess.updateMany({
      where: { userId: partner.userId, workspace: "SALES", status: "SUSPENDED" },
      data: { status: "ACTIVE", suspendedAt: null },
    });
    return { accessReopened: access.count };
  });
  if (!result) return res.status(409).json({ error: "The partner was changed by another request" });

  clearBoardCache();
  await audit(req, "SALES_PARTNER_REINSTATE", "SALES_PARTNER", { status: "SUSPENDED" }, {
    status: "ACTIVE",
    agentCode: partner.agentCode,
    reason: parsed.data!.reason,
    ...result,
  }, id);
  await notifyUser(partner.userId, "sales_partner_workspace_reinstated", { actionPath: "/sales" }).catch(() => {});
  return res.json({ ok: true, partner: { status: "ACTIVE" }, ...result });
}) as RequestHandler);

/**
 * POST /admin/sales/partners/:id/card/issue
 * Issue a new card after NoLSAF cancelled the last one. The admin sees the
 * partner's current photo before confirming, so issuing is the photo check and
 * the card is live at once.
 */
router.post("/partners/:id/card/issue", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ photoChecked: z.literal(true) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Confirm you checked the photo first" });
  const now = new Date();
  const partner = await db.salesPartnerProfile.findUnique({
    where: { id },
    select: {
      id: true, agentCode: true, status: true, userId: true,
      user: { select: { avatarUrl: true, suspendedAt: true, isDisabled: true } },
      contracts: { select: { status: true, startsAt: true, expiresAt: true }, orderBy: { expiresAt: "desc" }, take: 5 },
    },
  });
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  if (partner.status !== "ACTIVE" || partner.user?.suspendedAt || partner.user?.isDisabled) return res.status(409).json({ error: "The partner must be active to get a card" });
  if (!partner.user?.avatarUrl) return res.status(409).json({ error: "The partner has no profile photo" });
  const contract = partner.contracts.find((c: any) => (CONTRACT_EARNING_STATUSES as readonly string[]).includes(c.status) && c.startsAt <= now && c.expiresAt > now);
  if (!contract) return res.status(409).json({ error: "The partner has no active agreement" });
  const open = await db.salesPartnerCard.count({ where: { salesPartnerId: id, status: { in: ["ACTIVE", CARD_PENDING_REVIEW] } } });
  if (open) return res.status(409).json({ error: "The partner already has an active card or one waiting for a photo check" });

  let issued: any;
  try {
    issued = await db.$transaction(async (tx: any) => {
      const before = await tx.salesPartnerCard.count({ where: { salesPartnerId: id } });
      const salt = newCardSalt();
      const created = await tx.salesPartnerCard.create({
        data: {
          salesPartnerId: id,
          cardNumber: `${partner.agentCode}-C${before + 1}`,
          salt,
          tokenHash: hashCardToken(`pending:${salt}`),
          photoUrl: partner.user.avatarUrl,
          status: "ACTIVE",
          activeKey: id,
          issuedAt: now,
          expiresAt: cardExpiry(contract.expiresAt, now),
        },
      });
      return tx.salesPartnerCard.update({ where: { id: created.id }, data: { tokenHash: hashCardToken(cardToken(created)) } });
    });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "The card was changed by another request" });
    throw error;
  }
  await audit(req, "SALES_PARTNER_CARD_ISSUE", "SALES_PARTNER_CARD", null, {
    status: "ACTIVE",
    cardNumber: issued.cardNumber,
    byAdmin: true,
    photoChecked: true,
  }, issued.id);
  await notifyUser(partner.userId, "sales_partner_card_reissued", {
    cardNumber: issued.cardNumber,
    actionPath: "/sales/id-card",
  }).catch(() => {});
  return res.status(201).json({ ok: true, card: { cardNumber: issued.cardNumber, status: "ACTIVE" } });
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

  let joined: { teamName: string; leadUserId: number } | null = null;
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
      // A recruit approved through a team invite joins that team now.
      joined = await joinTeamOnActivation(tx, { partnerId: contract.salesPartnerId, adminId: req.user!.id, now });
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
  if (joined) {
    const team = joined as { teamName: string; leadUserId: number };
    clearBoardCache();
    await notifyUser(contract.salesPartner.userId, "sales_partner_team_joined", { teamName: team.teamName }).catch(() => {});
    await notifyUser(team.leadUserId, "sales_partner_team_invite_joined", { teamName: team.teamName, agentCode: contract.salesPartner.agentCode, actionPath: "/sales/team" }).catch(() => {});
  }

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
