import { Router } from "express";
// @ts-ignore - prisma types may be declared in workspace packages
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminRecordReferenceOrNull as recordRef } from "../lib/adminRecordReference.js";

export const router = Router();
router.use(requireAuth as any, requireRole("ADMIN") as any);

/** GET /admin/search/suggest?q=&limit= */
router.get("/suggest", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Number(req.query.limit || 8), 50) || 8;

  if (!q) return res.json({ items: [] });

  // simple, fast queries using insensitive contains; keep limits small
  const qStr = q;
  const ownerPromise = prisma.user.findMany({
    where: {
      role: "OWNER",
      OR: [
        { name: { contains: qStr } },
        { email: { contains: qStr } },
        { phone: { contains: qStr } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: Math.min(4, limit),
  });

  const propPromise = prisma.property.findMany({
    where: {
      OR: [
        { title: { contains: qStr } },
        { regionName: { contains: qStr } },
        { district: { contains: qStr } },
      ],
    },
    select: { id: true, title: true, regionName: true, district: true },
    take: Math.min(4, limit),
  });

  const invPromise = prisma.invoice.findMany({
    where: {
      OR: [
        { invoiceNumber: { contains: qStr } },
        { receiptNumber: { contains: qStr } },
      ],
    },
    select: { id: true, invoiceNumber: true },
    take: Math.min(4, limit),
  });

  const [owners, props, invs] = await Promise.all([ownerPromise, propPromise, invPromise]);

  const items: any[] = [];
  (owners as any[]).forEach((o: any) => items.push({ type: "owner", id: o.id, title: o.name || `#${o.id}`, subtitle: o.email || "", href: `/admin/owners/${recordRef("owner", o.id) ?? o.id}` }));
  (props as any[]).forEach((p: any) => items.push({ type: "property", id: p.id, title: p.title || `#${p.id}`, subtitle: (p.regionName || p.district) || "", href: `/admin/properties/previews?previewId=${recordRef("property", p.id) ?? p.id}` }));
  (invs as any[]).forEach((v: any) => items.push({ type: "invoice", id: v.id, title: v.invoiceNumber || `#${v.id}`, subtitle: "", href: `/admin/revenue?q=${encodeURIComponent(v.invoiceNumber || '')}` }));

  res.json({ items: items.slice(0, limit) });
});

export default router;
