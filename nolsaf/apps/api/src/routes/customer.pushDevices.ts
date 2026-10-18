import { Router, type RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { z } from "zod";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { rateLimitWithRedis } from "../lib/redisRateLimitStore.js";

const router = Router();
router.use(requireAuth as RequestHandler);

const limitRegistration = rateLimitWithRedis({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many device registrations. Please try again later." },
  keyGenerator: (req) => `push-device:${(req as AuthedRequest).user?.id ?? "unknown"}`,
});

const bodySchema = z.object({
  token: z.string().max(255).regex(/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/),
  platform: z.literal("android"),
});

router.post("/", limitRegistration, (async (req: AuthedRequest, res) => {
  if (req.user?.role !== "USER" || !req.sessionId) return res.status(403).json({ error: "Traveller session required" });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid push device" });
  const { token, platform } = parsed.data;
  const registered = await prisma.pushDevice.upsert({
    where: { token },
    create: { token, platform, userId: req.user.id, sessionId: req.sessionId },
    update: { platform, userId: req.user.id, sessionId: req.sessionId, active: true },
  });
  // Keep the newest five active installs for one traveller.
  const newest = await prisma.pushDevice.findMany({
    where: { userId: req.user.id, active: true, id: { not: registered.id } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 4,
    select: { id: true },
  });
  await prisma.pushDevice.updateMany({
    where: { userId: req.user.id, active: true, id: { notIn: [registered.id, ...newest.map((device) => device.id)] } },
    data: { active: false },
  });
  return res.json({ ok: true });
}) as RequestHandler);

router.delete("/", (async (req: AuthedRequest, res) => {
  if (req.user?.role !== "USER") return res.status(403).json({ error: "Traveller session required" });
  const parsed = bodySchema.pick({ token: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid push device" });
  await prisma.pushDevice.updateMany({
    where: { token: parsed.data.token, userId: req.user.id },
    data: { active: false },
  });
  return res.json({ ok: true });
}) as RequestHandler);

export default router;
