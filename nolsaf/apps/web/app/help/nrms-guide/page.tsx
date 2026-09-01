import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DoorOpen,
  FileText,
  Headset,
  Hotel,
  Mail,
  MessageCircle,
  Phone,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  UsersRound,
  WalletCards,
} from "lucide-react";

import LayoutFrame from "@/components/LayoutFrame";
import { SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { HelpFooter, HelpHeader } from "../HelpChrome";
import HelpBackLink from "../HelpBackLink";

const PAGE_URL = `${SITE_URL}/help/nrms-guide`;

const MODULES = [
  {
    icon: DoorOpen,
    title: "Front desk operations",
    description: "Record arrivals, assign rooms, check guests in and complete checkout from one workspace.",
  },
  {
    icon: CalendarDays,
    title: "Unified room calendar",
    description: "See NoLSAF bookings, external stays and room blocks together without double-selling inventory.",
  },
  {
    icon: Users,
    title: "Guests and stay records",
    description: "Keep guest details, reservation history, payments and balances organized for your team.",
  },
  {
    icon: BedDouble,
    title: "Rooms and housekeeping",
    description: "Manage room types, units and housekeeping status across every floor and outlet.",
  },
  {
    icon: Store,
    title: "Restaurant and bar",
    description: "Run outlet orders and menus, with QR order points guests can scan from their room or table.",
  },
  {
    icon: UsersRound,
    title: "Staff and roles",
    description: "Invite front desk, housekeeping and outlet staff with access scoped to their role only.",
  },
  {
    icon: WalletCards,
    title: "Finance and night audit",
    description: "Close out each business day with a clear night audit and cashier reconciliation.",
  },
  {
    icon: ReceiptText,
    title: "Transparent PAYG billing",
    description: "Track every chargeable external room-night, statement and payment token in a clear ledger.",
  },
];

const BILLING_STEPS = [
  {
    step: "01",
    title: "Free trial starts on activation",
    description: "Your free trial begins the moment you activate NRMS on an approved property, not on sign-up. The exact trial length and per-night rate are shown when you activate.",
  },
  {
    step: "02",
    title: "Usage is tracked nightly",
    description: "Only external room-nights (stays not booked through NoLSAF) are metered. NoLSAF bookings carry no NRMS fee.",
  },
  {
    step: "03",
    title: "A statement opens when due",
    description: "Once trial usage or your unpaid limit is reached, a payable statement is issued with a clear breakdown.",
  },
  {
    step: "04",
    title: "Pay by mobile money, bank or card",
    description: "Settle the statement through AzamPay mobile money, bank transfer or card checkout, and operations resume.",
  },
];

const FAQS = [
  {
    q: "Do I need to be listed on the NoLSAF Marketplace to use NRMS?",
    a: "Yes. NRMS runs on top of an approved Marketplace listing rather than as a separate product, so the same property earns both booking commission and covers its own PAYG usage.",
  },
  {
    q: "What happens if my property is pending approval or was rejected?",
    a: "NRMS stays locked until the property is approved. Check your listing status any time from Properties, and resubmit with the requested changes if it was rejected.",
  },
  {
    q: "Does NRMS charge anything for NoLSAF bookings?",
    a: "No. NRMS usage fees apply only to external room-nights, meaning stays you record that were not booked through NoLSAF. Your normal marketplace commission is unaffected.",
  },
  {
    q: "What happens after the free trial?",
    a: "Usage keeps being tracked and billed under your PAYG policy. You can pay statements as they're issued, right from the NRMS billing page.",
  },
];

// The help layout only sets a generic "Help Centre" title, which left this
// page competing for NRMS queries with no title, description or canonical of
// its own. It is a full product guide, so it carries its own metadata.
export const metadata: Metadata = {
  title: "NRMS guide: how the rooms management system works",
  description:
    "A step by step guide to NRMS, NoLSAF's rooms management system for hotels, lodges and guest houses in Tanzania: front desk, room calendar, housekeeping, restaurant and bar, staff roles, night audit and pay-as-you-go billing.",
  keywords: [
    "NRMS guide",
    "how to use NRMS",
    "hotel management system guide",
    "property management system Tanzania",
    "hotel front desk software Tanzania",
    "night audit guide",
    "PAYG hotel software",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "article",
    title: "NRMS guide: how the rooms management system works | NoLSAF",
    description:
      "Front desk, room calendar, housekeeping, restaurant and bar, staff roles, night audit and pay-as-you-go billing, explained module by module.",
    url: PAGE_URL,
  },
  robots: { index: true, follow: true },
};

function buildJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      "@id": `${PAGE_URL}#guide`,
      headline: "NRMS guide: how the rooms management system works",
      url: PAGE_URL,
      about: { "@type": "SoftwareApplication", name: "NRMS (NoLSAF Rooms Management System)", url: `${SITE_URL}/nrms` },
      publisher: { "@type": "Organization", name: "NoLSAF", url: SITE_URL },
      articleSection: MODULES.map((module) => module.title),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${PAGE_URL}#faq`,
      mainEntity: FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: { "@type": "Answer", text: faq.a },
      })),
    },
  ];
}

export default async function HelpNrmsGuidePage() {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildJsonLd()) }}
      />
      <HelpHeader />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />

        <div className="public-container py-8 sm:py-12">
          <HelpBackLink />

          <div className="mt-4 relative overflow-hidden rounded-2xl bg-[#010f0e] shadow-2xl text-white">
            <div className="absolute inset-0 bg-gradient-to-br from-[#011918] via-[#01332e] to-[#010f0e]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_110%_-10%,_#02b4f540_0%,_transparent_65%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_-5%_110%,_#02665e50_0%,_transparent_60%)]" />
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "22px 22px" }}
            />

            <div className="relative z-10 grid lg:grid-cols-[1fr_auto] gap-6 px-7 py-10 sm:px-10 sm:py-12 items-center">
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] mb-5">
                  <Hotel className="h-3.5 w-3.5 text-[#02b4f5]" />
                  <span className="text-white/90">NRMS guide</span>
                </div>

                <h1 className="text-3xl sm:text-[2.6rem] font-extrabold leading-[1.15] tracking-tight">
                  Run your entire property from{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#02b4f5] to-[#4dd9ac]">one workspace</span>
                </h1>

                <p className="mt-4 text-white/65 text-sm sm:text-base leading-relaxed max-w-lg">
                  Front desk, rooms, guests, restaurant and bar, staff, and billing, all connected to the same
                  live inventory as your NoLSAF Marketplace listing.
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    href="/owner/properties/add"
                    className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#02b4f5] text-[#010f0e] px-5 py-2.5 text-sm font-bold hover:brightness-110 hover:gap-3 transition-all duration-200 shadow-lg shadow-[#02b4f5]/20"
                  >
                    List your property <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href="https://wa.me/255736766726"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-underline inline-flex items-center gap-2 rounded-xl bg-white/10 border border-white/20 text-white px-5 py-2.5 text-sm font-semibold hover:bg-white/18 hover:gap-3 transition-all duration-200"
                  >
                    Get live help <MessageCircle className="h-4 w-4" />
                  </a>
                </div>
              </div>

              <div className="hidden lg:flex flex-col gap-3 min-w-[200px]">
                {[
                  { icon: Clock3, label: "Free trial", value: "Shown on activation", color: "#02b4f5" },
                  { icon: WalletCards, label: "NoLSAF bookings", value: "0 NRMS fee", color: "#4dd9ac" },
                  { icon: ShieldCheck, label: "Requires", value: "Approved listing", color: "#f59e0b" },
                  { icon: BarChart3, label: "Billed on", value: "External nights only", color: "#a78bfa" },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className="flex items-center gap-3 rounded-xl bg-white/[0.07] border border-white/10 px-4 py-3 backdrop-blur-sm hover:bg-white/[0.12] transition-colors duration-200 cursor-default">
                    <div className="flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}22` }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div>
                      <p className="text-[10px] text-white/45 uppercase tracking-wider leading-none mb-0.5">{label}</p>
                      <p className="text-sm font-bold text-white leading-none">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section className="mt-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-8 w-8 rounded-lg bg-[#02665e] flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Everything included</h2>
                <p className="text-sm text-gray-500">One workspace for every part of running the property.</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {MODULES.map(({ icon: Icon, title, description }) => (
                <div key={title} className="relative overflow-hidden bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:-translate-y-1.5 hover:shadow-xl hover:border-[#02665e]/30 hover:ring-1 hover:ring-[#02665e]/10 transition-all duration-300 group cursor-default">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#02665e] to-[#02b4f5] scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left rounded-t-xl" />
                  <div className="h-10 w-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center mb-3 group-hover:bg-[#02665e] group-hover:scale-110 transition-all duration-300">
                    <Icon className="h-5 w-5 text-[#02665e] group-hover:text-white transition-colors duration-300" />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
                  <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-5 flex gap-4">
            <BadgeCheck className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">NRMS opens once your listing is approved</p>
              <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                NRMS is part of your Marketplace listing, not a separate product. It unlocks automatically the
                moment NoLSAF approves your property. If you don&apos;t have a property yet, start by listing one.
                If it&apos;s pending or was rejected, check its status and resubmit any requested changes.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href="/owner/properties/add" className="no-underline inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:gap-2.5 transition-all duration-200">
                  List a property <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/owner/properties/pending" className="no-underline inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:gap-2.5 transition-all duration-200">
                  Check listing status <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>

          <section className="mt-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
                <ReceiptText className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">How PAYG billing works</h2>
                <p className="text-sm text-gray-500">Pay only for external room-nights, tracked in a clear ledger.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-slate-100">
                {BILLING_STEPS.map(({ step, title, description }) => (
                  <div key={step} className="group flex items-start gap-5 px-6 py-5 hover:bg-[#02665e]/[0.03] transition-colors duration-200 cursor-default">
                    <div className="flex-shrink-0 h-9 w-9 rounded-full bg-[#02665e]/10 border border-[#02665e]/20 flex items-center justify-center group-hover:bg-[#02665e] group-hover:border-[#02665e] transition-all duration-300">
                      <span className="text-xs font-bold text-[#02665e] group-hover:text-white transition-colors duration-300">{step}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-[#02665e] transition-colors duration-200">{title}</p>
                      <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-slate-300 group-hover:text-emerald-500 flex-shrink-0 mt-0.5 ml-auto transition-colors duration-300" />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-8 w-8 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                <FileText className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Frequently asked</h2>
                <p className="text-sm text-gray-500">The questions owners ask most before and after activating NRMS.</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {FAQS.map(({ q, a }) => (
                <div key={q} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
                  <p className="text-sm font-semibold text-gray-900">{q}</p>
                  <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{a}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10 relative overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-[#f0fdfc] via-white to-[#e8f8ff]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_0%_0%,_#02b4f514_0%,_transparent_65%)]" />

            <div className="relative z-10 px-6 py-8 sm:px-10 sm:py-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-xl bg-[#02b4f5] flex items-center justify-center flex-shrink-0 shadow-md shadow-[#02b4f5]/30">
                  <Headset className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Still need a hand?</h2>
                  <p className="text-sm text-gray-500">Reach a real person for anything this guide didn&apos;t cover.</p>
                </div>
              </div>

              <div className="mt-6 grid sm:grid-cols-3 gap-4">
                <a
                  href="https://wa.me/255736766726"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="no-underline group flex items-center gap-3 rounded-xl bg-white border border-slate-200 shadow-sm p-4 hover:-translate-y-1 hover:shadow-lg hover:border-emerald-300 transition-all duration-300"
                >
                  <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-600 transition-colors duration-300">
                    <MessageCircle className="h-4.5 w-4.5 text-emerald-600 group-hover:text-white transition-colors duration-300" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">WhatsApp</p>
                    <p className="text-[11px] text-gray-500">Fastest way to reach us</p>
                  </div>
                </a>
                <a
                  href={`tel:${process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255736766726"}`}
                  className="no-underline group flex items-center gap-3 rounded-xl bg-white border border-slate-200 shadow-sm p-4 hover:-translate-y-1 hover:shadow-lg hover:border-[#02b4f5]/40 transition-all duration-300"
                >
                  <div className="h-10 w-10 rounded-xl bg-[#02b4f5]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#02b4f5] transition-colors duration-300">
                    <Phone className="h-4.5 w-4.5 text-[#02b4f5] group-hover:text-white transition-colors duration-300" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">Call us</p>
                    <p className="text-[11px] text-gray-500">{process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726"}</p>
                  </div>
                </a>
                <a
                  href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com"}`}
                  className="no-underline group flex items-center gap-3 rounded-xl bg-white border border-slate-200 shadow-sm p-4 hover:-translate-y-1 hover:shadow-lg hover:border-slate-300 transition-all duration-300"
                >
                  <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700 transition-colors duration-300">
                    <Mail className="h-4.5 w-4.5 text-slate-600 group-hover:text-white transition-colors duration-300" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">Email us</p>
                    <p className="text-[11px] text-gray-500">Replies within 24 hours</p>
                  </div>
                </a>
              </div>
            </div>
          </section>

          <div className="group mt-10 relative overflow-hidden bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-[#02665e]/30 hover:-translate-y-1 transition-all duration-300 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#02665e18_0%,_transparent_65%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative z-10">
              <h3 className="text-lg font-bold text-gray-900">Ready to run your rooms with NRMS?</h3>
              <p className="mt-1 text-sm text-gray-500 max-w-md">
                List your property, get approved, and activate your free trial in minutes.
              </p>
            </div>
            <Link
              href="/owner/properties/add"
              className="no-underline relative z-10 flex-shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#02665e] text-white px-6 py-3 text-sm font-semibold hover:bg-[#024d47] hover:gap-3 hover:shadow-lg transition-all duration-200 shadow-md"
            >
              List your property <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
      <HelpFooter />
    </>
  );
}
