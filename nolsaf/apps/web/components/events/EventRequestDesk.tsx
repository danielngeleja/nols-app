"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, RefreshCw, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DateTimeField from "@/components/ui/DateTimeField";
import { EVENT_TYPES, SPACE_TYPES, tsh, type EventTerms } from "./eventHireTypes";

type Audience = "customer" | "owner" | "sales" | "admin";
type RequestRow = {
  reference: string; version: number; status: string; propertyTitle?: string;
  startsAt: string; endsAt: string; people: number; eventType: string;
  assisted: boolean; partnerAssigned: boolean; confirmationVia?: string;
  canPay?: boolean;
  terms?: EventTerms;
  holdExpiresAt?: string; needsAssistance: boolean;
  quote: { total: number; deposit: number; cleaningFee: number; clientFee: number; ownerReceives: number };
};
const label: Record<string, string> = { WAITING_OWNER: "Awaiting owner", OWNER_CONFIRMED: "Partner check pending", READY_TO_PAY: "Availability confirmed", DECLINED: "Declined", CANCELLED: "Cancelled", EXPIRED: "Expired", BOOKED: "Booking confirmed", PAYMENT_PENDING: "Payment pending", PAYMENT_REVIEW: "Payment under review" };
const when = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const field = "min-h-10 w-full rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const primary = `${button} !border-[#02665e] !bg-[#02665e] !text-white`;
const errorText = (e: any) => e?.response?.status === 404 ? "Event requests are not available for this account yet." : e?.response?.data?.error || "Could not complete that action. Please try again.";

export default function EventRequestDesk({ audience, propertyId, embedded = false, paymentsEnabled = false }: { audience: Audience; propertyId?: number; embedded?: boolean; paymentsEnabled?: boolean }) {
  const base = `/api/${audience}/event-requests`;
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [detail, setDetail] = useState<{ ownerContact?: { name: string; phone?: string };clientContact?:{name?:string;fullName?:string;phone?:string;email?:string}; events: { action: string; createdAt: string; details?: { note?: string } }[] } | null>(null);
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [partner, setPartner] = useState("");
  const [partners, setPartners] = useState<{ id: number; name: string; agentCode: string }[]>([]);
  const load = useCallback(async () => {
    try {
      const response = await apiClient.get(base, { params: propertyId ? { propertyId } : undefined });
      setRows(response.data.requests);
      setError("");
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [base, propertyId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("event-hire-refresh", refresh);
    return () => window.removeEventListener("event-hire-refresh", refresh);
  }, [load]);
  useEffect(() => {
    if (audience !== "admin") return;
    void apiClient.get(`${base}/assignment/partners`).then(r => setPartners(r.data.partners)).catch(() => setPartners([]));
  }, [audience, base]);
  const open = async (row: RequestRow) => {
    setBusy(row.reference); setError(""); setNote(""); setAttested(false); setQuoteAccepted(false); setPartner("");
    try {
      const r = await apiClient.get(`${base}/${row.reference}`);
      setSelected(r.data); setDetail(r.data);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(""); }
  };
  const decide = async (action: string) => {
    if (!selected) return;
    setBusy(selected.reference); setError(""); setNotice("");
    try {
      await apiClient.post(`${base}/${selected.reference}/decide`, { version: selected.version, action,
        ...(["RECORD_CALL", "VERIFY_CALL"].includes(action) ? { note, attested } : {}),
        ...(action === "APPROVE" ? { attested } : {}),
        ...(action === "ASSIGN" ? { partnerId: Number(partner) } : {}) });
      setSelected(null); setDetail(null); setNotice("Request updated."); await load();
    } catch (e) { setError(errorText(e)); await load(); }
    finally { setBusy(""); }
  };
  const active = selected && ["WAITING_OWNER", "OWNER_CONFIRMED", "READY_TO_PAY"].includes(selected.status);
  return <div className="space-y-4 text-slate-900">
    {!embedded && <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="m-0 flex items-center gap-2 text-xl font-bold"><CalendarClock className="h-5 w-5 text-[#02665e]" />Event requests</h1>
        <p className="m-0 mt-1 text-sm text-slate-600">Track venue requests and confirmed time slots. All times are East Africa Time.</p></div>
      <button className={button} disabled={loading || Boolean(busy)} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</button>
    </header>}
    <p className="m-0 flex gap-2 rounded-lg border border-solid border-teal-200 bg-teal-50 px-3 py-3 text-sm text-teal-900"><ShieldCheck className="h-4 w-4 shrink-0" />{paymentsEnabled ? "Availability must be confirmed before checkout. A booking is confirmed only after NoLSAF verifies the payment." : "Availability must be confirmed first. Online event checkout is awaiting activation."}</p>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    {audience === "customer" && !loading && !error && <EventRequestForm onCreated={load} />}
    {audience === "owner" && propertyId && <EventAvailability propertyId={propertyId} />}
    {loading ? <p role="status">Loading requests…</p> : <div className="space-y-3">
      {!rows.length && !error && <p className="rounded-lg border border-solid border-slate-200 bg-white p-5 text-sm text-slate-600">No event requests yet.</p>}
      {rows.map(row => <article key={row.reference} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-solid border-slate-200 bg-white p-4">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-base font-semibold">{row.propertyTitle || "Event venue"}</h2><span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{label[row.status] || row.status}</span></div>
          <p className="m-0 mt-1 text-sm text-slate-700">{when(row.startsAt)} — {when(row.endsAt)}</p>
          <p className="m-0 mt-1 text-xs text-slate-500">{row.people} guests · {row.assisted ? row.partnerAssigned ? "Sales partner assigned" : "Sales assistance requested" : "Direct request"}</p>
          {row.needsAssistance && <p className="m-0 mt-1 text-xs font-semibold text-amber-800">Needs NoLSAF follow-up</p>}
          {row.holdExpiresAt && ["OWNER_CONFIRMED", "READY_TO_PAY"].includes(row.status) && <p className="m-0 mt-1 text-xs text-teal-800">Held until {when(row.holdExpiresAt)}</p>}
        </div>
        <div className="flex items-center gap-4"><div className="text-right"><strong className="text-sm">{tsh(row.quote.total)}</strong><p className="m-0 mt-1 text-xs text-slate-500">Includes {tsh(row.quote.deposit)} refundable deposit</p></div>
          <button className={button} disabled={Boolean(busy)} onClick={() => void open(row)}>Details</button></div>
      </article>)}
      {rows.length === 100 && <p className="text-xs text-slate-500">Showing the 100 most recent requests.</p>}
    </div>}
    {selected && <section aria-label="Selected event request" className="rounded-xl border border-solid border-teal-200 bg-[#f7fbfa] p-4">
      <div className="flex justify-between gap-3"><h2 className="m-0 text-base font-semibold">{selected.propertyTitle || "Event request"} · {label[selected.status]}</h2><button className={button} onClick={() => { setSelected(null); setDetail(null); }}>Close</button></div>
      <p className="text-sm">{when(selected.startsAt)} — {when(selected.endsAt)} · {selected.people} guests</p>
      <p className="text-sm">Estimated total {tsh(selected.quote.total)} · refundable deposit {tsh(selected.quote.deposit)} · cleaning {tsh(selected.quote.cleaningFee)}.</p>
      {selected.terms&&<details className="mb-3 rounded-lg border border-solid border-slate-200 bg-white p-3 text-sm"><summary className="cursor-pointer font-semibold">Approved venue rules</summary><p>{selected.terms.description}</p><p>Event hours: {selected.terms.earliestStart}–{selected.terms.latestEnd}. Noise cutoff: {selected.terms.noiseCutoff}.</p><p>Allowed: {Object.entries(selected.terms.allowed).filter(([,allowed])=>allowed).map(([key])=>key.replace(/([A-Z])/g," $1").toLowerCase()).join(", ")||"Only activities explicitly agreed in the approved venue rules"}.</p></details>}
      {audience === "customer" && selected.canPay && paymentsEnabled && <div className="my-3 space-y-3 rounded-lg border border-solid border-teal-200 bg-white p-3"><p className="text-xs text-slate-600">Checkout holds the slot for up to 20 minutes. NoLSAF holds the security deposit separately. Owners have 48 hours after the event to report damage; clients have 48 hours to respond. No deduction is automatic. Cancellation and service concerns are reviewed by NoLSAF before any refund decision.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={quoteAccepted} onChange={e=>setQuoteAccepted(e.target.checked)} />I accept this quote, the approved venue rules and these deposit and review conditions.</label><button className={primary} disabled={!quoteAccepted||Boolean(busy)} onClick={async()=>{
        setBusy(selected.reference);setError("");try{const r=await apiClient.post("/api/customer/event-hire/checkout",{requestRef:selected.reference,consent:true});const url=new URL(r.data.checkoutUrl);if(url.protocol!=="https:")throw new Error("Invalid payment URL");window.location.assign(url.toString());}catch(e){setError(errorText(e));}finally{setBusy("");}
      }}>Pay {tsh(selected.quote.total)} and confirm</button></div>}
      {detail?.ownerContact && <p className="text-sm">Owner contact: {detail.ownerContact.name} · {detail.ownerContact.phone || "Phone unavailable; contact NoLSAF support"}</p>}
      {detail?.clientContact&&<p className="text-sm">Client contact: {detail.clientContact.fullName||detail.clientContact.name||"NoLSAF client"} · {detail.clientContact.phone||detail.clientContact.email||"Contact NoLSAF support"}</p>}
      {selected.confirmationVia === "PARTNER_CALL" && <p className="text-sm text-amber-900">A partner recorded a phone confirmation. It needs owner acknowledgement or an independent NoLSAF callback.</p>}
      {active && <div className="space-y-3">
        {audience === "owner" && <p className="text-sm text-slate-600">Confirm only after checking your external bookings and access to this space.</p>}
        {audience === "sales" && <><label className="block text-sm">Call record<textarea className={`${field} mt-1`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Who confirmed the date and time, and when you spoke" /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} />I contacted the owner and checked the exact event time and capacity.</label></>}
        {audience === "admin" && selected.assisted && <label className="block text-sm">Assign sales partner<select className={`${field} mt-1`} value={partner} onChange={e => setPartner(e.target.value)}><option value="">Choose an eligible partner</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name || p.agentCode} · {p.agentCode}</option>)}</select></label>}
        {audience === "admin" && selected.confirmationVia === "PARTNER_CALL" && <><label className="block text-sm">Independent callback record<textarea className={`${field} mt-1`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Who you spoke with, when, and the exact event time confirmed" /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} />I independently contacted the owner and verified this confirmation.</label></>}
        <div className="flex flex-wrap gap-2">
          {audience === "customer" && <button className={button} disabled={Boolean(busy)} onClick={() => void decide("CANCEL")}>Cancel request</button>}
          {audience === "owner" && <><button className={button} disabled={Boolean(busy)} onClick={() => void decide("DECLINE")}>Decline</button>
            {(selected.status === "WAITING_OWNER" || selected.confirmationVia === "PARTNER_CALL") && <button className={primary} disabled={Boolean(busy)} onClick={() => void decide("CONFIRM")}>Confirm availability</button>}</>}
          {audience === "sales" && selected.status === "WAITING_OWNER" && <button className={primary} disabled={Boolean(busy) || !attested || note.trim().length < 12} onClick={() => void decide("RECORD_CALL")}>Record owner call</button>}
          {audience === "sales" && selected.status === "OWNER_CONFIRMED" && ["APP", "DESK_CALL"].includes(selected.confirmationVia || "") && <button className={primary} disabled={Boolean(busy) || !attested} onClick={() => void decide("APPROVE")}>Approve availability</button>}
          {audience === "admin" && selected.assisted && <button className={primary} disabled={Boolean(busy) || !partner} onClick={() => void decide("ASSIGN")}>Assign partner</button>}
          {audience === "admin" && selected.confirmationVia === "PARTNER_CALL" && <button className={primary} disabled={Boolean(busy) || !attested || note.trim().length < 12} onClick={() => void decide("VERIFY_CALL")}>Verify owner callback</button>}
        </div>
      </div>}
      <ol className="mt-4 space-y-1 pl-5 text-xs text-slate-600">{detail?.events.map((e, i) => <li key={`${e.createdAt}-${i}`}>{e.action.toLowerCase().replace(/_/g, " ")} · {when(e.createdAt)}{e.details?.note ? ` · ${e.details.note}` : ""}</li>)}</ol>
    </section>}
  </div>;
}

function EventRequestForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [venues, setVenues] = useState<{ propertyId: number; title: string; slug?: string; terms: EventTerms }[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [venueId, setVenueId] = useState("");
  const [type, setType] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [people, setPeople] = useState(1);
  const [seating, setSeating] = useState("SEATED");
  const [pack, setPack] = useState("HALF_DAY");
  const [assisted, setAssisted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const venue = venues.find(v => v.propertyId === Number(venueId));
  useEffect(() => { void apiClient.get("/api/customer/event-requests/venues/approved").then(r => {
    const list = r.data.venues as typeof venues;
    setVenues(list);
    // Arriving from a property page's "Request a date" (?venue=<public slug>): preselect it and open the form.
    const wanted = new URLSearchParams(window.location.search).get("venue");
    const match = wanted ? list.find(v => v.slug === wanted) : undefined;
    if (match) { setVenueId(String(match.propertyId)); setFormOpen(true); }
  }).catch(e => setError(errorText(e))); }, []);
  return <details open={formOpen} onToggle={e => setFormOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-xl border border-solid border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-[#02665e]">Request an event venue</summary>
    <form className="mt-4 space-y-3" onSubmit={async e => {
      e.preventDefault();
      if (!startsAt || !endsAt) { setError("Choose both the start and end date and time."); return; }
      setBusy(true); setError("");
      try {
        await apiClient.post("/api/customer/event-requests", { propertyId: Number(venueId), startsAt: `${startsAt}:00+03:00`, endsAt: `${endsAt}:00+03:00`, eventType: type, people, seating, package: pack, assisted });
        await onCreated(); setStartsAt(""); setEndsAt("");
      } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Venue<select className={`${field} mt-1`} required value={venueId} onChange={e => { setVenueId(e.target.value); setType(""); }}><option value="">Choose a venue</option>{venues.map(v => <option key={v.propertyId} value={v.propertyId}>{v.title}</option>)}</select></label>
        <label className="text-sm">Event<select className={`${field} mt-1`} required value={type} onChange={e => setType(e.target.value)}><option value="">Choose an event</option>{venue?.terms.eventTypes.map(t => <option key={t} value={t}>{EVENT_TYPES.find(item => item.key === t)?.label || t}</option>)}</select></label>
        <div className="text-sm">Starts (EAT)<div className="mt-1"><DateTimeField label="Starts (EAT)" value={startsAt} onChangeAction={setStartsAt} /></div></div>
        <div className="text-sm">Ends (EAT)<div className="mt-1"><DateTimeField label="Ends (EAT)" value={endsAt} onChangeAction={setEndsAt} /></div></div>
        <label className="text-sm">Guests<input className={`${field} mt-1`} type="number" min={1} max={3000} required value={people} onChange={e => setPeople(Number(e.target.value))} /></label>
        <label className="text-sm">Arrangement<select className={`${field} mt-1`} value={seating} onChange={e => setSeating(e.target.value)}><option value="SEATED">Seated</option><option value="STANDING">Standing</option></select></label>
        <label className="text-sm">Hire package<select className={`${field} mt-1`} value={pack} onChange={e => setPack(e.target.value)}><option value="HALF_DAY">Half day (up to 5 hours)</option><option value="FULL_DAY">Full day</option><option value="EVENING">Evening (from 17:00)</option></select></label>
      </div>
      {venue && <p className="text-xs text-slate-600">{SPACE_TYPES.find(s => s.key === venue.terms.spaceType)?.label} · Event hours {venue.terms.earliestStart}–{venue.terms.latestEnd} · Up to {venue.terms.capacitySeated} seated / {venue.terms.capacityStanding} standing. Final price is calculated from the approved package.</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={assisted} onChange={e => setAssisted(e.target.checked)} />Use a NoLSAF sales partner to help confirm availability (recommended).</label>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button className={primary} disabled={busy || !venueId}>{busy ? "Sending…" : "Request venue"}</button>
    </form>
  </details>;
}

export function EventAvailability({ propertyId }: { propertyId: number }) {
  const [blocks, setBlocks] = useState<{ reference: string; startsAt: string; endsAt: string; reason: string }[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("EXTERNAL_BOOKING");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/owner/properties/${propertyId}/event-availability`;
  const load = useCallback(async () => { const r = await apiClient.get(base); setBlocks(r.data.blocks); }, [base]);
  useEffect(() => { void load().catch(e => setError(errorText(e))); }, [load]);
  return <details className="rounded-xl border border-solid border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-[#02665e]">Manage event availability</summary>
    <p className="text-sm text-slate-600">Block times booked elsewhere or closed for maintenance. Confirmed requests cannot be overwritten here. Accommodation availability is managed separately.</p>
    <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async e => {
      e.preventDefault();
      if (!startsAt || !endsAt) { setError("Choose both the start and end date and time."); return; }
      setBusy(true); setError("");
      try { await apiClient.post(base, { startsAt: `${startsAt}:00+03:00`, endsAt: `${endsAt}:00+03:00`, reason }); await load(); setStartsAt(""); setEndsAt(""); }
      catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
    }}>
      <div className="min-w-0 text-sm">From (EAT)<div className="mt-1"><DateTimeField label="From (EAT)" value={startsAt} onChangeAction={setStartsAt} /></div></div>
      <div className="min-w-0 text-sm">Until (EAT)<div className="mt-1"><DateTimeField label="Until (EAT)" value={endsAt} onChangeAction={setEndsAt} /></div></div>
      <label className="text-sm">Reason<select className={`${field} mt-1`} value={reason} onChange={e => setReason(e.target.value)}><option value="EXTERNAL_BOOKING">Booked elsewhere</option><option value="MAINTENANCE">Maintenance</option><option value="UNAVAILABLE">Unavailable</option></select></label>
      <button className={primary} disabled={busy}>Block time</button>
    </form>
    {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
    <ul className="mt-3 list-none space-y-2 p-0">{blocks.map(b => <li key={b.reference} className="flex flex-wrap items-center justify-between gap-2 border-b border-solid border-slate-200 py-2 text-sm"><span>{when(b.startsAt)} — {when(b.endsAt)} · {b.reason.toLowerCase().replace(/_/g, " ")}</span><button className={button} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await apiClient.delete(`${base}/${b.reference}`); await load(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }}>Reopen time</button></li>)}</ul>
  </details>;
}
