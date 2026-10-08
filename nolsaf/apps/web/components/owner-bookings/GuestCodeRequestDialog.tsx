"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, CalendarCheck2, Check, Clock3, KeyRound, Loader2, MessageSquareText, Search, ShieldAlert, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

/**
 * "Guest lost their code?" The owner picks an arriving guest and NoLSAF sends
 * the check-in code to the guest's booking contact. The owner never sees the
 * code. When NoLSAF has to check first (contacts overlap, guest unreachable)
 * the request goes to NoLSAF's team and shows here until it is handled.
 */

type Arrival = { bookingReference: string; guestName?: string | null; property: string; checkIn: string; checkOut: string; status: string };
type Preset = { bookingReference: string; guestName?: string | null; property?: string | null; checkIn?: string | null };
type Result = { status: "SENT" | "NEEDS_REVIEW" | "UNREACHABLE"; message: string; destinationMasked?: string | null };
type RequestRow = {
  id: number;
  status: string;
  channel: string | null;
  destinationMasked: string | null;
  adminNote: string | null;
  createdAt: string;
  booking: { reference: string; guestName: string | null; propertyTitle: string | null; checkIn: string };
};

const TZ = "Africa/Dar_es_Salaam";
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
/** Tanzania calendar day, the same rule the server uses to accept a code. */
const eatDay = (value: string | number) => new Date(value).toLocaleDateString("en-CA", { timeZone: TZ });
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  SENT: { label: "Sent to guest", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  RESOLVED: { label: "Resent by NoLSAF", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  NEEDS_REVIEW: { label: "NoLSAF is checking", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  UNREACHABLE: { label: "NoLSAF is contacting", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  REJECTED: { label: "Closed by NoLSAF", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
};

export default function GuestCodeRequestDialog({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: Preset | null }) {
  const [arrivals, setArrivals] = useState<Arrival[] | null>(null);
  const [history, setHistory] = useState<RequestRow[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Preset | null>(preset ?? null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(preset ?? null);
    setResult(null);
    setError(null);
    setQuery("");
    let alive = true;
    apiClient.get<{ requests: RequestRow[] }>("/api/owner/bookings/code-requests")
      .then((r) => { if (alive) setHistory(r.data?.requests ?? []); })
      .catch(() => { if (alive) setHistory([]); });
    if (!preset) {
      // Look back far enough for a long stay whose guest is days late; the
      // check-out filter below keeps only codes that still work.
      const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      apiClient.get("/api/owner/reports/bookings", { params: { from, to } })
        .then((r) => {
          if (!alive) return;
          // A code is accepted from the check-in day up to and including the
          // check-out day (Tanzania time), so a guest who missed their first
          // night still appears here until their stay ends.
          const today = eatDay(Date.now());
          const rows: Arrival[] = (r.data?.table ?? []).filter((b: Arrival) => ["CONFIRMED", "PENDING_CHECKIN"].includes(String(b.status).toUpperCase()) && eatDay(b.checkOut) >= today);
          rows.sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());
          setArrivals(rows);
        })
        .catch(() => { if (alive) setArrivals([]); });
    }
    return () => { alive = false; };
  }, [open, preset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending) onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open, sending, onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = arrivals ?? [];
    return q ? rows.filter((b) => `${b.guestName ?? ""} ${b.property}`.toLowerCase().includes(q)) : rows;
  }, [arrivals, query]);

  const send = async () => {
    if (!picked) return;
    setSending(true);
    setError(null);
    try {
      const r = await apiClient.post(`/api/owner/bookings/${encodeURIComponent(picked.bookingReference)}/request-code`);
      setResult({ status: r.data?.status ?? "SENT", message: r.data?.message ?? "Sent to the guest.", destinationMasked: r.data?.destinationMasked ?? null });
    } catch (e: any) {
      setError(e?.response?.data?.error || "The request could not be sent. Try again in a moment.");
    } finally {
      setSending(false);
    }
  };

  if (!open || typeof document === "undefined") return null;
  const openHistory = history.filter((row) => ["NEEDS_REVIEW", "UNREACHABLE"].includes(row.status));

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5" role="presentation" onClick={() => { if (!sending) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-code-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-3 bg-[#012a26] px-5 pb-5 pt-5 text-white">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#5eead4] text-[#012a26]"><KeyRound className="h-5 w-5" aria-hidden /></span>
            <div>
              <h2 id="guest-code-title" className="m-0 text-lg font-bold text-white">Guest lost their code?</h2>
              <p className="m-0 mt-1 text-xs leading-5 text-white/60">We send it to the guest&apos;s booking phone. The code never shows on your screen.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-solid border-white/15 bg-white/[0.06] text-white/70 transition hover:bg-white/[0.12] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        {!result && (
          <ol className="m-0 grid list-none grid-cols-3 gap-px border-0 border-b border-solid border-slate-200 bg-slate-200 p-0">
            {[
              { n: 1, label: "Pick the guest" },
              { n: 2, label: "NoLSAF sends the code" },
              { n: 3, label: "Guest shows it to you" },
            ].map((step) => {
              const done = step.n === 1 && Boolean(picked);
              const current = (step.n === 1 && !picked) || (step.n === 2 && Boolean(picked));
              return (
                <li key={step.n} className="flex items-center gap-2 bg-white px-3 py-2.5">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-[#02665e] text-white" : current ? "bg-[#012a26] text-[#5eead4]" : "bg-slate-100 text-slate-400"}`}>
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : step.n}
                  </span>
                  <span className={`truncate text-[11px] font-semibold ${current || done ? "text-slate-800" : "text-slate-400"}`}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="space-y-4 p-5">
          {result ? (
            <div className={`rounded-2xl px-4 py-4 ring-1 ring-inset ${result.status === "SENT" ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
              <div className="flex items-start gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${result.status === "SENT" ? "bg-emerald-600" : "bg-amber-500"}`}>
                  {result.status === "SENT" ? <Check className="h-4 w-4" strokeWidth={3} /> : <Clock3 className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className={`m-0 text-sm font-bold ${result.status === "SENT" ? "text-emerald-900" : "text-amber-950"}`}>
                    {result.status === "SENT" ? "Code sent to the guest" : result.status === "NEEDS_REVIEW" ? "Sent to NoLSAF for checking" : "NoLSAF will contact the guest"}
                  </p>
                  <p className={`m-0 mt-1 text-xs leading-5 ${result.status === "SENT" ? "text-emerald-800" : "text-amber-900"}`}>{result.message}</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border-0 bg-[#012a26] text-sm font-bold text-white transition hover:bg-[#033a34]">Done</button>
            </div>
          ) : picked ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#012a26] text-xs font-bold text-[#5eead4]">
                  {(picked.guestName || "G").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-bold text-slate-900">{picked.guestName || "Guest"}</p>
                  <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{[picked.property, picked.checkIn ? `arrives ${fmtDay(picked.checkIn)}` : null].filter(Boolean).join(" · ")}</p>
                </div>
                {!preset && <button type="button" onClick={() => setPicked(null)} className="rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-semibold text-[#02665e] hover:bg-emerald-50">Change</button>}
              </div>
              <ul className="m-0 list-none space-y-2 p-0 text-xs leading-5 text-slate-600">
                <li className="flex gap-2"><MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />The guest gets an SMS with the code and a notice in their NoLSAF account.</li>
                <li className="flex gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />If anything looks unusual, NoLSAF checks the guest first and tells you the outcome.</li>
              </ul>
              {error && <p role="alert" className="m-0 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}
              <button type="button" onClick={() => void send()} disabled={sending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-sm font-bold text-white transition hover:bg-[#014d47] disabled:opacity-60">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {sending ? "Sending..." : "Send code to guest"}
              </button>
            </div>
          ) : (
            <div>
              {arrivals !== null && arrivals.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 px-5 py-7 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500"><CalendarCheck2 className="h-5 w-5" aria-hidden /></span>
                  <p className="m-0 mt-3 text-sm font-bold text-slate-900">No guests waiting to check in</p>
                  <p className="m-0 mt-1 max-w-xs text-xs leading-5 text-slate-500">
                    A code can be resent for a confirmed NoLSAF booking that has not checked in, including a guest arriving late, until their check-out day. NRMS walk-ins and guests already in house do not need one.
                  </p>
                  <Link href="/owner/bookings?tab=waiting" onClick={onClose} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 no-underline transition hover:bg-slate-50">
                    See awaiting arrivals <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              ) : (
              <>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search guest or property"
                  aria-label="Find the guest"
                  className="box-border h-10 w-full rounded-xl border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                />
              </label>
              <p className="m-0 mb-2 mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Arriving guests</p>
              {arrivals === null ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-slate-100" />)}</div>
              ) : shown.length === 0 ? (
                <p className="m-0 rounded-xl bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">No arriving guest matches that.</p>
              ) : (
                <ul className="m-0 max-h-72 list-none space-y-1.5 overflow-y-auto p-0">
                  {shown.map((b) => (
                    <li key={b.bookingReference}>
                      <button
                        type="button"
                        onClick={() => setPicked({ bookingReference: b.bookingReference, guestName: b.guestName, property: b.property, checkIn: b.checkIn })}
                        className="flex w-full items-center gap-3 rounded-xl border border-solid border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-[#02665e]/40 hover:bg-emerald-50/40"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                          {(b.guestName || "G").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{b.guestName || "Guest"}</span>
                          <span className="block truncate text-xs text-slate-500">{b.property}</span>
                        </span>
                        {eatDay(b.checkIn) < eatDay(Date.now()) ? (
                          <span className="shrink-0 text-right">
                            <span className="block rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200">Late arrival</span>
                            <span className="mt-0.5 block text-[10.5px] text-slate-500">Was due {fmtDay(b.checkIn)}</span>
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs font-semibold text-slate-600">{eatDay(b.checkIn) === eatDay(Date.now()) ? "Today" : fmtDay(b.checkIn)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </>
              )}
            </div>
          )}

          {history.length > 0 && !result && (
            <div className="border-0 border-t border-solid border-slate-100 pt-4">
              <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Your recent requests{openHistory.length ? ` · ${openHistory.length} with NoLSAF` : ""}
              </p>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {history.slice(0, 5).map((row) => {
                  const chip = STATUS_CHIP[row.status] ?? { label: row.status.toLowerCase(), cls: "bg-slate-100 text-slate-700 ring-slate-200" };
                  return (
                    <li key={row.id} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-semibold text-slate-800">{row.booking.guestName || "Guest"} <span className="font-normal text-slate-400">· {fmtWhen(row.createdAt)}</span></span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ring-inset ${chip.cls}`}>{chip.label}</span>
                      </div>
                      {row.adminNote ? <p className="m-0 mt-1 text-[11px] text-slate-500">NoLSAF: {row.adminNote}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
