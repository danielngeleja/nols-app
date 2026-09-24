import Link from "next/link";
import {
  CreditCard,
  Smartphone,
  Globe,
  Zap,
  ShieldCheck,
  Lock,
  BadgeCheck,
  ArrowRight,
  Wifi,
  CheckCircle2,
  Clock3,
  Info,
  ReceiptText,
  RefreshCcw,
  ChevronRight,
  Banknote,
  Star,
  Users,
} from "lucide-react";

import LayoutFrame from "@/components/LayoutFrame";
import { HelpFooter, HelpHeader } from "../HelpChrome";
import HelpBackLink from "../HelpBackLink";

const LOCAL_METHODS = [
  { name: "M-Pesa",       network: "Vodacom", color: "#e31837", bg: "#e318170f" },
  { name: "Airtel Money", network: "Airtel",  color: "#f4282d", bg: "#f4282d0f" },
  { name: "Mixx by Yas",  network: "Yas",    color: "#00a0e3", bg: "#00a0e30f" },
  { name: "HaloPesa",     network: "Halotel", color: "#f59e0b", bg: "#f59e0b0f" },
];

const INTL_METHODS = [
  { name: "Visa",       color: "#1a1f71", bg: "#1a1f710f", sub: "Debit & credit" },
  { name: "Mastercard", color: "#eb001b", bg: "#eb001b0f", sub: "Debit & credit" },
  { name: "PayPal",     color: "#003087", bg: "#0030870f", sub: "Wallet & linked cards" },
  { name: "Stripe",     color: "#635bff", bg: "#635bff0f", sub: "Global card processing" },
];

const PAYMENT_FLOW = [
  { step: "01", icon: CreditCard,  title: "Choose your method",  description: "At checkout, all payment methods available for that booking are shown. Pick the one that works best for you.", color: "#02b4f5" },
  { step: "02", icon: Lock,        title: "Confirm & authorise", description: "Complete your payment via your chosen method. You are taken to a secure screen managed by our payment partner. NoLSAF never sees your card or wallet details.", color: "#a78bfa" },
  { step: "03", icon: BadgeCheck,  title: "Booking confirmed",   description: "Once payment is authorised, your booking is confirmed instantly and a receipt is sent to your registered contact.", color: "#02665e" },
  { step: "04", icon: ShieldCheck, title: "Funds held securely", description: "Your payment is held by our payment partner until check-in is validated. NoLSAF does not handle your money directly.", color: "#f59e0b" },
];

const SECURITY_BADGES = [
  { icon: Lock,        label: "Encrypted in transit",      sub: "All payment data passes through secure, encrypted channels managed by our payment partners." },
  { icon: ShieldCheck, label: "Certified payment partners", sub: "We work exclusively with payment providers that meet international compliance standards." },
  { icon: BadgeCheck,  label: "OTP confirmation",           sub: "Mobile money payments require a one-time PIN sent directly to your registered SIM by the network." },
  { icon: RefreshCcw,  label: "Funds held until check-in",  sub: "Your payment is held by the payment partner until your booking is validated. Protecting you at every step." },
];

export default function HelpPaymentsPage() {
  return (
    <>
      <HelpHeader />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        <div className="public-container py-8 sm:py-12">
          <HelpBackLink />

          {/* Hero */}
          <div className="mt-4 relative overflow-hidden rounded-2xl bg-[#010f0e] text-white shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-[#011918] via-[#01332e] to-[#010f0e]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_100%_0%,_#02b4f53a_0%,_transparent_65%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_35%_at_0%_100%,_#02665e45_0%,_transparent_60%)]" />
            <div className="absolute inset-0 opacity-[0.06]"
              style={{ backgroundImage: "radial-gradient(circle,#ffffff 1px,transparent 1px)", backgroundSize: "22px 22px" }} />
            <div className="hidden lg:block absolute right-10 top-1/2 -translate-y-1/2 w-52 h-32 rounded-2xl bg-gradient-to-br from-[#02b4f5] to-[#02665e] shadow-2xl shadow-[#02b4f5]/30 rotate-6 opacity-20 pointer-events-none" />
            <div className="hidden lg:block absolute right-16 top-1/2 -translate-y-[60%] w-52 h-32 rounded-2xl border border-white/20 bg-white/5 shadow-xl -rotate-3 opacity-30 pointer-events-none" />
            <div className="relative z-10 grid lg:grid-cols-[1fr_auto] gap-6 px-7 py-10 sm:px-10 sm:py-12 items-center">
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] mb-5">
                  <CreditCard className="h-3.5 w-3.5 text-[#02b4f5]" />
                  <span className="text-white/90">Payment Methods</span>
                </div>
                <h1 className="text-3xl sm:text-[2.5rem] font-extrabold leading-[1.15] tracking-tight">
                  Pay how{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#02b4f5] to-[#4dd9ac]">
                    you prefer
                  </span>
                </h1>
                <p className="mt-4 text-white/60 text-sm sm:text-base leading-relaxed max-w-lg">
                  NoLSAF works with trusted payment partners to support local mobile money and international card payments — including tap-to-pay. Your money is handled securely by our payment providers, never directly by NoLSAF.
                </p>
                <div className="mt-6 flex flex-wrap gap-2.5">
                  {["M-Pesa", "Airtel Money", "Visa", "Mastercard", "PayPal"].map((m) => (
                    <span key={m} className="inline-flex items-center rounded-full bg-white/10 border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80">{m}</span>
                  ))}
                  <span className="inline-flex items-center rounded-full bg-[#02b4f5]/20 border border-[#02b4f5]/30 px-3 py-1.5 text-xs font-semibold text-[#02b4f5]">+ more</span>
                </div>
              </div>
              <div className="hidden lg:flex flex-col gap-3 min-w-[200px]">
                {[
                  { icon: Smartphone, label: "Mobile money",  value: "4 networks",       color: "#02b4f5" },
                  { icon: CreditCard, label: "Cards",         value: "Visa  MC  more",  color: "#a78bfa" },
                  { icon: Wifi,       label: "Tap-to-pay",    value: "NFC supported",     color: "#4dd9ac" },
                  { icon: Globe,      label: "International", value: "Multi-currency",    color: "#f59e0b" },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className="flex items-center gap-3 rounded-xl bg-white/[0.07] border border-white/10 px-4 py-3 hover:bg-white/[0.12] transition-colors duration-200 cursor-default">
                    <div className="flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}22` }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div>
                      <p className="text-[10px] text-white/40 uppercase tracking-wider leading-none mb-0.5">{label}</p>
                      <p className="text-sm font-bold text-white leading-none">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tap-to-pay spotlight */}
          <section className="mt-10 relative overflow-hidden rounded-2xl border border-[#02b4f5]/20 shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-[#001f2e] to-[#000d10]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_0%_50%,_#02b4f520_0%,_transparent_70%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_60%_at_100%_100%,_#4dd9ac15_0%,_transparent_60%)]" />
            <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center pointer-events-none">
              <div className="h-36 w-36 rounded-full border border-[#02b4f5]/10 animate-ping absolute" style={{ animationDuration: "3s" }} />
              <div className="h-24 w-24 rounded-full border border-[#02b4f5]/20 animate-ping absolute" style={{ animationDuration: "2s" }} />
              <div className="h-16 w-16 rounded-full bg-[#02b4f5]/10 border border-[#02b4f5]/30 flex items-center justify-center relative z-10">
                <Wifi className="h-7 w-7 text-[#02b4f5] rotate-90" />
              </div>
            </div>
            <div className="relative z-10 px-7 py-8 sm:px-10 sm:py-10 max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#02b4f5]/15 border border-[#02b4f5]/30 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#02b4f5] mb-5">
                <Zap className="h-3 w-3" /> New experience
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                Tap-to-pay &amp; NFC
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#02b4f5] to-[#4dd9ac] text-xl sm:text-2xl mt-0.5">
                  Touch. Done. Protected.
                </span>
              </h2>
              <p className="mt-4 text-white/55 text-sm leading-relaxed">
                Where supported, you can pay by simply holding your phone or contactless card close to the terminal — no typing, no waiting. Payment is processed instantly through our certified payment partners, who handle the transaction on your behalf with full security.
              </p>
              <ul className="mt-5 space-y-2.5">
                {[
                  "Works with Apple Pay, Google Pay, and Samsung Pay",
                  "Supported on contactless Visa and Mastercard cards",
                  "Your actual card details are never shared with NoLSAF or the property",
                  "Available at properties with NFC-enabled terminals",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-white/60">
                    <CheckCircle2 className="h-4 w-4 text-[#4dd9ac] flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Local payment methods */}
          <section className="mt-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-8 w-8 rounded-lg bg-[#02665e] flex items-center justify-center flex-shrink-0">
                <Smartphone className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Local mobile money</h2>
                <p className="text-sm text-gray-500">Tanzania&apos;s four major mobile networks. Processed through our local payment partners. Fast, familiar, and OTP-verified.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {LOCAL_METHODS.map(({ name, network, color, bg }) => (
                <div key={name} className="group relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:-translate-y-1.5 hover:shadow-xl transition-all duration-300 cursor-default">
                  <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"
                    style={{ background: `linear-gradient(to right, ${color}, #02665e)` }} />
                  <div className="h-12 w-12 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300"
                    style={{ backgroundColor: bg, border: `1px solid ${color}25` }}>
                    <Smartphone className="h-5 w-5" style={{ color }} />
                  </div>
                  <p className="font-extrabold text-gray-900 text-sm">{name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{network}</p>
                  <div className="mt-3 flex items-center gap-1">
                    <Clock3 className="h-3 w-3 text-gray-400" />
                    <span className="text-[10px] text-gray-500 font-medium">Instant authorisation</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
              <Info className="h-4 w-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-teal-800">
                Mobile money payments are processed by our local payment partners and require an <strong>OTP confirmation</strong> sent to your registered SIM. Make sure your number is up to date on your NoLSAF account before paying.
              </p>
            </div>
          </section>

          {/* International payments */}
          <section className="mt-10 relative overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-[#f0fdfc] via-white to-[#e8f8ff]" />
            <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(to right,#02665e0a 1px,transparent 1px),linear-gradient(to bottom,#02665e0a 1px,transparent 1px)", backgroundSize: "32px 32px", opacity: 0.4 }} />
            <div className="relative z-10 px-6 py-8 sm:px-10 sm:py-10">
              <div className="flex items-center gap-3 mb-7">
                <div className="h-9 w-9 rounded-xl bg-[#a78bfa] flex items-center justify-center flex-shrink-0 shadow-md shadow-[#a78bfa]/30">
                  <Globe className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">International &amp; card payments</h2>
                  <p className="text-sm text-gray-500">Guests from anywhere in the world can pay with their preferred card or digital wallet.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {INTL_METHODS.map(({ name, color, bg, sub }) => (
                  <div key={name} className="group relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:-translate-y-1.5 hover:shadow-xl transition-all duration-300 cursor-default">
                    <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"
                      style={{ background: `linear-gradient(to right, ${color}, #02665e)` }} />
                    <div className="h-12 w-12 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300"
                      style={{ backgroundColor: bg, border: `1px solid ${color}20` }}>
                      <CreditCard className="h-5 w-5" style={{ color }} />
                    </div>
                    <p className="font-extrabold text-gray-900 text-sm">{name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
                    <div className="mt-3 flex items-center gap-1">
                      <Wifi className="h-3 w-3 text-gray-400" />
                      <span className="text-[10px] text-gray-500 font-medium">Tap-to-pay supported</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-start gap-3 bg-white/80 border border-purple-200 rounded-xl px-4 py-3">
                <Info className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-purple-800">
                  International payments are processed by our certified global payment partners. Currency conversion happens at the rate set by your card network at the time of payment. Your bank may apply a transaction fee. We recommend checking before you book.
                </p>
              </div>
            </div>
          </section>

          {/* Payment flow */}
          <section className="mt-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-8 w-8 rounded-lg bg-[#02b4f5] flex items-center justify-center flex-shrink-0">
                <ReceiptText className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">How payment works</h2>
                <p className="text-sm text-gray-500">From checkout to booking confirmation  every step explained.</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PAYMENT_FLOW.map(({ step, icon: Icon, title, description, color }) => (
                <div key={step} className="relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:-translate-y-1.5 hover:shadow-xl transition-all duration-300 group cursor-default">
                  <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"
                    style={{ background: `linear-gradient(to right, ${color}, #02665e)` }} />
                  <span className="absolute right-3 top-2 text-[4rem] font-black leading-none select-none pointer-events-none opacity-[0.06] group-hover:opacity-[0.11] transition-opacity duration-300" style={{ color }}>
                    {step}
                  </span>
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-all duration-300"
                    style={{ backgroundColor: `${color}18` }}>
                    <Icon className="h-5 w-5" style={{ color }} />
                  </div>
                  <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
                  <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Security strip */}
          <section className="mt-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Your payment is in safe hands</h2>
                <p className="text-sm text-gray-500">All transactions are handled by our certified payment partners. Not stored or processed directly by NoLSAF.</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {SECURITY_BADGES.map(({ icon: Icon, label, sub }, i, arr) => (
                <div key={label} className={`group flex items-start gap-4 px-6 py-5 hover:bg-slate-50 transition-colors duration-200 cursor-default ${i < arr.length - 1 ? "border-b border-slate-100" : ""}`}>
                  <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                    <Icon className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 group-hover:text-emerald-700 transition-colors duration-200">{label}</p>
                    <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{sub}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-emerald-600 ml-auto flex-shrink-0 mt-1 transition-colors duration-200" />
                </div>
              ))}
            </div>
          </section>

          {/* Payment timing note */}
          <div className="mt-8 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
            <Banknote className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 space-y-1">
              <p><strong>When is my payment taken?</strong> Payment is collected in full at the time your booking is confirmed and processed by our payment partner. On some cards, a temporary hold may show on your statement. This is released automatically once the transaction settles, usually within 1–3 business days.</p>
              <p className="mt-1"><strong>NoLSAF is fully cashless for standard bookings.</strong> All regular bookings require full digital payment at checkout. No pay-later, no ad-hoc cash. <em>Exception:</em> Group Stay bookings operate on a deposit model. A non-refundable deposit is paid digitally at booking, and the outstanding balance may be settled digitally or in cash at arrival. See the section below for details.</p>
            </div>
          </div>

          {/* Special booking type: Group Stay */}
          <section className="mt-12">
            {/* Dark header strip */}
            <div className="relative overflow-hidden rounded-2xl bg-[#02665e] p-6 sm:p-8 mb-6 text-white"
              style={{ backgroundImage: "radial-gradient(ellipse at 80% 0%, #02b4f540 0%, transparent 60%), radial-gradient(ellipse at 0% 100%, #01332e90 0%, transparent 60%)" }}>
              <div className="pointer-events-none absolute inset-0 opacity-[0.18]"
                style={{ backgroundImage: "repeating-linear-gradient(-55deg, rgba(255,255,255,1) 0px, rgba(255,255,255,1) 1.5px, transparent 1.5px, transparent 22px)" }} />
              <div className="relative z-10 flex items-start gap-4">
                <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-white/15 border border-white/30 flex items-center justify-center">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/15 border border-white/30 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white mb-2">
                    Exceptional payment flow
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black tracking-tight">Group Stay</h2>
                  <p className="mt-1.5 text-sm text-white/80 max-w-xl leading-relaxed">
                    This booking type follows a two-stage payment model: a non-refundable deposit secures your slot, and the remaining balance is settled before or at arrival. All deposits are processed digitally through NoLSAF&rsquo;s certified payment partners.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-5">
              {/* Group Stay card */}
              <div className="group relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-violet-300 hover:-translate-y-1 transition-all duration-300">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-purple-400 scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left rounded-t-2xl" />
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Users className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-black text-gray-900 text-base">Group Stay</h3>
                      <p className="text-xs text-violet-600 font-medium">Families · Corporates · Events · Tours</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">
                    Group bookings cover multiple guests across multiple rooms or properties. Because of scale and complexity, payment handling follows a dedicated process separate from individual bookings.
                  </p>
                  <ul className="space-y-3">
                    {[
                      { label: "Non-refundable deposit required", detail: "A deposit is required at booking to confirm and lock all rooms for your group. This deposit is non-refundable regardless of cancellation timing." },
                      { label: "Rooms secured for your group", detail: "Group-booked rooms are protected from reallocation to other users, as long as payment terms are honoured." },
                      { label: "Balance before or at check-in", detail: "The outstanding balance can be paid digitally via any supported method, or settled in cash upon arrival at the property." },
                      { label: "Unpaid balance = full cancellation", detail: "If the remaining balance is not paid by the agreed deadline, the entire group booking is cancelled. Not a partial reallocation." },
                      { label: "Cancellation windows", detail: "Cancellations more than 30 days before check-in may qualify for a partial refund. Within 30 days, bookings are typically non-refundable." },
                      { label: "Date & guest-count changes", detail: "Date changes require 60+ days notice. Reducing guest count may forfeit group discounts; increases depend on available capacity." },
                    ].map(({ label, detail }) => (
                      <li key={label} className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-xs font-bold text-gray-800">{label} — </span>
                          <span className="text-xs text-gray-500">{detail}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-slate-100 px-6 py-3 bg-violet-50/50 flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                  <p className="text-[11px] text-violet-700">All group deposits go through NoLSAF&rsquo;s certified digital payment partners.</p>
                </div>
              </div>
            </div>

            {/* Deposit footnote */}
            <div className="mt-4 flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4">
              <Info className="h-4 w-4 text-slate-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-600 leading-relaxed">
                <strong>On deposits:</strong> Non-refundable deposits are processed digitally through NoLSAF&rsquo;s payment partners. Paying a deposit does not complete the booking. The full balance must be settled by the stated deadline or your booking will be cancelled and the deposit forfeited. Receipt confirmation is sent immediately after the deposit is processed.
              </p>
            </div>
          </section>

          {/* CTA */}
          <div className="group mt-6 relative overflow-hidden bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-[#02665e]/30 hover:-translate-y-1 transition-all duration-300 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#02665e18_0%,_transparent_65%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative z-10 flex items-start gap-4">
              <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center">
                <Star className="h-5 w-5 text-[#02665e]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Questions about a payment or refund?</h3>
                <p className="mt-1 text-sm text-gray-500 max-w-md">
                  Review the cancellation &amp; refunds policy or contact our support team directly.
                </p>
              </div>
            </div>
            <div className="relative z-10 flex flex-wrap gap-3 flex-shrink-0">
              <Link href="/help/refunds" className="no-underline inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-gray-700 px-5 py-2.5 text-sm font-semibold hover:border-[#02665e]/40 hover:text-[#02665e] hover:gap-3 transition-all duration-200 shadow-sm">
                Refunds &amp; cancellations <ArrowRight className="h-4 w-4" />
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
