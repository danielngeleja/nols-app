function destination(page: string, key: string, value: unknown, view?: string) {
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  if (typeof value === "string" || typeof value === "number") params.set(key, String(value));
  const query = params.toString();
  return `/admin/long-stay/${page}${query ? `?${query}` : ""}`;
}

export function longStayAdminNotificationHref(kind: string, meta: Record<string, unknown>) {
  switch (kind) {
    case "long_stay_tenant_id_submitted":
      return destination("tenants", "id", meta.tenantProfileId);
    case "long_stay_access_requested":
      return destination("requests", "ref", meta.accessRequestRef);
    case "long_stay_inspection_needed":
    case "long_stay_inspection_report":
      return destination("inspections", "ref", meta.inspectionRef, kind.endsWith("_report") ? "review" : "todo");
    case "long_stay_enquiry":
      return destination("enquiries", "ref", meta.enquiryRef);
    case "long_stay_claim_overdue":
      return destination("tenancies", "claim", meta.claimId, "claims");
    case "long_stay_payout_ready":
      return destination("tenancies", "ref", meta.tenancyRef, "payouts");
    case "long_stay_cancelled_paid":
      return destination("tenancies", "ref", meta.tenancyRef, "refunds");
    case "long_stay_landlord_notice":
    case "long_stay_overdue_admin":
      return destination("tenancies", "ref", meta.tenancyRef, "ending");
    case "long_stay_move_in_silent":
      return destination("tenancies", "ref", meta.tenancyRef, "movein");
    case "long_stay_dispute_opened":
      return destination("tenancies", "ref", meta.tenancyRef, "disputes");
    case "long_stay_payment_review":
    case "long_stay_reservation_created":
      return destination("tenancies", "ref", meta.tenancyRef, "all");
    default:
      return undefined;
  }
}
