"use client";

// One field for a date and a time: a single box that reads "28 Nov 2026, 14:00"
// and opens the house calendar with the time chosen in the same popover. Used
// where a native datetime-local input would otherwise appear.
// Value format matches datetime-local: "YYYY-MM-DDTHH:mm" (no zone; callers
// decide the zone, e.g. EAT).

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover, Transition } from "@headlessui/react";
import { CalendarClock } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const PANEL_WIDTH = 320;

function split(value: string): { date: string; time: string } {
  const v = String(value || "");
  return {
    date: /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "",
    time: /T\d{2}:\d{2}/.test(v) ? v.slice(11, 16) : "",
  };
}

function pretty(value: string): string {
  const { date, time } = split(value);
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}${time ? `, ${time}` : ""}`;
}

type Props = {
  value: string;
  onChangeAction: (next: string) => void;
  /** Accessible name for the trigger, e.g. "From (EAT)". */
  label: string;
  placeholder?: string;
  /** Time used when a date is picked before a time. */
  defaultTime?: string;
  allowPast?: boolean;
  /** Classes for the trigger box so it matches the surrounding form. */
  buttonClassName?: string;
};

export default function DateTimeField({
  value,
  onChangeAction,
  label,
  placeholder = "Choose date and time",
  defaultTime = "09:00",
  allowPast = false,
  buttonClassName = "h-10 rounded-lg border border-solid border-slate-300 bg-white text-sm text-slate-900 hover:border-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15",
}: Props) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { date, time } = split(value);
  const shown = pretty(value);

  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const pad = 16;
    const height = 520;
    const below = r.bottom + 8;
    const top = below + height <= window.innerHeight - pad ? below : Math.max(pad, r.top - height - 8);
    const left = Math.max(pad, Math.min(r.left, window.innerWidth - pad - PANEL_WIDTH));
    setPos({ top, left });
  }, []);

  return (
    <Popover className="relative min-w-0">
      {({ open, close }) => (
        <>
          <Reposition open={open} place={place} />
          <Popover.Button
            ref={buttonRef}
            type="button"
            aria-label={label}
            className={`relative flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 text-left outline-none transition ${buttonClassName}`}
          >
            <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <span className={`truncate ${shown ? "" : "text-slate-400"}`}>{shown || placeholder}</span>
          </Popover.Button>

          {typeof document !== "undefined" && createPortal(
            <Transition
              as={Fragment}
              show={open}
              enter="transition ease-out duration-150"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-1"
            >
              <Popover.Panel
                static
                className="nolsaf-date-popper fixed z-[10000]"
                style={{
                  ...(pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" as const }),
                  width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
                  maxHeight: "calc(100dvh - 32px)",
                  overflowY: "auto",
                }}
              >
                {/* One card: the calendar's own frame is flattened so the time row sits inside it. */}
                <div className="box-border overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-lg [&>div:first-child]:max-w-none [&>div:first-child]:rounded-none [&>div:first-child]:border-0 [&>div:first-child]:shadow-none">
                  <DatePicker
                    selected={date || undefined}
                    allowRange={false}
                    allowPast={allowPast}
                    twoMonths={false}
                    initialViewDate={date || undefined}
                    onSelectAction={(s) => {
                      const picked = String(Array.isArray(s) ? s[0] : s || "").slice(0, 10);
                      if (picked) onChangeAction(`${picked}T${time || defaultTime}`);
                    }}
                    onCloseAction={() => close()}
                  />
                  <div className="flex items-center gap-2 border-0 border-t border-solid border-slate-100 px-3 py-2.5">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-600">
                      Time
                      <select
                        value={time || defaultTime}
                        disabled={!date}
                        onChange={(e) => date && onChangeAction(`${date}T${e.target.value}`)}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-solid border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-[#02665e] disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        {!TIMES.includes(time || defaultTime) && <option value={time || defaultTime}>{time || defaultTime}</option>}
                        {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => close()}
                      disabled={!date}
                      className="h-9 cursor-pointer rounded-lg border border-solid border-[#02665e] bg-[#02665e] px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </Popover.Panel>
            </Transition>,
            document.body,
          )}
        </>
      )}
    </Popover>
  );
}

function Reposition({ open, place }: { open: boolean; place: () => void }) {
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
  return null;
}
