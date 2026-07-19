"use client";

import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";

type Props = {
  variant?: "frozen" | "error";
  propertyTitle?: string | null;
  loading?: boolean;
  onRefresh: () => void;
};

export default function NrmsFrozenNotice({ variant = "frozen", propertyTitle, loading = false, onRefresh }: Props) {
  const isFrozen = variant === "frozen";
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-6">
      <section id="nrms-freeze-card" role="alert" className="relative w-full max-w-sm overflow-hidden rounded-[24px] border border-red-100 bg-[linear-gradient(180deg,#fff7f7_0%,#ffffff_60%)] p-6 text-center shadow-[0_20px_46px_-26px_rgba(185,28,28,0.4)]">
        <style>{`#nrms-freeze-card { font-family: "Trebuchet MS", "Trebuchet-MS", Tahoma, sans-serif; }`}</style>
        <span className="pointer-events-none absolute -top-10 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-red-200/30 blur-2xl" aria-hidden="true" />

        <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-100 bg-white text-red-600 shadow-sm ring-4 ring-red-50">
          <CircleAlert className="h-6 w-6" />
        </span>
        <span className="relative mt-3.5 inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-red-700">{isFrozen ? "Temporarily paused" : "Service notice"}</span>
        <h2 className="relative mt-2.5 text-xl font-bold tracking-tight text-neutral-950">{isFrozen ? "Operations are frozen" : "Workspace temporarily unavailable"}</h2>
        <p className="relative mb-0 mt-2 text-sm leading-6 text-neutral-500">
          {isFrozen
            ? "An administrator placed this property in a safety freeze until it is reviewed."
            : "We could not load your NRMS workspace right now. Please try again in a moment."}
        </p>

        {isFrozen ? (
          <div className="relative mt-4 flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white/85 px-3.5 py-2.5 text-left">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Property</p>
              <p className="mb-0 mt-0.5 truncate text-sm font-bold text-neutral-900">{propertyTitle || "Selected property"}</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Marketplace ok</span>
          </div>
        ) : (
          <div className="relative mt-4 rounded-xl border border-neutral-200 bg-white/85 px-3.5 py-2.5 text-left">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Your access</p>
            <p className="mb-0 mt-1 text-sm leading-5 text-neutral-700">This loading error has not changed your role or workspace permissions.</p>
          </div>
        )}

        <p className="relative mb-0 mt-4 text-xs font-bold uppercase tracking-[0.08em] text-neutral-400">
          {isFrozen ? "What you can do" : "Try this first"}
        </p>
        <div className="relative mt-2 flex flex-col gap-2">
          {isFrozen && <a href="mailto:partnerships@nolsaf.com" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white no-underline transition hover:bg-[#0a5148] hover:text-white">Contact partners</a>}
          <button type="button" onClick={onRefresh} disabled={loading} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl text-sm font-bold transition disabled:opacity-50 ${isFrozen ? "border border-neutral-200 bg-white text-neutral-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800" : "border-0 bg-[#073c35] text-white hover:bg-[#0a5148]"}`}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {isFrozen ? "Check again" : "Try again"}
          </button>
        </div>
        <p className="relative mb-0 mt-3 text-xs leading-5 text-neutral-400">
          {isFrozen ? "Still frozen after a review? Email " : "If the workspace remains unavailable, email "}
          <a href={`mailto:${isFrozen ? "partnerships" : "support"}@nolsaf.com`} className="font-bold text-emerald-700 underline decoration-emerald-200 underline-offset-2 hover:text-emerald-900">{isFrozen ? "partnerships" : "support"}@nolsaf.com</a>
          .
        </p>
      </section>
    </div>
  );
}
