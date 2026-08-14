"use client";
// Shared NRMS dialog shell. Extracted from the reservations page so more than
// one workspace surface can open the same modal without duplicating the frame,
// its scroll lock and its escape handling.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function ModalFrame({
  title,
  subtitle,
  icon,
  footer,
  onClose,
  children,
  wide,
  extraWide,
  elevated = false,
  closeOnEscape = true,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  extraWide?: boolean;
  elevated?: boolean;
  closeOnEscape?: boolean;
  compact?: boolean;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeOnEscape, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`fixed inset-0 ${elevated ? "z-[1100]" : "z-[1000]"} flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-neutral-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex w-full min-w-0 flex-col rounded-2xl border border-white/70 bg-white shadow-2xl ${compact ? "max-w-2xl overflow-hidden" : `max-h-[calc(100dvh-1.5rem)] overflow-hidden sm:max-h-[calc(100dvh-3rem)] ${extraWide ? "max-w-[980px]" : wide ? "max-w-2xl" : "max-w-md"}`}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 ${compact ? "px-4 py-2.5" : "px-5 py-4 sm:px-6"}`}>
          {compact ? (
            <div className="flex items-center gap-2.5">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS</p>
              <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
              <h3 className="mb-0 text-sm font-bold tracking-tight text-neutral-950">{title}</h3>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              {icon && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white">{icon}</span>}
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS</p>
                <h3 className="mb-0 mt-0.5 text-lg font-bold tracking-tight text-neutral-950">{title}</h3>
                {subtitle && <p className="mb-0 mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
              </div>
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Close dialog" className={`flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-neutral-500 shadow-none transition hover:bg-neutral-100 hover:text-neutral-900 ${compact ? "h-7 w-7" : "h-9 w-9"}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={compact ? "overflow-visible p-3" : "min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6"}>{children}</div>
        {footer && <div className="shrink-0 border-t border-neutral-100 bg-white px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
