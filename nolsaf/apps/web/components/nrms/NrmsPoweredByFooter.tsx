import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

export default function NrmsPoweredByFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 ${className}`}>
      <a
        href="https://nolsaf.com"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Visit the NoLSAF website"
        className="group relative flex flex-col items-center justify-center overflow-hidden rounded-lg border border-emerald-950/10 bg-[linear-gradient(105deg,#ffffff_0%,#f5faf8_100%)] px-5 py-4 text-center no-underline shadow-sm transition hover:border-emerald-700/25 hover:shadow-md"
      >
        <span className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full border border-emerald-700/[0.06] bg-emerald-600/[0.025]" aria-hidden="true" />

        <span className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-emerald-950/10 bg-white shadow-sm">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF logo" width={34} height={34} className="h-8 w-8 object-contain" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-400">Powered by</span>
              <strong className="text-base font-bold tracking-tight text-neutral-950 transition group-hover:text-emerald-800">NoLSAF</strong>
            </span>
            <span className="mt-0.5 block text-[11px] font-medium text-emerald-800">End-to-end Travel Platform</span>
          </span>
        </span>

        <span className="mt-3 inline-flex items-center gap-1.5 border-t border-neutral-200 px-4 pt-3 text-[10px] font-bold text-neutral-500 transition group-hover:text-emerald-800">
          Visit nolsaf.com
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </a>
    </footer>
  );
}
