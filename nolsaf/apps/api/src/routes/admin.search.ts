import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminRecordReferenceOrNull as recordRef } from "../lib/adminRecordReference.js";

export const router = Router();
// Protect this route for admins only
router.use(requireAuth as any, requireRole("ADMIN") as any);

/** GET /admin/search?q=term */
router.get("/", async (req, res) => {
  try {
    // MySQL doesn't support `mode: "insensitive"`; rely on default CI collations.
    const q = String((req.query as any).q ?? "").trim().slice(0, 120);
    if (!q) return res.json([]);

    const whereText = (role?: string) => ({
      role,
      OR: [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ],
    });

    const [owners, drivers, users, properties, bookings] = await Promise.all([
      prisma.user.findMany({ where: whereText("OWNER"), select: { id: true, name: true, email: true, phone: true }, take: 5 }),
      prisma.user.findMany({ where: whereText("DRIVER"), select: { id: true, name: true, email: true, phone: true }, take: 5 }),
      prisma.user.findMany({ where: whereText("USER"), select: { id: true, name: true, email: true, phone: true }, take: 5 }),
      prisma.property.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { regionName: { contains: q } },
            { district: { contains: q } },
            { owner: { is: { name: { contains: q } } } },
          ],
        },
        select: { id: true, title: true, regionName: true, district: true, owner: { select: { id: true, name: true } } },
        take: 5,
      }),
      prisma.booking.findMany({
        where: {
          OR: [
            { guestName: { contains: q } },
            { property: { is: { title: { contains: q } } } },
            { code: { is: { codeVisible: { contains: q } } } },
          ],
        },
        select: { id: true, guestName: true, property: { select: { id: true, title: true } }, code: { select: { codeVisible: true } } },
        take: 5,
      }),
    ]);

    const suggestions = [
      ...owners.map((o) => ({ label: o.name ? `${o.name}${o.email ? ` — ${o.email}` : ''}` : `Owner ${o.id}`, href: `/admin/owners/${recordRef("owner", o.id) ?? o.id}`, type: "Owner", meta: { email: o.email, phone: o.phone } })),
      ...drivers.map((d) => ({ label: d.name ? `${d.name}${d.email ? ` — ${d.email}` : ''}` : `Driver ${d.id}`, href: `/admin/drivers/audit/${recordRef("driver", d.id) ?? d.id}`, type: "Driver", meta: { email: d.email, phone: d.phone } })),
      ...users.map((u) => ({ label: u.name ? `${u.name}${u.email ? ` — ${u.email}` : ''}` : `User ${u.id}`, href: `/admin/users/${recordRef("user", u.id) ?? u.id}`, type: "User", meta: { email: u.email, phone: u.phone } })),
      ...properties.map((p) => ({ label: p.title ? `${p.title}${p.owner?.name ? ` — ${p.owner.name}` : p.regionName ? ` — ${p.regionName}` : p.district ? ` — ${p.district}` : ''}` : `Property ${p.id}`, href: `/admin/properties/previews?previewId=${recordRef("property", p.id) ?? p.id}`, type: "Property", meta: { regionName: p.regionName, district: p.district, owner: p.owner } })),
      ...bookings.map((b) => ({ label: b.guestName ? `${b.guestName} — ${b.property?.title ?? 'Booking'}${b.code?.codeVisible ? ` (#${b.code.codeVisible})` : ''}` : `Booking ${b.id}`, href: `/admin/bookings/${recordRef("booking", b.id) ?? b.id}`, type: "Booking", meta: { code: b.code?.codeVisible, property: b.property } })),
    ];

    return res.json(suggestions);
  } catch (err) {
    console.error("Error in /admin/search:", err);
    return res.status(500).json([]);
  }
});

export default router;
