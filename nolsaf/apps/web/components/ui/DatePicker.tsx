"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

type DayCell = { y: number; m: number; d: number; currentMonth: boolean };

function buildDays(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1).getDay();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevDaysCount = new Date(prevYear, prevMonth + 1, 0).getDate();
  const dim = new Date(year, month + 1, 0).getDate();
  const nextMonth = (month + 1) % 12;
  const nextYear = month === 11 ? year + 1 : year;
  const out: DayCell[] = [];
  for (let i = prevDaysCount - first + 1; i <= prevDaysCount; i++) {
    out.push({ y: prevYear, m: prevMonth, d: i, currentMonth: false });
  }
  for (let i = 1; i <= dim; i++) out.push({ y: year, m: month, d: i, currentMonth: true });
  let n = 1;
  while (out.length % 7 !== 0) {
    out.push({ y: nextYear, m: nextMonth, d: n++, currentMonth: false });
  }
  return out;
}

export default function DatePicker({
  selected,
  onSelectAction,
  onCloseAction,
  allowRange = true,
  allowPast = false,
  minDate,
  maxDate,
  twoMonths = false,
  initialViewDate,
  resetRangeAnchor = false,
  showBookingCounts = false,
}: {
  selected?: string | string[];
  onSelectAction: (s: string | string[]) => void;
  onCloseAction?: () => void;
  allowRange?: boolean;
  allowPast?: boolean; // if true, allow selecting dates before today (unless limited by minDate)
  minDate?: string; // ISO date string (YYYY-MM-DD)
  maxDate?: string; // ISO date string (YYYY-MM-DD)
  twoMonths?: boolean; // show current month and next month side by side
  initialViewDate?: string; // ISO date string (YYYY-MM-DD) to set the initial month/year when nothing selected
  resetRangeAnchor?: boolean; // if true, first click is always treated as a new range start
  showBookingCounts?: boolean; // admin-only booking count badges
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [view, setView] = useState(() => {
    const seed = (() => {
      if (selected) {
        const s = Array.isArray(selected) ? selected[0] : selected;
        if (s) return s;
      }
      if (initialViewDate) return initialViewDate;
      return null;
    })();

    if (seed) {
      const d = new Date(seed + "T00:00:00");
      if (!Number.isNaN(d.getTime())) {
        return { year: d.getFullYear(), month: d.getMonth() };
      }
    }

    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (e.target && (e.target as Node) && !rootRef.current.contains(e.target as Node)) {
        onCloseAction?.();
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onCloseAction]);

  const view2 = useMemo(
    () => (twoMonths ? { year: view.month === 11 ? view.year + 1 : view.year, month: (view.month + 1) % 12 } : null),
    [twoMonths, view.year, view.month]
  );
  const days = buildDays(view.year, view.month);
  const days2 = view2 ? buildDays(view2.year, view2.month) : [];
  const allDays = twoMonths ? [...days, ...days2] : days;

  const selectedArray = (() => {
    if (!selected) return [] as string[];
    if (Array.isArray(selected)) return selected as string[];
    return [selected as string];
  })();

  const isSelected = (y: number, m: number, d: number) => {
    if (!selectedArray || selectedArray.length === 0) return false;
    const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
    if (selectedArray.length === 1) return selectedArray[0] === iso;
    const [a, b] = selectedArray.slice(0, 2).sort();
    return iso >= a && iso <= b;
  };

  // remember last clicked date to enable Shift+click range selection
  const [lastClicked, setLastClicked] = useState<string | null>(() => {
    if (Array.isArray(selected) && selected.length > 0) return selected[0];
    if (typeof selected === "string" && selected) return selected;
    return null;
  });

  useEffect(() => {
    if (resetRangeAnchor) setLastClicked(null);
  }, [resetRangeAnchor]);

  // handle keyboard navigation and escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!rootRef.current) return;
      if (e.key === "Escape") {
        onCloseAction?.();
        return;
      }
      // arrow navigation
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const total = allDays.length;
        if (total === 0) return;
        let idx = focusedIdx;
        if (idx === null) {
          idx = allDays.findIndex((c) => c.currentMonth && c.y === todayY && c.m === todayM && c.d === todayD);
          if (idx === -1) idx = 0;
        }
        if (e.key === "ArrowLeft") idx = Math.max(0, idx - 1);
        if (e.key === "ArrowRight") idx = Math.min(total - 1, idx + 1);
        if (e.key === "ArrowUp") idx = Math.max(0, idx - 7);
        if (e.key === "ArrowDown") idx = Math.min(total - 1, idx + 7);
        setFocusedIdx(idx);
        const btn = btnRefs.current[idx];
        btn?.focus();
      }
      if (e.key === "Enter") {
        if (focusedIdx !== null) {
          const btn = btnRefs.current[focusedIdx];
          btn?.click();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIdx, allDays, lastClicked]);

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();
  const [perDayCounts, setPerDayCounts] = useState<Record<string, { total: number; statuses: Record<string, number> }>>({});

  // fetch aggregated counts for the visible month(s)
  useEffect(() => {
    if (!showBookingCounts) {
      setPerDayCounts({});
      return;
    }

    const start = new Date(view.year, view.month, 1);
    const end = view2
      ? new Date(view2.year, view2.month + 1, 0)
      : new Date(view.year, view.month + 1, 0);
    const isoStart = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    const isoEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    (async () => {
      try {
        const r = await axios.get<Record<string, { total: number; statuses: Record<string, number> }>>(
          "/api/admin/bookings/counts",
          { params: { start: isoStart, end: isoEnd } }
        );
        if (r?.data) setPerDayCounts(r.data);
      } catch (e) {
        // ignore failures — calendar will still work without counts
      }
    })();
  }, [showBookingCounts, view.year, view.month, view2]);

  const renderCell = (cell: DayCell, idx: number, refOffset: number) => {
    const isoKey = `${cell.y}-${pad(cell.m + 1)}-${pad(cell.d)}`;
    const sel = isSelected(cell.y, cell.m, cell.d);
    const cellDateY = cell.y;
    const cellDateM = cell.m;
    const cellDateD = cell.d;
    const isToday = cellDateY === todayY && cellDateM === todayM && cellDateD === todayD;
    let isPast = false;
    let isBeforeMin = false;
    let isAfterMax = false;
    if (minDate) {
      const minDateObj = new Date(minDate + "T00:00:00");
      const minY = minDateObj.getFullYear();
      const minM = minDateObj.getMonth();
      const minD = minDateObj.getDate();
      if (cellDateY < minY) isBeforeMin = true;
      else if (cellDateY === minY && cellDateM < minM) isBeforeMin = true;
      else if (cellDateY === minY && cellDateM === minM && cellDateD < minD) isBeforeMin = true;
    } else if (!allowPast) {
      if (cellDateY < todayY) isPast = true;
      else if (cellDateY === todayY && cellDateM < todayM) isPast = true;
      else if (cellDateY === todayY && cellDateM === todayM && cellDateD < todayD) isPast = true;
    }

    if (maxDate) {
      const maxDateObj = new Date(maxDate + "T00:00:00");
      const maxY = maxDateObj.getFullYear();
      const maxM = maxDateObj.getMonth();
      const maxD = maxDateObj.getDate();
      if (cellDateY > maxY) isAfterMax = true;
      else if (cellDateY === maxY && cellDateM > maxM) isAfterMax = true;
      else if (cellDateY === maxY && cellDateM === maxM && cellDateD > maxD) isAfterMax = true;
    }

    const isDisabled = isPast || isBeforeMin || isAfterMax;
    const hasCount = perDayCounts[isoKey] && perDayCounts[isoKey].total > 0;
    return (
      <button
        key={idx}
        ref={(el) => { btnRefs.current[idx + refOffset] = el; }}
        type="button"
        onClick={(e) => {
          const iso = `${cell.y}-${pad(cell.m + 1)}-${pad(cell.d)}`;
          // Shift+click: build full range and close
          if (allowRange && e.shiftKey && lastClicked) {
            const [a, b] = [lastClicked, iso].sort();
            const selectedDays: string[] = [];
            const sDate = new Date(a + "T00:00:00");
            const eDate = new Date(b + "T00:00:00");
            for (let dt = new Date(sDate); dt <= eDate; dt.setDate(dt.getDate() + 1)) {
              selectedDays.push(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`);
            }
            setLastClicked(null);
            onSelectAction(selectedDays);
            onCloseAction?.();
            return;
          }
          // Second click (no Shift): treat as end date, build [start, end] and close. Picker stays open after first click.
          if (allowRange && lastClicked) {
            const [a, b] = [lastClicked, iso].sort();
            setLastClicked(null);
            onSelectAction([a, b]);
            onCloseAction?.();
            return;
          }
          // First click: set start, do NOT close — picker stays open until end date is selected
          if (!allowRange) {
            setLastClicked(null);
            onSelectAction(iso);
            onCloseAction?.();
            return;
          }

          setLastClicked(iso);
          onSelectAction(iso);
        }}
        onFocus={() => setFocusedIdx(idx + refOffset)}
        className={`
          relative aspect-square flex items-center justify-center rounded-md text-sm font-medium
          box-border appearance-none border-0 p-0
          transition-all duration-150 outline-none focus:ring-2 focus:ring-[#02665e]/40 focus:ring-offset-1
          ${!cell.currentMonth ? "text-gray-300" : ""}
          ${sel ? "bg-[#02665e] text-white shadow-sm" : isToday ? "bg-transparent text-[#02665e] font-bold ring-2 ring-[#02665e]/40" : isDisabled ? "bg-transparent text-gray-300 cursor-not-allowed" : "bg-transparent text-gray-700 cursor-pointer hover:bg-[#02665e]/10 hover:text-[#02665e] active:scale-95"}
          ${hasCount && !sel ? "font-semibold" : ""}
        `}
        title={perDayCounts[isoKey] ? Object.entries(perDayCounts[isoKey].statuses).map(([k, v]) => `${k}: ${v}`).join(", ") : undefined}
        disabled={isDisabled && !sel}
      >
        <span className="relative z-10">{cell.d}</span>
        {hasCount && !sel && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500" />}
      </button>
    );
  };

  return (
    <div ref={rootRef} className={`box-border bg-white p-4 rounded-lg border border-solid border-slate-200 shadow-lg ${twoMonths ? "w-max" : "w-full max-w-[min(20rem,calc(100vw-1rem))]"}`}>
      {/* Header with month/year navigation */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
        <button
          type="button"
          onClick={() => setView((v) => ({ year: v.month === 0 ? v.year - 1 : v.year, month: (v.month + 11) % 12 }))}
          className="box-border appearance-none border-0 bg-transparent cursor-pointer p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900"
          aria-label="Previous month"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {twoMonths && view2 ? (
          <div className="text-base font-semibold text-gray-900">
            {MONTHS[view.month]} {view.year} – {MONTHS[view2.month]} {view2.year}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <select
              value={view.month}
              onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
              className="text-sm font-semibold text-gray-900 bg-transparent border-0 outline-none cursor-pointer hover:text-emerald-700 focus:ring-0 appearance-none pr-1"
              aria-label="Select month"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>{m}</option>
              ))}
            </select>
            <select
              value={view.year}
              onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
              className="text-sm font-semibold text-gray-900 bg-transparent border-0 outline-none cursor-pointer hover:text-emerald-700 focus:ring-0 appearance-none pr-1"
              aria-label="Select year"
            >
              {(() => {
                const endY = allowPast ? new Date().getFullYear() : (maxDate ? new Date(maxDate + 'T00:00:00').getFullYear() : new Date().getFullYear() + 20);
                const startY = allowPast ? 1920 : (minDate ? new Date(minDate + 'T00:00:00').getFullYear() : new Date().getFullYear());
                return Array.from({ length: endY - startY + 1 }, (_, i) => startY + i).reverse().map((y) => (
                  <option key={y} value={y}>{y}</option>
                ));
              })()}
            </select>
          </div>
        )}
        <button
          type="button"
          onClick={() => setView((v) => ({ year: v.month === 11 ? v.year + 1 : v.year, month: (v.month + 1) % 12 }))}
          className="box-border appearance-none border-0 bg-transparent cursor-pointer p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900"
          aria-label="Next month"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {twoMonths && view2 ? (
        /* Two-column: current month and next month */
        <div className="flex flex-row gap-6">
          <div className="w-72">
            <div className="text-sm font-semibold text-gray-700 mb-2">{MONTHS[view.month]} {view.year}</div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-xs font-semibold text-gray-500 py-2">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">{days.map((cell, idx) => renderCell(cell, idx, 0))}</div>
          </div>
          <div className="w-72">
            <div className="text-sm font-semibold text-gray-700 mb-2">{MONTHS[view2.month]} {view2.year}</div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-xs font-semibold text-gray-500 py-2">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">{days2.map((cell, idx) => renderCell(cell, idx, days.length))}</div>
          </div>
        </div>
      ) : (
        <>
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-xs font-semibold text-gray-500 py-2">{w}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((cell, idx) => renderCell(cell, idx, 0))}
          </div>
        </>
      )}
    </div>
  );
}
