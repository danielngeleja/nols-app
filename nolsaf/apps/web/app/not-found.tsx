import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "404" },
  description: "NoLSAF page not found",
};

// Large outline numerals that trace themselves in, one after another, hold,
// then redraw: the same line motion as the NRMS loader. Kept separate from the
// error screens (mark inside a status ring) because a wrong link is not a
// failure. Stay pages have their own key tag version (components/StayNotFound).
export default function NotFoundPage() {
  return (
    <main className="box-border flex min-h-[72vh] items-center justify-center bg-white px-4 py-14 text-neutral-900">
      <style>{`
        .nls-404-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: nls-404-draw 7s cubic-bezier(.65,0,.35,1) infinite; }
        .nls-404-d2 { animation-delay: .25s; }
        .nls-404-d3 { animation-delay: .5s; }
        @keyframes nls-404-draw { 0% { stroke-dashoffset: 1; } 22%, 88% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -1; } }
        @media (prefers-reduced-motion: reduce) { .nls-404-line { animation: none; stroke-dashoffset: 0; } }
      `}</style>
      <section className="flex w-full max-w-md flex-col items-center text-center">
        <svg viewBox="0 0 220 96" className="h-auto w-[240px] sm:w-[320px]" fill="none" stroke="#02665e" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="404">
          <path className="nls-404-line" pathLength={1} d="M44 88 V8 L6 62 H58" />
          <rect className="nls-404-line nls-404-d2" pathLength={1} x="82" y="8" width="56" height="80" rx="28" />
          <path className="nls-404-line nls-404-d3" pathLength={1} d="M200 88 V8 L162 62 H214" />
        </svg>

        <h1 className="mb-0 mt-10 text-2xl font-bold tracking-tight text-neutral-900 sm:text-[28px]">Page not found</h1>
        <p className="mb-0 mt-2.5 text-[15px] leading-6 text-neutral-500">The link may be broken, or the page has moved.</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="inline-flex h-11 items-center rounded-full bg-[#02665e] px-6 text-sm font-semibold text-white no-underline transition hover:bg-[#02514b]">
            Go to homepage
          </Link>
          <Link href="/public/properties" className="inline-flex h-11 items-center rounded-full border border-solid border-neutral-300 bg-white px-6 text-sm font-semibold text-neutral-800 no-underline transition hover:border-[#02665e] hover:text-[#02665e]">
            Find a stay
          </Link>
        </div>
      </section>
    </main>
  );
}
