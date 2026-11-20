"use client";

/**
 * A small "i" button that opens a light explanation card next to it.
 *
 * The card is drawn into <body> with fixed positioning, so a parent card with
 * overflow hidden never clips it. It closes on a tap outside, Escape, scroll
 * or resize. Use it for one short explanation, not for forms.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";

const CARD_WIDTH = 288;
const GAP = 8;
const EDGE = 12;

export function InfoTip({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(rect.left - 12, window.innerWidth - width - EDGE));
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    // Full content height, not the height already capped by maxHeight.
    const height = cardRef.current?.scrollHeight ?? 0;
    // Open below; flip above when the card would run off the bottom and there is more room up there.
    if (height > below && above > below) {
      setPos({ top: Math.max(EDGE, rect.top - GAP - Math.min(height, above)), left, maxHeight: above });
    } else {
      setPos({ top: rect.bottom + GAP, left, maxHeight: below });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Measure once the card exists, then place it for its real height.
  useLayoutEffect(() => {
    if (open && pos && cardRef.current) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    const onDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return <>
    <button
      ref={buttonRef}
      type="button"
      className={`ap-info-btn${open ? " is-on" : ""}`}
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={() => setOpen((value) => !value)}
    >
      <Info className="h-4 w-4" />
    </button>
    {open && pos && typeof document !== "undefined" ? createPortal(
      <div ref={cardRef} role="dialog" aria-label={title} className="it-card" style={{ top: pos.top, left: pos.left, width: Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2), maxHeight: pos.maxHeight }}>
        <div className="it-head">
          <p className="it-title">{title}</p>
          <button type="button" className="it-close" aria-label="Close" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="it-body">{children}</div>
      </div>,
      document.body,
    ) : null}
  </>;
}
