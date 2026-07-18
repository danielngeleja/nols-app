"use client";

import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";

type Props = {
  propertyTitle?: string | null;
  loading?: boolean;
  onRefresh: () => void;
};

export default function NrmsFrozenNotice({ propertyTitle, loading = false, onRefresh }: Props) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-6">
      <section id="nrms-freeze-card" role="alert" className="relative w-full max-w-[19rem] overflow-hidden rounded-[22px] border border-red-100 bg-[linear-gradient(180deg,#fff7f7_0%,#ffffff_60%)] p-5 text-center shadow-[0_20px_46px_-26px_rgba(185,28,28,0.4)]">
        <style>{`#nrms-freeze-card { font-family: "Trebuchet MS", "Trebuchet-MS", Tahoma, sans-serif; }`}</style>
        <span className="pointer-events-none absolute -top-10 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-red-200/30 blur-2xl" aria-hidden="true" />

        <span className="relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-red-100 bg-white text-red-600 shadow-sm ring-4 ring-red-50">
          <CircleAlert className="h-5 w-5" />
        </span>
        <span className="relative mt-3 inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-red-700">Temporarily paused</span>
        <h2 className="relative mt-2 text-base font-bold tracking-tight text-neutral-950">Operations are frozen</h2>
        <p className="relative mb-0 mt-1.5 text-xs leading-5 text-neutral-500">An administrator placed this property in a safety freeze until it is reviewed.</p>

        <div className="relative mt-3.5 flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white/85 px-3 py-2 text-left">
          <div className="min-w-0">
            <p className="m-0 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">Property</p>
            <p className="mb-0 mt-0.5 truncate text-xs font-bold text-neutral-900">{propertyTitle || "Selected property"}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3 shrink-0" /> Marketplace ok</span>
        </div>

        <div className="relative mt-3.5 flex flex-col gap-1.5">
          <a href="mailto:partnerships@nolsaf.com" className="inline-flex min-h-9 items-center justify-center rounded-xl bg-[#073c35] px-3.5 text-xs font-bold text-white no-underline transition hover:bg-[#0a5148] hover:text-white">Contact partners</a>
          <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <p className="relative mb-0 mt-2.5 text-[10px] leading-4 text-neutral-400">Need help? <a href="mailto:partnerships@nolsaf.com" className="font-bold text-emerald-700 underline decoration-emerald-200 underline-offset-2 hover:text-emerald-900">partnerships@nolsaf.com</a></p>
      </section>
    </div>
  );
}
