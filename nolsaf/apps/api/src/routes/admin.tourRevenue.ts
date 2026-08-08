import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notifyUser } from "../lib/notifications.js";

const router = Router();
const PAYMENT_ACCESS_TOKEN_HOURS = 12;

router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);

type RevenueStatus = "DRAFT" | "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED";

type RevenueHistoryActor = {
  id: number;
  name: string | null;
};

type RevenueHistoryStep = {
  at?: string;
  reason?: string;
  actor?: RevenueHistoryActor;
  paymentRef?: string;
};

type RevenueHistoryMetadata = {
  revenueHistory?: {
    verified?: RevenueHistoryStep;
    approved?: RevenueHistoryStep;
    disbursed?: RevenueHistoryStep;
    rejected?: RevenueHistoryStep;
  };
};

type RevenueAuditTrailItem = {
  action: "VERIFY" | "APPROVE" | "DISBURSE" | "REJECT";
  at: string;
  reason: string | null;
  paymentRef: string | null;
  admin: RevenueHistoryActor | null;
};

function toRevenueMetadata(value: unknown): RevenueHistoryMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as RevenueHistoryMetadata;
}

function safeObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function paymentAccessSnapshot(metadata: unknown, createdAt: Date) {
  const access = safeObject(safeObject(metadata).paymentAccess);
  const createdAtMs = createdAt instanceof Date && Number.isFinite(createdAt.getTime()) ? createdAt.getTime() : Date.now();
  const expiresAt = new Date(createdAtMs + PAYMENT_ACCESS_TOKEN_HOURS * 60 * 60 * 1000).toISOString();
  const issuedAt = String(access.issuedAt || new Date(createdAtMs).toISOString()).trim();
  const expiresAtMs = new Date(expiresAt).getTime();
  return {
    status: Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() ? "ACTIVE" : "EXPIRED",
    issuedAt,
    expiresAt,
    tokenHours: Number(access.tokenHours || PAYMENT_ACCESS_TOKEN_HOURS),
    source: String(access.source || "CREATED_AT_FALLBACK"),
  };
}

function deriveRevenueStatus(
  paymentStatusValue: unknown,
  payoutStatusValue: unknown,
  payoutRequestedAt: unknown,
  payoutApprovedAt: unknown,
  payoutPaidAt: unknown,
  paidAt?: unknown,
): RevenueStatus {
  const paymentStatus = String(paymentStatusValue || "").toUpperCase();
  const payoutStatus = String(payoutStatusValue || "").toUpperCase();
  const customerPaymentComplete = paymentStatus === "PAID" || Boolean(paidAt);

  // paymentStatus legacy checks remain so older rows that stored payout workflow
  // states in the wrong column still render correctly until they are cleaned.
  if (paymentStatus === "REJECTED" || payoutStatus === "REJECTED") return "REJECTED";
  if (payoutPaidAt || paymentStatus === "DISBURSED" || payoutStatus === "DISBURSED" || payoutStatus === "PAID") return "DISBURSED";
  if (payoutApprovedAt || paymentStatus === "APPROVED" || payoutStatus === "APPROVED") return "APPROVED";
  if (payoutStatus === "VERIFIED" || paymentStatus === "VERIFIED") return "VERIFIED";
  if (payoutRequestedAt || payoutStatus === "REQUESTED" || payoutStatus === "CLAIMED") return "CLAIMED";
  if (!customerPaymentComplete) return "DRAFT";
  return "NEW";
}

/**
 * GET /api/admin/tour-revenue/overview
 * Admin view: Returns revenue summary and all revenue records across all operators
 */
router.get("/overview", async (req: any, res) => {
  try {
    // Fetch all tour revenue records
    const bookings = await prisma.tourBooking.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bookingCode: true,
        operatorAgentId: true,
        operator: {
          select: {
            id: true,
            user: {
              select: {
                fullName: true,
                name: true,
              },
            },
          },
        },
        title: true,
        destination: true,
        travelerCount: true,
        grossAmount: true,
        commissionPercent: true,
        commissionAmount: true,
        currency: true,
        paymentStatus: true,
        payoutStatus: true,
        paymentRef: true,
        metadata: true,
        notes: true,
        payoutRequestedAt: true,
        payoutApprovedAt: true,
        payoutPaidAt: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Fetch system commission setting
    const settings = await prisma.systemSetting.findFirst({
      select: { agentCommissionCurrency: true, taxPercent: true } as any,
    });
    const agentCommissionCurrency: string = (settings as any)?.agentCommissionCurrency ?? "TZS";
    const taxPercent = num((settings as any)?.taxPercent ?? 0);

    // Map bookings to revenue records with status
    const revenueRecords = bookings.map((booking) => {
      const grossAmount = num(booking.grossAmount || 0);
      const commissionAmount = num(booking.commissionAmount || 0);
      const netAmount = grossAmount - commissionAmount;
      // Use the commission percent stamped on the booking at creation time
      const commissionPercent = num((booking as any).commissionPercent ?? 0);
      const taxAmount = Math.round(grossAmount * taxPercent) / 100;
      const operatorName = booking.operator?.user?.fullName || booking.operator?.user?.name || `Operator #${booking.operatorAgentId}`;

      const status = deriveRevenueStatus(
        booking.paymentStatus,
        booking.payoutStatus,
        booking.payoutRequestedAt,
        booking.payoutApprovedAt,
        booking.payoutPaidAt,
        booking.paidAt,
      );

      const metadata = toRevenueMetadata((booking as any)?.metadata);
      const historyDisbursedRef = String(metadata?.revenueHistory?.disbursed?.paymentRef || "").trim();
      const paymentRef = String((booking as any)?.paymentRef || "").trim() || historyDisbursedRef || null;
      const historyRejectedReason = String(metadata?.revenueHistory?.rejected?.reason || "").trim();
      const rejectionReason = historyRejectedReason || String((booking as any)?.notes || "").trim() || null;

      return {
        id: booking.id,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        operatorAgentId: booking.operatorAgentId,
        operatorName,
        tourTitle: booking.title || "Untitled Tour",
        destination: booking.destination || "Unknown",
        numberOfPeople: booking.travelerCount || 0,
        grossAmount,
        commissionPercent,
        commissionAmount,
        taxPercent,
        taxAmount,
        netAmount,
        currency: booking.currency || "TZS",
        status,
        paymentAccess: paymentAccessSnapshot(booking.metadata, booking.createdAt),
        paymentRef,
        rejectionReason,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      };
    });

    // Calculate summary
    const summary = {
      total: revenueRecords.length,
      draft: revenueRecords.filter((r) => r.status === "DRAFT").length,
      new: revenueRecords.filter((r) => r.status === "NEW").length,
      claimed: revenueRecords.filter((r) => r.status === "CLAIMED").length,
      verified: revenueRecords.filter((r) => r.status === "VERIFIED").length,
      approved: revenueRecords.filter((r) => r.status === "APPROVED").length,
      disbursed: revenueRecords.filter((r) => r.status === "DISBURSED").length,
      rejected: revenueRecords.filter((r) => r.status === "REJECTED").length,
      totalAmount: revenueRecords.reduce((sum, r) => sum + r.grossAmount, 0),
      disbursedAmount: revenueRecords
        .filter((r) => r.status === "DISBURSED")
        .reduce((sum, r) => sum + r.netAmount, 0),
    };

    return res.json({
      ok: true,
      summary,
      revenues: revenueRecords,
      agentCommissionCurrency,
    });
  } catch (err: any) {
    console.error("[GET /api/admin/tour-revenue/overview] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load revenue overview" });
  }
});

/**
 * POST /api/admin/tour-revenue/action
 * Admin execute revenue action (verify, approve, disburse, reject)
 * Body: { revenueId: number, action: "verify"|"approve"|"disburse"|"reject", paymentRef?: string, reason?: string }
 */
router.post("/action", async (req: any, res) => {
  try {
    const adminId = Number(req.user?.id);
    const { revenueId, action, paymentRef, reason } = req.body || {};

    if (!adminId) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (!revenueId || !action) return res.status(400).json({ ok: false, error: "Missing required fields" });

    // "disburse" was retired — operator payouts now move exclusively through
    // the AzamPay Disbursement ledger (services/payouts/ledger.ts), reached
    // from this record once it is APPROVED. See admin.disbursements.ts.
    const validActions = ["verify", "approve", "reject"];
    if (!validActions.includes(action)) {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    // Fetch the booking
    const booking = await prisma.tourBooking.findUnique({
      where: { id: Number(revenueId) },
    });

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Revenue record not found" });
    }

    const currentStatus = deriveRevenueStatus(
      (booking as any).paymentStatus,
      (booking as any).payoutStatus,
      (booking as any).payoutRequestedAt,
      (booking as any).payoutApprovedAt,
      (booking as any).payoutPaidAt,
      (booking as any).paidAt,
    );
    const actionReason = String(reason || "").trim();

    if (action === "verify" && currentStatus !== "CLAIMED") {
      return res.status(400).json({ ok: false, error: "Only CLAIMED records can be verified" });
    }
    if (action === "verify" && !actionReason) {
      return res.status(400).json({ ok: false, error: "Verification reason is required" });
    }

    if (action === "approve" && currentStatus !== "VERIFIED") {
      return res.status(400).json({ ok: false, error: "Record must be VERIFIED before APPROVE" });
    }
    if (action === "approve" && !actionReason) {
      return res.status(400).json({ ok: false, error: "Approval reason is required" });
    }

    if (action === "reject") {
      if (currentStatus === "DISBURSED" || currentStatus === "REJECTED") {
        return res.status(400).json({ ok: false, error: "Cannot reject a DISBURSED or already REJECTED record" });
      }
      if (!actionReason) {
        return res.status(400).json({ ok: false, error: "Rejection reason is required" });
      }
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, name: true, fullName: true },
    });
    const adminName = (adminUser as any)?.fullName || (adminUser as any)?.name || null;

    const metadata = toRevenueMetadata((booking as any)?.metadata);
    const history = metadata.revenueHistory || {};
    const nowIso = new Date().toISOString();

    // Perform action
    let updatedData: any = { updatedAt: new Date() };

    if (action === "verify") {
      updatedData.payoutStatus = "VERIFIED";
      updatedData.notes = actionReason;
      history.verified = {
        ...(history.verified || {}),
        at: nowIso,
        reason: actionReason,
        actor: { id: adminId, name: adminName },
      };
    } else if (action === "approve") {
      updatedData.payoutStatus = "APPROVED";
      updatedData.payoutApprovedAt = new Date();
      history.approved = {
        ...(history.approved || {}),
        at: nowIso,
        reason: actionReason,
        actor: { id: adminId, name: adminName },
      };
    } else if (action === "reject") {
      updatedData.payoutStatus = "REJECTED";
      updatedData.notes = actionReason;
      history.rejected = {
        ...(history.rejected || {}),
        at: nowIso,
        reason: actionReason,
        actor: { id: adminId, name: adminName },
      };
    }

    updatedData.metadata = {
      ...metadata,
      revenueHistory: history,
    };

    const updated = await prisma.tourBooking.update({
      where: { id: Number(revenueId) },
      data: updatedData,
    });

    // Log audit trail
    try {
      await (prisma as any).auditLog?.create?.({
        data: {
          actorId: adminId,
          actorRole: "ADMIN",
          action: `TOUR_REVENUE_${action.toUpperCase()}`,
          entity: `tour-booking:${revenueId}`,
          entityId: Number(revenueId),
          afterJson: { action, reason: actionReason || null, paymentRef: paymentRef || null, ...updatedData } as any,
        },
      });
    } catch {
      // Audit logging is optional
    }

    try {
      const operatorAgent = await prisma.agent.findUnique({
        where: { id: (booking as any).operatorAgentId },
        select: { userId: true },
      });
      if (operatorAgent?.userId) {
        const template =
          action === "verify" ? "agent_payout_verified" :
          action === "approve" ? "agent_payout_approved" :
          "agent_payout_rejected";
        await notifyUser(operatorAgent.userId, template, {
          tourBookingId: updated.id,
          bookingCode: (updated as any).bookingCode,
          reason: actionReason || null,
        });
      }
    } catch {
      // non-fatal
    }

    return res.json({
      ok: true,
      message: `Revenue ${action}ed successfully`,
      booking: updated,
    });
  } catch (err: any) {
    console.error("[POST /api/admin/tour-revenue/action] Error:", err);
    return res.status(500).json({ ok: false, error: "Action failed" });
  }
});

/**
 * GET /api/admin/tour-revenue/:id
 * Admin detail view: Returns one tour revenue record with full booking context
 */
router.get("/:id", async (req: any, res) => {
  try {
    const revenueId = Number(req.params.id);
    if (!Number.isFinite(revenueId) || revenueId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid revenue id" });
    }

    const [booking, settings, auditTrailRows] = await Promise.all([
      prisma.tourBooking.findUnique({
        where: { id: revenueId },
        include: {
          operator: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  fullName: true,
                  name: true,
                  email: true,
                  phone: true,
                  payout: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
      prisma.systemSetting.findFirst({
        select: { taxPercent: true, agentCommissionCurrency: true } as any,
      }),
      prisma.auditLog.findMany({
        where: {
          entity: `tour-booking:${revenueId}`,
          action: {
            in: [
              "TOUR_REVENUE_VERIFY",
              "TOUR_REVENUE_APPROVE",
              "TOUR_REVENUE_DISBURSE",
              "TOUR_REVENUE_REJECT",
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          action: true,
          createdAt: true,
          afterJson: true,
          actor: {
            select: {
              id: true,
              fullName: true,
              name: true,
            },
          },
        },
      }),
    ]);

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Revenue record not found" });
    }

    const grossAmount = num((booking as any).grossAmount || 0);
    const commissionAmount = num((booking as any).commissionAmount || 0);
    const commissionPercent = num((booking as any).commissionPercent || 0);
    const taxPercent = num((settings as any)?.taxPercent ?? 0);
    const taxAmount = Math.round(grossAmount * taxPercent) / 100;
    const netAmount = grossAmount - commissionAmount;
    const metadata = toRevenueMetadata((booking as any).metadata);
    const history = metadata.revenueHistory || {};
    const auditTrail: RevenueAuditTrailItem[] = (auditTrailRows || [])
      .map((row: any) => {
        const actionRaw = String(row?.action || "").toUpperCase();
        const action =
          actionRaw === "TOUR_REVENUE_VERIFY"
            ? "VERIFY"
            : actionRaw === "TOUR_REVENUE_APPROVE"
              ? "APPROVE"
              : actionRaw === "TOUR_REVENUE_DISBURSE"
                ? "DISBURSE"
                : actionRaw === "TOUR_REVENUE_REJECT"
                  ? "REJECT"
                  : null;
        if (!action) return null;

        const afterJson = row?.afterJson && typeof row.afterJson === "object" ? row.afterJson : {};
        const reason =
          typeof (afterJson as any)?.reason === "string"
            ? String((afterJson as any).reason).trim()
            : null;
        const paymentRef =
          typeof (afterJson as any)?.paymentRef === "string"
            ? String((afterJson as any).paymentRef).trim()
            : null;

        return {
          action,
          at: new Date(row.createdAt).toISOString(),
          reason: reason || null,
          paymentRef: paymentRef || null,
          admin: row?.actor
            ? {
                id: Number(row.actor.id),
                name: row.actor.fullName || row.actor.name || `User #${row.actor.id}`,
              }
            : null,
        } as RevenueAuditTrailItem;
      })
      .filter(Boolean) as RevenueAuditTrailItem[];

    const latestByAction = {
      verify: auditTrail.filter((x) => x.action === "VERIFY").slice(-1)[0] || null,
      approve: auditTrail.filter((x) => x.action === "APPROVE").slice(-1)[0] || null,
      disburse: auditTrail.filter((x) => x.action === "DISBURSE").slice(-1)[0] || null,
      reject: auditTrail.filter((x) => x.action === "REJECT").slice(-1)[0] || null,
    };
    const operatorPayout =
      booking.operator?.user && typeof (booking.operator.user as any).payout === "object" && (booking.operator.user as any).payout !== null
        ? ((booking.operator.user as any).payout as Record<string, any>)
        : {};

    return res.json({
      ok: true,
      revenue: {
        id: booking.id,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        status: deriveRevenueStatus(
          (booking as any).paymentStatus,
          (booking as any).payoutStatus,
          (booking as any).payoutRequestedAt,
          (booking as any).payoutApprovedAt,
          (booking as any).payoutPaidAt,
          (booking as any).paidAt,
        ),
        paymentStatus: (booking as any).paymentStatus || "UNPAID",
        payoutStatus: (booking as any).payoutStatus || "NOT_READY",
        paymentRef: (booking as any).paymentRef || null,
        rejectionReason: history.rejected?.reason || latestByAction.reject?.reason || null,
        verifiedAt: history.verified?.at || latestByAction.verify?.at || null,
        approvedAt: history.approved?.at || latestByAction.approve?.at || null,
        disbursedAt: history.disbursed?.at || latestByAction.disburse?.at || null,
        verifiedReason: history.verified?.reason || latestByAction.verify?.reason || null,
        approvedReason: history.approved?.reason || latestByAction.approve?.reason || null,
        verifiedByUser: history.verified?.actor || latestByAction.verify?.admin || null,
        approvedByUser: history.approved?.actor || latestByAction.approve?.admin || null,
        title: (booking as any).title || "Untitled Tour",
        destination: (booking as any).destination || "Unknown",
        category: (booking as any).category || null,
        travelerCount: (booking as any).travelerCount || 0,
        guestName: (booking as any).guestName || null,
        guestEmail: (booking as any).guestEmail || null,
        guestPhone: (booking as any).guestPhone || null,
        startDate: (booking as any).startDate || null,
        endDate: (booking as any).endDate || null,
        currency: (booking as any).currency || "TZS",
        grossAmount,
        commissionPercent,
        commissionAmount,
        taxPercent,
        taxAmount,
        netAmount,
        operatorPayoutAmount: num((booking as any).operatorPayoutAmount || netAmount),
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        paidAt: (booking as any).paidAt || null,
        payoutRequestedAt: (booking as any).payoutRequestedAt || null,
        payoutApprovedAt: (booking as any).payoutApprovedAt || null,
        payoutPaidAt: (booking as any).payoutPaidAt || null,
        operator: {
          id: booking.operator?.id || (booking as any).operatorAgentId,
          name: booking.operator?.user?.fullName || booking.operator?.user?.name || `Operator #${(booking as any).operatorAgentId}`,
          email: booking.operator?.user?.email || null,
          phone: booking.operator?.user?.phone || null,
          payoutPreferred: operatorPayout.payoutPreferred ?? null,
          bankAccountName: operatorPayout.bankAccountName ?? null,
          bankName: operatorPayout.bankName ?? null,
          bankAccountNumber: operatorPayout.bankAccountNumber ?? null,
          bankBranch: operatorPayout.bankBranch ?? null,
          mobileMoneyProvider: operatorPayout.mobileMoneyProvider ?? null,
          mobileMoneyNumber: operatorPayout.mobileMoneyNumber ?? null,
        },
        customer: {
          id: booking.customer?.id || null,
          name: booking.customer?.fullName || booking.customer?.name || (booking as any).guestName || "Guest",
          email: booking.customer?.email || (booking as any).guestEmail || null,
          phone: booking.customer?.phone || (booking as any).guestPhone || null,
        },
        auditTrail,
      },
      agentCommissionCurrency: (settings as any)?.agentCommissionCurrency ?? "TZS",
    });
  } catch (err: any) {
    console.error("[GET /api/admin/tour-revenue/:id] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load revenue details" });
  }
});

export default router;
