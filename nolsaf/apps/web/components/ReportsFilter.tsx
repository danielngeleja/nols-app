"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { Building2, Download, ChevronDown, Sliders } from "lucide-react";
import DatePickerField from "./DatePickerField";
import { Popover, Transition } from "@headlessui/react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export type ReportsFilters = {
  from: string;
  to: string;
  propertyId?: number | null;
  groupBy: "day" | "week" | "month";
};

function formatDate(d: Date) { return d.toISOString().slice(0,10); }
function firstOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }

const MAX_REPORT_DAYS_INCLUSIVE = 366; // max 12 months (incl. leap-year day)

function parseIsoDateOnly(iso: string): Date {
  // Treat YYYY-MM-DD as UTC midnight to avoid timezone drift.
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(iso || ""));
  if (!m) return new Date(NaN);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(Date.UTC(y, mo - 1, d));
}

function addDaysUtc(dateUtc: Date, days: number): Date {
  return new Date(dateUtc.getTime() + days * 864e5);
}

function clampRangeToMax(fromIso: string, toIso: string) {
  const fromD = parseIsoDateOnly(fromIso);
  const toD = parseIsoDateOnly(toIso);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return { from: fromIso, to: toIso, clamped: false, maxTo: null as string | null };
  }

  let from = fromD;
  let to = toD;
  if (to.getTime() < from.getTime()) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  const maxToDate = addDaysUtc(from, MAX_REPORT_DAYS_INCLUSIVE - 1);
  const clamped = to.getTime() > maxToDate.getTime();
  if (clamped) to = maxToDate;

  return {
    from: formatDate(from),
    to: formatDate(to),
    clamped,
    maxTo: formatDate(maxToDate),
  };
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addMonthsUtc(dateUtc: Date, months: number) {
  const y = dateUtc.getUTCFullYear();
  const m = dateUtc.getUTCMonth();
  const d = dateUtc.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const daysInTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, daysInTargetMonth));
  return target;
}

function firstOfYearUtc(dateUtc = startOfTodayUtc()) {
  return new Date(Date.UTC(dateUtc.getUTCFullYear(), 0, 1));
}

type MoreRangeKey = "3m" | "6m" | "ytd" | "12m";
type QuickRangeKey = "today" | "7d" | "30d" | MoreRangeKey;

function PopoverPositioner({ open, computePos }: { open: boolean; computePos: () => void }) {
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    computePos();
    window.addEventListener("resize", computePos);
    window.addEventListener("scroll", computePos, true);
    return () => {
      window.removeEventListener("resize", computePos);
      window.removeEventListener("scroll", computePos, true);
    };
  }, [open, computePos]);

  return null;
}

export default function ReportsFilter({
  onChangeAction,
  exportHref,
}: {
  onChangeAction: (f: ReportsFilters) => void;
  /**
   * Override the default export link. Set to `null` to hide the export button.
   * Default (undefined) keeps exporting invoices CSV.
   */
  exportHref?: string | null;
}) {
  const today = new Date();
  const searchParams = useSearchParams();
  const queryFilters = useMemo(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const propertyId = searchParams.get("propertyId");
    const groupBy = searchParams.get("groupBy");
    const parsedPropertyId = propertyId ? Number(propertyId) : null;
    const initialFrom = from && !Number.isNaN(parseIsoDateOnly(from).getTime()) ? from : formatDate(firstOfMonth(today));
    const initialTo = to && !Number.isNaN(parseIsoDateOnly(to).getTime()) ? to : formatDate(today);
    const clamped = clampRangeToMax(initialFrom, initialTo);
    return {
      from: clamped.from,
      to: clamped.to,
      propertyId: parsedPropertyId && Number.isFinite(parsedPropertyId) ? parsedPropertyId : null,
      groupBy: groupBy === "week" || groupBy === "month" ? groupBy : "day",
    } satisfies ReportsFilters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [props, setProps] = useState<any[]>([]);
  const [filters, setFilters] = useState<ReportsFilters>(queryFilters);

  const clampInfo = clampRangeToMax(filters.from, filters.to);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    api.get<{ items: any[] }>("/api/owner/properties/mine", { params: { status: "APPROVED", pageSize: 100 } })
      .then(r => setProps(Array.isArray((r.data as any)?.items) ? (r.data as any).items : []))
      .catch(() => setProps([]));
  }, []);

  useEffect(() => {
    onChangeAction(filters);
  }, [filters, onChangeAction]);

  const defaultExportHref = `/api/owner/revenue/invoices.csv?date_from=${filters.from}&date_to=${filters.to}${
    filters.propertyId ? `&propertyId=${filters.propertyId}` : ""
  }`;
  const effectiveExportHref = exportHref === undefined ? defaultExportHref : exportHref;

  function applyRange(nextFrom: string, nextTo: string) {
    const clamped = clampRangeToMax(nextFrom, nextTo);
    setFilters((f) => ({ ...f, from: clamped.from, to: clamped.to }));
  }

  function getQuickRange(key: QuickRangeKey) {
    const end = startOfTodayUtc();
    let start = end;

    if (key === "today") start = end;
    if (key === "7d") start = addDaysUtc(end, -6);
    if (key === "30d") start = addDaysUtc(end, -29);
    if (key === "3m") start = addMonthsUtc(end, -3);
    if (key === "6m") start = addMonthsUtc(end, -6);
    if (key === "12m") start = addMonthsUtc(end, -12);
    if (key === "ytd") start = firstOfYearUtc(end);

    const clamped = clampRangeToMax(formatDate(start), formatDate(end));
    return { from: clamped.from, to: clamped.to };
  }

  function setQuickRange(key: QuickRangeKey) {
    const r = getQuickRange(key);
    applyRange(r.from, r.to);
  }

  const rangePresets = useMemo(
    () =>
      [
        { key: "today" as const, label: "Today", hint: "Today", accent: "bg-emerald-500" },
        { key: "7d" as const, label: "7D", hint: "Last 7 days", accent: "bg-sky-500" },
        { key: "30d" as const, label: "30D", hint: "Last 30 days", accent: "bg-violet-500" },
        { key: "3m" as const, label: "3M", hint: "Last 3 months", accent: "bg-indigo-500" },
        { key: "6m" as const, label: "6M", hint: "Last 6 months", accent: "bg-amber-500" },
        { key: "ytd" as const, label: "YTD", hint: "Year to date", accent: "bg-teal-500" },
        { key: "12m" as const, label: "12M", hint: "Last 12 months (max)", accent: "bg-slate-600" },
      ] as const,
    []
  );
  const primaryRanges = rangePresets.slice(0, 3);
  const moreRanges = rangePresets.slice(3) as unknown as Array<(typeof rangePresets)[number] & { key: MoreRangeKey }>;

  return (
    <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Subtle cross-hatch bg */}
      <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />
      <div className="relative bg-white/95">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-[#02665e]/10 flex items-center justify-center">
          <Sliders className="h-3 w-3 text-[#02665e]" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Filters</span>
      </div>
      <div className="px-4 sm:px-5 py-3.5">
        <div className="flex items-end gap-3 overflow-x-auto flex-nowrap pb-1 -mb-1">

          <div className="shrink-0 w-[180px]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">From</div>
            <DatePickerField
              label="From date"
              value={filters.from}
              max={filters.to}
              onChangeAction={(nextIso: string) => { applyRange(nextIso, filters.to); }}
              widthClassName="w-full"
            />
          </div>

          <div className="shrink-0 w-[180px]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">To</div>
            <DatePickerField
              label="To date"
              value={filters.to}
              min={filters.from}
              max={clampInfo.maxTo ?? undefined}
              onChangeAction={(nextIso: string) => { applyRange(filters.from, nextIso); }}
              widthClassName="w-full"
            />
          </div>

          <div className="min-w-[220px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Property</div>
            <label className="relative block">
              <span className="sr-only">Property</span>
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden />
              <select
                className="h-10 w-full pl-9 pr-9 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e]/30 appearance-none"
                title="Property"
                aria-label="Property"
                value={filters.propertyId ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, propertyId: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">All properties</option>
                {props.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Range</div>
            <div className="flex items-center gap-1.5 flex-nowrap">
              {primaryRanges.map((p) => {
                const pr = getQuickRange(p.key);
                const active = filters.from === pr.from && filters.to === pr.to;
                return (
                  <RangePill
                    key={p.key}
                    label={p.label}
                    hint={p.hint}
                    accentClassName={p.accent}
                    active={active}
                    onClick={() => setQuickRange(p.key)}
                  />
                );
              })}

              <MoreOptionsPopover
                mounted={mounted}
                moreRanges={moreRanges}
                onSelectRange={setQuickRange}
                groupBy={filters.groupBy}
                onSelectGroupBy={(g) => setFilters((f) => ({ ...f, groupBy: g }))}
              />
            </div>
          </div>

          {effectiveExportHref ? (
            <div className="shrink-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Export</div>
              <a
                className="no-underline inline-flex items-center justify-center h-10 px-3.5 rounded-xl border border-[#02665e]/20 bg-[#02665e]/5 text-[#02665e] shadow-sm hover:bg-[#02665e]/10 active:scale-[0.97] transition text-xs font-bold gap-1.5"
                href={effectiveExportHref}
                target="_blank"
                rel="noreferrer"
                aria-label="Export CSV"
                title="Export CSV"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                CSV
              </a>
            </div>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}

function MoreOptionsPopover({
  mounted,
  moreRanges,
  onSelectRange,
  groupBy,
  onSelectGroupBy,
}: {
  mounted: boolean;
  moreRanges: Array<{ key: QuickRangeKey; label: string; hint: string; accent: string }>;
  onSelectRange: (k: QuickRangeKey) => void;
  groupBy: "day" | "week" | "month";
  onSelectGroupBy: (g: "day" | "week" | "month") => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const computePos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    if (typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const width = 256;
    const rawLeft = rect.right - width;
    const left = Math.max(12, Math.min(rawLeft, window.innerWidth - 12 - width));
    const top = rect.bottom + 8;
    setPos({ top, left, width });
  }, []);

  return (
    <Popover className="relative shrink-0">
      {({ open, close }) => (
        <>
          <PopoverPositioner open={open} computePos={computePos} />

          <Popover.Button
            ref={buttonRef}
            type="button"
            className={
              "h-10 w-10 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 " +
              (open ? "ring-1 ring-slate-200 bg-slate-50" : "")
            }
            title="More options"
            aria-label="More options"
            onClick={() => {
              if (typeof window !== "undefined") {
                setTimeout(() => {
                  try {
                    computePos();
                  } catch {
                    // ignore
                  }
                }, 0);
              }
            }}
          >
            <Sliders className="h-4 w-4" aria-hidden />
          </Popover.Button>

          {mounted
            ? createPortal(
                <Transition
                  as={Fragment}
                  show={open}
                  enter="transition ease-out duration-150"
                  enterFrom="opacity-0 translate-y-1"
                  enterTo="opacity-100 translate-y-0"
                  leave="transition ease-in duration-120"
                  leaveFrom="opacity-100 translate-y-0"
                  leaveTo="opacity-0 translate-y-1"
                >
                  <Popover.Panel
                    static
                    className="fixed z-[10000] w-64 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
                    style={pos ? { top: pos.top, left: pos.left, width: pos.width } : undefined}
                  >
                    <div className="p-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">More Ranges</div>
                      {moreRanges.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => { onSelectRange(p.key); close(); }}
                          className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50"
                          title={p.hint}
                        >
                          <span className={"h-2 w-2 rounded-sm flex-shrink-0 " + p.accent} aria-hidden />
                          <div className="min-w-0 text-left">
                            <div className="font-bold text-xs leading-5">{p.label}</div>
                            <div className="text-[10px] text-slate-400 leading-4 truncate">{p.hint}</div>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="border-t border-slate-100 px-3 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Group by</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {([
                          { key: "day", label: "Day" },
                          { key: "week", label: "Week" },
                          { key: "month", label: "Month" },
                        ] as const).map((g) => {
                          const active = groupBy === g.key;
                          return (
                            <button
                              key={g.key}
                              type="button"
                              onClick={() => { onSelectGroupBy(g.key); close(); }}
                              className={
                                "h-9 rounded-xl text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 " +
                                (active ? "bg-[#02665e] text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-[#02665e]/5 hover:text-[#02665e]")
                              }
                              aria-pressed={active}
                            >
                              {g.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400">
                      Max range: <span className="font-bold text-slate-600">12 months</span>
                    </div>
                  </Popover.Panel>
                </Transition>,
                document.body
              )
            : null}
        </>
      )}
    </Popover>
  );
}

function RangePill({
  label,
  hint,
  accentClassName,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  accentClassName: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hint}
      className={
        "group relative h-10 px-3.5 rounded-xl border text-xs font-bold shadow-sm transition-all duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 " +
        (active
          ? "bg-[#02665e] border-transparent text-white shadow-[#02665e]/20"
          : "bg-white border-slate-200 text-slate-600 hover:bg-[#02665e]/5 hover:text-[#02665e] hover:border-[#02665e]/20")
      }
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${active ? "bg-white/60" : accentClassName}`} aria-hidden />
        <span>{label}</span>
      </span>

      <span
        role="tooltip"
        className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 shadow-lg opacity-0 scale-95 transition-all duration-150 ease-out group-hover:opacity-100 group-hover:scale-100"
      >
        {hint}
      </span>
    </button>
  );
}
