// What must happen when money lands on an agent booking's agency account,
// however it arrived: recorded by the desk, or confirmed by AzamPay online.
// Before this, only the desk path released the voucher and told the agency,
// so an agency that paid online saw "Paid" but never got its voucher.
import { prisma } from "@nolsaf/prisma";
import { auditRetentionFields } from "./auditRetention.js";
import { notifyUser } from "./notifications.js";
import { emailAgentVoucher } from "./nrmsAgentVoucher.js";

const SETTLED_STATUSES = ["SETTLED", "CREDIT"];

export type AgentFolioPaymentEvent = {
  masterFolioId: number;
  paymentId: number;
  receiptNumber: string;
  amount: number;
  /** Folio status immediately before and after this payment was recorded. */
  statusBefore: string | null;
  statusAfter: string;
  source: "DESK" | "ONLINE";
};

/** True only for the payment that moves the account into settled. */
export function paymentSettlesAccount(statusBefore: string | null, statusAfter: string): boolean {
  return SETTLED_STATUSES.includes(statusAfter) && !SETTLED_STATUSES.includes(String(statusBefore ?? ""));
}

/**
 * Side effects of a recorded agency payment. Runs after the payment commits,
 * never throws, and is a no-op for accounts that belong to a group block
 * rather than an agent booking.
 *
 * The voucher and the agency notice go out once, for the payment that
 * settles the account, so a later top-up or a replayed webhook cannot send
 * them again. The desk path keeps writing its own request-scoped audit entry
 * (it has the user, IP and device); online payments are audited here.
 */
export async function afterAgentFolioPayment(event: AgentFolioPaymentEvent): Promise<{ agentRequestId: number | null; settledNow: boolean }> {
  try {
    const folio = await prisma.nrmsMasterFolio.findUnique({
      where: { id: event.masterFolioId },
      select: {
        agentBookingRequest: {
          select: { id: true, propertyId: true, link: { select: { agentAccount: { select: { primaryUserId: true } } } } },
        },
      },
    });
    const request = folio?.agentBookingRequest;
    if (!request) return { agentRequestId: null, settledNow: false };

    const settledNow = paymentSettlesAccount(event.statusBefore, event.statusAfter);

    if (event.source === "ONLINE") {
      const createdAt = new Date();
      await prisma.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM:AZAMPAY",
          action: "NRMS_AGENT_PAYMENT_RECEIVED",
          entity: "NRMS_AGENT_BOOKING_REQUEST",
          entityId: request.id,
          ip: null,
          ua: null,
          beforeJson: null,
          afterJson: { paymentId: event.paymentId, receiptNumber: event.receiptNumber, amount: event.amount, source: "ONLINE", statusAfter: event.statusAfter },
          createdAt,
          ...auditRetentionFields("NRMS_AGENT_PAYMENT_RECEIVED", "NRMS_AGENT_BOOKING_REQUEST", createdAt),
        },
      }).catch((err: any) => console.warn("[nrmsAgentSettlement] audit failed:", err?.message || String(err)));
    }

    if (settledNow) {
      void emailAgentVoucher(prisma as any, request.id);
      const primaryUserId = request.link?.agentAccount?.primaryUserId;
      if (primaryUserId) {
        const property = await prisma.property.findUnique({ where: { id: request.propertyId }, select: { title: true } });
        void notifyUser(primaryUserId, "nrms_agent_payment_confirmed", { requestId: request.id, propertyTitle: property?.title ?? "", receiptNumber: event.receiptNumber });
      }
    }
    return { agentRequestId: request.id, settledNow };
  } catch (err: any) {
    console.warn("[nrmsAgentSettlement] follow-up failed:", err?.message || String(err));
    return { agentRequestId: null, settledNow: false };
  }
}
