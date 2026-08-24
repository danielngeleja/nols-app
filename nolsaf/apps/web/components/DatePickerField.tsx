"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover, Transition } from "@headlessui/react";
import DatePicker from "@/components/ui/DatePicker";
import { Calendar } from "lucide-react";

type Props = {
  label: string;
  value: string;
  onChangeAction: (nextIso: string) => void;
  min?: string;
  max?: string;
  widthClassName?: string;
  size?: "sm" | "md";
  allowPast?: boolean;
  twoMonths?: boolean;
  variant?: "light" | "dark";
  display?: "date" | "month" | "day-month";
};

function formatDisplay(iso?: string, display: "date" | "month" | "day-month" = "date") {
  if (!iso) return "";
  // Accept both date-only (YYYY-MM-DD) and full ISO datetime (YYYY-MM-DDThh:mm:ss.sssZ)
  const datePart = String(iso).split("T")[0];
  const parts = datePart.split("-");
  if (parts.length !== 3) return String(iso);
  const [y, m, d] = parts;
  if (!y || !m || !d) return String(iso);

  const monthIndex = Number(m);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthLabel =
    Number.isFinite(monthIndex) && monthIndex >= 1 && monthIndex <= 12 ? months[monthIndex - 1] : m;
  const day2 = String(d).padStart(2, "0");
  if (display === "month") return `${monthLabel} ${y}`;
  if (display === "day-month") return `${day2} ${monthLabel}`;
  return `${day2} ${monthLabel} ${y}`;
}

function PopoverPositioner({ open, computePos, measure }: { open: boolean; computePos: () => void; measure: () => void }) {
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    computePos();
    // The panel is in the DOM by now, so replace the height guess with the real
    // one. Without this a trigger low on the page is positioned from an
    // estimate, and the calendar lands at the top of the viewport instead of
    // beside the field that opened it.
    measure();
    window.addEventListener("resize", computePos);
    window.addEventListener("scroll", computePos, true);
    return () => {
      window.removeEventListener("resize", computePos);
      window.removeEventListener("scroll", computePos, true);
    };
  }, [open, computePos, measure]);

  return null;
}

export default function DatePickerField({
  label,
  value,
  onChangeAction,
  min,
  max,
  widthClassName = "sm:w-[220px]",
  size = "md",
  allowPast,
  twoMonths: twoMonthsProp,
  variant = "light",
  display = "date",
}: Props) {
  const isDark = variant === "dark";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [twoMonths, setTwoMonths] = useState(false);

  useEffect(() => {
    if (typeof twoMonthsProp === "boolean") {
      setTwoMonths(twoMonthsProp);
      return;
    }
    const update = () => setTwoMonths(window.innerWidth >= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [twoMonthsProp]);

  const computePos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    if (typeof window === "undefined") return;

    const rect = el.getBoundingClientRect();
    const width = twoMonths
      ? Math.min(720, Math.max(320, window.innerWidth - 32))
      : Math.min(320, window.innerWidth - 32);
    const viewportPadding = 16;
    const panelSize = Math.min(panelHeight ?? (twoMonths ? 470 : 430), window.innerHeight - viewportPadding * 2);
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - panelSize - 8;
    // Below the trigger when it fits, above it when that fits, and otherwise
    // pinned to whichever edge keeps the calendar closest to its own field.
    const top =
      belowTop + panelSize <= window.innerHeight - viewportPadding
        ? belowTop
        : aboveTop >= viewportPadding
          ? aboveTop
          : Math.max(viewportPadding, Math.min(belowTop, window.innerHeight - viewportPadding - panelSize));
    // Anchor to the field that opened it. This used to centre the calendar in
    // the viewport regardless of the trigger, so a field sitting to one side
    // opened its calendar somewhere else entirely.
    //
    // Preferred position is left-aligned with the trigger; if that would run
    // past the right edge, it shifts back just enough to fit. On narrow screens
    // the panel is nearly viewport-wide, so this naturally resolves to centred.
    const viewportRight = window.innerWidth - viewportPadding;
    let left = rect.left;
    if (left + width > viewportRight) left = viewportRight - width;
    left = Math.max(viewportPadding, left);
    setPanelPos({ top, left, width });
  }, [twoMonths, panelHeight]);

  const measure = useCallback(() => {
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    if (height > 0) setPanelHeight((current) => (current === height ? current : height));
  }, []);

  const pretty = formatDisplay(value, display);
  const isSm = size === "sm";

  return (
    <Popover className="relative">
      {({ open, close }) => {
        return (
          <>
            <PopoverPositioner open={open} computePos={computePos} measure={measure} />

            <Popover.Button
              ref={buttonRef}
              type="button"
              className={
                (isSm ? "h-10" : "h-12") +
                " w-full " +
                widthClassName +
                " relative rounded-xl border text-sm shadow-sm " +
                (isSm ? "px-3 pl-10" : "px-4 pl-11") +
                " text-left focus:outline-none transition " +
                (isDark
                  ? "border-white/[0.12] bg-white/[0.07] text-white hover:bg-white/[0.12] focus:ring-2 focus:ring-white/20"
                  : "border-gray-200 bg-white text-gray-900 hover:bg-brand/5 focus:ring-2 focus:ring-brand/25 focus:border-brand")
              }
              aria-label={label}
              title={label}
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
              <Calendar
                className={
                  "absolute left-" +
                  (isSm ? "3" : "4") +
                  (isDark ? " top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" : " top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500")
                }
                aria-hidden
              />
              <span className={"whitespace-nowrap " + (pretty ? "" : (isDark ? "text-slate-500" : "text-gray-400"))}>{pretty || (display === "month" ? "Mon YYYY" : display === "day-month" ? "DD Mon" : "DD Mon YYYY")}</span>
            </Popover.Button>

            {typeof document !== 'undefined' && createPortal(
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
                      ref={panelRef}
                      static
                      className="fixed z-[10000] nolsaf-date-popper"
                      style={{
                        ...(panelPos
                          ? { top: panelPos.top, left: panelPos.left, width: panelPos.width }
                          // Hidden rather than parked at the top of the screen:
                          // one frame with no measurement is what made the
                          // calendar flash in the wrong place.
                          : { top: 0, left: 0, width: twoMonths ? Math.min(720, Math.max(320, window.innerWidth - 32)) : Math.min(320, window.innerWidth - 32), visibility: "hidden" as const }),
                        maxHeight: "calc(100dvh - 32px)",
                        overflowY: "auto",
                      }}
                    >
                      <DatePicker
                        selected={value || undefined}
                        allowRange={false}
                        allowPast={allowPast ?? true}
                        minDate={min}
                        maxDate={max}
                        twoMonths={twoMonths}
                        initialViewDate={value || min || max}
                        onSelectAction={(s) => {
                          const iso = Array.isArray(s) ? s[0] : s;
                          if (!iso) return;
                          onChangeAction(String(iso));
                          close();
                        }}
                        onCloseAction={() => close()}
                      />
                    </Popover.Panel>
                  </Transition>,
                  document.body
                )}
          </>
        );
      }}
    </Popover>
  );
}
