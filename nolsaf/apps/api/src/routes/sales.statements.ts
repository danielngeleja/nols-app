// Sales partner monthly statements and tax identity.
//
// Statements only need workspace access, not an active contract: a partner
// whose agreement has ended still needs their past statements for tax.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesAdminWrite, limitSalesPropertyRead } from "../middleware/rateLimit.js";
import { partnerIdFor, requireWorkspaceAccess, type SalesAuthedRequest } from "../middleware/salesWorkspace.js";
import { salesWithholdingTaxRate } from "../lib/salesFinance.js";
import { STATEMENT_MONTH, buildSalesStatement, listStatementMonths } from "../lib/salesStatement.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"));

const monthSchema = z.object({ month: z.string().regex(STATEMENT_MONTH, "Use a month like 2026-09") });
/** Tanzanian TIN: nine digits, usually written 123-456-789. */
const taxIdSchema = z.object({
  taxIdNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((digits) => /^\d{9}$/.test(digits), "Enter the 9-digit TIN, for example 123-456-789")
    .transform((digits) => `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`),
}).strict();

function partnerId(req: SalesAuthedRequest, res: Response): number | null {
  const id = partnerIdFor(req);
  if (!id) res.status(403).json({ error: "Sales partner context required" });
  return id;
}

/** GET /api/sales/statements */
router.get("/statements", limitSalesPropertyRead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const id = partnerId(req, res);
  if (!id) return;
  const [months, profile] = await Promise.all([
    listStatementMonths(db, id),
    db.salesPartnerProfile.findUnique({ where: { id }, select: { taxIdNumber: true } }),
  ]);
  res.json({
    months,
    taxIdNumber: profile?.taxIdNumber ?? null,
    withholdingTaxRate: salesWithholdingTaxRate(),
  });
}));

/** GET /api/sales/statements/:month */
router.get("/statements/:month", limitSalesPropertyRead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = monthSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid month" });
  const id = partnerId(req, res);
  if (!id) return;
  const statement = await buildSalesStatement(db, id, parsed.data.month);
  if (!statement) return res.status(400).json({ error: "Invalid month" });
  res.json({ statement });
}));

/** PUT /api/sales/statements/tax-id */
router.put("/statements/tax-id", blockImpersonated as RequestHandler, limitSalesAdminWrite, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = taxIdSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid TIN" });
  const id = partnerId(req, res);
  if (!id) return;
  const before = await db.salesPartnerProfile.findUnique({ where: { id }, select: { taxIdNumber: true } });
  await db.salesPartnerProfile.update({ where: { id }, data: { taxIdNumber: parsed.data.taxIdNumber } });
  await db.auditLog.create({
    data: {
      actorId: req.user!.id,
      actorRole: req.user!.role || "USER",
      action: "SALES_PARTNER_TAX_ID_UPDATE",
      entity: "SALES_PARTNER_PROFILE",
      entityId: id,
      beforeJson: { taxIdNumber: before?.taxIdNumber ?? null },
      afterJson: { taxIdNumber: parsed.data.taxIdNumber },
    },
  });
  res.json({ ok: true, taxIdNumber: parsed.data.taxIdNumber });
}));

export default router;
