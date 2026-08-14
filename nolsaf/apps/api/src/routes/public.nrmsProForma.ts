// Public, read-only verification for a property-issued NRMS Pro Forma.
// The opaque token is a bearer capability embedded in the PDF QR code. It
// exposes only this document and the direct property payment instructions.
import { Router, type RequestHandler, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { limitPublicNrmsGuestCapability } from "../middleware/rateLimit.js";
import { publicProFormaView, renderMasterProFormaPdf } from "../lib/nrmsProForma.js";

export const router = Router();

const capabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

router.use("/:token", capabilityHeaders, limitPublicNrmsGuestCapability as RequestHandler);

const include = {
  masterFolio: {
    include: {
      payments: { orderBy: { createdAt: "asc" as const } },
      refunds: { orderBy: { createdAt: "asc" as const } },
      block: true,
    },
  },
};

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(token)) return null;
  return prisma.nrmsMasterFolioProForma.findUnique({ where: { publicToken: token }, include });
}

function unavailable(res: Response) {
  return res.status(404).json({ error: "This Pro Forma link is not available. Ask the property for a new copy." });
}

router.get("/:token", (async (req, res: Response) => {
  try {
    const record = await byToken(req.params.token);
    if (!record) return unavailable(res);
    await prisma.nrmsMasterFolioProForma.update({
      where: { id: record.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    res.json({ proForma: publicProFormaView(record) });
  } catch (err) {
    console.error("[public.nrmsProForma] view failed", err);
    res.status(500).json({ error: "The Pro Forma could not be opened" });
  }
}) as RequestHandler);

router.get("/:token/pdf", (async (req, res: Response) => {
  try {
    const record = await byToken(req.params.token);
    if (!record) return unavailable(res);
    const pdf = await renderMasterProFormaPdf(record);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${record.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[public.nrmsProForma] PDF failed", err);
    res.status(500).json({ error: "The Pro Forma PDF could not be opened" });
  }
}) as RequestHandler);

export default router;
