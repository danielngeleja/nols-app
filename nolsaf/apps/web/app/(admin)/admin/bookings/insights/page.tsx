"use client";

// Booking insights for one property or one property type.
// Opened from the admin home "Top property" and "Top type" cards.
//   /admin/bookings/insights?property=<property ref>&days=30
//   /admin/bookings/insights?type=BUNGALOW&days=30
// Data: GET /api/admin/performance/booking-insights (same query).

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CalendarDays, CreditCard, Eye, Layers, Moon, ShieldAlert, Table2, BarChart3 } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Outcome = "RECEIVED" | "PAYING" | "NOT_PAID" | "CANCELLED";
type Day = { day: string; received: number; paying: number; notPaid: number; cancelled: number };
type Insights = {
  scope: "property" | "type";
  subject: {
    title?: string; type: string; status?: string; regionName?: string | null; district?: string | null;
    propertyRef?: string | null; propertyCount?: number;
  };
  window: { days: number; from: string; to: string };
  totals: {
    tried: number; reachedPayment: number; received: number; paying: number; notPaid: number; cancelled: number;
    paymentFailed: number; needsReview: number; receivedValue: number; commission: number;
    conversion: number | null; avgNights: number | null; avgLeadDays: number | null;
  };
  previous: { tried: number; received: number };
  daily: Day[];
  channels: Array<{ channel: string; count: number }>;
  properties?: Array<{ ref: string | null; title: string; regionName: string | null; tried: number; received: number }>;
  recent?: Array<{ ref: string; createdAt: string; checkIn: string; nights: number; amount: number; outcome: Outcome }>;
  truncated: boolean;
};

// Outcome colours. Validated as a set (dataviz validate_palette.js, light and
// dark): lightness band, chroma floor, colour-blind and normal-vision separation,
// 3:1 contrast. Identity is never colour alone: every use has a label beside it.
const OUTCOMES: Array<{ key: Outcome; field: keyof Omit<Day, "day">; label: string; color: string; meaning: string }> = [
  { key: "RECEIVED", field: "received", label: "Received", color: "#0d9488", meaning: "Paid and confirmed" },
  { key: "PAYING", field: "paying", label: "Still paying", color: "#2563eb", meaning: "Checkout open or payment processing" },
  { key: "NOT_PAID", field: "notPaid", label: "Did not pay", color: "#d97706", meaning: "Left before paying, or the payment window closed" },
  { key: "CANCELLED", field: "cancelled", label: "Cancelled", color: "#9333ea", meaning: "Cancelled after booking" },
];
const OUTCOME_BY_KEY = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<Outcome, (typeof OUTCOMES)[number]>;
const WINDOWS = [7, 30, 90] as const;
const CHANNEL_LABEL: Record<string, string> = { MNO: "Mobile money", CARD: "Card", BANK: "Bank", NOT_RECORDED: "Not recorded" };

const CARD = "min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white";
const LABEL = "m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500";
const tsh = (v: number) => `TSh ${Math.round(Number(v) || 0).toLocaleString()}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const humanize = (v: string) => String(v || "").split(/_+/).filter(Boolean).map((t, i) => (i === 0 ? t.charAt(0) + t.slice(1).toLowerCase() : t.toLowerCase())).join(" ");
const eatDate = (iso: string, withYear = false) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "Africa/Dar_es_Salaam" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function BookingInsightsPage() {
  return (
    <Suspense fallback={null}>
      <BookingInsights />
    </Suspense>
  );
}

function BookingInsights() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const property = params.get("property") ?? "";
  const type = params.get("type") ?? "";
  const requestedDays = Number(params.get("days"));
  const days = (WINDOWS as readonly number[]).includes(requestedDays) ? requestedDays : 30;

  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!property && !type) {
      setError("Choose a property or a property type from the admin home.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<Insights>("/api/admin/performance/booking-insights", { params: { days, ...(property ? { property } : { type }) } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.status === 404 ? "This property could not be found." : "Booking insights could not load. Try again.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [property, type, days]);

  const setDays = (next: number) => {
    const q = new URLSearchParams(params.toString());
    q.set("days", String(next));
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const isProperty = data?.scope === "property";
  const title = data ? (isProperty ? data.subject.title : humanize(data.subject.type)) : "";
  const typeHref = data ? `/admin/bookings/insights?type=${encodeURIComponent(data.subject.type)}&days=${days}` : "#";

  return (
    <div id="booking-insights" className="w-full min-w-0 space-y-5">
      <style>{`#booking-insights, #booking-insights * { box-sizing: border-box; }`}</style>

      <Link href="/admin/home" className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 no-underline hover:text-[#02665e]">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Admin home
      </Link>

      {/* Subject */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={LABEL}>Booking insights</p>
          <h1 className="m-0 mt-1 truncate text-2xl font-semibold text-neutral-950">{title || (loading ? " " : "Bookings")}</h1>
          {data ? (
            <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
              {isProperty ? (
                <>
                  <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden />{humanize(data.subject.type)}</span>
                  {data.subject.regionName ? <><span aria-hidden className="text-neutral-300">·</span><span>{[data.subject.district, data.subject.regionName].filter(Boolean).join(", ")}</span></> : null}
                  {data.subject.status ? <><span aria-hidden className="text-neutral-300">·</span><span>{humanize(data.subject.status)}</span></> : null}
                </>
              ) : (
                <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" aria-hidden />{plural(data.subject.propertyCount ?? 0, "approved listing", "approved listings")}</span>
              )}
            </p>
          ) : null}
        </div>
        {data && isProperty ? (
          <div className="flex flex-wrap gap-2">
            <Link href={typeHref} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
              <Layers className="h-3.5 w-3.5" aria-hidden /> All {humanize(data.subject.type).toLowerCase()} listings
            </Link>
            {data.subject.propertyRef ? (
              <Link href={`/admin/properties/previews?previewId=${encodeURIComponent(data.subject.propertyRef)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
                <Eye className="h-3.5 w-3.5" aria-hidden /> Listing preview
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Filter row: scopes everything below */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-solid border-neutral-200 bg-white p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`cursor-pointer rounded-md border-0 px-3 py-1.5 text-xs font-semibold transition ${days === w ? "bg-[#02665e] text-white" : "bg-transparent text-neutral-600 hover:bg-neutral-100"}`}
            >
              Last {w} days
            </button>
          ))}
        </div>
        <p className="m-0 text-xs text-neutral-500">Bookings placed in this window, by booking date (EAT).</p>
      </div>

      {error ? (
        <div className={`${CARD} flex items-center gap-3 p-5 text-sm text-neutral-700`}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden /> {error}
        </div>
      ) : !data ? (
        <div className={`${CARD} h-64 animate-pulse bg-neutral-50`} aria-busy="true" aria-label="Loading booking insights" />
      ) : (
        <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <Headline data={data} />
          {data.totals.needsReview > 0 || data.totals.paymentFailed > 0 ? <Alerts data={data} /> : null}
          {data.totals.tried === 0 ? (
            <div className={`${CARD} p-8 text-center`}>
              <p className="m-0 text-base font-semibold text-neutral-900">No bookings placed in the last {days} days</p>
              <p className="m-0 mt-1 text-sm text-neutral-500">
                {data.previous.tried > 0 ? `${plural(data.previous.tried, "booking was", "bookings were")} placed in the ${days} days before.` : "Try a longer window."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <Funnel data={data} />
                <Outcomes data={data} />
              </div>
              <DailyChart data={data} />
              <div className="grid gap-5 lg:grid-cols-3">
                <Channels data={data} />
                <div className="lg:col-span-2">{isProperty ? <RecentBookings data={data} /> : <TopListings data={data} days={days} />}</div>
              </div>
            </>
          )}
          {data.truncated ? <p className="m-0 text-xs text-neutral-500">Showing the most recent 20,000 bookings in this window.</p> : null}
        </div>
      )}
    </div>
  );
}

function Delta({ now, before, days }: { now: number; before: number; days: number }) {
  if (before === 0) return <span className="text-xs text-neutral-500">None in the {days} days before</span>;
  const change = Math.round(((now - before) / before) * 100);
  const tone = change > 0 ? "text-emerald-700" : change < 0 ? "text-red-700" : "text-neutral-500";
  return (
    <span className="text-xs text-neutral-500">
      <span className={`font-semibold ${tone}`}>{change > 0 ? "+" : ""}{change}%</span> vs the {days} days before ({before.toLocaleString()})
    </span>
  );
}

function Headline({ data }: { data: Insights }) {
  const t = data.totals;
  const days = data.window.days;
  const tiles = [
    { label: "Tried to book", value: t.tried.toLocaleString(), foot: <Delta now={t.tried} before={data.previous.tried} days={days} /> },
    { label: "Booking value received", value: tsh(t.receivedValue), foot: <span className="text-xs text-neutral-500">{tsh(t.commission)} NoLSAF commission</span> },
    {
      label: "Typical stay", value: t.avgNights != null ? plural(t.avgNights, "night", "nights") : "None yet",
      foot: <span className="text-xs text-neutral-500">{t.avgLeadDays != null ? `Booked ${plural(t.avgLeadDays, "day", "days")} ahead on average` : "From received bookings"}</span>,
    },
  ];
  return (
    <section className="grid gap-3 lg:grid-cols-[1.3fr_repeat(3,1fr)]" aria-label="Summary">
      <div className={`${CARD} p-5`}>
        <p className={LABEL}>Bookings received</p>
        <p className="m-0 mt-2 text-5xl font-semibold leading-none text-neutral-950">{t.received.toLocaleString()}</p>
        <p className="m-0 mt-3 text-sm text-neutral-600">
          {t.conversion != null ? <><span className="font-semibold text-neutral-900">{Math.round(t.conversion * 100)}%</span> of {plural(t.tried, "try", "tries")} became a booking</> : "No tries yet"}
        </p>
        <div className="mt-1"><Delta now={t.received} before={data.previous.received} days={days} /></div>
      </div>
      {tiles.map((tile) => (
        <div key={tile.label} className={`${CARD} p-5`}>
          <p className="m-0 text-xs font-medium text-neutral-500">{tile.label}</p>
          <p className="m-0 mt-2 truncate text-2xl font-semibold text-neutral-950">{tile.value}</p>
          <div className="mt-2">{tile.foot}</div>
        </div>
      ))}
    </section>
  );
}

function Alerts({ data }: { data: Insights }) {
  const t = data.totals;
  return (
    <div className="flex flex-wrap gap-3">
      {t.needsReview > 0 ? (
        <Link href="/admin/payment-cases" className="inline-flex items-center gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 no-underline hover:bg-amber-100/70">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span><span className="font-semibold">{plural(t.needsReview, "payment needs", "payments need")} review:</span> money signal on an unconfirmed booking</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
      {t.paymentFailed > 0 ? (
        <div className="inline-flex items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
          <CreditCard className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <span><span className="font-semibold text-neutral-900">{plural(t.paymentFailed, "try", "tries")}</span> had a failed payment and did not complete</span>
        </div>
      ) : null}
    </div>
  );
}

function Funnel({ data }: { data: Insights }) {
  const t = data.totals;
  const steps = [
    { label: "Tried to book", value: t.tried, note: "Started a booking" },
    { label: "Reached payment", value: t.reachedPayment, note: "Got as far as an invoice" },
    { label: "Received", value: t.received, note: "Paid and confirmed" },
  ];
  return (
    <section className={`${CARD} p-5`} aria-labelledby="funnel-title">
      <p id="funnel-title" className={LABEL}>From try to booking</p>
      <ol className="m-0 mt-4 list-none space-y-4 p-0">
        {steps.map((step, i) => {
          const share = pct(step.value, t.tried);
          const drop = i > 0 ? steps[i - 1].value - step.value : 0;
          return (
            <li key={step.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-neutral-800">{step.label}</span>
                <span className="text-sm text-neutral-500"><span className="font-semibold text-neutral-950">{step.value.toLocaleString()}</span> · {share}%</span>
              </div>
              <div className="mt-1.5 h-3 w-full rounded-full bg-teal-50" role="img" aria-label={`${step.label}: ${step.value} (${share}% of tries)`}>
                <div className="h-3 rounded-full" style={{ width: `${Math.max(step.value > 0 ? 2 : 0, share)}%`, background: "#0d9488" }} />
              </div>
              <p className="m-0 mt-1 text-xs text-neutral-500">{step.note}{i > 0 && drop > 0 ? `. ${plural(drop, "try", "tries")} stopped before this step` : ""}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Outcomes({ data }: { data: Insights }) {
  const t = data.totals;
  const values: Record<Outcome, number> = { RECEIVED: t.received, PAYING: t.paying, NOT_PAID: t.notPaid, CANCELLED: t.cancelled };
  const [hover, setHover] = useState<Outcome | null>(null);
  return (
    <section className={`${CARD} p-5`} aria-labelledby="outcome-title">
      <p id="outcome-title" className={LABEL}>How every try ended</p>
      <div
        className="mt-4 flex h-7 w-full gap-[2px]"
        role="img"
        aria-label={OUTCOMES.map((o) => `${o.label} ${values[o.key]} (${pct(values[o.key], t.tried)}%)`).join(", ")}
      >
        {OUTCOMES.filter((o) => values[o.key] > 0).map((o) => {
          const share = pct(values[o.key], t.tried);
          return (
            <div
              key={o.key}
              onPointerEnter={() => setHover(o.key)}
              onPointerLeave={() => setHover(null)}
              title={`${o.label}: ${values[o.key]} (${share}%)`}
              className="flex h-7 min-w-[4px] items-center overflow-visible rounded-[4px] px-2 transition-opacity"
              style={{ flex: `${values[o.key]} 1 0`, background: o.color, opacity: hover && hover !== o.key ? 0.45 : 1 }}
            >
              {share >= 12 ? <span className="whitespace-nowrap text-xs font-semibold text-white">{share}%</span> : null}
            </div>
          );
        })}
      </div>
      <ul className="m-0 mt-4 grid list-none gap-2.5 p-0 sm:grid-cols-2">
        {OUTCOMES.map((o) => (
          <li key={o.key} className="flex items-start gap-2.5" onPointerEnter={() => setHover(o.key)} onPointerLeave={() => setHover(null)}>
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: o.color }} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm text-neutral-800"><span className="font-semibold text-neutral-950">{values[o.key].toLocaleString()}</span> {o.label.toLowerCase()}</span>
              <span className="block text-xs text-neutral-500">{o.meaning}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function DailyChart({ data }: { data: Insights }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const totals = data.daily.map((d) => d.received + d.paying + d.notPaid + d.cancelled);
  const max = niceMax(Math.max(0, ...totals));
  const ticks = [max, max / 2, 0];
  const labelEvery = Math.ceil(data.daily.length / 7);
  const shown = active != null ? data.daily[active] : null;
  let busiest = -1;
  totals.forEach((v, i) => { if (v > 0 && (busiest < 0 || v > totals[busiest])) busiest = i; });

  return (
    <section className={`${CARD} p-5`} aria-labelledby="daily-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p id="daily-title" className={LABEL}>Tries per day, by how they ended</p>
          <p className="m-0 mt-1 text-xs text-neutral-500">
            {busiest >= 0 ? `Busiest day: ${dayLabel(data.daily[busiest].day)}, ${plural(totals[busiest], "try", "tries")}` : "No tries in this window"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label="Legend">
            {OUTCOMES.map((o) => (
              <li key={o.key} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: o.color }} aria-hidden />{o.label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {asTable ? <><BarChart3 className="h-3.5 w-3.5" aria-hidden /> Chart</> : <><Table2 className="h-3.5 w-3.5" aria-hidden /> Table</>}
          </button>
        </div>
      </div>

      {asTable ? (
        <div className="mt-4 max-h-80 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="py-2 pr-3 font-medium">Day</th>
                {OUTCOMES.map((o) => <th key={o.key} className="py-2 pr-3 text-right font-medium">{o.label}</th>)}
                <th className="py-2 text-right font-medium">Tries</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d, i) => (
                <tr key={d.day} className="border-0 border-t border-solid border-neutral-100">
                  <td className="py-1.5 pr-3 text-neutral-700">{dayLabel(d.day)}</td>
                  {OUTCOMES.map((o) => <td key={o.key} className="py-1.5 pr-3 text-right tabular-nums text-neutral-700">{d[o.field]}</td>)}
                  <td className="py-1.5 text-right font-semibold tabular-nums text-neutral-900">{totals[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4">
          {/* Tooltip: values lead, labels follow */}
          {shown ? (
            <div className="pointer-events-none absolute right-0 top-0 z-10 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm">
              <p className="m-0 font-semibold text-neutral-900">{dayLabel(shown.day)} · {plural(totals[active!], "try", "tries")}</p>
              {OUTCOMES.map((o) => (
                <p key={o.key} className="m-0 mt-1 flex items-center gap-2 text-neutral-600">
                  <span className="h-0.5 w-3 rounded" style={{ background: o.color }} aria-hidden />
                  <span className="min-w-[1.5rem] font-semibold tabular-nums text-neutral-900">{shown[o.field]}</span>{o.label}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex">
            <div className="flex h-48 w-8 shrink-0 flex-col justify-between pr-2 text-right text-[10px] tabular-nums text-neutral-400" aria-hidden>
              {ticks.map((tick) => <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{tick}</span>)}
            </div>
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-48" aria-hidden>
                {ticks.map((tick, i) => <div key={tick} className="absolute inset-x-0 border-0 border-t border-solid border-neutral-100" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />)}
              </div>
              <div className="relative flex h-48 items-end" onPointerLeave={() => setActive(null)}>
                {data.daily.map((d, i) => {
                  const total = totals[i];
                  const height = (total / max) * 100;
                  return (
                    <div
                      key={d.day}
                      tabIndex={0}
                      role="img"
                      aria-label={`${dayLabel(d.day)}: ${total} tries. ${OUTCOMES.map((o) => `${o.label} ${d[o.field]}`).join(", ")}`}
                      onPointerEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className={`flex h-full min-w-0 flex-1 cursor-default items-end justify-center px-[1px] outline-none ${active === i ? "bg-neutral-50" : ""}`}
                    >
                      <div className="flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${height}%` }}>
                        {OUTCOMES.filter((o) => d[o.field] > 0).map((o, idx, list) => (
                          <div
                            key={o.key}
                            className={idx === list.length - 1 ? "rounded-t-[4px]" : ""}
                            style={{ flex: `${d[o.field]} 1 0`, background: o.color, minHeight: 2 }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex text-[10px] text-neutral-400" aria-hidden>
                {data.daily.map((d, i) => (
                  <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                    {i % labelEvery === 0 || i === data.daily.length - 1 ? dayLabel(d.day) : ""}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Channels({ data }: { data: Insights }) {
  const total = data.channels.reduce((s, c) => s + c.count, 0);
  return (
    <section className={`${CARD} p-5`} aria-labelledby="channels-title">
      <p id="channels-title" className={LABEL}>How received bookings paid</p>
      {total === 0 ? (
        <p className="m-0 mt-4 text-sm text-neutral-500">No received bookings yet.</p>
      ) : (
        <ul className="m-0 mt-4 list-none space-y-3 p-0">
          {data.channels.map((c) => (
            <li key={c.channel}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-neutral-800">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                <span className="text-neutral-500"><span className="font-semibold text-neutral-950">{c.count}</span> · {pct(c.count, total)}%</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-teal-50" aria-hidden>
                <div className="h-2 rounded-full" style={{ width: `${pct(c.count, total)}%`, background: "#0d9488" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OutcomeTag({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME_BY_KEY[outcome];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-700">
      <span className="h-2 w-2 rounded-full" style={{ background: o.color }} aria-hidden />{o.label}
    </span>
  );
}

function RecentBookings({ data }: { data: Insights }) {
  const rows = data.recent ?? [];
  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="recent-title">
      <div className="flex items-center justify-between gap-3 p-5 pb-3">
        <p id="recent-title" className={LABEL}>Latest tries</p>
        <span className="text-xs text-neutral-500">{plural(rows.length, "booking", "bookings")}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="px-5 py-2 font-medium">Booking</th>
              <th className="py-2 pr-3 font-medium">Placed</th>
              <th className="py-2 pr-3 font-medium"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden />Check-in</span></th>
              <th className="py-2 pr-3 text-right font-medium"><span className="inline-flex items-center gap-1"><Moon className="h-3 w-3" aria-hidden />Nights</span></th>
              <th className="py-2 pr-3 text-right font-medium">Value</th>
              <th className="py-2 pr-5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ref} className="border-0 border-t border-solid border-neutral-100 hover:bg-neutral-50">
                <td className="px-5 py-2.5">
                  <Link href={`/admin/bookings/${encodeURIComponent(r.ref)}`} className="font-mono text-xs text-[#02665e] no-underline hover:underline">{r.ref}</Link>
                </td>
                <td className="py-2.5 pr-3 text-neutral-700">{eatDate(r.createdAt)}</td>
                <td className="py-2.5 pr-3 text-neutral-700">{eatDate(r.checkIn, true)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-700">{r.nights}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-900">{tsh(r.amount)}</td>
                <td className="py-2.5 pr-5"><OutcomeTag outcome={r.outcome} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TopListings({ data, days }: { data: Insights; days: number }) {
  const rows = data.properties ?? [];
  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="listings-title">
      <div className="flex items-center justify-between gap-3 p-5 pb-3">
        <p id="listings-title" className={LABEL}>Listings in this type</p>
        <span className="text-xs text-neutral-500">Ranked by bookings received</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="px-5 py-2 font-medium">Listing</th>
              <th className="py-2 pr-3 text-right font-medium">Tried</th>
              <th className="py-2 pr-3 text-right font-medium">Received</th>
              <th className="py-2 pr-5 font-medium">Converted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const share = pct(r.received, r.tried);
              const href = r.ref ? `/admin/bookings/insights?property=${encodeURIComponent(r.ref)}&days=${days}` : null;
              return (
                <tr key={r.ref ?? i} className="border-0 border-t border-solid border-neutral-100 hover:bg-neutral-50">
                  <td className="max-w-[260px] px-5 py-2.5">
                    {href ? (
                      <Link href={href} className="block truncate font-medium text-neutral-900 no-underline hover:text-[#02665e]">{r.title}</Link>
                    ) : <span className="block truncate font-medium text-neutral-900">{r.title}</span>}
                    {r.regionName ? <span className="block truncate text-xs text-neutral-500">{r.regionName}</span> : null}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-neutral-700">{r.tried}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-neutral-900">{r.received}</td>
                  <td className="py-2.5 pr-5">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-20 rounded-full bg-teal-50" aria-hidden>
                        <span className="block h-2 rounded-full" style={{ width: `${share}%`, background: "#0d9488" }} />
                      </span>
                      <span className="text-xs tabular-nums text-neutral-600">{share}%</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
