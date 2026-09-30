import Link from "next/link";

/**
 * 404 for a property (stay): a key tag numbered 404, gently swinging on its hook.
 * Used where a specific property cannot be found, so the dead end turns
 * straight back into a search. Every other missing page gets the site-wide
 * 404 (app/not-found.tsx) with the outline numerals.
 */
export default function StayNotFound({ href = "/public/properties" }: { href?: string }) {
  return (
    <section className="box-border flex min-h-[60vh] flex-col items-center justify-center px-4 py-12 text-center">
      <style>{`
        .nls-keytag { transform-origin: 50% 13px; animation: nls-keytag-swing 3.2s ease-in-out infinite; }
        @keyframes nls-keytag-swing { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
        @media (prefers-reduced-motion: reduce) { .nls-keytag { animation: none; } }
      `}</style>
      <svg width={98} height={140} viewBox="0 0 70 100" aria-hidden="true">
        <circle cx="35" cy="8" r="5" fill="none" stroke="#a3a3a3" strokeWidth="2" />
        <g className="nls-keytag">
          <line x1="35" y1="13" x2="35" y2="24" stroke="#a3a3a3" strokeWidth="2" />
          <rect x="12" y="24" width="46" height="70" rx="12" fill="#e6f4f1" stroke="#1d9e75" strokeWidth="1.5" />
          <circle cx="35" cy="36" r="4" fill="#ffffff" stroke="#1d9e75" strokeWidth="1.5" />
          <text x="35" y="70" textAnchor="middle" fontSize="17" fontWeight="700" fill="#02665e" fontFamily="inherit">404</text>
          <text x="35" y="84" textAnchor="middle" fontSize="8" fontWeight="600" letterSpacing="1" fill="#0f6e56" fontFamily="inherit">STAY</text>
        </g>
      </svg>
      <h1 className="mb-0 mt-5 text-2xl font-bold tracking-tight text-neutral-900">We couldn&apos;t find this stay</h1>
      <p className="mb-0 mt-2 text-base text-neutral-500">It may have been removed, or the link is wrong.</p>
      <Link href={href} className="mt-7 inline-flex h-11 items-center rounded-xl border border-solid border-neutral-300 bg-white px-6 text-sm font-semibold text-neutral-900 no-underline transition hover:border-[#02665e] hover:text-[#02665e]">
        Find a stay
      </Link>
    </section>
  );
}
