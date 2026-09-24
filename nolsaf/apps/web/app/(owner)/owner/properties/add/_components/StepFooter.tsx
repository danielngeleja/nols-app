"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export function StepFooter({
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  prevLabel = "Previous",
  nextLabel = "Next",
}: {
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}) {
  const hidePrev = !!prevDisabled;
  return (
    <div className={`mt-4 flex items-center ${hidePrev ? "justify-end" : "justify-between"}`}>
      {!hidePrev ? (
        <button
          type="button"
          onClick={onPrev}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPrev();
            }
          }}
          disabled={!!prevDisabled}
          className="box-border flex h-10 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/20 bg-[#151b1e] px-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_-16px_rgba(0,0,0,0.8)] transition-all duration-200 hover:border-white/35 hover:bg-[#1d2427] focus:outline-none focus:ring-2 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95 sm:pl-2.5 sm:pr-4"
          aria-label={prevLabel}
          aria-disabled={!!prevDisabled}
          title={`${prevLabel} (Press Enter or Space)`}
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="hidden sm:inline">{prevLabel}</span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={onNext}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNext();
          }
        }}
        disabled={!!nextDisabled}
        className={`box-border flex items-center gap-2 rounded-lg border-0 bg-[#02665e] text-white transition-all duration-200 hover:bg-[#03786f] focus:outline-none focus:ring-2 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95 ${
          nextLabel && nextLabel.toLowerCase().includes("submit")
            ? "px-4 py-2.5 font-semibold text-sm"
            : "h-10 justify-center px-2.5 text-[13px] font-semibold shadow-[0_10px_24px_-16px_rgba(2,102,94,0.9)] sm:pl-4 sm:pr-2.5"
        }`}
        aria-label={nextLabel}
        aria-disabled={!!nextDisabled}
        title={`${nextLabel} (Press Enter or Space)`}
      >
        {nextLabel && nextLabel.toLowerCase().includes("submit") ? (
          <>
            <span>{nextLabel}</span>
            <ChevronRight className="h-4 w-4" />
          </>
        ) : (
          <>
            <span className="hidden sm:inline">{nextLabel}</span>
            <ChevronRight className="h-5 w-5" />
          </>
        )}
      </button>
    </div>
  );
}


