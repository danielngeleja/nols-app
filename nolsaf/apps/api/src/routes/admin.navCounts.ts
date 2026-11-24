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
  const [listings, payouts, trips, groupStays, cancellations, tenantIds, inspections, enquiries, longStays, longStayClaims] = await Promise.all([
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
    safe(prisma.longStayTenantProfile.count({ where: { status: "PENDING", barredAt: null } })),
    safe(prisma.longStayInspection.count({ where: { status: { in: ["REQUESTED", "SUBMITTED"] } } })),
    safe(prisma.longStayEnquiry.count({ where: { status: "OPEN" } })),
    safe(prisma.tenancy.count({ where: { OR: [
      { status: { in: ["DISPUTED", "OVERDUE"] } },
      { payoutStatus: { in: ["READY", "REVIEW", "REFUND_DUE"] } },
    ] } })),
    safe(prisma.tenancyClaim.count({ where: { closedAt: null, OR: [
      { status: { in: ["OPEN", "RECOVERING"] }, escalatedAt: { not: null } },
      { status: "RECOVERED" },
    ] } })),
  ]);

  res.set("Cache-Control", "private, no-cache");
  res.json({ listings, payouts, trips, groupStays, cancellations, tenantIds, inspections, enquiries, longStays: longStays + longStayClaims });
});

export default router;
