import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BookOpen,
  CalendarRange,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Home,
  Info,
  LifeBuoy,
  MapPin,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Zap,
} from "lucide-react";

import LayoutFrame from "@/components/LayoutFrame";
import { HelpFooter, HelpHeader } from "../HelpChrome";
import HelpBackLink from "../HelpBackLink";

// ─── Booking steps ────────────────────────────────────────────────────────────
const BOOKING_STEPS = [
  {
    step: "01",
    icon: Search,
    title: "Browse & pick a property",
    detail: "Search by destination, dates, and guest count. Each listing shows verified photos, amenities, house rules, and the full price breakdown before you commit.",
    cta: { label: "Browse properties", href: "/public/properties" },
    color: "#02b4f5",
  },
  {
    step: "02",
    icon: CalendarRange,
    title: "Select your dates & guests",
    detail: "Choose your check-in and check-out dates and the number of guests. Availability updates in real time, if dates are shown, they're open.",
    cta: null,
    color: "#02665e",
  },
  {
    step: "03",
    icon: BookOpen,
    title: "Review before you confirm",
    detail: "Read the house rules, cancellation policy, and the full itemised cost. Base rate, service fees, and any applicable charges, before clicking confirm.",
    cta: { label: "Cancellation policy", href: "/cancellation-policy" },
    color: "#a78bfa",
  },
  {
    step: "04",
    icon: Banknote,
    title: "Pay & confirm",
    detail: "Complete payment through one of NoLSAF's certified payment partners (M-Pesa, Airtel, Mixx by Yas, HaloPesa, Visa, Mastercard, PayPal, Stripe). Your booking is confirmed instantly once payment is authorised.",
    cta: { label: "Payment methods", href: "/help/payments" },
    color: "#f59e0b",
  },
  {
    step: "05",
    icon: CheckCircle2,
    title: "Check your email",
    detail: "A booking confirmation with your reference number, check-in instructions, and receipt is sent to your registered email address immediately after payment.",
    cta: null,
    color: "#4dd9ac",
  },
];

// ─── Help section links ───
const HELP_LINKS = [
  {
    icon: UserCheck,
    label: "Account Setup",
    sub: "Profile, phone, password & 2FA",
    href: "/help/account-setup",
    color: "#02665e",
    bg: "#02665e0f",
  },
  {
    icon: Banknote,
    label: "Payments",
    sub: "Methods, mobile money & groups",
    href: "/help/payments",
    color: "#02b4f5",
    bg: "#02b4f50f",
  },
  {
    icon: RefreshCcw,
    label: "Refunds & Cancellations",
    sub: "Windows, timelines & exceptions",
    href: "/help/refunds",
    color: "#ef4444",
    bg: "#ef44440f",
  },
  {
    icon: CircleDollarSign,
    label: "Pricing",
    sub: "What you pay and why",
    href: "/help/pricing",
    color: "#f59e0b",
    bg: "#f59e0b0f",
  },
  {
    icon: Home,
    label: "Owner Guide",
    sub: "List, manage & get paid",
    href: "/help/owner-guide",
    color: "#a78bfa",
    bg: "#a78bfa0f",
  },
  {
    icon: Car,
    label: "Driver Tools",
    sub: "Services, claims & portal",
    href: "/help/driver-tools",
    color: "#4dd9ac",
    bg: "#4dd9ac0f",
  },
  {
    icon: ReceiptText,
    label: "Payouts",
    sub: "Schedules, fees & methods",
    href: "/help/payouts",
    color: "#02665e",
    bg: "#02665e0f",
  },
  {
    icon: Zap,
    label: "Driver Earnings",
    sub: "How pay is calculated",
    href: "/help/driver-earnings",
    color: "#02b4f5",
    bg: "#02b4f50f",
  },
];

export default function HelpGettingStartedPage() {
  return (
    <>
      <HelpHeader />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        <div className="public-container py-8 sm:py-12">
          <HelpBackLink />

          {/* ── Hero ── */}
          <div className="mt-4 relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#010f0e] via-[#011a18] to-[#021f1c] text-white p-8 sm:p-10">
            <div className="pointer-events-none absolute inset-0 opacity-[0.035]"
              style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
            <div className="pointer-events-none absolute top-0 right-0 w-80 h-80 rounded-full blur-3xl opacity-20"
              style={{ background: "radial-gradient(circle, #02b4f5 0%, transparent 70%)" }} />
            <div className="pointer-events-none absolute bottom-0 left-0 w-64 h-64 rounded-full blur-3xl opacity-10"
              style={{ background: "radial-gradient(circle, #4dd9ac 0%, transparent 70%)" }} />

            <div className="relative z-10 grid sm:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#4dd9ac] mb-4">
                  <Zap className="h-3 w-3" /> Getting Started
                </div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight">
                  Your first NoLSAF<br />booking in 5 steps.
                </h1>
                <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                  From browsing to check-in — everything you need to know to book confidently on NoLSAF for the first time.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/public/properties" className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#02665e] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[#024d47] hover:gap-3 transition-all duration-200 shadow-md">
                    Browse properties <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/help/account-setup" className="no-underline inline-flex items-center gap-2 rounded-xl bg-white/10 border border-white/20 text-white px-5 py-2.5 text-sm font-semibold hover:bg-white/20 hover:gap-3 transition-all duration-200">
                    Account setup <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* Right: quick stat cards */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: BadgeCheck, label: "Verified properties",  sub: "Inspected by NoLSAF" },
                  { icon: ShieldCheck, label: "Secure payments",     sub: "Certified partners" },
                  { icon: Smartphone, label: "Mobile money ready",   sub: "M-Pesa · Airtel · Mixx" },
                  { icon: MapPin,     label: "East Africa",           sub: "Tanzania · Kenya · Uganda" },
                ].map(({ icon: Icon, label, sub }) => (
                  <div key={label} className="rounded-xl bg-white/8 border border-white/12 p-4 backdrop-blur-sm">
                    <Icon className="h-5 w-5 text-[#02b4f5] mb-2" />
                    <p className="text-xs font-bold text-white leading-snug">{label}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── How to book — vertical timeline ── */}
          <section className="mt-12">
            <div className="flex items-center gap-3 mb-7">
              <div className="h-8 w-8 rounded-lg bg-[#02665e] flex items-center justify-center flex-shrink-0">
                <BookOpen className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">How to make your first booking</h2>
                <p className="text-sm text-gray-500">Five steps from search to confirmation.</p>
              </div>
            </div>

            <div className="relative">
              {/* Vertical connector line */}
              <div className="absolute left-[19px] top-8 bottom-8 w-px bg-gradient-to-b from-[#02b4f5] via-[#02665e] to-[#4dd9ac] opacity-20 hidden sm:block" />

              <div className="space-y-4">
                {BOOKING_STEPS.map(({ step, icon: Icon, title, detail, cta, color }) => (
                  <div key={step} className="group relative sm:pl-12">
                    {/* Step indicator — sits on the line */}
                    <div className="absolute left-0 top-5 hidden sm:flex h-10 w-10 rounded-full border-2 items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-110"
                      style={{ borderColor: color, backgroundColor: `${color}12` }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>

                    <div className="relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 p-5 sm:p-6">
                      <div className="absolute inset-x-0 top-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left rounded-t-2xl"
                        style={{ backgroundColor: color }} />
                      <span className="absolute right-5 top-4 text-[4rem] font-black leading-none select-none pointer-events-none opacity-[0.05] group-hover:opacity-[0.09] transition-opacity duration-300"
                        style={{ color }}>{step}</span>

                      <div className="flex items-start gap-3 sm:gap-0">
                        {/* Mobile icon (hidden on sm+) */}
                        <div className="flex-shrink-0 sm:hidden h-9 w-9 rounded-xl flex items-center justify-center"
                          style={{ backgroundColor: `${color}18` }}>
                          <Icon className="h-4 w-4" style={{ color }} />
                        </div>
                        <div className="relative z-10 flex-1">
                          <p className="text-sm font-black text-gray-900">{title}</p>
                          <p className="mt-1.5 text-xs text-gray-500 leading-relaxed max-w-xl">{detail}</p>
                          {cta && (
                            <Link href={cta.href} className="no-underline mt-3 inline-flex items-center gap-1.5 text-xs font-semibold hover:gap-2.5 transition-all duration-200"
                              style={{ color }}>
                              {cta.label} <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Tip: things to check before you confirm ── */}
          <div className="mt-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
            <Info className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 space-y-1.5">
              <p className="font-bold">Before you confirm - check these three things:</p>
              <ul className="space-y-1">
                {[
                  "The cancellation window - you have 24 hrs free cancellation if done 72+ hrs before check-in.",
                  "The payment type - standard bookings are paid in full now; Group Stay uses a deposit model.",
                  "House rules and max guest count - violations can result in early eviction with no refund.",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── All help sections ── */}
          <section className="mt-12">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#f0fdfc] via-white to-[#e8f8ff] border border-teal-200 p-6 sm:p-8">
              <div className="pointer-events-none absolute inset-0 opacity-[0.5]"
                style={{ backgroundImage: "linear-gradient(#02665e12 1px, transparent 1px), linear-gradient(90deg, #02665e12 1px, transparent 1px)", backgroundSize: "48px 48px" }} />

              <div className="relative z-10 mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Explore the Help Center</h2>
                <p className="text-base text-gray-500 mt-0.5">Every topic covered - pick what you need.</p>
              </div>

              <div className="relative z-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {HELP_LINKS.map(({ icon: Icon, label, sub, href, color, bg }) => (
                  <Link key={label} href={href}
                    className="no-underline group flex items-start gap-3 bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-200">
                    <div className="flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-200"
                      style={{ backgroundColor: bg }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 group-hover:text-[#02665e] transition-colors duration-200 leading-snug">{label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{sub}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#02665e] flex-shrink-0 mt-0.5 transition-colors duration-200" />
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* ── CTA ─ */}
          <div className="group mt-8 relative overflow-hidden bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-[#02665e]/30 hover:-translate-y-1 transition-all duration-300 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#02665e18_0%,_transparent_65%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative z-10 flex items-start gap-4">
              <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center">
                <LifeBuoy className="h-5 w-5 text-[#02665e]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Still need help?</h3>
                <p className="mt-1 text-sm text-gray-500 max-w-md">
                  Can't find what you're looking for? Our support team responds within 24 hours on business days.
                </p>
              </div>
            </div>
            <div className="relative z-10 flex flex-wrap gap-3 flex-shrink-0">
              <Link href="/help" className="no-underline inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-gray-700 px-5 py-2.5 text-sm font-semibold hover:border-[#02665e]/40 hover:text-[#02665e] hover:gap-3 transition-all duration-200 shadow-sm">
                Help Center <ChevronRight className="h-4 w-4" />
              </Link>
              <a href="mailto:info@nolsaf.com" className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#02665e] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[#024d47] hover:gap-3 transition-all duration-200 shadow-md">
                Email support <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>

        </div>
      </div>
      <HelpFooter />
    </>
  );
}
