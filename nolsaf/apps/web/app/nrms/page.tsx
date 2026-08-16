// apps/web/app/nrms/page.tsx
//
// Public, indexable marketing page for NRMS (NoLSAF Rooms Management
// System). Replaces the old staff-only redirect; a "Staff sign in" link
// preserves the shortcut for logged-in operators. Copy is drawn strictly from
// the real product (see app/(owner)/owner/nrms/help/page.tsx).
//
// Design: light & airy premium. The hero visual is a code-built front-desk
// mockup, not a screenshot. Tailwind preflight is disabled in this app
// (corePlugins.preflight = false), so a bare `border`/`divide` renders nothing.
// Hairlines use ring-* and gap-px-over-a-tinted-background; elevation uses
// shadow-*. Avoid w-full + padding on content-box blocks.

import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  DoorOpen,
  ReceiptText,
  Store,
  Users,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";

const PAGE_URL = `${SITE_URL}/nrms`;
const HERO_IMAGE = `${SITE_URL}/images/nrms/front-desk-hero.png`;
const OWNER_CTA = "/account/register?mode=register&role=owner&next=%2Fowner%2Fnrms";

const MODULES: { icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  { icon: DoorOpen, title: "Front desk", description: "Arrivals, room assignment, check-in and verified checkout." },
  { icon: CalendarDays, title: "Unified calendar", description: "NoLSAF, walk-ins and OTA stays in one true availability view." },
  { icon: Users, title: "Guests & records", description: "History, payments and balances kept in order per guest." },
  { icon: BedDouble, title: "Rooms & housekeeping", description: "Room types, units and cleaning status across every floor." },
  { icon: Store, title: "Restaurant & bar", description: "Outlet orders and menus, with per-room QR ordering." },
  { icon: UsersRound, title: "Staff & roles", description: "Scoped access for desk, housekeeping and outlet teams." },
  { icon: WalletCards, title: "Finance & night audit", description: "Close each business day with cashier reconciliation." },
  { icon: ReceiptText, title: "PAYG billing", description: "Pay per external room-night, NoLSAF bookings stay free." },
];

// Room-timeline calendar mockup: rooms x days with bookings from different
// channels sharing one grid. start = day index (1-7), span = nights.
const CAL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAL_ROWS: { room: string; bookings: { start: number; span: number; color: string; label: string }[] }[] = [
  { room: "201", bookings: [{ start: 1, span: 3, color: "bg-[#02665e]", label: "NoLSAF" }, { start: 5, span: 3, color: "bg-rose-400", label: "Airbnb" }] },
  { room: "202", bookings: [{ start: 2, span: 4, color: "bg-sky-500", label: "Booking.com" }] },
  { room: "203", bookings: [{ start: 1, span: 2, color: "bg-amber-400", label: "Walk-in" }, { start: 4, span: 4, color: "bg-[#02665e]", label: "NoLSAF" }] },
  { room: "204", bookings: [{ start: 3, span: 4, color: "bg-[#02665e]", label: "NoLSAF" }] },
  { room: "205", bookings: [{ start: 2, span: 4, color: "bg-violet-500", label: "Expedia" }] },
];
const CAL_LEGEND = [
  { label: "NoLSAF", color: "bg-[#02665e]" },
  { label: "Booking.com", color: "bg-sky-500" },
  { label: "Walk-in", color: "bg-amber-400" },
  { label: "Airbnb", color: "bg-rose-400" },
  { label: "Expedia", color: "bg-violet-500" },
];

// Illustrative figures for the revenue visualization. Kept internally
// consistent (RevPAR = ADR x occupancy) so the dashboard reads like the real
// analytics module.
const REVENUE_TREND = [
  { m: "Jan", v: 31 },
  { m: "Feb", v: 28 },
  { m: "Mar", v: 34 },
  { m: "Apr", v: 37 },
  { m: "May", v: 41 },
  { m: "Jun", v: 39 },
  { m: "Jul", v: 44 },
  { m: "Aug", v: 48 },
];
const REVENUE_MAX = 56;

// Revenue line chart geometry, computed in a 100x40 viewBox (stretched to fit
// via preserveAspectRatio="none"; the stroke stays crisp with non-scaling
// stroke). Points sit at the centre of each month slot so they align with the
// labels below.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

const REVENUE_POINTS = REVENUE_TREND.map((d, i) => ({
  x: ((i + 0.5) / REVENUE_TREND.length) * 100,
  y: 5 + (1 - d.v / REVENUE_MAX) * 30,
}));
const REVENUE_LINE = smoothPath(REVENUE_POINTS);
const REVENUE_AREA = `${REVENUE_LINE} L ${REVENUE_POINTS[REVENUE_POINTS.length - 1].x.toFixed(2)} 40 L ${REVENUE_POINTS[0].x.toFixed(2)} 40 Z`;

const KPIS = [
  { label: "Occupancy", value: "82%", sub: "tonight", bar: 82 },
  { label: "ADR", value: "TZS 128k", sub: "average daily rate" },
  { label: "RevPAR", value: "TZS 105k", sub: "per available room" },
];

const CHANNEL_MIX = [
  { label: "NoLSAF", pct: 54, color: "bg-[#02665e]" },
  { label: "Booking.com", pct: 22, color: "bg-sky-500" },
  { label: "Walk-in", pct: 14, color: "bg-amber-400" },
  { label: "Airbnb", pct: 10, color: "bg-rose-400" },
];

const BILLING_STEPS = [
  { step: "01", title: "Free trial on activation", description: "Your trial begins the moment you activate NRMS on an approved property." },
  { step: "02", title: "Metered nightly", description: "Only external room-nights count. NoLSAF bookings carry no NRMS fee." },
  { step: "03", title: "Statement when due", description: "After the trial or your unpaid limit, a payable statement is issued at your rate." },
  { step: "04", title: "Pay and resume", description: "Settle by mobile money, bank or card and operations continue." },
];

const FAQS = [
  { q: "What is NRMS?", a: "NRMS (NoLSAF Rooms Management System) is a hotel and property management system built into NoLSAF: front desk, room calendar, housekeeping, restaurant and bar, staff roles, finance and night audit for property owners." },
  { q: "Does NRMS charge anything for NoLSAF bookings?", a: "No. NRMS usage fees apply only to external room-nights you record, meaning stays not booked through NoLSAF. Your marketplace commission is unaffected." },
  { q: "Who is NRMS for?", a: "Property owners and their teams operating an approved NoLSAF listing in Tanzania and East Africa: hotels, lodges, apartments, villas and guest houses." },
  { q: "Can guests order food and drinks from their room?", a: "Yes. NRMS creates QR order points per room. Guests scan, see the live menu, and pay at the counter or charge it to their room when checked in." },
  { q: "Which booking channels does NRMS work with?", a: "One calendar covers NoLSAF marketplace, walk-ins and phone bookings, plus external OTA sources such as Booking.com, Airbnb and Expedia." },
];

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "NRMS: Hotel Rooms & Reservation Management System",
    description:
      "NRMS is NoLSAF's rooms and reservation management system for hotels, lodges and guest houses in Tanzania and East Africa: front desk, room calendar, housekeeping, restaurant and bar POS, night audit and pay-as-you-go billing.",
    keywords: [
      "NRMS",
      "NoLSAF NRMS",
      "reservation management system",
      "property management system Tanzania",
      "hotel management system Tanzania",
      "PMS Tanzania",
      "hotel software East Africa",
      "channel manager Tanzania",
      "hotel POS Tanzania",
      "night audit software",
      "front desk system Tanzania",
    ],
    alternates: { canonical: PAGE_URL },
    openGraph: {
      type: "website",
      title: "NRMS: Hotel Rooms & Reservation Management System | NoLSAF",
      description:
        "Run the front desk, room calendar, housekeeping, restaurant and bar, finance and night audit for your property, with pay-as-you-go billing.",
      url: PAGE_URL,
      images: [{ url: HERO_IMAGE, width: 1200, height: 630, alt: "NRMS front desk for property owners" }],
    },
    robots: { index: true, follow: true },
  };
}

function buildJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${PAGE_URL}#software`,
      name: "NRMS (NoLSAF Rooms Management System)",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Property Management System",
      operatingSystem: "Web",
      url: PAGE_URL,
      description:
        "Reservation and property management system for hotels, lodges and guest houses: front desk, room calendar, housekeeping, restaurant and bar POS, staff roles, finance and night audit.",
      featureList: MODULES.map((m) => m.title),
      areaServed: [
        { "@type": "Country", name: "Tanzania" },
        { "@type": "Place", name: "East Africa" },
      ],
      provider: { "@type": "Organization", name: "NoLSAF", url: SITE_URL },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "TZS",
        description: "Free trial on activation, then pay-as-you-go per external room-night. NoLSAF bookings carry no NRMS fee.",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${PAGE_URL}#faq`,
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
}

export default async function NrmsLandingPage() {
  const nonce = (await headers()).get("x-nonce") || undefined;
  const jsonLd = buildJsonLd();

  return (
    <main className="relative overflow-hidden bg-white text-slate-900">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      {/* soft ambient glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[520px] bg-[radial-gradient(60%_60%_at_75%_0%,rgba(2,102,94,0.10),transparent_70%)]" aria-hidden="true" />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-5 pb-6 pt-10 sm:px-6 sm:pt-16 lg:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#02665e] ring-1 ring-[#02665e]/12">
              NoLSAF for property owners
            </span>
            <h1 className="mt-5 text-[2.05rem] font-semibold leading-[1.12] tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.05]">
              Run your whole property from{" "}
              <span className="text-[#02665e]">one workspace</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-500 sm:text-lg">
              NRMS is the NoLSAF Rooms Management System: front desk, room calendar, housekeeping, restaurant and bar, finance and night audit. You pay only for external room-nights, NoLSAF bookings are free.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={OWNER_CTA} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#02665e] px-6 py-3.5 text-sm font-bold text-white no-underline shadow-lg shadow-[#02665e]/25 transition hover:-translate-y-0.5 hover:bg-[#024d47]">
                Activate on your property
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/owner/nrms/orders" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-slate-700 no-underline ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-slate-300">
                Staff sign in
              </Link>
            </div>

            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-400">
              <span>Free trial</span>
              <span className="text-slate-300">•</span>
              <span>No fee on NoLSAF bookings</span>
              <span className="text-slate-300">•</span>
              <span>Mobile money, bank &amp; card</span>
            </p>
          </div>

          <FrontDeskMockup />
        </div>
      </section>

      {/* ── Everything included ───────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#02665e]">Everything included</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[2rem]">One system for the whole property</h2>
          <p className="mt-3 text-base leading-7 text-slate-500">Every part of running a stay, from the first booking to the night audit, in a single connected workspace.</p>
        </div>

        <div className="mt-9 overflow-hidden rounded-[24px] bg-slate-200/70 shadow-[0_30px_70px_-50px_rgba(2,102,94,0.4)] ring-1 ring-slate-900/[0.07]">
          <div className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map(({ icon: Icon, title, description }, i) => (
              <article key={title} className="group relative bg-white p-6 transition-colors hover:bg-[#02665e]/[0.035]">
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#02665e] to-[#0d8a7d] text-white shadow-[0_10px_20px_-12px_rgba(2,102,94,0.9)] transition group-hover:-translate-y-0.5">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-black tabular-nums text-slate-300 transition-colors group-hover:text-[#02665e]/40">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-5 text-sm font-bold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-6 text-slate-500">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Revenue control & performance ─────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#02665e]">Revenue control &amp; performance</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[2rem]">See the numbers that run the business</h2>
          <p className="mt-3 text-base leading-7 text-slate-500">Revenue, occupancy and rate performance update as you operate, and the night audit closes each business day cleanly.</p>
        </div>

        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {/* Revenue trend (span 2) */}
          <div className="rounded-[24px] bg-white p-6 shadow-[0_20px_50px_-38px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/[0.06] lg:col-span-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Revenue · last 8 months</p>
                <div className="mt-1.5 flex items-baseline gap-2.5">
                  <span className="text-3xl font-black tracking-tight text-slate-900">TZS 48.2M</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#02665e]/[0.08] px-2 py-0.5 text-xs font-bold text-[#02665e]">▲ 9.5%</span>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">vs TZS 44.0M in Jul</span>
            </div>

            {/* line chart */}
            <div className="relative mt-6 h-44">
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="h-px w-full bg-slate-100" />
                ))}
              </div>
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#02665e" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#02665e" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={REVENUE_AREA} fill="url(#revFill)" />
                <path d={REVENUE_LINE} fill="none" stroke="#02665e" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {REVENUE_POINTS.map((p, i) => {
                const isCurrent = i === REVENUE_POINTS.length - 1;
                return (
                  <span
                    key={i}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${isCurrent ? "h-3 w-3 bg-white shadow-sm ring-2 ring-[#02665e]" : "h-1.5 w-1.5 bg-[#02665e]/40"}`}
                    style={{ left: `${p.x}%`, top: `${(p.y / 40) * 100}%` }}
                    title={`${REVENUE_TREND[i].m}: TZS ${REVENUE_TREND[i].v}.0M`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex gap-2 sm:gap-3">
              {REVENUE_TREND.map((d, i) => (
                <span key={d.m} className={`flex-1 text-center text-[10px] font-semibold ${i === REVENUE_TREND.length - 1 ? "text-[#02665e]" : "text-slate-400"}`}>{d.m}</span>
              ))}
            </div>
          </div>

          {/* KPI stack (span 1) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {KPIS.map((kpi) => (
              <div key={kpi.label} className="rounded-[24px] bg-white p-5 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/[0.06]">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{kpi.label}</p>
                <p className="mt-1.5 text-2xl font-black tracking-tight text-slate-900">{kpi.value}</p>
                {typeof kpi.bar === "number" ? (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${kpi.bar}%` }} />
                  </div>
                ) : null}
                <p className="mt-2 text-[11px] font-medium text-slate-400">{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* Channel mix (span 3) */}
          <div className="rounded-[24px] bg-white p-6 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/[0.06] lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Revenue by source</p>
              <span className="text-[11px] font-semibold text-slate-400">Booked this month</span>
            </div>
            <div className="mt-3 flex h-3.5 gap-1 overflow-hidden rounded-full">
              {CHANNEL_MIX.map((c) => (
                <span key={c.label} className={`h-full ${c.color}`} style={{ width: `${c.pct}%` }} title={`${c.label} ${c.pct}%`} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {CHANNEL_MIX.map((c) => (
                <div key={c.label} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 flex-none rounded-sm ${c.color}`} />
                  <span className="text-xs font-semibold text-slate-600">{c.label}</span>
                  <span className="ml-auto text-xs font-black tabular-nums text-slate-900">{c.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── One calendar for every channel ────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-20 sm:px-6">
        <div className="rounded-[28px] bg-[#02665e]/[0.04] p-6 ring-1 ring-[#02665e]/10 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-10">
            {/* copy */}
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/10">
                <CalendarDays className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">One calendar for every channel</h2>
              <p className="mt-2 text-base leading-7 text-slate-500">
                NoLSAF marketplace, walk-ins, phone bookings and external OTA stays share a single room calendar, so you always see true availability, never a double booking.
              </p>
              <dl className="mt-5 flex gap-6">
                <div>
                  <dt className="text-2xl font-black tracking-tight text-[#02665e]">6</dt>
                  <dd className="text-[11px] font-semibold text-slate-500">Booking sources</dd>
                </div>
                <div>
                  <dt className="text-2xl font-black tracking-tight text-[#02665e]">1</dt>
                  <dd className="text-[11px] font-semibold text-slate-500">Live calendar</dd>
                </div>
              </dl>
            </div>

            {/* calendar mockup */}
            <div className="overflow-hidden rounded-2xl bg-white p-4 shadow-[0_30px_70px_-45px_rgba(2,102,94,0.5)] ring-1 ring-slate-900/[0.06] sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Room calendar · this week</p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#02665e]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" />
                  Live
                </span>
              </div>

              {/* day header */}
              <div className="mt-3 flex items-center gap-2 pl-12">
                <div className="grid flex-1 grid-cols-7 gap-1">
                  {CAL_DAYS.map((d) => (
                    <span key={d} className="text-center text-[10px] font-bold text-slate-400">{d}</span>
                  ))}
                </div>
              </div>

              {/* rows */}
              <div className="mt-1.5 flex flex-col gap-1.5">
                {CAL_ROWS.map((row) => (
                  <div key={row.room} className="flex items-center gap-2">
                    <span className="w-10 flex-none text-right text-[11px] font-bold text-slate-500">{row.room}</span>
                    <div
                      className="relative h-8 flex-1 overflow-hidden rounded-lg bg-slate-50"
                      style={{ backgroundImage: "linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px)", backgroundSize: "calc(100%/7) 100%" }}
                    >
                      {row.bookings.map((b, i) => (
                        <span
                          key={i}
                          className={`absolute top-1 bottom-1 box-border flex items-center overflow-hidden rounded-md px-2 ${b.color}`}
                          style={{ left: `calc(${((b.start - 1) / 7) * 100}% + 3px)`, width: `calc(${(b.span / 7) * 100}% - 6px)` }}
                          title={`Room ${row.room} · ${b.label}`}
                        >
                          {b.span >= 3 ? <span className="truncate text-[10px] font-bold text-white/95">{b.label}</span> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* legend */}
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 pl-12">
                {CAL_LEGEND.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    <span className={`h-2.5 w-2.5 rounded-sm ${c.color}`} />
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Billing ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#02665e]">Simple pricing</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[2rem]">Pay only for what you run</h2>
          <p className="mt-3 text-base leading-7 text-slate-500">A free trial to start, then pay-as-you-go per external room-night. Stays booked through NoLSAF are always free.</p>
        </div>

        <ol className="mt-9 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {BILLING_STEPS.map(({ step, title, description }) => (
            <li key={step} className="rounded-2xl bg-white p-5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/[0.06]">
              <span className="text-sm font-bold text-[#02665e]/40">{step}</span>
              <p className="mt-2 text-sm font-bold text-slate-900">{title}</p>
              <p className="mt-1.5 text-[13px] leading-6 text-slate-500">{description}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#02665e]">Questions people search</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[2rem]">NRMS, answered</h2>
        </div>
        <div className="mt-9 grid gap-4 md:grid-cols-2">
          {FAQS.map((faq) => (
            <article key={faq.q} className="rounded-2xl bg-white p-6 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/[0.06]">
              <h3 className="flex items-start gap-2.5 text-sm font-bold text-slate-900">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[#02665e]" />
                {faq.q}
              </h3>
              <p className="mt-2 pl-7 text-sm leading-7 text-slate-500">{faq.a}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="flex flex-col items-start gap-6 rounded-[28px] bg-[#02665e]/[0.05] p-8 ring-1 ring-[#02665e]/15 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Ready to run your property on NRMS?</h2>
            <p className="mt-2 text-base text-slate-500">Activate on an approved listing and start your free trial.</p>
          </div>
          <Link href={OWNER_CTA} className="inline-flex flex-none items-center gap-2 rounded-xl bg-[#02665e] px-6 py-3.5 text-sm font-bold text-white no-underline shadow-lg shadow-[#02665e]/25 transition hover:-translate-y-0.5 hover:bg-[#024d47]">
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

/**
 * Code-built preview of the NRMS front desk. Mirrors the real product
 * (arrivals/departures/in-house, occupancy, an arrivals queue) so the hero
 * shows the software without needing a screenshot asset.
 */
function FrontDeskMockup() {
  const arrivals = [
    { name: "Amina Yusuf", room: "204", initials: "AY" },
    { name: "David Okoth", room: "112", initials: "DO" },
    { name: "Grace Mushi", room: "301", initials: "GM" },
  ];

  return (
    <div className="relative">
      {/* glow */}
      <div className="pointer-events-none absolute -inset-6 -z-0 rounded-[40px] bg-[radial-gradient(closest-side,rgba(2,102,94,0.16),transparent)]" aria-hidden="true" />

      <div className="relative overflow-hidden rounded-[22px] bg-white shadow-[0_40px_90px_-45px_rgba(2,102,94,0.5)] ring-1 ring-slate-900/[0.07]">
        {/* window bar */}
        <div className="flex items-center gap-2 bg-slate-50 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
          <span className="ml-auto text-[11px] font-bold tracking-wide text-slate-400">NRMS · Front desk</span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* stat row */}
          <div className="grid grid-cols-3 gap-2.5">
            <MockStat icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label="Arrivals" value="6" tone="emerald" />
            <MockStat icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} label="Departures" value="4" tone="sky" />
            <MockStat icon={<BedDouble className="h-3.5 w-3.5" />} label="In house" value="18" tone="slate" />
          </div>

          {/* occupancy */}
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-900/[0.05]">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Tonight&apos;s occupancy</span>
              <span className="tabular-nums text-slate-900">82%</span>
            </div>
            <div className="mt-2 flex h-2.5 gap-1 overflow-hidden rounded-full bg-slate-200/70">
              <span className="h-full rounded-full bg-[#02665e]" style={{ width: "62%" }} />
              <span className="h-full rounded-full bg-sky-400" style={{ width: "20%" }} />
              <span className="h-full rounded-full bg-amber-300" style={{ width: "10%" }} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <Legend color="bg-[#02665e]" label="Staying" />
              <Legend color="bg-sky-400" label="Arriving" />
              <Legend color="bg-amber-300" label="Turnover" />
            </div>
          </div>

          {/* arrivals queue */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Arriving today</span>
              <span className="rounded-full bg-[#02665e]/[0.07] px-2 py-0.5 text-[10px] font-bold text-[#02665e]">3 expected</span>
            </div>
            <div className="flex flex-col gap-px overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/[0.05]">
              {arrivals.map((g) => (
                <div key={g.name} className="flex items-center gap-3 bg-white px-3.5 py-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{g.initials}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-slate-900">{g.name}</p>
                    <p className="text-[11px] text-slate-400">Room {g.room}</p>
                  </div>
                  <span className="rounded-lg bg-[#02665e] px-3 py-1.5 text-[11px] font-bold text-white">Check in</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "emerald" | "sky" | "slate" }) {
  const iconTone = tone === "emerald" ? "text-[#02665e]" : tone === "sky" ? "text-sky-500" : "text-slate-400";
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-900/[0.05]">
      <div className={`flex items-center gap-1.5 ${iconTone}`}>{icon}<span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span></div>
      <p className="mt-1 text-xl font-black tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
