"use client";
// Agent portal: My bookings. Every booking says what, if anything, the agency
// has to do next, and flags what the hotel changed since the last visit, so
// a new invoice revision or a correction request never goes unnoticed.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertCircle, ArrowRight, BellRing, CheckCircle2, ClipboardList, Clock, FileText, Info, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { agentSignal, bookingFingerprint, describeChange, needsAgent, readSeen, writeSeen, type AgentBooking, type AgentSignal } from "@/lib/agentBookingSignals";

const money = (n: number) => Math.round(n).toLocaleString();
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const initials = (name?: string | null) => String(name || "H").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "H";

// Colour carries the agency's situation, never decoration.
const SIGNAL_STYLE: Record<AgentSignal["kind"], { bar: string; icon: string; title: string; Icon: typeof AlertCircle }> = {
  urgent: { bar: "border-red-200 bg-red-50", icon: "bg-red-100 text-red-700", title: "text-red-900", Icon: AlertCircle },
  action: { bar: "border-amber-200 bg-amber-50", icon: "bg-amber-100 text-amber-800", title: "text-amber-950", Icon: BellRing },
  waiting: { bar: "border-neutral-200 bg-neutral-50", icon: "bg-white text-neutral-500 ring-1 ring-neutral-200", title: "text-neutral-900", Icon: Clock },
  done: { bar: "border-emerald-200 bg-emerald-50", icon: "bg-emerald-100 text-emerald-700", title: "text-emerald-950", Icon: ShieldCheck },
  closed: { bar: "border-neutral-200 bg-neutral-50", icon: "bg-white text-neutral-400 ring-1 ring-neutral-200", title: "text-neutral-700", Icon: XCircle },
};

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  PENDING: { cls: "bg-amber-50 text-amber-800 ring-amber-200", label: "Awaiting approval" },
  CONFIRMED: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Confirmed" },
  DECLINED: { cls: "bg-red-50 text-red-700 ring-red-200", label: "Declined" },
  EXPIRED: { cls: "bg-neutral-100 text-neutral-600 ring-neutral-200", label: "Expired" },
  CANCELLED: { cls: "bg-neutral-100 text-neutral-600 ring-neutral-200", label: "Cancelled" },
};

export default function AgentBookingsPage() {
  const [bookings, setBookings] = useState<AgentBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of what was already seen, taken on load, so the "New" marks stay
  // visible for this whole visit even though the baseline is updated.
  const [seenAtLoad, setSeenAtLoad] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [view, setView] = useState<"ALL" | "ACTION" | "UPDATED" | "WAITING" | "DONE">("ALL");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiClient.get<any>("/api/agent-portal/bookings");
        if (!live) return;
        const rows: AgentBooking[] = res.data?.bookings ?? [];
        const seen = readSeen();
        setSeenAtLoad(seen);
        // Bookings never seen before become today's baseline, not "New".
        const next = { ...seen };
        let changed = false;
        for (const row of rows) if (!next[row.id]) { next[row.id] = bookingFingerprint(row); changed = true; }
        if (changed) writeSeen(next);
        setBookings(rows);
      } catch (e: any) {
        if (live) setError(e?.response?.data?.error || "Failed to load your bookings");
      }
    })();
    return () => { live = false; };
  }, []);

  const markSeen = useCallback((ids: number[]) => {
    if (!bookings) return;
    const next = readSeen();
    for (const id of ids) {
      const row = bookings.find((b) => b.id === id);
      if (row) next[id] = bookingFingerprint(row);
    }
    writeSeen(next);
    setDismissed((current) => new Set([...current, ...ids]));
  }, [bookings]);

  const changes = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of bookings ?? []) {
      if (dismissed.has(b.id)) continue;
      const change = describeChange(seenAtLoad[b.id], b);
      if (change) map.set(b.id, change);
    }
    return map;
  }, [bookings, seenAtLoad, dismissed]);

  const todo = (bookings ?? []).filter(needsAgent);
  const rows = bookings ?? [];
  const views: Array<[typeof view, string, number]> = [
    ["ALL", "All", rows.length],
    ["ACTION", "Needs your action", todo.length],
    ["UPDATED", "Updated", changes.size],
    ["WAITING", "Waiting on the hotel", rows.filter((b) => agentSignal(b).kind === "waiting").length],
    ["DONE", "Ready or closed", rows.filter((b) => ["done", "closed"].includes(agentSignal(b).kind)).length],
  ];
  const shown = rows.filter((b) => {
    const kind = agentSignal(b).kind;
    if (view === "ACTION") return kind === "action" || kind === "urgent";
    if (view === "UPDATED") return changes.has(b.id);
    if (view === "WAITING") return kind === "waiting";
    if (view === "DONE") return kind === "done" || kind === "closed";
    return true;
  });

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><ClipboardList className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h1 className="m-0 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">My bookings</h1>
              <p className="m-0 mt-1 text-sm leading-6 text-neutral-500">Your requests and confirmed stays across every hotel that approved you.</p>
            </div>
          </div>
          {bookings && bookings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${todo.length ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                {todo.length ? <BellRing className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {todo.length ? `${todo.length} need${todo.length === 1 ? "s" : ""} your action` : "Nothing waiting on you"}
              </span>
              {changes.size > 0 && (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200">
                    <span className="h-2 w-2 rounded-full bg-blue-500" /> {changes.size} updated since your last visit
                  </span>
                  <button type="button" onClick={() => markSeen([...changes.keys()])} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline">Mark all as seen</button>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {bookings === null ? (
        <div className="flex items-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your bookings…</div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="m-0 mt-2 text-base font-bold text-neutral-700">No bookings yet</p>
          <p className="m-0 mt-1 text-sm text-neutral-500">Your bookings will show here once you make one.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
          <div role="tablist" aria-label="Filter bookings" className="flex flex-wrap gap-1.5 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
            {views.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-semibold transition ${view === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
              >
                {label}
                <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${view === value ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">Nothing in this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                    <th className="border-0 border-b border-solid border-neutral-200 px-5 py-3">Hotel</th>
                    <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Stay</th>
                    <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Invoice</th>
                    <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Travellers</th>
                    <th className="border-0 border-b border-solid border-neutral-200 px-4 py-3">Next step</th>
                    <th className="border-0 border-b border-solid border-neutral-200 px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child_td]:border-b-0">
                  {shown.map((b) => {
                    const pill = STATUS_PILL[b.status] ?? { cls: "bg-neutral-100 text-neutral-600 ring-neutral-200", label: b.status };
                    const signal = agentSignal(b);
                    const style = SIGNAL_STYLE[signal.kind];
                    const SignalIcon = style.Icon;
                    const change = changes.get(b.id) ?? null;
                    const nights = nightsBetween(b.checkIn, b.checkOut);
                    const invoice = b.commercial.invoice;
                    const bookingHref = `/agent-portal/bookings/${b.id}/guests`;
                    const primary = signal.kind === "urgent" || signal.kind === "action";
                    const ctaLabel = signal.cta === "invoice" ? (primary ? "Pay invoice" : "View invoice") : signal.cta === "travellers" ? (b.manifest.status === "CHANGES_REQUESTED" ? "Correct travellers" : "Add travellers") : null;
                    const cell = "border-0 border-b border-solid border-neutral-200 align-middle";
                    return (
                      <tr key={b.id} className={`transition ${change ? "bg-blue-50/40 hover:bg-blue-50/70" : "hover:bg-neutral-50/70"}`}>
                        <td className={`${cell} px-5 py-3.5`}>
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-emerald-50 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">{initials(b.property?.title)}</span>
                            <div className="min-w-0">
                              <p className="m-0 flex items-center gap-2">
                                <span className="max-w-[14rem] truncate font-bold text-neutral-900">{b.property?.title ?? "Hotel"}</span>
                                {change && <span className="inline-flex flex-none items-center rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">New</span>}
                              </p>
                              <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${pill.cls}`}>{pill.label}</span>
                            </div>
                          </div>
                        </td>
                        <td className={`${cell} px-4 py-3.5`}>
                          <p className="m-0 whitespace-nowrap font-semibold text-neutral-800">{fmt(b.checkIn)} to {fmt(b.checkOut)}</p>
                          <p className="m-0 mt-0.5 text-xs text-neutral-500">{plural(nights, "night")} · {plural(b.rooms, "room")} · {b.adults + b.children} guests</p>
                        </td>
                        <td className={`${cell} px-4 py-3.5`}>
                          <p className="m-0 whitespace-nowrap font-bold tabular-nums text-neutral-900">{b.currency} {money(invoice?.quotedTotal ?? b.total)}</p>
                          <p className={`m-0 mt-0.5 whitespace-nowrap text-xs ${b.commercial.settled ? "font-semibold text-emerald-700" : invoice ? "text-neutral-500" : "text-neutral-400"}`}>
                            {invoice ? <><span className="font-mono">{invoice.number}</span> · {b.commercial.settled ? "Paid" : invoice.payerMarkedPaidAt ? "Being confirmed" : invoice.dueAt ? `Due ${fmt(invoice.dueAt)}` : "Unpaid"}</> : b.status === "CONFIRMED" ? "Not issued yet" : "Estimate"}
                          </p>
                        </td>
                        <td className={`${cell} px-4 py-3.5`}>
                          {b.status === "CONFIRMED" ? <>
                            <p className="m-0 whitespace-nowrap font-semibold text-neutral-800">{b.manifest.guestsAdded} of {b.manifest.requiredGuests}</p>
                            <p className={`m-0 mt-0.5 whitespace-nowrap text-xs font-semibold ${b.manifest.status === "VERIFIED" ? "text-emerald-700" : b.manifest.status === "CHANGES_REQUESTED" ? "text-red-700" : "text-neutral-500"}`}>{MANIFEST_LABEL[b.manifest.status] ?? b.manifest.status.toLowerCase()}</p>
                          </> : <span className="text-xs text-neutral-400">After approval</span>}
                        </td>
                        <td className={`${cell} max-w-[22rem] px-4 py-3.5`}>
                          <div className={`flex items-center gap-1.5 font-semibold ${style.title}`}>
                            <SignalIcon className={`h-4 w-4 flex-none ${signal.kind === "urgent" ? "text-red-600" : signal.kind === "action" ? "text-amber-600" : signal.kind === "done" ? "text-emerald-600" : "text-neutral-400"}`} />
                            <span className="min-w-0 truncate">{signal.title}</span>
                            <InfoTip text={signal.detail} />
                          </div>
                          {/* The only second line a row gets is news: what the hotel changed. */}
                          {change && (
                            <p className="m-0 mt-0.5 flex items-center gap-2 text-xs text-blue-800">
                              <span className="min-w-0 truncate">{change}.</span>
                              <button type="button" onClick={() => markSeen([b.id])} className="flex-none cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-blue-700 hover:text-blue-900">Got it</button>
                            </p>
                          )}
                        </td>
                        <td className={`${cell} px-5 py-3.5 text-right`}>
                          <div className="flex justify-end gap-2">
                            {b.status === "CONFIRMED" && (
                              <Link href={bookingHref} onClick={() => markSeen([b.id])} className={`box-border inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-xs font-bold no-underline transition ${primary ? "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800" : "border border-solid border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
                                {ctaLabel ?? "Open booking"} <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            )}
                            {b.status === "CONFIRMED" && b.commercial.settled && (
                              <Link href={`/api/agent-portal/bookings/${b.id}/voucher`} target="_blank" rel="noreferrer" title="Download voucher" className={`box-border inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-bold no-underline transition ${signal.kind === "done" ? "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800" : "border border-solid border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
                                <FileText className="h-3.5 w-3.5" /> Voucher
                              </Link>
                            )}
                            {b.status !== "CONFIRMED" && <span className="text-xs text-neutral-400">{b.status === "PENDING" ? "Waiting on the hotel" : "Closed"}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const MANIFEST_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "With the hotel for checking",
  CHANGES_REQUESTED: "Corrections requested",
  VERIFIED: "Verified",
};

/**
 * The longer explanation behind a next step, kept out of the table row. It
 * opens on hover or keyboard focus, and on a tap for touch screens.
 */
function InfoTip({ text }: { text: string }) {
  // Positioned against the window, not the cell: the table's horizontal
  // scroll box clips anything that overflows it, in every direction.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
  };
  const hide = () => setAnchor(null);
  return (
    <span className="inline-flex flex-none">
      <button
        type="button"
        aria-label="More about this step"
        aria-expanded={anchor != null}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={hide}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={hide}
        onClick={(event) => (anchor ? hide() : show(event.currentTarget))}
        className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {anchor && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 -translate-y-full rounded-lg bg-neutral-900 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg"
          style={{ left: Math.min(Math.max(anchor.x, 140), window.innerWidth - 140), top: anchor.y - 6 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
