"use client";

/**
 * One long stay, as the tenant or the landlord sees it (docs/LONG_STAY_RENTALS.md).
 * NoLSAF is the bridge until the booking is paid: names, phone numbers and
 * messages open only then. The server decides every status change; this page
 * only asks.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, House, Loader2, Lock, MapPin, Phone, Send, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import OfferLeasePanel, { type OfferLeaseView } from "./OfferLeasePanel";

type Side = "TENANT" | "LANDLORD";
type View = OfferLeaseView & {
  ref: string;
  status: string;
  home: { title: string; key: string; area: string; terms?: { minTermMonths: number; maxTermMonths: number | null; availableFrom: string } | null } | null;
  otherParty: { name: string | null; phone: string | null };
  contactsShared: boolean;
  cancelReason: string | null;
  events: Array<{ by: "YOU" | "THEM" | "NOLSAF"; type: string; text: string | null; masked: boolean; at: string; photos?: string[] }>;
};

export const TENANCY_STATUS_LABEL: Record<string, string> = {
  OFFERED: "Waiting for the landlord",
  ACCEPTED: "Confirmed, lease to sign",
  AWAITING_PAYMENT: "Waiting for payment",
  RESERVED: "Reserved",
  MOVE_IN: "Move-in",
  ACTIVE: "Let",
  ENDING: "Ending",
  ENDED: "Ended",
  CANCELLED: "Closed",
  DISPUTED: "Under review",
  OVERDUE: "Overdue",
};

const EVENT_LABEL: Record<string, string> = {
  RESERVATION_REQUESTED: "Reserved at the listed terms",
  STATUS_CANCELLED: "Closed",
  STATUS_ACCEPTED: "Landlord confirmed, lease ready",
  LEASE_ACCEPTED: "Lease accepted",
  STATUS_AWAITING_PAYMENT: "Lease signed by both",
  STATUS_RESERVED: "First month paid, home reserved",
  STATUS_MOVE_IN: "Move-in day",
  MOVE_IN_CONFIRMED: "Move-in confirmed by one side",
  STATUS_ACTIVE: "Move-in confirmed, home let",
  STATUS_DISPUTED: "Problem reported to NoLSAF",
  CONDITION_PHOTOS: "Condition photos added",
  PAYOUT_PAID: "Landlord payout sent",
  PAYOUT_RECORDED: "Landlord payout sent",
  STATUS_ENDING: "Notice given",
  STATUS_ENDED: "Stay ended",
  STATUS_OVERDUE: "Lease ended, move-out not confirmed",
  RENEWAL_REQUESTED: "Renewal requested",
  RENEWAL_REMINDER: "Renewal window open",
};

export function eatDateTime(iso: string | null) {
  if (!iso) return "";
  return `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

export default function TenancyDetail({ side, tenancyRef, backHref }: { side: Side; tenancyRef: string; backHref: string }) {
  const base = side === "TENANT" ? "/api/customer/long-stay" : "/api/owner/long-stay";
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  // Back from the card checkout: say how it went; the server's status is the truth.
  const [cardReturn, setCardReturn] = useState<string | null>(null);
  useEffect(() => {
    try {
      const value = new URLSearchParams(window.location.search).get("cardReturn");
      if (value === "success" || value === "failed" || value === "pending") setCardReturn(value);
    } catch {
      // ignore
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<View>(`${base}/tenancies/${encodeURIComponent(tenancyRef)}`);
      setView(response.data);
      setLoadError("");
    } catch (requestError: any) {
      setLoadError(requestError?.response?.status === 404 ? "This long stay was not found." : "Could not load this long stay.");
    }
  }, [base, tenancyRef]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`${base}/tenancies/${encodeURIComponent(tenancyRef)}/${path}`, body);
      await load();
      return true;
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    if (await act("message", "messages", { text: text.trim() })) setText("");
  };

  const close = async () => {
    if (reason.trim().length < 5) { setError("Give a short reason (at least 5 characters)."); return; }
    if (await act("close", side === "TENANT" ? "cancel" : "decline", { reason: reason.trim() })) { setClosing(false); setReason(""); }
  };

  const tenant = side === "TENANT";
  if (loadError) return <Shell backHref={backHref} tenant={tenant}><p role="alert" className="m-0 p-5 text-sm text-red-700">{loadError}</p></Shell>;
  if (!view) return <Shell backHref={backHref} tenant={tenant}><div role="status" aria-label="Loading reservation" className="grid min-h-40 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></div></Shell>;

  const closed = view.status === "CANCELLED" || view.status === "ENDED";
  const openBeforeLease = ["OFFERED", "ACCEPTED", "AWAITING_PAYMENT"].includes(view.status);
  const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:opacity-60 [font-family:inherit] cursor-pointer";
  const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const primary = `${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`;
  const homeHref = view.home?.key ? `/public/properties/${encodeURIComponent(view.home.key)}` : null;
  const compactActivity = tenant && !view.contactsShared;
  const Activity = compactActivity ? "details" : "div";
  const statusLabel = TENANCY_STATUS_LABEL[view.status] || view.status;

  return (
    <Shell backHref={backHref} tenant={tenant} heading={tenant ? (
      <header className="relative isolate overflow-hidden rounded-xl bg-[#0a1110] px-5 py-5 text-white sm:px-6">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#5ec8bb]"><House className="size-3.5" aria-hidden />Long-stay booking</p>
            <h1 className="m-0 mt-1 break-words text-[clamp(1.35rem,4vw,1.75rem)] font-bold leading-tight text-white">{view.home?.title || "Long stay"}</h1>
            {view.home?.area && <p className="m-0 mt-1.5 flex items-center gap-1.5 text-sm text-white/75"><MapPin className="size-3.5 shrink-0 text-[#5ec8bb]" aria-hidden />{view.home.area}</p>}
          </div>
          <span className={`rounded px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${closed ? "bg-white/10 text-white/80 ring-white/20" : view.status === "OFFERED" || view.status === "AWAITING_PAYMENT" ? "bg-amber-200/15 text-amber-100 ring-amber-200/30" : "bg-emerald-200/15 text-emerald-100 ring-emerald-200/30"}`}>{statusLabel}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-white/15 pt-3">
          <p className="m-0 text-xs text-white/70">Reservation <span className="ml-1 font-mono font-semibold text-white">{view.ref}</span></p>
          {homeHref && <Link href={homeHref} className="inline-flex min-h-8 items-center rounded-md border border-solid border-white/20 bg-white/5 px-2.5 text-xs font-semibold text-white no-underline hover:bg-white/10 hover:no-underline">View property</Link>}
        </div>
      </header>
    ) : undefined}>
      {!tenant && <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="m-0 truncate text-[17px] font-bold text-slate-900">{view.home?.title || "Long stay"}</p>
          <p className="m-0 mt-0.5 text-[13px] text-slate-500">{view.home?.area}{view.otherParty.name ? `${view.home?.area ? " · " : ""}Tenant: ${view.otherParty.name}` : ""}</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${closed ? "bg-slate-100 text-slate-600" : ["RESERVED", "MOVE_IN", "ACTIVE"].includes(view.status) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {statusLabel}
        </span>
      </div>}

      {cardReturn && side === "TENANT" ? (
        <p className={`m-0 border-0 border-t border-solid border-slate-100 px-5 py-2.5 text-[13px] ${view.status === "RESERVED" || cardReturn === "success" ? "bg-emerald-50 text-emerald-900" : cardReturn === "failed" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
          {view.status === "RESERVED" ? "Payment received. The home is reserved for you."
            : cardReturn === "failed" ? "The card payment did not go through. You can try again before the deadline."
            : "We are confirming your payment with the bank. This page updates once it is confirmed."}
        </p>
      ) : null}
      <OfferLeasePanel side={side} view={view} base={base} onChanged={load} />

      {/* Contact */}
      <div className="border-0 border-t border-solid border-slate-100 px-5 py-3 text-[13px]">
        {tenant && view.contactsShared ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 font-semibold text-slate-900">{view.otherParty.name || "Landlord"}</p>
            {view.otherParty.phone && <a href={`tel:${view.otherParty.phone}`} className="inline-flex items-center gap-2 font-semibold text-[#02665e] no-underline"><Phone className="size-4" aria-hidden />{view.otherParty.phone}</a>}
          </div>
        ) : view.contactsShared && view.otherParty.phone ? (
          <a href={`tel:${view.otherParty.phone}`} className="inline-flex items-center gap-2 font-semibold text-[#02665e] no-underline"><Phone className="h-4 w-4" />{view.otherParty.phone}</a>
        ) : tenant ? (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="m-0 flex items-start gap-2 text-slate-600"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />NoLSAF handles questions until the first month is paid.</p>
            {tenant && homeHref && <Link href={homeHref} className="rounded-md border border-solid border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#02665e] no-underline hover:bg-slate-50 hover:no-underline">Ask from the listing</Link>}
          </div>
        ) : <p className="m-0 flex items-start gap-2 text-slate-500"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Names, phone numbers and messages open once the first month is paid. Until then NoLSAF is your contact: ask from the home&apos;s page.</p>}
      </div>

      {/* Messages */}
      {view.events.length || view.contactsShared ? <Activity className="group border-0 border-t border-solid border-slate-100 px-5 py-3">
        {compactActivity && <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">Reservation activity <ChevronDown className="size-4 group-open:rotate-180" aria-hidden /></summary>}
        <ol className={`m-0 list-none space-y-2.5 p-0 ${compactActivity ? "mt-3" : ""}`}>
          {view.events.map((event, index) => (
            event.type === "MESSAGE" ? (
              <li key={index} className={`flex ${event.by === "YOU" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${event.by === "YOU" ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-800"}`}>
                  <p className="m-0 whitespace-pre-wrap break-words">{event.text}</p>
                  <p className={`m-0 mt-1 text-[11px] ${event.by === "YOU" ? "text-white/70" : "text-slate-500"}`}>{eatDateTime(event.at)}{event.masked ? " · contact details hidden" : ""}</p>
                </div>
              </li>
            ) : (
              <li key={index} className="text-center text-[12px] text-slate-400">
                {EVENT_LABEL[event.type] ?? ""}{event.by === "YOU" && event.type === "CONDITION_PHOTOS" ? " by you" : ""} · {eatDateTime(event.at)}
                {event.photos?.length ? (
                  <span className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                    {event.photos.map((src) => (
                      <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block h-14 w-14 overflow-hidden rounded-md border border-solid border-slate-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="Condition photo" className="h-full w-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </span>
                ) : null}
              </li>
            )
          ))}
        </ol>

        {!closed && view.contactsShared ? (
          <div className="mt-3 flex gap-2">
            <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={2} placeholder="Write a message"
              className="min-h-11 flex-1 resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
            <button type="button" disabled={!text.trim() || busy === "message"} onClick={send} aria-label="Send message" className={`${primary} h-11 w-11 px-0`}>
              {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        ) : null}
      </Activity> : null}
      {view.status === "CANCELLED" && view.cancelReason ? <p className="mx-5 my-3 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">Closed: {view.cancelReason}</p> : null}

      {/* Close */}
      {openBeforeLease ? (
        <div className="border-0 border-t border-solid border-slate-100 px-5 py-3">
          {closing ? (
            <div>
              <label htmlFor="close-reason" className="block text-xs font-semibold text-slate-700">{side === "TENANT" ? "Why are you withdrawing?" : "Why are you declining? (the tenant sees this)"}</label>
              <input id="close-reason" value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} maxLength={300} autoFocus
                className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy === "close"} onClick={close} className={`${btn} border-0 bg-red-600 text-white hover:bg-red-700`}>{side === "TENANT" ? "Withdraw" : "Decline"}</button>
                <button type="button" onClick={() => { setClosing(false); setReason(""); setError(""); }} className={outline}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setClosing(true)} className={tenant ? `${btn} border border-solid border-rose-200 bg-white text-rose-800 hover:bg-rose-50` : "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-semibold text-red-700 hover:underline [font-family:inherit]"}>
              <XCircle className="h-4 w-4" />{side === "TENANT" ? "Withdraw this reservation" : "Decline this reservation"}
            </button>
          )}
        </div>
      ) : null}
      {error ? <p className="m-0 px-5 pb-4 text-[13px] text-red-700">{error}</p> : null}
    </Shell>
  );
}

function Shell({ backHref, tenant, heading, children }: { backHref: string; tenant: boolean; heading?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div id="tenancy-detail" className={`w-full py-2 ${tenant ? "mx-auto max-w-5xl" : ""}`}>
      <style>{`#tenancy-detail, #tenancy-detail * { box-sizing: border-box; }`}</style>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 no-underline hover:text-[#02665e]"><ArrowLeft className="h-4 w-4" aria-hidden />{tenant ? "My bookings · Long stays" : "All long stays"}</Link>
      {heading}
      <section className={`overflow-hidden rounded-lg border border-solid border-slate-200 bg-white ${heading ? "mt-3" : ""} ${tenant ? "" : "max-w-2xl"}`}>{children}</section>
    </div>
  );
}
