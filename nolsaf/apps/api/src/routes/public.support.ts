import { Router } from "express";
import { prisma } from "@nolsaf/prisma";

const router = Router();

// Public endpoint returning support contact info stored in system settings
router.get("/", async (_req, res) => {
  try {
    const s = await prisma.systemSetting.findUnique({ where: { id: 1 } }) ?? {} as any;
    // System Settings wins; then the environment; then the official company contacts
    // (same defaults as lib/tripSafety.ts), so public pages never show an empty contact.
    const pick = (...values: unknown[]) => values.map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean) ?? null;
    const supportEmail = pick(s.supportEmail, process.env.NEXT_PUBLIC_SUPPORT_EMAIL, "support@nolsaf.com");
    const supportPhone = pick(s.supportPhone, process.env.NEXT_PUBLIC_SUPPORT_PHONE, "+255 736 766 726");
    // Office address (column added in 20261015100000); the head office until an admin sets it.
    const supportAddress = pick((s as any).supportAddress, "Dar es Salaam, Tanzania");
    res.json({ supportEmail, supportPhone, supportAddress });
  } catch (err) {
    console.error('public support error', err);
    res.status(500).json({ error: 'Could not load support contact' });
  }
});

// Public endpoint returning system settings (commission rate for price calculations)
router.get("/system-settings", async (_req, res) => {
  try {
    const s = await prisma.systemSetting.findUnique({ where: { id: 1 } }) ?? {} as any;
    // Return all commission rates needed for public price calculations
    res.json({ 
      commissionPercent: s.commissionPercent ?? 0,
      agentCommissionPercent: s.agentCommissionPercent ?? 15,
    });
  } catch (err) {
    console.error('public system-settings error', err);
    res.status(500).json({ error: 'Could not load system settings' });
  }
});

export default router;
