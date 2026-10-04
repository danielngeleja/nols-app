"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  Phone,
  ScanLine,
  ShieldCheck,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

/**
 * Admin help for owners: look up a guest's check-in code, see the booking
 * behind it, and confirm the check-in on the owner's behalf when the stay
 * window allows. The server rechecks every rule on confirm
 * (routes/admin.helpOwners.ts); this screen only explains them.
 */

type Details = {
  bookingReference: string;
  code: string;
  generatedAt: string;
  usedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  validatedBy: { kind: "ADMIN" | "OWNER"; name: string | null } | null;
  property: { title: string | null; type: string | null; location: string | null };
  owner: { id: number; name: string | null; email: string | null; phone: string | null; removed: boolean } | null;
  guest: { name: string | null; phone: string | null };
  booking: { status: string; roomCode: string | null; nights: number; checkIn: string; checkOut: string; totalAmount: number; currency: string };
  cancellation: { status: string; reason: string | null; createdAt: string; policyRefundPercent: number | null; policyRule: string | null; decisionNote: string | null } | null;
};
type Lookup = { codeStatus: "ACTIVE" | "USED" | "VOID"; windowStatus?: string; canValidate: boolean; windowReason?: string | null; details: Details };
type State = "ready" | "used" | "void" | "early" | "late" | "blocked";

const TONES: Record<State, { label: string; pill: string; banner: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "Ready to check in", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", banner: "border-emerald-200 bg-emerald-50/70 text-emerald-900", icon: ShieldCheck },
  used: { label: "Already validated", pill: "bg-sky-50 text-sky-700 ring-sky-200", banner: "border-sky-200 bg-sky-50/70 text-sky-900", icon: CheckCheck },
  void: { label: "Voided", pill: "bg-rose-50 text-rose-700 ring-rose-200", banner: "border-rose-200 bg-rose-50/70 text-rose-900", icon: XCircle },
  early: { label: "Check-in not open", pill: "bg-amber-50 text-amber-800 ring-amber-200", banner: "border-amber-200 bg-amber-50/70 text-amber-900", icon: Clock3 },
  late: { label: "Stay has ended", pill: "bg-amber-50 text-amber-800 ring-amber-200", banner: "border-amber-200 bg-amber-50/70 text-amber-900", icon: AlertTriangle },
  blocked: { label: "Cannot check in", pill: "bg-neutral-100 text-neutral-700 ring-neutral-200", banner: "border-neutral-200 bg-neutral-50 text-neutral-800", icon: AlertTriangle },
};

const EAT = "Africa/Dar_es_Salaam";
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: EAT }) : "Not recorded");
const longDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: EAT }) : "the check-in date");
const stamp = (iso?: string | null) =>
  iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: EAT })} EAT` : "Not recorded";
const humanize = (v?: string | null) => {
  const s = String(v || "").replace(/_/g, " ").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

function stateOf(lookup: Lookup): State {
  if (lookup.codeStatus === "USED") return "used";
  if (lookup.codeStatus === "VOID") return "void";
  if (lookup.canValidate) return "ready";
  if (lookup.windowStatus === "BEFORE_CHECKIN") return "early";
  if (lookup.windowStatus === "AFTER_CHECKOUT") return "late";
  return "blocked";
}

/** What the admin is looking at, in one sentence. */
function summaryOf(state: State, lookup: Lookup) {
  const d = lookup.details;
  switch (state) {
    case "ready":
      return "The stay window is open. Confirm to check the guest in for the owner.";
    case "used":
      return `Validated ${stamp(d.usedAt)}${d.validatedBy?.kind === "ADMIN" ? ` by ${d.validatedBy.name} (NoLSAF) on the owner's behalf` : d.validatedBy?.kind === "OWNER" ? " by the owner" : ""}. No action is needed.`;
    case "void":
      return d.cancellation ? `The booking has a cancellation on record (${humanize(d.cancellation.status).toLowerCase()}). Do not check the guest in with this code.` : `This code was voided ${stamp(d.voidedAt)}${d.voidReason ? `: ${d.voidReason}` : "."}`;
    case "early":
      return `Check-in opens on ${longDay(d.booking.checkIn)}. The code can be validated from that day.`;
    case "late":
      return "The check-out date has passed, so the code can no longer be validated. If the guest did stay, review the booking.";
    default:
      return lookup.windowReason || "This booking cannot be checked in.";
  }
}

/** A ready-made reply to the owner for the current state. */
function suggestionFor(state: State, lookup: Lookup, confirmed: boolean) {
  const d = lookup.details;
  const first = (d.owner?.name || "there").split(" ")[0];
  const place = d.property.title ? ` at ${d.property.title}` : "";
  if (confirmed) {
    return { subject: "Guest check-in confirmed", message: `Hello ${first}, we validated code ${d.code} and confirmed the guest check-in${place} on your behalf. The booking is now checked in and no further action is needed.` };
  }
  switch (state) {
    case "used":
      return { subject: "This booking is already checked in", message: `Hello ${first}, code ${d.code} was already validated ${stamp(d.usedAt)}. The guest check-in is confirmed in the system and nothing more is needed. If you did not expect this, please reply to us.` };
    case "void":
      return { subject: "This check-in code is no longer valid", message: d.cancellation ? `Hello ${first}, code ${d.code} cannot be used because the booking${place} has a cancellation on record. Please do not check the guest in with it, and contact us if you need help.` : `Hello ${first}, code ${d.code} has been voided and can no longer be used for check-in. Contact us if you think this is a mistake.` };
    case "early":
      return { subject: "Check-in is not open yet", message: `Hello ${first}, code ${d.code} is valid, but the stay has not started. Check-in opens on ${longDay(d.booking.checkIn)}; please validate the code that day when the guest arrives.` };
    case "late":
      return { subject: "The check-out date has passed", message: `Hello ${first}, code ${d.code} could not be validated because the check-out date has passed. If the guest did stay, contact us so we can review the booking.` };
    default:
      return null;
  }
}

const sectionLabel = "m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400";
const fieldClass =
  "box-border w-full rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

export default function CheckinCodeCard() {
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ at: string; ownerNotified: boolean } | null>(null);

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const resetDialog = useCallback(() => {
    setConfirmError(null);
    setConfirmed(null);
    setNotifyOpen(false);
    setSubject("");
    setMessage("");
    setSendError(null);
    setSent(false);
  }, []);

  // Look the code up a moment after typing or pasting stops.
  useEffect(() => {
    const code = input.trim();
    if (!code) {
      setLookup(null);
      setLookupError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLooking(true);
      setLookupError(null);
      try {
        const res = await fetch("/api/admin/help-owners/validate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setLookup(null);
          setLookupError(json?.error || "Could not look up this code.");
          return;
        }
        resetDialog();
        setLookup(json);
        setOpen(true);
      } catch {
        if (!cancelled) setLookupError("Network error, could not reach the server.");
      } finally {
        if (!cancelled) setLooking(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, resetDialog]);

  const close = useCallback(() => {
    setOpen(false);
    if (confirmed) {
      setInput("");
      setLookup(null);
    }
  }, [confirmed]);

  const startOver = useCallback(() => {
    setOpen(false);
    setInput("");
    setLookup(null);
    resetDialog();
  }, [resetDialog]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !confirming && !sending) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirming, sending, close]);

  async function confirmCheckin() {
    if (!lookup) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch("/api/admin/help-owners/confirm-checkin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: lookup.details.code }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setConfirmError(json?.error || "Could not confirm the check-in.");
        return;
      }
      setConfirmed({ at: json.confirmedAt, ownerNotified: Boolean(json.ownerNotified) });
    } catch {
      setConfirmError("Network error, nothing was changed. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  async function sendMessage() {
    const ownerId = lookup?.details.owner?.id;
    if (!ownerId || !subject.trim() || !message.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/admin/owners/${ownerId}/notify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSendError(json?.error || "The message was not sent.");
        return;
      }
      setSent(true);
    } catch {
      setSendError("Network error, the message was not sent.");
    } finally {
      setSending(false);
    }
  }

  const state = lookup ? stateOf(lookup) : null;
  const tone = state ? TONES[state] : null;
  const d = lookup?.details;
  const suggestion = lookup && state ? suggestionFor(state, lookup, Boolean(confirmed)) : null;
  const owner = d?.owner ?? null;
  const canMessage = Boolean(owner && !owner.removed);

  return (
    <>
      {/* Lookup card */}
      <div className="min-w-0 space-y-3 p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste the booking code"
          aria-label="Booking check-in code"
          autoComplete="off"
          spellCheck={false}
          className="box-border h-11 w-full rounded-xl border border-solid border-neutral-300 bg-white px-4 text-center font-mono text-sm uppercase tracking-[0.18em] text-neutral-900 outline-none transition-colors placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
        />
        {looking && <p className="m-0 flex items-center gap-2 text-xs text-neutral-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up the code...</p>}
        {lookupError && !looking && (
          <div className="flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{lookupError}</span>
          </div>
        )}
        {lookup && !open && !looking && tone && (
          <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3 py-2.5 text-left hover:bg-neutral-50">
            <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone.pill}`}>{confirmed ? "Checked in" : tone.label}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-600">{d?.property.title || "Booking"}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-400" />
          </button>
        )}
        {!input && (
          <ul className="m-0 list-none space-y-1.5 p-0 text-[11px] text-neutral-500">
            <li className="flex gap-2"><CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" /> Shows the booking, guest and owner behind the code</li>
            <li className="flex gap-2"><CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" /> Confirms check-in only inside the stay window</li>
            <li className="flex gap-2"><CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" /> The owner gets a notice in their inbox</li>
          </ul>
        )}
      </div>

      {/* Dialog */}
      {open && lookup && d && tone && state && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Check-in code" onClick={() => !confirming && !sending && close()}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex shrink-0 items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><ScanLine className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-bold text-neutral-900">Check-in code</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tracking-[0.14em] text-neutral-800">{d.code}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${confirmed ? TONES.ready.pill : tone.pill}`}>{confirmed ? "Checked in" : tone.label}</span>
                </div>
              </div>
              <button type="button" onClick={close} disabled={confirming || sending} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {confirmed ? (
                <div className="flex items-start gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="m-0 font-semibold">Guest checked in {stamp(confirmed.at)}</p>
                    <p className="m-0 mt-0.5 text-xs text-emerald-800">
                      {confirmed.ownerNotified ? "The owner has a notice in their inbox." : owner?.removed ? "The owner account has been removed, so no notice was sent." : "The owner notice could not be delivered. Send them a message below."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className={`flex items-start gap-3 rounded-xl border border-solid px-4 py-3 text-sm ${tone.banner}`}>
                  <tone.icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="m-0">{summaryOf(state, lookup)}</p>
                </div>
              )}

              {/* Booking */}
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className={sectionLabel}>Booking</p>
                  <Link href={`/admin/bookings/${d.bookingReference}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">
                    Open booking <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="mt-2 flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><Building2 className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-neutral-900">{d.property.title || "Property not named"}</p>
                    <p className="m-0 truncate text-xs text-neutral-500">{[humanize(d.property.type), d.property.location, d.booking.roomCode ? `Room ${d.booking.roomCode}` : ""].filter(Boolean).join(" · ") || "No details"}</p>
                  </div>
                </div>
                <dl className="m-0 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
                  {[
                    { label: "Check-in", value: day(d.booking.checkIn) },
                    { label: "Check-out", value: day(d.booking.checkOut) },
                    { label: "Nights", value: String(d.booking.nights) },
                    { label: "Amount", value: `${d.booking.currency} ${Math.round(d.booking.totalAmount).toLocaleString("en-US")}` },
                  ].map((f) => (
                    <div key={f.label} className="min-w-0 bg-white px-3 py-2.5">
                      <dt className="text-[11px] text-neutral-500">{f.label}</dt>
                      <dd className="m-0 mt-0.5 truncate text-sm font-semibold tabular-nums text-neutral-900">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* People */}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Guest", icon: UserRound, name: d.guest.name || "Not named", line: d.guest.phone, note: null as string | null },
                  {
                    label: "Owner",
                    icon: Building2,
                    name: owner?.removed ? "Account removed" : owner?.name || "Not named",
                    line: owner?.removed ? null : owner?.phone || owner?.email || null,
                    note: owner?.removed ? "This owner deleted their account. Messages cannot be sent." : null,
                  },
                ].map((p) => (
                  <div key={p.label} className="min-w-0 rounded-xl border border-solid border-neutral-200 px-3 py-2.5">
                    <p className={sectionLabel}>{p.label}</p>
                    <p className="m-0 mt-1 flex items-center gap-2 truncate text-sm font-semibold text-neutral-900"><p.icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />{p.name}</p>
                    {p.line ? <p className="m-0 mt-0.5 flex items-center gap-2 truncate text-xs text-neutral-500"><Phone className="h-3 w-3 shrink-0" />{p.line}</p> : null}
                    {p.note ? <p className="m-0 mt-1 text-[11px] text-neutral-500">{p.note}</p> : null}
                  </div>
                ))}
              </div>

              {/* Cancellation */}
              {d.cancellation && (
                <div>
                  <p className={sectionLabel}>Cancellation</p>
                  <dl className="m-0 mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl border border-solid border-neutral-200 px-3 py-2.5 text-xs sm:grid-cols-[auto_1fr]">
                    <dt className="text-neutral-500">Status</dt><dd className="m-0 font-semibold text-neutral-900">{humanize(d.cancellation.status)}</dd>
                    <dt className="text-neutral-500">Requested</dt><dd className="m-0 text-neutral-800">{stamp(d.cancellation.createdAt)}</dd>
                    {d.cancellation.policyRefundPercent != null && (<><dt className="text-neutral-500">Refund</dt><dd className="m-0 text-neutral-800">{d.cancellation.policyRefundPercent}%{d.cancellation.policyRule ? ` · ${d.cancellation.policyRule}` : ""}</dd></>)}
                    {d.cancellation.reason && (<><dt className="text-neutral-500">Reason</dt><dd className="m-0 text-neutral-800">{d.cancellation.reason}</dd></>)}
                    {d.cancellation.decisionNote && (<><dt className="text-neutral-500">Admin note</dt><dd className="m-0 text-neutral-800">{d.cancellation.decisionNote}</dd></>)}
                  </dl>
                </div>
              )}

              <p className="m-0 flex items-center gap-1.5 text-[11px] text-neutral-400"><Clock3 className="h-3.5 w-3.5" /> Code issued {stamp(d.generatedAt)}</p>

              {/* Message the owner */}
              {state !== "ready" || confirmed ? (
                <div className="rounded-xl border border-solid border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setNotifyOpen((v) => !v)}
                    disabled={!canMessage}
                    aria-expanded={notifyOpen}
                    className="flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left hover:bg-neutral-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-500"><Bell className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-neutral-900">Message the owner</span>
                      <span className="block text-[11px] text-neutral-500">{canMessage ? "Goes to their in-app inbox" : "Not available: the owner account is removed"}</span>
                    </span>
                    {canMessage && <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${notifyOpen ? "rotate-180" : ""}`} />}
                  </button>
                  {notifyOpen && canMessage && (
                    <div className="space-y-2.5 border-0 border-t border-solid border-neutral-200 px-3 py-3">
                      {sent ? (
                        <p className="m-0 flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Message delivered to {owner?.name || "the owner"}.</p>
                      ) : (
                        <>
                          {suggestion && (
                            <button type="button" onClick={() => { setSubject(suggestion.subject); setMessage(suggestion.message); }} className="w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-left hover:bg-neutral-100">
                              <span className="block text-[11px] font-semibold text-[#02665e]">Use suggested message</span>
                              <span className="mt-0.5 block truncate text-xs text-neutral-600">{suggestion.subject}</span>
                            </button>
                          )}
                          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="Subject" aria-label="Subject" className={`${fieldClass} h-9`} />
                          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={4} placeholder="Write the message the owner will receive" aria-label="Message" className={`${fieldClass} resize-y py-2 leading-relaxed`} />
                          {sendError && <p className="m-0 text-xs font-semibold text-rose-700">{sendError}</p>}
                          <div className="flex justify-end">
                            <button type="button" onClick={() => void sendMessage()} disabled={sending || !subject.trim() || !message.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f] disabled:opacity-50">
                              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Send to {owner?.name?.split(" ")[0] || "owner"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {confirmError && (
                <div className="flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{confirmError}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-5 py-3">
              <button type="button" onClick={startOver} disabled={confirming || sending} className="inline-flex h-9 items-center rounded-lg border-0 bg-transparent px-1 text-xs font-semibold text-neutral-600 hover:text-neutral-900 disabled:opacity-40">
                Look up another code
              </button>
              {state === "ready" && !confirmed ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={close} disabled={confirming} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Cancel</button>
                  <button type="button" onClick={() => void confirmCheckin()} disabled={confirming} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3.5 text-xs font-semibold text-white hover:bg-[#014d47] disabled:opacity-60">
                    {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    {confirming ? "Confirming" : "Confirm check-in"}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={close} disabled={confirming || sending} className="inline-flex h-9 items-center rounded-lg border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white hover:bg-[#12342f] disabled:opacity-40">
                  Done
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
