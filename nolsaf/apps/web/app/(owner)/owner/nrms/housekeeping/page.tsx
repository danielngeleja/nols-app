"use client";

// NRMS housekeeping board: live room cleanliness per property with the task
// queue. Works for OWNER, MANAGER and FRONT_DESK (full control) and for
// HOUSEKEEPER staff (work tasks, mark rooms clean; inspection stays with the
// front desk or a manager).

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  ArrowRight,
  BedDouble,
  BrushCleaning,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type HkTask = {
  id: number;
  roomUnitId: number;
  roomCode?: string;
  roomTypeName?: string;
  type: string;
  status: string;
  priority: string;
  note: string | null;
  assignedTo: { id: number; name: string } | null;
  completedBy: { id: number; name: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type HkRoom = {
  id: number;
  code: string;
  floor: number | null;
  status: string;
  housekeepingStatus: string;
  housekeepingUpdatedAt: string | null;
  roomType: { id: number; name: string };
  occupant: { reservationId: number; guestName: string; checkIn: string; checkOut: string } | null;
  arrival: { reservationId: number; guestName: string } | null;
  openTasks: HkTask[];
};

type Board = {
  access: { role: string };
  counts: Record<string, number>;
  businessDate: string;
  settings: { dailyServiceEnabled: boolean; dailyServiceTime: string; timezone: string; nextDailyServiceAt: string };
  rooms: HkRoom[];
  recentDone: HkTask[];
  housekeepers: Array<{ id: number; name: string }>;
};

const STATUS_META: Record<string, { label: string; helper: string; chip: string; dot: string; accent: string; active: string }> = {
  DIRTY: { label: "Dirty", helper: "Waiting to be cleaned", chip: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500", accent: "border-l-red-400", active: "border-red-300 bg-red-50/70 ring-red-500/10" },
  IN_PROGRESS: { label: "Cleaning", helper: "Work is underway", chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500", accent: "border-l-amber-400", active: "border-amber-300 bg-amber-50/70 ring-amber-500/10" },
  CLEAN: { label: "Clean", helper: "Ready for inspection", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", accent: "border-l-emerald-400", active: "border-emerald-300 bg-emerald-50/70 ring-emerald-500/10" },
  INSPECTED: { label: "Inspected", helper: "Ready for guests", chip: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500", accent: "border-l-sky-400", active: "border-sky-300 bg-sky-50/70 ring-sky-500/10" },
  OUT_OF_SERVICE: { label: "Out of service", helper: "Unavailable inventory", chip: "bg-neutral-100 text-neutral-500 border-neutral-200", dot: "bg-neutral-400", accent: "border-l-neutral-300", active: "border-neutral-400 bg-neutral-100 ring-neutral-500/10" },
  OCCUPIED: { label: "Occupied", helper: "Guests currently in house", chip: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500", accent: "border-l-violet-400", active: "border-violet-300 bg-violet-50/70 ring-violet-500/10" },
};

const STATUS_ORDER = ["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED", "OUT_OF_SERVICE"] as const;
const ROOM_FLOW = ["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED"] as const;

function floorLabel(floor: number | null): string {
  if (floor == null) return "Floor not set";
  if (floor === 0) return "Ground floor";
  return `Floor ${floor}`;
}

const TASK_TYPE_LABEL: Record<string, string> = {
  TURNOVER: "Turnover clean",
  DAILY_CLEAN: "Daily clean",
  DEEP_CLEAN: "Deep clean",
  MAINTENANCE: "Maintenance",
};

const TASK_TYPE_HELP: Record<string, string> = {
  TURNOVER: "Full room reset after checkout",
  DAILY_CLEAN: "Routine refresh for an occupied room",
  DEEP_CLEAN: "Detailed top-to-bottom room clean",
  MAINTENANCE: "Repair or technical attention required",
};

type RoomFilter = "ALL" | (typeof ROOM_FLOW)[number] | "OUT_OF_SERVICE" | "OCCUPIED";

function roomStatusKey(room: HkRoom): string {
  return room.status !== "ACTIVE" ? "OUT_OF_SERVICE" : room.housekeepingStatus;
}

function housekeepingDate(value?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(value ? new Date(value) : new Date());
}

function shortStayDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" }).format(new Date(value));
}

export default function NrmsHousekeepingPage() {
  const { selectedPropertyId } = useNrms();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoomFilter>("ALL");
  const [taskRoom, setTaskRoom] = useState<HkRoom | null>(null);
  const [taskType, setTaskType] = useState("DAILY_CLEAN");
  const [taskPriority, setTaskPriority] = useState("NORMAL");
  const [taskAssignee, setTaskAssignee] = useState<number | "">("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dailyServiceEnabled, setDailyServiceEnabled] = useState(true);
  const [dailyServiceTime, setDailyServiceTime] = useState("11:00");

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<Board>(`/api/nrms/operations/property/${selectedPropertyId}/housekeeping`);
      setBoard(response.data);
      setDailyServiceEnabled(response.data.settings.dailyServiceEnabled);
      setDailyServiceTime(response.data.settings.dailyServiceTime);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load the housekeeping board");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load]);

  const role = board?.access.role ?? "HOUSEKEEPER";
  const canManage = ["OWNER", "MANAGER", "FRONT_DESK"].includes(role);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Action failed");
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const setRoomStatus = (room: HkRoom, status: string) =>
    run(`room-${room.id}`, () => apiClient.post(`/api/nrms/operations/rooms/${room.id}/housekeeping-status`, { status }));

  const advanceTask = (task: HkTask, action: "START" | "COMPLETE" | "CANCEL") =>
    run(`task-${task.id}`, () => apiClient.post(`/api/nrms/operations/housekeeping/tasks/${task.id}/advance`, { action }));

  const assignTask = (task: HkTask, assignedToId: number | null) =>
    run(`task-${task.id}`, () => apiClient.post(`/api/nrms/operations/housekeeping/tasks/${task.id}/assign`, { assignedToId }));

  const closeTaskComposer = () => {
    setTaskRoom(null);
    setTaskAssignee("");
    setTaskType("DAILY_CLEAN");
    setTaskPriority("NORMAL");
  };

  const createTask = async () => {
    if (!selectedPropertyId || !taskRoom) return;
    const created = await run("create-task", () => apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/housekeeping/tasks`, {
      roomUnitId: taskRoom.id,
      type: taskType,
      priority: taskPriority,
      note: null,
      assignedToId: taskAssignee === "" ? null : taskAssignee,
    }));
    if (created) closeTaskComposer();
  };

  const saveHousekeepingSettings = async () => {
    if (!selectedPropertyId) return;
    const saved = await run("housekeeping-settings", () => apiClient.put(`/api/nrms/operations/property/${selectedPropertyId}/housekeeping/settings`, {
      dailyServiceEnabled,
      dailyServiceTime,
    }));
    if (saved) setSettingsOpen(false);
  };

  const closeHousekeepingSettings = () => {
    setSettingsOpen(false);
    if (board) {
      setDailyServiceEnabled(board.settings.dailyServiceEnabled);
      setDailyServiceTime(board.settings.dailyServiceTime);
    }
  };

  const rooms = useMemo(() => {
    const list = board?.rooms ?? [];
    if (filter === "ALL") return list;
    if (filter === "OCCUPIED") return list.filter((room) => room.occupant != null);
    return list.filter((room) => roomStatusKey(room) === filter);
  }, [board, filter]);

  const openTasks = useMemo(
    () => (board?.rooms ?? []).flatMap((room) => room.openTasks).sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "HIGH" ? -1 : 1)),
    [board],
  );

  const floorGroups = useMemo(() => {
    const groups = new Map<string, { label: string; order: number; rooms: HkRoom[] }>();
    for (const room of rooms) {
      const key = room.floor == null ? "none" : String(room.floor);
      if (!groups.has(key)) groups.set(key, { label: floorLabel(room.floor), order: room.floor == null ? Number.MAX_SAFE_INTEGER : room.floor, rooms: [] });
      groups.get(key)!.rooms.push(room);
    }
    for (const group of groups.values()) {
      group.rooms.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [rooms]);

  if (!selectedPropertyId) {
    return <p className="py-10 text-center text-sm text-neutral-500">Add a property first to use housekeeping.</p>;
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Room operations</p>
          <h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Housekeeping</h2>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Checkout rooms enter turnover immediately. Occupied rooms follow the configured daily cleaning cycle.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CalendarDays className="h-3.5 w-3.5" /></span>
            <span><span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Today</span><span className="mt-0.5 block text-[11px] font-bold text-neutral-700">{housekeepingDate(board?.businessDate)}</span></span>
          </div>
          {canManage && board && (
            <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex appearance-none items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/50">
              <Settings2 className="h-4 w-4 text-emerald-700" />
              <span><span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Occupied-room cycle</span><span className="mt-0.5 block text-[11px] font-bold text-neutral-700">{board.settings.dailyServiceEnabled ? `Daily at ${board.settings.dailyServiceTime}` : "Daily cleaning off"}</span></span>
            </button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading || !board ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-400"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>
      ) : (
        <>
          <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-100 px-4 py-3.5 sm:px-5">
              <div>
                <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-950"><Sparkles className="h-4 w-4 text-emerald-700" />Room readiness flow</h3>
                <p className="mb-0 mt-1 text-[11px] text-neutral-500">Follow each room from checkout through guest-ready inspection.</p>
              </div>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold text-neutral-500">Select a stage to filter</span>
            </div>

            <div className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4 lg:gap-6">
              {ROOM_FLOW.map((key, index) => (
                <div key={key} className="relative">
                  <button
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(filter === key ? "ALL" : key)}
                    className={`group w-full appearance-none rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm ${filter === key ? `${STATUS_META[key].active} ring-2` : "border-neutral-200 bg-white"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white ${STATUS_META[key].dot}`}>{index + 1}</span>
                        {STATUS_META[key].label}
                      </span>
                      <span className="text-xl font-bold tabular-nums text-neutral-950">{board.counts[key] ?? 0}</span>
                    </span>
                    <span className="mt-2 block border-t border-neutral-100 pt-2 text-[10px] font-medium text-neutral-400">{STATUS_META[key].helper}</span>
                  </button>
                  {index < ROOM_FLOW.length - 1 && <ArrowRight className="absolute -right-5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-neutral-300 lg:block" aria-hidden="true" />}
                </div>
              ))}
            </div>

            <div className="grid border-t border-neutral-100 bg-neutral-50/60 sm:grid-cols-3 sm:divide-x sm:divide-neutral-200">
              <button
                type="button"
                aria-pressed={filter === "OCCUPIED"}
                onClick={() => setFilter(filter === "OCCUPIED" ? "ALL" : "OCCUPIED")}
                className={`flex appearance-none items-center justify-between gap-3 border-0 px-4 py-3 text-left transition hover:bg-violet-50 sm:px-5 ${filter === "OCCUPIED" ? "bg-violet-50" : "bg-transparent"}`}
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700"><UserRound className="h-4 w-4" /></span>
                  <span><span className="block text-xs font-bold text-neutral-800">Occupied rooms</span><span className="mt-0.5 block text-[10px] text-neutral-400">Included in the daily clean cycle</span></span>
                </span>
                <span className="text-lg font-bold tabular-nums text-neutral-800">{board.counts.OCCUPIED ?? 0}</span>
              </button>
              <button
                type="button"
                aria-pressed={filter === "OUT_OF_SERVICE"}
                onClick={() => setFilter(filter === "OUT_OF_SERVICE" ? "ALL" : "OUT_OF_SERVICE")}
                className={`flex appearance-none items-center justify-between gap-3 border-0 border-t border-neutral-200 px-4 py-3 text-left transition hover:bg-neutral-100 sm:border-t-0 sm:px-5 ${filter === "OUT_OF_SERVICE" ? "bg-neutral-100" : "bg-transparent"}`}
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500"><Wrench className="h-4 w-4" /></span>
                  <span><span className="block text-xs font-bold text-neutral-800">Out of service</span><span className="mt-0.5 block text-[10px] text-neutral-400">Separate from the cleaning flow</span></span>
                </span>
                <span className="text-lg font-bold tabular-nums text-neutral-800">{board.counts.OUT_OF_SERVICE ?? 0}</span>
              </button>
              <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 sm:border-t-0 sm:px-5">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-200 bg-white text-emerald-700"><ClipboardList className="h-4 w-4" /></span>
                  <span><span className="block text-xs font-bold text-neutral-800">Open tasks</span><span className="mt-0.5 block text-[10px] text-neutral-400">Assignments managed below</span></span>
                </span>
                <span className="text-lg font-bold tabular-nums text-neutral-800">{board.counts.openTasks ?? 0}</span>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-950"><BedDouble className="h-4 w-4 text-emerald-700" />Rooms{filter !== "ALL" && <span className="text-xs font-semibold text-neutral-400">({STATUS_META[filter]?.label})</span>}</h3>
              {filter !== "ALL" && (
                <button type="button" onClick={() => setFilter("ALL")} className="appearance-none rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-100">Show all rooms</button>
              )}
            </div>
            {rooms.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">No rooms in this state.</p>
            ) : (
              <div className="space-y-6">
                {floorGroups.map((group) => {
                  const groupCounts: Record<string, number> = {};
                  for (const room of group.rooms) {
                    const key = roomStatusKey(room);
                    groupCounts[key] = (groupCounts[key] ?? 0) + 1;
                  }
                  return (
                    <section key={group.label} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.06)] ring-1 ring-neutral-950/[0.02]">
                      <header className="relative flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 bg-gradient-to-r from-white via-white to-emerald-50/50 px-4 py-4 sm:px-5">
                        <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-emerald-600" aria-hidden="true" />
                        <h4 className="m-0 flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]"><Building2 className="h-[18px] w-[18px]" /></span>
                          <span>
                            <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-700">Floor zone</span>
                            <span className="mt-0.5 block text-base font-bold tracking-tight text-neutral-950">{group.label}</span>
                          </span>
                        </h4>
                        <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-bold text-neutral-500 shadow-sm">{group.rooms.length} {group.rooms.length === 1 ? "room" : "rooms"}</span>
                        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                          {STATUS_ORDER.filter((key) => groupCounts[key]).map((key) => (
                            <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-bold text-neutral-600 shadow-sm">
                              <span className={`h-1.5 w-1.5 rounded-full ring-2 ring-white ${STATUS_META[key].dot}`} />{groupCounts[key]} {STATUS_META[key].label.toLowerCase()}
                            </span>
                          ))}
                        </span>
                      </header>
                      <div className="p-3 sm:p-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {group.rooms.map((room) => {
                          const statusKey = roomStatusKey(room);
                          const meta = STATUS_META[statusKey] ?? STATUS_META.CLEAN;
                          const busy = busyKey === `room-${room.id}`;
                          const outOfService = room.status !== "ACTIVE";
                          const flowIndex = ROOM_FLOW.indexOf(room.housekeepingStatus as (typeof ROOM_FLOW)[number]);
                          return (
                            <article key={room.id} className={`overflow-hidden rounded-2xl border border-l-4 border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-neutral-300 hover:shadow-md ${meta.accent}`}>
                              <div className="p-3.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="m-0 truncate text-sm font-bold tracking-tight text-neutral-950">{room.code}</p>
                                    <p className="mb-0 mt-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-neutral-400">{room.roomType.name}</p>
                                  </div>
                                  <span className="flex shrink-0 flex-col items-end gap-1">
                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}</span>
                                    {room.occupant && <span className="inline-flex items-center gap-1 rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700"><UserRound className="h-2.5 w-2.5" />Occupied</span>}
                                  </span>
                                </div>

                              {!outOfService && (
                                <div className="mt-3" aria-label={`Room readiness: ${meta.label}`}>
                                  <div className="flex items-center gap-1">
                                    {ROOM_FLOW.map((key, index) => (
                                      <div key={key} className="flex flex-1 items-center gap-1 last:flex-none">
                                        <span className={`h-2 w-2 shrink-0 rounded-full ring-2 ring-white ${index <= flowIndex ? STATUS_META[key].dot : "bg-neutral-200"}`} />
                                        {index < ROOM_FLOW.length - 1 && <span className={`h-px flex-1 ${index < flowIndex ? "bg-emerald-300" : "bg-neutral-200"}`} />}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="mt-1.5 flex items-center justify-between text-[9px] font-medium text-neutral-400">
                                    <span>Needs service</span>
                                    <span>Guest ready</span>
                                  </div>
                                </div>
                              )}

                              {(room.occupant || room.arrival || room.openTasks.length > 0) && (
                                <div className="mt-2 space-y-1 border-t border-dashed border-neutral-100 pt-2">
                                  {room.occupant && <p className="m-0 flex items-center gap-1.5 truncate rounded-lg bg-violet-50/70 px-2 py-1 text-[11px] font-semibold text-violet-800" title={`${room.occupant.guestName} · departure ${shortStayDate(room.occupant.checkOut)}`}><UserRound className="h-3 w-3 shrink-0 text-violet-500" />{room.occupant.guestName}<span className="font-medium text-violet-500">· departs {shortStayDate(room.occupant.checkOut)}</span></p>}
                                  {room.arrival && <p className="m-0 flex items-center gap-1.5 truncate text-[11px] font-semibold text-emerald-700"><Sparkles className="h-3 w-3 shrink-0" />Arriving today: {room.arrival.guestName}</p>}
                                  {room.openTasks.map((task) => (
                                    <p key={task.id} className="m-0 flex items-center gap-1.5 truncate text-[11px] text-neutral-500">
                                      {task.type === "MAINTENANCE" ? <Wrench className="h-3 w-3 shrink-0 text-neutral-400" /> : <BrushCleaning className="h-3 w-3 shrink-0 text-neutral-400" />}
                                      {TASK_TYPE_LABEL[task.type] ?? task.type}{task.assignedTo ? ` · ${task.assignedTo.name}` : ""}{task.priority === "HIGH" ? " · urgent" : ""}
                                    </p>
                                  ))}
                                </div>
                              )}

                              </div>

                              {!outOfService && (
                                <div className="border-t border-neutral-100 bg-neutral-50/60 px-3.5 py-3">
                                  <p className="m-0 mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Next in room flow</p>
                                  {room.housekeepingStatus === "DIRTY" && (
                                    <button type="button" disabled={busy} onClick={() => setRoomStatus(room, "IN_PROGRESS")} className="inline-flex w-full appearance-none items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrushCleaning className="h-3.5 w-3.5" />}Start cleaning<ArrowRight className="h-3.5 w-3.5" /></button>
                                  )}
                                  {room.housekeepingStatus === "IN_PROGRESS" && (
                                    <button type="button" disabled={busy} onClick={() => setRoomStatus(room, "CLEAN")} className="inline-flex w-full appearance-none items-center justify-center gap-1.5 rounded-xl border-0 bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Mark as clean<ArrowRight className="h-3.5 w-3.5" /></button>
                                  )}
                                  {room.housekeepingStatus === "CLEAN" && canManage && (
                                    <button type="button" disabled={busy} onClick={() => setRoomStatus(room, "INSPECTED")} className="inline-flex w-full appearance-none items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}Confirm inspection<ArrowRight className="h-3.5 w-3.5" /></button>
                                  )}
                                  {room.housekeepingStatus === "CLEAN" && !canManage && (
                                    <div className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Awaiting manager inspection</div>
                                  )}
                                  {room.housekeepingStatus === "INSPECTED" && (
                                    <div className="flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-700"><ShieldCheck className="h-3.5 w-3.5" />Room is guest ready</div>
                                  )}

                                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-neutral-200 pt-2.5">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Other actions</span>
                                    <span className="flex flex-wrap justify-end gap-1.5">
                                      {room.housekeepingStatus === "DIRTY" && (
                                        <button type="button" disabled={busy} onClick={() => setRoomStatus(room, "CLEAN")} className="appearance-none rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-50">Skip to clean</button>
                                      )}
                                      {["CLEAN", "INSPECTED"].includes(room.housekeepingStatus) && (
                                        <button type="button" disabled={busy} onClick={() => setRoomStatus(room, "DIRTY")} className="inline-flex appearance-none items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-neutral-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"><RotateCcw className="h-3 w-3" />Mark dirty</button>
                                      )}
                                      {canManage && (
                                        <button type="button" disabled={busy} onClick={() => setTaskRoom(room)} className="inline-flex appearance-none items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"><Plus className="h-3 w-3" />New task</button>
                                      )}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </article>
                          );
                        })}
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-neutral-200 bg-white p-4 sm:p-5">
              <h3 className="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-neutral-950"><ClipboardList className="h-4 w-4 text-emerald-700" />Task queue</h3>
              {openTasks.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-400">No open housekeeping tasks. All caught up.</p>
              ) : (
                <div className="space-y-2">
                  {openTasks.map((task) => {
                    const busy = busyKey === `task-${task.id}`;
                    return (
                      <div key={task.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-xs font-bold text-neutral-900">{task.roomCode ?? `Room #${task.roomUnitId}`} · {TASK_TYPE_LABEL[task.type] ?? task.type}{task.priority === "HIGH" && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">URGENT</span>}</p>
                          <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">{task.status === "IN_PROGRESS" ? "In progress" : "Waiting"}{task.note ? ` · ${task.note}` : ""}</p>
                        </div>
                        {canManage && board.housekeepers.length > 0 && (
                          <select value={task.assignedTo?.id ?? ""} disabled={busy} onChange={(event) => void assignTask(task, event.target.value === "" ? null : Number(event.target.value))} className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-700 outline-none" aria-label="Assign housekeeper">
                            <option value="">Unassigned</option>
                            {board.housekeepers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                          </select>
                        )}
                        {!canManage && task.assignedTo && <span className="text-[11px] font-semibold text-neutral-500">{task.assignedTo.name}</span>}
                        {task.status === "OPEN" && (
                          <button type="button" disabled={busy} onClick={() => advanceTask(task, "START")} className="appearance-none rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50">Start</button>
                        )}
                        <button type="button" disabled={busy} onClick={() => advanceTask(task, "COMPLETE")} className="inline-flex appearance-none items-center gap-1 rounded-lg border-0 bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"><CheckCircle2 className="h-3 w-3" />Done</button>
                        {canManage && (
                          <button type="button" disabled={busy} onClick={() => advanceTask(task, "CANCEL")} className="appearance-none rounded-lg border border-neutral-200 bg-white p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50" aria-label="Cancel task"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-neutral-200 bg-white p-4 sm:p-5">
              <h3 className="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-neutral-950"><CheckCircle2 className="h-4 w-4 text-emerald-700" />Completed today</h3>
              {board.recentDone.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-400">Nothing completed yet today.</p>
              ) : (
                <div className="space-y-2">
                  {board.recentDone.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-neutral-50/40 px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <p className="m-0 min-w-0 flex-1 truncate text-xs text-neutral-700">{task.roomCode ?? `Room #${task.roomUnitId}`} · {TASK_TYPE_LABEL[task.type] ?? task.type}{task.completedBy ? ` · ${task.completedBy.name}` : ""}</p>
                      <span className="shrink-0 text-[10px] text-neutral-400">{task.completedAt ? new Date(task.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {settingsOpen && board && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
          <button type="button" aria-label="Close housekeeping settings" className="absolute inset-0 border-0 bg-neutral-950/50 backdrop-blur-[3px]" onClick={closeHousekeepingSettings} />
          <div role="dialog" aria-modal="true" aria-labelledby="housekeeping-settings-title" className="relative my-auto w-full max-w-md overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="relative border-b border-neutral-200 bg-gradient-to-br from-white via-white to-emerald-50/70 px-5 py-3.5 pr-14">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm"><Clock3 className="h-5 w-5" /></span>
                <div>
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-700">Automation</p>
                  <h3 id="housekeeping-settings-title" className="mb-0 mt-1 text-base font-bold tracking-tight text-neutral-950">Occupied-room cleaning cycle</h3>
                  <p className="mb-0 mt-1 text-[11px] text-neutral-500">Daily cleaning for guests staying multiple nights.</p>
                </div>
              </div>
              <button type="button" aria-label="Close housekeeping settings" onClick={closeHousekeepingSettings} className="absolute right-4 top-4 flex h-8 w-8 appearance-none items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm transition hover:bg-neutral-100 hover:text-neutral-700"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <button type="button" role="switch" aria-checked={dailyServiceEnabled} onClick={() => setDailyServiceEnabled((value) => !value)} className={`flex w-full appearance-none items-center justify-between gap-4 rounded-xl border p-3 text-left transition ${dailyServiceEnabled ? "border-emerald-200 bg-emerald-50/70" : "border-neutral-200 bg-neutral-50"}`}>
                <span><span className="block text-sm font-bold text-neutral-900">Daily cleaning for occupied rooms</span><span className="mt-0.5 block text-[10px] text-neutral-500">Returns long-stay rooms to the cleaning queue.</span></span>
                <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${dailyServiceEnabled ? "bg-emerald-600" : "bg-neutral-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${dailyServiceEnabled ? "left-6" : "left-1"}`} /></span>
              </button>

              <label className="grid min-w-0 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3 overflow-hidden rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                <span><span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Daily service time</span><span className="mt-1 block text-[10px] font-medium text-neutral-400">Dar es Salaam time</span></span>
                <span className="relative block min-w-0 max-w-full overflow-hidden">
                  <input type="time" aria-label="Daily service time" value={dailyServiceTime} disabled={!dailyServiceEnabled} onChange={(event) => setDailyServiceTime(event.target.value)} className="!h-10 !w-full !min-w-0 !max-w-full box-border rounded-lg border border-neutral-200 bg-neutral-50 px-2 text-center text-sm font-bold text-neutral-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 disabled:text-neutral-400" />
                </span>
              </label>

              <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-[10px] leading-relaxed text-sky-800">
                Clean occupied rooms become dirty and receive one Daily clean task. Checkout turnover remains immediate.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" onClick={closeHousekeepingSettings} className="appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-bold text-neutral-600 shadow-sm transition hover:bg-neutral-100">Cancel</button>
              <button type="button" disabled={busyKey === "housekeeping-settings" || (dailyServiceEnabled && !dailyServiceTime)} onClick={() => void saveHousekeepingSettings()} className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-[0_6px_16px_rgba(4,120,87,0.22)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {busyKey === "housekeeping-settings" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{busyKey === "housekeeping-settings" ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {taskRoom && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <button type="button" aria-label="Close task composer" className="absolute inset-0 border-0 bg-neutral-950/50 backdrop-blur-[3px]" onClick={closeTaskComposer} />
          <div role="dialog" aria-modal="true" aria-labelledby="task-composer-title" className="relative my-auto w-full max-w-lg overflow-hidden rounded-[26px] border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="relative border-b border-neutral-200 bg-gradient-to-br from-white via-white to-emerald-50/70 px-5 py-4 pr-14">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm"><ClipboardList className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-700">Housekeeping task</p>
                  <h3 id="task-composer-title" className="mb-0 mt-1 text-base font-bold tracking-tight text-neutral-950">Create a room task</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-neutral-500">
                    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-sm"><BedDouble className="h-3 w-3 text-emerald-700" />Room {taskRoom.code}</span>
                    <span className="rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-sm">{floorLabel(taskRoom.floor)}</span>
                  </div>
                </div>
              </div>
              <button type="button" aria-label="Close task composer" onClick={closeTaskComposer} className="absolute right-4 top-4 flex h-8 w-8 appearance-none items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm transition hover:bg-neutral-100 hover:text-neutral-700"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">
                Task type
                <span className="relative mt-1.5 block">
                  <select value={taskType} onChange={(event) => setTaskType(event.target.value)} className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3.5 pr-10 text-sm font-bold normal-case tracking-normal text-neutral-800 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10">
                    {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </span>
                <span className="mt-1.5 block text-[10px] font-medium normal-case tracking-normal text-neutral-400">{TASK_TYPE_HELP[taskType]}</span>
              </label>

              <fieldset>
                <legend className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">Priority</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1">
                  <button type="button" aria-pressed={taskPriority === "NORMAL"} onClick={() => setTaskPriority("NORMAL")} className={`appearance-none rounded-lg border-0 px-3 py-2 text-xs font-bold transition ${taskPriority === "NORMAL" ? "bg-white text-neutral-800 shadow-sm ring-1 ring-neutral-200" : "bg-transparent text-neutral-500 hover:text-neutral-700"}`}>
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />Normal
                  </button>
                  <button type="button" aria-pressed={taskPriority === "HIGH"} onClick={() => setTaskPriority("HIGH")} className={`appearance-none rounded-lg border-0 px-3 py-2 text-xs font-bold transition ${taskPriority === "HIGH" ? "bg-red-50 text-red-700 shadow-sm ring-1 ring-red-200" : "bg-transparent text-neutral-500 hover:text-red-600"}`}>
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />Urgent
                  </button>
                </div>
              </fieldset>

              {board && board.housekeepers.length > 0 && (
                <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">
                  Assign to
                  <span className="relative mt-1.5 block">
                    <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value === "" ? "" : Number(event.target.value))} className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-10 text-sm font-semibold normal-case tracking-normal text-neutral-800 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10">
                      <option value="">Unassigned</option>
                      {board.housekeepers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                    </select>
                  </span>
                </label>
              )}

            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50/80 px-5 py-4">
              <button type="button" onClick={closeTaskComposer} className="appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs font-bold text-neutral-600 shadow-sm transition hover:bg-neutral-100">Cancel</button>
              <button type="button" disabled={busyKey === "create-task"} onClick={() => void createTask()} className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white shadow-[0_6px_16px_rgba(4,120,87,0.22)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {busyKey === "create-task" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{busyKey === "create-task" ? "Creating…" : "Create task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
