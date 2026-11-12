"use client";

// A small "i" that opens a short explanation on tap or click (phones have no
// hover). The note is position: fixed and clamped to the viewport, so it is
// never clipped by an overflow-hidden card or a scrolling table, and never runs
// off the screen edge. Closes on outside tap, Escape, scroll or resize.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

const WIDTH = 264;
const EDGE = 12;

export default function InfoTip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const note = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const close = useCallback(() => setPos(null), []);

  const open = () => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - width / 2), window.innerWidth - width - EDGE);
    const above = r.bottom + 160 > window.innerHeight && r.top > 180;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  };

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || note.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pos, close]);

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={!!pos}
        aria-controls={pos ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pos) close();
          else open();
        }}
        className={`inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border-0 p-0 transition-colors ${pos ? "bg-[#02665e] text-white" : "bg-transparent text-slate-400 hover:bg-slate-100 hover:text-[#02665e]"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#02665e]`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {pos ? (
        <div
          ref={note}
          id={id}
          role="note"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: Math.min(WIDTH, typeof window === "undefined" ? WIDTH : window.innerWidth - EDGE * 2), transform: pos.above ? "translateY(-100%)" : undefined }}
          className="z-[80] whitespace-normal rounded-md border border-solid border-slate-300 bg-white px-3 py-2.5 text-left text-[12px] font-normal leading-relaxed text-slate-700 shadow-lg"
        >
          <p className="m-0 mb-1 text-[12px] font-semibold text-slate-900">{label}</p>
          <div className="text-[12px] text-slate-600">{children}</div>
        </div>
      ) : null}
    </span>
  );
}
