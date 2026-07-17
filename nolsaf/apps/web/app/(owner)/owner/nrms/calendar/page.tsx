"use client";

// NRMS unified room calendar (doc 7.2, 10.3): a complete room-rack view
// combining NoLSAF bookings, external reservations and availability blocks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight, Loader2, LogIn, LogOut, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type FeedUnit = { id: number; code: string; floor: number | null; status: string };
type FeedType = {
  id: number;
  name: string;
  baseRate: number | null;
  currency: string;
  status: string;
  units: FeedUnit[];
};
type FeedEntry = {
  kind: "BOOKING" | "RESERVATION" | "BLOCK";
  id: number;
  startDate: string;
  endDate: string;
  status: string;
  source: string | null;
  roomTypeId: number | null;
  roomUnitId: number | null;
  quantity: number;
  guestName: string | null;
  label: string;
};
type CalendarView = "week" | "fortnight" | "month";
type CalendarDensity = "compact" | "standard" | "comfortable";

const VIEW_LABELS: Array<{ value: CalendarView; label: string }> = [
  { value: "week", label: "Week" },
  { value: "fortnight", label: "14 days" },
  { value: "month", label: "Month" },
];
const CALENDAR_DENSITIES: Array<{ value: CalendarDensity; label: string; dayWidth: number; roomWidth: number; rowHeight: number }> = [
  { value: "compact", label: "Compact", dayWidth: 34, roomWidth: 150, rowHeight: 28 },
  { value: "standard", label: "Standard", dayWidth: 60, roomWidth: 190, rowHeight: 38 },
  { value: "comfortable", label: "Comfortable", dayWidth: 84, roomWidth: 220, rowHeight: 46 },
];
const WEEK_HEADER_THEMES = [
  { background: "bg-sky-50", accent: "bg-sky-300" },
  { background: "bg-amber-50", accent: "bg-amber-300" },
  { background: "bg-violet-50", accent: "bg-violet-300" },
  { background: "bg-teal-50", accent: "bg-teal-300" },
] as const;
const ROOM_TYPE_THEMES = [
  {
    start: "border-emerald-900 bg-emerald-950",
    line: "border-emerald-900 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-800",
    icon: "text-emerald-200",
  },
  {
    start: "border-indigo-900 bg-indigo-950",
    line: "border-indigo-900 bg-gradient-to-r from-indigo-950 via-indigo-900 to-blue-800",
    icon: "text-indigo-200",
  },
  {
    start: "border-amber-900 bg-amber-950",
    line: "border-amber-900 bg-gradient-to-r from-amber-950 via-amber-900 to-orange-800",
    icon: "text-amber-200",
  },
  {
    start: "border-yellow-900 bg-yellow-950",
    line: "border-yellow-900 bg-gradient-to-r from-yellow-950 via-yellow-900 to-lime-800",
    icon: "text-yellow-200",
  },
  {
    start: "border-cyan-900 bg-cyan-950",
    line: "border-cyan-900 bg-gradient-to-r from-cyan-950 via-cyan-900 to-sky-800",
    icon: "text-cyan-200",
  },
  {
    start: "border-violet-900 bg-violet-950",
    line: "border-violet-900 bg-gradient-to-r from-violet-950 via-violet-900 to-purple-800",
    icon: "text-violet-200",
  },
] as const;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekThemeIndex(date: Date): number {
  const utcDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const weekdayFromMonday = (new Date(utcDay).getUTCDay() + 6) % 7;
  const monday = utcDay - weekdayFromMonday * 24 * 60 * 60 * 1000;
  const absoluteWeek = Math.floor(monday / (7 * 24 * 60 * 60 * 1000));
  return ((absoluteWeek % WEEK_HEADER_THEMES.length) + WEEK_HEADER_THEMES.length) % WEEK_HEADER_THEMES.length;
}

function fmtRange(start: Date, end: Date, view: CalendarView): string {
  if (view === "month") {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const startLabel = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const endLabel = end.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(start.getFullYear() !== end.getFullYear() ? { year: "numeric" as const } : {}),
  });
  return `${startLabel} – ${endLabel} ${end.getFullYear()}`;
}

function cellStyle(entry: FeedEntry): string {
  if (entry.kind === "BOOKING") {
    if (entry.status === "CHECKED_IN") return "border-blue-700 bg-blue-600 text-white";
    if (entry.status === "CHECKED_OUT") return "border-red-300 bg-gradient-to-br from-red-50 to-rose-100 text-red-900";
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  if (entry.kind === "RESERVATION") {
    if (entry.status === "CHECKED_IN") return "border-emerald-800 bg-emerald-700 text-white";
    if (entry.status === "CHECKED_OUT") return "border-red-300 bg-gradient-to-br from-red-50 to-rose-100 text-red-900";
    if (entry.status === "HELD") return "border-dashed border-emerald-500 bg-white text-emerald-700";
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-600";
}

function formatRoomRate(type: FeedType): string {
  if (type.baseRate == null) return "No rate set";
  return `${type.currency} ${type.baseRate.toLocaleString()} / night`;
}

export default function NrmsCalendarPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [view, setView] = useState<CalendarView>("month");
  const [densityIndex, setDensityIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(() => dateKey(new Date()));
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [types, setTypes] = useState<FeedType[]>([]);
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const calendarScrollRef = useRef<HTMLDivElement | null>(null);
  const density = CALENDAR_DENSITIES[densityIndex];

  const rangeStart = useMemo(() => {
    if (view === "month") return new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    return startOfDay(anchorDate);
  }, [anchorDate, view]);

  const dayCount = useMemo(() => {
    if (view === "month") return new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0).getDate();
    return view === "fortnight" ? 14 : 7;
  }, [rangeStart, view]);

  const days = useMemo(() => Array.from({ length: dayCount }, (_, index) => addDays(rangeStart, index)), [dayCount, rangeStart]);
  const rangeEnd = useMemo(() => addDays(rangeStart, dayCount), [dayCount, rangeStart]);
  const lastDay = days[days.length - 1] ?? rangeStart;

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/calendar/${selectedPropertyId}`, {
        params: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() },
      });
      setTypes(response.data?.roomTypes ?? []);
      setEntries(response.data?.entries ?? []);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [rangeEnd, rangeStart, selectedPropertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const unitEntryFor = useCallback(
    (unitId: number, day: Date): FeedEntry | null => {
      const dayEnd = addDays(day, 1);
      return (
        entries.find(
          (entry) => entry.roomUnitId === unitId && new Date(entry.startDate) < dayEnd && new Date(entry.endDate) > day,
        ) ?? null
      );
    },
    [entries],
  );

  const unassigned = useMemo(() => entries.filter((entry) => entry.roomUnitId == null), [entries]);
  const unassignedFor = useCallback(
    (typeId: number | null, day: Date): FeedEntry | null => {
      const dayEnd = addDays(day, 1);
      return (
        unassigned.find(
          (entry) =>
            (entry.roomTypeId ?? null) === typeId &&
            new Date(entry.startDate) < dayEnd &&
            new Date(entry.endDate) > day,
        ) ?? null
      );
    },
    [unassigned],
  );

  const roomCount = useMemo(() => types.reduce((total, type) => total + type.units.length, 0), [types]);
  const hasPropertyWide = unassigned.some((entry) => entry.roomTypeId == null);
  const today = startOfDay(new Date());
  const currentDateKey = dateKey(today);

  useEffect(() => {
    const scroller = calendarScrollRef.current;
    if (!scroller || view !== "month") return;
    const todayIndex = days.findIndex((day) => dateKey(day) === currentDateKey);
    scroller.scrollLeft = todayIndex > 0 ? todayIndex * density.dayWidth : 0;
  }, [currentDateKey, days, density.dayWidth, loading, view]);

  const moveRange = (direction: -1 | 1) => {
    if (view === "month") {
      setAnchorDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
      return;
    }
    const distance = view === "fortnight" ? 14 : 7;
    setAnchorDate((current) => addDays(current, direction * distance));
  };

  const startReservation = (day: Date, roomTypeId?: number, roomUnitId?: number) => {
    if (startOfDay(day).getTime() < today.getTime()) return;
    const params = new URLSearchParams({ create: "1", checkIn: dateKey(day) });
    if (roomTypeId) params.set("roomTypeId", String(roomTypeId));
    if (roomUnitId) params.set("roomUnitId", String(roomUnitId));
    router.push(`/owner/nrms/reservations?${params.toString()}`);
  };

  if (!selectedPropertyId) {
    return <p className="py-10 text-center text-sm text-neutral-500">Add a property first to see the calendar.</p>;
  }

  return (
    <div className="min-w-0 space-y-3 pb-6">
      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-30px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-3 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="Previous date range"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950"
              onClick={() => moveRange(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 px-1" aria-live="polite">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Room calendar</p>
              <h2 className="mb-0 mt-0.5 truncate text-base font-bold text-neutral-950 sm:text-lg">{fmtRange(rangeStart, lastDay, view)}</h2>
            </div>
            <button
              type="button"
              aria-label="Next date range"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950"
              onClick={() => moveRange(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="ml-1 min-h-9 rounded-lg px-3 text-xs font-semibold text-emerald-700 no-underline transition hover:bg-emerald-50 hover:no-underline"
              onClick={() => {
                const current = startOfDay(new Date());
                setAnchorDate(current);
                setSelectedDate(dateKey(current));
              }}
            >
              Today
            </button>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
            <div className="flex min-w-0 flex-1 rounded-xl bg-neutral-100 p-1 sm:flex-none" aria-label="Calendar range">
              {VIEW_LABELS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  aria-pressed={view === option.value}
                  onClick={() => setView(option.value)}
                  className={`min-h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-bold transition sm:flex-none ${
                    view === option.value
                      ? "bg-white text-emerald-700 shadow-sm ring-1 ring-black/5"
                      : "text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex h-10 items-center rounded-lg border border-neutral-200 bg-white p-1 shadow-sm" aria-label="Calendar zoom">
              <button type="button" onClick={() => setDensityIndex((current) => Math.max(0, current - 1))} disabled={densityIndex === 0} className="flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-200" aria-label="Zoom calendar out"><ZoomOut className="h-3.5 w-3.5" /></button>
              <span className="min-w-[68px] px-1 text-center text-[9px] font-bold uppercase tracking-wide text-neutral-500">{density.label}</span>
              <button type="button" onClick={() => setDensityIndex((current) => Math.min(CALENDAR_DENSITIES.length - 1, current + 1))} disabled={densityIndex === CALENDAR_DENSITIES.length - 1} className="flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-200" aria-label="Zoom calendar in"><ZoomIn className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50/60 px-3 py-2">
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-neutral-400" /> {roomCount} rooms</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-neutral-400" /> {entries.length} calendar items</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-500" aria-label="Calendar legend">
            <Legend color="bg-blue-500" label="NoLSAF" />
            <Legend color="bg-emerald-500" label="External" />
            <Legend color="bg-neutral-400" label="Block" />
            <span className="hidden h-4 w-px bg-neutral-200 sm:block" aria-hidden="true" />
            <StatusLegend status="CHECKED_IN" label="Checked in" />
            <StatusLegend status="CHECKED_OUT" label="Checked out" />
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-30px_rgba(15,23,42,0.35)]">
        <div ref={calendarScrollRef} className="relative min-h-[320px] max-h-[calc(100dvh-14rem)] overflow-auto">
          {loading && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-500 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-700" /> Loading calendar
              </div>
            </div>
          )}

          <table className="w-full table-fixed border-separate border-spacing-0 text-xs" style={{ minWidth: density.roomWidth + days.length * density.dayWidth }}>
            <thead className="sticky top-0 z-30">
              <tr>
                <th className="sticky left-0 z-40 border-b border-r border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500" style={{ width: density.roomWidth }}>
                  Room
                </th>
                {days.map((day) => {
                  const isToday = sameDay(day, today);
                  const isSelected = dateKey(day) === selectedDate;
                  const weekTheme = WEEK_HEADER_THEMES[weekThemeIndex(day)];
                  return (
                    <th
                      key={day.getTime()}
                      className={`border-b border-r border-neutral-200 p-0.5 text-center font-medium ${
                        isSelected ? "bg-emerald-100" : isToday ? "bg-emerald-50" : weekTheme.background
                      }`}
                      style={{ width: density.dayWidth }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedDate(dateKey(day))}
                        aria-label={`Select ${day.toLocaleDateString()}`}
                        aria-pressed={isSelected}
                        className={`relative flex w-full flex-col items-center justify-center overflow-hidden rounded-md transition ${
                          isSelected ? "bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-200" : "hover:bg-white/80"
                        }`}
                        style={{ minHeight: density.value === "compact" ? 30 : density.value === "standard" ? 36 : 40 }}
                      >
                        {!isSelected && !isToday && <span className={`absolute inset-x-2 top-0 h-0.5 rounded-full ${weekTheme.accent}`} />}
                        <span className={`block text-[9px] uppercase tracking-wide ${isToday || isSelected ? "text-emerald-700" : "text-neutral-400"}`}>
                          {day.toLocaleDateString(undefined, { weekday: "short" })}
                        </span>
                        <span className={`inline-flex items-center justify-center rounded-full px-1 font-bold ${density.value === "compact" ? "h-4 min-w-4 text-[9px]" : "h-6 min-w-6 text-xs"} ${
                          isToday ? "bg-emerald-700 text-white" : "text-neutral-700"
                        }`}>
                          {day.getDate()}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {types.map((type, typeIndex) => (
                <CalendarTypeRows
                  key={type.id}
                  type={type}
                  themeIndex={typeIndex}
                  density={density}
                  days={days}
                  today={today}
                  selectedDate={selectedDate}
                  selectedUnitId={selectedUnitId}
                  onSelectRoom={setSelectedUnitId}
                  onCreateReservation={startReservation}
                  unitEntryFor={unitEntryFor}
                  unassignedFor={unassignedFor}
                />
              ))}

              {roomCount === 0 && (
                <tr>
                  <td className="sticky left-0 z-20 border-b border-r border-neutral-200 bg-white px-4 py-4 font-semibold text-neutral-600">
                    No rooms yet
                  </td>
                  {days.map((day) => (
                    <td key={day.getTime()} className={`border-b border-r border-neutral-100 ${sameDay(day, today) ? "bg-emerald-50/35" : "bg-white"}`} style={{ height: density.rowHeight }} />
                  ))}
                </tr>
              )}

              {hasPropertyWide && (
                <CalendarEntryRow
                  label="Unassigned"
                  days={days}
                  today={today}
                  selectedDate={selectedDate}
                  density={density}
                  onCreateReservation={(day) => startReservation(day)}
                  entryFor={(day) => unassignedFor(null, day)}
                  muted
                />
              )}
            </tbody>
          </table>
        </div>

        {roomCount === 0 && !loading && (
          <div className="flex flex-col gap-3 border-t border-neutral-200 bg-amber-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-neutral-900">Add your physical rooms to start using the calendar</p>
              <p className="mt-0.5 text-xs text-neutral-600">The full date grid is ready. Room rows will appear here as soon as inventory is configured.</p>
            </div>
            <Link
              href="/owner/nrms/rooms"
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white no-underline transition hover:bg-emerald-800 hover:no-underline"
            >
              <Plus className="h-4 w-4" /> Set up rooms
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function StatusLegend({ status, label }: { status: "CHECKED_IN" | "CHECKED_OUT"; label: string }) {
  const checkedIn = status === "CHECKED_IN";
  const Icon = checkedIn ? LogIn : LogOut;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-semibold ${
        checkedIn
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function EntryStatusMark({ status }: { status: string }) {
  if (status !== "CHECKED_IN" && status !== "CHECKED_OUT") return null;
  const checkedIn = status === "CHECKED_IN";
  const Icon = checkedIn ? LogIn : LogOut;
  return (
    <span
      className={`absolute left-1 top-1 inline-flex h-3.5 shrink-0 items-center gap-0.5 rounded px-1 text-[7px] font-black uppercase leading-none tracking-wide shadow-sm ${
        checkedIn
          ? "bg-emerald-700 text-white"
          : "bg-red-600 text-white"
      }`}
    >
      <Icon className="h-2 w-2" />
      {checkedIn ? "IN" : "OUT"}
    </span>
  );
}

function CalendarTypeRows({
  type,
  themeIndex,
  density,
  days,
  today,
  selectedDate,
  selectedUnitId,
  onSelectRoom,
  onCreateReservation,
  unitEntryFor,
  unassignedFor,
}: {
  type: FeedType;
  themeIndex: number;
  density: (typeof CALENDAR_DENSITIES)[number];
  days: Date[];
  today: Date;
  selectedDate: string;
  selectedUnitId: number | null;
  onSelectRoom: (unitId: number | null) => void;
  onCreateReservation: (day: Date, roomTypeId?: number, roomUnitId?: number) => void;
  unitEntryFor: (unitId: number, day: Date) => FeedEntry | null;
  unassignedFor: (typeId: number | null, day: Date) => FeedEntry | null;
}) {
  const hasTypeLevel = days.some((day) => unassignedFor(type.id, day));
  const theme = ROOM_TYPE_THEMES[themeIndex % ROOM_TYPE_THEMES.length];
  return (
    <>
      <tr>
        <td
          className={`sticky left-0 z-20 border-b px-3 text-white ${theme.start}`}
          style={{ width: density.roomWidth, height: density.value === "compact" ? 28 : 36 }}
        >
          <span className="flex w-full items-center gap-2 overflow-hidden">
            <BedDouble className={`h-4 w-4 shrink-0 ${theme.icon}`} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em]">{type.name}</span>
                <span className="ml-auto shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                  {type.units.length} {type.units.length === 1 ? "room" : "rooms"}
                </span>
              </span>
              {density.value !== "compact" && <span className="mt-0.5 block truncate text-[9px] font-semibold text-white/65">{formatRoomRate(type)}</span>}
            </span>
          </span>
        </td>
        <td
          colSpan={days.length}
          className="border-b border-neutral-200 bg-neutral-50"
        />
      </tr>

      {type.units.map((unit) => (
        <CalendarEntryRow
          key={unit.id}
          label={unit.code}
          detail={unit.floor != null ? (unit.floor === 0 ? "Floor G" : `Floor ${unit.floor}`) : undefined}
          status={unit.status}
          roomTypeId={type.id}
          roomUnitId={unit.id}
          density={density}
          days={days}
          today={today}
          selectedDate={selectedDate}
          selectedUnitId={selectedUnitId}
          onSelectRoom={onSelectRoom}
          onCreateReservation={onCreateReservation}
          entryFor={(day) => unitEntryFor(unit.id, day)}
        />
      ))}

      {hasTypeLevel && (
        <CalendarEntryRow
          label={`Any ${type.name}`}
          roomTypeId={type.id}
          density={density}
          days={days}
          today={today}
          selectedDate={selectedDate}
          selectedUnitId={selectedUnitId}
          onSelectRoom={onSelectRoom}
          onCreateReservation={onCreateReservation}
          entryFor={(day) => unassignedFor(type.id, day)}
          muted
        />
      )}
    </>
  );
}

function CalendarEntryRow({
  label,
  detail,
  status,
  density,
  roomTypeId,
  roomUnitId,
  days,
  today,
  selectedDate,
  selectedUnitId,
  onSelectRoom,
  onCreateReservation,
  entryFor,
  muted = false,
}: {
  label: string;
  detail?: string;
  status?: string;
  density: (typeof CALENDAR_DENSITIES)[number];
  roomTypeId?: number;
  roomUnitId?: number;
  days: Date[];
  today: Date;
  selectedDate: string;
  selectedUnitId?: number | null;
  onSelectRoom?: (unitId: number | null) => void;
  onCreateReservation: (day: Date, roomTypeId?: number, roomUnitId?: number) => void;
  entryFor: (day: Date) => FeedEntry | null;
  muted?: boolean;
}) {
  const roomSelected = roomUnitId != null && selectedUnitId === roomUnitId;

  return (
    <tr className={roomSelected ? "bg-emerald-50/40" : undefined}>
      <td className={`sticky left-0 z-20 border-b border-r border-neutral-200 p-0.5 ${roomSelected ? "bg-emerald-50" : "bg-white"}`} style={{ height: density.rowHeight, width: density.roomWidth }}>
        {roomUnitId != null ? (
          <button
            type="button"
            onClick={() => onSelectRoom?.(roomSelected ? null : roomUnitId)}
            aria-pressed={roomSelected}
            className={`flex h-full w-full min-w-0 items-center rounded-md px-2 text-left transition ${density.value === "compact" ? "gap-1.5" : "gap-2"} ${
              roomSelected ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200" : "hover:bg-neutral-50"
            }`}
          >
            <span className={`flex shrink-0 items-center justify-center rounded-md ${density.value === "compact" ? "h-5 w-5" : "h-7 w-7"} ${roomSelected ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}>
              <BedDouble className={density.value === "compact" ? "h-3 w-3" : "h-3.5 w-3.5"} />
            </span>
            <span className="min-w-0">
              <span className={`block truncate font-bold ${density.value === "compact" ? "text-[9px]" : "text-[11px]"}`}>{label}</span>
              {detail && density.value !== "compact" && <span className="block truncate text-[9px] text-neutral-400">{detail}</span>}
              {status && status !== "ACTIVE" && <span className="mt-0.5 block text-[9px] font-semibold uppercase text-amber-600">{status.replace(/_/g, " ")}</span>}
            </span>
          </button>
        ) : (
          <div className="flex h-full items-center px-2">
            <p className={`truncate text-xs font-bold ${muted ? "italic text-neutral-500" : "text-neutral-800"}`}>{label}</p>
          </div>
        )}
      </td>
      {days.map((day, dayIndex) => {
        const entry = entryFor(day);
        const previousEntry = entry ? entryFor(addDays(day, -1)) : null;
        const nextEntry = entry ? entryFor(addDays(day, 1)) : null;
        const continuesBefore = Boolean(dayIndex > 0 && entry && previousEntry && entry.kind === previousEntry.kind && entry.id === previousEntry.id);
        const continuesAfter = Boolean(entry && nextEntry && entry.kind === nextEntry.kind && entry.id === nextEntry.id);
        const dateSelected = dateKey(day) === selectedDate;
        const pastDate = startOfDay(day).getTime() < today.getTime();
        return (
          <td
            key={day.getTime()}
            className={`border-b border-r border-neutral-100 p-0 align-middle ${
              dateSelected || roomSelected ? "bg-emerald-50/50" : sameDay(day, today) ? "bg-emerald-50/25" : "bg-white"
            }`}
            style={{ height: density.rowHeight }}
          >
            {entry ? (
              <div
                className={`relative mx-0 flex items-center overflow-hidden border font-semibold leading-tight shadow-sm ${density.value === "compact" ? "min-h-6 px-1 text-[7px]" : "min-h-9 px-2 py-1 text-[9px]"} ${
                  continuesBefore ? "rounded-l-none border-l-0" : "ml-1 rounded-l-lg"
                } ${continuesAfter ? "rounded-r-none border-r-0" : "mr-1 rounded-r-lg"} ${cellStyle(entry)}`}
                title={`${entry.label} (${entry.status.toLowerCase().replace(/_/g, " ")})`}
              >
                {!continuesBefore && (
                  <>
                    <EntryStatusMark status={entry.status} />
                    <span className={entry.status === "CHECKED_IN" || entry.status === "CHECKED_OUT" ? "mt-3 block w-full truncate font-bold" : "line-clamp-2 break-words"}>{entry.guestName || entry.label}</span>
                  </>
                )}
              </div>
            ) : pastDate ? (
              <div className="flex h-full w-full items-center justify-center bg-neutral-50/60" style={{ minHeight: density.rowHeight }} title="Past dates are read-only">
                <span className={`${density.value === "compact" ? "h-0.5 w-3" : "h-1 w-5"} rounded-full bg-neutral-200`} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onCreateReservation(day, roomTypeId, roomUnitId)}
                aria-label={`Create reservation for ${label} on ${day.toLocaleDateString()}`}
                className="group flex h-full w-full items-center justify-center text-emerald-700 transition hover:bg-emerald-100/60 focus-visible:bg-emerald-100/60 focus-visible:outline-none"
                style={{ minHeight: density.rowHeight }}
              >
                <span className={`flex items-center justify-center rounded-full border border-dashed border-emerald-300 bg-white text-emerald-600 transition group-hover:scale-105 group-hover:border-emerald-500 group-hover:bg-emerald-700 group-hover:text-white ${density.value === "compact" ? "h-4 w-4" : "h-6 w-6"} ${
                  dateSelected || roomSelected ? "opacity-100" : "opacity-20 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100"
                }`}>
                  <Plus className={density.value === "compact" ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
                </span>
              </button>
            )}
          </td>
        );
      })}
    </tr>
  );
}
