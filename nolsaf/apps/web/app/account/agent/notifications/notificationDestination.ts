export type AgentNotificationDestination = { href: string; label: string };

/** Return only routes that identify the intended operator record or action. */
export function agentNotificationDestination(meta: Record<string, unknown>): AgentNotificationDestination | null {
  const kind = String(meta.notificationKind ?? meta.kind ?? "").toLowerCase();

  if (/^agent_(payout|advance|balance)/.test(kind)) {
    return { href: "/account/agent/revenues", label: "View earnings" };
  }

  const id = Number(meta.tourBookingId);
  if (kind.startsWith("agent_") && Number.isSafeInteger(id) && id > 0) {
    return { href: `/account/agent/tour-bookings/${id}`, label: "View tour booking" };
  }

  const link = typeof meta.link === "string" ? meta.link.trim() : "";
  if (/^\/account\/agent\/tour-bookings\/[1-9]\d+$/.test(link)) {
    return { href: link, label: "View tour booking" };
  }
  return null;
}
