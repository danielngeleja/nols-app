// apps/api/src/routes/public.nrmsAgentAuth.ts
//
// Public endpoint for an invited travel agent to redeem their one-time invite
// link and set their own password. On success the agent is signed in with a
// normal NRMS_AGENT session; from then on they use the standard login. This is
// the only unauthenticated agent endpoint - everything else requires the session.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { activateAgentFromInvite } from "../lib/nrmsAgentInvite.js";
import { signUserJwt, setAuthCookie } from "../lib/sessionManager.js";
import { validatePasswordWithSettings } from "../lib/securitySettings.js";
import { PASSWORD_MAX_LENGTH } from "../lib/security.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import crypto from "node:crypto";

export const router = Router();

const activateSchema = z.object({
  token: z.string().trim().min(10).max(2048),
  password: z.string().min(15).max(PASSWORD_MAX_LENGTH),
});
const limitAgentActivation = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many activation attempts. Wait a few minutes and try again." },
  keyGenerator: (req) => {
    const tokenHash = crypto.createHash("sha256").update(String(req.body?.token || "missing")).digest("hex").slice(0, 16);
    return `nrms-agent-activate:${req.ip || "unknown"}:${tokenHash}`;
  },
});

// Capability-style link - keep it out of caches and referers.
router.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

router.post("/activate", limitAgentActivation as RequestHandler, (async (req, res: Response) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Enter a password between 15 and ${PASSWORD_MAX_LENGTH} characters` });
  try {
    const strength = await validatePasswordWithSettings(parsed.data.password, "NRMS_AGENT");
    if (!strength.valid) {
      return res.status(400).json({ error: strength.reasons[0] || "Choose a stronger password", reasons: strength.reasons });
    }
    const result = await activateAgentFromInvite(prisma as any, parsed.data);
    if (!result.ok) {
      const code = result.reason === "ALREADY_ACTIVE" ? 409 : result.reason === "INVALID_TOKEN" ? 400 : 404;
      return res.status(code).json({ error: result.message, code: result.reason });
    }
    const token = await signUserJwt({ id: result.userId, role: result.role, email: result.email });
    await setAuthCookie(res, token, result.role);
    res.json({ ok: true, user: { id: result.userId, role: result.role, email: result.email } });
  } catch (err) {
    console.error("[public.nrmsAgentAuth] activate failed", err);
    res.status(500).json({ error: "Your account could not be activated" });
  }
}) as RequestHandler);

export default router;
