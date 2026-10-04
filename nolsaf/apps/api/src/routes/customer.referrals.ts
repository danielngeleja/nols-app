import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { referralCodeFor } from "../lib/referralCode.js";

const router = Router();
router.use(requireAuth as RequestHandler);

function appOrigin(): string {
  return (process.env.APP_URL || process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
}

// GET /api/customer/referrals
router.get("/", (async (req: AuthedRequest, res: any) => {
  const userId = req.user!.id;
  const code = referralCodeFor("CUSTOMER", userId);
  const link = `${appOrigin()}/register?ref=${encodeURIComponent(code)}`;

  const [total, referrals] = await Promise.all([
    prisma.user.count({ where: { referredBy: userId } }),
    prisma.user.findMany({
      where: { referredBy: userId },
      select: { name: true, fullName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return res.json({
    ok: true,
    code,
    link,
    total,
    referrals: referrals.map((r) => ({
      name: r.fullName || r.name || "NoLSAF traveller",
      joinedAt: r.createdAt.toISOString(),
    })),
  });
}) as any);

export default router;
