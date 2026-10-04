import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

export default function NrmsPoweredByFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`mx-auto w-full max-w-6xl px-4 pb-6 pt-2 sm:px-6 ${className}`}>
      <a
        href="https://nolsaf.com"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Visit the NoLSAF website"
        className="group flex flex-row items-center justify-between gap-3 overflow-hidden rounded-2xl border border-solid border-[#284a40] bg-[#123b31] px-3 py-4 text-left no-underline shadow-sm transition hover:border-[#507365] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-4 sm:gap-5 sm:px-7 sm:py-5"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-solid border-[#aabfb2] bg-[#c4d3c8] sm:h-12 sm:w-12 sm:rounded-xl">
            <Image src="/assets/NoLS2025-04.png" alt="" width={36} height={36} className="h-7 w-7 object-contain sm:h-9 sm:w-9" />
          </span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[8px] font-semibold uppercase tracking-[0.14em] text-[#a9bdb0] sm:text-[9px] sm:tracking-[0.2em]">Powered by</span>
            <strong className="mt-0.5 block text-lg font-bold leading-6 tracking-tight text-[#e4ece5] sm:text-2xl sm:leading-7">NoLSAF</strong>
            <span className="mt-0.5 block truncate text-[10px] leading-4 text-[#b7cbbf] sm:text-[11px]" title="End-to-end Travel Platform">End-to-end Travel Platform</span>
          </span>
        </span>

        <span className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-solid border-[#527367] bg-[#1c483c] px-2.5 py-2 text-[10px] font-semibold text-[#e0e9e2] transition group-hover:border-[#729385] group-hover:bg-[#255244] sm:gap-3 sm:rounded-xl sm:px-4 sm:text-xs">
          <span><span className="hidden sm:inline">Visit </span>nolsaf.com</span>
          <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[#bcd1c4] motion-safe:transition-transform motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
        </span>
      </a>
    </footer>
  );
}
