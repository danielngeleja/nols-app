"use client";

/**
 * Loading and error states for PropertyPreview, shaped like the page itself
 * so nothing jumps when the property arrives: command bar with the progress
 * bar (admin), photo gallery, title block, the long-stay review cards, rooms,
 * map. The back button stays live, so an admin is never stuck waiting.
 */
import { ChevronLeft, RefreshCw, XCircle } from "lucide-react";

const B = "rounded-md bg-slate-200/80";

function Bar({ className = "" }: { className?: string }) {
  return <span className={`block ${B} ${className}`} aria-hidden />;
}

export function PropertyPreviewSkeleton({ mode, onClose, longStay }: { mode: "admin" | "owner" | "public"; onClose?: () => void; longStay?: boolean }) {
  const admin = mode === "admin";
  return (
    <div className="w-full bg-white" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the property</span>
      <style>{`
        @keyframes pp-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
        .pp-skel .bg-slate-200\\/80 { background-image: linear-gradient(90deg, rgba(226,232,240,0.8) 0px, rgba(241,245,249,1) 160px, rgba(226,232,240,0.8) 320px); background-size: 800px 100%; animation: pp-shimmer 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .pp-skel .bg-slate-200\\/80 { animation: none; } }
      `}</style>

      <div className="pp-skel">
        {admin ? (
          <div className="sticky top-0 z-30 border-0 border-b border-solid border-slate-200 bg-white/95 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 py-3">
              {onClose ? (
                <button type="button" onClick={onClose} aria-label="Back to properties"
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900">
                  <ChevronLeft className="h-5 w-5" />
                </button>
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                <Bar className="h-4 w-56 max-w-full" />
                <div className="flex max-w-[420px] items-center gap-2.5">
                  <Bar className="h-2 flex-1 rounded-full" />
                  <Bar className="h-3 w-9" />
                </div>
              </div>
              <div className="flex gap-2">
                <Bar className="h-9 w-20 rounded-lg" />
                <Bar className="h-9 w-24 rounded-lg" />
                <Bar className="h-9 w-28 rounded-lg" />
              </div>
            </div>
          </div>
        ) : null}

        <div className={admin ? "space-y-5 py-5" : "mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8"}>
          {admin && longStay ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-solid border-slate-200">
                <div className="flex items-center gap-3 px-5 py-4">
                  <Bar className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2"><Bar className="h-3 w-24" /><Bar className="h-4 w-48" /><Bar className="h-3 w-3/4" /></div>
                </div>
                <div className="grid gap-4 border-0 border-t border-solid border-slate-100 px-5 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-2.5"><Bar className="h-4 w-4 rounded-full" /><div className="flex-1 space-y-1.5"><Bar className="h-3 w-24" /><Bar className="h-3 w-32" /></div></div>)}
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="space-y-3 rounded-xl border border-solid border-slate-200 p-5">
                    <Bar className="h-4 w-36" />
                    {[0, 1, 2, 3, 4].map((j) => <div key={j} className="flex justify-between gap-4"><Bar className="h-3 w-28" /><Bar className="h-3 w-20" /></div>)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Gallery */}
          <div className="grid h-[260px] gap-2 sm:h-[340px] sm:grid-cols-4 sm:grid-rows-2">
            <Bar className="rounded-2xl sm:col-span-2 sm:row-span-2" />
            <Bar className="hidden rounded-2xl sm:block" />
            <Bar className="hidden rounded-2xl sm:block" />
            <Bar className="hidden rounded-2xl sm:block" />
            <Bar className="hidden rounded-2xl sm:block" />
          </div>

          {/* Identity */}
          <div className="space-y-3">
            <div className="flex gap-2"><Bar className="h-6 w-20 rounded-full" /><Bar className="h-6 w-24 rounded-full" /></div>
            <Bar className="h-7 w-2/3 max-w-md" />
            <Bar className="h-4 w-1/2 max-w-sm" />
          </div>

          {/* Facts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2 rounded-xl border border-solid border-slate-200 p-4"><Bar className="h-3 w-16" /><Bar className="h-5 w-10" /></div>)}
          </div>

          {/* Description */}
          <div className="space-y-2.5 rounded-2xl border border-solid border-slate-200 p-5">
            <Bar className="h-5 w-40" />
            <Bar className="h-3 w-full" /><Bar className="h-3 w-full" /><Bar className="h-3 w-5/6" /><Bar className="h-3 w-2/3" />
          </div>

          {/* Rooms */}
          <div className="space-y-3 rounded-2xl border border-solid border-slate-200 p-5">
            <div className="flex items-center gap-2"><Bar className="h-9 w-9 rounded-xl" /><Bar className="h-5 w-40" /></div>
            {[0, 1].map((i) => (
              <div key={i} className="grid gap-4 border-0 border-t border-solid border-slate-100 pt-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2"><Bar className="h-4 w-28" /><Bar className="h-3 w-36" /><Bar className="h-3 w-24" /></div>
                <div className="space-y-2"><Bar className="h-3 w-full" /><Bar className="h-3 w-4/5" /><div className="flex flex-wrap gap-1.5 pt-1">{[0, 1, 2, 3, 4, 5].map((j) => <Bar key={j} className="h-7 w-24" />)}</div></div>
              </div>
            ))}
          </div>

          {/* Map */}
          <div className="overflow-hidden rounded-2xl border border-solid border-slate-200">
            <div className="flex items-center gap-3 p-5"><Bar className="h-10 w-10 rounded-xl" /><div className="flex-1 space-y-2"><Bar className="h-5 w-36" /><Bar className="h-3 w-64 max-w-full" /></div></div>
            <Bar className="h-[240px] rounded-none" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PropertyPreviewError({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose?: () => void }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-solid border-slate-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-rose-50 text-rose-600"><XCircle className="h-6 w-6" /></span>
        <p className="m-0 mt-3 text-[15px] font-bold text-slate-900">Could not load this property</p>
        <p className="m-0 mt-1 text-[13px] text-slate-500">{message}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onClose ? (
            <button type="button" onClick={onClose} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">
              <ChevronLeft className="h-4 w-4" />Back
            </button>
          ) : null}
          <button type="button" onClick={onRetry} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3.5 text-[13px] font-semibold text-white hover:bg-[#014e47] [font-family:inherit]">
            <RefreshCw className="h-4 w-4" />Try again
          </button>
        </div>
      </div>
    </div>
  );
}
