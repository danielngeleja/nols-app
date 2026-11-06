import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Binoculars,
  ChevronRight,
  ClipboardCheck,
  Compass,
  FileCheck,
  Globe,
  Leaf,
  MapPin,
  Mountain,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  TreePine,
  Users,
  Zap,
} from "lucide-react";

import LayoutFrame from "@/components/LayoutFrame";
import { HelpFooter, HelpHeader } from "../HelpChrome";
import HelpBackLink from "../HelpBackLink";

const ATTRACTION_TYPES = [
  { icon: TreePine,   label: "National parks",           sub: "Serengeti, Kilimanjaro, Nyerere, Mikumi and other gazetted parks across East Africa.",           gradient: "from-green-600 to-emerald-700",  shadow: "shadow-green-100" },
  { icon: Binoculars, label: "Wildlife game reserves",   sub: "Selous, Ruaha, Ngorongoro guided game drives, night safaris, and walking expeditions.",         gradient: "from-amber-600 to-yellow-600",  shadow: "shadow-amber-100" },
  { icon: Mountain,   label: "Mountain treks & climbs",  sub: "Summit expeditions, acclimatisation treks, and guided ascents on Kilimanjaro and beyond.",         gradient: "from-slate-600 to-slate-800",   shadow: "shadow-slate-100" },
  { icon: Globe,      label: "Marine & coastal parks",   sub: "Mafia Island, Zanzibar Marine Park - snorkelling, diving, and reef conservation encounters.",     gradient: "from-cyan-600 to-blue-600",     shadow: "shadow-cyan-100" },
  { icon: Leaf,       label: "Nature reserves & trails", sub: "Arusha, Gombe, Mahale - primate tracking, bird watching, and forest trail experiences.",          gradient: "from-teal-600 to-green-600",    shadow: "shadow-teal-100" },
  { icon: Compass,    label: "Cultural heritage sites",  sub: "UNESCO-listed ruins, ancient caravan routes, and archaeological sites guided with context.",      gradient: "from-orange-500 to-amber-600",  shadow: "shadow-orange-100" },
];

const HOW_IT_WORKS = [
  { step: "01", icon: Sparkles,      title: "Guest expresses interest",      detail: "When a user on NoLSAF selects a park, reserve, or safari-type attraction during planning, the platform flags them as a tourist-attraction seeker and opens their request for assignment." },
  { step: "02", icon: Users,         title: "NoLSAF matches to your stand",  detail: "Based on your registered coverage area, license category, and availability, NoLSAF routes the request directly to your operator account with guest details, dates, and the attraction of interest." },
  { step: "03", icon: ClipboardCheck,title: "You accept & confirm the tour", detail: "Accept the assignment, confirm your itinerary, and lock in the tour details through the operator dashboard. The guest receives an instant confirmation with your company profile and license badge." },
  { step: "04", icon: MapPin,        title: "You lead the experience",       detail: "You handle everything on the ground - transport, park fees, safety briefing, guide narration, and guest wellbeing. NoLSAF manages the payment and review at the close of the experience." },
];

const WHAT_YOU_GET = [
  { icon: FileCheck,   title: "Verified operator badge",      detail: "Your company appears on the platform with a 'Verified Safari Operator' badge, built from your license details, coverage areas, and guest reviews." },
  { icon: ShieldCheck, title: "Assignment matching engine",   detail: "The platform matches tourist-attraction seekers to your stand automatically based on area, capacity, and speciality - no cold prospecting needed." },
  { icon: Globe,       title: "Multi-park coverage profile",  detail: "Register your stand across multiple parks and reserves. When a guest selects any of your covered attractions, you are in the match pool." },
  { icon: Binoculars,  title: "Tour & guest management tools",detail: "Manage booking details, itineraries, guest lists, waivers, and post-tour reviews from a single operator dashboard built for field professionals." },
];

export default function HelpNolsafStandPage() {
  return (
    <>
      <HelpHeader />
      <div className="min-h-screen bg-[#f8fafb]">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        <div className="public-container py-8 sm:py-14">
          <HelpBackLink />

          {/* ── Hero ──*/}
          <div className="mt-4 relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#010f0e] via-[#011a18] to-[#022820] text-white p-8 sm:p-12">
            {/* dot grid */}
            <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
            {/* glow blobs */}
            <div className="pointer-events-none absolute -top-20 -right-20 w-96 h-96 rounded-full blur-3xl opacity-25"
              style={{ background: "radial-gradient(circle, #4dd9ac 0%, transparent 65%)" }} />
            <div className="pointer-events-none absolute -bottom-12 -left-12 w-72 h-72 rounded-full blur-3xl opacity-10"
              style={{ background: "radial-gradient(circle, #02b4f5 0%, transparent 70%)" }} />

            <div className="relative z-10 grid lg:grid-cols-[1fr_auto] gap-10 items-start">
              {/* left */}
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#4dd9ac]/30 bg-[#4dd9ac]/10 px-3.5 py-1.5 text-[11px] font-bold text-[#4dd9ac] mb-5">
                  <Compass className="h-3 w-3" /> NoLSAF Stand
                </div>
                <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-[1.05]">
                  Connect tourists to<br />
                  <span className="text-[#4dd9ac]">parks, safaris</span><br />
                  &amp; wild places.
                </h1>
                <p className="mt-5 text-[15px] text-slate-300 leading-relaxed">
                  A NoLSAF Stand is a <strong className="text-white font-bold">licensed safari &amp; tour operator</strong> registered on the platform to receive and serve guests who want to explore national parks, game reserves, mountains, and natural attractions across East Africa.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/careers?role=nolsaf-stand"
                    className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#4dd9ac] text-[#011a14] px-6 py-3 text-sm font-extrabold hover:brightness-110 hover:gap-3 transition-all duration-200 shadow-xl shadow-[#4dd9ac]/25">
                    Register your Stand <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* right — stats */}
              <div className="grid grid-cols-2 gap-3 lg:min-w-[280px]">
                {[
                  { icon: ShieldCheck, label: "Licensed operators only",  sub: "Valid tour & safari license required",        color: "text-[#4dd9ac]" },
                  { icon: Users,       label: "Assigned guests",           sub: "Platform routes matching tourists to you",    color: "text-[#02b4f5]" },
                  { icon: Globe,       label: "Parks & reserves",          sub: "Register across multiple attraction types",   color: "text-amber-400" },
                  { icon: Zap,         label: "Earn per tour",             sub: "Commission on every confirmed experience",    color: "text-violet-400" },
                ].map(({ icon: Icon, label, sub, color }) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-sm p-4 hover:bg-white/[0.09] hover:border-white/20 transition-all duration-200">
                    <Icon className={`h-5 w-5 ${color} mb-3`} />
                    <p className="text-[13px] font-bold text-white leading-snug">{label}</p>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── What is a NoLSAF Stand ── */}
          <section className="mt-12">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#02665e] mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" /> Overview
            </div>
            <div className="grid lg:grid-cols-[1fr_360px] gap-5">
              {/* main explanation */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-7 sm:p-8">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-[#02665e] to-[#024d47] flex items-center justify-center shadow-md flex-shrink-0">
                    <Compass className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-gray-900">What is a NoLSAF Stand?</h2>
                    <p className="text-xs text-gray-500 mt-0.5">More than a location. A licensed gateway to East Africa&apos;s wild places.</p>
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">
                  A NoLSAF Stand is a <strong>registered safari and tour operation</strong> A company or licensed individual whose sole focus on the platform is to <strong>receive tourists who want to experience national parks, game reserves, wildlife safaris, mountain treks, and natural attractions</strong>. When a guest signals interest in a tourist attraction, the platform <em>assigns</em> them to a matching NoLSAF Stand in that region.
                </p>
                <p className="mt-4 text-sm text-gray-700 leading-relaxed">
                  This role is distinct from the Event Manager. While Event Managers coordinate cultural tourism and group stays, the NoLSAF Stand is the <strong>specialist arm for wildlife, nature, and adventure tourism</strong>. The operator on the ground who gets guests into the wild safely, legally, and memorably.
                </p>
              </div>

              {/* two stacked callout cards */}
              <div className="flex flex-col gap-4">
                <div className="flex-1 flex items-start gap-4 bg-white rounded-2xl border-l-4 border-[#02665e] border-y border-r border-slate-200/80 shadow-sm p-5">
                  <div className="h-9 w-9 rounded-xl bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                    <Shield className="h-4 w-4 text-[#02665e]" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold text-gray-900">License is mandatory.</p>
                    <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">Only companies or individuals holding a valid government-issued tour guide or safari operator license qualify to register as a NoLSAF Stand.</p>
                  </div>
                </div>
                <div className="flex-1 flex items-start gap-4 bg-white rounded-2xl border-l-4 border-[#4dd9ac] border-y border-r border-slate-200/80 shadow-sm p-5">
                  <div className="h-9 w-9 rounded-xl bg-[#4dd9ac]/15 flex items-center justify-center flex-shrink-0">
                    <BadgeCheck className="h-4 w-4 text-[#02665e]" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold text-gray-900">Guests come to you.</p>
                    <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">You do not prospect for clients. NoLSAF matches and assigns attraction-seeking travellers directly to your operator account based on your coverage area and license category.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Attractions you cover ── */}
          <section className="mt-14">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#02665e] mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" /> Coverage areas
            </div>
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Attractions you can register for</h2>
                <p className="text-sm text-gray-500 mt-1">Register across any categories that match your license coverage area.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {ATTRACTION_TYPES.map(({ icon: Icon, label, sub, gradient, shadow }, idx) => (
                <div key={label}
                  className={`group relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-sm ${shadow} hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-default`}>
                  {/* top gradient bar */}
                  <div className={`h-[3px] w-full bg-gradient-to-r ${gradient}`} />
                  {/* shimmer */}
                  <div className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent z-10" />
                  {/* watermark */}
                  <span className="pointer-events-none select-none absolute right-3 bottom-2 text-[4rem] font-black leading-none opacity-[0.035] text-slate-900">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div className="p-5 pt-4">
                    <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-md group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                      <Icon className="h-5 w-5 text-white drop-shadow" />
                    </div>
                    <p className="text-[13px] font-extrabold text-gray-900 leading-snug">{label}</p>
                    <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── How assignment works ── */}
          <section className="mt-14">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#02665e] mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" /> The process
            </div>
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">How guest assignment works</h2>
                <p className="text-sm text-gray-500 mt-1">Tourists come to you. Here is the journey from interest to experience.</p>
              </div>
            </div>

            <div className="relative">
              {/* connecting line (desktop only) */}
              <div className="hidden lg:block absolute top-[52px] left-[calc(12.5%+2px)] right-[calc(12.5%+2px)] h-px bg-gradient-to-r from-transparent via-[#4dd9ac]/40 to-transparent z-0" />

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                {HOW_IT_WORKS.map(({ step, icon: Icon, title, detail }, idx) => (
                  <div key={step}
                    className="group relative bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-6 overflow-hidden cursor-default">
                    {/* top accent on hover */}
                    <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl bg-gradient-to-r from-[#02665e] to-[#4dd9ac] scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                    {/* large step watermark */}
                    <span className="pointer-events-none select-none absolute right-3 bottom-1 text-[4.5rem] font-black leading-none opacity-[0.045] text-[#02665e]">{step}</span>

                    <div className="relative z-10">
                      {/* step badge */}
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-[#4dd9ac]/15 px-2.5 py-1 text-[10px] font-extrabold text-[#02665e] uppercase tracking-wider mb-4">
                        Step {idx + 1}
                      </div>
                      <div className="h-10 w-10 rounded-xl bg-[#4dd9ac]/15 flex items-center justify-center mb-3 group-hover:scale-110 group-hover:bg-[#4dd9ac]/25 transition-all duration-200">
                        <Icon className="h-4 w-4 text-[#02665e]" />
                      </div>
                      <p className="text-sm font-extrabold text-gray-900 leading-snug">{title}</p>
                      <p className="mt-2 text-xs text-gray-500 leading-relaxed">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── What approved operators receive ── */}
          <section className="mt-14">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#02665e]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#02665e] mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" /> Platform tools
            </div>
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">What approved operators receive</h2>
                <p className="text-sm text-gray-500 mt-1">Platform tools built specifically for licensed safari and tour professionals.</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {WHAT_YOU_GET.map(({ icon: Icon, title, detail }, idx) => (
                <div key={title}
                  className="group relative overflow-hidden bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
                  <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#02665e] to-[#4dd9ac] opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-l-2xl" />
                  <div className="p-6 flex items-start gap-5">
                    <div className="flex-shrink-0 h-12 w-12 rounded-2xl bg-gradient-to-br from-[#02665e]/10 to-[#4dd9ac]/15 flex items-center justify-center group-hover:scale-110 transition-transform duration-200 border border-[#4dd9ac]/20">
                      <Icon className="h-5 w-5 text-[#02665e]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-sm font-extrabold text-gray-900">{title}</p>
                        <span className="text-[10px] font-bold text-[#4dd9ac] bg-[#4dd9ac]/10 rounded-full px-2 py-0.5">0{idx + 1}</span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">{detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── CTA ───*/}
          <div className="mt-12 relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#010f0e] via-[#011a18] to-[#022820] text-white p-8 sm:p-10">
            <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
            <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full blur-3xl opacity-20"
              style={{ background: "radial-gradient(circle, #4dd9ac 0%, transparent 65%)" }} />

            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div className="flex items-start gap-5">
                <div className="flex-shrink-0 h-12 w-12 rounded-2xl bg-[#4dd9ac]/15 border border-[#4dd9ac]/25 flex items-center justify-center">
                  <Star className="h-5 w-5 text-[#4dd9ac]" />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#4dd9ac] mb-1">Ready to join?</p>
                  <h3 className="text-lg sm:text-xl font-extrabold text-white leading-snug">
                    Register your safari operation<br className="hidden sm:block" /> as a NoLSAF Stand.
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-400 max-w-md leading-relaxed">
                    Have your operator license ready. Our team reviews every application and verifies credentials before activating your Stand on the platform.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 flex-shrink-0">
                <Link href="/help/payouts"
                  className="no-underline inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 text-slate-300 px-5 py-2.5 text-sm font-semibold hover:bg-white/15 hover:text-white hover:gap-3 transition-all duration-200">
                  All opportunities <ChevronRight className="h-4 w-4" />
                </Link>
                <Link href="/careers?role=nolsaf-stand"
                  className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#4dd9ac] text-[#011a14] px-6 py-2.5 text-sm font-extrabold hover:brightness-110 hover:gap-3 transition-all duration-200 shadow-xl shadow-[#4dd9ac]/20">
                  Register now <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

        </div>
      </div>
      <HelpFooter />
    </>
  );
}
