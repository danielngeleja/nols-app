import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building,
  CalendarCheck,
  ChevronRight,
  FileSpreadsheet,
  GraduationCap,
  Globe,
  Heart,
  Leaf,
  LifeBuoy,
  Lightbulb,
  Mic2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import LayoutFrame from "@/components/LayoutFrame";
import { HelpFooter, HelpHeader } from "../HelpChrome";
import HelpBackLink from "../HelpBackLink";

const WHAT_YOU_MANAGE = [
  { icon: Building,        label: "Corporate retreats",      sub: "Multi-night business events with group accommodation needs",      gradient: "from-violet-600 to-purple-700",   shadow: "shadow-violet-200" },
  { icon: Users,           label: "Group travel",             sub: "Families, sports teams, school trips, community groups",          gradient: "from-indigo-500 to-blue-600",    shadow: "shadow-indigo-200" },
  { icon: Globe,           label: "Cultural & eco tours",     sub: "Tourism circuits across multiple properties or regions",          gradient: "from-teal-500 to-emerald-600",   shadow: "shadow-teal-200" },
  { icon: CalendarCheck,   label: "Conferences & summits",    sub: "Multi-day events requiring coordinated room blocks",              gradient: "from-blue-600 to-cyan-600",      shadow: "shadow-blue-200" },
  { icon: Briefcase,       label: "Government delegations",   sub: "Official travel arrangements with strict scheduling",             gradient: "from-slate-600 to-slate-800",   shadow: "shadow-slate-200" },
  { icon: FileSpreadsheet, label: "Wedding stays",            sub: "Guest accommodation coordination for wedding weekends",           gradient: "from-pink-500 to-rose-600",      shadow: "shadow-pink-200" },
  { icon: Heart,           label: "Honeymoon arrangements",   sub: "Romantic getaway packages for newlyweds suites, surprises & special requests handled", gradient: "from-rose-500 to-pink-600",     shadow: "shadow-rose-200" },
  { icon: Sparkles,        label: "Anniversary getaways",     sub: "Milestone celebration stays with tailored upgrades and curated property selection",     gradient: "from-amber-500 to-orange-500",  shadow: "shadow-amber-200" },
  { icon: GraduationCap,   label: "University & alumni trips",sub: "Academic group travel, graduation celebrations, and reunion stays across multiple venues", gradient: "from-purple-600 to-fuchsia-600", shadow: "shadow-purple-200" },
];


export default function HelpEventManagerPage() {
  return (
    <>
      <HelpHeader />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        <div className="public-container py-8 sm:py-12">
          <HelpBackLink />

          {/* ── Hero ─────────────────────────────────────────────── */}
          <div className="mt-4 relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d0418] via-[#150c2e] to-[#1a1040] text-white p-8 sm:p-10">
            <div className="pointer-events-none absolute inset-0 opacity-[0.035]"
              style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
            <div className="pointer-events-none absolute top-0 right-0 w-80 h-80 rounded-full blur-3xl opacity-20"
              style={{ background: "radial-gradient(circle, #a78bfa 0%, transparent 70%)" }} />
            <div className="pointer-events-none absolute bottom-0 left-0 w-64 h-64 rounded-full blur-3xl opacity-10"
              style={{ background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)" }} />

            <div className="relative z-10 grid sm:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#a78bfa] mb-4">
                  <Briefcase className="h-3 w-3" /> Event Manager
                </div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight">
                  Manage group stays &amp;<br />earn as an Event Manager.
                </h1>
                <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                  Coordinate accommodation for corporate retreats, tours, group travel, and large events and earn a management fee on every event you successfully organise through NoLSAF.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/careers?role=event-manager"
                    className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#a78bfa] text-[#0d0418] px-5 py-2.5 text-sm font-bold hover:brightness-110 hover:gap-3 transition-all duration-200 shadow-lg shadow-[#a78bfa]/20">
                    Become an Event Manager <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Management fee",      sub: "Earn a fee per event, not per room" },
                  { label: "Group bookings",      sub: "Coordinate multiple rooms at once" },
                  { label: "Verified events",     sub: "Official badge on every managed event" },
                  { label: "Dedicated dashboard", sub: "All events in one place" },
                ].map(({ label, sub }) => (
                  <div key={label} className="rounded-xl bg-white/8 border border-white/12 p-4 backdrop-blur-sm">
                    <BadgeCheck className="h-5 w-5 text-[#a78bfa] mb-2" />
                    <p className="text-xs font-bold text-white leading-snug">{label}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Types of events ───*/}
          <section className="mt-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-8 w-8 rounded-lg bg-[#a78bfa] flex items-center justify-center flex-shrink-0">
                <CalendarCheck className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Types of events you can manage</h2>
                <p className="text-sm text-gray-500">Any event requiring coordinated group accommodation qualifies.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {WHAT_YOU_MANAGE.map(({ icon: Icon, label, sub, gradient, shadow }, idx) => (
                <div key={label}
                  className={`group relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-md ${shadow} hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 cursor-default`}>

                  {/* top colour bar */}
                  <div className={`h-1 w-full bg-gradient-to-r ${gradient}`} />

                  {/* shimmer sweep on hover */}
                  <div className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent z-10" />

                  {/* watermark number */}
                  <span className="pointer-events-none select-none absolute right-3 bottom-2 text-[3.8rem] font-black leading-none opacity-[0.04] text-slate-900">
                    {String(idx + 1).padStart(2, "0")}
                  </span>

                  <div className="p-5">
                    {/* icon */}
                    <div className={`relative h-11 w-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      <Icon className="h-5 w-5 text-white drop-shadow" />
                    </div>

                    <p className="text-sm font-extrabold text-gray-900 leading-snug">{label}</p>
                    <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── What you earn ───*/}
          <section className="mt-10">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#faf7ff] via-white to-[#f3eeff] border border-violet-200 p-6 sm:p-8">
              <div className="pointer-events-none absolute inset-0 opacity-40"
                style={{ backgroundImage: "linear-gradient(#7c3aed12 1px, transparent 1px), linear-gradient(90deg, #7c3aed12 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
              <div className="relative z-10 mb-6">
                <h2 className="text-xl font-bold text-gray-900">What you earn</h2>
                <p className="text-sm text-gray-500 mt-0.5">Event Managers are paid a management fee, not a per-room commission.</p>
              </div>
              <div className="relative z-10 grid sm:grid-cols-3 gap-4">
                {[
                  { value: "Management fee",   desc: "A flat or percentage fee agreed per event, paid once all rooms are confirmed and the event is locked in." },
                  { value: "Event size bonus", desc: "Larger events (10+ rooms) attract a higher-tier management fee automatically no negotiation needed." },
                  { value: "Repeat event perk",desc: "Returning clients who re-book through you generate a loyalty bonus on subsequent events you manage for them." },
                ].map(({ value, desc }) => (
                  <div key={value} className="bg-white rounded-xl border border-violet-100 p-5 shadow-sm">
                    <p className="text-sm font-bold text-[#7c3aed]">{value}</p>
                    <p className="mt-2 text-xs text-gray-600 leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
              <div className="relative z-10 mt-5 flex items-start gap-3 bg-white/80 border border-[#a78bfa]/20 rounded-xl px-5 py-3">
                <BadgeCheck className="h-4 w-4 text-[#a78bfa] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-600">
                  All fees are calculated automatically by the platform and paid directly to your registered payout method after event check-in.
                </p>
              </div>
            </div>
          </section>

          {/* ── Community empowerment & innovation ───*/}
          <section className="mt-10">
            {/* Mission statement banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d0418] via-[#150c2e] to-[#1a1040] p-7 sm:p-10 mb-6">
              <div className="pointer-events-none absolute inset-0 opacity-[0.035]"
                style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
              <div className="pointer-events-none absolute top-0 right-0 w-72 h-72 rounded-full blur-3xl opacity-25"
                style={{ background: "radial-gradient(circle, #a78bfa 0%, transparent 70%)" }} />
              <div className="pointer-events-none absolute -bottom-8 -left-8 w-56 h-56 rounded-full blur-3xl opacity-15"
                style={{ background: "radial-gradient(circle, #4dd9ac 0%, transparent 70%)" }} />

              <div className="relative z-10 flex items-start gap-4">
                <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-[#a78bfa]/20 border border-[#a78bfa]/30 flex items-center justify-center">
                  <Lightbulb className="h-5 w-5 text-[#a78bfa]" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#a78bfa] mb-2">NoLSAF Mission</p>
                  <h2 className="text-xl sm:text-2xl font-black text-white leading-snug">
                    The platform is a treatment,<br className="hidden sm:block" /> not just a booking tool.
                  </h2>
                  <p className="mt-3 text-sm text-slate-300 leading-relaxed max-w-2xl">
                    NoLSAF exists to move people, open places, and build real connections between guests and the communities that host them.
                    As an Event Manager, you are not filling rooms you are creating moments that give people exposure, uplift local economies,
                    and leave a lasting mark on the communities involved.
                  </p>
                </div>
              </div>
            </div>

            {/* Innovation cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                {
                  icon: Mic2,
                  gradient: "from-violet-600 to-purple-700",
                  shadow: "shadow-violet-100",
                  title: "Spotlight local talent & culture",
                  body: <><em>Structure events that put local musicians, artisans, and storytellers in front of guests who would never have found them otherwise. NoLSAF gives you the platform <strong>you provide the stage.</strong></em></>,
                  tag: "Cultural exposure",
                },
                {
                  icon: TrendingUp,
                  gradient: "from-teal-500 to-emerald-600",
                  shadow: "shadow-teal-100",
                  title: "Drive income into local economies",
                  body: "Every event you manage sends guests into local restaurants, markets, transport operators, and service providers - turning a single booking into a ripple of economic activity for the whole area.",
                  tag: "Economic uplift",
                },
                {
                  icon: Globe,
                  gradient: "from-indigo-500 to-blue-600",
                  shadow: "shadow-indigo-100",
                  title: "Open emerging destinations",
                  body: "Introduce lesser-known towns, rural reserves, and off-the-beaten-path regions to national and international guests. You have the power to put a community on the map.",
                  tag: "Destination discovery",
                },
                {
                  icon: Leaf,
                  gradient: "from-green-500 to-teal-600",
                  shadow: "shadow-green-100",
                  title: "Build eco-conscious events",
                  body: "Design events with a low environmental footprint, connecting guests to eco-lodges, conservation areas, and community-run nature experiences that fund conservation efforts.",
                  tag: "Sustainability",
                },
                {
                  icon: Target,
                  gradient: "from-rose-500 to-pink-600",
                  shadow: "shadow-rose-100",
                  title: "Create recurring community moments",
                  body: "Recurring annual events - festivals, retreats, re-unions, build traditions that communities can depend on for tourism income year after year. You make that cycle possible.",
                  tag: "Long-term impact",
                },
                {
                  icon: Sparkles,
                  gradient: "from-amber-500 to-orange-500",
                  shadow: "shadow-amber-100",
                  title: "Innovate how people experience places",
                  body: "Combine accommodation with storytelling, heritage walks, cooking experiences, or community visits. NoLSAF supports event packages that go beyond beds - giving guests true immersion.",
                  tag: "Experience innovation",
                },
              ].map(({ icon: Icon, gradient, shadow, title, body, tag }) => (
                <div key={title}
                  className={`group relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-md ${shadow} hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300`}>

                  {/* top bar */}
                  <div className={`h-1 w-full bg-gradient-to-r ${gradient}`} />

                  {/* shimmer */}
                  <div className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent z-10" />

                  <div className="p-5">
                    <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      <Icon className="h-5 w-5 text-white drop-shadow" />
                    </div>
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-0.5 mb-2 bg-gradient-to-r ${gradient} bg-clip-text text-transparent border border-slate-200`}>
                      {tag}
                    </span>
                    <p className="text-sm font-extrabold text-gray-900 leading-snug">{title}</p>
                    <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom note */}
            <div className="mt-5 flex items-start gap-3 bg-gradient-to-r from-[#faf7ff] to-white border border-violet-200 rounded-2xl px-5 py-4">
              <BadgeCheck className="h-5 w-5 text-[#a78bfa] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-600 leading-relaxed">
                <strong className="text-gray-900">Your role as an Event Manager reaches beyond logistics.</strong>{" "}
                NoLSAF actively highlights events that create community value meaning your managed events gain more visibility on the platform,
                attracting more guests, and growing your reputation as someone who delivers real experiences, not just rooms.
              </p>
            </div>
          </section>

          {/* ── CTA ──*/}
          <div className="group mt-8 relative overflow-hidden bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-[#a78bfa]/30 hover:-translate-y-1 transition-all duration-300 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#a78bfa18_0%,_transparent_65%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative z-10 flex items-start gap-4">
              <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-[#a78bfa]/10 flex items-center justify-center">
                <LifeBuoy className="h-5 w-5 text-[#a78bfa]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Ready to manage events on NoLSAF?</h3>
                <p className="mt-1 text-sm text-gray-500 max-w-md">
                  Apply to become a verified Event Manager and start earning on group stays.
                </p>
              </div>
            </div>
            <div className="relative z-10 flex flex-wrap gap-3 flex-shrink-0">
              <Link href="/help/payouts"
                className="no-underline inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-gray-700 px-5 py-2.5 text-sm font-semibold hover:border-[#a78bfa]/40 hover:text-[#a78bfa] hover:gap-3 transition-all duration-200 shadow-sm">
                All opportunities <ChevronRight className="h-4 w-4" />
              </Link>
              <Link href="/careers?role=event-manager"
                className="no-underline inline-flex items-center gap-2 rounded-xl bg-[#a78bfa] text-white px-5 py-2.5 text-sm font-bold hover:brightness-110 hover:gap-3 transition-all duration-200 shadow-md">
                Apply now <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

        </div>
      </div>
      <HelpFooter />
    </>
  );
}
