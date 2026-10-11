import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { auditOrThrow } from "../lib/audit.js";
import { appDistributionInput, defaultAppDistribution, publicAppDistribution } from "../lib/appDistribution.js";

const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

router.get("/", async (_req, res) => {
  try {
    const row = await prisma.appDistributionSettings.findUnique({ where: { id: 1 } });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ settings: row ?? defaultAppDistribution, publicPreview: publicAppDistribution(row ?? defaultAppDistribution) });
  } catch (error) {
    console.error("[app-distribution] admin read failed", error);
    return res.status(500).json({ error: "app_distribution_unavailable" });
  }
});

router.put("/", async (req, res) => {
  const parsed = appDistributionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.issues });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.appDistributionSettings.findUnique({ where: { id: 1 } });
      const row = await tx.appDistributionSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...parsed.data, updatedById: (req as any).user?.id ?? null },
        update: { ...parsed.data, updatedById: (req as any).user?.id ?? null },
      });
      await auditOrThrow(tx, req, "ADMIN_APP_DISTRIBUTION_UPDATE", "app_distribution_settings", before, row, 1);
      return row;
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ settings: updated, publicPreview: publicAppDistribution(updated) });
  } catch (error) {
    console.error("[app-distribution] audited update failed", error);
    return res.status(500).json({ error: "app_distribution_update_failed" });
  }
});

export default router;
