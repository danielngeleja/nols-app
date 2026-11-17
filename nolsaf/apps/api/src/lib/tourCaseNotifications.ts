import { prisma } from "@nolsaf/prisma";
import { sendMail } from "./mailer.js";
import { sendSms } from "./sms.js";
import { BRAND_TEAL, proButton, proDetailRows, proDivider, proEmail, proHighlight, proNoteCard } from "./emailBase.js";
import { AMBER, RED, eatDate, escLines, gap, mutedPara, para, signOff } from "./proEmailParts.js";

export type TourCaseOperatorNotificationKind =
  | "SUBMITTED"
  | "TRAVELER_EVIDENCE_SUBMITTED"
  | "EVIDENCE_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "REFUNDED"
  | "UNPAID_AUTO_CANCELLED"
  | "RECOVERY_REQUIRED"
  | "RECOVERY_RECORDED";

type TourCaseOperatorNotification = {
  kind: TourCaseOperatorNotificationKind;
  operatorAgentId: number;
  bookingId: number;
  bookingCode: string;
  caseId: number;
  tourTitle?: string | null;
  startDate?: Date | string | null;
  reason?: string | null;
  refundAmount?: number | null;
  recoveryAmount?: number | null;
  currency?: string | null;
  responseDueAt?: Date | string | null;
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function notificationCopy(input: TourCaseOperatorNotification) {
  const titleByKind: Record<TourCaseOperatorNotificationKind, string> = {
    SUBMITTED: "New traveller cancellation request",
    TRAVELER_EVIDENCE_SUBMITTED: "Traveller submitted cancellation evidence",
    EVIDENCE_REQUESTED: "Cancellation evidence requested",
    APPROVED: "Tour cancellation approved",
    REJECTED: "Tour cancellation request rejected",
    REFUNDED: "Traveller refund completed",
    UNPAID_AUTO_CANCELLED: "Unpaid tour booking cancelled",
    RECOVERY_REQUIRED: "Front payment recovery required",
    RECOVERY_RECORDED: "Front payment recovery recorded",
  };
  const impactByKind: Record<TourCaseOperatorNotificationKind, string> = {
    SUBMITTED: "The booking remains active while NoLSAF reviews the claim. Payout is unavailable while the case is open.",
    TRAVELER_EVIDENCE_SUBMITTED: "New traveller evidence is now available in the case workspace.",
    EVIDENCE_REQUESTED: "NoLSAF requested more evidence before making a final decision.",
    APPROVED: "The booking is cancelled. Any unreleased operator payout is held while the refund is processed; already disbursed funds are handled under a separate recovery notice.",
    REJECTED: "The booking remains active and the cancellation case is closed.",
    REFUNDED: "The traveller refund is complete. Review the final case and payout records in NoLSAF.",
    UNPAID_AUTO_CANCELLED: "The traveller cancelled before paying, so the booking was cancelled automatically. No payment was received, no refund is due, and no action is required from you.",
    RECOVERY_REQUIRED: "The cancellation is approved and a front payment was already disbursed for this booking. NoLSAF will recover the stated amount through repayment or by offsetting your upcoming payouts.",
    RECOVERY_RECORDED: "NoLSAF has recorded the recovery of the disbursed front payment for this cancelled booking. Review the final case and payout records.",
  };
  return { title: titleByKind[input.kind], body: impactByKind[input.kind] };
}

/**
 * Creates the durable in-app alert first, then dispatches email and selected
 * SMS alerts as best-effort secondary channels. External delivery can never
 * roll back or block the cancellation case itself.
 */
export async function notifyTourOperatorCase(input: TourCaseOperatorNotification): Promise<boolean> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: input.operatorAgentId },
      select: { userId: true, user: { select: { name: true, fullName: true, email: true, phone: true } } },
    });
    if (!agent?.userId) return false;

    const copy = notificationCopy(input);
    const origin = (process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
    // Opens the case by its booking code: the operator already knows it, and no row id leaves the server.
    const caseUrl = `${origin}/account/agent/cancellations?view=all&booking=${encodeURIComponent(input.bookingCode)}`;
    const created = await prisma.notification.create({
      data: {
        userId: agent.userId,
        ownerId: null,
        type: "cancellation",
        title: copy.title,
        body: `${copy.body} Booking ${input.bookingCode}.`,
        unread: true,
        meta: { href: caseUrl, tourBookingId: input.bookingId, bookingCode: input.bookingCode, caseId: input.caseId, kind: input.kind },
      },
    });

    if (["SUBMITTED", "TRAVELER_EVIDENCE_SUBMITTED", "EVIDENCE_REQUESTED"].includes(input.kind)) {
      const existingDelivery = await prisma.tourCaseEvent.findFirst({
        where: { tourCaseId: input.caseId, type: "OPERATOR_NOTIFIED" },
        select: { id: true },
      });
      if (!existingDelivery) await prisma.tourCaseEvent.create({
        data: {
          tourCaseId: input.caseId,
          actorUserId: null,
          type: "OPERATOR_NOTIFIED",
          message: "NoLSAF delivered this case to the assigned tour operator workspace.",
          data: { operatorAgentId: input.operatorAgentId, notificationId: created.id, channel: "IN_APP", deliveredAt: new Date().toISOString() },
        },
      });
    }

    try {
      const io = (global as any).io;
      io?.to?.(`user:${agent.userId}`).emit("notification:new", {
        id: created.id, userId: agent.userId, type: created.type,
        title: created.title, body: created.body, createdAt: created.createdAt,
      });
    } catch { /* realtime is best-effort */ }

    const operatorName = agent.user.fullName || agent.user.name || "Tour operator";
    // Accent follows the content: money owed is red, a request for action amber, the rest teal.
    const accent = input.kind === "RECOVERY_REQUIRED" ? RED
      : ["SUBMITTED", "EVIDENCE_REQUESTED", "TRAVELER_EVIDENCE_SUBMITTED"].includes(input.kind) ? AMBER
        : BRAND_TEAL;
    const currency = escapeHtml(input.currency || "TZS");
    const money = (value: number) => `${currency} ${Number(value).toLocaleString("en-US")}`;
    const rows: Array<[string, string]> = [
      ["Tour", escapeHtml(input.tourTitle || "Tour package")],
      ["Booking", escapeHtml(input.bookingCode)],
      ["Travel date", input.startDate ? escapeHtml(eatDate(input.startDate)) : "Not recorded"],
    ];
    if (input.responseDueAt) rows.push(["Respond by", `<span style="color:${AMBER};">${escapeHtml(eatDate(input.responseDueAt, true))}</span>`]);
    const amount = input.recoveryAmount != null
      ? proHighlight("Amount to recover from you", money(input.recoveryAmount), "Recovered by repayment or by offsetting your upcoming payouts.", RED, "#fff6f5")
      : input.refundAmount != null
        ? proHighlight("Refund to the traveller", money(input.refundAmount), "", BRAND_TEAL)
        : "";
    const emailHtml = proEmail(escapeHtml(copy.title), `
      ${para(`Hello ${escapeHtml(operatorName)},`)}
      ${para(escapeHtml(copy.body))}
      ${amount ? `${amount}${gap()}` : ""}
      ${proDetailRows("Case details", rows)}
      ${input.reason ? `${gap()}${proNoteCard(accent, "Case note", escLines(input.reason))}` : ""}
      ${gap(22)}
      ${proButton(caseUrl, "Open the case", accent)}
      ${proDivider()}
      ${mutedPara("NoLSAF makes the final cancellation and refund decision. Keep all evidence and messages inside the case workspace.")}
      ${signOff("NoLSAF Traveller Care")}
    `);

    const deliveries: Promise<unknown>[] = [];
    if (agent.user.email) deliveries.push(sendMail(agent.user.email, `${copy.title}: ${input.bookingCode}`, emailHtml));
    if (agent.user.phone && ["SUBMITTED", "APPROVED", "REJECTED", "REFUNDED", "RECOVERY_REQUIRED"].includes(input.kind)) {
      deliveries.push(sendSms(agent.user.phone, `NoLSAF: ${copy.title}. Booking ${input.bookingCode}. ${copy.body} Open your operator portal.`));
    }
    if (deliveries.length) void Promise.allSettled(deliveries);
    return true;
  } catch (error: any) {
    console.warn("[tour-case-notify] operator notification failed:", error?.message || error);
    return false;
  }
}
