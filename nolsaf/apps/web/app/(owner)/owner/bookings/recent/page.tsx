"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import io from "socket.io-client";
import {
  ArrowRight, BedDouble, CalendarClock, CalendarDays, CheckCircle2,
  Eye, Loader2, Phone, RefreshCw, ScanLine, Search,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";

type Booking = {
  id: number;
  bookingReference: string;
  guestName?: string | null;
  customerName?: string | null;
  guestPhone?: string | null;
  phone?: string | null;
  roomType?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  createdAt?: string | null;
  status: string;
  property?: { id: number; title: string } | null;
};
type View = "all" | "confirmed" | "checked-in" | "checked-out";
const TZ = "Africa/Dar_es_Salaam";
const PAGE_SIZE = 12;

const statusInfo: Record<string, { label: string; chip: string; dot: string }> = {
  CONFIRMED: { label: "Awaiting arrival", chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  CHECKED_IN: { label: "In house", chip: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  CHECKED_OUT: { label: "Checked out", chip: "bg-slate-100 text-slate-700", dot: "bg-slate-500" },
};

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

export default function RecentBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [requestMessage, setRequestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const retryDelay = useRef(2_000);
  const pollTimer = useRef<number | null>(null);
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const clearPoll = () => { if (pollTimer.current !== null) window.clearTimeout(pollTimer.current); pollTimer.current = null; };
    const fetchData = async () => {
      if (!mounted) return;
      clearPoll();
      try {
        const response = await apiClient.get<Booking[]>("/api/owner/bookings/recent", { signal: controller.signal });
        if (!mounted) return;
        setBookings(Array.isArray(response.data) ? response.data : []);
        setError(false);
        retryDelay.current = 2_000;
        pollTimer.current = window.setTimeout(fetchData, 12_000);
      } catch {
        if (!mounted) return;
        setError(true);
        retryDelay.current = Math.min(retryDelay.current * 2, 60_000);
        pollTimer.current = window.setTimeout(fetchData, retryDelay.current);
      }
    };
    refresh.current = () => { void fetchData(); };
    void fetchData();

    const onVisible = () => { if (document.visibilityState === "visible") void fetchData(); };
    const onOnline = () => void fetchData();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const socket = io(socketUrl, { transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: 5 });
    void fetchAccountSession().then((result) => {
      if (!mounted) return;
      const ownerId = Number(result.data?.id || 0);
      if (ownerId) socket.emit("join-owner-room", { ownerId });
    }).catch(() => {});
    socket.on("owner:bookings:updated", () => void fetchData());

    return () => {
      mounted = false;
      controller.abort();
      clearPoll();
      refresh.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      socket.disconnect();
    };
  }, []);

  async function requestGuestCode(bookingId: number) {
    setRequestingId(bookingId);
    setRequestMessage(null);
    try {
      const response = await apiClient.post(`/api/owner/bookings/${bookingId}/request-code`);
      setRequestMessage({ ok: true, text: response.data?.message || "The guest was asked to present their code." });
    } catch (cause: any) {
      setRequestMessage({ ok: false, text: cause?.response?.data?.error || "Could not contact the guest. Please try again." });
    } finally { setRequestingId(null); }
  }

  const counts = useMemo(() => ({
    all: bookings?.length ?? 0,
    confirmed: bookings?.filter((b) => b.status === "CONFIRMED").length ?? 0,
    "checked-in": bookings?.filter((b) => b.status === "CHECKED_IN").length ?? 0,
    "checked-out": bookings?.filter((b) => b.status === "CHECKED_OUT").length ?? 0,
  }), [bookings]);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (bookings ?? []).filter((b) => {
      if (view !== "all" && b.status !== view.toUpperCase().replace("-", "_")) return false;
      return !text || [b.bookingReference, b.guestName, b.customerName, b.guestPhone, b.phone, b.property?.title, b.roomType]
        .some((value) => String(value ?? "").toLowerCase().includes(text));
    });
  }, [bookings, query, view]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const views: { key: View; label: string; Icon: typeof CalendarDays }[] = [
    { key: "all", label: "Recent", Icon: CalendarDays },
    { key: "confirmed", label: "Awaiting arrival", Icon: CalendarClock },
    { key: "checked-in", label: "In house", Icon: BedDouble },
    { key: "checked-out", label: "Checked out", Icon: CheckCircle2 },
  ];

  return <div className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
    <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }} />
      <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0"><p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Front desk · Bookings</p><h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">Recent bookings</h1><p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">The latest confirmed stays, arrivals, and check-outs across your properties.</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => refresh.current?.()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/10"><RefreshCw className="h-4 w-4" />Refresh</button><Link href="/owner/bookings/validate" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5eead4] px-3.5 text-sm font-bold text-[#012a26] no-underline transition hover:bg-[#8ff3e1]"><ScanLine className="h-4 w-4" />Check in a guest</Link></div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">{views.map(({ key, label, Icon }) => <button key={key} type="button" aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }} className={`min-w-0 rounded-2xl border border-solid px-4 py-3 text-left transition ${view === key ? "border-[#5eead4] bg-[#5eead4]/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"}`}><span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55"><Icon className="h-3.5 w-3.5 text-[#5eead4]" />{label}</span><span className="mt-1 block text-2xl font-bold tabular-nums text-white">{bookings === null ? "…" : counts[key]}</span></button>)}</div>
      </div>
    </header>

    {requestMessage && <div role={requestMessage.ok ? "status" : "alert"} className={`rounded-xl border border-solid px-4 py-3 text-sm ${requestMessage.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{requestMessage.text}</div>}
    {error && bookings !== null && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><span>Live updates are paused. Showing the last loaded bookings.</span><button type="button" onClick={() => refresh.current?.()} className="font-bold underline">Try again</button></div>}

    {bookings === null ? <div role="status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((key) => <div key={key} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"><div className="h-5 w-28 rounded bg-slate-100" /><div className="mt-6 h-6 w-3/4 rounded bg-slate-100" /><div className="mt-4 h-4 w-1/2 rounded bg-slate-100" /><div className="mt-12 h-9 w-full rounded bg-slate-100" /></div>)}<span className="sr-only">Loading recent bookings</span>{error && <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not load bookings. Retrying automatically. <button type="button" onClick={() => refresh.current?.()} className="font-bold underline">Try now</button></div>}</div>
      : bookings.length === 0 ? <section className="rounded-2xl border border-solid border-slate-200 bg-white p-7 sm:p-9"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-[#02665e]"><CalendarDays className="h-6 w-6" /></span><h2 className="m-0 mt-4 text-lg font-bold text-slate-900">No recent bookings yet</h2><p className="m-0 mt-1.5 max-w-md text-sm leading-6 text-slate-500">Confirmed bookings for your properties will appear here. You can also browse the full booking history.</p><Link href="/owner/bookings" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#02665e] no-underline hover:underline">All bookings <ArrowRight className="h-4 w-4" /></Link></section>
      : <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-sm text-slate-600"><span className="font-bold text-slate-900">{filtered.length}</span> {filtered.length === 1 ? "booking" : "bookings"} in this view</p><label className="relative block w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><span className="sr-only">Search recent bookings</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search guest, reference, property" className="h-10 w-full rounded-xl border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" /></label></div>
        {filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">No bookings match this view. <button type="button" onClick={() => { setView("all"); setQuery(""); setPage(1); }} className="border-0 bg-transparent p-0 font-bold text-[#02665e] underline">Show all recent bookings</button></div>
          : <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">{visible.map((booking) => <BookingCard key={booking.id} booking={booking} requesting={requestingId === booking.id} onRequestCode={() => void requestGuestCode(booking.id)} />)}</ul>}
        {filtered.length > PAGE_SIZE && <nav className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3 text-xs text-slate-600" aria-label="Recent booking pages"><span>Showing <strong className="text-slate-900">{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}</strong> of <strong className="text-slate-900">{filtered.length}</strong></span><div className="flex items-center gap-2"><button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Previous</button><span className="tabular-nums">{safePage} / {totalPages}</span><button type="button" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Next</button></div></nav>}
      </>}
  </div>;
}

function BookingCard({ booking, requesting, onRequestCode }: { booking: Booking; requesting: boolean; onRequestCode: () => void }) {
  const status = statusInfo[booking.status] ?? { label: booking.status.replaceAll("_", " "), chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400" };
  const guest = booking.guestName || booking.customerName || "Guest name unavailable";
  const phone = booking.guestPhone || booking.phone;
  const reference = booking.bookingReference || `#${booking.id}`;
  return <li className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)] transition hover:border-emerald-200 hover:shadow-md">
    <div className="flex-1 p-5">
      <div className="flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${status.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span><span className="text-[10px] font-medium text-slate-400">{dateLabel(booking.createdAt)}</span></div>
      <h2 className="m-0 mt-4 truncate text-base font-bold text-slate-900" title={guest}>{guest}</h2>
      <p className="m-0 mt-1 truncate text-xs font-medium text-slate-500" title={booking.property?.title || ""}>{booking.property?.title || "Property"}</p>
      <p className="m-0 mt-3 break-all font-mono text-[11px] text-slate-500">{reference}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 border-0 border-t border-solid border-slate-100 pt-4"><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Check-in</p><p className="m-0 mt-1 text-sm font-semibold text-slate-800">{dateLabel(booking.checkIn)}</p></div><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Check-out</p><p className="m-0 mt-1 text-sm font-semibold text-slate-800">{dateLabel(booking.checkOut)}</p></div><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Room</p><p className="m-0 mt-1 text-sm font-semibold text-slate-800">{booking.roomType || "Not assigned"}</p></div><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Phone</p>{phone ? <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-[#02665e] no-underline hover:underline"><Phone className="h-3.5 w-3.5" />{phone}</a> : <p className="m-0 mt-1 text-sm text-slate-500">Unavailable</p>}</div></div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-3"><Link href={`/owner/bookings/checked-in/${encodeURIComponent(reference)}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#012a26] px-3 text-xs font-bold text-white no-underline transition hover:bg-[#02665e] hover:text-white"><Eye className="h-3.5 w-3.5" />View booking</Link>{booking.status === "CONFIRMED" && <><Link href="/owner/bookings/validate" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-emerald-200 bg-white px-3 text-xs font-semibold text-[#02665e] no-underline hover:bg-emerald-50"><ScanLine className="h-3.5 w-3.5" />Check in</Link><button type="button" disabled={requesting} onClick={onRequestCode} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">{requesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{requesting ? "Requesting…" : "Ask for code"}</button></>}</div>
  </li>;
}
