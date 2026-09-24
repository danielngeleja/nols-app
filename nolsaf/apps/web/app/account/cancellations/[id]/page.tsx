"use client";

import { useEffect, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  CalendarX2,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Hash,
  MapPin,
  MessageSquareReply,
  Send,
  User,
  XCircle,
} from "lucide-react";
import LayoutFrame from "@/components/LayoutFrame";
import LogoSpinner from "@/components/LogoSpinner";

const api = apiClient;

type Msg = { id: number; senderId: number; senderRole: string; body: string; createdAt: string };
type Item = {
  id: number;
  status: string;
  bookingCode: string;
  reason: string | null;
  decisionNote: string | null;
  policyEligible: boolean;
  policyRefundPercent: number | null;
  policyRule: string | null;
  refundAmount: number | null;
  refundProvider: string | null;
  refundReference: string | null;
  refundInitiatedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
  booking: {
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    status: string;
    guestName?: string | null;
    guestPhone?: string | null;
    roomCode?: string | null;
    property: {
      title: string;
      type?: string | null;
      regionName?: string | null;
      city?: string | null;
      district?: string | null;
      ward?: string | null;
      country?: string | null;
    };
  };
  messages: Msg[];
};

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const stamp = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const tzs = (n: number) => `TZS ${Math.round(Number(n || 0)).toLocaleString("en-US")}`;

/** Plain words for each status, plus what the customer should expect next. */
const STATUS: Record<string, { label: string; tone: string; next: string }> = {
  SUBMITTED: { label: "Submitted", tone: "bg-sky-500/15 text-sky-200 ring-sky-400/30", next: "The team will pick this up shortly. You do not need to do anything yet." },
  REVIEWING: { label: "In review", tone: "bg-amber-500/15 text-amber-200 ring-amber-400/30", next: "The team is checking your booking against the policy. Replies appear below." },
  NEED_INFO: { label: "Needs your reply", tone: "bg-orange-500/15 text-orange-200 ring-orange-400/30", next: "The team asked for more information. Reply below to keep your claim moving." },
  APPROVED: { label: "Approved", tone: "bg-teal-500/15 text-teal-200 ring-teal-400/30", next: "Your cancellation is approved. The refund will be sent to the way you paid." },
  REFUND_PENDING: { label: "Refund on the way", tone: "bg-indigo-500/15 text-indigo-200 ring-indigo-400/30", next: "The refund has been sent. Banks and wallets usually take 5 to 10 business days." },
  REFUNDED: { label: "Refunded", tone: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30", next: "The refund is complete. This claim is closed." },
  REJECTED: { label: "Declined", tone: "bg-rose-500/15 text-rose-200 ring-rose-400/30", next: "This claim was declined. The team's note explains why." },
};

/** Where each status sits on the journey (Declined ends it at the review step). */
const JOURNEY = ["Submitted", "In review", "Approved", "Refund sent", "Refunded"];
const STAGE: Record<string, number> = { SUBMITTED: 0, REVIEWING: 1, NEED_INFO: 1, APPROVED: 2, REFUND_PENDING: 3, REFUNDED: 4, REJECTED: 1 };

export default function CustomerCancellationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id ?? "");

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  // Kept apart: a failed send must not replace the whole page with an error
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/api/customer/cancellations/${id}`);
      setItem(res.data.item);
    } catch (e: any) {
      if (!quiet) setLoadError(e?.response?.data?.error || "Failed to load cancellation request");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    if (!item) return;
    const body = message.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/api/customer/cancellations/${item.id}/messages`, { body });
      setMessage("");
      await load(true);
      window.requestAnimationFrame(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (e: any) {
      setSendError(e?.response?.data?.error || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  const backLink = (
    <Link href="/account/cancellations" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/60 no-underline transition-colors hover:text-white">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Cancellations
    </Link>
  );

  if (loading) {
    return (
      <div id="claim-page" className="w-full space-y-4" aria-busy="true">
        <LayoutFrame />
        <div className="rounded-2xl bg-[#0a1110] px-5 py-6 sm:px-6">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-3 h-7 w-56 rounded-lg bg-white/15" />
          <div className="mt-2 h-3 w-72 max-w-full rounded bg-white/10" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-72 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
          <div className="h-72 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
        </div>
        <span role="status" className="sr-only">
          <LogoSpinner size="xs" ariaLabel="Loading cancellation claim" />
        </span>
      </div>
    );
  }

  if (loadError || !item) {
    return (
      <div className="w-full space-y-4">
        <LayoutFrame />
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">{backLink}</div>
        <div className="flex items-start gap-3 rounded-2xl border border-solid border-rose-200 bg-white p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" aria-hidden />
          <div>
            <div className="text-[14px] font-bold text-slate-900">This claim could not be opened</div>
            <div className="mt-0.5 text-[13px] text-slate-600">{loadError || "It may have been removed, or it belongs to another account."}</div>
          </div>
        </div>
      </div>
    );
  }

  const status = String(item.status || "").toUpperCase();
  const meta = STATUS[status] || { label: status.replace(/_/g, " ").toLowerCase(), tone: "bg-white/10 text-white ring-white/20", next: "" };
  const stage = STAGE[status] ?? 0;
  const declined = status === "REJECTED";
  const closed = status === "REFUNDED" || declined;
  const needsReply = status === "NEED_INFO";
  const p = item.booking.property;
  const place = [p.ward, p.district, p.city, p.regionName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  const pct = item.policyRefundPercent;
  const expected = item.refundAmount != null ? Number(item.refundAmount) : typeof pct === "number" ? (Number(item.booking.totalAmount || 0) * pct) / 100 : null;
  const messages = [...(item.messages || [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div id="claim-page" className="w-full min-w-0 space-y-4">
      <style>{`#claim-page, #claim-page * { box-sizing: border-box; }`}</style>
      <LayoutFrame />

      {/* ── Header band: claim, status and what happens next ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(190,18,60,0.42), rgba(190,18,60,0))" }} />
        <div className="px-5 pb-5 pt-5 sm:px-6">
          {backLink}
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[26px] font-bold leading-tight text-white">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/30">
                  <CalendarX2 className="h-5 w-5" aria-hidden />
                </span>
                Claim #{item.id}
                <span className={`ml-3 inline-flex translate-y-[-3px] items-center rounded-full px-2.5 py-1 align-middle text-[12px] font-bold ring-1 ${meta.tone}`}>{meta.label}</span>
              </h1>
              <p className="m-0 mt-1 truncate text-[13.5px] text-white/60">
                {p.title} · <span className="font-mono">{item.bookingCode}</span> · sent {day(item.createdAt)}
              </p>
            </div>
          </div>

          {/* Journey: where the claim is now */}
          <ol className="m-0 mt-5 grid list-none grid-cols-5 gap-1.5 p-0" aria-label={`Progress: ${meta.label}`}>
            {JOURNEY.map((label, i) => {
              const reached = declined ? i <= 1 : i <= stage;
              const current = i === stage;
              const endsHere = declined && i === 1;
              return (
                <li key={label} className="min-w-0">
                  <span
                    className={`block h-1.5 rounded-full ${endsHere ? "bg-rose-400" : reached ? "bg-[#3ab8af]" : "bg-white/10"}`}
                    aria-hidden
                  />
                  <span className={`mt-1.5 hidden truncate text-[11px] sm:block ${current ? "font-bold text-white" : reached ? "text-white/60" : "text-white/35"}`}>
                    {endsHere ? "Declined" : label}
                  </span>
                </li>
              );
            })}
          </ol>
          {meta.next ? <p className="m-0 mt-3 text-[13px] text-white/70">{meta.next}</p> : null}
        </div>
      </div>

      {needsReply ? (
        <div className="flex items-start gap-3 rounded-2xl border border-solid border-orange-200 bg-orange-50 p-4">
          <MessageSquareReply className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-orange-950">The team is waiting for you</div>
            <div className="mt-0.5 text-[12.5px] text-orange-800">Read their last message and reply below to keep your claim moving.</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* ── Conversation ── */}
        <div className="flex min-w-0 flex-col rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
            <h2 className="m-0 text-[15px] font-bold text-slate-900">Conversation</h2>
            <span className="text-[12px] text-slate-500">With the NoLSAF team</span>
          </div>

          <div className="space-y-4 px-5 py-5">
            {/* The request itself opens the thread */}
            {item.reason ? (
              <div className="flex justify-end">
                <div className="max-w-[88%] sm:max-w-[78%]">
                  <div className="mb-1 flex items-center justify-end gap-2 text-[11.5px] text-slate-400">
                    <span className="font-semibold text-slate-500">Your request</span>
                    <span>{stamp(item.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[#02665e] px-4 py-3 text-[13.5px] leading-relaxed text-white">{item.reason}</div>
                </div>
              </div>
            ) : null}

            {messages.map((m) => {
              const fromTeam = String(m.senderRole || "").toUpperCase() === "ADMIN";
              return (
                <div key={m.id} className={`flex ${fromTeam ? "justify-start" : "justify-end"}`}>
                  <div className="max-w-[88%] sm:max-w-[78%]">
                    <div className={`mb-1 flex items-center gap-2 text-[11.5px] text-slate-400 ${fromTeam ? "" : "justify-end"}`}>
                      <span className={`font-semibold ${fromTeam ? "text-slate-700" : "text-slate-500"}`}>{fromTeam ? "NoLSAF team" : "You"}</span>
                      <span>{stamp(m.createdAt)}</span>
                    </div>
                    <div
                      className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${
                        fromTeam ? "rounded-tl-md bg-slate-100 text-slate-800" : "rounded-tr-md bg-[#02665e] text-white"
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* The team's decision, kept visible as the last word */}
            {item.decisionNote ? (
              <div className={`rounded-xl p-4 ring-1 ${declined ? "bg-rose-50 ring-rose-200" : "bg-[#02665e]/[0.05] ring-[#02665e]/20"}`}>
                <div className={`flex items-center gap-1.5 text-[12px] font-bold ${declined ? "text-rose-800" : "text-[#02665e]"}`}>
                  {declined ? <XCircle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                  Decision from the NoLSAF team
                </div>
                <p className="m-0 mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">{item.decisionNote}</p>
              </div>
            ) : null}

            {!item.reason && messages.length === 0 && !item.decisionNote ? (
              <div className="py-8 text-center text-[13px] text-slate-500">No messages yet. Anything you add below goes straight to the team.</div>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          {/* Composer */}
          <div className="border-0 border-t border-solid border-slate-100 p-4">
            {closed ? (
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-600 ring-1 ring-slate-200">
                <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />
                This claim is closed. The conversation stays here for your records.
              </div>
            ) : (
              <div>
                <div className="rounded-xl border border-solid border-slate-300 bg-white transition-[border-color,box-shadow] focus-within:border-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]">
                  <label htmlFor="claim-reply" className="sr-only">Reply to the team</label>
                  <textarea
                    id="claim-reply"
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      if (sendError) setSendError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={3}
                    placeholder={needsReply ? "Answer the team's question here..." : "Add information or ask the team a question..."}
                    className="block w-full resize-none rounded-xl border-0 bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  />
                  <div className="flex items-center justify-between gap-2 px-3 pb-3">
                    <span className="hidden text-[11.5px] text-slate-400 sm:inline">Ctrl + Enter to send</span>
                    <button
                      type="button"
                      onClick={send}
                      disabled={sending || !message.trim()}
                      className="ml-auto inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {sending ? <LogoSpinner size="xs" className="h-4 w-4" ariaLabel="Sending" /> : <Send className="h-4 w-4" aria-hidden />}
                      Send
                    </button>
                  </div>
                </div>
                {sendError ? <div className="mt-2 text-[12.5px] font-medium text-rose-600">{sendError}</div> : null}
              </div>
            )}
          </div>
        </div>

        {/* ── Side: the money, then the booking ── */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h2 className="m-0 text-[14.5px] font-bold text-slate-900">Refund</h2>
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-slate-500">
                {status === "REFUNDED" ? "Refunded" : item.refundAmount != null ? "Approved amount" : declined ? "Refund" : "Expected under the policy"}
              </div>
              <div className={`mt-0.5 text-[24px] font-extrabold leading-tight tabular-nums ${declined ? "text-slate-400" : "text-[#02665e]"}`}>
                {declined ? "None" : expected != null ? tzs(expected) : "To be confirmed"}
              </div>
              <div className="mt-0.5 text-[12px] text-slate-500">
                {typeof pct === "number" ? `${pct}% of ${tzs(item.booking.totalAmount)}` : `Booking total ${tzs(item.booking.totalAmount)}`}
                {!item.policyEligible && !declined ? " · outside the refund windows, reviewed by the team" : ""}
              </div>
            </div>

            <dl className="m-0 mt-4 space-y-2 border-0 border-t border-solid border-slate-100 pt-3 text-[12.5px]">
              {[
                { label: "Sent through", value: item.refundProvider || (status === "APPROVED" ? "Being arranged" : "Not yet") },
                { label: "Reference", value: item.refundReference || "Shown once sent", mono: Boolean(item.refundReference) },
                { label: "Sent on", value: item.refundInitiatedAt ? day(item.refundInitiatedAt) : "Not yet" },
                { label: "Completed", value: item.refundedAt ? day(item.refundedAt) : "Not yet" },
              ].map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className={`m-0 min-w-0 break-all text-right font-semibold text-slate-800 ${row.mono ? "font-mono" : ""}`}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h2 className="m-0 text-[14.5px] font-bold text-slate-900">Booking</h2>
            <div className="mt-3 text-[14px] font-semibold text-slate-900">{p.title}</div>
            {place || p.type ? (
              <div className="mt-0.5 flex items-start gap-1.5 text-[12.5px] text-slate-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                <span>{[p.type, place].filter(Boolean).join(" · ")}</span>
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <div className="text-[11px] text-slate-500">Check-in</div>
                <div className="text-[13px] font-bold text-slate-900">{day(item.booking.checkIn)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <div className="text-[11px] text-slate-500">Check-out</div>
                <div className="text-[13px] font-bold text-slate-900">{day(item.booking.checkOut)}</div>
              </div>
            </div>
            <dl className="m-0 mt-3 space-y-2 text-[12.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-slate-500"><Hash className="h-3.5 w-3.5" aria-hidden />Booking code</dt>
                <dd className="m-0 font-mono font-semibold text-slate-800">{item.bookingCode}</dd>
              </div>
              {item.booking.guestName ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="inline-flex items-center gap-1.5 text-slate-500"><User className="h-3.5 w-3.5" aria-hidden />Guest</dt>
                  <dd className="m-0 truncate font-semibold text-slate-800">{item.booking.guestName}</dd>
                </div>
              ) : null}
              {item.booking.roomCode ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="inline-flex items-center gap-1.5 text-slate-500"><BedDouble className="h-3.5 w-3.5" aria-hidden />Room</dt>
                  <dd className="m-0 truncate font-semibold text-slate-800">{item.booking.roomCode}</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-2">
                <dt className="text-slate-500">Paid</dt>
                <dd className="m-0 font-bold tabular-nums text-slate-900">{tzs(item.booking.totalAmount)}</dd>
              </div>
            </dl>
          </div>

          <div className="flex items-start gap-2.5 px-1 text-[12px] text-slate-500">
            {closed ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden /> : <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />}
            <span>
              Last updated {stamp(item.updatedAt)}. Questions about the policy?{" "}
              <Link href="/cancellation-policy" className="font-semibold text-[#02665e] no-underline hover:underline">Read it here</Link>.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
