import type { Metadata } from 'next';
import Link from 'next/link';
import { Moon, Heart, Music, Users, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'N-SaT | NoLSAF Service as Therapy',
  description: 'N-SaT: two programmes to restore natural sleep and renew natural love through curated environments, mentorship, and peace.',
};

/* ── What each programme restores ── */
const sleepItems = [
  { cause: 'Anxiety & stress',     fix: 'Calm environment' },
  { cause: 'Screen dependency',    fix: 'Structured rest rhythm' },
  { cause: 'No rest boundary',     fix: 'Mentor-guided schedule' },
  { cause: 'Unresolved emotions',  fix: 'Follow-up guidance' },
];
const loveItems = [
  { cause: 'Noise & pressure',     fix: 'Curated peaceful space' },
  { cause: 'No shared stillness',  fix: 'Slow live music evenings' },
  { cause: 'Lost conversation',    fix: 'Presence-first pace' },
  { cause: 'Disconnection',        fix: 'Mentored togetherness' },
];

/* ── Steps ── */
const steps = [
  { n: '01', label: 'Choose', desc: 'Pick Sleep Sanctuary or Love Restoration' },
  { n: '02', label: 'Match',  desc: 'Paired with a verified property and mentor' },
  { n: '03', label: 'Arrive', desc: 'The environment and guide do the rest' },
];

export default function NSaTPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div
          className="relative overflow-hidden rounded-[2.5rem] text-white"
          style={{ background: 'linear-gradient(150deg, #071c19 0%, #0b2e29 30%, #082820 58%, #071612 85%, #050e0c 100%)' }}
        >
          {/* ambient glows */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 -translate-x-1/2 h-72 w-[600px] rounded-full"
              style={{ background: 'radial-gradient(ellipse, rgba(2,102,94,0.30) 0%, transparent 70%)' }} />
            <div className="absolute bottom-0 left-0 h-48 w-64 rounded-full"
              style={{ background: 'radial-gradient(ellipse, rgba(185,128,45,0.10) 0%, transparent 70%)' }} />
            <div className="absolute bottom-0 right-0 h-48 w-80 rounded-full"
              style={{ background: 'radial-gradient(ellipse, rgba(5,173,162,0.12) 0%, transparent 70%)' }} />
          </div>

          {/* ── HERO — compact ── */}
          <div className="relative px-6 pt-14 pb-8 sm:px-12 sm:pt-20 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1 text-xs font-semibold text-emerald-400">
              NoLSAF Initiative
            </div>
            <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">N‑SaT</h1>
            <p className="mt-2 text-base font-semibold text-emerald-400 tracking-wide">
              NoLSAF · Service as · Therapy
            </p>
            <p className="mt-4 mx-auto max-w-xl text-sm leading-6 text-white/65">
              Two programmes built to restore what modern life breaks - your natural ability to sleep, and your natural capacity to love.
            </p>
          </div>

          {/* ── RESTORATION DIAGRAM — SVG visual ── */}
          <div className="relative px-6 pb-4 sm:px-12 flex justify-center">
            <svg viewBox="0 0 480 90" className="w-full max-w-lg" aria-hidden>
              {/* centre node */}
              <circle cx="240" cy="45" r="28" fill="#02665e" />
              <text x="240" y="50" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">N‑SaT</text>
              {/* left branch — sleep */}
              <line x1="212" y1="45" x2="90" y2="45" stroke="rgba(14,165,233,0.45)" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx="72" cy="45" r="20" fill="rgba(8,32,60,0.8)" stroke="rgba(14,165,233,0.5)" strokeWidth="1" />
              <text x="72" y="41" textAnchor="middle" fill="#7dd3fc" fontSize="7" fontWeight="600">Sleep</text>
              <text x="72" y="51" textAnchor="middle" fill="#7dd3fc" fontSize="7" fontWeight="600">Sanctuary</text>
              {/* right branch — love */}
              <line x1="268" y1="45" x2="390" y2="45" stroke="rgba(217,119,6,0.45)" strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx="408" cy="45" r="20" fill="rgba(40,10,8,0.8)" stroke="rgba(217,119,6,0.5)" strokeWidth="1" />
              <text x="408" y="41" textAnchor="middle" fill="#fcd34d" fontSize="7" fontWeight="600">Love</text>
              <text x="408" y="51" textAnchor="middle" fill="#fcd34d" fontSize="7" fontWeight="600">Restoration</text>
              {/* connector dots */}
              <circle cx="90" cy="45" r="3" fill="rgba(14,165,233,0.6)" />
              <circle cx="212" cy="45" r="3" fill="rgba(14,165,233,0.6)" />
              <circle cx="268" cy="45" r="3" fill="rgba(217,119,6,0.6)" />
              <circle cx="390" cy="45" r="3" fill="rgba(217,119,6,0.6)" />
            </svg>
          </div>

          <div className="mx-6 sm:mx-12 h-px bg-white/10" />

          {/* ── TWO PROGRAMME CARDS ── */}
          <div className="relative px-6 py-8 sm:px-12 grid grid-cols-1 gap-5 md:grid-cols-2">

            {/* ── SLEEP SANCTUARY ── */}
            <div className="relative overflow-hidden rounded-3xl p-[1px]"
              style={{ background: 'linear-gradient(135deg, rgba(14,165,233,0.6) 0%, rgba(14,90,180,0.5) 100%)' }}>
              <div className="relative overflow-hidden rounded-3xl h-full"
                style={{ background: 'linear-gradient(150deg, #040e22 0%, #062033 55%, #041a2e 100%)' }}>
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 h-36 w-64 rounded-full"
                    style={{ background: 'radial-gradient(ellipse, rgba(14,165,233,0.18) 0%, transparent 70%)' }} />
                </div>
                <div className="relative p-6">
                  {/* header row */}
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center border border-sky-400/30"
                      style={{ background: 'rgba(14,165,233,0.15)' }}>
                      <Moon className="h-5 w-5 text-sky-300" aria-hidden />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400/80">Programme 01</div>
                      <div className="text-base font-bold text-white leading-tight">Sleep Sanctuary</div>
                    </div>
                  </div>

                  {/* restoration table */}
                  <div className="rounded-xl overflow-hidden border border-white/8 mb-5">
                    <div className="grid grid-cols-2 text-[10px] font-semibold uppercase tracking-wider border-b border-white/8">
                      <div className="px-3 py-2 text-red-400/80">What broke it</div>
                      <div className="px-3 py-2 text-sky-400/80 border-l border-white/8">N-SaT restores</div>
                    </div>
                    {sleepItems.map((r) => (
                      <div key={r.cause} className="grid grid-cols-2 border-b border-white/6 last:border-0"
                        style={{ background: 'rgba(4,14,34,0.5)' }}>
                        <div className="px-3 py-2.5 text-xs text-white/55 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400/60 flex-shrink-0" />
                          {r.cause}
                        </div>
                        <div className="px-3 py-2.5 text-xs text-sky-300/80 border-l border-white/6 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400/60 flex-shrink-0" />
                          {r.fix}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* supporting note */}
                  <p className="text-xs text-white/50 leading-5 mb-5">
                    A verified calm environment + a certified mentor who guides your sleep recovery - no rush, at your pace.
                  </p>

                  {/* CTA */}
                  <Link href="/public/n-sat/plans?p=sleep"
                    className="no-underline hover:no-underline w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white transition hover:-translate-y-[1px] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                    style={{ background: 'linear-gradient(90deg, #0369a1, #1d4ed8)' }}>
                    Register Interest | Sleep Sanctuary
                  </Link>
                </div>
              </div>
            </div>

            {/* ── LOVE RESTORATION ── */}
            <div className="relative overflow-hidden rounded-3xl p-[1px]"
              style={{ background: 'linear-gradient(135deg, rgba(217,119,6,0.6) 0%, rgba(190,18,60,0.45) 100%)' }}>
              <div className="relative overflow-hidden rounded-3xl h-full"
                style={{ background: 'linear-gradient(150deg, #1c0a04 0%, #2a0e10 55%, #1a0a08 100%)' }}>
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 h-36 w-64 rounded-full"
                    style={{ background: 'radial-gradient(ellipse, rgba(217,119,6,0.18) 0%, transparent 70%)' }} />
                </div>
                <div className="relative p-6">
                  {/* header row */}
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center border border-amber-400/30"
                      style={{ background: 'rgba(217,119,6,0.15)' }}>
                      <Heart className="h-5 w-5 text-amber-300" aria-hidden />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">Programme 02</div>
                      <div className="text-base font-bold text-white leading-tight">Love Restoration</div>
                    </div>
                  </div>

                  {/* restoration table */}
                  <div className="rounded-xl overflow-hidden border border-white/8 mb-5">
                    <div className="grid grid-cols-2 text-[10px] font-semibold uppercase tracking-wider border-b border-white/8">
                      <div className="px-3 py-2 text-red-400/80">What broke it</div>
                      <div className="px-3 py-2 text-amber-400/80 border-l border-white/8">N-SaT restores</div>
                    </div>
                    {loveItems.map((r) => (
                      <div key={r.cause} className="grid grid-cols-2 border-b border-white/6 last:border-0"
                        style={{ background: 'rgba(28,10,4,0.5)' }}>
                        <div className="px-3 py-2.5 text-xs text-white/55 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400/60 flex-shrink-0" />
                          {r.cause}
                        </div>
                        <div className="px-3 py-2.5 text-xs text-amber-300/80 border-l border-white/6 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400/60 flex-shrink-0" />
                          {r.fix}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* supporting note */}
                  <p className="text-xs text-white/50 leading-5 mb-5">
                    Like King David who called for music every evening - peace of mind is not found, it is created. We create it for you.
                  </p>

                  {/* CTA */}
                  <Link href="/public/n-sat/plans?p=love"
                    className="no-underline hover:no-underline w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white transition hover:-translate-y-[1px] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    style={{ background: 'linear-gradient(90deg, #b45309, #9f1239)' }}>
                    Register Interest | Love Restoration
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-6 sm:mx-12 h-px bg-white/10" />

          {/* ── HOW IT WORKS — compact 3-step ── */}
          <div className="relative px-6 py-8 sm:px-12">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-white/40 mb-6">How it works</p>
            <div className="grid grid-cols-3 gap-3">
              {steps.map((s, i) => (
                <div key={s.n} className="relative text-center rounded-2xl border border-white/10 p-4"
                  style={{ background: 'rgba(5,20,15,0.5)' }}>
                  {i < 2 && (
                    <div className="hidden sm:block absolute top-1/2 -right-1.5 -translate-y-1/2 z-10">
                      <div className="h-3 w-3 text-white/20">›</div>
                    </div>
                  )}
                  <div className="text-2xl font-black mb-1" style={{ color: 'rgba(5,173,162,0.5)' }}>{s.n}</div>
                  <div className="text-sm font-bold text-white">{s.label}</div>
                  <div className="mt-1 text-xs text-white/50 leading-4">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mx-6 sm:mx-12 h-px bg-white/10" />

          {/* ── WHAT COMES WITH EVERY STAY ── */}
          <div className="relative px-6 py-8 sm:px-12">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-white/40 mb-6">Every N‑SaT stay includes</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: <ShieldCheck className="h-5 w-5 text-emerald-400" />, label: 'Verified property' },
                { icon: <Users className="h-5 w-5 text-sky-400" />,          label: 'Certified mentor' },
                { icon: <Music className="h-5 w-5 text-amber-400" />,        label: 'Curated environment' },
                { icon: <Heart className="h-5 w-5 text-rose-400" />,         label: 'Follow-up support' },
              ].map((f) => (
                <div key={f.label} className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 p-4 text-center"
                  style={{ background: 'rgba(5,20,15,0.5)' }}>
                  {f.icon}
                  <span className="text-xs font-medium text-white/70">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mx-6 sm:mx-12 h-px bg-white/10" />

          {/* ── BOTTOM CTA ── */}
          <div className="relative px-6 py-10 sm:px-12 text-center">
            <p className="text-white/60 text-sm mb-5">
              Not sure which programme fits you? Let us help you decide.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <span
                className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold cursor-not-allowed"
                style={{ background: 'rgba(2,102,94,0.25)', border: '1px solid rgba(52,211,153,0.2)', color: 'rgba(255,255,255,0.35)' }}>
                N‑SaT stays
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.15)', color: 'rgba(52,211,153,0.6)' }}>Coming soon</span>
              </span>
              <Link href="/public/n-sat"
                className="no-underline hover:no-underline inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-6 py-2.5 text-sm font-semibold text-white/85 backdrop-blur transition hover:-translate-y-[1px] hover:bg-white/14 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25">
                View N-SaT options
              </Link>
            </div>
          </div>

          <div className="mx-6 sm:mx-12 h-px bg-white/10" />

          {/* ══════════════════════════════════════════
              N-SaT SANCTUARY CENTRES — geographic art
              ══════════════════════════════════════════ */}
          <div className="relative px-6 py-12 sm:px-12 overflow-hidden">

            {/* topographic background lines */}
            <svg aria-hidden className="pointer-events-none absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" style={{ opacity: 0.04 }}>
              {[40,80,120,160,200,240,280,320].map((r) => (
                <ellipse key={r} cx="50%" cy="52%" rx={r} ry={r * 0.55} fill="none" stroke="#05ada2" strokeWidth="1" />
              ))}
            </svg>

            {/* section header */}
            <div className="relative text-center mb-10">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/50">
                Where we operate
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">N‑SaT Sanctuary Centres</h2>
              <p className="mt-2 text-xs text-white/45 max-w-md mx-auto leading-5">
                Dedicated centres anchored in key regions across Tanzania - each a verified environment built for therapeutic restoration.
              </p>
            </div>

            {/* ── GEOGRAPHIC ZONE GRID ── */}
            {/* Row 1 — North zone (right-leaning, like Tanga/Kili on the map) */}
            <div className="relative max-w-2xl mx-auto space-y-3">

              {/* North */}
              <div className="flex justify-end pr-0 sm:pr-8">
                <div className="relative overflow-hidden rounded-2xl border p-[1px] w-full sm:w-72"
                  style={{ borderColor: 'rgba(125,211,252,0.3)', background: 'linear-gradient(135deg, rgba(14,165,233,0.3) 0%, rgba(6,182,212,0.2) 100%)' }}>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(4,14,34,0.75)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-sky-400/70 mb-0.5">Northern Zone</div>
                        <div className="text-sm font-bold text-white">Tanga &amp; Kilimanjaro</div>
                        <div className="text-xs text-white/45 mt-0.5">Mountain &amp; coastal highland sanctuaries</div>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <div className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_2px_rgba(14,165,233,0.5)]" />
                        <div className="text-[9px] text-sky-400/60 font-semibold">2 centres</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* East + Lake — side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Lake Zone — left */}
                <div className="relative overflow-hidden rounded-2xl border p-[1px]"
                  style={{ borderColor: 'rgba(34,211,238,0.3)', background: 'linear-gradient(135deg, rgba(6,182,212,0.3) 0%, rgba(5,150,105,0.2) 100%)' }}>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(2,16,22,0.8)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-400/70 mb-0.5">Lake Zone</div>
                        <div className="text-sm font-bold text-white">Mwanza &amp; Kagera</div>
                        <div className="text-xs text-white/45 mt-0.5">Lakeside stillness sanctuaries</div>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <div className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_2px_rgba(6,182,212,0.5)]" />
                        <div className="text-[9px] text-cyan-400/60 font-semibold">2 centres</div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* East — right */}
                <div className="relative overflow-hidden rounded-2xl border p-[1px]"
                  style={{ borderColor: 'rgba(52,211,153,0.35)', background: 'linear-gradient(135deg, rgba(2,102,94,0.45) 0%, rgba(5,173,162,0.3) 100%)' }}>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(2,16,14,0.8)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70 mb-0.5">Eastern Zone</div>
                        <div className="text-sm font-bold text-white">Dar es Salaam &amp; Pwani</div>
                        <div className="text-xs text-white/45 mt-0.5">Coastal tranquility sanctuaries</div>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]" />
                        <div className="text-[9px] text-emerald-400/60 font-semibold">2 centres</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Central — centred */}
              <div className="flex justify-center">
                <div className="relative overflow-hidden rounded-2xl border p-[1px] w-full sm:w-64"
                  style={{ borderColor: 'rgba(251,191,36,0.3)', background: 'linear-gradient(135deg, rgba(217,119,6,0.30) 0%, rgba(180,83,9,0.22) 100%)' }}>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(20,10,2,0.82)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-amber-400/70 mb-0.5">Central Zone</div>
                        <div className="text-sm font-bold text-white">Dodoma</div>
                        <div className="text-xs text-white/45 mt-0.5">Heartland sanctuary</div>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <div className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]" />
                        <div className="text-[9px] text-amber-400/60 font-semibold">1 centre</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* South — left-leaning like Mbeya on the map */}
              <div className="flex justify-start pl-0 sm:pl-8">
                <div className="relative overflow-hidden rounded-2xl border p-[1px] w-full sm:w-72"
                  style={{ borderColor: 'rgba(192,132,252,0.3)', background: 'linear-gradient(135deg, rgba(124,58,237,0.28) 0%, rgba(190,18,60,0.22) 100%)' }}>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(10,4,22,0.82)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-violet-400/70 mb-0.5">Southern Zone</div>
                        <div className="text-sm font-bold text-white">Mbeya</div>
                        <div className="text-xs text-white/45 mt-0.5">Southern highlands sanctuary</div>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <div className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_6px_2px_rgba(192,132,252,0.5)]" />
                        <div className="text-[9px] text-violet-400/60 font-semibold">1 centre</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>{/* end zone grid */}

            {/* total count + note */}
            <div className="relative mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
              <div className="flex items-center gap-6">
                {[
                  { count: '5', label: 'Zones' },
                  { count: '8', label: 'Cities' },
                  { count: '2', label: 'Programmes' },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="text-2xl font-extrabold text-white">{stat.count}</div>
                    <div className="text-[10px] uppercase tracking-widest text-white/40">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block h-8 w-px bg-white/10" />
              <p className="text-xs text-white/40 max-w-xs leading-5">
                Centres are being established in phases. Register your interest and be first when your region opens.
              </p>
            </div>

            {/* register interest CTA */}
            <div className="relative mt-6 flex justify-center">
              <Link href="/public/n-sat"
                className="no-underline hover:no-underline inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/6 px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-white/70 backdrop-blur transition hover:-translate-y-[1px] hover:bg-white/12 hover:text-white active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20">
                Register your region interest
              </Link>
            </div>

          </div>{/* end sanctuaries section */}

        </div>
      </div>
    </main>
  );
}
