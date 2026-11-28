"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Building2, CalendarClock, ChevronRight, CircleCheck, Gavel, Handshake,
  PhoneCall, ShieldAlert, UserPlus, Wallet,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { tsh } from "../eventHireTypes";
import type { Booking } from "../EventHireWorkspace";
import { ACTIVE_REQUEST, REQUEST_LABEL, day, month, pulseCounts, relative, requestNeeds, span, usePulse, useWorkspaceRefresh, weekday, clock } from "./eventAdmin";
import { DateTile, Loading, Pill } from "./ui";

type Task = { key: string; urgent: boolean; Icon: typeof Gavel; title: string; detail: string; count: number; href: string; cta: string };

/** The latest paid bookings, read once, to find what needs a reviewer. */
function useBookingSignals() {
  const [upcoming, setUpcoming] = useState<Booking[] | null>(null);
  const [paid, setPaid] = useState<Booking[] | null>(null);
  const [partial, setPartial] = useState(false);
  const load = useCallback(async () => {
    const base = "/api/admin/event-hire/operations/bookings";
    const [u, c, d] = await Promise.allSettled([
      apiClient.get(base, { params: { upcoming: "true" } }),
      apiClient.get(base, { params: { status: "CONFIRMED" } }),
      apiClient.get(base, { params: { status: "COMPLETED" } }),
    ]);
    setUpcoming(u.status === "fulfilled" ? u.value.data.bookings : []);
    const rows = [c, d].flatMap(r => (r.status === "fulfilled" ? r.value.data.bookings as Booking[] : []));
    setPaid(rows);
    setPartial([c, d].some(r => r.status === "fulfilled" && r.value.data.hasMore));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(); }, [load]));
  return { upcoming, paid, partial };
}

export default function AdminEventCommandCentre() {
  const pulse = usePulse();
  const counts = pulseCounts(pulse);
  const { upcoming, paid, partial } = useBookingSignals();
  const s = pulse.summary;

  const signals = useMemo(() => {
    const now = Date.now();
    const rows = paid ?? [];
    return {
      cancellations: rows.filter(b => b.cancellationRequestedAt && b.status !== "CANCELLED").length,
      completion: rows.filter(b => b.status === "CONFIRMED" && new Date(b.endsAt).getTime() <= now).length,
      claims: rows.filter(b => b.claims?.[0] && b.claims[0].status !== "RESOLVED").length,
      approvals: rows.reduce((n, b) => n + b.transfers.filter(t => t.status === "REVIEW").length, 0),
      release: rows.reduce((n, b) => n + b.transfers.filter(t => t.status === "APPROVED").length, 0),
    };
  }, [paid]);

  // Ordered by what blocks a client or an owner first.
  const tasks: Task[] = [
    { key: "callback", urgent: true, Icon: PhoneCall, title: "Verify owner callbacks", detail: "A partner recorded the owner's yes by phone. An independent NoLSAF call is needed before the client can pay.", count: counts.callbacks ?? 0, href: "/admin/event-hire/requests?view=callback", cta: "Call owners" },
    { key: "payment", urgent: true, Icon: ShieldAlert, title: "Payments under review", detail: "The provider has not confirmed these collections. Check before the slot is released.", count: counts.paymentReview ?? 0, href: "/admin/event-hire/bookings?view=PAYMENT_REVIEW", cta: "Check payments" },
    { key: "partner", urgent: true, Icon: UserPlus, title: "Assign sales partners", detail: "The client asked for help confirming the date and nobody is assigned yet.", count: counts.needPartner ?? 0, href: "/admin/event-hire/requests?view=partner", cta: "Assign" },
    { key: "cancel", urgent: true, Icon: AlertTriangle, title: "Cancellation reviews", detail: "An owner or client asked to cancel. Settlement is frozen until you decide.", count: signals.cancellations, href: "/admin/event-hire/bookings?view=attention", cta: "Review" },
    { key: "claims", urgent: true, Icon: Gavel, title: "Damage claims to decide", detail: "The deposit stays on hold until you award an evidence-based amount.", count: signals.claims, href: "/admin/event-hire/bookings?view=attention", cta: "Decide" },
    { key: "venues", urgent: false, Icon: Building2, title: "Venues waiting for approval", detail: "Check photos, prices, consent and rules before a space goes on sale.", count: counts.venuesToReview ?? 0, href: "/admin/event-hire/venues", cta: "Review venues" },
    { key: "escalated", urgent: false, Icon: CalendarClock, title: "Owners not answering", detail: "Date requests past their reminder window. A call may save the booking.", count: counts.escalated ?? 0, href: "/admin/event-hire/requests?view=escalated", cta: "Follow up" },
    { key: "complete", urgent: false, Icon: CircleCheck, title: "Events to close", detail: "The event has ended. Confirm completion so settlement can be prepared.", count: signals.completion, href: "/admin/event-hire/bookings?view=attention", cta: "Close events" },
    { key: "approve", urgent: false, Icon: BadgeCheck, title: "Payouts to approve", detail: "Owner earnings and refunds whose conditions are met, waiting for your approval.", count: signals.approvals, href: "/admin/event-hire/settlements?view=REVIEW", cta: "Approve" },
    { key: "release", urgent: false, Icon: Wallet, title: "Approved, ready to release", detail: "Send through Disbursements. Paid only after the provider confirms.", count: signals.release, href: "/admin/event-hire/settlements?view=APPROVED", cta: "Release" },
  ];
  const open = tasks.filter(t => t.count > 0);
  const queueReady = !pulse.loading && paid !== null;

  const stages = [
    { label: "Venues in review", value: counts.venuesToReview, sub: counts.venuesWithOwner ? `${counts.venuesWithOwner} with the owner` : "Submitted spaces", href: "/admin/event-hire/venues" },
    { label: "Live venues", value: counts.liveVenues, sub: "On sale now", href: "/admin/event-hire/venues?view=APPROVED" },
    { label: "Open date requests", value: counts.openRequests, sub: pulse.requestsOff ? "Requests are switched off" : "Before checkout", href: "/admin/event-hire/requests" },
    { label: "In checkout", value: s ? (s.statuses.PAYMENT_PENDING || 0) + (s.statuses.PAYMENT_REVIEW || 0) : null, sub: "Payment being verified", href: "/admin/event-hire/bookings?view=PAYMENT_PENDING" },
    { label: "Confirmed events", value: s ? s.statuses.CONFIRMED || 0 : null, sub: "Paid and on the calendar", href: "/admin/event-hire/bookings?view=CONFIRMED" },
    { label: "Completed", value: s ? s.statuses.COMPLETED || 0 : null, sub: "Ready for settlement", href: "/admin/event-hire/bookings?view=COMPLETED" },
  ];

  const recentRequests = (pulse.requests ?? []).filter(r => ACTIVE_REQUEST.includes(r.status)).slice(0, 5);
  const waiting = open.reduce((n, t) => n + t.count, 0);
  const head = "flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2";
  const link = "inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#02665e] no-underline hover:underline";

  return (
    <div className="space-y-3">
      {/* The lifecycle, left to right, as an event actually travels */}
      <section aria-label="Event hire lifecycle" className="overflow-hidden rounded-lg border border-solid border-[#12342f] bg-[#0b2420] text-white">
        <ol className="m-0 grid list-none grid-cols-2 p-0 sm:grid-cols-3 xl:grid-cols-6">
          {stages.map((st, i) => {
            const off = st.label === "Open date requests" && pulse.requestsOff;
            return (
              <li key={st.label} className={`min-w-0 border-0 border-solid border-white/[0.08] border-b xl:border-b-0 ${i ? "xl:border-l" : ""}`}>
                <Link href={st.href} className="group flex min-w-0 items-center gap-3 px-3.5 py-2.5 text-white no-underline hover:bg-white/[0.05] hover:no-underline">
                  <strong className={`min-w-[1.75rem] text-[22px] font-bold leading-none tabular-nums ${off ? "text-white/35" : ""}`}>{off ? "Off" : st.value == null ? "..." : st.value}</strong>
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-semibold text-white/80">{st.label}</span>
                    <span className="block truncate text-[10.5px] text-white/40">{st.sub}</span>
                  </span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/25 transition-colors group-hover:text-white/70" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* Needs you now */}
        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className={head}>
            <p className="m-0 text-[13px] font-semibold text-neutral-900">Needs you now</p>
            {queueReady && (open.length
              ? <span className="rounded bg-amber-100 px-1.5 text-[11px] font-bold leading-5 text-amber-900">{waiting} waiting</span>
              : <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700"><CircleCheck className="h-3.5 w-3.5" />All clear</span>)}
          </div>
          {!queueReady ? <Loading>Reading the queues</Loading> : (
            <ul className="m-0 list-none p-0">
              {/* Open queues first, most urgent first; the quiet ones stay visible but small, so you can see what is watched. */}
              {open.map(t => (
                <li key={t.key} className="border-0 border-b border-solid border-neutral-100">
                  <Link href={t.href} className="group flex items-center gap-3 px-3 py-2.5 no-underline hover:bg-neutral-50 hover:no-underline">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${t.urgent ? "bg-amber-50 text-amber-700" : "bg-[#02665e]/[0.07] text-[#02665e]"}`}><t.Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[12.5px] font-semibold text-neutral-900">{t.title}</strong>
                      <span className="block truncate text-[11.5px] text-neutral-500">{t.detail}</span>
                    </span>
                    <strong className="shrink-0 text-[17px] font-bold tabular-nums text-neutral-900">{t.count}</strong>
                    <span className="inline-flex w-20 shrink-0 items-center justify-end gap-1 text-[11.5px] font-semibold text-[#02665e]">{t.cta}<ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span>
                  </Link>
                </li>
              ))}
              <li className="grid grid-cols-1 gap-x-4 px-3 py-2 sm:grid-cols-2">
                {tasks.filter(t => t.count === 0).map(t => (
                  <Link key={t.key} href={t.href} className="flex items-center gap-2 py-1 text-[11.5px] text-neutral-500 no-underline hover:text-neutral-800 hover:no-underline">
                    <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" /><span className="truncate">{t.title}</span><span className="ml-auto tabular-nums text-neutral-300">0</span>
                  </Link>
                ))}
              </li>
            </ul>
          )}
          {queueReady && partial && <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-1.5 text-[10.5px] text-neutral-400">Booking checks read the 40 most recent confirmed and completed bookings.</p>}
        </section>

        {/* Money */}
        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className={head}>
            <p className="m-0 text-[13px] font-semibold text-neutral-900">Where the money is</p>
            <Link href="/admin/event-hire/payments" className={link}>Collections<ArrowRight className="h-3 w-3" /></Link>
          </div>
          <MoneyFlow collected={s?.collected} held={s?.depositHeld} pending={s?.settlementPending} paid={s?.settled} />
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className={head}>
            <p className="m-0 text-[13px] font-semibold text-neutral-900">Coming up</p>
            <Link href="/admin/event-hire/availability" className={link}>Calendar<ArrowRight className="h-3 w-3" /></Link>
          </div>
          {upcoming === null ? <Loading /> : upcoming.length === 0 ? (
            <p className="m-0 flex items-center gap-2 px-3 py-3 text-[12px] text-neutral-500"><CalendarClock className="h-4 w-4 shrink-0 text-neutral-400" />No confirmed events ahead. Paid bookings appear here with a countdown.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {upcoming.map(b => (
                <li key={b.reference} className="border-0 border-t border-solid border-neutral-100 first:border-t-0">
                  <Link href={`/admin/event-hire/bookings?eventBooking=${encodeURIComponent(b.reference)}`} className="flex items-center gap-3 px-3 py-2 no-underline hover:bg-neutral-50 hover:no-underline">
                    <DateTile dayText={day(b.startsAt)} monthText={month(b.startsAt)} />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[12.5px] font-semibold text-neutral-900">{b.propertyTitle}</strong>
                      <span className="block truncate text-[11.5px] text-neutral-500">{weekday(b.startsAt)} {clock(b.startsAt)} to {clock(b.endsAt)} · {b.people} guests · {b.organizer}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11.5px] font-semibold text-[#02665e]">{relative(b.startsAt)}</span>
                      <span className="block text-[11px] tabular-nums text-neutral-500">{tsh(b.total)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className={head}>
            <p className="m-0 text-[13px] font-semibold text-neutral-900">Latest date requests</p>
            <Link href="/admin/event-hire/requests" className={link}>All requests<ArrowRight className="h-3 w-3" /></Link>
          </div>
          {pulse.requestsOff ? (
            <p className="m-0 flex items-center gap-2 px-3 py-3 text-[12px] text-neutral-500"><Handshake className="h-4 w-4 shrink-0 text-neutral-400" />Date requests are switched off in this environment.</p>
          ) : pulse.requests === null ? <Loading /> : recentRequests.length === 0 ? (
            <p className="m-0 flex items-center gap-2 px-3 py-3 text-[12px] text-neutral-500"><Handshake className="h-4 w-4 shrink-0 text-neutral-400" />No open requests. New ones stay here until the client pays.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {recentRequests.map(r => {
                const needs = requestNeeds(r);
                return (
                  <li key={r.reference} className="border-0 border-t border-solid border-neutral-100 first:border-t-0">
                    <Link href={`/admin/event-hire/requests?request=${encodeURIComponent(r.reference)}`} className="flex items-center gap-3 px-3 py-2 no-underline hover:bg-neutral-50 hover:no-underline">
                      <DateTile dayText={day(r.startsAt)} monthText={month(r.startsAt)} muted />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12.5px] font-semibold text-neutral-900">{r.propertyTitle || "Event venue"}</strong>
                        <span className="block truncate text-[11.5px] text-neutral-500">{span(r.startsAt, r.endsAt)} · {r.people} guests</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <Pill status={r.status}>{REQUEST_LABEL[r.status] || r.status}</Pill>
                        {needs[0] && <span className="text-[10.5px] font-semibold text-amber-700">{needs[0] === "callback" ? "Callback needed" : needs[0] === "partner" ? "Needs a partner" : "Owner silent"}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Client money in, then where it sits: held deposits, awaiting release, paid out. */
function MoneyFlow({ collected, held, pending, paid }: { collected?: number; held?: number; pending?: number; paid?: number }) {
  if (collected === undefined) return <Loading />;
  const total = Math.max(collected, 1);
  const parts = [
    { label: "Deposits held", note: "Owed back to clients", value: held ?? 0, color: "bg-amber-400" },
    { label: "Awaiting release", note: "In review or approved", value: pending ?? 0, color: "bg-[#02665e]" },
    { label: "Paid out", note: "Provider confirmed", value: paid ?? 0, color: "bg-emerald-300" },
  ];
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="m-0 text-[11px] text-neutral-500">Client payments collected</p>
        <p className="m-0 text-[20px] font-bold tabular-nums text-neutral-900">{tsh(collected)}</p>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
        {collected > 0 && parts.map(p => <span key={p.label} className={p.color} style={{ width: `${Math.min(100, (p.value / total) * 100)}%` }} />)}
      </div>
      <ul className="m-0 mt-1.5 list-none p-0">
        {parts.map(p => (
          <li key={p.label} className="flex items-center gap-2 border-0 border-t border-solid border-neutral-100 py-1.5 first:border-t-0">
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.color}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-800">{p.label}<span className="text-neutral-400"> · {p.note}</span></span>
            <strong className="shrink-0 text-[12.5px] tabular-nums text-neutral-900">{tsh(p.value)}</strong>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-1 text-[10.5px] text-neutral-400">Deposits belong to clients and never count as revenue.</p>
    </div>
  );
}
