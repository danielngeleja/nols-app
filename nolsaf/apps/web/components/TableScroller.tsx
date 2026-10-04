"use client";

// Horizontal scroll shell for wide tables. Wide column sets used to clip with no
// affordance once a page lost width (a sidebar, a narrow laptop), so this adds
// the two things that were missing: chevron controls and a fade on whichever
// edge still has content behind it. Both are derived from measured overflow, so
// a table that fits renders exactly as it did before, with no extra chrome.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Tolerance for sub-pixel scroll widths, which never settle exactly on 0 or max.
const EPSILON = 2;

export default function TableScroller({
  children,
  className = "",
  /** Vertical offset of the chevrons, aligned with a table header row by default. */
  controlsTop = "1.4rem",
  label = "table",
}: {
  children: ReactNode;
  className?: string;
  controlsTop?: string;
  label?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setCanLeft(node.scrollLeft > EPSILON);
    setCanRight(max > EPSILON && node.scrollLeft < max - EPSILON);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    measure();
    node.addEventListener("scroll", measure, { passive: true });

    // Column widths settle after data loads and after the viewport changes, so
    // watch the scroller and its content rather than measuring only on mount.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (observer) {
      observer.observe(node);
      if (node.firstElementChild) observer.observe(node.firstElementChild);
    }
    window.addEventListener("resize", measure);

    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const step = useCallback((direction: -1 | 1) => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(240, node.clientWidth * 0.8), behavior: "smooth" });
  }, []);

  const buttonClass =
    "absolute z-20 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-solid border-slate-200 bg-white text-slate-600 shadow-[0_4px_14px_-4px_rgba(15,23,42,0.35)] outline-none transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#02665e]/25";

  const fadeClass = "pointer-events-none absolute inset-y-0 z-10 w-10";

  return (
    <div className={`relative ${className}`}>
      <div ref={scrollRef} className="overflow-x-auto">
        {children}
      </div>

      {canLeft ? (
        <>
          <span
            className={`${fadeClass} left-0`}
            style={{ background: "linear-gradient(to right, rgba(255,255,255,0.95), rgba(255,255,255,0))" }}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={`Scroll ${label} left`}
            title="Scroll left"
            className={`${buttonClass} left-1.5`}
            style={{ top: controlsTop }}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.2} aria-hidden />
          </button>
        </>
      ) : null}

      {canRight ? (
        <>
          <span
            className={`${fadeClass} right-0`}
            style={{ background: "linear-gradient(to left, rgba(255,255,255,0.95), rgba(255,255,255,0))" }}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={`Scroll ${label} right`}
            title="Scroll right"
            className={`${buttonClass} right-1.5`}
            style={{ top: controlsTop }}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.2} aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}
