"use client";

/**
 * An Agency Desk quote as the client sees it (docs/SALES_AGENCY_QUOTES_STRATEGY.md).
 * No sign-in: the link went to the client's phone. The client picks one option
 * and pays NoLSAF through the normal booking and payment pages; the sales
 * partner never collects money.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, BedDouble, CalendarDays, CheckCircle2, Clock3, Loader2, MapPin, PhoneCall, ShieldCheck, UserRound, Users, Zap } from "lucide-react";
import apiClient from "@/lib/apiClient";

const SUPPORT_PHONE = "+255 736 766 726";
const SUPPORT_TEL = `tel:${SUPPORT_PHONE.replace(/\s/g, "")}`;

type Electricity = { mode: "GUEST_PAYS" | "LIMITED" | "INCLUDED"; perDayTzs: number | null; freeUnitsPerDay: number | null } | null;
type Option = {
  position: number; propertyId: number; available: boolean; title: string; slug: string | null; location: string | null; photo: string | null;
  roomCode: string | null; roomLabel: string | null; rooms: number; checkIn: string; checkOut: string; nights: number; adults: number; children: number;
  total: number; currency: string; electricity: Electricity;
};
type Quote = {
  status: "SENT" | "VIEWED" | "PAYING" | "PAID" | "EXPIRED" | "CANCELLED";
  expiresAt: string; clientName: string; clientPhone: string; note: string | null; partnerName: string; partnerCode: string | null;
  chosenPosition: number | null; options: Option[];
};

const money = (currency: string, n: number) => `${currency === "TZS" ? "TSh" : currency} ${Math.round(n).toLocaleString("en-US")}`;
const day = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const eat = (v: string) => `${new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" })} EAT`;

function tidy(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function electricityLine(rule: Electricity): string | null {
  if (!rule || rule.mode === "INCLUDED") return null;
  const estimate = rule.perDayTzs ? ` (about TSh ${rule.perDayTzs.toLocaleString("en-US")} a day)` : "";
  return rule.mode === "LIMITED"
    ? `Electricity is included up to ${rule.freeUnitsPerDay} units a day; you buy LUKU tokens for anything more${estimate}.`
    : `Electricity is not included: you buy LUKU tokens for your stay${estimate}.`;
}

export default function AgencyQuotePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [missing, setMissing] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [acceptPower, setAcceptPower] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/public/agency-quote/${encodeURIComponent(token)}`)
      .then((response) => {
        if (!active) return;
        const data = response.data as Quote;
        setQuote(data);
        const firstAvailable = data.options.find((o) => o.available);
        setChosen(data.chosenPosition ?? (data.options.length === 1 && firstAvailable ? firstAvailable.position : null));
      })
      .catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [token]);

  const option = quote?.options.find((o) => o.position === chosen) ?? null;
  const power = option ? electricityLine(option.electricity) : null;
  const open = quote ? ["SENT", "VIEWED", "PAYING"].includes(quote.status) : false;
  const canPay = Boolean(open && option?.available && (!power || acceptPower));

  const pay = async () => {
    if (!quote || !option) return;
    setPaying(true);
    setError("");
    try {
      const booking = await apiClient.post("/api/public/bookings", {
        propertyId: option.propertyId,
        checkIn: option.checkIn,
        checkOut: option.checkOut,
        guestName: quote.clientName,
        guestPhone: quote.clientPhone,
        rooms: option.rooms,
        roomCode: option.roomCode,
        adults: option.adults,
        children: option.children,
        acceptElectricity: power ? acceptPower : undefined,
        agencyQuote: { token, position: option.position },
      });
      const invoice = await apiClient.post("/api/public/invoices/from-booking", {
        bookingId: booking.data.bookingId,
        bookingAccessToken: booking.data.bookingAccessToken,
      });
      if (!invoice.data?.accessToken) throw new Error("no access token");
      const query = new URLSearchParams({ invoiceId: String(invoice.data.invoiceId), accessToken: String(invoice.data.accessToken) });
      router.push(`/public/booking/payment?${query.toString()}`);
    } catch (cause: any) {
      const data = cause?.response?.data;
      setError(data?.availability?.message || data?.error || data?.message || "We could not start the payment. Please try again.");
      setPaying(false);
    }
  };

  const partner = tidy(quote?.partnerName) || "Your NoLSAF sales partner";
  const first = tidy(quote?.clientName).split(/\s+/)[0] || "";

  const headline = !quote
    ? missing ? { title: "This link is not valid", sub: "It may have been replaced by a newer SMS, or cancelled." } : { title: "Opening your stay options", sub: "One moment." }
    : quote.status === "PAID" ? { title: "Paid, thank you", sub: "Your booking is confirmed. The details are in your SMS." }
    : quote.status === "EXPIRED" || quote.status === "CANCELLED" ? { title: "This quote has ended", sub: `Ask ${partner} for a new one.` }
    : { title: first ? `Habari ${first}, your stay options` : "Your stay options", sub: `Prepared by ${partner}. Choose one and pay NoLSAF.` };

  return (
    <main id="agency-quote" className="flex min-h-screen flex-col bg-slate-100">
      <style>{`#agency-quote, #agency-quote * { box-sizing: border-box; }`}</style>

      <header className="border-0 border-b border-solid border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
            <span className="text-[15px] font-bold text-slate-900">NoLSAF</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Pay NoLSAF only
          </span>
        </div>
      </header>

      <div className="bg-[#0b2420]">
        <div className="mx-auto w-full max-w-2xl px-4 pb-20 pt-6 text-white">
          <p className="m-0 text-[19px] font-bold leading-tight">{headline.title}</p>
          <p className="m-0 mt-1 text-[13px] text-white/65">{headline.sub}</p>
          {quote && open ? (
            <p className="m-0 mt-3 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/85">
              <Clock3 className="h-3.5 w-3.5" aria-hidden /> Valid until {eat(quote.expiresAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mx-auto -mt-16 w-full max-w-2xl flex-1 space-y-3 px-4 pb-8">
        {!quote ? (
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-5 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)]">
            {missing ? (
              <>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-600"><AlertTriangle className="h-5 w-5" /></span>
                  <p className="m-0 text-[13px] leading-5 text-slate-600">Use the latest SMS from NoLSAF, or ask your sales partner to send the options again. Never pay anyone outside a NoLSAF page.</p>
                </div>
                <a href={SUPPORT_TEL} className="mt-4 flex h-11 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"><PhoneCall className="h-4 w-4" /> Call NoLSAF support</a>
              </>
            ) : (
              <div className="grid min-h-32 place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
            )}
          </section>
        ) : (
          <>
            {quote.note ? (
              <section className="flex items-start gap-3 rounded-lg border border-solid border-slate-200 bg-white p-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-[#02665e]"><UserRound className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-xs font-semibold text-slate-500">{partner}{quote.partnerCode ? ` · ${quote.partnerCode}` : ""}</p>
                  <p className="m-0 mt-1 text-sm leading-5 text-slate-800">{quote.note}</p>
                </div>
              </section>
            ) : null}

            <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0" disabled={!open || paying}>
              <legend className="sr-only">Choose one option</legend>
              {quote.options.map((o) => {
                const on = chosen === o.position;
                const wasChosen = quote.chosenPosition === o.position;
                return (
                  <label key={o.position}
                    className={`block cursor-pointer overflow-hidden rounded-lg border border-solid bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)] ${on ? "border-[#02665e] ring-2 ring-[#02665e]/20" : "border-slate-200"} ${!o.available ? "cursor-not-allowed opacity-60" : ""}`}>
                    <div className="flex min-w-0 gap-3 p-3 sm:p-4">
                      <div className="h-20 w-24 shrink-0 overflow-hidden rounded-md bg-slate-100 sm:h-24 sm:w-32">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {o.photo ? <img src={o.photo} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="m-0 min-w-0 text-[15px] font-semibold leading-snug text-slate-900">
                            <span className="mr-1.5 text-slate-400">{o.position}.</span>{o.title}
                          </p>
                          <input type="radio" name="option" checked={on} disabled={!o.available} onChange={() => { setChosen(o.position); setAcceptPower(false); setError(""); }} className="mt-1 h-4 w-4 shrink-0 accent-[#02665e]" />
                        </div>
                        {o.location ? <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" />{o.location}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-slate-400" />{day(o.checkIn)} to {day(o.checkOut)} · {o.nights} night{o.nights === 1 ? "" : "s"}</span>
                          <span className="inline-flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 text-slate-400" />{o.rooms} x {o.roomLabel || "Room"}</span>
                          <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-slate-400" />{o.adults + o.children} guests</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="m-0 text-base font-bold tabular-nums text-slate-900">{money(o.currency, o.total)}</p>
                          {!o.available ? <span className="text-xs font-semibold text-rose-700">No longer available</span>
                            : wasChosen && quote.status === "PAYING" ? <span className="text-xs font-semibold text-amber-700">Payment started</span>
                            : o.slug ? <Link href={`/public/properties/${o.slug}`} target="_blank" className="text-xs font-semibold text-[#02665e] no-underline hover:underline">See the place</Link> : null}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </fieldset>

            {open ? (
              <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)]">
                <div className="p-4">
                  {power ? (
                    <label className="mb-3 flex items-start gap-2.5 rounded-md border border-solid border-amber-200 bg-amber-50 p-3 text-[13px] leading-5 text-amber-900">
                      <input type="checkbox" checked={acceptPower} onChange={(e) => setAcceptPower(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#02665e]" />
                      <span><Zap className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />{power} I understand.</span>
                    </label>
                  ) : null}
                  {error ? <p role="alert" className="m-0 mb-3 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
                  <button type="button" disabled={!canPay || paying} onClick={() => void pay()}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-[15px] font-semibold text-white hover:bg-[#014e47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                    {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {option ? `Pay ${money(option.currency, option.total)} to NoLSAF` : "Choose an option to pay"}
                  </button>
                  <p className="m-0 mt-2 text-center text-[11px] leading-4 text-slate-500">Rooms are not held until you pay. The final price shows on the payment page.</p>
                </div>
                <div className="flex items-start gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-3 text-[12px] leading-5 text-slate-600">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" />
                  <span>Pay NoLSAF only. Your sales partner never collects money. Questions? <a href={SUPPORT_TEL} className="font-semibold text-[#02665e] no-underline hover:underline">{SUPPORT_PHONE}</a></span>
                </div>
              </section>
            ) : (
              <a href={SUPPORT_TEL} className="flex h-11 items-center justify-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 no-underline hover:bg-slate-50"><PhoneCall className="h-4 w-4" /> Call NoLSAF support</a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
