import { Router, type Request, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { payslipNumberFromToken } from "../lib/payslipSeal.js";

/**
 * GET /api/public/payslips/verify?t=<token>
 * Behind the QR code on a payslip. Confirms the slip is genuine and returns
 * NoLSAF's own figures so a bank, landlord or embassy can compare them with
 * the printout. Only paid runs count as issued. The name is shortened and no
 * TIN, NSSF or account number is returned.
 */
const router = Router();

const verifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** "Leonidas James Kapufi" -> "Leonidas J. K." */
function shortName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Not recorded";
  return [parts[0], ...parts.slice(1).map((p) => `${p[0]?.toUpperCase()}.`)].join(" ");
}

router.get("/verify", verifyLimiter, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const token = String(req.query.t || req.query.token || "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

  const payslipNumber = payslipNumberFromToken(token);
  if (!payslipNumber) return res.json({ ok: true, valid: false, reason: "ALTERED" });

  try {
    const slip = await prisma.payslip.findUnique({
      where: { payslipNumber },
      include: { run: { select: { runNumber: true, periodMonth: true, status: true, payDate: true, paidAt: true } } },
    });
    if (!slip) return res.json({ ok: true, valid: false, reason: "NOT_FOUND" });
    if (slip.run.status !== "PAID") return res.json({ ok: true, valid: false, reason: "NOT_ISSUED" });

    const snapshot = (slip.employeeSnapshot ?? {}) as Record<string, any>;
    return res.json({
      ok: true,
      valid: true,
      payslip: {
        issuer: "NoLS Africa Co Ltd",
        payslipNumber: slip.payslipNumber,
        periodMonth: slip.run.periodMonth,
        employeeName: shortName(snapshot.fullName),
        employeeNo: snapshot.employeeNo ?? null,
        jobTitle: snapshot.jobTitle ?? null,
        gross: n(slip.gross),
        totalDeductions: n(slip.totalDeductions),
        net: n(slip.net),
        currency: "TZS",
        paidOn: slip.run.payDate ?? slip.run.paidAt,
      },
    });
  } catch (err: any) {
    console.error("GET public/payslips/verify error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Verification unavailable" });
  }
});

export default router;
