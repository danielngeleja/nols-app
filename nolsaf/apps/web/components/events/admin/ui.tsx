"use client";

/**
 * Small building blocks for the admin Event hire workspace, in the house
 * admin language (white cards, neutral borders, brand #02665e, the dark
 * #0b2420 band). Preflight is off: every border states `border-solid` and
 * every button states its background.
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, KeyRound, Loader2, X } from "lucide-react";
import { askFinanceGrant, tone } from "./eventAdmin";

const TONES = {
  teal: "border-[#02665e]/20 bg-[#02665e]/[0.07] text-[#02665e]",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-neutral-200 bg-neutral-50 text-neutral-600",
};

export function Pill({ status, children, kind }: { status?: string; children: ReactNode; kind?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-solid px-2 py-0.5 text-[11px] font-semibold ${TONES[kind ?? tone(status ?? "")]}`}>{children}</span>;
}

/** A row of filter tabs with live counts. */
export function Chips<T extends string>({ value, onChange, items, label }: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ key: T; label: string; count?: number | null; urgent?: boolean }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
      {items.map(item => {
        const on = item.key === value;
        return (
          <button key={item.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(item.key)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-solid px-3 text-[12px] font-semibold transition-colors ${on ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"}`}>
            {item.label}
            {item.count != null && (
              <span className={`min-w-[1.25rem] rounded px-1 text-center text-[11px] tabular-nums ${on ? "bg-white/15 text-white" : item.urgent && item.count > 0 ? "bg-amber-400 text-emerald-950" : "bg-neutral-100 text-neutral-500"}`}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A slim connected strip of filters with counts (same look as Venue approvals). */
export function Segments<T extends string>({ value, onChange, items, label }: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ key: T; label: string; count?: number | null; hint?: string; warm?: boolean }>;
  label: string;
}) {
  return (
    <nav aria-label={label} className="min-w-0 overflow-x-auto rounded-lg border border-solid border-neutral-200 bg-white [scrollbar-width:thin]">
     <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(7.5rem, 1fr))` }}>
      {items.map((s, i) => {
        const on = s.key === value;
        return (
          <button key={s.key} type="button" onClick={() => onChange(s.key)} aria-current={on ? "true" : undefined} title={s.hint}
            className={`flex h-9 min-w-0 items-center justify-between gap-2 border-0 px-3 text-left text-[12px] font-semibold transition-colors ${i ? "border-l border-solid border-neutral-200" : ""} ${on ? "bg-[#0b2420] text-white" : "bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"}`}>
            <span className="flex min-w-0 items-center gap-1.5 truncate">{s.warm && s.count ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden /> : null}{s.label}</span>
            {s.count !== undefined && <span className={`shrink-0 rounded px-1.5 text-[11px] tabular-nums leading-5 ${on ? "bg-white/15 text-white" : s.count ? "bg-neutral-100 text-neutral-800" : "text-neutral-400"}`}>{s.count ?? "..."}</span>}
          </button>
        );
      })}
     </div>
    </nav>
  );
}

export type SortState<K extends string> = { key: K; dir: "asc" | "desc" };
/** Sort rows by a value getter; ties keep a stable secondary order. */
export function sortRows<R, K extends string>(rows: R[], sort: SortState<K>, value: (r: R, k: K) => string | number) {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sign;
  });
}
/** A sortable column header cell with column divider. */
export function SortTh<K extends string>({ k, label, sort, onSort, right, first }: { k: K; label: string; sort: SortState<K>; onSort: (k: K) => void; right?: boolean; first?: boolean }) {
  const on = sort.key === k;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`p-0 font-semibold ${first ? "" : "border-0 border-l border-solid border-neutral-200"}`}>
      <button type="button" onClick={() => onSort(k)} title={`Sort by ${label.toLowerCase()}`}
        className={`flex w-full items-center gap-1 whitespace-nowrap border-0 bg-transparent px-3 py-2 text-[11px] font-semibold hover:text-neutral-900 ${right ? "justify-end" : ""} ${on ? "text-[#02665e]" : "text-neutral-600"}`}>
        {label}{on ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}
/** The eye that opens a record. */
export function EyeButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} title="Open"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-500 hover:border-[#02665e]/40 hover:bg-[#02665e]/5 hover:text-[#02665e]">
      <Eye className="h-4 w-4" aria-hidden />
    </button>
  );
}

export function Panel({ title, hint, action, children, flush }: { title?: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
      {(title || action) && (
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="m-0 text-[14px] font-semibold text-neutral-900">{title}</h2>}
            {hint && <p className="m-0 mt-0.5 text-[12px] text-neutral-500">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-lg bg-neutral-100 text-neutral-500">{icon}</span>
      <p className="m-0 mt-3 text-[14px] font-semibold text-neutral-800">{title}</p>
      {children && <p className="m-0 mt-1 max-w-md text-[12px] leading-5 text-neutral-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ children = "Loading" }: { children?: ReactNode }) {
  return <p role="status" className="m-0 flex min-h-32 items-center justify-center gap-2 text-[13px] text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{children}</p>;
}

/** Shown in place of a finance-only table until the admin unlocks finance. */
export function FinanceLocked({ what }: { what: string }) {
  return (
    <Empty icon={<KeyRound className="h-5 w-5" />} title="Finance is locked" action={
      <button type="button" onClick={askFinanceGrant} className="inline-flex h-9 items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 text-[12px] font-bold text-emerald-800 hover:bg-emerald-100">
        <KeyRound className="h-3.5 w-3.5" />Unlock finance
      </button>
    }>{what} needs a fresh finance verification. It lasts a short while and every view is recorded.</Empty>
  );
}

export const btn = "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[12px] font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-solid border-[#02665e] bg-[#02665e] px-4 text-[12px] font-semibold text-white no-underline hover:bg-[#014f49] hover:no-underline disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-500";
export const field = "min-h-9 w-full min-w-0 rounded-md border border-solid border-neutral-300 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";

/** A right-hand record drawer: the list stays in view, the record opens beside it. */
export function Drawer({ open, onClose, title, kicker, status, children, footer, busy }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  kicker?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [open, busy, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    // Sits below the finance verification modal (z-100) so an action can ask for it.
    <div id="event-hire-drawer" className="fixed inset-0 z-[90] flex justify-end">
      <style>{`#event-hire-drawer, #event-hire-drawer * { box-sizing: border-box; }`}</style>
      <button type="button" aria-label="Close" className="absolute inset-0 border-0 bg-neutral-950/40 backdrop-blur-[1px]" onClick={() => { if (!busy) onClose(); }} />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-full max-w-[44rem] flex-col bg-white shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 bg-[#0b2420] px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            {kicker && <p className="m-0 text-[11px] font-semibold text-emerald-300/80">{kicker}</p>}
            <h2 className="m-0 mt-0.5 truncate text-[17px] font-semibold text-white">{title}</h2>
            {status && <div className="mt-2 flex flex-wrap items-center gap-1.5">{status}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border-0 bg-white/10 text-white/75 hover:bg-white/20 hover:text-white"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="shrink-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50 px-5 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/** A labelled figure inside a drawer or card. */
export function Fact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-solid border-neutral-200 bg-white px-3 py-2.5">
      <p className="m-0 text-[11px] text-neutral-500">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[14px] font-bold tabular-nums text-neutral-900">{value}</p>
      {sub && <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">{sub}</p>}
    </div>
  );
}

/** A tiny date tile used in every event list. */
export function DateTile({ dayText, monthText, muted }: { dayText: string; monthText: string; muted?: boolean }) {
  return (
    <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md border border-solid ${muted ? "border-neutral-200 bg-neutral-50 text-neutral-500" : "border-[#02665e]/20 bg-[#02665e]/[0.06] text-[#02665e]"}`}>
      <strong className="text-[16px] leading-none tabular-nums">{dayText}</strong>
      <span className="mt-0.5 text-[10px] font-semibold">{monthText}</span>
    </span>
  );
}
