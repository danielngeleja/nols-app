import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireFinanceGrant, requireNrmsFinanceApprover } from "../middleware/financeGrant.js";
import { sanitizeText } from "../lib/sanitize.js";

const router = Router();
const db = prisma as any;
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const controlSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(5).max(300).transform(sanitizeText),
});

const staleAfterMs: Record<string, number> = {
  dunning: 2 * 60 * 60 * 1000,
  integrity: 48 * 60 * 60 * 1000,
  retention: 48 * 60 * 60 * 1000,
  housekeeping: 10 * 60 * 1000,
};

router.get("/health", (async (_req, res) => {
  const [setting, workers] = await Promise.all([
    db.systemSetting.findUnique({ where: { id: 1 }, select: { nrmsQrOrderingEnabled: true, nrmsQrOrderingChangedAt: true, nrmsQrOrderingReason: true } }),
    db.nrmsWorkerHealth.findMany({ orderBy: { worker: "asc" } }),
  ]);
  const now = Date.now();
  const workerHealth = workers.map((worker: any) => {
    const threshold = staleAfterMs[worker.worker] ?? 24 * 60 * 60 * 1000;
    const lastSuccess = worker.lastSuccessAt ? new Date(worker.lastSuccessAt).getTime() : 0;
    return { ...worker, healthy: worker.status === "HEALTHY" && lastSuccess > now - threshold, staleAfterMs: threshold };
  });
  res.json({
    qrOrdering: {
      enabled: setting?.nrmsQrOrderingEnabled !== false,
      changedAt: setting?.nrmsQrOrderingChangedAt ?? null,
      reason: setting?.nrmsQrOrderingReason ?? null,
    },
    workers: workerHealth,
    healthy: workerHealth.every((worker: any) => worker.healthy),
  });
}) as RequestHandler);

router.post("/qr-ordering", requireNrmsFinanceApprover as RequestHandler, requireFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = controlSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const now = new Date();
  const setting = await db.systemSetting.upsert({
    where: { id: 1 },
    update: { nrmsQrOrderingEnabled: parsed.data.enabled, nrmsQrOrderingChangedAt: now, nrmsQrOrderingChangedById: req.user!.id, nrmsQrOrderingReason: parsed.data.reason },
    create: { id: 1, nrmsQrOrderingEnabled: parsed.data.enabled, nrmsQrOrderingChangedAt: now, nrmsQrOrderingChangedById: req.user!.id, nrmsQrOrderingReason: parsed.data.reason },
  });
  await db.adminAudit.create({ data: {
    adminId: req.user!.id,
    action: parsed.data.enabled ? "NRMS_GLOBAL_QR_ORDERING_ENABLE" : "NRMS_GLOBAL_QR_ORDERING_DISABLE",
    details: { enabled: parsed.data.enabled, reason: parsed.data.reason, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) },
  } });
  res.json({ enabled: setting.nrmsQrOrderingEnabled, changedAt: setting.nrmsQrOrderingChangedAt });
}) as RequestHandler);

export default router;
