type Destination = { href: string; label: string };

export function notificationDestination(meta: Record<string, unknown>): Destination | null {
  const kind = String(meta.notificationKind || meta.kind || "").toLowerCase();
  const id = (value: unknown) => {
    const number = typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)) ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  };
  const applicationId = id(meta.applicationId);
  const relatedPropertyId = id(meta.relatedPropertyId);
  if (/^merchant_application_(return|reject|approve)$/.test(kind) && applicationId && relatedPropertyId) {
    return { href: `/owner/nrms/payments?property=${relatedPropertyId}&application=${applicationId}#application-status`, label: "View payment application" };
  }
  const bookingReference = typeof meta.bookingReference === "string" ? meta.bookingReference : "";
  if (/^bk_[A-Za-z0-9_-]{22}$/.test(bookingReference) && ["booking_created", "invoice_paid", "cancellation_reviewing", "cancellation_processing", "cancellation_refunded", "cancellation_rejected", "booking_cancelled_by_guest"].includes(kind)) {
    return { href: `/owner/bookings/checked-in/${bookingReference}`, label: "View booking" };
  }
  const propertyId = id(meta.propertyId);
  if (propertyId && ["property_submitted", "property_approved", "property_rejected", "property_suspended", "property_unsuspended"].includes(kind)) {
    return { href: `/owner/properties/${propertyId}`, label: "View property" };
  }
  // Only known, record-specific URLs are accepted from notification metadata.
  // A section landing page is not a reliable destination for an individual update.
  const actionUrl = typeof meta.actionUrl === "string" ? meta.actionUrl.trim() : "";
  if (/^\/owner\/revenue\/receipts\/[1-9]\d*$/.test(actionUrl)) return { href: actionUrl, label: "View receipt" };
  return null;
}
