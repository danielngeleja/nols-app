// What each agent booking asks of the agency right now, and what changed since
// the agency last looked. Shared by the My bookings page and the portal
// navigation badge so both count exactly the same things.

export type AgentBooking = {
  id: number;
  status: string;
  property: { id: number; title: string } | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  currency: string;
  total: number;
  holdExpiresAt: string | null;
  receiptNumber: string | null;
  reservationStatus: string | null;
  amountPaid: number;
  createdAt: string;
  commercial: {
    status: string;
    settled: boolean;
    received: number;
    invoice: {
      id: number;
      number: string;
      revision?: number;
      status: string;
      quotedTotal: number;
      liveBalance?: number;
      dueAt?: string;
      payerMarkedPaidAt: string | null;
    } | null;
  };
  manifest: { status: string; incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST" | null; requiredGuests: number; guestsAdded: number; documentsUploaded: number; readyForCheckIn: boolean; reviewNote: string | null };
};

export type AgentSignal = {
  /** "action" means the agency has to do something; the others are status. */
  kind: "action" | "urgent" | "waiting" | "done" | "closed";
  title: string;
  detail: string;
  cta: "invoice" | "travellers" | "voucher" | null;
};

const fmt = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const money = (value: number) => Math.round(value).toLocaleString();

/** Whole days from today to a stored calendar date, negative when past. */
function daysUntil(value: string): number {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return 0;
  const now = new Date();
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
}

/** The one thing this booking asks of the agency, or its settled state. */
export function agentSignal(b: AgentBooking): AgentSignal {
  const invoice = b.commercial.invoice;
  if (b.status === "PENDING") {
    return { kind: "waiting", title: "Waiting for the hotel to approve", detail: b.holdExpiresAt ? `The rooms are held until ${fmt(b.holdExpiresAt)}. You will be told as soon as the hotel decides.` : "You will be told as soon as the hotel decides.", cta: null };
  }
  if (b.status === "DECLINED") return { kind: "closed", title: "The hotel declined this request", detail: "The rooms were released. Try other dates or another partner hotel.", cta: null };
  if (b.status === "EXPIRED") return { kind: "closed", title: "This request expired", detail: "The hotel did not answer in time, so the hold was released.", cta: null };
  if (b.status === "CANCELLED") return { kind: "closed", title: "This booking was cancelled", detail: "Nothing further is needed.", cta: null };

  if (!b.commercial.settled) {
    if (!invoice) return { kind: "waiting", title: "The hotel is preparing your invoice", detail: "You can pay as soon as it arrives. It will appear here.", cta: null };
    if (invoice.payerMarkedPaidAt) return { kind: "waiting", title: "The hotel is confirming your payment", detail: `You told the hotel you paid on ${fmt(invoice.payerMarkedPaidAt)}. They check their account, then release your voucher.`, cta: "invoice" };
    const due = invoice.dueAt ? daysUntil(invoice.dueAt) : null;
    const amount = `${b.currency} ${money(invoice.liveBalance ?? invoice.quotedTotal)}`;
    if (due != null && due < 0) return { kind: "urgent", title: `Invoice overdue by ${Math.abs(due)} day${Math.abs(due) === 1 ? "" : "s"}`, detail: `${amount} was due on ${fmt(invoice.dueAt!)}. Pay now to keep this booking.`, cta: "invoice" };
    return { kind: "action", title: `Pay invoice ${invoice.number}`, detail: `${amount}${invoice.dueAt ? ` due ${due === 0 ? "today" : `by ${fmt(invoice.dueAt)}`}` : ""}. Your voucher is released once the hotel receives it.`, cta: "invoice" };
  }

  const m = b.manifest;
  if (m.status === "CHANGES_REQUESTED") return { kind: "urgent", title: "The hotel asked you to correct traveller details", detail: m.reviewNote || "Open the traveller list to see what needs fixing.", cta: "travellers" };
  if (m.status === "NOT_STARTED" || m.status === "IN_PROGRESS") {
    return { kind: "action", title: "Add your travellers", detail: `${m.guestsAdded} of ${m.requiredGuests} added. The hotel needs every name and identity document before arrival.`, cta: "travellers" };
  }
  if (m.status === "SUBMITTED") return { kind: "waiting", title: "The hotel is checking your travellers", detail: `${m.guestsAdded} travellers submitted. You will be told when they are verified.`, cta: "voucher" };
  return { kind: "done", title: "All set for arrival", detail: "Paid and every traveller verified. Share the voucher with your guests.", cta: "voucher" };
}

/** True when the agency, not the hotel, has the next move. */
export function needsAgent(b: AgentBooking): boolean {
  const kind = agentSignal(b).kind;
  return kind === "action" || kind === "urgent";
}

// ── "What changed since you last looked", remembered per browser ──────────

const SEEN_KEY = "nolsaf:agent-bookings-seen";

/** The facts whose change is worth telling the agency about. */
export function bookingFingerprint(b: AgentBooking): string {
  return [b.status, b.commercial.invoice?.number ?? "-", b.commercial.settled ? "paid" : "unpaid", b.commercial.invoice?.payerMarkedPaidAt ? "declared" : "-", b.manifest.status].join("|");
}

export function readSeen(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSeen(next: Record<string, string>) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("nolsaf-agent-bookings-seen"));
  } catch { /* storage unavailable: updates simply show again next time */ }
}

/**
 * What changed on a booking since its fingerprint was last seen, in plain
 * words, or null when nothing did. A booking never seen before is recorded
 * as a baseline rather than reported, so a first visit is not a wall of "New".
 */
export function describeChange(previous: string | undefined, b: AgentBooking): string | null {
  if (!previous) return null;
  const now = bookingFingerprint(b);
  if (previous === now) return null;
  const [prevStatus, prevInvoice, prevPaid, prevDeclared, prevManifest] = previous.split("|");
  if (prevStatus !== b.status) {
    if (b.status === "CONFIRMED") return "The hotel approved your request";
    if (b.status === "DECLINED") return "The hotel declined your request";
    if (b.status === "EXPIRED") return "Your request expired";
    if (b.status === "CANCELLED") return "This booking was cancelled";
  }
  if (prevPaid !== "paid" && b.commercial.settled) return "Payment confirmed. Your voucher is ready";
  const invoice = b.commercial.invoice;
  if (invoice && prevInvoice !== invoice.number) return prevInvoice === "-" ? `The hotel sent invoice ${invoice.number}` : `The hotel sent a revised invoice, ${invoice.number}`;
  if (prevManifest !== b.manifest.status) {
    if (b.manifest.status === "CHANGES_REQUESTED") return "The hotel returned traveller details for correction";
    if (b.manifest.status === "VERIFIED") return "The hotel verified all your travellers";
  }
  if (prevDeclared === "-" && invoice?.payerMarkedPaidAt) return "Your payment declaration was sent to the hotel";
  return "This booking was updated";
}
