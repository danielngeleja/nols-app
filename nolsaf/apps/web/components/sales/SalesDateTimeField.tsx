"use client";

import { Clock3 } from "lucide-react";
import DatePickerField from "@/components/DatePickerField";

function todayKey(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function parts(value: string): { date: string; time: string } {
  const normalized = String(value || "").trim();
  return {
    date: /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "",
    time: /T\d{2}:\d{2}/.test(normalized) ? normalized.slice(11, 16) : "09:00",
  };
}

export default function SalesDateTimeField({
  label,
  value,
  onChangeAction,
  allowPast = false,
}: {
  label: string;
  value: string;
  onChangeAction: (next: string) => void;
  allowPast?: boolean;
}) {
  const current = parts(value);

  const setDate = (date: string) => {
    onChangeAction(date ? `${date.slice(0, 10)}T${current.time}` : "");
  };

  const setTime = (time: string) => {
    if (!current.date) return;
    onChangeAction(`${current.date}T${time || "09:00"}`);
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-800">{label}</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChangeAction("")}
            className="border-0 bg-transparent p-0 text-[11px] font-semibold text-neutral-400 hover:text-neutral-700"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
        <DatePickerField
          label={`${label} date`}
          value={current.date}
          onChangeAction={setDate}
          min={allowPast ? undefined : todayKey()}
          allowPast={allowPast}
          twoMonths={false}
          widthClassName="!w-full"
          size="sm"
        />

        <label className="relative block">
          <span className="sr-only">{label} time</span>
          <Clock3
            className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            type="time"
            value={current.date ? current.time : ""}
            onChange={(event) => setTime(event.target.value)}
            disabled={!current.date}
            step={300}
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-2 text-sm text-gray-900 shadow-sm outline-none transition hover:bg-brand/5 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-300"
          />
        </label>
      </div>
    </div>
  );
}
