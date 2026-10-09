"use client";

import Link from "next/link";
import { AlertTriangle, BedDouble, Cake, Coffee, Gift, Loader2, MapPin, Moon, Share2, Star } from "lucide-react";

/** GET /api/admin/users/:id/karibu */
export type CustomerKaribu = {
  story: { completedStays: number; nights: number; places: number };
  welcomes: Array<{
    bookingReference: string; property: string; drink: string; status: string; payableStatus: string; amount: number;
    issuedAt: string; servedAt: string | null; paidAt: string | null;
    feedback: { received: boolean | null; rating: number | null; note: string | null; at: string } | null;
  }>;
  preferences: { saved: false } | {
    saved: true; drinkLikes: string[]; dietaryTags: string[]; dietaryNote: string | null;
    shareWithProperty: boolean; celebrateOptIn: boolean; birthdaySet: boolean; updatedAt: string | null;
  };
  notifications: { bookings: boolean; promotions: boolean; referrals: boolean };
  lastDataExportAt: string | null;
};

const EAT = "Africa/Dar_es_Salaam";
const DRINK: Record<string, string> = { TEA_COFFEE: "Tea or coffee", FRESH_JUICE: "Fresh juice", SOFT_DRINK: "Soft drink", WATER: "Water", MOCKTAIL: "Mocktail" };
const DIET: Record<string, string> = { NO_SUGAR: "No sugar", LACTOSE_FREE: "Lactose-free", NUT_ALLERGY: "Nut allergy", VEGETARIAN: "Vegetarian" };
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT }) : "Not yet");
export const eatStamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: EAT })} EAT`;
};
const tidy = (value: string) => (value && value === value.toUpperCase() && /[A-Z]/.test(value) ? value.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : value);

function welcomeState(w: CustomerKaribu["welcomes"][number]) {
  if (w.status === "VOIDED") return { label: "Voided", dot: "bg-neutral-300", text: "text-neutral-500" };
  if (w.status === "ORDERED") return { label: "Awaiting service", dot: "bg-sky-500", text: "text-sky-700" };
  if (w.payableStatus === "PAID") return { label: "Served, property repaid", dot: "bg-emerald-500", text: "text-emerald-700" };
  return { label: "Served, repayment due", dot: "bg-amber-500", text: "text-amber-700" };
}

const card = "rounded-xl border border-solid border-neutral-300/80 bg-white";
const head = "px-4 py-2.5 text-left text-[11px] font-semibold text-neutral-400";

/** Read-only Karibu record for one customer: story numbers, welcomes with feedback, and their own preferences. */
export default function CustomerKaribuPanel({ data, loading, error }: { data: CustomerKaribu | null; loading: boolean; error: string | null }) {
  if (loading && !data) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading Karibu record</div>;
  if (error && !data) return <p className="m-4 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>;
  if (!data) return null;

  const prefs = data.preferences;
  const missed = data.welcomes.filter((w) => w.feedback && w.feedback.received === false).length;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* Travel story, the same numbers the guest sees on My Story */}
      <div className="grid grid-cols-3 gap-3">
        {([[BedDouble, "Completed stays", data.story.completedStays], [Moon, "Nights", data.story.nights], [MapPin, "Places", data.story.places]] as const).map(([Icon, label, value]) => (
          <div key={label} className={`${card} px-4 py-3`}>
            <p className="m-0 flex items-center gap-1.5 text-[11px] font-medium text-neutral-500"><Icon className="h-3.5 w-3.5 text-neutral-400" /> {label}</p>
            <p className="m-0 mt-1 text-2xl font-bold tabular-nums text-neutral-900">{value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        {/* Welcomes */}
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <h3 className="m-0 text-sm font-bold text-neutral-900">Welcomes</h3>
              <p className="m-0 text-xs text-neutral-500">Karibu welcomes issued for this customer, with what they told us.</p>
            </div>
            {missed > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" /> {missed} reported not received</span>}
          </div>
          {data.welcomes.length === 0 ? (
            <p className="m-0 border-0 border-t border-solid border-neutral-200 px-4 py-10 text-center text-sm text-neutral-500">No welcome has been issued for this customer.</p>
          ) : (
            <div className="overflow-x-auto border-0 border-t border-solid border-neutral-200">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead><tr><th className={head}>Stay</th><th className={head}>Drink</th><th className={head}>Status</th><th className={head}>Served</th><th className={head}>Guest feedback</th></tr></thead>
                <tbody>
                  {data.welcomes.map((w) => {
                    const s = welcomeState(w);
                    return (
                      <tr key={`${w.bookingReference}-${w.issuedAt}`} className="border-0 border-t border-solid border-neutral-100 align-top">
                        <td className="px-4 py-3">
                          <p className="m-0 max-w-[14rem] truncate font-medium text-neutral-900">{tidy(w.property)}</p>
                          <Link href={`/admin/bookings/${encodeURIComponent(w.bookingReference)}`} className="font-mono text-[11px] text-emerald-700 no-underline hover:underline">{w.bookingReference}</Link>
                        </td>
                        <td className="px-4 py-3 text-neutral-700"><span className="inline-flex items-center gap-1.5"><Coffee className="h-3.5 w-3.5 text-neutral-400" />{w.drink}</span></td>
                        <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${s.text}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />{s.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-500">{day(w.servedAt)}</td>
                        <td className="px-4 py-3">
                          {!w.feedback ? <span className="text-neutral-400">No feedback yet</span>
                            : w.feedback.received === false ? <span className="font-semibold text-rose-700">Reported not received</span>
                            : <span className="inline-flex items-center gap-1 text-neutral-800"><Star className="h-3.5 w-3.5 fill-current text-amber-500" /> {w.feedback.rating ?? "-"}/5</span>}
                          {w.feedback?.note && <p className="m-0 mt-1 max-w-[16rem] text-xs text-neutral-500">"{w.feedback.note}"</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* The guest's own preferences: read-only, they are consent choices */}
        <aside className={card}>
          <div className="px-4 py-3">
            <h3 className="m-0 text-sm font-bold text-neutral-900">Welcome preferences</h3>
            <p className="m-0 text-xs text-neutral-500">{prefs.saved ? `Set by the customer${prefs.updatedAt ? `, updated ${day(prefs.updatedAt)}` : ""}. Read-only.` : "The customer has not set any."}</p>
          </div>
          {prefs.saved && (
            <dl className="m-0 border-0 border-t border-solid border-neutral-200 text-sm">
              <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3">
                <dt className="text-[11px] font-semibold text-neutral-500">Drinks enjoyed</dt>
                <dd className="m-0 mt-1.5 flex flex-wrap gap-1.5">{prefs.drinkLikes.length ? prefs.drinkLikes.map((d) => <span key={d} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">{DRINK[d] ?? d}</span>) : <span className="text-neutral-400">None chosen</span>}</dd>
              </div>
              <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3">
                <dt className="text-[11px] font-semibold text-neutral-500">Dietary needs</dt>
                <dd className="m-0 mt-1.5 flex flex-wrap gap-1.5">{prefs.dietaryTags.length ? prefs.dietaryTags.map((t) => <span key={t} className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800">{DIET[t] ?? t}</span>) : <span className="text-neutral-400">None</span>}</dd>
                {prefs.dietaryNote && <dd className="m-0 mt-1.5 text-xs text-neutral-600">Note: {prefs.dietaryNote}</dd>}
              </div>
              <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><Share2 className="h-3.5 w-3.5" /> Shared with properties</dt>
                <dd className={`m-0 text-xs font-semibold ${prefs.shareWithProperty ? "text-emerald-700" : "text-neutral-500"}`}>{prefs.shareWithProperty ? "Yes, during stays" : "No"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><Cake className="h-3.5 w-3.5" /> Celebrate special days</dt>
                <dd className="m-0 text-xs font-semibold text-neutral-700">{prefs.celebrateOptIn ? (prefs.birthdaySet ? "On, birthday set" : "On, no birthday") : "Off"}</dd>
              </div>
            </dl>
          )}
          {!prefs.saved && <div className="flex items-center gap-2 border-0 border-t border-solid border-neutral-200 px-4 py-4 text-xs text-neutral-500"><Gift className="h-4 w-4 text-neutral-300" /> Welcomes for this customer use the property&apos;s approved drinks without a stated preference.</div>}
        </aside>
      </div>
    </div>
  );
}
