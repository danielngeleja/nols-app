// apps/api/src/lib/adminNotificationKinds.ts
//
// Every kind of alert that reaches the NoLSAF admin inbox, with how serious it
// is, what area it belongs to, and whether someone has to act on it.
//
// The admin inbox is NoLSAF's communication desk: an alert that disappears
// unhandled is a customer, owner or payment left waiting. So the rules are:
//   * nobody deletes an admin alert by hand;
//   * an alert that asks for action stays until an admin resolves it, and the
//     resolver is recorded;
//   * an information-only alert counts as resolved once someone reads it;
//   * read and resolved alerts are cleared automatically after
//     ADMIN_NOTIFICATION_RETENTION_DAYS (lib/adminNotificationRetention.ts);
//   * a kind not listed here is treated as asking for action, so a new or
//     mistyped kind can never be cleared unseen.
//
// The key is meta.notificationKind (notifyAdmins), else meta.kind (rows written
// directly), else "type:<type>".

export type AdminSeverity = "critical" | "attention" | "info";
export type AdminCategory =
  | "money" | "bookings" | "properties" | "transport" | "sales" | "security"
  | "privacy" | "support" | "people" | "system";

export type AdminKind = { severity: AdminSeverity; category: AdminCategory; requiresAction: boolean };

export const ADMIN_NOTIFICATION_RETENTION_DAYS = 7;

const act = (severity: AdminSeverity, category: AdminCategory): AdminKind => ({ severity, category, requiresAction: true });
const info = (category: AdminCategory): AdminKind => ({ severity: "info", category, requiresAction: false });

export const ADMIN_NOTIFICATION_KINDS: Record<string, AdminKind> = {
  // Money in
  payment_unmatched: act("critical", "money"),
  payment_amount_mismatch: act("critical", "money"),
  payment_stuck_unsettled: act("critical", "money"),
  payment_shortfall_absorbed: act("attention", "money"),
  coral_postback_unverified: act("critical", "money"),
  coral_postback_settlement: act("critical", "money"),
  booking_payment_case_reported: act("critical", "money"),
  invoice_paid_admin: info("money"),
  tour_booking_paid: info("money"),
  group_stay_deposit_paid: info("money"),
  nrms_payment_reconcile_needed: act("critical", "money"),

  // Money out
  payout_disbursement_failed: act("critical", "money"),
  payout_security_review: act("critical", "money"),
  payout_amount_mismatch: act("critical", "money"),
  payout_correlation_mismatch: act("critical", "money"),
  owner_payout_withdrawal_review: act("critical", "money"),
  owner_payout_claim_submitted: act("attention", "money"),
  owner_payout_recovery_overdue: act("attention", "money"),
  payout_claim_submitted: act("attention", "money"),
  transport_payout_claim_submitted: act("attention", "money"),
  group_stay_owner_payout_due: act("attention", "money"),

  // Bookings and cancellations
  booking_created: info("bookings"),
  booking_guest_code_overdue: act("critical", "bookings"),
  booking_guest_code_review: act("attention", "bookings"),
  cancellation_submitted: act("attention", "bookings"),
  cancellation_message: act("attention", "bookings"),
  tour_cancellation_submitted: act("attention", "bookings"),
  tour_cancellation_evidence_submitted: act("attention", "bookings"),
  tour_cancellation_auto_cancelled_unpaid: info("bookings"),
  group_stay_request_created: act("attention", "bookings"),
  group_stay_message: act("attention", "bookings"),

  // Properties and NRMS
  property_submitted: act("attention", "properties"),
  property_approved: info("properties"),
  property_rejected: info("properties"),
  nrms_channel_health_alert: act("attention", "properties"),
  nrms_stop_sell_approval_requested: act("critical", "properties"),

  // Transport
  transport_auto_dispatch_no_drivers_2m: info("transport"),
  // Time-critical: a traveller is waiting for a driver.
  transport_auto_dispatch_warning: act("critical", "transport"),
  transport_auto_dispatch_takeover: act("critical", "transport"),
  driver_account_deleted: act("attention", "transport"),

  // Sales partners
  sales_partner_contract_signed: act("attention", "sales"),
  sales_partner_conversion_requested: act("attention", "sales"),
  sales_partner_payout_requested: act("attention", "sales"),
  sales_partner_payout_review: act("attention", "sales"),
  sales_partner_payout_hold: act("critical", "sales"),
  sales_team_at_risk: act("attention", "sales"),
  sales_partner_card_photo_review: act("attention", "sales"),
  sales_team_invite_review: act("attention", "sales"),
  sales_partner_owner_disputed: act("attention", "sales"),
  sales_partner_nrms_claim_lapsed: info("sales"),
  sales_agency_shortlist_review: act("attention", "sales"),
  sales_agency_group_lead_fast_track: act("attention", "sales"),

  // People
  partner_account_registered: act("attention", "people"),
  careers_application_submitted: act("attention", "people"),

  // Security and privacy
  security_account_locked: act("critical", "security"),
  security_ip_burst: act("critical", "security"),
  security_admin_mfa_locked: act("critical", "security"),
  security_admin_ip_blocked: act("attention", "security"),
  security_data_export_locked: act("critical", "privacy"),
  data_export_legal: act("attention", "privacy"),
  data_export_dispute: act("attention", "privacy"),

  // Support and system
  "type:chatbot": act("attention", "support"),
  "type:agent": act("attention", "support"),
  observability_repeated_5xx: act("critical", "system"),
};

/** Never clear what we do not recognise: unknown kinds must be resolved. */
const UNKNOWN: AdminKind = act("attention", "system");

export function adminKindKey(row: { type?: string | null; meta?: unknown }): string {
  const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? (row.meta as Record<string, unknown>) : {};
  const kind = meta.notificationKind ?? meta.kind;
  if (typeof kind === "string" && kind) return kind;
  return `type:${row.type ?? "unknown"}`;
}

export function adminKindOf(row: { type?: string | null; meta?: unknown }): AdminKind & { key: string } {
  const key = adminKindKey(row);
  return { key, ...(ADMIN_NOTIFICATION_KINDS[key] ?? UNKNOWN) };
}

/** A stored row asks for action if its column says so or its kind does (rows from before the column). */
export function rowRequiresAction(row: { type?: string | null; meta?: unknown; requiresAction?: boolean | null }): boolean {
  return Boolean(row.requiresAction) || adminKindOf(row).requiresAction;
}

/**
 * Whether the 7-day clean-up may remove this row now. Unread rows, and rows
 * that ask for action and are not resolved, are never removed.
 */
export function adminNotificationExpired(
  row: { unread: boolean; readAt: Date | null; resolvedAt: Date | null; type?: string | null; meta?: unknown; requiresAction?: boolean | null },
  now: Date,
): boolean {
  if (row.unread) return false;
  const cutoff = now.getTime() - ADMIN_NOTIFICATION_RETENTION_DAYS * 86_400_000;
  const settledAt = rowRequiresAction(row) ? row.resolvedAt : row.resolvedAt ?? row.readAt;
  return Boolean(settledAt) && settledAt!.getTime() <= cutoff;
}
