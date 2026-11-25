// The outline "404" that traces itself in, holds, then redraws: the same line
// motion as the NRMS loader. Shared by the site 404 page and the admin
// "record not found" state so a wrong link looks the same everywhere.
export default function NotFoundNumerals({ className = "h-auto w-[240px] sm:w-[320px]" }: { className?: string }) {
  return (
    <>
      <style>{`
        .nls-404-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: nls-404-draw 7s cubic-bezier(.65,0,.35,1) infinite; }
        .nls-404-d2 { animation-delay: .25s; }
        .nls-404-d3 { animation-delay: .5s; }
        @keyframes nls-404-draw { 0% { stroke-dashoffset: 1; } 22%, 88% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -1; } }
        @media (prefers-reduced-motion: reduce) { .nls-404-line { animation: none; stroke-dashoffset: 0; } }
      `}</style>
      <svg viewBox="0 0 220 96" className={className} fill="none" stroke="#02665e" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="404">
        <path className="nls-404-line" pathLength={1} d="M44 88 V8 L6 62 H58" />
        <rect className="nls-404-line nls-404-d2" pathLength={1} x="82" y="8" width="56" height="80" rx="28" />
        <path className="nls-404-line nls-404-d3" pathLength={1} d="M200 88 V8 L162 62 H214" />
      </svg>
    </>
  );
}
