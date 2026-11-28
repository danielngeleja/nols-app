"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleDashed, Loader2, PhoneCall, Search, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { EVENT_TYPES, SPACE_TYPES, tsh } from "../eventHireTypes";
import {
  ACTIVE_REQUEST, NEED_LABEL, REQUEST_LABEL, errorText, refreshEventHire, relative, requestNeeds, span, usePulse, when,
  type RequestRow,
} from "./eventAdmin";
import { Drawer, ErrorNote, EyeButton, Fact, Loading, Pill, Segments, SortTh, btnPrimary, field, sortRows, type SortState } from "./ui";

type View = "needs" | "open" | "callback" | "partner" | "escalated" | "WAITING_OWNER" | "READY_TO_PAY" | "closed" | "all";
const VIEWS: View[] = ["needs", "open", "callback", "partner", "escalated", "WAITING_OWNER", "READY_TO_PAY", "closed", "all"];
type SortKey = "date" | "event" | "venue" | "route" | "total" | "status" | "next";
type Detail = RequestRow & {
  ownerContact?: { name: string; phone?: string };
  clientContact?: { name?: string; fullName?: string; phone?: string; email?: string };
  events: { action: string; createdAt: string; details?: { note?: string } }[];
};

const TZ = "Africa/Dar_es_Salaam";
const eventName = (key: string) => EVENT_TYPES.find(e => e.key === key)?.label || key.toLowerCase().replace(/_/g, " ");
const route = (r: RequestRow) => (r.assisted ? (r.partnerAssigned ? "Partner assigned" : "Partner requested") : "Owner direct");
const shortDate = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const shortTime = (v: string) => new Date(v).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export default function AdminEventRequests() {
  return <Suspense fallback={<Loading />}><Requests /></Suspense>;
}

function Requests() {
  const pulse = usePulse();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get("view") as View | null;
  const [view, setView] = useState<View>(fromUrl && VIEWS.includes(fromUrl) ? fromUrl : "needs");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "asc" });
  const [openRef, setOpenRef] = useState<string | null>(params.get("request"));
  const rows = useMemo(() => pulse.requests ?? [], [pulse.requests]);

  useEffect(() => { if (fromUrl && VIEWS.includes(fromUrl)) setView(fromUrl); }, [fromUrl]);
  // Land on everything open when nothing needs a decision, so the page is never blank by default.
  useEffect(() => {
    if (!fromUrl && pulse.requests && view === "needs" && !pulse.requests.some(r => requestNeeds(r).length)) setView("open");
  }, [pulse.requests, fromUrl, view]);

  const match = (r: RequestRow, v: View) => {
    const needs = requestNeeds(r);
    switch (v) {
      case "needs": return needs.length > 0;
      case "open": return ACTIVE_REQUEST.includes(r.status);
      case "callback": case "partner": case "escalated": return needs.includes(v);
      case "WAITING_OWNER": case "READY_TO_PAY": return r.status === v;
      case "closed": return !ACTIVE_REQUEST.includes(r.status);
      default: return true;
    }
  };
  const count = (v: View) => (pulse.requests ? rows.filter(r => match(r, v)).length : null);
  const q = query.trim().toLowerCase();
  const visible = sortRows(
    rows.filter(r => match(r, view) && (!q || (r.propertyTitle || "").toLowerCase().includes(q) || eventName(r.eventType).toLowerCase().includes(q))),
    sort,
    (r, k) => k === "date" ? new Date(r.startsAt).getTime() : k === "event" ? eventName(r.eventType) : k === "venue" ? (r.propertyTitle || "").toLowerCase()
      : k === "route" ? route(r) : k === "total" ? r.quote.total : k === "status" ? (REQUEST_LABEL[r.status] || r.status) : (requestNeeds(r).length ? 0 : 1),
  );
  const onSort = (k: SortKey) => setSort(p => (p.key === k ? { key: k, dir: p.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "total" ? "desc" : "asc" }));
  const pick = (v: View) => { setView(v); router.replace(`${pathname}?view=${v}`, { scroll: false }); };

  if (pulse.requestsOff) return <RequestsOff />;

  const cell = (k: SortKey, x = "") => `px-3 py-2 align-middle ${k !== "date" ? "border-0 border-l border-solid border-neutral-100" : ""} ${sort.key === k ? "bg-[#02665e]/[0.04]" : ""} ${x}`;

  return (
    <div className="space-y-3">
      <Segments label="Request queues" value={view} onChange={pick} items={[
        { key: "needs", label: "Needs you", count: count("needs"), warm: true, hint: "Callbacks, partner assignments and silent owners" },
        { key: "open", label: "All open", count: count("open") },
        { key: "callback", label: "Callbacks", count: count("callback"), warm: true, hint: "A partner recorded the owner's yes; call the owner yourself" },
        { key: "partner", label: "Need a partner", count: count("partner"), warm: true },
        { key: "escalated", label: "Owner silent", count: count("escalated"), warm: true, hint: "Past the reminder window without an answer" },
        { key: "WAITING_OWNER", label: "With owner", count: count("WAITING_OWNER") },
        { key: "READY_TO_PAY", label: "Ready to pay", count: count("READY_TO_PAY") },
        { key: "closed", label: "Closed", count: count("closed") },
      ]} />

      <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
          <p className="m-0 flex-1 text-[13px] font-semibold text-neutral-900">Date requests<span className="ml-1.5 font-normal text-neutral-400">{pulse.requests ? visible.length : ""}</span></p>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search requests</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search venue or event" className="h-8 w-full rounded-md border border-solid border-neutral-200 bg-neutral-50 pl-8 pr-3 text-[12.5px] text-neutral-900 outline-none focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/15" />
          </label>
        </div>
        {pulse.requests === null ? <Loading /> : visible.length === 0 ? (
          <p className="m-0 px-4 py-4 text-[12.5px] text-neutral-500">{q ? "No request matches that search." : view === "needs" ? "No request needs you. Owners are confirming and partners are covering assisted requests." : "No requests in this queue."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-[12.5px]">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-100">
                  <SortTh k="date" label="Event date" sort={sort} onSort={onSort} first />
                  <SortTh k="event" label="Event" sort={sort} onSort={onSort} />
                  <SortTh k="venue" label="Venue" sort={sort} onSort={onSort} />
                  <SortTh k="route" label="Confirmed by" sort={sort} onSort={onSort} />
                  <SortTh k="total" label="Client pays" sort={sort} onSort={onSort} right />
                  <SortTh k="status" label="Status" sort={sort} onSort={onSort} />
                  <SortTh k="next" label="Next step" sort={sort} onSort={onSort} />
                  <th className="w-12 border-0 border-l border-solid border-neutral-200 px-3 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const needs = requestNeeds(r);
                  return (
                    <tr key={r.reference} onDoubleClick={() => setOpenRef(r.reference)} className={`border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-[#02665e]/[0.05] ${i % 2 ? "bg-neutral-50" : "bg-white"}`}>
                      <td className={cell("date", "whitespace-nowrap")}><p className="m-0 font-semibold tabular-nums text-neutral-900">{shortDate(r.startsAt)}</p><p className="m-0 text-[11px] tabular-nums text-neutral-500">{shortTime(r.startsAt)} · {relative(r.startsAt)}</p></td>
                      <td className={cell("event")}><p className="m-0 text-neutral-900">{eventName(r.eventType)}</p><p className="m-0 text-[11px] text-neutral-500">{r.people} guests</p></td>
                      <td className={cell("venue", "max-w-[220px]")}><p className="m-0 truncate font-medium text-neutral-900">{r.propertyTitle || "Event venue"}</p><p className="m-0 truncate text-[11px] text-neutral-500">{span(r.startsAt, r.endsAt)}</p></td>
                      <td className={cell("route", "text-neutral-700")}>{route(r)}{r.confirmationVia && <p className="m-0 text-[11px] text-neutral-400">{r.confirmationVia === "PARTNER_CALL" ? "Partner phone record" : r.confirmationVia === "DESK_CALL" ? "NoLSAF callback" : "Owner in app"}</p>}</td>
                      <td className={cell("total", "text-right tabular-nums")}><p className="m-0 font-semibold text-neutral-900">{tsh(r.quote.total)}</p><p className="m-0 text-[11px] text-neutral-500">{tsh(r.quote.deposit)} deposit</p></td>
                      <td className={cell("status")}><Pill status={r.status}>{REQUEST_LABEL[r.status] || r.status}</Pill>{r.holdExpiresAt && ["OWNER_CONFIRMED", "READY_TO_PAY"].includes(r.status) && <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Held {relative(r.holdExpiresAt)}</p>}</td>
                      <td className={cell("next")}>{needs.length ? <span className="text-[12px] font-semibold text-amber-700">{NEED_LABEL[needs[0]]}</span> : <span className="text-[11.5px] text-neutral-400">{ACTIVE_REQUEST.includes(r.status) ? "With owner or client" : "None"}</span>}</td>
                      <td className="border-0 border-l border-solid border-neutral-100 px-3 py-2 text-right align-middle"><EyeButton onClick={() => setOpenRef(r.reference)} label={`Open request for ${r.propertyTitle || "venue"}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length >= 100 && <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">Showing the 100 most recent requests.</p>}
      </section>

      {openRef && <RequestDrawer key={openRef} reference={openRef} onClose={() => { setOpenRef(null); if (params.get("request")) router.replace(`${pathname}?view=${view}`, { scroll: false }); }} />}
    </div>
  );
}

/** Requests are switched off: say what is ready, what is not, and what admins will do once they open. */
function RequestsOff() {
  const pulse = usePulse();
  const live = pulse.venueCounts?.APPROVED ?? null;
  const review = pulse.venueCounts?.PENDING ?? 0;
  const checks: Array<{ ok: boolean | null; title: string; note: string; href?: string; cta?: string }> = [
    { ok: live == null ? null : live > 0, title: live ? `${live} live ${live === 1 ? "venue" : "venues"} ready to be requested` : "No live venue yet", note: review ? `${review} more waiting for your review` : "Clients can only request approved venues", href: "/admin/event-hire/venues", cta: "Venues" },
    { ok: false, title: "Date requests are switched off", note: "Turned on by the platform team with EVENT_HIRE_REQUESTS_ENABLED on the API" },
    { ok: pulse.summary ? pulse.summary.paymentsEnabled : null, title: pulse.summary?.paymentsEnabled ? "Online checkout is on" : "Online checkout is off", note: "Without it, confirmed dates cannot be paid online" },
  ];
  const flow = [
    { who: "Client", what: "Asks for a venue, date and time", admin: false },
    { who: "Owner or partner", what: "Confirms the date is free", admin: false },
    { who: "You", what: "Assign a partner or verify the owner by phone", admin: true },
    { who: "Client", what: "Pays within the hold window", admin: false },
    { who: "You", what: "Manage the booking, deposit and payout", admin: true },
  ];
  return (
    <div className="space-y-3">
      <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-solid border-amber-200 bg-amber-50/70 px-4 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
        <p className="m-0 min-w-0 flex-1 text-[13px] text-amber-950"><strong className="font-semibold">Date requests are not open yet.</strong> Clients cannot ask for event dates in this environment. Everything else in Event hire works.</p>
      </section>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <p className="m-0 border-0 border-b border-solid border-neutral-100 px-3 py-2 text-[13px] font-semibold text-neutral-900">Ready to open?</p>
          <ul className="m-0 list-none p-0">
            {checks.map(c => (
              <li key={c.title} className="flex items-center gap-2.5 border-0 border-t border-solid border-neutral-100 px-3 py-2.5 first:border-t-0">
                {c.ok == null ? <CircleDashed className="h-4 w-4 shrink-0 text-neutral-300" /> : c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-500" />}
                <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-semibold text-neutral-900">{c.title}</span><span className="block text-[11px] text-neutral-500">{c.note}</span></span>
                {c.href && <Link href={c.href} className="shrink-0 text-[11.5px] font-semibold text-[#02665e] no-underline hover:underline">{c.cta}</Link>}
              </li>
            ))}
          </ul>
        </section>

        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <p className="m-0 border-0 border-b border-solid border-neutral-100 px-3 py-2 text-[13px] font-semibold text-neutral-900">How a date request travels</p>
          <ol className="m-0 list-none p-3">
            {flow.map((f, i) => (
              <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                {i < flow.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-neutral-200" aria-hidden />}
                <span className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${f.admin ? "bg-[#0b2420] text-white" : "bg-neutral-100 text-neutral-500"}`}>{i + 1}</span>
                <span className="min-w-0 pt-0.5">
                  <span className={`block text-[11px] font-semibold ${f.admin ? "text-[#02665e]" : "text-neutral-500"}`}>{f.who}</span>
                  <span className="block text-[12.5px] text-neutral-800">{f.what}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">Dark steps are yours. They appear in this queue with an amber count once requests open.</p>
        </section>
      </div>
    </div>
  );
}

function RequestDrawer({ reference, onClose }: { reference: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [partners, setPartners] = useState<{ id: number; name: string; agentCode: string }[]>([]);
  const [partner, setPartner] = useState("");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);

  const load = useCallback(async () => {
    try { const r = await apiClient.get(`/api/admin/event-requests/${encodeURIComponent(reference)}`); setDetail(r.data); setError(""); }
    catch (e) { setError(errorText(e, "Could not open this request.")); }
  }, [reference]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void apiClient.get("/api/admin/event-requests/assignment/partners").then(r => setPartners(r.data.partners)).catch(() => setPartners([])); }, []);

  const d = detail;
  const canAssign = Boolean(d && d.assisted && !d.partnerApprovedAt && ACTIVE_REQUEST.includes(d.status) && d.status !== "PAYMENT_PENDING");
  const canVerify = Boolean(d && d.status === "OWNER_CONFIRMED" && d.confirmationVia === "PARTNER_CALL");

  const decide = async (action: "ASSIGN" | "VERIFY_CALL") => {
    if (!d) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiClient.post(`/api/admin/event-requests/${encodeURIComponent(d.reference)}/decide`, {
        version: d.version, action,
        ...(action === "ASSIGN" ? { partnerId: Number(partner) } : { note, attested }),
      });
      setNotice(action === "ASSIGN" ? "Partner assigned. They can now confirm the date with the owner." : "Callback recorded. The request can move to checkout.");
      setNote(""); setAttested(false); setPartner("");
      await load();
      refreshEventHire();
    } catch (e) { setError(errorText(e)); await load(); }
    finally { setBusy(false); }
  };

  const t = d?.terms;
  return (
    <Drawer open onClose={onClose} busy={busy} kicker="Date request" title={d?.propertyTitle || "Event request"}
      status={d && <><Pill status={d.status}>{REQUEST_LABEL[d.status] || d.status}</Pill>{requestNeeds(d).map(n => <Pill key={n} kind="amber">{NEED_LABEL[n]}</Pill>)}</>}>
      {!d ? (error ? <ErrorNote>{error}</ErrorNote> : <Loading />) : (
        <div className="space-y-5">
          {notice && <p role="status" className="m-0 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900"><ShieldCheck className="h-4 w-4 shrink-0" />{notice}</p>}
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Event" value={eventName(d.eventType)} sub={`${d.people} guests${d.seating ? `, ${d.seating.toLowerCase()}` : ""}`} />
            <Fact label="Client pays" value={tsh(d.quote.total)} sub={`incl. ${tsh(d.quote.deposit)} deposit`} />
            <Fact label="Owner receives" value={tsh(d.quote.ownerReceives)} sub={`Cleaning ${tsh(d.quote.cleaningFee)}`} />
            <Fact label="Request expires" value={d.expiresAt ? relative(d.expiresAt) : "-"} sub={d.expiresAt ? when(d.expiresAt) : undefined} />
          </div>
          <p className="m-0 text-[13px] text-neutral-700"><strong className="font-semibold">When:</strong> {span(d.startsAt, d.endsAt)} EAT</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-solid border-neutral-200 px-3 py-2.5"><p className="m-0 text-[11px] text-neutral-500">Owner</p><p className="m-0 mt-0.5 text-[13px] font-semibold text-neutral-900">{d.ownerContact?.name || "Owner"}</p><p className="m-0 text-[12px] text-neutral-500">{d.ownerContact?.phone || "Phone unavailable"}</p></div>
            <div className="rounded-md border border-solid border-neutral-200 px-3 py-2.5"><p className="m-0 text-[11px] text-neutral-500">Client</p><p className="m-0 mt-0.5 text-[13px] font-semibold text-neutral-900">{d.clientContact?.fullName || d.clientContact?.name || "NoLSAF client"}</p><p className="m-0 text-[12px] text-neutral-500">{d.clientContact?.phone || d.clientContact?.email || "No verified contact"}</p></div>
          </div>

          {canVerify && (
            <section className="rounded-lg border border-solid border-amber-200 bg-amber-50/60 p-3.5">
              <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-amber-900"><PhoneCall className="h-4 w-4" />Independent callback needed</p>
              <p className="m-0 mt-1 text-[12px] text-amber-900/80">A partner recorded the owner's confirmation by phone. Call the owner yourself before the client can pay.</p>
              <label className="mt-3 block text-[12px] font-medium text-neutral-700">Callback record
                <textarea className={`${field} mt-1 min-h-[76px]`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Who you spoke with, when, and the exact event time they confirmed" />
              </label>
              <label className="mt-2 flex items-start gap-2 text-[12px] text-neutral-700"><input type="checkbox" className="mt-0.5 accent-[#02665e]" checked={attested} onChange={e => setAttested(e.target.checked)} />I contacted the owner myself and verified this confirmation.</label>
              <button type="button" className={`${btnPrimary} mt-3`} disabled={busy || !attested || note.trim().length < 12} onClick={() => void decide("VERIFY_CALL")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}Record callback</button>
              {note.trim().length > 0 && note.trim().length < 12 && <p className="m-0 mt-1.5 text-[11px] text-neutral-500">Add a little more detail (12 characters at least).</p>}
            </section>
          )}

          {canAssign && (
            <section className="rounded-lg border border-solid border-neutral-200 p-3.5">
              <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-neutral-900"><UserPlus className="h-4 w-4 text-[#02665e]" />{d.partnerAssigned ? "Reassign the sales partner" : "Assign a sales partner"}</p>
              <p className="m-0 mt-1 text-[12px] text-neutral-500">The partner calls the owner and confirms the date. They cannot be the owner or the client.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select className={`${field} flex-1 basis-56`} value={partner} onChange={e => setPartner(e.target.value)} aria-label="Sales partner">
                  <option value="">Choose an eligible partner</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name || p.agentCode} · {p.agentCode}</option>)}
                </select>
                <button type="button" className={btnPrimary} disabled={busy || !partner} onClick={() => void decide("ASSIGN")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Assign</button>
              </div>
            </section>
          )}

          {t && (
            <details className="rounded-md border border-solid border-neutral-200 px-3 py-2.5">
              <summary className="cursor-pointer text-[13px] font-semibold text-neutral-800">Venue rules agreed for this quote</summary>
              <div className="mt-2 space-y-1.5 text-[12px] text-neutral-600">
                {t.description && <p className="m-0">{t.description}</p>}
                <p className="m-0">{SPACE_TYPES.find(x => x.key === t.spaceType)?.label || "Space"} · hours {t.earliestStart} to {t.latestEnd} · quiet from {t.noiseCutoff || "not set"}</p>
                <p className="m-0">Allowed: {Object.entries(t.allowed || {}).filter(([, on]) => on).map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ") || "only what the venue rules state"}.</p>
              </div>
            </details>
          )}

          <section>
            <p className="m-0 mb-2 text-[11px] font-semibold text-neutral-500">Activity</p>
            {d.events.length ? (
              <ol className="m-0 list-none space-y-0 border-0 border-l border-solid border-neutral-200 p-0 pl-4">
                {d.events.map((e, i) => (
                  <li key={`${e.createdAt}-${i}`} className="relative pb-3 last:pb-0">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-neutral-300" aria-hidden />
                    <p className="m-0 text-[12px] font-medium text-neutral-800">{e.action.charAt(0) + e.action.slice(1).toLowerCase().replace(/_/g, " ")}</p>
                    <p className="m-0 text-[11px] text-neutral-500">{when(e.createdAt)}{e.details?.note ? ` · ${e.details.note}` : ""}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="m-0 text-[12px] text-neutral-500">No activity recorded yet.</p>}
          </section>
        </div>
      )}
    </Drawer>
  );
}
