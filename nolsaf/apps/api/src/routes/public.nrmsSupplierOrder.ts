// Public, no-login page behind a purchase order link (docs/NRMS_STOCK_AND_PURCHASING.md
// section 12: the only supplier-facing surface in scope). The opaque token is a
// bearer capability sent with the order on WhatsApp, SMS or email. It shows
// this one order, serves its PDF, and lets the supplier confirm it and give a
// delivery date. Nothing here changes stock or the order's quantities.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { limitPublicNrmsGuestCapability } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { ORDER_DOCUMENT_INCLUDE, SUPPLIER_CONFIRMABLE, isSupplierToken, publicOrderView, renderPurchaseOrderPdf } from "../lib/nrmsPurchaseOrderDocument.js";

export const router = Router();
const db = prisma as any;

const capabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

router.use("/:token", capabilityHeaders, limitPublicNrmsGuestCapability as RequestHandler);

async function byToken(token: string) {
  if (!isSupplierToken(token)) return null;
  return db.nrmsPurchaseOrder.findUnique({ where: { supplierToken: token }, include: ORDER_DOCUMENT_INCLUDE });
}

function unavailable(res: Response) {
  return res.status(404).json({ error: "This order link is not available. Ask the property to send the order again." });
}

router.get("/:token", (async (req, res: Response) => {
  try {
    const order = await byToken(req.params.token);
    if (!order) return unavailable(res);
    if (!order.supplierViewedAt) await db.nrmsPurchaseOrder.update({ where: { id: order.id }, data: { supplierViewedAt: new Date() } });
    res.json({ order: publicOrderView(order) });
  } catch (err) {
    console.error("[public.nrmsSupplierOrder] view failed", err);
    res.status(500).json({ error: "The order could not be opened" });
  }
}) as RequestHandler);

router.get("/:token/pdf", (async (req, res: Response) => {
  try {
    const order = await byToken(req.params.token);
    if (!order) return unavailable(res);
    const pdf = await renderPurchaseOrderPdf(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${order.orderNumber}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[public.nrmsSupplierOrder] PDF failed", err);
    res.status(500).json({ error: "The order PDF could not be opened" });
  }
}) as RequestHandler);

const confirmSchema = z.object({
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).optional().nullable(),
});

/** POST /:token/confirm - the supplier accepts the order and says when it arrives. Can be repeated to move the date. */
router.post("/:token/confirm", (async (req, res: Response) => {
  try {
    const parsed = confirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose the delivery date" });
    const deliveryDate = new Date(`${parsed.data.deliveryDate}T00:00:00.000Z`);
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    if (deliveryDate.getTime() < today.getTime() - 86_400_000 || deliveryDate.getTime() > today.getTime() + 366 * 86_400_000) {
      return res.status(400).json({ error: "Choose a delivery date from today onwards" });
    }
    const order = await byToken(req.params.token);
    if (!order) return unavailable(res);
    const changed = await db.nrmsPurchaseOrder.updateMany({
      where: { id: order.id, status: { in: SUPPLIER_CONFIRMABLE } },
      data: { supplierConfirmedAt: new Date(), supplierDeliveryDate: deliveryDate, supplierNote: parsed.data.note ? sanitizeText(parsed.data.note) : null },
    });
    if (changed.count !== 1) return res.status(409).json({ error: "This order is no longer open, so it cannot be confirmed." });
    const fresh = await byToken(req.params.token);
    res.json({ order: publicOrderView(fresh) });
  } catch (err) {
    console.error("[public.nrmsSupplierOrder] confirm failed", err);
    res.status(500).json({ error: "The confirmation could not be saved" });
  }
}) as RequestHandler);

export default router;
