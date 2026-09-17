// apps/api/src/routes/admin.newsletter.ts
//
//   GET /api/admin/newsletter             paginated subscribers + counts by status
//   GET /api/admin/newsletter/export.csv  confirmed subscribers as CSV

import { Router, type Request, type RequestHandler, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { NEWSLETTER_STATUS, csvCell } from "../lib/newsletter.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

router.get("/", async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const status = String(req.query.status || "").toUpperCase();
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 254);

  const where: any = {};
  if ((Object.values(NEWSLETTER_STATUS) as string[]).includes(status)) where.status = status;
  if (q) where.email = { contains: q };

  try {
    const [items, total, grouped] = await Promise.all([
      db.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, email: true, status: true, source: true, confirmedAt: true, unsubscribedAt: true, createdAt: true },
      }),
      db.newsletterSubscriber.count({ where }),
      db.newsletterSubscriber.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = { PENDING: 0, SUBSCRIBED: 0, UNSUBSCRIBED: 0 };
    for (const row of grouped as any[]) counts[row.status] = row._count?._all ?? 0;
    return res.json({ ok: true, items, total, page, pageSize, counts });
  } catch (error) {
    if (isMissingTable(error)) {
      return res.json({ ok: true, items: [], total: 0, page, pageSize, counts: { PENDING: 0, SUBSCRIBED: 0, UNSUBSCRIBED: 0 }, notMigrated: true });
    }
    console.error("admin.newsletter.list.failed", error);
    return res.status(500).json({ ok: false, error: "Failed to load subscribers" });
  }
});

router.get("/export.csv", async (_req: Request, res: Response) => {
  try {
    const rows = await db.newsletterSubscriber.findMany({
      where: { status: NEWSLETTER_STATUS.SUBSCRIBED },
      orderBy: { confirmedAt: "asc" },
      select: { email: true, source: true, confirmedAt: true, createdAt: true },
    });
    const lines = [
      ["email", "source", "confirmed_at", "signed_up_at"].map(csvCell).join(","),
      ...rows.map((r: any) => [r.email, r.source, r.confirmedAt, r.createdAt].map(csvCell).join(",")),
    ];
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="nolsaf-newsletter-${date}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(lines.join("\r\n"));
  } catch (error) {
    if (isMissingTable(error)) return res.status(503).json({ ok: false, error: "Newsletter table not migrated yet" });
    console.error("admin.newsletter.export.failed", error);
    return res.status(500).json({ ok: false, error: "Failed to export subscribers" });
  }
});

export default router;
