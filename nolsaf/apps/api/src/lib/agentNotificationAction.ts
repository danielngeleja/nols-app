// =============================================================================
// Where each tour operator notification leads, decided on the server.
//
// A notification is a shortcut: it should open the exact page the operator
// needs to act on. The inbox reads this at list time, so older notifications
// get the same links as new ones, and booking pages are reached by their
// opaque tr_ reference, never a row id.
// =============================================================================

import { customerRecordReference } from "./customerBookingReference.js";

export type AgentNotificationTopic = "bookings" | "cancellations" | "earnings" | "account" | "assignments" | "updates";

export type AgentNotificationAction = {
  topic: AgentNotificationTopic;
  /** Relative path inside the web app, or null when there is nothing to open. */
  href: string | null;
  label: string | null;
  /** The operator has to do something (sign, upload, respond, claim). */
  needsAction: boolean;
};

const CASE_KINDS_NEEDING_ACTION = new Set(["SUBMITTED", "TRAVELER_EVIDENCE_SUBMITTED", "EVIDENCE_REQUESTED", "RECOVERY_REQUIRED"]);

function tourBookingHref(id: unknown): string | null {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  try {
    return `/account/agent/tour-bookings/${customerRecordReference("tour", n)}`;
  } catch {
    return null;
  }
}

/** Accepts only a path inside this site: a relative path, or a URL on the web origin. */
function safeInternalPath(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  // Older links named a tour booking by its row id: swap in the reference.
  const legacyBooking = raw.match(/^\/account\/agent\/tour-bookings\/(\d+)$/);
  if (legacyBooking) return tourBookingHref(legacyBooking[1]);
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    const origins = [process.env.WEB_ORIGIN, process.env.APP_ORIGIN, process.env.APP_URL, "https://www.nolsaf.com", "https://nolsaf.com"]
      .filter(Boolean)
      .map((o) => new URL(String(o)).origin);
    if (origins.includes(url.origin)) return `${url.pathname}${url.search}`;
  } catch {
    /* not a URL */
  }
  return null;
}

function bookingCodeOf(meta: Record<string, any>): string {
  return typeof meta.bookingCode === "string" ? meta.bookingCode.trim().slice(0, 40) : "";
}

export function agentNotificationAction(rawMeta: unknown, type?: string | null): AgentNotificationAction {
  const meta: Record<string, any> = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? (rawMeta as Record<string, any>) : {};
  const kind = String(meta.notificationKind ?? meta.kind ?? "").trim();
  const k = kind.toLowerCase();
  const code = bookingCodeOf(meta);

  // Tour cancellation cases (tourCaseNotifications.ts). Opened by booking code.
  if (type === "cancellation" || meta.caseId != null || /^tour_case|^cancellation/.test(k)) {
    const caseHref = code
      ? `/account/agent/cancellations?view=all&booking=${encodeURIComponent(code)}`
      : "/account/agent/cancellations";
    const needs = CASE_KINDS_NEEDING_ACTION.has(kind.toUpperCase());
    return {
      topic: "cancellations",
      href: caseHref,
      label: kind.toUpperCase() === "EVIDENCE_REQUESTED" ? "Add evidence" : needs ? "Respond to the case" : "Open the case",
      needsAction: needs,
    };
  }

  switch (k) {
    case "agent_contract_ready":
      return { topic: "account", href: "/account/agent/contract", label: "Review and sign", needsAction: true };
    case "agent_contract_executed":
      return { topic: "account", href: "/account/agent/contract", label: "View agreement", needsAction: false };
    case "agent_profile_approved":
      return { topic: "account", href: "/account/agent/profile/preview", label: "See your public profile", needsAction: false };
    case "agent_profile_changes_requested":
      return { topic: "account", href: "/account/agent/profile", label: "Update your profile", needsAction: true };
    case "agent_document_approved":
      return { topic: "account", href: "/account/agent/documents", label: "View documents", needsAction: false };
    case "agent_document_rejected":
    case "account_document_request":
      return { topic: "account", href: "/account/agent/documents", label: "Upload documents", needsAction: true };
    case "agent_account_restored":
      return { topic: "account", href: "/account/agent", label: "Open your workspace", needsAction: false };
    case "agent_tour_booking_paid":
      return { topic: "bookings", href: tourBookingHref(meta.tourBookingId) ?? "/account/agent/bookings", label: "Open the booking", needsAction: false };
    case "agent_balance_claimable":
      return { topic: "earnings", href: "/account/agent/revenues?track=NEW", label: "Claim your balance", needsAction: true };
    case "agent_payout_rejected":
    case "agent_advance_rejected":
      return { topic: "earnings", href: "/account/agent/revenues?track=REJECTED", label: "See why", needsAction: false };
    case "agent_payout_verified":
      return { topic: "earnings", href: "/account/agent/revenues?track=VERIFIED", label: "Track the payout", needsAction: false };
    case "agent_payout_approved":
    case "agent_advance_approved":
      return { topic: "earnings", href: "/account/agent/revenues?track=APPROVED", label: "Track the payout", needsAction: false };
    case "agent_payout_disbursed":
      return { topic: "earnings", href: "/account/agent/revenues?track=DISBURSED", label: "View the payment", needsAction: false };
    case "admin_message":
      return { topic: "updates", href: safeInternalPath(meta.href), label: safeInternalPath(meta.href) ? "Open" : null, needsAction: false };
    default:
      break;
  }

  if (k.startsWith("agent_assignment")) {
    return { topic: "assignments", href: "/account/agent", label: "Open your workspace", needsAction: k === "agent_assignment_assigned" };
  }
  if (/^agent_(payout|advance|balance)/.test(k)) {
    return { topic: "earnings", href: "/account/agent/revenues", label: "View earnings", needsAction: false };
  }

  // Anything else that names a tour booking still opens it.
  const bookingHref = tourBookingHref(meta.tourBookingId);
  if (bookingHref) return { topic: "bookings", href: bookingHref, label: "Open the booking", needsAction: false };

  const linked = safeInternalPath(meta.href) ?? safeInternalPath(meta.actionUrl) ?? safeInternalPath(meta.link);
  return {
    topic: /^nrms_/.test(k) ? "account" : "updates",
    href: linked,
    label: linked ? "Open" : null,
    needsAction: false,
  };
}
