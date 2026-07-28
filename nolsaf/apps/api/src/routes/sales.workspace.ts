// Sales Partner Workspace: workspace discovery, selection and partner identity.
//
// The selected workspace is a UI preference, not an authorization token. It is
// stored in a readable cookie purely so the Next.js middleware can route the
// user to the right shell after a reload. Every protected route independently
// re-checks the entitlement on the server, so tampering with the cookie changes
// which screen renders and nothing else.
//
// See docs/SALES_PARTNER_WORKSPACE.md section 4.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  hasWorkspaceAccess,
  listWorkspaces,
  loadSalesPartnerContext,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import {
  WORKSPACE_TYPES,
  daysUntil,
  isContractEarning,
  maskPayoutAccount,
  type WorkspaceType,
} from "../lib/salesPartner.js";
import { resolveSalesPartnerLevel, type SalesPartnerLevel } from "../lib/salesPartnerLevel.js";
import { prisma } from "@nolsaf/prisma";
import { fetchNotifications, markNotificationRead } from "../services/notifications.js";

const router = Router();
const db = prisma as any;

const WORKSPACE_COOKIE = "nolsaf_workspace";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const selectSchema = z.object({
  workspace: z.enum(WORKSPACE_TYPES),
});

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function setWorkspaceCookie(res: Response, workspace: WorkspaceType): void {
  const cookieDomain = process.env.COOKIE_DOMAIN;
  res.cookie(WORKSPACE_COOKIE, workspace, {
    // Readable by the Next.js middleware, same as the existing role cookie.
    httpOnly: false,
    secure: isProd(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

/**
 * GET /api/me/workspaces
 * Which workspaces this account may enter. Drives the selector after login and
 * the switcher in the account menu.
 */
router.get("/me/workspaces", requireAuth as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const workspaces = await listWorkspaces(user.id, String(user.role));
  const pendingSalesAccess = workspaces.includes("SALES")
    ? null
    : await db.userWorkspaceAccess.findUnique({
        where: { userId_workspace: { userId: user.id, workspace: "SALES" } },
        select: { status: true },
      });
  if (String(pendingSalesAccess?.status || "").toUpperCase() === "PENDING") {
    workspaces.push("SALES");
  }

  const descriptions: Record<WorkspaceType, { label: string; description: string }> = {
    NORMAL: {
      label: "NoLSAF Marketplace",
      description: "Manage your normal account and platform activity.",
    },
    SALES: {
      label: "Sales Partner Workspace",
      description: "Manage leads, properties, earnings, contracts and payouts.",
    },
  };
  const role = String(user.role || "").toUpperCase();
  const normalEntryPath =
    role === "ADMIN"
      ? "/admin/home"
      : role === "OWNER"
        ? "/owner"
        : role === "DRIVER"
          ? "/driver"
          : role === "AGENT"
            ? "/account/agent"
            : "/account";

  res.json({
    workspaces: workspaces.map((workspace) => ({
      workspace,
      ...descriptions[workspace],
      status:
        workspace === "SALES" && pendingSalesAccess
          ? String(pendingSalesAccess.status).toUpperCase()
          : "ACTIVE",
      entryPath:
        workspace === "SALES" && pendingSalesAccess
          ? "/sales/contract"
          : workspace === "SALES"
            ? "/sales"
            : normalEntryPath,
    })),
    // Only worth showing a chooser when there is genuinely a choice.
    requiresSelection: workspaces.length > 1,
  });
}) as RequestHandler);

/**
 * POST /api/me/workspace/select
 * Records the choice. Rejects a workspace the user does not hold, so the cookie
 * can never be set to something the server would refuse anyway.
 */
router.post("/me/workspace/select", requireAuth as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = selectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid workspace" });
  }

  const user = req.user!;
  const { workspace } = parsed.data;
  const isAdmin = String(user.role).toUpperCase() === "ADMIN";

  if (!isAdmin && !(await hasWorkspaceAccess(user.id, workspace))) {
    const pending = workspace === "SALES"
      ? await db.userWorkspaceAccess.findUnique({
          where: { userId_workspace: { userId: user.id, workspace: "SALES" } },
          select: { status: true },
        })
      : null;
    // PENDING selection is navigation only: every sales API still performs its
    // own entitlement or owner-profile check. This lets the user reach the
    // agreement that must be signed before ACTIVE access can exist.
    if (String(pending?.status || "").toUpperCase() !== "PENDING") {
      return res.status(403).json({ error: "Sales workspace access required", workspace });
    }
  }

  setWorkspaceCookie(res, workspace);
  return res.json({ ok: true, workspace });
}) as RequestHandler);

/**
 * GET /api/sales/me
 * The partner's own identity, contract standing and level progress. This is the
 * only place a partner sees their unmasked payout account.
 */
router.get(
  "/sales/me",
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
    const context = req.salesPartner;
    if (!context) {
      // An admin browsing the workspace without a partner profile of their own.
      return res.status(404).json({ error: "No sales partner profile on this account" });
    }

    const profile = await db.salesPartnerProfile.findUnique({
      where: { id: context.partnerId },
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
        createdAt: true,
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
    if (!profile) return res.status(404).json({ error: "No sales partner profile on this account" });

    // Level is derived from revenue actually generated, never from a stored
    // total. See lib/salesPartnerLevel.ts and doc section 14.
    const [revenueAgg, activeProperties] = await Promise.all([
      db.salesCommission.aggregate({
        where: {
          salesPartnerId: profile.id,
          status: { notIn: ["REVERSED", "CANCELLED", "DISPUTED"] },
          earnedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
        },
        _sum: { eligibleNetRevenue: true },
      }),
      db.propertySalesAttribution.count({
        where: { salesPartnerId: profile.id, status: "ACTIVE" },
      }),
    ]);

    const level = resolveSalesPartnerLevel({
      revenueGenerated: Number(revenueAgg?._sum?.eligibleNetRevenue || 0),
      activeProperties,
      adminGrantedLevel: (profile.level as SalesPartnerLevel) || null,
    });

    const contract = context.contract;
    return res.json({
      partner: {
        id: profile.id,
        agentCode: profile.agentCode,
        status: profile.status,
        region: profile.region,
        territory: profile.territory,
        phone: profile.phone,
        activatedAt: profile.activatedAt,
        name: profile.user?.name || null,
        email: profile.user?.email || null,
        avatarUrl: profile.user?.avatarUrl || null,
      },
      payout: {
        name: profile.payoutName,
        method: profile.payoutMethod,
        // The partner's own screen, so the last four are enough to confirm the
        // destination without printing the full number.
        accountMasked: maskPayoutAccount(profile.payoutAccount),
      },
      level,
      contract: contract
        ? {
            id: contract.id,
            status: contract.status,
            startsAt: contract.startsAt,
            expiresAt: contract.expiresAt,
            daysRemaining: daysUntil(contract.expiresAt),
            nrmsCommissionRate: contract.nrmsCommissionRate,
            marketplaceRevenueRate: contract.marketplaceRevenueRate,
            isEarning: isContractEarning(contract),
          }
        : null,
    });
  }) as RequestHandler,
);

router.get(
  "/sales/notifications",
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
    const tab = req.query.tab === "viewed" ? "viewed" : "unread";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(50, Number(req.query.pageSize || 20)));
    const result = await fetchNotifications({
      tab,
      page,
      pageSize,
      userId: req.user!.id,
      types: ["sales"],
    } as any);
    return res.json(result);
  }) as RequestHandler,
);

router.post(
  "/sales/notifications/:id/read",
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid notification id" });
    const result = await markNotificationRead(id, undefined, req.user!.id, { types: ["sales"] });
    if (!result.ok) return res.status(404).json({ error: "Notification not found" });
    return res.json({ ok: true });
  }) as RequestHandler,
);

export default router;
export { loadSalesPartnerContext };
