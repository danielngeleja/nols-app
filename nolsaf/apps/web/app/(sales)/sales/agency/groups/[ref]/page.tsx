"use client";

// One Agency Desk group stay: progress, owner offers, shortlist, invitations,
// a message to the client and unlisted properties waiting for onboarding.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Compass, Handshake, Loader2, Send } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel, statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import AgencyTabs from "@/components/sales/AgencyTabs";
import TourPicker, { type TourOption } from "@/components/sales/TourPicker";
import InfoTip from "@/components/sales/InfoTip";

type Detail = {
  request: {
    reference: string; status: string; clientName: string; clientPhone: string | null; destination: string | null; groupType: string | null;
    accommodationType: string | null; headcount: number | null; roomsNeeded: number | null; checkIn: string | null; checkOut: string | null;
    rosterCount: number; linkExpiresAt: string | null; confirmedAt: string | null; biddingDays: number; shortlistStatus: string;
  };
  booking: { status: string; openForBids: boolean; paid: boolean; paidAt: string | null; checkedIn: boolean; total: number | null; currency: string; chosenProperty: { title: string } | null } | null;
  bids: Array<{ property: { key: string; title: string; type: string; area: string }; clientTotal: number; currency: string; specialOffers: string | null; status: string; shortlisted: boolean }>;
  unlistedProperties: Array<{ ref: string; name: string; status: string }>;
  commission: { status: string; amount: number; currency: string; reason: string | null } | null;
};
type Lead = { ref: string; propertyName: string; status: string };

const card = "min-w-0 rounded-lg border border-solid border-slate-300 bg-white";
const input = "block min-h-10 w-full rounded-md border border-solid border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const secondary = "inline-flex min-h-10 items-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:border-[#02665e]/50 hover:bg-slate-50 disabled:opacity-50";

const STEPS = ["Request sent", "Client confirmed", "Offers in", "Shared with client", "Paid", "Checked in", "Earning"] as const;

/** How far the group has come, and what the partner should do next. */
function progress(data: Detail): { done: number; closed: boolean; next: string } {
  const r = data.request;
  const b = data.booking;
  const closed = ["CANCELLED", "EXPIRED"].includes(r.status) || ["CANCELED", "CANCELLED", "EXPIRED"].includes(String(b?.status || "").toUpperCase());
  if (closed) return { done: 0, closed: true, next: r.status === "CANCELLED" ? "This request was cancelled before the client confirmed it." : "This group stay is closed. If your client paid, NoLSAF handles the refund." };
  if (r.status === "AWAITING_CLIENT") return { done: 1, closed: false, next: "Your client confirms the request from the SMS on their own phone. Resend the link if they did not get it." };
  if (!b) return { done: 2, closed: false, next: "Setting up the group stay." };
  const earning = !!data.commission && data.commission.status !== "REVERSED";
  if (earning) return { done: 7, closed: false, next: data.commission!.status === "PAID" ? "Your earning on this group is paid." : "Your earning becomes withdrawable after the stay and the checking window." };
  if (b.checkedIn) return { done: 6, closed: false, next: "The group has arrived. Your earning is recorded shortly after payment settles." };
  if (b.paid) return { done: 5, closed: false, next: "Paid in full to NoLSAF. Nothing to collect. Wait for the group to check in." };
  if (r.shortlistStatus === "PUBLISHED" || b.chosenProperty) return { done: 4, closed: false, next: "Your client is choosing an offer and paying NoLSAF. Follow up so the dates are not lost." };
  if (r.shortlistStatus === "PENDING_REVIEW") return { done: 3, closed: false, next: "NoLSAF is checking your shortlist because this is a large group. You will be notified." };
  if (data.bids.length) return { done: 3, closed: false, next: "Owners have sent offers. Tick up to three below and share them with your client." };
  return { done: 2, closed: false, next: "No offers yet. Invite listed owners below, or flag a property that is not on NoLSAF yet." };
}
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-");
const money = (v: number | null, c = "TZS") => (v == null ? "-" : `${c === "TZS" ? "TSh" : c} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

export default function AgencyGroupDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [missing, setMissing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [inviteText, setInviteText] = useState("");
  const [message, setMessage] = useState("");
  const [leadPick, setLeadPick] = useState("");
  const [tour, setTour] = useState<TourOption | null>(null);
  const [tourNote, setTourNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/sales/agency/groups/${encodeURIComponent(ref)}`);
      setData(res.data);
      setPicked((res.data?.bids || []).filter((b: any) => b.shortlisted).map((b: any) => b.property.key));
    } catch (cause: any) {
      if (cause?.response?.status === 404 || cause?.response?.status === 403) setMissing(true);
      else setError(cause?.response?.data?.error || "Could not load this group stay.");
    }
  }, [ref]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    apiClient.get("/api/sales/leads", { params: { pageSize: 100 } }).then((r) => setLeads(r.data?.leads || [])).catch(() => undefined);
  }, []);

  const act = async (key: string, fn: () => Promise<any>, done: (res: any) => string) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const res = await fn();
      setNotice(done(res?.data));
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const base = `/api/sales/agency/groups/${encodeURIComponent(ref)}`;
  const r = data?.request;
  const b = data?.booking;
  const state = data ? progress(data) : null;
  const canShortlist = !!b && !state?.closed && !b.paid && !b.chosenProperty;

  const facts: Array<{ k: string; v: string; tip?: ReactNode }> = data && r ? [
    { k: "Destination", v: r.destination || "-" },
    { k: "People / rooms", v: `${r.headcount ?? "-"} / ${r.roomsNeeded ?? "-"}` },
    { k: "Dates", v: r.checkIn ? `${day(r.checkIn)} to ${day(r.checkOut)}` : "Flexible" },
    { k: "Client phone", v: r.clientPhone || "-", tip: "Your client confirms on this number. They must sign in with it verified, so nobody else can confirm for them." },
    { k: "Request", v: r.status === "AWAITING_CLIENT" ? `Waiting, link until ${day(r.linkExpiresAt)}` : codeLabel(r.status) },
    { k: "Owner offers", v: b ? `${b.openForBids ? "Open" : "Closed"}, ${data.bids.length} received` : "-", tip: `Owners have ${r.biddingDays} day${r.biddingDays === 1 ? "" : "s"} to send offers. They set their own prices; you never quote one.` },
    { k: "Payment", v: b ? (b.paid ? `Paid ${day(b.paidAt)}${b.total ? `, ${money(b.total, b.currency)}` : ""}` : "Not paid yet") : "-", tip: "Agency groups pay NoLSAF in full before the stay. Never collect money from the client yourself." },
    { k: "Your earning", v: data.commission ? `${money(data.commission.amount, data.commission.currency)}, ${codeLabel(data.commission.status).toLowerCase()}` : "After payment", tip: "Recorded after full payment settles. It becomes withdrawable after the stay and the checking window, and is reversed if the group is refunded." },
  ] : [];

  return (
    <SalesShell>
      <div className="min-w-0 space-y-4">
        <SalesPageHeader icon={Handshake} title={r ? `${r.clientName}: group stay` : "Group stay"} description="Owners set prices, you shortlist up to three, your client chooses and pays NoLSAF in full." />
        <AgencyTabs />
        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

        {missing ? (
          <article className={`${card} p-5 text-sm text-slate-600`}>This group stay is not available.</article>
        ) : !data || !r || !state ? (
          <div className={`${card} grid h-40 place-items-center text-[#02665e]`}><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            {/* Where the group stands */}
            <article className={`${card} overflow-hidden`}>
              {state.closed ? (
                <p className="m-0 flex items-start gap-2 bg-rose-50 px-4 py-3 text-[13px] text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{state.next}</p>
              ) : (
                <>
                  {/* Phones and tablets: one line and a bar */}
                  <div className="px-4 pb-3 pt-3.5 lg:hidden">
                    <div className="flex items-center justify-between gap-3">
                      <p className="m-0 min-w-0 text-[13px] font-semibold text-slate-900">
                        {state.done >= STEPS.length ? "All steps done" : STEPS[state.done]}
                      </p>
                      <span className="shrink-0 text-[12px] font-medium tabular-nums text-slate-500">Step {Math.min(state.done + 1, STEPS.length)} of {STEPS.length}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1" aria-hidden>
                      {STEPS.map((s, i) => <span key={s} className={`h-1.5 rounded-full ${i < state.done ? "bg-[#02665e]" : i === state.done ? "bg-[#02665e]/40" : "bg-slate-200"}`} />)}
                    </div>
                  </div>
                  {/* Desktop: every step */}
                  <ol className="m-0 hidden list-none grid-cols-7 gap-px bg-slate-200 p-0 lg:grid">
                    {STEPS.map((label, i) => {
                      const isDone = i < state.done;
                      const isNow = i === state.done;
                      return (
                        <li key={label} aria-current={isNow ? "step" : undefined} className={`flex min-w-0 items-center gap-2 px-3 py-2.5 text-[12px] font-semibold ${isNow ? "bg-[#02665e]/[0.07] text-[#02665e]" : "bg-white"} ${isDone ? "text-slate-900" : isNow ? "" : "text-slate-400"}`}>
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${isDone ? "bg-[#02665e] text-white" : isNow ? "border border-solid border-[#02665e] text-[#02665e]" : "border border-solid border-slate-300 text-slate-400"}`}>
                            {isDone ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                          </span>
                          <span className="min-w-0 truncate" title={label}>{label}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-slate-200 px-4 py-3 text-[13px] text-slate-700">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" /><span className="min-w-0"><span className="font-semibold text-slate-900">Next: </span>{state.next}</span>
                  </p>
                </>
              )}
            </article>

            {/* The request, joined figure grid */}
            <article className={`${card} overflow-hidden`}>
              <dl className="m-0 grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
                {facts.map((f) => (
                  <div key={f.k} className="min-w-0 bg-white px-4 py-3">
                    <dt className="flex items-center gap-1 text-xs text-slate-500">{f.k}{f.tip ? <InfoTip label={f.k}>{f.tip}</InfoTip> : null}</dt>
                    <dd className="m-0 mt-0.5 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{f.v}</dd>
                  </div>
                ))}
              </dl>
              {r.status === "AWAITING_CLIENT" ? (
                <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-200 px-4 py-3">
                  <button type="button" className={secondary} disabled={!!busy} onClick={() => void act("resend", () => apiClient.post(`${base}/resend`, {}), (d) => (d?.smsSent ? "A new link was sent. The old one no longer works." : "New link made, but the SMS did not go out."))}>
                    {busy === "resend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Resend link
                  </button>
                  {confirmCancel ? (
                    <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-3 py-1.5 text-[13px] text-rose-800">
                      Cancel this request? Your client&apos;s link stops working.
                      <button type="button" className="inline-flex h-8 items-center rounded border-0 bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-60" disabled={!!busy}
                        onClick={() => void act("cancel", () => apiClient.post(`${base}/cancel`, { reason: "Cancelled by the partner" }), () => { setConfirmCancel(false); return "Request cancelled."; })}>
                        {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Cancel request"}
                      </button>
                      <button type="button" className="h-8 rounded border-0 bg-transparent px-2 text-xs font-semibold text-rose-800" onClick={() => setConfirmCancel(false)}>Keep it</button>
                    </span>
                  ) : (
                    <button type="button" className={secondary} disabled={!!busy} onClick={() => setConfirmCancel(true)}>Cancel request</button>
                  )}
                </div>
              ) : null}
              {data.commission?.reason ? <p className="m-0 border-0 border-t border-solid border-slate-200 px-4 py-2.5 text-xs text-slate-500">{data.commission.reason}</p> : null}
            </article>

            {b ? (
              <article className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                  <p className="m-0 flex items-center gap-1 text-sm font-semibold text-slate-900">
                    Owner offers
                    <InfoTip label="Shortlisting">
                      Tick up to three offers to share with your client. You cannot shortlist a property you own or are paid through. Large groups (30 rooms or more, or TSh 10 million or more) are checked by NoLSAF before the client sees them.
                    </InfoTip>
                  </p>
                  {r.shortlistStatus === "PENDING_REVIEW" ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">With NoLSAF for checking</span> : null}
                  {r.shortlistStatus === "PUBLISHED" ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Shared with the client</span> : null}
                </div>

                {data.bids.length ? (
                  <>
                    {/* Phones: one row per offer */}
                    <ul className="m-0 list-none p-0 sm:hidden">
                      {data.bids.map((bid) => {
                        const on = picked.includes(bid.property.key);
                        const disabled = !canShortlist || bid.status !== "PENDING" || (!on && picked.length >= 3);
                        return (
                          <li key={bid.property.key} className="border-0 border-t border-solid border-slate-200 first:border-t-0">
                            <label className={`flex items-start gap-3 px-4 py-3 ${disabled ? "" : "cursor-pointer"} ${on ? "bg-[#02665e]/[0.05]" : ""}`}>
                              <input type="checkbox" className="mt-1 shrink-0" disabled={disabled} checked={on}
                                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, bid.property.key] : p.filter((k) => k !== bid.property.key)))} />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                  <span className="min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{bid.property.title}</span>
                                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(bid.clientTotal, bid.currency)}</span>
                                </span>
                                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(bid.status)}`}>{codeLabel(bid.status)}</span>
                                  {bid.property.area || null}
                                </span>
                                {bid.specialOffers ? <span className="mt-1 block text-xs text-slate-600 [overflow-wrap:anywhere]">{bid.specialOffers}</span> : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    {/* Wider screens: table */}
                    <table className="hidden w-full table-fixed border-collapse text-left text-sm sm:table">
                      <colgroup><col className="w-12" /><col /><col className="w-[22%]" /><col className="w-[20%]" /><col className="w-[26%]" /></colgroup>
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5 font-medium"><span className="sr-only">Shortlist</span></th>
                          <th className="px-3 py-2.5 font-medium">Property</th>
                          <th className="px-3 py-2.5 font-medium">Area</th>
                          <th className="px-3 py-2.5 font-medium">Client pays</th>
                          <th className="px-4 py-2.5 font-medium">Extras</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.bids.map((bid) => {
                          const on = picked.includes(bid.property.key);
                          return (
                            <tr key={bid.property.key} className={`border-0 border-t border-solid border-slate-200 ${on ? "bg-[#02665e]/[0.05]" : ""}`}>
                              <td className="px-4 py-3 align-top">
                                <input type="checkbox" aria-label={`Shortlist ${bid.property.title}`} disabled={!canShortlist || bid.status !== "PENDING" || (!on && picked.length >= 3)} checked={on}
                                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, bid.property.key] : p.filter((k) => k !== bid.property.key)))} />
                              </td>
                              <td className="px-3 py-3 align-top">
                                <span className="block font-medium text-slate-900 [overflow-wrap:anywhere]">{bid.property.title}</span>
                                <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(bid.status)}`}>{codeLabel(bid.status)}</span>
                              </td>
                              <td className="px-3 py-3 align-top text-slate-600 [overflow-wrap:anywhere]">{bid.property.area || "-"}</td>
                              <td className="px-3 py-3 align-top font-semibold tabular-nums text-slate-900">{money(bid.clientTotal, bid.currency)}</td>
                              <td className="px-4 py-3 align-top text-slate-600 [overflow-wrap:anywhere]">{bid.specialOffers || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">No offers yet. Invite owners below.</p>
                )}

                {canShortlist && data.bids.length ? (
                  <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-200 px-4 py-3">
                    <button type="button" className={primary} disabled={!!busy || !picked.length}
                      onClick={() => void act("shortlist", () => apiClient.post(`${base}/shortlist`, { propertyKeys: picked }), (d) => (d?.shortlistStatus === "PENDING_REVIEW" ? "Sent to NoLSAF for checking because this is a large group." : "Shared with your client to choose."))}>
                      {busy === "shortlist" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Share {picked.length || ""} offer{picked.length === 1 ? "" : "s"} with the client
                    </button>
                    <span className="text-xs tabular-nums text-slate-500">{picked.length} of 3 picked</span>
                  </div>
                ) : null}
              </article>
            ) : null}

            {b && !state.closed && b.openForBids && !b.chosenProperty ? (
              <section className="grid min-w-0 gap-4 lg:grid-cols-2">
                <article className={`${card} p-4 sm:p-5`}>
                  <p className="m-0 flex items-center gap-1 text-sm font-semibold text-slate-900">
                    Invite listed owners
                    <InfoTip label="Inviting owners">Paste NoLSAF property page links, one per line, up to 10. Each owner gets a notice and sets their own price in their dashboard. Your own properties are skipped.</InfoTip>
                  </p>
                  <textarea value={inviteText} onChange={(e) => setInviteText(e.target.value)} rows={4} placeholder="https://www.nolsaf.com/public/properties/..." aria-label="Property links" className={`${input} mt-3 py-2`} />
                  <button type="button" className={`${secondary} mt-3`} disabled={!!busy || !inviteText.trim()}
                    onClick={() => void act("invite", () => apiClient.post(`${base}/invite`, { propertyUrls: inviteText.split(/\s+/).filter(Boolean).slice(0, 10) }), (d) => {
                      setInviteText("");
                      return `Invited ${d?.invited?.length || 0}.${d?.skipped?.length ? ` Skipped ${d.skipped.length} (already bid, or yours).` : ""}${d?.notFound ? ` ${d.notFound} link(s) not found.` : ""}`;
                    })}>
                    {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Invite owners
                  </button>
                </article>
                <article className={`${card} p-4 sm:p-5`}>
                  <p className="m-0 flex items-center gap-1 text-sm font-semibold text-slate-900">
                    A property not on NoLSAF yet
                    <InfoTip label="Unlisted properties">Register it as one of your leads first, then flag it here. NoLSAF fast-tracks onboarding and verification, and once approved it can send an offer. A group is never sent to an unlisted property.</InfoTip>
                  </p>
                  <div className="mt-3 flex min-w-0 gap-2">
                    <select value={leadPick} onChange={(e) => setLeadPick(e.target.value)} aria-label="Your lead" className={`${input} min-w-0 flex-1`}>
                      <option value="">{leads.length ? "Choose one of your leads" : "No leads yet"}</option>
                      {leads.map((l) => <option key={l.ref} value={l.ref}>{l.propertyName}</option>)}
                    </select>
                    <button type="button" className={`${secondary} shrink-0`} disabled={!!busy || !leadPick} onClick={() => void act("lead", () => apiClient.post(`${base}/leads`, { leadRef: leadPick }), () => { setLeadPick(""); return "Flagged to NoLSAF for fast-track onboarding."; })}>Flag</button>
                  </div>
                  {data.unlistedProperties.length ? (
                    <ul className="m-0 mt-3 list-none divide-y divide-slate-200 rounded-md border border-solid border-slate-200 p-0 text-sm">
                      {data.unlistedProperties.map((p) => (
                        <li key={p.ref} className="flex items-center justify-between gap-2 px-3 py-2">
                          <span className="min-w-0 text-slate-800 [overflow-wrap:anywhere]">{p.name}</span>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(p.status)}`}>{codeLabel(p.status)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              </section>
            ) : null}

            {b && !state.closed ? (
              <article className={`${card} p-4 sm:p-5`}>
                <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Compass className="h-4 w-4 text-[#02665e]" aria-hidden />Recommend a tour
                  <InfoTip label="Tour referrals">The tour arrives in the group conversation with a booking link for {r.headcount ?? "the"} people. Your client books and pays NoLSAF, and you earn after the tour is completed. Operators set the price.</InfoTip>
                </p>
                <div className="mt-3 min-w-0">
                  <TourPicker selected={tour} onPick={setTour} />
                </div>
                <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <input value={tourNote} onChange={(e) => setTourNote(e.target.value)} className={`${input} min-w-0 flex-1`} aria-label="Note for your client" placeholder="A short note for your client (optional)" />
                  <button type="button" className={`${primary} shrink-0 justify-center`} disabled={!!busy || !tour}
                    onClick={() => void act("tour", () => apiClient.post(`${base}/tours`, { tourKey: tour!.key, ...(tourNote.trim() ? { note: tourNote.trim() } : {}) }), (d) => { setTour(null); setTourNote(""); return `Sent ${d?.title || "the tour"} to your client.`; })}>
                    {busy === "tour" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send to client
                  </button>
                </div>
              </article>
            ) : null}

            {b ? (
              <article className={`${card} p-4 sm:p-5`}>
                <p className="m-0 flex items-center gap-1 text-sm font-semibold text-slate-900">
                  Message your client
                  <InfoTip label="Group conversation">Goes into the group stay conversation. NoLSAF can read it, so keep prices and payments on the platform.</InfoTip>
                </p>
                <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <input value={message} onChange={(e) => setMessage(e.target.value)} className={`${input} min-w-0 flex-1`} aria-label="Message" placeholder="Offers are in. Have a look and choose the one that suits your group." />
                  <button type="button" className={`${primary} shrink-0 justify-center`} disabled={!!busy || message.trim().length < 2}
                    onClick={() => void act("message", () => apiClient.post(`${base}/message`, { body: message.trim() }), () => { setMessage(""); return "Message sent."; })}>
                    {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send
                  </button>
                </div>
              </article>
            ) : null}
          </>
        )}
      </div>
    </SalesShell>
  );
}
