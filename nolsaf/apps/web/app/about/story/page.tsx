import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import TypingStory from "./TypingStory";
import FounderPhotoRotator from "./FounderPhotoRotator";

export const metadata: Metadata = {
  title: "Our story and founders",
  description:
    "The story behind NoLSAF and its founders, Daniel M. Ngeleja (Founder and CEO) and Rashidi Sued Rashidi (Co-Founder): building one connected travel experience where stays, transport, payments and planning work together.",
  alternates: { canonical: "https://nolsaf.com/about/story" },
};

export default function AboutStoryPage() {
  const storyText =
    "NoLSAF began with a simple truth. A stay can change how a person feels. When travel is stressful confusing listings, uncertain transport, unclear costs, and complicated payments people arrive tired before the trip even starts.\n\nWe decided to build a platform that treats accommodation as part of the treatment: a calmer, clearer, more reliable path to rest. And we built it with the belief that booking is incomplete if transport and planning are separated from the stay.";

  return (
    <article className="max-w-none space-y-10">
      <div className="not-prose -mx-5 sm:-mx-8">
        <div className="flex flex-col lg:flex-row items-stretch gap-6">
          <section className="relative min-w-0 lg:flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-card p-6">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
              <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-brand-300/10 blur-3xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent" />
            </div>

            <div className="relative">
              <div className="prose prose-slate max-w-none">
                <h2>Our Best Story</h2>
              </div>

              <div className="mt-4 rounded-2xl border border-brand-500/20 bg-white/70 backdrop-blur-sm px-4 py-3 shadow-sm">
                <p className="m-0 text-[15px] leading-relaxed text-slate-800">
                  <span className="font-bold tracking-tight text-[#02665e]">A stay can change how a person feels.</span>
                </p>
              </div>

              <TypingStory
                text={storyText}
                className="mt-4"
                pauseAfterTypedMs={60000}
                deleteMode="word"
                emphasis={{
                  phrase: "a calmer, clearer, more reliable path to rest.",
                  italicClassName: "italic",
                  wordClassNames: {
                    calmer: "text-[#02665e] font-semibold",
                    clearer: "text-yellow-600 font-semibold",
                    reliable: "text-info-600 font-semibold",
                  },
                }}
              />
            </div>
          </section>

          <section className="relative min-w-0 lg:flex-1 overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950/70 to-slate-900 text-slate-100 shadow-card p-6 ring-1 ring-white/10">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {/* clean dark gradients (no dots) */}
              <div className="absolute -top-28 -right-28 h-72 w-72 rounded-full bg-info-500/18 blur-3xl" />
              <div className="absolute -bottom-28 -left-28 h-72 w-72 rounded-full bg-brand-500/16 blur-3xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent" />

              {/* Circular HUD + circuit traces (kept to far-right; no dots over text) */}
              <svg
                className="absolute right-[-96px] top-[-18px] h-[260px] w-[360px] opacity-45 sm:right-[-54px] sm:top-[-26px] sm:h-[340px] sm:w-[460px] sm:opacity-100"
                viewBox="0 0 460 340"
                fill="none"
              >
                <defs>
                  <radialGradient id="hudRadial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(330 170) rotate(90) scale(140)">
                    <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
                    <stop offset="0.42" stopColor="currentColor" stopOpacity="0.10" />
                    <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                  </radialGradient>
                  <filter id="hudGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="2.8" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <mask id="hudMaskRight">
                    <rect width="460" height="340" fill="black" />
                    <rect x="170" y="0" width="290" height="340" fill="white" />
                  </mask>
                </defs>

                <g mask="url(#hudMaskRight)" className="text-info-300" filter="url(#hudGlow)">
                  {/* faint fill behind the HUD */}
                  <circle cx="330" cy="170" r="140" fill="url(#hudRadial)" />

                  {/* circuit traces */}
                  <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M210 76H268" opacity="0.18" strokeWidth="2" />
                    <path d="M242 76V112H286" opacity="0.18" strokeWidth="2" />
                    <path d="M212 250H274" opacity="0.14" strokeWidth="2" />
                    <path d="M246 250V218H286" opacity="0.14" strokeWidth="2" />
                    <path d="M400 110H438" opacity="0.12" strokeWidth="2" />
                    <path d="M412 110V148H448" opacity="0.12" strokeWidth="2" />
                    <path d="M396 226H444" opacity="0.10" strokeWidth="2" />
                    <path d="M420 226V200H448" opacity="0.10" strokeWidth="2" />
                    <circle cx="242" cy="76" r="3" fill="currentColor" opacity="0.16" />
                    <circle cx="246" cy="250" r="3" fill="currentColor" opacity="0.14" />
                    <circle cx="412" cy="110" r="3" fill="currentColor" opacity="0.12" />
                    <circle cx="420" cy="226" r="3" fill="currentColor" opacity="0.10" />
                  </g>

                  {/* circular HUD rings */}
                  <g stroke="currentColor" fill="none" strokeLinecap="round">
                    <circle cx="330" cy="170" r="108" opacity="0.30" strokeWidth="2" />
                    <circle cx="330" cy="170" r="90" opacity="0.20" strokeWidth="2" strokeDasharray="6 10" />
                    <circle cx="330" cy="170" r="72" opacity="0.26" strokeWidth="2" strokeDasharray="2 8" />
                    <circle cx="330" cy="170" r="50" opacity="0.18" strokeWidth="2" />
                    <circle cx="330" cy="170" r="26" opacity="0.20" strokeWidth="2" strokeDasharray="3 6" />
                  </g>

                  {/* radial ticks */}
                  <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.22">
                    <path d="M330 54V74" />
                    <path d="M330 266V286" />
                    <path d="M214 170H234" />
                    <path d="M426 170H446" />
                    <path d="M255 95l14 14" />
                    <path d="M405 245l14 14" />
                    <path d="M405 95l14 -14" />
                    <path d="M255 245l14 -14" />
                  </g>

                  {/* segmented outer arc blocks */}
                  <g fill="currentColor" opacity="0.16">
                    <path d="M330 48a122 122 0 0 1 70 22l-10 14a104 104 0 0 0-60-18Z" />
                    <path d="M442 170a122 122 0 0 1-22 70l-14-10a104 104 0 0 0 18-60Z" />
                    <path d="M330 292a122 122 0 0 1-70-22l10-14a104 104 0 0 0 60 18Z" />
                    <path d="M218 170a122 122 0 0 1 22-70l14 10a104 104 0 0 0-18 60Z" />
                  </g>

                  {/* core */}
                  <circle cx="330" cy="170" r="10" fill="currentColor" opacity="0.22" />
                  <circle cx="330" cy="170" r="18" stroke="currentColor" opacity="0.22" strokeWidth="2" />
                </g>
              </svg>

              {/* soft vignette to keep content crisp */}
              <div className="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-transparent" />
            </div>

            <div className="relative z-10 sm:pr-44">
              {/* connectors (sm+): tie each paragraph into the HUD */}
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full translate-x-24 opacity-35 sm:translate-x-0 sm:opacity-100"
                viewBox="0 0 600 360"
                fill="none"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="conn" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="currentColor" stopOpacity="0.0" />
                    <stop offset="0.22" stopColor="currentColor" stopOpacity="0.28" />
                    <stop offset="1" stopColor="currentColor" stopOpacity="0.18" />
                  </linearGradient>
                </defs>

                <g className="text-info-300/60">
                  <path d="M52 118 H280 C312 118 326 118 344 140 L420 220" stroke="url(#conn)" strokeWidth="2" />
                  <path d="M52 172 H292 C320 172 334 172 350 156 L420 140" stroke="url(#conn)" strokeWidth="2" />
                  <path d="M52 226 H286 C316 226 330 226 348 208 L420 182" stroke="url(#conn)" strokeWidth="2" />
                  <path d="M52 280 H260 C298 280 316 280 338 254 L420 260" stroke="url(#conn)" strokeWidth="2" />

                  <circle cx="52" cy="118" r="4" fill="currentColor" opacity="0.24" />
                  <circle cx="52" cy="172" r="4" fill="currentColor" opacity="0.20" />
                  <circle cx="52" cy="226" r="4" fill="currentColor" opacity="0.18" />
                  <circle cx="52" cy="280" r="4" fill="currentColor" opacity="0.16" />

                  <circle cx="420" cy="220" r="3" fill="currentColor" opacity="0.18" />
                  <circle cx="420" cy="140" r="3" fill="currentColor" opacity="0.16" />
                  <circle cx="420" cy="182" r="3" fill="currentColor" opacity="0.14" />
                  <circle cx="420" cy="260" r="3" fill="currentColor" opacity="0.12" />
                </g>
              </svg>

              <h3 className="text-lg font-semibold tracking-tight text-white">What we’re building</h3>

              <div className="mt-6 space-y-8 text-[15px] leading-relaxed text-slate-200">
                <p className="m-0">
                  A place where guests can book stays that match their budget <em className="text-slate-100">and</em> expectations — with less
                  time filtering.
                </p>
                <p className="m-0">A connected journey where accommodation, transport, and planning can happen in one platform.</p>
                <p className="m-0">A payment experience that works for different regions: local and international options.</p>
                <p className="m-0">A budget-friendly ecosystem: group stays that allow offers and owners to claim what fits.</p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="not-prose -mx-5 sm:-mx-8">
        <section className="relative overflow-hidden rounded-lg border border-white/10 bg-[#02665e] shadow-card p-6 ring-1 ring-white/10">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-white/14 via-transparent to-black/12" />
            <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-black/10 blur-3xl" />

            {/* Data visualization backdrop */}
            <svg className="absolute inset-0 h-full w-full opacity-75" viewBox="0 0 920 220" fill="none" preserveAspectRatio="none">
              <defs>
                <linearGradient id="wgFade" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="white" stopOpacity="0.0" />
                  <stop offset="0.55" stopColor="white" stopOpacity="0.30" />
                  <stop offset="1" stopColor="white" stopOpacity="0.14" />
                </linearGradient>
                <pattern id="wgGrid" width="44" height="44" patternUnits="userSpaceOnUse">
                  <path d="M44 0H0V44" stroke="white" strokeOpacity="0.16" strokeWidth="1" />
                  <path d="M22 0V44" stroke="white" strokeOpacity="0.10" strokeWidth="1" />
                  <path d="M0 22H44" stroke="white" strokeOpacity="0.10" strokeWidth="1" />
                </pattern>
                <mask id="wgMaskRight">
                  <rect width="920" height="220" fill="black" />
                  <rect x="360" y="0" width="560" height="220" fill="white" />
                </mask>
              </defs>

              <g mask="url(#wgMaskRight)">
                <rect x="0" y="0" width="920" height="220" fill="url(#wgGrid)" />

                {/* bars */}
                <g fill="white" opacity="0.18">
                  <rect x="550" y="132" width="18" height="58" rx="4" />
                  <rect x="576" y="118" width="18" height="72" rx="4" />
                  <rect x="602" y="98" width="18" height="92" rx="4" />
                  <rect x="628" y="112" width="18" height="78" rx="4" />
                  <rect x="654" y="84" width="18" height="106" rx="4" />
                  <rect x="680" y="124" width="18" height="66" rx="4" />
                </g>

                {/* line chart */}
                <path
                  d="M432 156 C468 120 508 168 540 132 C572 96 606 140 640 110 C674 80 710 136 748 98 C786 60 834 124 880 84"
                  stroke="url(#wgFade)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <g fill="white" opacity="0.26">
                  <circle cx="432" cy="156" r="3.5" />
                  <circle cx="540" cy="132" r="3.5" />
                  <circle cx="640" cy="110" r="3.5" />
                  <circle cx="748" cy="98" r="3.5" />
                  <circle cx="880" cy="84" r="3.5" />
                </g>
              </g>
            </svg>

            {/* vignette to protect text */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#02665e] via-[#02665e]/85 to-transparent" />
          </div>

          <div className="relative">
            <div className="prose prose-invert max-w-3xl">
              <h3>Where we’re going</h3>
              <p>
                We’re building NoLSAF into a future-ready travel platform where accommodation, transportation booking, and tourism planning
                work together in one connected journey. The focus is a premium standard you can trust accurate listings, predictable
                movement, clearer costs, and better guidance from discovery to arrival. The goal stays simple and ambitious:
                <strong>
                  <em> Quality Stay For Every Wallet</em>
                </strong>
                .
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="not-prose -mx-5 sm:-mx-8">
        <section className="relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card p-6">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
            <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand-500/8 blur-3xl" />
            <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-brand-300/8 blur-3xl" />
          </div>

          <div className="relative">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">NoLSAF Team</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              NoLSAF Team is the group behind a simple mission: make travel feel connected, calm, and reliable from finding the right
              stay, to booking transportation, to planning what to do next. We’re motivated by the belief that rest and movement should be
              easier to access, and that great experiences should be possible for every budget. We call it the NoLSAF Team because it’s not
              just a product it’s the people building trust, clarity, and care into every part of the journey.
            </p>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="relative h-24 w-24 flex-none overflow-hidden rounded-full border border-slate-200 bg-white ring-1 ring-brand-500/10">
                  <FounderPhotoRotator
                    sources={["/assets/NoLS%20Founder.jpeg", "/assets/NoLS%20Founder%20two.jpeg"]}
                    intervalMs={30000}
                    alt="Daniel M. Ngeleja, Founder and CEO of NoLSAF"
                    sizes="96px"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#02665e]">CEO &amp; Founder</div>
                  <Link
                    href="/founders/daniel-ngeleja"
                    className="mt-1 inline-flex text-base font-semibold text-slate-900 no-underline transition-colors hover:text-[#02665e]"
                  >
                    Daniel M. Ngeleja
                  </Link>

                  <div className="mt-3 grid gap-4 lg:grid-cols-3 lg:items-start">
                    <div className="lg:col-span-2">
                      <p className="text-sm leading-relaxed text-slate-700">
                        Daniel M. Ngeleja is a mission-driven founder and developer with a <strong>security-first</strong> mindset, shaped by
                        professional growth in <strong>cybersecurity analysis</strong> and strengthened through the <strong>Microsoft community</strong>.
                        He brings hands-on experience from <strong>telecom digitalization</strong> across East Africa, including participation in the
                        inauguration of a <strong>5G</strong> network led by Vodacom Tanzania.
                        <br />
                        <br />
                        At NoLSAF, he leads the engineering direction with <strong>innovative</strong>, goal-driven execution building <strong>scalable</strong>,
                        reliable systems and a clear user experience. He’s also driven by <strong>Artificial Intelligence</strong> to make planning smarter
                        and more personal, while keeping the journey predictable and human. He believes in “creating
                        <strong>something bigger than myself</strong>” (My Storyline) and treats learning as endless: staying curious, building, and
                        improving.
                      </p>
                    </div>

                    <aside className="lg:col-span-1">
                      <div className="relative overflow-hidden rounded-lg border border-[#02665e]/20 bg-white px-4 py-3 shadow-card ring-1 ring-[#02665e]/10">
                        <div aria-hidden className="pointer-events-none absolute inset-0">
                          <div className="absolute inset-0 bg-gradient-to-br from-white via-[#02665e]/5 to-white" />
                          <svg className="absolute inset-0 h-full w-full text-[#02665e]/10" viewBox="0 0 600 220" fill="none">
                            <path d="M0 44H600M0 88H600M0 132H600M0 176H600" stroke="currentColor" strokeWidth="1" />
                            <path d="M120 0V220M240 0V220M360 0V220M480 0V220" stroke="currentColor" strokeWidth="1" />
                          </svg>
                          <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-[#02665e]/10 blur-3xl" />
                          <div className="absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-[#02665e]/8 blur-3xl" />
                        </div>

                        <div className="relative">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-[#02665e]">Daniel’s statement</div>
                            <svg aria-hidden className="h-6 w-6 flex-none text-[#02665e]/35" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M10.2 11.2c0 4.2-2.2 7-6.6 8.4l-.8-1.9c2.5-1 3.8-2.3 4.1-4H3V6h7.2v5.2Zm10.8 0c0 4.2-2.2 7-6.6 8.4l-.8-1.9c2.5-1 3.8-2.3 4.1-4h-3.1V6H21v5.2Z"
                                fill="currentColor"
                              />
                            </svg>
                          </div>

                          <p className="m-0 mt-2 text-sm italic leading-relaxed text-slate-700">
                            I founded NoLSAF to solve a common travel problem: the journey is often <strong>fragmented</strong>. We’re building
                            <strong> one platform</strong> that brings accommodation, transportation booking, and tourism discovery together — so
                            planning feels <strong>clear, predictable, and human</strong>.
                          </p>
                        </div>
                      </div>
                    </aside>
                  </div>

                  <div className="mt-5 grid gap-6 md:grid-cols-2">
                    <div className="relative overflow-hidden rounded-lg border border-[#02665e] bg-[#02665e] p-4 shadow-card">
                      <div aria-hidden className="pointer-events-none absolute inset-0">
                        <div className="absolute inset-0 bg-gradient-to-br from-black/0 via-white/10 to-black/0" />
                        <svg className="absolute inset-0 h-full w-full text-white/18" viewBox="0 0 600 360" fill="none">
                          <path d="M0 72H600M0 144H600M0 216H600M0 288H600" stroke="currentColor" strokeWidth="1" />
                          <path d="M120 0V360M240 0V360M360 0V360M480 0V360" stroke="currentColor" strokeWidth="1" />
                          <circle cx="420" cy="90" r="34" stroke="currentColor" strokeWidth="1.2" />
                          <circle cx="420" cy="90" r="6" fill="currentColor" />
                        </svg>
                        <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-white/12 blur-3xl" />
                        <div className="absolute -top-16 -left-16 h-48 w-48 rounded-full bg-black/10 blur-3xl" />
                      </div>

                      <div className="relative">
                        <div className="text-sm font-semibold text-white">Characteristics</div>
                        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/90">
                          <li className="flex gap-3">
                            <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-white/70" />
                            <span>
                              <strong className="text-white">Vision-led</strong> product thinking with <strong className="text-white">customer empathy</strong> and
                              <strong className="text-white">attention to detail</strong>.
                            </span>
                          </li>
                          <li className="flex gap-3">
                            <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-white/70" />
                            <span>
                              Strong <strong className="text-white">execution</strong>, clear <strong className="text-white">communication</strong>, and consistent
                              <strong className="text-white">integrity</strong>.
                            </span>
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-lg border border-info-500/25 bg-slate-950 p-4 shadow-card ring-1 ring-info-500/10">
                      <div aria-hidden className="pointer-events-none absolute inset-0">
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
                        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_30%,rgba(56,189,248,0.18),transparent_60%)]" />
                        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_85%_70%,rgba(56,189,248,0.12),transparent_55%)]" />
                        <div className="absolute inset-0 opacity-[0.22] [background:repeating-linear-gradient(to_bottom,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_1px,transparent_1px,transparent_5px)]" />
                        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 360" fill="none">
                          <g className="text-info-300/55">
                            <path d="M40 70H210" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M210 70V140H330" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M330 140V220H520" stroke="currentColor" strokeWidth="1.2" />
                            <circle cx="40" cy="70" r="6" fill="currentColor" />
                            <circle cx="210" cy="70" r="6" fill="currentColor" />
                            <circle cx="330" cy="140" r="6" fill="currentColor" />
                            <circle cx="520" cy="220" r="6" fill="currentColor" />
                            <path d="M120 270H260" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M260 270V305H420" stroke="currentColor" strokeWidth="1.2" />
                            <circle cx="120" cy="270" r="6" fill="currentColor" />
                            <circle cx="260" cy="270" r="6" fill="currentColor" />
                            <circle cx="420" cy="305" r="6" fill="currentColor" />
                          </g>
                        </svg>

                        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 360" fill="none">
                          <defs>
                            <linearGradient id="qualAIStroke" x1="260" y1="80" x2="600" y2="220" gradientUnits="userSpaceOnUse">
                              <stop offset="0" stopColor="rgb(56 189 248)" stopOpacity="0" />
                              <stop offset="0.25" stopColor="rgb(56 189 248)" stopOpacity="0.9" />
                              <stop offset="1" stopColor="rgb(56 189 248)" stopOpacity="0.35" />
                            </linearGradient>

                            <pattern id="qualAIDots" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                              <circle cx="2" cy="2" r="1.6" fill="currentColor" opacity="0.95" />
                              <circle cx="11" cy="6" r="1.2" fill="currentColor" opacity="0.8" />
                              <circle cx="6" cy="12" r="1.4" fill="currentColor" opacity="0.9" />
                            </pattern>

                            <filter id="qualAIGlow" x="-30%" y="-30%" width="160%" height="160%">
                              <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
                              <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                              </feMerge>
                            </filter>

                            <mask id="qualAIFaceMask">
                              <rect x="0" y="0" width="600" height="360" fill="black" />
                              <path
                                d="M330 92c26-34 64-52 112-52 48 0 88 20 112 52 16 20 26 45 26 74 0 36-14 68-38 92-26 26-60 40-100 40-48 0-86-18-112-52-18-24-28-52-28-84 0-26 8-50 28-70Z"
                                fill="white"
                              />
                              <path d="M436 86c12 0 22 10 22 22s-10 22-22 22-22-10-22-22 10-22 22-22Z" fill="black" />
                              <path d="M482 86c12 0 22 10 22 22s-10 22-22 22-22-10-22-22 10-22 22-22Z" fill="black" />
                            </mask>

                            <linearGradient id="qualAIFade" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0" stopColor="black" stopOpacity="0" />
                              <stop offset="0.35" stopColor="black" stopOpacity="0" />
                              <stop offset="0.55" stopColor="black" stopOpacity="1" />
                              <stop offset="1" stopColor="black" stopOpacity="1" />
                            </linearGradient>
                            <mask id="qualAIFadeMask">
                              <rect x="0" y="0" width="600" height="360" fill="url(#qualAIFade)" />
                            </mask>
                          </defs>

                          <g mask="url(#qualAIFadeMask)" className="text-info-300/90" opacity="0.95">
                            <rect
                              x="284"
                              y="18"
                              width="300"
                              height="324"
                              fill="url(#qualAIDots)"
                              mask="url(#qualAIFaceMask)"
                              filter="url(#qualAIGlow)"
                              opacity="0.95"
                            />

                            <path
                              d="M330 92c26-34 64-52 112-52 48 0 88 20 112 52 16 20 26 45 26 74 0 36-14 68-38 92-26 26-60 40-100 40-48 0-86-18-112-52-18-24-28-52-28-84 0-26 8-50 28-70Z"
                              stroke="url(#qualAIStroke)"
                              strokeWidth="2"
                              opacity="0.9"
                            />
                            <path d="M406 190c22 10 40 10 64 0" stroke="currentColor" strokeWidth="2" opacity="0.7" />

                            <g opacity="0.95">
                              <path d="M286 110H520" stroke="currentColor" strokeWidth="1.9" filter="url(#qualAIGlow)" />
                              <path d="M270 138H540" stroke="currentColor" strokeWidth="1.9" filter="url(#qualAIGlow)" />
                              <path d="M254 166H560" stroke="currentColor" strokeWidth="1.9" filter="url(#qualAIGlow)" />
                              <path d="M270 194H540" stroke="currentColor" strokeWidth="1.9" filter="url(#qualAIGlow)" />
                              <path d="M286 222H520" stroke="currentColor" strokeWidth="1.9" filter="url(#qualAIGlow)" />

                              <circle cx="286" cy="110" r="4" fill="currentColor" />
                              <circle cx="270" cy="138" r="4" fill="currentColor" />
                              <circle cx="254" cy="166" r="4" fill="currentColor" />
                              <circle cx="270" cy="194" r="4" fill="currentColor" />
                              <circle cx="286" cy="222" r="4" fill="currentColor" />

                              <rect x="476" y="106" width="8" height="8" rx="2" fill="currentColor" opacity="0.85" filter="url(#qualAIGlow)" />
                              <rect x="522" y="134" width="8" height="8" rx="2" fill="currentColor" opacity="0.85" filter="url(#qualAIGlow)" />
                              <rect x="552" y="162" width="8" height="8" rx="2" fill="currentColor" opacity="0.85" filter="url(#qualAIGlow)" />
                              <rect x="522" y="190" width="8" height="8" rx="2" fill="currentColor" opacity="0.85" filter="url(#qualAIGlow)" />
                              <rect x="476" y="218" width="8" height="8" rx="2" fill="currentColor" opacity="0.85" filter="url(#qualAIGlow)" />
                            </g>
                          </g>
                        </svg>

                        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-info-500/18 blur-3xl" />
                        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-info-400/14 blur-3xl" />
                      </div>

                      <div className="relative">
                        <div className="text-sm font-semibold text-slate-50">Qualifications</div>
                        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-200">
                          <li className="flex gap-3">
                            <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-info-300/70" />
                            <span>
                              Foundation in <strong className="text-slate-50">cybersecurity</strong> and engineering discipline for building reliable platforms.
                            </span>
                          </li>
                          <li className="flex gap-3">
                            <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-info-300/70" />
                            <span>
                              Experience delivering <strong className="text-slate-50">digital systems</strong> and applying <strong className="text-slate-50">AI-driven</strong> product thinking.
                            </span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-slate-200/80 pt-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                      <div className="relative h-24 w-24 flex-none overflow-hidden rounded-full border border-slate-200 bg-white ring-1 ring-brand-500/10">
                        <Image
                          src="/assets/Rashid%20Sued.png"
                          alt="Rashidi Sued Rashidi, Co-Founder of NoLSAF"
                          fill
                          sizes="96px"
                          className="object-cover"
                          priority={false}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[#02665e]">Co-Founder</div>
                        <Link
                          href="/founders/rashidi-sued-rashidi"
                          className="mt-1 inline-flex text-base font-semibold text-slate-900 no-underline transition-colors hover:text-[#02665e]"
                        >
                          Rashidi Sued Rashidi
                        </Link>
                        <p className="mt-3 text-sm leading-relaxed text-slate-700">
                          Rashidi Sued Rashidi is an experienced co-founder and business strategist with a strong foundation in technology and a
                          passion for agriculture-driven impact. A graduate of the <strong>University of Dar es Salaam</strong>, Rashid and Daniel first met
                          during a TANTRADE-led exhibition and aligned on a shared ambition: build and lead innovation that is structured,
                          measurable, and built for real people.
                          <br />
                          <br />
                          He is highly oriented toward technology, with the ability to <strong>unlock market niches</strong> and turn insights into
                          execution. Currently leading <strong>NoLSAF</strong>, he applies <strong>data-driven</strong> decision-making to drive
                          growth and maximize ROI. He is also an advocate for an inclusive economy and a <strong>UN SDGs champion</strong>. At NoLSAF, Rashid
                          brings strategy, research, and commercialization focus, with innovations increasingly driven by <strong>Artificial Intelligence</strong>.
                        </p>

                        <div className="mt-5 grid gap-6 md:grid-cols-2">
                          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-card">
                            <div aria-hidden className="pointer-events-none absolute inset-0">
                              <div className="absolute inset-0 bg-gradient-to-br from-white via-[#02665e]/5 to-white" />
                              <svg className="absolute inset-0 h-full w-full text-[#02665e]/10" viewBox="0 0 600 360" fill="none">
                                <path d="M0 72H600M0 144H600M0 216H600M0 288H600" stroke="currentColor" strokeWidth="1" />
                                <path d="M120 0V360M240 0V360M360 0V360M480 0V360" stroke="currentColor" strokeWidth="1" />
                                <path d="M72 70h96v44H72z" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M216 210h120v56H216z" stroke="currentColor" strokeWidth="1.2" />
                              </svg>
                              <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-[#02665e]/10 blur-3xl" />
                            </div>

                            <div className="relative">
                              <div className="text-sm font-semibold text-slate-900">Characteristics</div>
                              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
                                <li className="flex gap-3">
                                  <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-[#02665e]/60" />
                                  <span>
                                    <strong>Structured</strong>, technology-oriented leadership with strong <strong>ownership</strong>.
                                  </span>
                                </li>
                                <li className="flex gap-3">
                                  <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-[#02665e]/60" />
                                  <span>
                                    Strong ability to <strong>identify niches</strong> and build toward <strong>innovation</strong>.
                                  </span>
                                </li>
                              </ul>
                            </div>
                          </div>

                          <div className="relative overflow-hidden rounded-lg border border-info-500/25 bg-slate-950 p-4 shadow-card ring-1 ring-info-500/10">
                            <div aria-hidden className="pointer-events-none absolute inset-0">
                              <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
                              <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_30%,rgba(56,189,248,0.16),transparent_60%)]" />
                              <div className="absolute inset-0 opacity-[0.2] [background:repeating-linear-gradient(to_bottom,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_1px,transparent_1px,transparent_6px)]" />
                              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 360" fill="none">
                                <g className="text-info-300/55">
                                  <path d="M64 92H216" stroke="currentColor" strokeWidth="1.2" />
                                  <path d="M216 92V156H356" stroke="currentColor" strokeWidth="1.2" />
                                  <path d="M356 156V236H540" stroke="currentColor" strokeWidth="1.2" />
                                  <circle cx="64" cy="92" r="6" fill="currentColor" />
                                  <circle cx="216" cy="92" r="6" fill="currentColor" />
                                  <circle cx="356" cy="156" r="6" fill="currentColor" />
                                  <circle cx="540" cy="236" r="6" fill="currentColor" />
                                </g>
                              </svg>
                              <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-info-500/16 blur-3xl" />
                              <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-info-400/12 blur-3xl" />
                            </div>

                            <div className="relative">
                              <div className="text-sm font-semibold text-slate-50">Qualifications</div>
                              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-200">
                                <li className="flex gap-3">
                                  <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-info-300/70" />
                                  <span>
                                    Graduate of <strong className="text-slate-50">University of Dar es Salaam</strong>, with a strong technology and research orientation.
                                  </span>
                                </li>
                                <li className="flex gap-3">
                                  <span aria-hidden className="mt-[0.55rem] h-[2px] w-4 flex-none rounded bg-info-300/70" />
                                  <span>
                                    Skilled in <strong className="text-slate-50">data analysis</strong>, <strong className="text-slate-50">statistical modeling</strong>, and <strong className="text-slate-50">market research</strong> to identify opportunities and maximize ROI.
                                  </span>
                                </li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
