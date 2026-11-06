import type { Metadata } from "next";
import Image from "next/image";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import { CircleAlert, Lock, ScanSearch, ShieldCheck, Smartphone, UserCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Stay Safe",
  description:
    "Learn practical ways to stay safe from fraud and scams while managing money and travel bookings on NoLSAF.",
  alternates: { canonical: "https://nolsaf.com/stay-safe" },
};

const NEVER_SHARE = [
  {
    title: "Your NoLSAF password or one-time codes",
    body: "Treat login credentials and verification codes as private keys to your account. NoLSAF staff will not request them in calls, chat, or social media.",
  },
  {
    title: "Card PIN, CVV, or mobile wallet secrets",
    body: "Never disclose payment PINs, CVV, or wallet confirmation codes. Keep these details confidential at all times.",
  },
  {
    title: "Sensitive account details to unknown callers",
    body: "If someone claims urgency and asks for account details, stop and verify through official NoLSAF support channels first.",
  },
];

const COMMON_SCAMS = [
  {
    title: "Fake NoLSAF support messages",
    body: "Scammers can imitate brand names, logos, or phone numbers. Verify requests through official NoLSAF channels before taking any action.",
  },
  {
    title: "High-return investment promises",
    body: "Be careful with offers that guarantee unusually high returns. NoLSAF does not run investment schemes or ask you to transfer money for investments.",
  },
  {
    title: "Phishing links and cloned pages",
    body: "Fraud messages may push urgent clicks. Confirm website addresses carefully and avoid entering credentials on unfamiliar pages.",
  },
  {
    title: "Authority or charity impersonation",
    body: "Fraudsters may pretend to be police, utilities, aid groups, or tax agents and pressure immediate payment. Always verify independently.",
  },
  {
    title: "Relationship and trust scams",
    body: "Online strangers may build trust quickly and then request money. Be cautious with emotional pressure and payment requests.",
  },
];

const IF_SCAMMED = [
  "Contact support immediately at support@nolsaf.com with key details.",
  "Avoid sharing incident details publicly while verification is ongoing.",
  "Secure your account quickly: reset password, sign out of other sessions, and review recent activity.",
  "Our team may temporarily restrict risky actions while we investigate to protect your funds and account.",
];

const HOW_WE_PROTECT = [
  "Strong authentication, including password and supported secure verification steps.",
  "Continuous transaction and behavior monitoring to detect suspicious activity.",
  "Security controls designed with trusted infrastructure and payment partners.",
];

const PROTECTION_ICONS = [Lock, ScanSearch, ShieldCheck];

const PROTECTION_STYLES = [
  {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    iconWrap: "bg-emerald-600/10 text-emerald-700",
  },
  {
    card: "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50",
    iconWrap: "bg-sky-600/10 text-sky-700",
  },
  {
    card: "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50",
    iconWrap: "bg-violet-600/10 text-violet-700",
  },
];

const NEVER_SHARE_STYLES = [
  {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    badge: "bg-emerald-600/10 text-emerald-700",
  },
  {
    card: "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50",
    badge: "bg-sky-600/10 text-sky-700",
  },
  {
    card: "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50",
    badge: "bg-violet-600/10 text-violet-700",
  },
];

export default function StaySafePage() {
  return (
    <>
      <PublicHeader />
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <section className="public-container py-10 md:py-14">
          <article className="mx-auto w-full max-w-none overflow-hidden rounded-xl border border-solid border-slate-300/80 bg-white">
            {/* Editorial header: what this is, when it was updated, then the title and a short intro */}
            <header className="bg-[#02665e] px-5 py-7 text-white sm:px-8 sm:py-9 md:px-10">
              <p className="m-0 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-white/75">
                <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-emerald-200" aria-hidden /> Safety guide
                </span>
                <span aria-hidden className="text-white/40">·</span>
                <time dateTime="2026-05-23">Updated 23 May 2026</time>
              </p>
              <h1 className="m-0 mt-3 max-w-[24ch] text-[26px] font-bold leading-[1.15] tracking-tight sm:text-[34px]">
                How to stay safe while managing your money
              </h1>
              <p className="m-0 mt-3 max-w-[62ch] text-[14.5px] leading-relaxed text-white/80 sm:text-[15px]">
                Your financial safety is a core priority at NoLSAF. Scams evolve quickly,
                so practical awareness is one of the best protections. This guide explains
                common warning signs and the actions to take if something feels suspicious.
              </p>
            </header>

            <div className="space-y-10 px-6 py-8 md:px-10 md:py-10">
              <section>
                <h2 className="text-center text-xl sm:text-2xl font-bold leading-tight tracking-tight text-slate-900">Three Things You Must Keep Private</h2>
                <div aria-hidden className="mt-2 flex justify-center">
                  <Lock className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
                </div>
                <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
                  Protect your account by keeping the following information strictly private.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {NEVER_SHARE.map((item, index) => {
                    const style = NEVER_SHARE_STYLES[index] ?? {
                      card: "border-slate-200 bg-white",
                      badge: "bg-[#02665e]/10 text-[#02665e]",
                    };

                    return (
                    <article
                      key={item.title}
                      className={`relative h-full overflow-hidden rounded-2xl border px-4 py-5 shadow-sm ${style.card}`}
                    >
                      <div className="relative">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${style.badge}`}>
                          {`0${index + 1}`}
                        </span>
                        <h3 className="mt-3 text-base sm:text-lg font-bold leading-tight tracking-tight text-slate-900">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.body}</p>
                      </div>
                    </article>
                    );
                  })}
                </div>

                <div className="mt-8 flex justify-center">
                  <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-b from-sky-50 via-white to-slate-50 px-6 py-8 text-center">
                    <div aria-hidden className="pointer-events-none absolute inset-0">
                      <div className="absolute inset-0 opacity-[0.22]" style={{ backgroundImage: "radial-gradient(circle, rgba(14,116,144,0.20) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
                    </div>

                    <div className="relative flex justify-center">
                      <div className="relative">
                        <Smartphone className="h-28 w-28 text-[#02665e]/30" strokeWidth={1.3} />
                        <Lock className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-[#02665e]/80" strokeWidth={1.7} />
                      </div>
                    </div>

                    <h3 className="relative mt-3 text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                      Protect your Information
                    </h3>
                    <p className="relative mt-2 text-sm leading-relaxed text-slate-600">
                      Keep personal credentials private and verify requests before sharing sensitive details.
                    </p>
                  </div>
                </div>

              </section>

              <section>
                <h2 className="text-xl sm:text-2xl font-bold leading-tight tracking-tight text-slate-900">Common Payment Scams To Watch</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Watch for these common scam patterns before sharing information or sending money.
                </p>
                <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-slate-300 to-transparent" />

                <div className="mt-4 grid gap-x-10 gap-y-5 md:grid-cols-2">
                  {COMMON_SCAMS.map((item, index) => (
                    <article key={item.title} className="relative pl-11 pb-3">
                      <span className="absolute left-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-xs font-bold text-[#02665e]">
                        {`0${index + 1}`}
                      </span>
                      <h3 className="text-base sm:text-lg font-bold leading-tight tracking-tight text-slate-900">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.body}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-center text-xl sm:text-2xl font-bold leading-tight tracking-tight text-slate-900">What To Do If You Suspect A Scam</h2>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {IF_SCAMMED.map((item, index) => {
                    const icons = [CircleAlert, UserCheck, Lock, ShieldCheck];
                    const Icon = icons[index] ?? CircleAlert;

                    return (
                      <div
                        key={item}
                        className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <p className="m-0 text-sm leading-relaxed text-slate-700">{item}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h2 className="text-xl sm:text-2xl font-bold leading-tight tracking-tight text-slate-900">How NoLSAF Helps Protect You</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Security is layered across access control, threat detection, and infrastructure safeguards.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {HOW_WE_PROTECT.map((item, index) => {
                    const Icon = PROTECTION_ICONS[index] ?? ShieldCheck;
                    const style = PROTECTION_STYLES[index] ?? {
                      card: "border-slate-200 bg-white",
                      iconWrap: "bg-[#02665e]/10 text-[#02665e]",
                    };

                    return (
                      <article key={item} className={`rounded-2xl border px-4 py-4 shadow-sm ${style.card}`}>
                        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${style.iconWrap}`}>
                          <Icon className="h-5 w-5" strokeWidth={2} />
                        </span>
                        <p className="mt-3 text-sm leading-relaxed text-slate-700">{item}</p>
                      </article>
                    );
                  })}
                </div>

                <div className="mt-10 flex flex-col items-center text-center">
                  <div className="rounded-full bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200">
                    <Image
                      src="/assets/NoLS2025-04.png"
                      alt="NoLSAF"
                      width={150}
                      height={44}
                      className="h-auto w-auto object-contain"
                    />
                  </div>
                  <p className="mt-4 text-lg sm:text-xl font-semibold tracking-tight text-slate-900">
                    Quality Stay for Every Wallet
                  </p>
                </div>
              </section>

            </div>
          </article>
        </section>
      </main>
      <PublicFooter withRail={false} />
    </>
  );
}
