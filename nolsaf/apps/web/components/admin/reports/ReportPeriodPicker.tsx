"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { CalendarRange, ChevronDown } from "lucide-react";

import DatePickerField from "@/components/DatePickerField";

const DAY_MS = 864e5;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function iso(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseIso(value: string): Date | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function addMonthsUtc(date: Date, months: number) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function endOfMonthUtc(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function daysInclusive(fromIso: string, toIso: string): number | null {
  const from = parseIso(fromIso);
  const to = parseIso(toIso);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

function longLabel(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function monthName(monthIndex: number) {
  return new Date(Date.UTC(2020, monthIndex, 1)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

/**
 * Ranges are grouped by how much history they pull, and each band carries its
 * own colour so the length of the period is readable at a glance: short
 * operational windows in brand green, mid range in blue, long range in indigo.
 */
type Band = "short" | "mid" | "long";

const BAND: Record<Band, { label: string; on: string; off: string; dot: string; soft: string }> = {
  short: {
    label: "Short range",
    on: "bg-[#073c35] text-white shadow-sm",
    off: "bg-transparent text-[#073c35] hover:bg-[#073c35]/10",
    dot: "bg-[#073c35]",
    soft: "bg-[#073c35]/10 text-[#073c35]",
  },
  mid: {
    label: "Mid range",
    on: "bg-sky-700 text-white shadow-sm",
    off: "bg-transparent text-sky-700 hover:bg-sky-100",
    dot: "bg-sky-600",
    soft: "bg-sky-50 text-sky-700",
  },
  long: {
    label: "Long range",
    on: "bg-indigo-700 text-white shadow-sm",
    off: "bg-transparent text-indigo-700 hover:bg-indigo-100",
    dot: "bg-indigo-600",
    soft: "bg-indigo-50 text-indigo-700",
  },
};

function bandForDays(days: number | null): Band {
  if (days === null) return "short";
  if (days <= 31) return "short";
  if (days <= 186) return "mid";
  return "long";
}

/** Ready ranges. Calendar months, so "3 months" means three months back, not 90 days. */
function readyRanges() {
  const end = startOfTodayUtc();
  const make = (from: Date) => ({ from: iso(from), to: iso(end) });

  return [
    {
      band: "short" as Band,
      items: [
        { key: "today", label: "Today", ...make(end) },
        { key: "7d", label: "7 days", ...make(addDaysUtc(end, -6)) },
        { key: "30d", label: "30 days", ...make(addDaysUtc(end, -29)) },
      ],
    },
    {
      band: "mid" as Band,
      items: [
        { key: "3m", label: "3 months", ...make(addMonthsUtc(end, -3)) },
        { key: "6m", label: "6 months", ...make(addMonthsUtc(end, -6)) },
      ],
    },
    {
      band: "long" as Band,
      items: [
        { key: "ytd", label: "Year to date", ...make(new Date(Date.UTC(end.getUTCFullYear(), 0, 1))) },
        { key: "12m", label: "12 months", ...make(addMonthsUtc(end, -12)) },
      ],
    },
  ];
}

/** Whole calendar months, newest first. The running month stops at today. */
function monthOptions(count = 24) {
  const today = startOfTodayUtc();
  const out: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (let back = 0; back < count; back += 1) {
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    const end = endOfMonthUtc(year, monthIndex);
    const to = end.getTime() > today.getTime() ? today : end;
    out.push({
      key: `${year}-${pad2(monthIndex + 1)}`,
      label: `${monthName(monthIndex)} ${year}`,
      from: iso(cursor),
      to: iso(to),
    });
  }
  return out;
}

/** Whole calendar quarters, newest first. The running quarter stops at today. */
function quarterOptions(count = 8) {
  const today = startOfTodayUtc();
  const out: Array<{ key: string; label: string; from: string; to: string }> = [];
  let year = today.getUTCFullYear();
  let quarter = Math.floor(today.getUTCMonth() / 3);
  for (let i = 0; i < count; i += 1) {
    const startMonth = quarter * 3;
    const start = new Date(Date.UTC(year, startMonth, 1));
    const end = endOfMonthUtc(year, startMonth + 2);
    const to = end.getTime() > today.getTime() ? today : end;
    out.push({
      key: `${year}-Q${quarter + 1}`,
      label: `Q${quarter + 1} ${year}`,
      from: iso(start),
      to: iso(to),
    });
    quarter -= 1;
    if (quarter < 0) {
      quarter = 3;
      year -= 1;
    }
  }
  return out;
}

/** Whole calendar years, newest first. The running year stops at today. */
function yearOptions(count = 5) {
  const today = startOfTodayUtc();
  const out: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (let back = 0; back < count; back += 1) {
    const year = today.getUTCFullYear() - back;
    const end = new Date(Date.UTC(year, 11, 31));
    const to = end.getTime() > today.getTime() ? today : end;
    out.push({
      key: String(year),
      label: String(year),
      from: iso(new Date(Date.UTC(year, 0, 1))),
      to: iso(to),
    });
  }
  return out;
}

export default function ReportPeriodPicker({
  from,
  to,
  onChangeAction,
  maxTo,
  maxDays,
  actions,
}: {
  from: string;
  to: string;
  onChangeAction: (from: string, to: string) => void;
  /** Latest selectable end date, when the report caps its own length. */
  maxTo?: string | null;
  /** Longest report the page will run, used for the near limit hint. */
  maxDays?: number;
  /** Extra controls for the header band, for example a refresh button. */
  actions?: ReactNode;
}) {
  const groups = useMemo(() => readyRanges(), []);
  const months = useMemo(() => monthOptions(), []);
  const quarters = useMemo(() => quarterOptions(), []);
  const years = useMemo(() => yearOptions(), []);

  const fromDate = parseIso(from);
  const toDate = parseIso(to);
  const days = daysInclusive(from, to);
  const band = BAND[bandForDays(days)];
  const nearLimit = typeof maxDays === "number" && days !== null && days >= maxDays;

  const matched = (list: Array<{ key: string; from: string; to: string }>) =>
    list.find((option) => option.from === from && option.to === to)?.key ?? "";

  const jump = (list: Array<{ key: string; from: string; to: string }>, key: string) => {
    const option = list.find((item) => item.key === key);
    if (option) onChangeAction(option.from, option.to);
  };

  return (
    <section
      className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm"
      aria-label="Reporting period"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0 text-[#073c35]" aria-hidden />
          <span className="text-[15px] font-bold text-neutral-950">Reporting period</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {fromDate && toDate ? (
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-neutral-600">
              <span className={`h-2 w-2 rounded-full ${band.dot}`} aria-hidden />
              {longLabel(fromDate)} to {longLabel(toDate)}
            </span>
          ) : null}
          {days !== null ? (
            <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[13px] font-bold tabular-nums ${band.soft}`}>
              {days} {days === 1 ? "day" : "days"}
            </span>
          ) : null}
          {actions}
        </div>
      </div>

      <div className="min-w-0 space-y-3 p-3 sm:p-4">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-1 text-[13px] font-semibold text-neutral-500">From</div>
              <DatePickerField
                label="From date"
                value={from}
                max={to}
                onChangeAction={(nextIso) => onChangeAction(nextIso, to)}
                widthClassName="w-full"
                size="sm"
                twoMonths={false}
                allowPast
              />
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[13px] font-semibold text-neutral-500">To</div>
              <DatePickerField
                label="To date"
                value={to}
                min={from}
                max={maxTo ?? undefined}
                onChangeAction={(nextIso) => onChangeAction(from, nextIso)}
                widthClassName="w-full"
                size="sm"
                twoMonths={false}
                allowPast
              />
            </div>
          </div>

          <div className="min-w-0 lg:pl-4">
            <div className="mb-1 text-[13px] font-semibold text-neutral-500">Ready ranges</div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {groups.map((group) => {
                const tone = BAND[group.band];
                return (
                  <div
                    key={group.band}
                    className="box-border min-w-0 rounded-xl border border-solid border-neutral-200 bg-neutral-50 px-2 pb-2 pt-1.5"
                  >
                    <div className="mb-1 flex items-center gap-1.5 px-1 text-[12px] font-semibold text-neutral-500">
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                      {tone.label}
                    </div>
                    <div className="flex flex-wrap gap-1" role="group" aria-label={tone.label}>
                      {group.items.map((item) => {
                        const active = from === item.from && to === item.to;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChangeAction(item.from, item.to)}
                            className={`box-border h-8 flex-none rounded-lg border-0 px-3 text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#073c35]/25 ${
                              active ? tone.on : tone.off
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-0 border-t border-solid border-neutral-100 pt-3">
          <div className="mb-1.5 text-[13px] font-semibold text-neutral-500">Jump to a whole period</div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            <PeriodSelect label="Month" value={matched(months)} options={months} onPick={(key) => jump(months, key)} />
            <PeriodSelect label="Quarter" value={matched(quarters)} options={quarters} onPick={(key) => jump(quarters, key)} />
            <PeriodSelect label="Year" value={matched(years)} options={years} onPick={(key) => jump(years, key)} />
          </div>
          {nearLimit ? (
            <p className="m-0 mt-2 text-[13px] text-amber-700">
              This is the longest period the report will run ({maxDays} days). Pick a shorter one to compare in detail.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PeriodSelect({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: Array<{ key: string; label: string }>;
  onPick: (key: string) => void;
}) {
  const on = Boolean(value);
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onPick(event.target.value)}
        className={`box-border h-10 w-full appearance-none rounded-lg border border-solid bg-white pl-3 pr-9 text-[13.5px] outline-none transition focus:border-[#073c35] focus:ring-4 focus:ring-[#073c35]/10 ${
          on ? "border-[#073c35] font-semibold text-[#073c35]" : "border-neutral-300 text-neutral-700"
        }`}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${on ? "text-[#073c35]" : "text-neutral-400"}`}
        aria-hidden
      />
    </label>
  );
}
