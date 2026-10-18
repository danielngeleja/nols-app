import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";

// GET /api/admin/nav-counts
// What waits on an admin in each sidebar section, as plain counts. Each figure uses
// the same definition as the page it points to, and a failed count reads as 0 so the
// sidebar never breaks over a hint.
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const safe = (p: Promise<number>) => p.catch(() => 0);

router.get("/", async (_req, res) => {
  const [listings, payouts, trips, groupStays, cancellations] = await Promise.all([
    // Owners: listings waiting for review (same as the admin home queue).
    safe(prisma.property.count({ where: { status: "PENDING" } as any })),
    // Disbursements: approved owner invoices whose money is not yet sent (payments summary "waiting").
    safe(prisma.invoice.count({ where: { status: "APPROVED" } })),
    // Drivers: completed trips not yet paid (drivers summary "tripsPendingReconciliation").
    safe(
      (prisma as any).transportBooking.count({
        where: { status: "COMPLETED", OR: [{ paymentStatus: null }, { paymentStatus: { not: "PAID" } }] },
      }),
    ),
    // Group stays: new requests not yet picked up.
    safe((prisma as any).groupBooking.count({ where: { status: "PENDING" } })),
    // Cancellations waiting on an admin decision (NEED_INFO waits on the customer).
    safe(prisma.cancellationRequest.count({ where: { status: { in: ["SUBMITTED", "REVIEWING"] } } as any })),
  ]);

  res.set("Cache-Control", "private, max-age=20");
  res.json({ listings, payouts, trips, groupStays, cancellations });
});

export default router;
