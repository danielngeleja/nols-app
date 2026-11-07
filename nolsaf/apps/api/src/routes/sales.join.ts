/**
 * The recruit's side of a team invite (lib/salesTeamInvites.ts).
 *
 * GET  /api/sales-join/preview?t=   who invited, to which team (no sign-in; nothing else)
 * POST /api/sales-join/accept       signed in: accept the invite for this account
 * GET  /api/sales-join/mine         signed in: where my accepted invite stands
 *
 * Mounted outside /api/sales on purpose: the recruit is not a partner yet, so
 * the workspace gate there would refuse them. Accepting grants nothing; an
 * administrator still decides.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { InviteError, acceptTeamInvite, myTeamInvite, previewTeamInvite } from "../lib/salesTeamInvites.js";

const router = Router();
const db = prisma as any;

const previewLimiter = rateLimit({
  redisPrefix: "rl:sales-join-preview:",
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a minute." },
});
const acceptLimiter = rateLimit({
  redisPrefix: "rl:sales-join-accept:",
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: any) => `sales-join:${req.user?.id ?? req.ip}`,
  message: { error: "Too many attempts. Try again later." },
});

const tokenSchema = z.string().trim().min(20).max(100);

router.get("/preview", previewLimiter, asyncHandler(async (req, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const token = tokenSchema.safeParse(req.query.t);
  const preview = token.success ? await previewTeamInvite(db, token.data) : null;
  // One answer for every bad, used or expired link.
  res.json(preview ? { valid: true, invite: preview } : { valid: false });
}));

router.post(
  "/accept",
  requireAuth as RequestHandler,
  blockImpersonated as RequestHandler,
  acceptLimiter,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const token = tokenSchema.safeParse(req.body?.token);
    if (!token.success) return res.status(404).json({ error: "This invite link is not valid any more. Ask your team lead for a new one.", code: "INVITE_INVALID" });
    try {
      const out = await acceptTeamInvite(db, { token: token.data, userId: req.user!.id });
      await audit(req, "SALES_TEAM_INVITE_ACCEPT", "SALES_TEAM_INVITE", null, { reference: out.reference, flags: out.flags }, null);
      void notifyUser(out.leadUserId, "sales_partner_team_invite_accepted", { inviteeName: out.inviteeName, teamName: out.teamName, actionPath: "/sales/team" }).catch(() => {});
      void notifyAdmins("sales_team_invite_review", {
        inviteeName: out.inviteeName,
        teamName: out.teamName,
        warnings: out.flags.filter((f) => f.severity === "SUSPICIOUS").length,
        link: "/admin/sales/partners",
      }).catch(() => {});
      res.json({ ok: true, teamName: out.teamName, leadFirstName: out.leadFirstName, missing: out.missing });
    } catch (error) {
      if (error instanceof InviteError) return res.status(error.status).json({ error: error.message, code: error.code });
      throw error;
    }
  }),
);

router.get("/mine", requireAuth as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ invite: await myTeamInvite(db, req.user!.id) });
}));

export default router;
