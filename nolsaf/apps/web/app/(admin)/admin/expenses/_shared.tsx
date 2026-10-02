"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, KeyRound, Lock, X } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";

/**
 * Shared bits for the Expenses workspace: a fetch that recognises the finance
 * grant prompt, money and EAT date formatting, and the house form classes.
 */

export class FinanceLockedError extends Error {}

/** fetch + JSON. A 403 asking for the finance grant opens the verify modal. */
export async function financeFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const json = await res.json().catch(() => null);
  if (res.status === 403 && json?.require2fa) {
    window.dispatchEvent(new CustomEvent("finance-grant-required"));
    throw new FinanceLockedError("Verify finance access to continue.");
  }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

/** Loads data, re-runs when the finance grant is given, and exposes the locked state. */
export function useFinanceData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((k) => k + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    financeFetch<T>(url)
      .then((json) => { if (!cancelled) { setData(json); setError(null); setLocked(false); } })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof FinanceLockedError) setLocked(true);
        else setError(err?.message || "Could not load.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, key]);

  useEffect(() => {
    window.addEventListener("finance-grant-granted", reload);
    return () => window.removeEventListener("finance-grant-granted", reload);
  }, [reload]);

  return { data, loading, error, locked, reload, setData };
}

export function LockedCard({ what }: { what: string }) {
  return (
    <section className="mx-auto mt-10 max-w-md rounded-2xl border border-solid border-neutral-300 bg-white p-6 text-center shadow-sm">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Lock className="h-5 w-5" /></span>
      <h1 className="m-0 mt-4 text-lg font-bold text-neutral-900">{what} is protected</h1>
      <p className="m-0 mt-1 text-sm text-neutral-500">Verify finance access to continue. It stays open for 15 minutes.</p>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#0b2420] px-4 text-sm font-semibold text-white hover:bg-[#12342f]">
        <KeyRound className="h-4 w-4" /> Verify to continue
      </button>
    </section>
  );
}

export const tzs = (amount: number | null | undefined, currency = "TZS") => `${currency} ${Math.round(Number(amount) || 0).toLocaleString("en-US")}`;
export const compactTzs = (amount: number) => {
  const a = Math.abs(amount);
  if (a >= 1_000_000_000) return `TZS ${(amount / 1_000_000_000).toFixed(1)}B`;
  if (a >= 1_000_000) return `TZS ${(amount / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `TZS ${Math.round(amount / 1000)}K`;
  return tzs(amount);
};

const EAT = "Africa/Dar_es_Salaam";
export const eatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT }) : "";
export const monthLabel = (periodMonth: string) => new Date(`${periodMonth}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** Today in Dar es Salaam as YYYY-MM-DD. */
export function eatTodayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const fieldClass =
  "box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
export const sectionLabel = "m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400";
export const cardClass = "min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm";
export const primaryButton = "inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white hover:bg-[#12342f] disabled:opacity-50";
export const secondaryButton = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40";

/** Keeps "NoLSAF" in its own casing inside uppercase labels. */
function withBrand(text: string) {
  const parts = text.split("NoLSAF");
  return parts.flatMap((part, i) => (i ? [<span key={i} className="normal-case">NoLSAF</span>, part] : [part]));
}

/** The house page header for a workspace page: dark band, title, facts. */
export function PageBand({ eyebrow, title, subtitle, actions, facts }: { eyebrow: string; title: string; subtitle: string; actions?: React.ReactNode; facts?: Array<{ label: string; value: string; detail?: string; tone?: string }> }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
      <div className="relative px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">{withBrand(eyebrow)}</p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h1>
            <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">{subtitle}</p>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {facts && facts.length > 0 && (
          <dl className={`m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 ${facts.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} lg:gap-y-0`}>
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index > 0 && index % 2 === 0 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{withBrand(fact.label)}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone ?? "text-white"}`}>{fact.value}</dd>
                {fact.detail ? <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd> : null}
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

// ── Dates: the house DatePicker, never the browser's native input ────────

const pickerDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function PickerOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-[90] bg-neutral-950/20" onClick={onClose} aria-hidden />
      <div className="fixed left-1/2 top-1/2 z-[91] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">{children}</div>
    </>
  );
}

/**
 * One calendar day (YYYY-MM-DD) chosen with the house DatePicker. Looks like
 * a form field; the calendar opens over the page so dialogs never clip it.
 */
export function DateField({
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  initialView,
  clearable = false,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  /** Month to open on when empty, e.g. a likely birth year. */
  initialView?: string;
  clearable?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <div className={`relative ${className ?? ""}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          className="box-border flex h-full min-h-10 w-full items-center gap-2.5 rounded-[inherit] border-0 bg-transparent px-3.5 text-left text-sm"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-[#02665e]" />
          <span className={`min-w-0 flex-1 truncate ${value ? "text-neutral-900" : "text-neutral-400"}`}>{value ? pickerDay(value) : placeholder}</span>
        </button>
        {clearable && value ? (
          <button type="button" onClick={() => onChange("")} aria-label="Clear date" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {open && (
        <PickerOverlay onClose={close}>
          <DatePicker
            selected={value || undefined}
            allowRange={false}
            allowPast
            minDate={min}
            maxDate={max}
            initialViewDate={value || initialView}
            onSelectAction={(picked) => { const day = Array.isArray(picked) ? picked[0] : picked; if (day) onChange(day); setOpen(false); }}
            onCloseAction={close}
          />
        </PickerOverlay>
      )}
    </>
  );
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A month (YYYY-MM) chosen from a year-by-year grid, in the DatePicker's style. */
export function MonthField({ value, onChange, max, className, ariaLabel }: { value: string; onChange: (value: string) => void; max?: string; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value || eatTodayIso()).slice(0, 4)));
  const close = useCallback(() => setOpen(false), []);
  const label = value ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "Pick a month";
  return (
    <>
      <div className={`relative ${className ?? ""}`}>
        <button type="button" onClick={() => { setYear(Number((value || eatTodayIso()).slice(0, 4))); setOpen(true); }} aria-label={ariaLabel} aria-haspopup="dialog" className="box-border flex h-full min-h-10 w-full items-center gap-2.5 rounded-[inherit] border-0 bg-transparent px-3.5 text-left text-sm">
          <CalendarDays className="h-4 w-4 shrink-0 text-[#02665e]" />
          <span className={`flex-1 truncate ${value ? "text-neutral-900" : "text-neutral-400"}`}>{label}</span>
        </button>
      </div>
      {open && (
        <PickerOverlay onClose={close}>
          <div className="w-[280px] p-4">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="Previous year" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-600 hover:bg-neutral-100"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-sm font-semibold text-neutral-900 tabular-nums">{year}</span>
              <button type="button" onClick={() => setYear((y) => y + 1)} disabled={Boolean(max) && year >= Number(max!.slice(0, 4))} aria-label="Next year" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {MONTHS_SHORT.map((m, i) => {
                const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                const on = key === value;
                const disabled = Boolean(max) && key > max!;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => { onChange(key); setOpen(false); }}
                    className={`h-10 rounded-lg border-0 text-sm font-medium transition ${on ? "bg-[#02665e] text-white" : "bg-transparent text-neutral-700 hover:bg-emerald-50 hover:text-emerald-800"} disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </PickerOverlay>
      )}
    </>
  );
}

// ── Confirm: our dialog, never the browser's window.confirm ─────────────

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for actions that stop or undo something. */
  danger?: boolean;
  /** Key figures shown in the dialog, e.g. net pay and headcount. */
  facts?: Array<{ label: string; value: string }>;
};

/**
 * Promise-based confirm in the house style.
 *   const [confirmDialog, confirm] = useConfirm();
 *   if (!(await confirm({ title, message, confirmLabel }))) return;
 *   ...render {confirmDialog} somewhere in the component.
 */
export function useConfirm(): [React.ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);

  const ask = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ options, resolve })), []);
  const settle = useCallback((ok: boolean) => {
    setState((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); settle(false); }
      if (e.key === "Enter") { e.preventDefault(); settle(true); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, settle]);

  const o = state?.options;
  const dialog = o ? (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-[2px]" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={() => settle(false)}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3.5 px-5 pb-4 pt-5">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${o.danger ? "bg-rose-50 text-rose-600" : "bg-[#02665e]/10 text-[#02665e]"}`}>
            {o.danger ? <X className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p id="confirm-title" className="m-0 text-base font-bold text-neutral-900">{o.title}</p>
            <p className="m-0 mt-1 text-sm leading-relaxed text-neutral-600">{o.message}</p>
          </div>
        </div>
        {o.facts?.length ? (
          <dl className="mx-5 mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200">
            {o.facts.map((f) => (
              <div key={f.label} className="bg-white px-3 py-2">
                <dt className="text-[11px] text-neutral-500">{f.label}</dt>
                <dd className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-5 py-3">
          <button type="button" onClick={() => settle(false)} className="inline-flex h-9 items-center rounded-full border border-solid border-neutral-300 bg-white px-4 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">{o.cancelLabel ?? "Go back"}</button>
          <button type="button" autoFocus onClick={() => settle(true)} className={`inline-flex h-9 items-center rounded-full border-0 px-4 text-xs font-semibold text-white ${o.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-[#0b2420] hover:bg-[#12342f]"}`}>{o.confirmLabel}</button>
        </div>
      </div>
    </div>
  ) : null;

  return [dialog, ask];
}
