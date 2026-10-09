"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Award, BedDouble, CalendarHeart, Check, CheckCircle2, Coffee, Gift, Loader2, MapPin, Moon, Search, Star } from "lucide-react";
import api from "@/lib/apiClient";
import PreferencesCard, { type KaribuPreferences } from "./PreferencesCard";

type Feedback = { received: boolean; rating: number | null; note: string | null; at: string };
type Moment = {
  id: number; bookingReference: string; property: string; checkIn: string; drink: string;
  status: "ORDERED" | "SERVED"; issuedAt: string; servedAt: string | null; feedback: Feedback | null;
};
type Stay = { bookingReference: string; property: string; city: string | null; checkIn: string; checkOut: string; nights: number; welcomed: boolean };
type Journey = {
  completedStayCount: number;
  totals?: { nights: number; places: number };
  upcoming?: { bookingReference: string; property: string; city: string | null; checkIn: string; checkOut: string; inHouse: boolean } | null;
  recentStays?: Stay[];
  firstStay: { bookingReference: string; property: string; completedAt: string } | null;
  moments: Moment[];
};

const EAT = "Africa/Dar_es_Salaam";
const shortDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: EAT });
const dayMonth = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: EAT });
// "SHERATON HOTEL" reads as "Sheraton Hotel"; mixed-case names stay as written.
const tidy = (value: string | null | undefined) => {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
};
const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 text-sm font-semibold text-white no-underline transition hover:bg-emerald-800 hover:no-underline disabled:cursor-not-allowed disabled:opacity-50";
const outline = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 no-underline transition hover:border-emerald-300 hover:text-emerald-800 hover:no-underline";
const card = "rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]";
const divider = "border-0 border-t border-solid border-slate-200";
const monthShort = (value: string) => new Date(value).toLocaleDateString("en-GB", { month: "short", timeZone: EAT });
const dayNum = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", timeZone: EAT });
const monthYear = (value: string) => new Date(value).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: EAT });

export default function KaribuJourneyPage() {
  const router = useRouter();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [received, setReceived] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  // null until loaded, or when the preference table is not migrated yet (card hidden).
  const [preferences, setPreferences] = useState<KaribuPreferences | null>(null);

  const load = useCallback(async () => {
    const data = (await api.get<Journey>("/api/customer/karibu")).data;
    setJourney(data);
  }, []);
  useEffect(() => {
    void api.get<{ available: boolean; preferences: KaribuPreferences }>("/api/customer/karibu/preferences")
      .then((r) => { if (r.data.available) setPreferences(r.data.preferences); })
      .catch(() => { /* preferences are optional; the story still loads */ });
    void load().catch((cause: any) => {
      if (cause?.response?.status === 401) { router.replace("/account/login?next=%2Faccount%2Fkaribu"); return; }
      setError("Your journey could not be loaded. Try again.");
    }).finally(() => setLoading(false));
  }, [load, router]);

  const startFeedback = (id: number) => { setReviewing(id); setReceived(null); setRating(0); setNote(""); setError(""); };
  async function sendFeedback() {
    if (!reviewing || received == null || (received && rating === 0)) return;
    setSending(true);
    setError("");
    try {
      await api.post(`/api/customer/karibu/${reviewing}/feedback`, { received, rating: received ? rating : null, note: note.trim() || null });
      await load();
      setReviewing(null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Your feedback could not be saved. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[45vh] w-full items-center justify-center gap-3 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" /> Loading your journey</div>;
  }
  if (!journey) {
    return (
      <div className={`${card} mx-auto max-w-xl p-6 text-center [&_*]:box-border`}>
        <Gift className="mx-auto h-8 w-8 text-emerald-700" />
        <h1 className="m-0 mt-3 text-lg font-bold text-slate-900">Your journey is unavailable</h1>
        <p className="m-0 mt-1 text-sm text-slate-600">{error}</p>
        <button type="button" className={`${primary} mt-4`} onClick={() => { setLoading(true); void load().catch(() => setError("Still unavailable.")).finally(() => setLoading(false)); }}>Try again</button>
      </div>
    );
  }

  const stays = journey.completedStayCount;
  const nights = journey.totals?.nights ?? 0;
  const places = journey.totals?.places ?? 0;
  const recent = journey.recentStays ?? [];
  const upcoming = journey.upcoming ?? null;
  const anniversary = journey.firstStay ? (() => { const d = new Date(journey.firstStay.completedAt); d.setUTCFullYear(d.getUTCFullYear() + 1); return d; })() : null;
  const yearReached = anniversary ? anniversary.getTime() <= Date.now() : false;
  // A record of what happened, never a countdown: a target would read as a promised reward (doc section 14.1).
  const milestones = [
    { title: "First stay", done: stays >= 1, detail: journey.firstStay ? `${tidy(journey.firstStay.property)} · ${shortDate(journey.firstStay.completedAt)}` : "" },
    { title: "Third stay", done: stays >= 3, detail: "Three stays with NoLSAF" },
    { title: "One year with NoLSAF", done: yearReached, detail: anniversary ? `Since ${shortDate(journey.firstStay!.completedAt)}` : "" },
  ].filter((m) => m.done);
  const momentFor = (reference: string) => journey.moments.find((m) => m.bookingReference === reference);

  return (
    // Account pages fill the public container (no own max width), like the other /account pages.
    <div className="w-full min-w-0 space-y-5 pb-10 text-slate-900 [&_*]:box-border">
      {/* Story band: the numbers that are actually theirs */}
      <header className="relative overflow-hidden rounded-2xl bg-[#0b2420] px-5 py-5 text-white sm:px-7 sm:py-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
          <div className="min-w-0">
            <Link href="/account" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300/80 no-underline hover:text-emerald-200 hover:no-underline"><ArrowLeft className="h-3.5 w-3.5" /> My account</Link>
            <p className="m-0 mt-4 text-xs font-semibold text-emerald-300">Karibu by NoLSAF</p>
            <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-white sm:text-[28px]">Your travel story</h1>
            <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Every stay you complete with NoLSAF, in one place.</p>
            <dl className="m-0 mt-6 grid max-w-xl grid-cols-3 gap-2 sm:gap-3">
              {([[BedDouble, stays === 1 ? "Stay" : "Stays", stays], [Moon, nights === 1 ? "Night" : "Nights", nights], [MapPin, places === 1 ? "Place" : "Places", places]] as const).map(([Icon, label, value]) => (
                <div key={label} className="rounded-xl border border-solid border-white/10 bg-white/[0.06] px-3 py-3 sm:px-4">
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium text-white/60"><Icon className="h-3.5 w-3.5 text-emerald-300" /> {label}</dt>
                  <dd className="m-0 mt-1.5 text-2xl font-bold tabular-nums leading-none text-white sm:text-3xl">{Number(value).toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </div>

          {journey.firstStay && (
            <div className="rounded-xl border border-solid border-white/10 bg-white/[0.04] p-4">
              <p className="m-0 text-[11px] font-medium text-white/50">Travelling with NoLSAF since</p>
              <p className="m-0 mt-0.5 text-lg font-bold text-white">{monthYear(journey.firstStay.completedAt)}</p>
              <dl className="m-0 mt-3 space-y-2 border-0 border-t border-solid border-white/10 pt-3 text-xs">
                {recent[0] && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-white/50">Latest stay</dt>
                    <dd className="m-0 min-w-0 truncate text-right font-semibold text-white/90">{tidy(recent[0].property)}{recent[0].city ? `, ${tidy(recent[0].city)}` : ""}</dd>
                  </div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-white/50">Next stay</dt>
                  <dd className="m-0 min-w-0 truncate text-right font-semibold text-white/90">{upcoming ? `${tidy(upcoming.property)} · ${dayMonth(upcoming.checkIn)}` : "None booked yet"}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </header>

      {error && <p role="alert" className="m-0 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}

      {/* Next or current stay: the one thing worth acting on */}
      {upcoming && (
        <Link href={`/account/bookings/${encodeURIComponent(upcoming.bookingReference)}`} className={`${card} group flex items-center gap-4 p-4 no-underline transition hover:border-emerald-300 hover:no-underline sm:p-5`}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><BedDouble className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{upcoming.inHouse ? "Staying now" : "Your next stay"}</span>
            <span className="mt-0.5 block truncate text-base font-bold text-slate-900">{tidy(upcoming.property)}</span>
            <span className="block text-xs text-slate-500">{upcoming.city ? `${tidy(upcoming.city)} · ` : ""}{dayMonth(upcoming.checkIn)} to {shortDate(upcoming.checkOut)}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
        </Link>
      )}

      <div className={`grid items-start gap-5 ${milestones.length ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <div className="min-w-0 space-y-5">
          {/* Welcome moments: shown only when there is one, never as an empty promise */}
          {journey.moments.length > 0 && (
            <section className={card}>
              <div className="px-5 py-4">
                <h2 className="m-0 text-base font-bold">Welcomes prepared for you</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">A small thank you from NoLSAF, served by the property. You are never charged for it.</p>
              </div>
              <ul className={`m-0 list-none p-0 ${divider}`}>
                {journey.moments.map((moment) => (
                  <li key={moment.id} className="border-0 border-b border-solid border-slate-200 px-5 py-4 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Coffee className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-semibold text-slate-900">{moment.drink} at {tidy(moment.property)}</p>
                        <p className="m-0 mt-0.5 text-xs text-slate-500">{moment.status === "SERVED" ? `Served ${shortDate(moment.servedAt || moment.issuedAt)}` : "The property is preparing it now"}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${moment.status === "SERVED" ? "text-emerald-700" : "text-sky-700"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${moment.status === "SERVED" ? "bg-emerald-500" : "bg-sky-500"}`} aria-hidden />
                        {moment.status === "SERVED" ? "Served" : "Being prepared"}
                      </span>
                    </div>

                    {moment.feedback ? (
                      <p className="m-0 ml-[52px] mt-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Thanks for telling us {moment.feedback.received ? `how it was (${moment.feedback.rating}/5)` : "it did not arrive"}.</p>
                    ) : moment.status === "SERVED" && reviewing !== moment.id ? (
                      <button type="button" className="ml-[52px] mt-2 border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline" onClick={() => startFeedback(moment.id)}>Did it reach you? Tell us</button>
                    ) : null}

                    {reviewing === moment.id && !moment.feedback && (
                      <div className="mt-4 space-y-4 rounded-xl border border-solid border-slate-200 bg-slate-50/70 p-4 sm:ml-[52px]">
                        <div>
                          <p className="m-0 text-sm font-semibold">Did your welcome reach you?</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {([true, false] as const).map((value) => (
                              <button type="button" key={String(value)} aria-pressed={received === value} onClick={() => { setReceived(value); setRating(0); }} className={`rounded-lg border border-solid px-4 py-2 text-xs font-semibold transition ${received === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                                {value ? "Yes, I received it" : "No, it did not arrive"}
                              </button>
                            ))}
                          </div>
                        </div>
                        {received && (
                          <div>
                            <p className="m-0 text-xs font-semibold text-slate-700">How was it?</p>
                            <div className="mt-1.5 flex gap-1" role="group" aria-label="Rate your welcome">
                              {[1, 2, 3, 4, 5].map((value) => (
                                <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} of 5 stars`} aria-pressed={rating === value} className="rounded-lg border-0 bg-transparent p-1 text-amber-500 hover:bg-amber-50"><Star className={`h-6 w-6 ${value <= rating ? "fill-current" : ""}`} /></button>
                              ))}
                            </div>
                          </div>
                        )}
                        <label className="block text-xs font-semibold text-slate-700">
                          Anything we should know? <span className="font-normal text-slate-400">Optional</span>
                          <textarea className="mt-1.5 block min-h-20 w-full resize-y rounded-lg border border-solid border-slate-200 bg-white p-3 text-sm font-normal outline-none focus:border-emerald-500" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={received === false ? "What happened" : "A note about your welcome"} />
                        </label>
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" className={outline} onClick={() => setReviewing(null)}>Cancel</button>
                          <button type="button" className={primary} disabled={sending || received == null || (received && !rating)} onClick={() => void sendFeedback()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Send</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Stays timeline */}
          <section className={card}>
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><MapPin className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0">
                <h2 className="m-0 text-base font-bold">Where you have stayed</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{stays > recent.length ? `Your latest ${recent.length} of ${stays} stays` : "Your completed stays"}</p>
                </div>
              </div>
              {stays > 0 && <Link href="/account/bookings" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">All stays <ArrowRight className="h-3.5 w-3.5" /></Link>}
            </div>
            {recent.length === 0 ? (
              <div className={`${divider} px-6 py-12 text-center`}>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#0b2420] text-emerald-300"><MapPin className="h-5 w-5" /></span>
                <p className="m-0 mt-3 text-sm font-semibold text-slate-900">Your story starts with your first stay</p>
                <p className="mx-auto m-0 mt-1 max-w-sm text-xs leading-5 text-slate-500">Each stay you complete with NoLSAF is added here.</p>
                <Link href="/public/properties" className={`${primary} mt-4`}><Search className="h-4 w-4" /> Find a stay</Link>
              </div>
            ) : (
              <ol className="m-0 list-none p-0">
                {recent.map((stay, i) => {
                  const moment = momentFor(stay.bookingReference);
                  return (
                    <li key={stay.bookingReference} className={divider}>
                      <Link href={`/account/bookings/${encodeURIComponent(stay.bookingReference)}`} className="group flex items-center gap-4 px-5 py-4 no-underline transition hover:bg-slate-50/80 hover:no-underline">
                        <span className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-solid ${i === 0 ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}>
                          <span className="text-[10px] font-semibold uppercase tracking-wide">{monthShort(stay.checkIn)}</span>
                          <span className="text-lg font-bold leading-none tabular-nums">{dayNum(stay.checkIn)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-slate-900 group-hover:text-emerald-800">{tidy(stay.property)}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            {stay.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-400" />{tidy(stay.city)}</span>}
                            <span className="tabular-nums">{dayMonth(stay.checkIn)} to {shortDate(stay.checkOut)}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{stay.nights} {stay.nights === 1 ? "night" : "nights"}</span>
                            {(stay.welcomed || moment) && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800"><Gift className="h-3 w-3" /> Welcome{moment ? `: ${moment.drink}` : ""}</span>}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        {/* Milestones reached: shown only when there is at least one */}
        {milestones.length > 0 && (
          <aside className={card}>
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Award className="h-[18px] w-[18px]" /></span>
              <div>
                <h2 className="m-0 text-base font-bold">Milestones</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{milestones.length} reached</p>
              </div>
            </div>
            <ol className="m-0 list-none p-0">
              {milestones.map((m) => (
                <li key={m.title} className={`${divider} flex items-center gap-3 px-5 py-4`}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-2 ring-emerald-600/20 ring-offset-2">
                    {m.title.startsWith("One year") ? <CalendarHeart className="h-5 w-5" /> : <Award className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-slate-900">{m.title} <Check className="h-3.5 w-3.5 text-emerald-600" /></p>
                    {m.detail && <p className="m-0 mt-0.5 truncate text-xs text-slate-500" title={m.detail}>{m.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>

      {/* Preferences: full width, so its three groups sit side by side instead of a tall side column */}
      {preferences && <PreferencesCard initial={preferences} onChange={setPreferences} />}
    </div>
  );
}
