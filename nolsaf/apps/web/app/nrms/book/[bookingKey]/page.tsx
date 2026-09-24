"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, BedDouble, CalendarDays, Check, CheckCircle2, ChevronRight, Instagram, Loader2, Mail, MessageCircle, Minus, Phone, Plus, ShieldCheck, Users, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import NrmsPoweredByFooter from "@/components/nrms/NrmsPoweredByFooter";

const inputClass = "box-border min-h-11 w-full min-w-0 rounded-lg border border-neutral-300 bg-white px-3.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const dayOffset = (offset: number) => { const value = new Date(); value.setDate(value.getDate() + offset); return value.toISOString().slice(0, 10); };
const addDay = (iso: string) => { const value = new Date(`${iso}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); };
const money = (value: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const boxStyle = `#nrms-book *{box-sizing:border-box}#nrms-book input[type=checkbox]{appearance:none;-webkit-appearance:none;width:1.05rem;height:1.05rem;flex:0 0 auto;margin-top:1px;border:1.5px solid #cbd5e1;border-radius:5px;background:#fff;cursor:pointer;position:relative;transition:border-color .15s,background-color .15s}#nrms-book input[type=checkbox]:hover{border-color:#059669}#nrms-book input[type=checkbox]:checked{background:#059669;border-color:#059669}#nrms-book input[type=checkbox]:checked::after{content:"";position:absolute;left:5px;top:1.5px;width:4px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}`;
const directSources = ["DIRECT", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "EMAIL", "TELEGRAM", "QR", "OTHER"] as const;
type DirectSource = typeof directSources[number];
const browserSource = (): DirectSource => {
  if (typeof window === "undefined") return "DIRECT";
  const value = String(new URLSearchParams(window.location.search).get("source") || "DIRECT").toUpperCase();
  return directSources.includes(value as DirectSource) ? value as DirectSource : "OTHER";
};

export default function DirectBookingPage({ params }: { params: Promise<{ bookingKey: string }> }) {
  const { bookingKey } = use(params);
  const [source] = useState<DirectSource>(browserSource);
  const [search, setSearch] = useState({ checkIn: dayOffset(1), checkOut: dayOffset(2), adults: "2", children: "0" });
  const [quote, setQuote] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [guest, setGuest] = useState({ fullName: "", phone: "", email: "", nationality: "" });
  const [accepted, setAccepted] = useState(false);
  const [hold, setHold] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inquiryBusy, setInquiryBusy] = useState(false);
  const [inquiryFeedback, setInquiryFeedback] = useState<string | null>(null);
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [sessionRef] = useState(() => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `nrms-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const holdRequestId = useRef(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString().slice(-12).padStart(12, "0")}`);
  const opened = useRef(false);

  const recordEvent = useCallback(async (event: "PAGE_OPEN" | "ROOM_SELECTED" | "INSTAGRAM_CLICK" | "WHATSAPP_CLICK" | "PHONE_CLICK" | "EMAIL_CLICK") => {
    try { await apiClient.post(`/api/public/nrms/guest/direct/${encodeURIComponent(bookingKey)}/events`, { event, source }); } catch { /* Contact and booking actions must continue when analytics is unavailable. */ }
  }, [bookingKey, source]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSelected(null);
    try { const response = await apiClient.get(`/api/public/nrms/guest/direct/${encodeURIComponent(bookingKey)}`, { params: { ...search, source } }); setQuote(response.data); }
    catch (requestError: any) { setQuote(null); setError(requestError?.response?.data?.error || "Live rates are unavailable."); }
    finally { setLoading(false); }
  }, [bookingKey, search, source]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!opened.current) { opened.current = true; void recordEvent("PAGE_OPEN"); } }, [recordEvent]);

  const validGuest = useMemo(() => guest.fullName.trim().length >= 2 && guest.phone.trim().length >= 7 && accepted, [accepted, guest]);
  const remainingBalance = selected ? Math.max(0, Number(selected.total || 0) - Number(selected.depositAmount || 0)) : 0;
  const contactMessage = useMemo(() => {
    const property = quote?.property?.title || "the hotel";
    const room = selected?.roomType?.name ? ` I am interested in ${selected.roomType.name}.` : "";
    const stay = ` ${search.adults} guest${Number(search.adults) === 1 ? "" : "s"}, ${search.checkIn} to ${search.checkOut}.`;
    const hello = quote?.contact?.preferredLanguage === "SW" ? "Habari" : quote?.contact?.preferredLanguage === "EN" ? "Hello" : "Habari / Hello";
    return `${hello} ${property}.${stay}${room} Please help me with this stay.`;
  }, [quote, search, selected]);
  const canRequestReception = guest.fullName.trim().length >= 2 && (guest.phone.trim().length >= 7 || guest.email.includes("@"));
  const captureInquiry = useCallback(async (channel: "WEB" | "INSTAGRAM" | "WHATSAPP" | "PHONE" | "EMAIL", message?: string) => {
    if (channel === "WEB") setInquiryBusy(true);
    try {
      const response = await apiClient.post(`/api/public/nrms/guest/direct/${encodeURIComponent(bookingKey)}/inquiries`, {
        sessionRef, channel, source, guestName: guest.fullName.trim() || null, guestPhone: guest.phone.trim() || null, guestEmail: guest.email.trim() || null,
        checkIn: search.checkIn, checkOut: search.checkOut, adults: Number(search.adults), children: Number(search.children), roomTypeId: selected?.roomType?.id ?? null,
        message: message || null,
      });
      if (channel === "WEB") setInquiryFeedback(`Reception request sent · ${response.data?.inquiry?.reference || "received"}. ${response.data?.acknowledgement?.message || "Reception will contact you shortly."}`);
    } catch (requestError: any) {
      if (channel === "WEB") setInquiryFeedback(requestError?.response?.data?.error || "Reception could not receive the request. Please use another contact option.");
    } finally { if (channel === "WEB") setInquiryBusy(false); }
  }, [bookingKey, guest, search, selected, sessionRef, source]);
  const setCheckIn = (iso: string) => setSearch((current) => ({ ...current, checkIn: iso, checkOut: current.checkOut > iso ? current.checkOut : addDay(iso) }));
  const setAdults = (next: number) => setSearch((current) => ({ ...current, adults: String(Math.min(20, Math.max(1, next))) }));

  const createHold = async () => {
    if (!selected || !validGuest) return;
    setLoading(true); setError(null);
    try {
      const response = await apiClient.post(`/api/public/nrms/guest/direct/${encodeURIComponent(bookingKey)}/hold`, { clientRequestId: holdRequestId.current, ...search, source, adults: Number(search.adults), children: Number(search.children), roomTypeId: selected.roomType.id, ratePlanId: selected.ratePlan?.id ?? null, guest: { fullName: guest.fullName, phone: guest.phone, email: guest.email || null, nationality: guest.nationality || null }, termsAccepted: true });
      setHold(response.data.hold);
    } catch (requestError: any) { setError(requestError?.response?.data?.error || "The room could not be held."); }
    finally { setLoading(false); }
  };

  if (hold) return (
    <main id="nrms-book" className="min-h-screen bg-neutral-100 px-4 py-10">
      <style dangerouslySetInnerHTML={{ __html: boxStyle }} />
      <section className="mx-auto w-full max-w-xl overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <header className="border-b border-neutral-100 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-800 text-white"><CheckCircle2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Reservation status</p>
              <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">Your room is held</h1>
              <p className="mb-0 mt-1.5 text-xs leading-5 text-neutral-500">A temporary hold is active. Complete the deposit before it expires.</p>
            </div>
          </div>
        </header>

        <div className="p-5 sm:p-7">
          <div aria-label="Reservation hold card" className="relative isolate min-h-[15rem] overflow-hidden rounded-xl border border-slate-700/60 bg-[linear-gradient(135deg,#111827_0%,#123c38_54%,#065f46_100%)] p-5 text-white shadow-[0_18px_38px_rgba(15,23,42,0.22)] sm:p-6">
            <div className="pointer-events-none absolute -right-16 -top-24 -z-10 h-64 w-64 rounded-full border border-white/10 bg-white/[0.035]" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 -z-10 h-52 w-52 rounded-full border border-emerald-200/10 bg-emerald-300/[0.04]" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-0 -z-10 opacity-30 [background-image:linear-gradient(115deg,transparent_0%,transparent_45%,rgba(255,255,255,0.09)_45%,rgba(255,255,255,0.02)_64%,transparent_64%)]" aria-hidden="true" />

            <div className="flex items-start justify-between gap-4">
              <span className="relative block h-8 w-11 shrink-0 overflow-hidden rounded-md border border-amber-100/60 bg-[linear-gradient(135deg,#f4dfa3,#c9a859)] shadow-sm" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 border-l border-amber-900/30" />
                <span className="absolute inset-x-0 top-1/2 border-t border-amber-900/30" />
                <span className="absolute inset-y-1 left-1 right-1 rounded-sm border border-amber-900/20" />
              </span>
              <div className="text-right">
                <p className="m-0 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-100/75">NRMS direct reservation</p>
                <p className="mb-0 mt-1 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200"><CheckCircle2 className="h-3 w-3" />Hold active</p>
              </div>
            </div>

            <div className="mt-7">
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-white/55">Deposit required</p>
              <p className="mb-0 mt-1 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">{money(hold.depositAmount, hold.currency)}</p>
              <p className="mb-0 mt-1.5 text-[11px] text-emerald-100/70">Pay the property directly to confirm your booking</p>
            </div>

            <div className="mt-7 grid grid-cols-[minmax(0,1fr)_auto] gap-5 border-t border-white/15 pt-4">
              <div className="min-w-0">
                <p className="m-0 text-[8px] font-bold uppercase tracking-[0.15em] text-white/45">Booking reference</p>
                <p className="mb-0 mt-1 break-all font-mono text-[10px] font-bold tracking-wide text-white/90 sm:text-xs">{hold.reference}</p>
              </div>
              <div className="text-right">
                <p className="m-0 text-[8px] font-bold uppercase tracking-[0.15em] text-white/45">Expires at</p>
                <p className="mb-0 mt-1 text-xs font-bold text-white sm:text-sm">{new Date(hold.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Next step</p>
            <a href={`/nrms/guest/payment/${hold.paymentToken}`} className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 text-sm font-bold text-white no-underline transition hover:bg-emerald-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">Pay deposit securely <ChevronRight className="h-4 w-4" /></a>
          </div>

          <div className="mt-5 flex items-start gap-2.5 border-t border-neutral-200 pt-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <p className="m-0 text-[11px] leading-5 text-neutral-500">This hold is not yet a confirmed booking. Confirmation is issued when the property records your deposit.</p>
          </div>
        </div>
      </section>
      <NrmsPoweredByFooter className="max-w-xl" />
    </main>
  );

  return (
    <main id="nrms-book" className="min-h-screen bg-neutral-50">
      <style dangerouslySetInnerHTML={{ __html: boxStyle }} />
      <header className="relative mx-3 mt-3 overflow-hidden rounded-xl border border-emerald-950/15 bg-[linear-gradient(118deg,#063b34_0%,#07584b_58%,#0b433c_100%)] text-white shadow-[0_12px_34px_rgba(6,59,52,0.14)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(110,231,183,0.22),transparent_32%),linear-gradient(135deg,transparent_46%,rgba(52,211,153,0.10)_46%,rgba(52,211,153,0.10)_66%,transparent_66%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[48%] opacity-45 [background-image:radial-gradient(rgba(167,243,208,0.34)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-20 top-10 h-72 w-72 rounded-t-full border border-emerald-100/15" aria-hidden="true" />
        <div className="pointer-events-none absolute right-7 top-24 h-48 w-36 rounded-t-[6rem] border border-emerald-100/15 bg-emerald-200/[0.035]" aria-hidden="true" />

        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-9 sm:px-6 sm:py-11 lg:grid-cols-[1fr_19rem] lg:items-center">
          <div className="flex min-w-0 items-start gap-4 sm:gap-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/60 bg-emerald-50 text-emerald-900 shadow-[0_12px_28px_rgba(0,0,0,0.14)] sm:h-14 sm:w-14"><BedDouble className="h-6 w-6" /></span>
            <div className="min-w-0">
              <p className="m-0 inline-flex items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-emerald-100"><BadgeCheck className="h-3.5 w-3.5" />Official direct booking</p>
              <h1 className="mb-0 mt-3 text-3xl font-bold leading-[1.08] tracking-[-0.035em] text-white sm:text-4xl lg:text-[2.65rem]">{quote?.property?.title || "Live room availability"}</h1>
              <p className="mb-0 mt-3 max-w-2xl text-sm leading-6 text-emerald-50/70 sm:text-[15px]">See the property’s live inventory, choose a transparent hotel rate and reserve without a third-party checkout.</p>
            </div>
          </div>

          <aside className="hidden border border-white/15 bg-white/[0.075] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.12)] backdrop-blur-sm lg:block">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <p className="m-0 text-xs font-bold text-white">Book with confidence</p>
            </div>
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><div><p className="m-0 text-[11px] font-bold text-white">Inventory confirmed live</p><p className="mb-0 mt-0.5 text-[10px] text-emerald-50/55">Availability comes from the hotel calendar.</p></div></div>
              <div className="flex items-start gap-2.5"><Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><div><p className="m-0 text-[11px] font-bold text-white">Payment stays direct</p><p className="mb-0 mt-0.5 text-[10px] text-emerald-50/55">You pay the property using its instructions.</p></div></div>
            </div>
          </aside>
        </div>

        <div className="relative border-0 border-t border-solid border-[#ccded4] bg-[linear-gradient(180deg,#f8fbf9,#edf5f0)] px-3 py-3 sm:px-6 sm:py-4">
          <ul aria-label="Direct booking benefits" className="m-0 mx-auto grid max-w-6xl list-none grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-[#d5e3da] bg-[#d5e3da] p-0 shadow-[0_3px_10px_-5px_rgba(6,78,59,0.16)] lg:grid-cols-4">
            {([
              [CheckCircle2, "Live availability", "Checked against the hotel calendar"],
              [BadgeCheck, "Hotel-direct rates", "Rates from the property"],
              [ShieldCheck, "Secure 30-minute hold", "Time to complete your reservation"],
              [Wallet, "Pay the property directly", "Follow the hotel’s payment instructions"],
            ] as const).map(([Icon, title, description]) => (
              <li key={title} className="flex min-w-0 flex-col items-start gap-2.5 bg-white/95 p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-solid border-[#d2e5d9] bg-[linear-gradient(145deg,#f0faf4,#e0f0e7)] text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-xs font-bold leading-5 text-[#183e32]">{title}</p>
                  <p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[1.35fr_.65fr]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_160px] lg:items-end">
              <div className="grid min-w-0 gap-1.5"><span className="flex items-center gap-1.5 text-xs font-bold text-neutral-700"><CalendarDays className="h-3.5 w-3.5" />Check in</span><DatePickerField label="Check-in date" value={search.checkIn} onChangeAction={setCheckIn} min={dayOffset(0)} allowPast={false} widthClassName="w-full" /></div>
              <div className="grid min-w-0 gap-1.5"><span className="flex items-center gap-1.5 text-xs font-bold text-neutral-700"><CalendarDays className="h-3.5 w-3.5" />Check out</span><DatePickerField label="Check-out date" value={search.checkOut} onChangeAction={(iso) => setSearch((current) => ({ ...current, checkOut: iso }))} min={addDay(search.checkIn)} allowPast={false} widthClassName="w-full" /></div>
              <div className="grid min-w-0 gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-neutral-700"><Users className="h-3.5 w-3.5" />Adults</span>
                <div className="flex h-12 items-center justify-between rounded-xl border border-neutral-300 bg-white px-1.5">
                  <button type="button" aria-label="Fewer adults" onClick={() => setAdults(Number(search.adults) - 1)} disabled={Number(search.adults) <= 1} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                  <span className="min-w-8 text-center text-sm font-bold text-neutral-900">{search.adults}</span>
                  <button type="button" aria-label="More adults" onClick={() => setAdults(Number(search.adults) + 1)} disabled={Number(search.adults) >= 20} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
            <button type="button" disabled={loading} onClick={() => void load()} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-0 bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:bg-neutral-300">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4" />Search rooms</>}</button>
          </section>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <section className="space-y-3">
            {quote?.quotes?.length ? quote.quotes.map((item: any) => {
              const active = selected === item;
              return (
                <button type="button" key={`${item.roomType.id}-${item.ratePlan?.id || 0}`} onClick={() => { setSelected(item); void recordEvent("ROOM_SELECTED"); }} aria-pressed={active} className={`w-full overflow-hidden rounded-xl border bg-white text-left shadow-sm transition ${active ? "border-emerald-600 ring-2 ring-emerald-100" : "border-neutral-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"}`}>
                  <div className="flex min-w-0 gap-3.5 p-4 sm:p-5">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${active ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}><BedDouble className="h-5 w-5" /></span>
                    <div className="min-w-0 self-center">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-base font-bold text-neutral-950">{item.roomType.name}</h2>{active && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"><Check className="h-3 w-3" />Selected</span>}</div>
                      <p className="mb-0 mt-1 text-xs text-neutral-500">{item.ratePlan?.name || "Standard rate"} · {item.ratePlan?.mealPlan?.replaceAll("_", " ").toLowerCase() || "room only"}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-500"><span>Up to {item.roomType.capacityAdults} adults</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{item.available} {item.available === 1 ? "room" : "rooms"} available</span></div>
                    </div>
                  </div>
                  <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-3.5 sm:px-5 ${active ? "border-emerald-200 bg-emerald-50/70" : "border-neutral-200 bg-neutral-50/70"}`}>
                    <div className="min-w-0">
                      <p className="m-0 text-[8px] font-bold uppercase tracking-[0.14em] text-neutral-400">Stay total</p>
                      <p className="mb-0 mt-0.5 text-xl font-bold tracking-tight text-neutral-950">{money(item.total, item.currency)}</p>
                      <p className="mb-0 mt-0.5 text-[9px] leading-4 text-neutral-500">{quote.nights} night{quote.nights === 1 ? "" : "s"} · taxes and fees included</p>
                    </div>
                    <div className="min-w-[7.5rem] border-l border-neutral-200 pl-4 text-right">
                      <p className="m-0 text-[8px] font-bold uppercase tracking-[0.14em] text-neutral-400">Required deposit</p>
                      <p className="mb-0 mt-0.5 text-sm font-bold text-emerald-700">{money(item.depositAmount, item.currency)}</p>
                      <span className={`mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold ${active ? "text-emerald-700" : "text-neutral-600"}`}>{active ? <><Check className="h-3 w-3" />Selected</> : <>Select room<ChevronRight className="h-3 w-3" /></>}</span>
                    </div>
                  </div>
                </button>
              );
            }) : quote && <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-5 py-12 text-center text-sm text-neutral-500">No rooms match these dates and guest counts.</div>}
          </section>
        </div>

        <aside className="min-w-0">
          <div className="space-y-4">
            {quote?.contact && <section className="mb-5 overflow-hidden rounded-xl border border-emerald-900/10 bg-[#f6faf8] text-neutral-950 shadow-[0_12px_26px_-22px_rgba(6,78,59,0.45)]" aria-labelledby="reception-contact-title">
              <div className="flex items-start gap-3 border-b border-emerald-950/10 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-800 text-white shadow-sm"><MessageCircle className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[.15em] text-emerald-700">Reception support</p>
                  <h2 id="reception-contact-title" className="mb-0 mt-1 text-base font-bold text-neutral-950">Need help choosing a room?</h2>
                  <p className="mb-0 mt-1 line-clamp-2 text-[11px] leading-[1.15rem] text-neutral-600">{quote.contact.greeting || "Ask about rooms, arrival details or special requests before reserving."}</p>
                  {quote.contact.contactHours && <p className="mb-0 mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-800"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />Available {quote.contact.contactHours}</p>}
                </div>
              </div>

              <div className="border-b border-emerald-950/10 p-4">
                {quote.contact.whatsappPhone ? (
                  <a href={`https://wa.me/${String(quote.contact.whatsappPhone).replace(/\D/g, "")}?text=${encodeURIComponent(contactMessage)}`} target="_blank" rel="noreferrer" onClick={() => { void recordEvent("WHATSAPP_CLICK"); }} className="inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-emerald-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"><span className="inline-flex items-center gap-2.5"><MessageCircle className="h-[18px] w-[18px]" />Chat on WhatsApp</span><ChevronRight className="h-4 w-4" /></a>
                ) : quote.contact.receptionPhone ? (
                  <a href={`tel:${quote.contact.receptionPhone}`} onClick={() => { void recordEvent("PHONE_CLICK"); void captureInquiry("PHONE"); }} className="inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-emerald-800 hover:text-white"><span className="inline-flex items-center gap-2.5"><Phone className="h-[18px] w-[18px]" />Call reception</span><ChevronRight className="h-4 w-4" /></a>
                ) : quote.contact.receptionEmail ? (
                  <a href={`mailto:${quote.contact.receptionEmail}?subject=${encodeURIComponent(`Stay enquiry · ${quote.property.title}`)}&body=${encodeURIComponent(contactMessage)}`} onClick={() => { void recordEvent("EMAIL_CLICK"); void captureInquiry("EMAIL"); }} className="inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-emerald-800 hover:text-white"><span className="inline-flex items-center gap-2.5"><Mail className="h-[18px] w-[18px]" />Email reception</span><ChevronRight className="h-4 w-4" /></a>
                ) : quote.contact.instagramUsername ? (
                  <a href={`https://ig.me/m/${encodeURIComponent(String(quote.contact.instagramUsername).replace(/^@/, ""))}`} target="_blank" rel="noreferrer" onClick={() => { void recordEvent("INSTAGRAM_CLICK"); }} className="inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-emerald-800 hover:text-white"><span className="inline-flex items-center gap-2.5"><Instagram className="h-[18px] w-[18px]" />Message reception</span><ChevronRight className="h-4 w-4" /></a>
                ) : null}
              </div>

              {(quote.contact.whatsappPhone
                ? Boolean(quote.contact.receptionPhone || quote.contact.receptionEmail || quote.contact.instagramUsername)
                : quote.contact.receptionPhone
                  ? Boolean(quote.contact.receptionEmail || quote.contact.instagramUsername)
                  : quote.contact.receptionEmail
                    ? Boolean(quote.contact.instagramUsername)
                    : false) && (
                <div className="border-b border-emerald-950/10 px-4 py-3.5">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[.12em] text-neutral-400">Other ways to connect</p>
                  <div className="mt-2 grid grid-flow-col auto-cols-fr gap-2">
                    {quote.contact.receptionPhone && quote.contact.whatsappPhone && <a href={`tel:${quote.contact.receptionPhone}`} title={quote.contact.receptionPhone} onClick={() => { void recordEvent("PHONE_CLICK"); void captureInquiry("PHONE"); }} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-600 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"><Phone className="h-3.5 w-3.5" />Call</a>}
                    {quote.contact.receptionEmail && (quote.contact.whatsappPhone || quote.contact.receptionPhone) && <a href={`mailto:${quote.contact.receptionEmail}?subject=${encodeURIComponent(`Stay enquiry · ${quote.property.title}`)}&body=${encodeURIComponent(contactMessage)}`} onClick={() => { void recordEvent("EMAIL_CLICK"); void captureInquiry("EMAIL"); }} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-600 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"><Mail className="h-3.5 w-3.5" />Email</a>}
                    {quote.contact.instagramUsername && (quote.contact.whatsappPhone || quote.contact.receptionPhone || quote.contact.receptionEmail) && <a href={`https://ig.me/m/${encodeURIComponent(String(quote.contact.instagramUsername).replace(/^@/, ""))}`} target="_blank" rel="noreferrer" onClick={() => { void recordEvent("INSTAGRAM_CLICK"); }} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-600 no-underline transition hover:border-fuchsia-300 hover:bg-fuchsia-50 hover:text-fuchsia-700"><Instagram className="h-3.5 w-3.5" />Instagram</a>}
                  </div>
                </div>
              )}

              <div className="p-3.5">
                <button type="button" aria-expanded={callbackOpen} onClick={() => { setCallbackOpen((current) => !current); setInquiryFeedback(null); }} className="inline-flex min-h-9 w-full cursor-pointer items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 text-left text-[11px] font-semibold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"><span className="inline-flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-emerald-700" />Ask reception to contact you</span><ChevronRight className={`h-3.5 w-3.5 transition-transform ${callbackOpen ? "rotate-90" : ""}`} /></button>
                {callbackOpen && <div className="mt-3 grid gap-2.5 rounded-lg bg-white p-3 ring-1 ring-neutral-200">
                  <input aria-label="Your name for the callback" className={`${inputClass} !min-h-10 !text-xs`} placeholder="Your name" value={guest.fullName} onChange={(event) => setGuest({ ...guest, fullName: event.target.value })} />
                  <div className="grid grid-cols-2 gap-2">
                    <input aria-label="Phone for the callback" className={`${inputClass} !min-h-10 !text-xs`} placeholder="Phone" value={guest.phone} onChange={(event) => setGuest({ ...guest, phone: event.target.value })} />
                    <input aria-label="Email for the callback" type="email" className={`${inputClass} !min-h-10 !text-xs`} placeholder="Email (optional)" value={guest.email} onChange={(event) => setGuest({ ...guest, email: event.target.value })} />
                  </div>
                  <button type="button" disabled={!canRequestReception || inquiryBusy} onClick={() => void captureInquiry("WEB", "Please contact me about this stay and the selected availability.")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-0 bg-neutral-900 px-3.5 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500">{inquiryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}Request a callback</button>
                  {inquiryFeedback && <p className={`m-0 px-1 text-[10px] leading-4 ${inquiryFeedback.startsWith("Reception request sent") ? "text-emerald-700" : "text-red-600"}`}>{inquiryFeedback}</p>}
                </div>}
              </div>
            </section>}
            <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" aria-labelledby="guest-details-title">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600"><Users className="h-5 w-5" aria-hidden="true" /></span>
              <div><h2 id="guest-details-title" className="m-0 text-base font-bold text-neutral-950">Guest details</h2><p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Your details for the reservation</p></div>
            </div>
            <p className="mb-0 mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[11px] leading-5 text-emerald-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Select a room, then secure a 30-minute hold.</p>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-xs font-bold text-neutral-700"><span>Full name <span className="text-red-500">*</span></span><input className={inputClass} placeholder="Guest full name" value={guest.fullName} onChange={(event) => setGuest({ ...guest, fullName: event.target.value })} /></label>
              <label className="grid gap-1.5 text-xs font-bold text-neutral-700"><span>Phone <span className="text-red-500">*</span></span><input className={inputClass} placeholder="07xx xxx xxx" value={guest.phone} onChange={(event) => setGuest({ ...guest, phone: event.target.value })} /></label>
              <label className="grid gap-1.5 text-xs font-bold text-neutral-700">Email, optional<input type="email" className={inputClass} placeholder="name@email.com" value={guest.email} onChange={(event) => setGuest({ ...guest, email: event.target.value })} /></label>
              <label className="flex items-start gap-2.5 text-xs leading-5 text-neutral-600"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I accept the property’s rate, cancellation and direct-payment terms shown for this stay.</span></label>
            </div>
            {selected && (
              <section aria-labelledby="selected-room-title" className="mt-5 overflow-hidden rounded-xl border border-solid border-[#c9d2c9] bg-[#faf9f5] shadow-[0_8px_24px_-12px_rgba(16,48,39,0.25)]">
                <div className="flex items-center gap-3 border-0 border-b-2 border-solid border-[#b7a77b] bg-[linear-gradient(115deg,#103c32,#1d5546)] px-4 py-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-solid border-white/20 bg-white/10 text-[#e0d8bc]"><BedDouble className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-[#d1dccf]">Your selected room</p>
                    <h3 id="selected-room-title" className="mb-0 mt-1 break-words text-base font-bold leading-5 text-white">{selected.roomType.name}</h3>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-solid border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white"><CalendarDays className="h-3 w-3" aria-hidden="true" />{quote?.nights} night{quote?.nights === 1 ? "" : "s"}</span>
                </div>

                <div className="px-4 pb-5 pt-5">
                  <div>
                    <p className="m-0 text-xs font-medium text-neutral-600">Total for your stay</p>
                    <p className="mb-0 mt-1 break-words text-[28px] font-bold leading-tight tracking-tight text-neutral-950 tabular-nums">{money(selected.total, selected.currency)}</p>
                    <p className="mb-0 mt-1.5 inline-flex items-center gap-1.5 text-[10px] leading-4 text-neutral-500"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />Taxes and fees included</p>
                  </div>

                  <dl className="mb-0 mt-4 overflow-hidden rounded-lg border border-solid border-[#d5dfd5] bg-white">
                    <div className="bg-[#edf3eb] p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <dt className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-950"><Wallet className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />Deposit required</dt>
                        <dd className="m-0 break-words text-lg font-bold tracking-tight text-emerald-800 tabular-nums">{money(selected.depositAmount, selected.currency)}</dd>
                      </div>
                      <p className="mb-0 mt-2 text-[11px] leading-[1.125rem] text-emerald-900/75">Pay directly to the property to confirm your booking.</p>
                    </div>
                    <div className="border-0 border-t border-solid border-[#d5dfd5] bg-white p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <dt className="text-xs font-medium text-neutral-600">Remaining balance</dt>
                        <dd className="m-0 break-words text-sm font-semibold text-neutral-800 tabular-nums">{money(remainingBalance, selected.currency)}</dd>
                      </div>
                      <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Paid later to the property</p>
                    </div>
                  </dl>
                </div>
              </section>
            )}
            <button type="button" disabled={!selected || !validGuest || loading} onClick={() => void createHold()} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-0 bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:bg-neutral-200 disabled:text-neutral-500">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Hold room and continue</button>
            <p className="mb-0 mt-4 text-[10px] leading-4 text-neutral-400">A hold is not a confirmed booking. The property confirms after it records the required direct payment.</p>
            </section>
          </div>
        </aside>
      </div>
      <NrmsPoweredByFooter />
    </main>
  );
}
