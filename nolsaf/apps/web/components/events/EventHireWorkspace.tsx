"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Clock3, FileText, LayoutDashboard, ListChecks, Loader2, LockKeyhole, PartyPopper, RefreshCw, ShieldCheck, Upload, Wallet, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { resolveOwnerPropertyRef } from "@/lib/ownerPropertyRefs";
import ApprovedEventVenues from "./ApprovedEventVenues";
import EventRequestDesk from "./EventRequestDesk";
import EventRefundAccount from "./EventRefundAccount";
import DateTimeField from "@/components/ui/DateTimeField";

// Matches the workspace's .field inputs (37px, #ccddcf border, 12px text).
const WORKSPACE_DATE_BOX = "min-h-[37px] rounded-[7px] border border-solid border-[#ccddcf] bg-white text-xs text-[#304e37] hover:border-[#538d69] focus:border-[#538d69] focus:ring-2 focus:ring-[#649a77]/10";
import { tsh } from "./eventHireTypes";
import s from "./event-workspace.module.css";
type Audience = "owner" | "customer" | "admin" | "sales";
type Tab = "overview" | "requests" | "bookings" | "calendar" | "payments" | "venues";
type Evidence = {
  reference: string;
  kind: string;
  createdAt: string;
  own: boolean;
};
type Transfer = {
  reference: string;
  kind: string;
  amount: number;
  status: string;
  paidAt?: string;
  sourceId?: number;
  payeeUserId?: number;
};
type Claim = {
  reference: string;
  version: number;
  status: string;
  description: string;
  requestedAmount: number;
  award?: number;
  decisionReason?: string;
  clientResponse?: string;
  responseDueAt: string;
  evidence: {
    reference: string;
    kind: string;
  }[];
  items: {
    description: string;
    cost: number;
    depreciationPercent: number;
  }[];
};
export type Booking = {
  reference: string;
  version: number;
  status: string;
  propertyTitle: string;
  organizer:string;
  ownerContact?:{name?:string;fullName?:string;phone?:string;email?:string};
  clientContact?:{name?:string;fullName?:string;phone?:string;email?:string};
  paymentReference?:string;
  providerTransactionId?:string;
  startsAt: string;
  endsAt: string;
  people: number;
  eventType: string;
  total: number;
  ownerDue?: number;
  deposit: number;
  fee?: number;
  paidAt?: string;
  checkoutStatus: string;
  checkoutExpiresAt: string;
  ownerCompletedAt?: string;
  clientCompletedAt?: string;
  completedAt?: string;
  cancellationRequestedAt?: string;
  cancellationReason?: string;
  claimDeadline: string;
  depositStatus: string;
  payoutStatus: string;
  claims: Claim[];
  evidence: Evidence[];
  transfers: Transfer[];
  venueRef?: string;
  entries?: {
    kind: string;
    amount: number;
    createdAt: string;
  }[];
  history?: {
    action: string;
    createdAt: string;
    details?: {
      note?: string;
    };
  }[];
};
type Summary = {
  enabled: boolean;
  paymentsEnabled: boolean;
  statuses: Record<string, number>;
  pendingRequests: number;
  collected: number;
  ownerEarnings?: number;
  depositHeld: number;
  settlementPending: number;
  settled: number;
};
type Venue = {
  ref: string;
  title: string;
  propertyId?: number;
};
type CalendarEntry = {
  reference: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  kind: "BOOKING" | "BLOCK" | "HOLD";
  expiresAt?: string;
};
const names: Record<string, string> = {
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  PAYMENT_PENDING: "Payment pending",
  PAYMENT_REVIEW: "Payment review",
  EXPIRED: "Expired",
  HELD: "Held by NoLSAF",
  UNPAID: "Not collected",
  REVIEW: "Awaiting review",
  APPROVED: "Approved for release",
  PAID: "Paid",
  DISPUTED: "Disputed",
  SETTLED: "Settled",
  REFUND_REVIEW: "Refund review",
  ON_HOLD: "On hold",
  NONE: "No deposit",
  OWNER_PAYOUT: "Venue earnings",
  DAMAGE_AWARD: "Damage award",
  DEPOSIT_REFUND: "Deposit refund",
  CANCELLATION_REFUND: "Cancellation refund",
  STATUS_UNKNOWN: "Provider status under review",
  PROCESSING: "Provider processing",
  SUCCEEDED: "Payment verified",
  FAILED: "Payment declined",
  INITIATING: "Starting checkout",
  CREATED: "Awaiting checkout",
  AWAITING_CLIENT: "Awaiting client response",
  RESOLVED: "Resolved"
};
const text = (v: string) => v.startsWith("EXTRA_REFUND_") ? "Additional payment refund" : names[v] || v.toLowerCase().replace(/_/g, " ");
const when = (v: string) => new Date(v).toLocaleString("en-GB", {
  timeZone: "Africa/Dar_es_Salaam",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});
const message = (error: any) => error?.response?.data?.error || "Could not complete this action. Please refresh and try again.";
const tabs: {
  key: Tab;
  label: string;
  Icon: typeof Wallet;
}[] = [{
  key: "overview",
  label: "Overview",
  Icon: LayoutDashboard
}, {
  key: "requests",
  label: "Requests",
  Icon: ListChecks
}, {
  key: "bookings",
  label: "Bookings",
  Icon: FileText
}, {
  key: "calendar",
  label: "Calendar",
  Icon: CalendarDays
}, {
  key: "payments",
  label: "Payments & deposits",
  Icon: Wallet
}, {
  key: "venues",
  label: "Venues",
  Icon: Building2
}];
export default function EventHireWorkspace({
  audience = "owner", section
}: {
  audience?: Audience;
  section?: Tab;
}) {
  return <Suspense fallback={<p role="status">Opening event hire…</p>}><Workspace audience={audience} section={section} /></Suspense>;
}
function Workspace({
  audience, section
}: {
  audience: Audience;
  section?: Tab;
}) {
  const params = useSearchParams(),
    router = useRouter();
  const tab = section ?? (tabs.some(t => t.key === params.get("tab")) ? params.get("tab") : "overview") as Tab;
  const venue = audience === "owner" ? params.get("venue") || "" : "";
  const base = audience === "admin" ? "/api/admin/event-hire/operations" : `/api/${audience}/event-hire`;
  const [summary, setSummary] = useState<Summary | null>(null),
    [bookings, setBookings] = useState<Booking[]>([]),
    [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]),
    [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [hasMore, setHasMore] = useState(false),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Booking | null>(null),
    [busy, setBusy] = useState(false);
  const [requestPropertyId, setRequestPropertyId] = useState<number>();
  const detailRef = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [a, b, c] = await Promise.all([apiClient.get(`${base}/workspace`, {
        params: venue ? {
          venue
        } : undefined
      }), apiClient.get(`${base}/bookings`, {
        params: {
          page: 1,
          ...(venue ? {
            venue
          } : {})
        }
      }), tab === "overview" ? apiClient.get(`${base}/bookings`, { params: { upcoming: "true", ...(venue ? { venue } : {}) } }) : Promise.resolve(null)]);
      setSummary(a.data);
      setBookings(b.data.bookings);
      setUpcomingBookings(c?.data.bookings ?? []);
      setHasMore(b.data.hasMore);
      setPage(1);
    } catch (e) {
      setError(message(e));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [base, venue, tab]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("event-hire-refresh", refresh);
    return () => window.removeEventListener("event-hire-refresh", refresh);
  }, [load]);
  useEffect(() => {
    if (audience !== "owner") return;
    void apiClient.get("/api/owner/event-hire/approved").then(r => setVenues(r.data.items)).catch(() => setVenues([]));
  }, [audience]);
  useEffect(() => {
    let active = true;
    setRequestPropertyId(undefined);
    if (venue) void resolveOwnerPropertyRef(venue).then(id => {
      if (active && id) setRequestPropertyId(id);
    });
    return () => {
      active = false;
    };
  }, [venue]);
  const open = useCallback(async (ref: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await apiClient.get(`${base}/bookings/${encodeURIComponent(ref)}`);
      setSelected(r.data);
      setTimeout(() => detailRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      }), 0);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [base]);
  useEffect(() => {
    const ref = params.get("eventBooking");
    if (ref && /^ebk_[A-Za-z0-9_-]{32}$/.test(ref)) void open(ref);
  }, [params, open]);
  const navigate = (next: Tab, nextVenue = venue) => {
    if (audience === "admin" && section) {
      const route = next === "overview" ? "" : `/${next === "calendar" ? "availability" : next}`;
      router.push(`/admin/event-hire${route}`);
      return;
    }
    const p = new URLSearchParams();
    p.set("tab", next);
    if (nextVenue) p.set("venue", nextVenue);
    router.push(`?${p}`, {
      scroll: false
    });
  };
  const action = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`${base}/bookings/${selected.reference}/act`, {
        version: selected.version,
        action,
        ...payload
      });
      setNotice("Booking updated. Financial releases remain subject to verification.");
      await open(selected.reference);
      await load();
    } catch (e: any) {
      setError(message(e));
      if (e?.response?.data?.require2fa) window.dispatchEvent(new CustomEvent("finance-grant-required"));
    } finally {
      setBusy(false);
    }
  };
  const loadMore = async () => {
    setBusy(true);
    try {
      const r = await apiClient.get(`${base}/bookings`, {
        params: {
          page: page + 1,
          ...(venue ? {
            venue
          } : {})
        }
      });
      setBookings(previous => [...previous, ...r.data.bookings]);
      setPage(page + 1);
      setHasMore(r.data.hasMore);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const upcoming = upcomingBookings;
  return <div className={s.workspace} data-event-audience={audience}>
    {audience !== "admin" && <>
    <header className={s.header}><div className={s.identity}><span className={s.icon}><PartyPopper size={22} aria-hidden /></span><div><p className={s.kicker}>{audience === "owner" ? "Owner workspace" : audience === "customer" ? "My event bookings" : "Agency Desk"}</p><h1>Hired events</h1><p className={s.subtitle}>Requests, bookings, availability and money, together.</p></div></div><div className={s.headerActions}>{audience === "owner" && <Link href="/owner/properties/approved" className={s.secondary}>My properties</Link>}<button className={s.secondary} onClick={() => void load()} disabled={loading || busy} aria-label="Refresh event workspace"><RefreshCw size={15} className={loading ? s.spin : undefined} aria-hidden />Refresh</button></div></header>
    </>}
    {!section && <nav className={s.tabs} aria-label="Event hire sections">{tabs.filter(t => t.key !== "venues" || audience === "owner").map(({
        key,
        label,
        Icon
      }) => <button key={key} type="button" className={tab === key ? s.activeTab : undefined} aria-current={tab === key ? "page" : undefined} onClick={() => navigate(key)}><Icon size={16} aria-hidden />{label}{key === "requests" && Boolean(summary?.pendingRequests) && <span>{summary?.pendingRequests}</span>}</button>)}</nav>}
    {audience === "owner" && venues.length > 0 && tab !== "venues" && <div className={s.scope}><span><Building2 size={14} aria-hidden />Showing</span><label><span className={s.srOnly}>Filter event venue</span><select value={venue} onChange={e => navigate(tab, e.target.value)}><option value="">All event venues</option>{venues.map(v => <option key={v.ref} value={v.ref}>{v.title}</option>)}</select></label>{venue && <Link href={`/owner/properties/${encodeURIComponent(venue)}/events`} className={s.textLink}><LockKeyhole size={13} aria-hidden />Approved venue details<ArrowRight size={13} aria-hidden /></Link>}</div>}
    {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.notice} role="status">{notice}</p>}
    {audience !== "admin" && summary && !summary.enabled && <p className={s.notice}><ShieldCheck size={16} aria-hidden />Event operations are awaiting activation. Existing records remain available for review.</p>}
    {tab === "payments" && audience === "customer" && <EventRefundAccount />}
    {tab === "payments" && audience === "owner" && <p className={s.notice}><ShieldCheck size={16} /><span>Event earnings use your verified payout destination. <Link href="/owner/payouts/account" className={s.textLink}>Manage payout account</Link></span></p>}
    {selected && <section ref={detailRef} className={s.detail} aria-label="Event booking details"><div className={s.panelHeading}><div><span className={s.kicker}>Booking details</span><h2>{selected.propertyTitle}</h2></div><button className={s.iconButton} onClick={() => setSelected(null)} aria-label="Close booking details"><X size={18} /></button></div><BookingDetails key={selected.reference} booking={selected} audience={audience} base={base} busy={busy} onAction={action} onReload={() => open(selected.reference)} /></section>}
    {tab === "venues" && audience === "owner" ? <ApprovedEventVenues embedded /> : tab === "requests" ? <EventRequestDesk audience={audience} propertyId={requestPropertyId} embedded paymentsEnabled={Boolean(summary?.paymentsEnabled)} /> : tab === "calendar" ? <EventCalendar base={base} audience={audience} venues={venues} venueFilter={venue} onOpen={open} /> : <>
      {tab === "overview" && <>{audience !== "admin" && <div className={s.metrics}>{[{
            label: "Confirmed events",
            value: summary ? String(summary.statuses.CONFIRMED || 0) : "—",
            Icon: CircleCheck
          }, {
            label: "Requests waiting",
            value: summary ? String(summary.pendingRequests) : "—",
            Icon: Clock3
          }, {
            label: "Deposits held",
            value: summary ? tsh(summary.depositHeld) : "—",
            Icon: ShieldCheck
          }, {
            label: "Settlement pending",
            value: summary ? tsh(summary.settlementPending) : "—",
            Icon: Wallet
          }].map(m => <div key={m.label} className={s.metric}><span><m.Icon size={15} aria-hidden />{m.label}</span><strong>{m.value}</strong></div>)}</div>}<div className={s.overviewGrid}><section className={s.panel}><div className={s.panelHeading}><div><h2>Upcoming events</h2><p>Confirmed bookings, ordered by event date.</p></div><button className={s.textLink} onClick={() => navigate("bookings")}>All bookings<ArrowRight size={14} /></button></div><BookingList bookings={upcoming.slice(0, 5)} loading={loading} onOpen={open} empty="No confirmed upcoming events." /></section><section className={s.panel}><div className={s.panelHeading}><h2>Next actions</h2></div><div className={s.actionsList}><button onClick={() => audience === "admin" ? router.push("/admin/event-hire/venues") : navigate("requests")}><ListChecks size={18} /><span><strong>{audience === "admin" ? "Review venue approvals" : "Review venue requests"}</strong><small>{audience === "admin" ? "Check owner consent, capacity and venue rules." : "Confirm the exact event time before payment."}</small></span><ArrowRight size={15} /></button><button onClick={() => navigate(audience === "admin" ? "requests" : "calendar")}><CalendarDays size={18} /><span><strong>{audience === "admin" ? "Coordinate pending requests" : "Keep event availability accurate"}</strong><small>{audience === "admin" ? "Review owner confirmations and partner assignments." : "Block external bookings and closures."}</small></span><ArrowRight size={15} /></button><button onClick={() => audience === "admin" ? router.push("/admin/event-hire/settlements") : navigate("payments")}><ShieldCheck size={18} /><span><strong>{audience === "admin" ? "Review refunds and owner payouts" : "Track deposits and settlement"}</strong><small>Review evidence and release decisions.</small></span><ArrowRight size={15} /></button></div></section></div></>}
      {tab === "bookings" && <section className={s.panel}><div className={s.panelHeading}><div><h2>Event bookings</h2><p>Payment progress, confirmed events and completed bookings.</p></div></div><BookingList bookings={bookings} loading={loading} onOpen={open} empty="No event bookings yet. Approved requests become bookings through checkout." />{hasMore && <button className={s.secondary} disabled={busy} onClick={() => void loadMore()}>Load more bookings</button>}</section>}
      {tab === "payments" && <><div className={s.metrics}>{[{
            label: "Client payments collected",
            value: summary?.collected
          }, {
            label: "Refundable deposits held",
            value: summary?.depositHeld
          }, {
            label: "Settlement awaiting release",
            value: summary?.settlementPending
          }, {
            label: "Verified transfers paid",
            value: summary?.settled
          }].map(m => <div className={s.metric} key={m.label}><span>{m.label}</span><strong>{m.value === undefined ? "—" : tsh(m.value)}</strong></div>)}</div><p className={s.notice}><ShieldCheck size={16} />Deposits are held separately from venue earnings. An approved transfer is paid only after the payout provider confirms it.</p><section className={s.panel}><div className={s.panelHeading}><div><h2>Payments & security deposits</h2><p>Open a booking to see its receipt, claim evidence, refund and payout progress.</p></div></div><div className={s.tableScroll}><table className={s.table}><thead><tr><th>Event venue</th><th>Payment</th><th>Security deposit</th><th>Settlement</th><th><span className={s.srOnly}>Details</span></th></tr></thead><tbody>{bookings.map(b => <tr key={b.reference}><td><strong>{b.propertyTitle}</strong><small>{when(b.startsAt)}</small></td><td><strong>{tsh(b.total)}</strong><small>{b.paidAt ? `Verified ${when(b.paidAt)}` : text(b.checkoutStatus)}</small></td><td><strong>{tsh(b.deposit)}</strong><small>{text(b.depositStatus)}</small></td><td><span className={s.badge}>{text(b.payoutStatus)}</span>{b.transfers.map(t => <small key={t.reference}>{text(t.kind)} · {text(t.status)}</small>)}</td><td><button className={s.textLink} onClick={() => void open(b.reference)}>Details<ArrowRight size={13} /></button></td></tr>)}</tbody></table></div>{!bookings.length && !loading && <p className={s.empty}>No event payment records yet.</p>}{hasMore && <button className={s.secondary} disabled={busy} onClick={() => void loadMore()}>Load more records</button>}</section></>}
    </>}
    <p className={s.footnote}>Times are shown in East Africa Time. Event hire is managed separately from accommodation approval.</p>
  </div>;
}
function BookingList({
  bookings,
  loading,
  onOpen,
  empty
}: {
  bookings: Booking[];
  loading: boolean;
  onOpen: (r: string) => Promise<void>;
  empty: string;
}) {
  if (loading && !bookings.length) return <p className={s.empty} role="status"><Loader2 className={s.spin} size={17} />Loading event bookings…</p>;
  if (!bookings.length) return <p className={s.empty}>{empty}</p>;
  return <ul className={s.bookingList}>{bookings.map(b => <li key={b.reference}><div className={s.dateTile}><strong>{new Date(b.startsAt).toLocaleDateString("en-GB", {
            day: "2-digit",
            timeZone: "Africa/Dar_es_Salaam"
          })}</strong><span>{new Date(b.startsAt).toLocaleDateString("en-GB", {
            month: "short",
            timeZone: "Africa/Dar_es_Salaam"
          })}</span></div><div className={s.bookingIdentity}><strong>{b.propertyTitle}</strong><span>{when(b.startsAt)} · {b.people} guests</span></div><span className={s.badge}>{text(b.status)}</span><button className={s.textLink} onClick={() => void onOpen(b.reference)}>Open<ArrowRight size={14} /></button></li>)}</ul>;
}
export function BookingDetails({
  booking: b,
  audience,
  base,
  busy,
  onAction,
  onReload
}: {
  booking: Booking;
  audience: Audience;
  base: string;
  busy: boolean;
  onAction: (a: string, p?: Record<string, unknown>) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [review,setReview]=useState({version:b.version,attested:false,clientNotified:false}),
    [award, setAward] = useState(0),
    [error, setError] = useState("");
  const attested=review.version===b.version&&review.attested;
  const clientNotified=review.version===b.version&&review.clientNotified;
  const changeReview=(patch:{attested?:boolean;clientNotified?:boolean})=>setReview(previous=>({...((previous.version===b.version)?previous:{version:b.version,attested:false,clientNotified:false}),...patch}));
  const setAttested=(value:boolean)=>changeReview({attested:value});
  const setClientNotified=(value:boolean)=>changeReview({clientNotified:value});
  const ended = new Date(b.endsAt) <= new Date(),
    active = ["CONFIRMED", "COMPLETED"].includes(b.status),
    claim = b.claims[0];
  const doAction = (action: string, p: Record<string, unknown> = {}) => onAction(action, {
    ...(note.trim() ? {
      note: note.trim()
    } : {}),
    ...(audience === "admin" ? {
      attested
    } : {}),
    ...p
  });
  return <div className={s.detailBody}>
    <div className={s.bookingFacts}><span className={s.badge}>{text(b.status)}</span><span>{when(b.startsAt)} to {when(b.endsAt)}</span><span>{b.people} guests</span><span>{b.organizer}</span></div>
    {b.paidAt&&audience!=="sales"&&<Link className={s.textLink} href={`${audience==="owner"?"/owner/properties/events":audience==="admin"?"/admin/event-hire":"/account/event-requests"}/payments/${encodeURIComponent(b.reference)}`} target="_blank" rel="noopener noreferrer"><FileText size={14}/>Print payment confirmation<ArrowRight size={13}/></Link>}
    {audience==="admin"&&b.paymentReference&&<p className={s.help}>Provider payment reference: {b.paymentReference}{b.providerTransactionId?` · Transaction: ${b.providerTransactionId}`:" · No verified collection yet"}</p>}
    {audience==="admin"&&(b.ownerContact||b.clientContact)&&<div className={s.moneyBreakdown}>{[{label:"Owner contact",person:b.ownerContact},{label:"Client contact",person:b.clientContact}].map(({label,person})=><div key={label}><span>{label}</span><strong>{person?.fullName||person?.name||"NoLSAF account"}</strong><small>{person?.phone||person?.email||"No verified contact available"}</small></div>)}</div>}
    <div className={s.moneyBreakdown}><div><span>Client total</span><strong>{tsh(b.total)}</strong><small>{b.paidAt ? `Payment verified ${when(b.paidAt)}` : text(b.checkoutStatus)}</small></div><div><span>Refundable security deposit</span><strong>{tsh(b.deposit)}</strong><small>{text(b.depositStatus)}</small></div>{b.ownerDue !== undefined && <div><span>Venue earnings after fees</span><strong>{tsh(b.ownerDue)}</strong><small>{text(b.payoutStatus)}</small></div>}</div>
    <p className={s.help}>Condition claims can be submitted within 48 hours after the event ends, by {when(b.claimDeadline)}. A disputed deposit stays on hold for independent review.</p>
    {b.cancellationRequestedAt && <p className={s.warning}>Cancellation or service review requested: {b.cancellationReason}. Settlement is on hold.</p>}
    {b.venueRef && audience === "owner" && <Link className={s.textLink} href={`/owner/properties/${encodeURIComponent(b.venueRef)}/events`}><LockKeyhole size={13} />Approved venue details</Link>}
    {audience !== "sales" && active && <div className={s.bookingActions}>{ended && <button className={s.primary} disabled={busy || (audience === "owner" ? Boolean(b.ownerCompletedAt) : audience === "customer" ? Boolean(b.clientCompletedAt) : !attested || note.trim().length < 12)} onClick={() => void doAction("COMPLETE")}>{audience === "admin" ? "Confirm completion review" : "Confirm event completed"}</button>}</div>}
    {audience !== "sales" && <label className={s.field}><span>{audience === "admin" ? "Review notes" : "Cancellation or service concern"}</span><textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder={audience === "admin" ? "Record the evidence checked and reasons for this decision." : "Describe why this event needs NoLSAF's review."} /></label>}
    {audience === "admin" && <label className={s.checkbox}><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} />I independently reviewed the booking and supporting evidence.</label>}
    {active && ["owner", "customer"].includes(audience) && !b.transfers.some(t => !t.kind.startsWith("EXTRA_REFUND_")) && <button className={s.secondary} disabled={busy || note.trim().length < 12 || Boolean(b.cancellationRequestedAt)} onClick={() => void doAction("REQUEST_CANCEL")}>Request cancellation / service review</button>}
    {audience === "admin" && b.paidAt && <div className={s.bookingActions}><button className={s.danger} disabled={busy || !attested || note.trim().length < 12 || b.transfers.some(t => t.kind !== "CANCELLATION_REFUND" && !t.kind.startsWith("EXTRA_REFUND_"))} onClick={() => void doAction("CANCEL_AND_REFUND")}>Cancel and prepare full refund</button>{b.cancellationRequestedAt && !b.status.includes("CANCELLED") && <button className={s.secondary} disabled={busy || !attested || note.trim().length < 12} onClick={() => void doAction("KEEP_BOOKING")}>Close cancellation review; keep booking</button>}</div>}
    <section className={s.subsection}><h3>Condition evidence</h3><p className={s.help}>Before photos must be recorded before the event starts. Evidence is private to this booking's parties and NoLSAF reviewers.</p><div className={s.evidenceList}>{b.evidence.map(e => <a key={e.reference} href={`${base}/bookings/${b.reference}/evidence/${e.reference}`} target="_blank" rel="noopener noreferrer"><FileText size={16} /><span>{text(e.kind)} photo<small>{when(e.createdAt)}{e.own ? " · uploaded by you" : ""}</small></span><ArrowRight size={13} /></a>)}</div>
      {["owner", "customer"].includes(audience) && active && !b.transfers.some(t => !t.kind.startsWith("EXTRA_REFUND_")) && <EvidenceUpload booking={b} base={base} onReload={onReload} />}
    </section>
    {claim && <section className={s.subsection}><div className={s.panelHeading}><h3>Damage claim</h3><span className={s.badge}>{text(claim.status)}</span></div><p>{claim.description}</p><ul className={s.claimItems}>{claim.items.map((item, i) => <li key={i}><span>{item.description}<small>{item.depreciationPercent}% depreciation</small></span><strong>{tsh(item.cost)}</strong></li>)}</ul><p className={s.help}>Requested deduction: {tsh(claim.requestedAmount)}. Client response due {when(claim.responseDueAt)}.</p>{claim.clientResponse && <blockquote className={s.response}>{claim.clientResponse}</blockquote>}{claim.status === "RESOLVED" && <p className={s.notice}>Awarded deduction: {tsh(claim.award || 0)}. {claim.decisionReason}</p>}
      {audience === "customer" && claim.status !== "RESOLVED" && <ClaimResponse booking={b} base={base} onReload={onReload} />}
      {audience==="admin"&&claim.status!=="RESOLVED"&&!claim.clientResponse&&<label className={s.checkbox}><input type="checkbox" checked={clientNotified} onChange={e=>setClientNotified(e.target.checked)}/>I verified that the client received notice and had the full response window.</label>}
      {audience === "admin" && claim.status !== "RESOLVED" && <div className={s.reviewAward}><label className={s.field}><span>Evidence-based award (TSh)</span><input type="number" min={0} max={Math.min(b.deposit, claim.requestedAmount)} value={award} onChange={e => setAward(Number(e.target.value))} /></label><button className={s.primary} disabled={busy || !attested || note.trim().length < 12||(!claim.clientResponse&&!clientNotified)} onClick={() => void doAction("RESOLVE_CLAIM", {
      ...(clientNotified?{clientNotified:true}:{}),
          award,
          claimVersion: claim.version
        })}>Resolve deposit claim</button></div>}
    </section>}
    {audience === "owner" && ended && active && !claim && new Date() < new Date(b.claimDeadline) && b.deposit > 0 && <DamageClaimForm booking={b} base={base} onReload={onReload} />}
    <section className={s.subsection}><h3>Refunds & payouts</h3>{!b.transfers.some(t => !t.kind.startsWith("EXTRA_REFUND_")) ? <p className={s.help}>Settlement is prepared after completion and the claim window, once any dispute or cancellation review is resolved.</p> : <div className={s.transferList}>{b.transfers.map(t => <div key={t.reference}><span><strong>{text(t.kind)}</strong><small>{text(t.status)}{t.paidAt ? ` · ${when(t.paidAt)}` : ""}</small></span><strong>{tsh(t.amount)}</strong>{audience === "admin" && t.status === "REVIEW" && <button className={s.secondary} disabled={busy || !attested || note.trim().length < 12} onClick={() => void doAction("APPROVE_TRANSFER", {
            transferRef: t.reference
          })}>Approve entitlement</button>}{audience === "admin" && t.status === "APPROVED" && <Link href={`/admin/disbursements?sourceType=EVENT_HIRE&sourceId=${t.sourceId}`} className={s.textLink}>Release through finance<ArrowRight size={13} /></Link>}</div>)}</div>}</section>
    {b.entries && <details className={s.history}><summary>Financial journal & activity</summary><ul>{b.entries.map((e, i) => <li key={i}><span>{text(e.kind)} · {when(e.createdAt)}</span><strong>{tsh(e.amount)}</strong></li>)}</ul><ol>{b.history?.map((h, i) => <li key={i}>{text(h.action)} · {when(h.createdAt)}{h.details?.note ? ` · ${h.details.note}` : ""}</li>)}</ol></details>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <button className={s.textLink} disabled={busy} onClick={() => {
      setError("");
      void onReload().catch(e => setError(message(e)));
    }}><RefreshCw size={13} />Refresh booking</button>
  </div>;
}
function EvidenceUpload({
  booking: b,
  base,
  onReload
}: {
  booking: Booking;
  base: string;
  onReload: () => Promise<void>;
}) {
  const [kind, setKind] = useState(new Date() < new Date(b.startsAt) ? "BEFORE" : new Date() >= new Date(b.endsAt) ? "AFTER" : "OTHER"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return <div className={s.upload}><label><span className={s.srOnly}>Evidence category</span><select value={kind} onChange={e => setKind(e.target.value)}><option value="BEFORE">Before the event</option><option value="AFTER">After the event</option><option value="RECEIPT">Repair receipt / quotation</option><option value="OTHER">Supporting evidence</option></select></label><label className={s.secondary}><Upload size={14} />{busy ? "Uploading privately…" : "Upload condition photo"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className={s.srOnly} onChange={async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setError("");
        try {
          const body = new FormData();
          body.append("kind", kind);
          body.append("file", file);
          await apiClient.post(`${base}/bookings/${b.reference}/evidence`, body);
          await onReload();
        } catch (cause) {
          setError(message(cause));
        } finally {
          setBusy(false);
          e.target.value = "";
        }
      }} /></label>{error && <p className={s.error} role="alert">{error}</p>}</div>;
}
function DamageClaimForm({
  booking: b,
  base,
  onReload
}: {
  booking: Booking;
  base: string;
  onReload: () => Promise<void>;
}) {
  const [description, setDescription] = useState(""),
    [items, setItems] = useState([{
      description: "",
      cost: 0,
      depreciationPercent: 0
    }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const evidence = b.evidence.filter(e => e.own);
  return <details className={s.claimForm}><summary>Report damage against the security deposit</summary><form onSubmit={async e => {
      e.preventDefault();
      setBusy(true);
      setError("");
      try {
        await apiClient.post(`${base}/bookings/${b.reference}/claim`, {
          version: b.version,
          description,
          items,
          evidence: evidence.map(x => ({
            reference: x.reference,
            kind: x.kind
          }))
        });
        await onReload();
      } catch (cause) {
        setError(message(cause));
      } finally {
        setBusy(false);
      }
    }}><p className={s.help}>Normal wear is excluded. Provide dated before/after evidence and actual repair or replacement cost. Depreciation reduces the claim for an older item. No deduction is automatic.</p><label className={s.field}><span>What happened?</span><textarea minLength={30} maxLength={2000} required value={description} onChange={e => setDescription(e.target.value)} /></label>{items.map((item, i) => <div className={s.claimRow} key={i}><label className={s.field}><span>Damaged item</span><input required minLength={5} maxLength={200} value={item.description} onChange={e => setItems(old => old.map((x, n) => n === i ? {
            ...x,
            description: e.target.value
          } : x))} /></label><label className={s.field}><span>Repair / replacement (TSh)</span><input required type="number" min={1} max={500000000} value={item.cost || ""} onChange={e => setItems(old => old.map((x, n) => n === i ? {
            ...x,
            cost: Number(e.target.value)
          } : x))} /></label><label className={s.field}><span>Depreciation (%)</span><input required type="number" min={0} max={100} value={item.depreciationPercent} onChange={e => setItems(old => old.map((x, n) => n === i ? {
            ...x,
            depreciationPercent: Number(e.target.value)
          } : x))} /></label>{items.length > 1 && <button type="button" className={s.iconButton} aria-label="Remove item" onClick={() => setItems(old => old.filter((_, n) => n !== i))}><X size={16} /></button>}</div>)}<button type="button" className={s.textLink} disabled={items.length >= 20} onClick={() => setItems(old => [...old, {
        description: "",
        cost: 0,
        depreciationPercent: 0
      }])}>Add damaged item</button><p className={s.help}>Attach evidence above before submitting. Before and after condition photos are required.</p>{error && <p className={s.error} role="alert">{error}</p>}<button className={s.primary} disabled={busy || !evidence.some(e => e.kind === "BEFORE") || !evidence.some(e => e.kind === "AFTER")}>Submit for client response</button></form></details>;
}
function ClaimResponse({
  booking: b,
  base,
  onReload
}: {
  booking: Booking;
  base: string;
  onReload: () => Promise<void>;
}) {
  const [response, setResponse] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return <form className={s.claimForm} onSubmit={async e => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`${base}/bookings/${b.reference}/respond`, {
        version: b.claims[0].version,
        response,
        evidence: b.evidence.filter(x => x.own).map(x => ({
          reference: x.reference,
          kind: x.kind
        }))
      });
      await onReload();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }}><label className={s.field}><span>Your response to the claim</span><textarea minLength={10} maxLength={2000} required value={response} onChange={e => setResponse(e.target.value)} placeholder="Explain what you agree or disagree with. Upload supporting evidence above." /></label>{error && <p className={s.error} role="alert">{error}</p>}<button className={s.primary} disabled={busy}>Send response for NoLSAF review</button></form>;
}
function EventCalendar({
  base,
  audience,
  venues,
  venueFilter,
  onOpen
}: {
  base: string;
  audience: Audience;
  venues: Venue[];
  venueFilter: string;
  onOpen: (r: string) => Promise<void>;
}) {
  const [month, setMonth] = useState(() => {
      const now = new Date(Date.now() + 3 * 3600000);
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    }),
    [events, setEvents] = useState<CalendarEntry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [truncated, setTruncated] = useState(false);
  const [venue, setVenue] = useState(venues[0]?.ref || ""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [reason, setReason] = useState("EXTERNAL_BOOKING"),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [year, m] = month.split("-").map(Number);
      const from = `${month}-01T00:00:00+03:00`,
        to = new Date(Date.UTC(year, m, 1) - 3 * 3600000).toISOString();
      const r = await apiClient.get(`${base}/calendar`, {
        params: {
          from,
          to,
          ...(venueFilter ? {
            venue: venueFilter
          } : {})
        }
      });
      setEvents(r.data.events);
      setTruncated(r.data.truncated);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [base, month, venueFilter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("event-hire-refresh", refresh);
    return () => window.removeEventListener("event-hire-refresh", refresh);
  }, [load]);
  const shift = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  return <section className={s.panel}><div className={s.panelHeading}><div><h2>Event calendar</h2><p>Paid bookings, temporary holds and external closures.</p></div><div className={s.monthControl}><button className={s.iconButton} onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button><input aria-label="Calendar month" type="month" value={month} required onChange={e => {
          if (e.target.value) setMonth(e.target.value);
        }} /><button className={s.iconButton} onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={17} /></button></div></div>
    <div className={s.calendarLegend}><span><i className={s.bookingDot} />Confirmed booking</span><span><i className={s.holdDot} />Temporary hold</span><span><i className={s.blockDot} />External booking / closure</span></div>
    {error && <p className={s.error} role="alert">{error}</p>}{loading ? <p className={s.empty} role="status">Loading calendar…</p> : <ul className={s.calendarList}>{events.map(e => <li key={`${e.kind}-${e.reference}`} data-kind={e.kind}><span className={s.calendarTime}>{when(e.startsAt)}<small>until {when(e.endsAt)}</small></span><span><strong>{e.title}</strong><small>{text(e.status)}{e.expiresAt ? ` · held until ${when(e.expiresAt)}` : ""}</small></span>{e.kind === "BOOKING" ? <button className={s.textLink} onClick={() => void onOpen(e.reference)}>Open booking<ArrowRight size={13} /></button> : e.kind === "BLOCK" && audience === "owner" ? <button className={s.secondary} disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await apiClient.delete(`${base}/blocks/${e.reference}`);
            await load();
          } catch (cause) {
            setError(message(cause));
          } finally {
            setBusy(false);
          }
        }}>Reopen time</button> : <span className={s.badge}>Awaiting payment</span>}</li>)}</ul>}{!loading && !events.length && !error && <p className={s.empty}>No reserved event times or closures in this month.</p>}{truncated && <p className={s.help}>This range contains more events than can be shown. Narrow the calendar range through NoLSAF support.</p>}
    {audience === "owner" && venues.length > 0 && <details className={s.claimForm}><summary>Block an external booking or closure</summary><form className={s.blockForm} onSubmit={async e => {
        e.preventDefault();
        // The house picker is not a native input, so `required` no longer applies.
        if (!start || !end) {
          setError("Choose both the start and end date and time.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await apiClient.post(`${base}/blocks`, {
            venue: venue || venues[0].ref,
            startsAt: `${start}:00+03:00`,
            endsAt: `${end}:00+03:00`,
            reason
          });
          setStart("");
          setEnd("");
          await load();
        } catch (cause) {
          setError(message(cause));
        } finally {
          setBusy(false);
        }
      }}><label className={s.field}><span>Event venue</span><select value={venue || venues[0].ref} onChange={e => setVenue(e.target.value)}>{venues.map(v => <option key={v.ref} value={v.ref}>{v.title}</option>)}</select></label><div className={s.field}><span>From (EAT)</span><DateTimeField label="From (EAT)" value={start} onChangeAction={setStart} buttonClassName={WORKSPACE_DATE_BOX} /></div><div className={s.field}><span>Until (EAT)</span><DateTimeField label="Until (EAT)" value={end} onChangeAction={setEnd} buttonClassName={WORKSPACE_DATE_BOX} /></div><label className={s.field}><span>Reason</span><select value={reason} onChange={e => setReason(e.target.value)}><option value="EXTERNAL_BOOKING">Booked elsewhere</option><option value="MAINTENANCE">Maintenance</option><option value="UNAVAILABLE">Unavailable</option></select></label><button className={s.primary} disabled={busy}>Block event time</button></form></details>}
  </section>;
}
