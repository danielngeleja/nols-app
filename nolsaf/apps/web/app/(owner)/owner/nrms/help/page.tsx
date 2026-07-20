"use client";

import Link from "next/link";
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
import { useNrms } from "../_components/NrmsProvider";

const MODULES = [
  { icon: DoorOpen, title: "Front desk operations", description: "Record arrivals, assign rooms, check guests in and complete checkout." },
  { icon: CalendarDays, title: "Unified room calendar", description: "See NoLSAF bookings, external stays and room blocks together." },
  { icon: Users, title: "Guests and stay records", description: "Keep guest details, reservation history, payments and balances organized." },
  { icon: BedDouble, title: "Rooms and housekeeping", description: "Manage room types, units and housekeeping status across every floor." },
  { icon: Store, title: "Restaurant and bar", description: "Run outlet orders and menus, with QR order points for guests." },
  { icon: UsersRound, title: "Staff and roles", description: "Invite front desk, housekeeping and outlet staff scoped to their role." },
  { icon: WalletCards, title: "Finance and night audit", description: "Close out each business day with night audit and cashier reconciliation." },
  { icon: ReceiptText, title: "Transparent PAYG billing", description: "Track every chargeable external room-night in a clear ledger." },
];

// Trial length and pricing are policy, not product copy. This reads the
// account's live NrmsUsageChargePolicy via useNrms() rather than stating a
// number here, since the policy can change without a code deploy.
function buildBillingSteps(trialDays: number | undefined, currency: string | undefined, roomNightPrice: string | number | undefined) {
  const trialPhrase = trialDays ? `${trialDays}-day trial` : "free trial";
  const priceLine = currency && roomNightPrice != null
    ? `Charged at ${currency} ${Number(roomNightPrice).toLocaleString()} per external room-night after your trial.`
    : "Charged per external room-night after your trial, at the rate shown when you activate.";
  return [
    { step: "01", title: "Free trial starts on activation", description: `Your ${trialPhrase} begins the moment you activate NRMS on this property.` },
    { step: "02", title: "Usage is tracked nightly", description: "Only external room-nights are metered. NoLSAF bookings carry no NRMS fee." },
    { step: "03", title: "A statement opens when due", description: `Once trial usage ends or your unpaid limit is reached, a payable statement is issued. ${priceLine}` },
    { step: "04", title: "Pay by mobile money, bank or card", description: "Settle the statement from NRMS billing, and operations resume." },
  ];
}

function buildFaqs(trialDays: number | undefined) {
  const trialPhrase = trialDays ? `the ${trialDays}-day trial` : "your free trial";
  return [
    { q: "Does NRMS charge anything for NoLSAF bookings?", a: "No. NRMS usage fees apply only to external room-nights you record, meaning stays not booked through NoLSAF. Your marketplace commission is unaffected." },
    { q: `What happens after ${trialPhrase}?`, a: "Usage keeps being tracked and billed under your PAYG policy. Pay statements as they're issued, right from NRMS billing." },
    { q: "Can I lose NRMS access?", a: "Yes, if your property's Marketplace approval is withdrawn, or your account is frozen for unpaid usage past the limit. Both are reversible once resolved." },
    { q: "Where do I see what I owe?", a: "Open NRMS billing from the Finance section in the sidebar. Every statement, token and payment is listed there." },
  ];
}

export default function NrmsHelpPage() {
  const { usagePolicy } = useNrms();
  const billingSteps = buildBillingSteps(usagePolicy?.trialDays, usagePolicy?.currency, usagePolicy?.roomNightPrice);
  const faqs = buildFaqs(usagePolicy?.trialDays);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-[24px] border border-emerald-100 bg-[#f7fbf9] p-6 sm:p-8">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.28em] text-emerald-700">NRMS guide</p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">Everything about running NRMS</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
          What's included, how PAYG billing works, and how to reach us when you need a hand.
        </p>
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#02665e]"><Sparkles className="h-4 w-4 text-white" /></div>
          <div>
            <h2 className="text-lg font-bold text-neutral-950">Everything included</h2>
            <p className="text-sm text-neutral-500">One workspace for every part of running the property.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-md">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></div>
              <h3 className="mt-3 text-sm font-bold text-neutral-900">{title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-neutral-500">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-8 flex gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <BadgeCheck className="h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-semibold text-amber-800">NRMS stays tied to your Marketplace listing</p>
          <p className="mt-1 text-xs leading-5 text-amber-700">
            It opens automatically while this property is approved, and pauses if approval is withdrawn or usage
            goes unpaid past your limit. Both are reversible once resolved.
          </p>
        </div>
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600"><ReceiptText className="h-4 w-4 text-white" /></div>
          <div>
            <h2 className="text-lg font-bold text-neutral-950">How PAYG billing works</h2>
            <p className="text-sm text-neutral-500">Pay only for external room-nights, tracked in a clear ledger.</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="divide-y divide-neutral-100">
            {billingSteps.map(({ step, title, description }) => (
              <div key={step} className="flex items-start gap-4 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50"><span className="text-xs font-bold text-emerald-700">{step}</span></div>
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-neutral-500">{description}</p>
                </div>
                <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-neutral-300" />
              </div>
            ))}
          </div>
        </div>
        <Link href="/owner/nrms/billing" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 no-underline hover:gap-2.5 hover:no-underline">
          Go to NRMS billing <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-700"><FileText className="h-4 w-4 text-white" /></div>
          <div>
            <h2 className="text-lg font-bold text-neutral-950">Frequently asked</h2>
            <p className="text-sm text-neutral-500">The questions owners ask most while running NRMS.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {faqs.map(({ q, a }) => (
            <div key={q} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-neutral-900">{q}</p>
              <p className="mt-1.5 text-xs leading-5 text-neutral-500">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 mt-10 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#02b4f5] shadow-md shadow-[#02b4f5]/30"><Headset className="h-4 w-4 text-white" /></div>
          <div>
            <h2 className="text-lg font-bold text-neutral-950">Still need a hand?</h2>
            <p className="text-sm text-neutral-500">Reach a real person for anything this guide didn't cover.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <a href="https://wa.me/255736766726" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 no-underline shadow-sm transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-md">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 transition group-hover:bg-emerald-600"><MessageCircle className="h-4 w-4 text-emerald-600 transition group-hover:text-white" /></div>
            <div><p className="text-xs font-bold text-neutral-900">WhatsApp</p><p className="text-[11px] text-neutral-500">Fastest way to reach us</p></div>
          </a>
          <a href={`tel:${process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255736766726"}`} className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 no-underline shadow-sm transition hover:-translate-y-1 hover:border-[#02b4f5]/40 hover:shadow-md">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#02b4f5]/10 transition group-hover:bg-[#02b4f5]"><Phone className="h-4 w-4 text-[#02b4f5] transition group-hover:text-white" /></div>
            <div><p className="text-xs font-bold text-neutral-900">Call us</p><p className="text-[11px] text-neutral-500">{process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726"}</p></div>
          </a>
          <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com"}`} className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 no-underline shadow-sm transition hover:-translate-y-1 hover:border-neutral-300 hover:shadow-md">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 transition group-hover:bg-neutral-700"><Mail className="h-4 w-4 text-neutral-600 transition group-hover:text-white" /></div>
            <div><p className="text-xs font-bold text-neutral-900">Email us</p><p className="text-[11px] text-neutral-500">Replies within 24 hours</p></div>
          </a>
        </div>
      </section>
    </div>
  );
}
