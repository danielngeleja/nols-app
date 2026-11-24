"use client";

/**
 * One long stay, as the tenant or the landlord sees it (docs/LONG_STAY_RENTALS.md).
 * NoLSAF is the bridge until the booking is paid: names, phone numbers and
 * messages open only then. The server decides every status change; this page
 * only asks.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CheckCircle2, ChevronDown, House, Loader2, Lock, MapPin, MessageCircle, Phone, ReceiptText, Send, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import OfferLeasePanel, { type OfferLeaseView } from "./OfferLeasePanel";

type Side = "TENANT" | "LANDLORD";
type View = OfferLeaseView & {
  ref: string;
  status: string;
  home: { title: string; key: string; area: string; terms?: { minTermMonths: number; maxTermMonths: number | null; availableFrom: string } | null } | null;
  otherParty: { name: string | null; phone: string | null };
  contactsShared: boolean;
  receiptAmount?: number | null;
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
  const waitingForCard = (cardReturn === "success" || cardReturn === "pending") && view?.status === "AWAITING_PAYMENT";
  useEffect(() => {
    if (!waitingForCard) return;
    let checks = 0;
    const timer = window.setInterval(() => {
      void load();
      if (++checks === 12) window.clearInterval(timer);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [load, waitingForCard]);

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
  const ownerReviewsOffer = !tenant && view.status === "OFFERED" && Boolean(view.offer);
  const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:opacity-60 [font-family:inherit] cursor-pointer";
  const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
  const primary = `${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`;
  const homeHref = view.home?.key ? `/public/properties/${encodeURIComponent(view.home.key)}` : null;
  const receiptHref = tenant && view.receiptAmount != null ? `/account/bookings/long-stays/${encodeURIComponent(view.ref)}/receipt` : null;
  const paidWorkspace = tenant && Boolean(receiptHref || view.contactsShared);
  const compactActivity = tenant && !view.contactsShared;
  const Activity = compactActivity ? "details" : "div";
  const statusLabel = TENANCY_STATUS_LABEL[view.status] || view.status;
  const statusTone = closed ? "bg-slate-100 text-slate-700"
    : ["OVERDUE", "DISPUTED"].includes(view.status) ? "bg-rose-50 text-rose-800"
    : ["OFFERED", "AWAITING_PAYMENT", "ENDING"].includes(view.status) ? "bg-amber-50 text-amber-900"
    : "bg-[#e9f4f0] text-[#215b50]";

  const { events, contactsShared } = view;
  const history = events.filter((event) => event.type !== "MESSAGE");
  const contactPanel = (
    <div className={paidWorkspace ? "rounded-lg border border-solid border-[#d9e7e2] bg-white p-4" : "border-0 border-t border-solid border-slate-100 px-5 py-3 text-[13px]"}>
      {tenant && view.contactsShared ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><p className="m-0 text-xs font-semibold text-slate-600">Your landlord</p><p className="m-0 mt-0.5 break-words text-sm font-bold text-slate-900">{view.otherParty.name || "Landlord"}</p></div>
          {view.otherParty.phone && <a href={`tel:${view.otherParty.phone}`} className="inline-flex items-center gap-2 font-semibold text-[#02665e] no-underline"><Phone className="size-4" aria-hidden />{view.otherParty.phone}</a>}
        </div>
      ) : view.contactsShared && view.otherParty.phone ? (
        <a href={`tel:${view.otherParty.phone}`} className="inline-flex items-center gap-2 font-semibold text-[#02665e] no-underline"><Phone className="h-4 w-4" />{view.otherParty.phone}</a>
      ) : ownerReviewsOffer ? (
        <p className="m-0 flex items-start gap-2 text-slate-600"><Lock className="mt-0.5 size-3.5 shrink-0 text-[#02665e]" aria-hidden />Tenant contact details and messaging open after the first payment.</p>
      ) : tenant ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 flex items-center gap-2 text-slate-600"><Lock className="size-3.5 shrink-0 text-[#02665e]" aria-hidden />NoLSAF handles questions until the first month is paid.</p>
          {homeHref && <Link href={`${homeHref}#booking-card`} className="inline-flex items-center gap-1 rounded-md border border-solid border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#02665e] no-underline hover:bg-slate-50 hover:no-underline">Ask from the listing <ArrowUpRight className="size-3.5" aria-hidden /></Link>}
        </div>
      ) : <p className="m-0 flex items-start gap-2 text-slate-500"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Names, phone numbers and messages open once the first month is paid. Until then NoLSAF is your contact: ask from the home&apos;s page.</p>}
    </div>
  );

  function renderHistoryEvent(event: View["events"][number], index: number) {
    return (
      <li key={index} className="relative min-w-0 pb-1 pl-4 before:absolute before:left-0 before:top-1.5 before:size-1.5 before:rounded-full before:bg-[#548d81]">
        <p className="m-0 text-sm font-semibold text-slate-800">{EVENT_LABEL[event.type] || event.type.replace(/_/g, " ").toLowerCase()}{event.by === "YOU" && event.type === "CONDITION_PHOTOS" ? " by you" : ""}</p>
        <time dateTime={event.at} className="block text-xs text-slate-600">{eatDateTime(event.at)}</time>
        {event.photos?.length ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {event.photos.map((src) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block h-14 w-14 overflow-hidden rounded-md border border-solid border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="Condition photo" className="h-full w-full object-cover" loading="lazy" />
              </a>
            ))}
          </span>
        ) : null}
      </li>
    );
  }

  function messagesPanel(messagesOnly: boolean) {
    const visibleEvents = messagesOnly ? events.filter((event) => event.type === "MESSAGE") : events;
    return (
      <Activity className={messagesOnly ? "p-4" : "group border-0 border-t border-solid border-slate-100 px-5 py-3"}>
        {compactActivity && <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">Reservation activity <ChevronDown className="size-4 group-open:rotate-180" aria-hidden /></summary>}
        {messagesOnly && visibleEvents.length === 0 && <p className="m-0 text-sm text-slate-600">No messages yet.</p>}
        {visibleEvents.length > 0 && <ol className={`m-0 list-none space-y-3 p-0 ${compactActivity ? "mt-3" : ""}`}>
          {visibleEvents.map((event, index) => event.type === "MESSAGE" ? (
            <li key={index} className={`flex ${event.by === "YOU" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${event.by === "YOU" ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-800"}`}>
                <p className="m-0 whitespace-pre-wrap break-words">{event.text}</p>
                <p className={`m-0 mt-1 text-[11px] ${event.by === "YOU" ? "text-white/70" : "text-slate-500"}`}>{eatDateTime(event.at)}{event.masked ? " · contact details hidden" : ""}</p>
              </div>
            </li>
          ) : renderHistoryEvent(event, index))}
        </ol>}
        {!closed && contactsShared ? (
          <div className="mt-3 flex gap-2">
            <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={2} aria-label="Message to send" placeholder="Write a message"
              className="min-h-11 min-w-0 flex-1 resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
            <button type="button" disabled={!text.trim() || busy === "message"} onClick={send} aria-label="Send message" className={`${primary} h-11 w-11 shrink-0 px-0`}>
              {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        ) : null}
      </Activity>
    );
  }

  return (
    <Shell backHref={backHref} tenant={tenant} workspace={paidWorkspace} heading={tenant ? (
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-solid border-[#cfe2da] bg-[#eaf4ef] px-4 py-4 sm:px-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#02665e] text-white"><House className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="m-0 break-words text-[clamp(1.125rem,3vw,1.5rem)] font-bold leading-tight tracking-tight text-slate-950">{view.home?.title || "Long stay"}</h1>
            {(view.status !== "OFFERED" || !view.offer) && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusTone}`}>{statusLabel}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
            {view.home?.area && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 shrink-0 text-[#02665e]" aria-hidden />{view.home.area}</span>}
            <span className="min-w-0">Ref <span className="font-mono font-medium text-slate-800 [overflow-wrap:anywhere]">{view.ref}</span></span>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {homeHref && <Link href={homeHref} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-solid border-[#c5ded4] bg-white px-3 text-sm font-semibold text-[#215b50] no-underline hover:bg-[#f8fbfa] hover:no-underline">View property <ArrowUpRight className="size-3.5" aria-hidden /></Link>}
          {receiptHref && <Link href={receiptHref} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#02665e] px-3 text-sm font-semibold text-white no-underline hover:bg-[#014e47] hover:text-white hover:no-underline"><ReceiptText className="size-4" aria-hidden />View receipt</Link>}
        </div>
      </header>
    ) : undefined}>
      {!tenant && <header className="flex flex-wrap items-center gap-3 bg-[#eaf4ef] px-4 py-4 sm:px-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[#02665e] text-white"><House className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 basis-44">
          <h1 className="m-0 break-words text-xl font-bold tracking-tight text-slate-950">{view.home?.title || "Long stay"}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
            {view.home?.area && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 shrink-0 text-[#02665e]" aria-hidden />{view.home.area}</span>}
            {view.otherParty.name && <span>Tenant {view.otherParty.name}</span>}
          </div>
        </div>
        <span className={`shrink-0 rounded px-2.5 py-1 text-xs font-semibold ${statusTone}`}>{view.status === "OFFERED" ? "Your response needed" : statusLabel}</span>
      </header>}

      {paidWorkspace ? (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,32%)]">
          <div className="min-w-0 space-y-4">
            <section aria-label="Stay details" className="rounded-lg border border-solid border-[#d9e7e2] bg-white">
              <OfferLeasePanel side={side} view={view} base={base} onChanged={load} />
              {view.cancelReason && view.status === "CANCELLED" && <p className="m-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700">Closed: {view.cancelReason}</p>}
            </section>
            {view.contactsShared && <div className="rounded-lg border border-solid border-[#d9e7e2] bg-white">
              <h2 className="m-0 flex items-center gap-2 bg-[#f4f8f6] px-4 py-3.5 text-base font-bold text-slate-950"><MessageCircle className="size-4 text-[#02665e]" aria-hidden />Messages with your landlord</h2>
              {messagesPanel(true)}
            </div>}
          </div>
          <aside aria-label="Payment and booking activity" className="min-w-0 space-y-4">
            {receiptHref && view.money && view.receiptAmount != null && <section aria-label="NoLSAF payment" className="rounded-lg border border-solid border-[#d9e7e2] bg-white p-4 sm:p-5">
              <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-[#215b50]"><CheckCircle2 className="size-4" aria-hidden />Paid to NoLSAF</h2>
              <p className="m-0 mt-2 text-2xl font-bold tracking-tight text-slate-950">{view.money.currency} {view.receiptAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
              <p className="m-0 mt-1 text-sm text-slate-700">First month’s rent and service fee</p>
              {view.paidAt && <p className="m-0 mt-2 text-xs text-slate-600">{eatDateTime(view.paidAt)}</p>}
            </section>}
            {view.contactsShared && contactPanel}
            {history.length > 0 && <details className="group rounded-lg border border-solid border-[#d9e7e2] bg-white">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">Booking activity <ChevronDown className="size-4 text-[#02665e] group-open:rotate-180" aria-hidden /></summary>
              <ol className="m-0 list-none space-y-3 px-4 pb-4">{history.map(renderHistoryEvent)}</ol>
            </details>}
          </aside>
        </div>
      ) : (
        <>
          {cardReturn && tenant && view.status === "AWAITING_PAYMENT" ? (
            <p role="status" className={`m-0 border-0 border-t border-solid border-slate-100 px-5 py-2.5 text-[13px] ${cardReturn === "failed" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
              {cardReturn === "failed" ? "The card payment did not go through. You can try again before the deadline."
                : "We’re waiting for your bank to confirm the payment. Your receipt appears after confirmation."}
            </p>
          ) : null}
          <OfferLeasePanel side={side} view={view} base={base} onChanged={load} />

          {contactPanel}
          {(view.events.length > 0 || view.contactsShared) && messagesPanel(false)}
          {view.status === "CANCELLED" && view.cancelReason ? <p className="mx-5 my-3 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">Closed: {view.cancelReason}</p> : null}

          {/* Close */}
          {openBeforeLease && !ownerReviewsOffer ? (
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
                <button type="button" onClick={() => setClosing(true)} className={tenant ? `${btn} border-0 bg-transparent px-0 text-rose-800 hover:text-rose-950` : "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-semibold text-red-700 hover:underline [font-family:inherit]"}>
                  <XCircle className="h-4 w-4" />{side === "TENANT" ? "Withdraw this reservation" : "Decline this reservation"}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="m-0 px-5 pb-4 text-[13px] text-red-700">{error}</p> : null}
    </Shell>
  );
}

function Shell({ backHref, tenant, workspace = false, heading, children }: { backHref: string; tenant: boolean; workspace?: boolean; heading?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div id="tenancy-detail" className={tenant ? "w-full min-w-0 pb-6 pt-2" : "mx-auto w-full max-w-5xl pb-6 pt-2"}>
      <style>{`#tenancy-detail, #tenancy-detail * { box-sizing: border-box; }`}</style>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 no-underline hover:text-[#02665e]"><ArrowLeft className="h-4 w-4" aria-hidden />{tenant ? "My bookings · Long stays" : "All long stays"}</Link>
      {heading}
      {workspace ? <div className="mt-4">{children}</div> : <section className={`overflow-hidden rounded-lg border border-solid bg-white ${heading ? "mt-3 border-[#d9e7e2]" : "border-slate-200"}`}>{children}</section>}
    </div>
  );
}
