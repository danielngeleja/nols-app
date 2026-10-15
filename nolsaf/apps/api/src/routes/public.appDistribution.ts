import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { defaultAppDistribution, publicAppDistribution } from "../lib/appDistribution.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const row = await prisma.appDistributionSettings.findUnique({ where: { id: 1 } });
    return res.json(publicAppDistribution(row ?? defaultAppDistribution));
  } catch (error) {
    // Missing migration or database outage: never advertise an unverified listing.
    console.error("[app-distribution] public read failed", error);
    return res.json(publicAppDistribution(defaultAppDistribution));
  }
});

export default router;
