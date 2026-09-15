"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Users, Search, X, MapPin, User, UsersRound, Globe, TrendingUp, Calendar, Phone, Hash, ExternalLink, Loader2, SlidersHorizontal } from "lucide-react";
import apiClient from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;

type PassengerRow = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | number | null;
  age: number | null;
  gender: string | null;
  nationality: string | null;
  sequenceNumber: number;
  booking: {
    id: number;
    groupType: string;
    destination: string;
    checkIn: string | null;
    checkOut: string | null;
    status: string;
    customer: { id: number; name: string; email: string } | null;
  } | null;
};

type PassengerStats = {
  totalPassengers: number;
  averageAge: number;
  genderStats: Record<string, number>;
  nationalityStats: Record<string, number>;
  ageGroups: Record<string, number>;
  groupTypeStats: Record<string, number>;
  regionStats: Record<string, number>;
  topNationalities: Array<{ nationality: string; count: number }>;
};

function humanizeLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function genderLabel(value: string | null | undefined) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "M" || v === "MALE") return "Male";
  if (v === "F" || v === "FEMALE") return "Female";
  if (!v) return "Not given";
  return humanizeLabel(v);
}

// Rosters mix "M" and "Male" etc.; fold them into one entry per label, largest first.
function mergeGenders(record: Record<string, number> | undefined) {
  const merged = new Map<string, number>();
  Object.entries(record || {}).forEach(([key, n]) => {
    if (!(n > 0)) return;
    const label = genderLabel(key);
    merged.set(label, (merged.get(label) || 0) + n);
  });
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}

// "dar-es-salaam" -> "Dar es Salaam"; keeps known abbreviations only.
function formatPlaceName(value: string | null | undefined) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase())) return word.toLowerCase();
      if (["CBD", "UDSM", "JNIA", "KIA"].includes(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const gsRef = (id: number) => `GS-${String(id).padStart(4, "0")}`;

function fmtDay(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Phones imported from spreadsheets can arrive as numbers or in scientific notation.
function formatPhone(value: PassengerRow["phone"]) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 0 }).format(value);
  const s = String(value).trim();
  const m = s.match(/^([+-]?\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) return s;
  const intPart = m[1].replace(/^\+/, "");
  const fracPart = m[2] ?? "";
  const exponent = Number(m[3]);
  const digits = `${intPart}${fracPart}`;
  const newIndex = intPart.length + exponent;
  if (!Number.isFinite(exponent) || exponent < 0 || newIndex < digits.length) return s;
  return `${digits}${"0".repeat(newIndex - digits.length)}`;
}

function initials(first: string, last: string) {
  return `${(first || "").trim().charAt(0)}${(last || "").trim().charAt(0)}`.toUpperCase() || "?";
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "text-amber-700",
  AWAITING_DEPOSIT: "text-sky-700",
  CONFIRMED: "text-blue-700",
  PROCESSING: "text-violet-700",
  COMPLETED: "text-neutral-600",
  CANCELED: "text-rose-600",
  CANCELLED: "text-rose-600",
};

const inputCls =
  "h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";

export default function AdminGroupStaysPassengersPage() {
  const [bookingId, setBookingId] = useState<string>("");
  const [groupType, setGroupType] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [nationality, setNationality] = useState<string>("");
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<PassengerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const qRef = useRef(q);

  useEffect(() => {
    qRef.current = q;
  }, [q]);

  // Passenger details modal
  const [selectedPassenger, setSelectedPassenger] = useState<PassengerRow | null>(null);
  const [showPassengerModal, setShowPassengerModal] = useState(false);
  const [passengerModalMounted, setPassengerModalMounted] = useState(false);
  const [passengerModalVisible, setPassengerModalVisible] = useState(false);
  const openPassengerModal = useCallback((passenger: PassengerRow) => {
    setSelectedPassenger(passenger);
    setShowPassengerModal(true);
  }, []);
  const closePassengerModal = useCallback(() => setShowPassengerModal(false), []);

  useEffect(() => {
    if (showPassengerModal) {
      setPassengerModalMounted(true);
      const id = window.requestAnimationFrame(() => setPassengerModalVisible(true));
      return () => window.cancelAnimationFrame(id);
    }
    setPassengerModalVisible(false);
    const t = window.setTimeout(() => {
      setPassengerModalMounted(false);
      setSelectedPassenger(null);
    }, 180);
    return () => window.clearTimeout(t);
  }, [showPassengerModal]);

  useEffect(() => {
    if (!passengerModalMounted) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePassengerModal();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [passengerModalMounted, closePassengerModal]);

  // Stats state
  const [stats, setStats] = useState<PassengerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (bookingId) params.bookingId = bookingId;
      if (groupType) params.groupType = groupType;
      if (gender) params.gender = gender;
      if (nationality) params.nationality = nationality;
      if (ageMin) params.ageMin = ageMin;
      if (ageMax) params.ageMax = ageMax;
      if (qRef.current) params.q = qRef.current;

      // IMPORTANT: call via /api/* so we hit the API proxy, not the Next.js page route.
      const r = await api.get<{ items: PassengerRow[]; total: number }>("/api/admin/group-stays/passengers", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err) {
      console.error("Failed to load passengers", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, bookingId, groupType, gender, nationality, ageMin, ageMax]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await api.get<PassengerStats>("/api/admin/group-stays/passengers/stats");
      setStats(r.data);
    } catch (err) {
      console.error("Failed to load passenger statistics", err);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadStats();
  }, [load, loadStats]);

  const activeFilters = [bookingId, groupType, gender, nationality, ageMin, ageMax, q].filter(Boolean).length;
  const clearFilters = () => {
    qRef.current = "";
    setQ("");
    setBookingId("");
    setGroupType("");
    setGender("");
    setNationality("");
    setAgeMin("");
    setAgeMax("");
    setPage(1);
  };

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100 sm:h-12 sm:w-12">
            <UsersRound className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Passengers</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Everyone travelling on group stay bookings</p>
          </div>
        </div>
        <Link
          href="/admin/group-stays"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline sm:self-auto"
        >
          <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
          Group Stays overview
        </Link>
      </div>

      {/* Summary strip */}
      {stats && (() => {
        const ranked = (record: Record<string, number>) => Object.entries(record || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        const genders = mergeGenders(stats.genderStats);
        const ages = ranked(stats.ageGroups);
        const nations = stats.topNationalities?.length ? stats.topNationalities : ranked(stats.nationalityStats).map(([nationality, count]) => ({ nationality, count }));
        const pctOf = (n: number) => (stats.totalPassengers > 0 ? Math.round((n / stats.totalPassengers) * 100) : 0);
        const tiles = [
          { icon: Users, tone: "bg-emerald-50 text-emerald-600", label: "Total passengers", value: stats.totalPassengers.toLocaleString(), sub: `${Object.values(stats.groupTypeStats || {}).filter((n) => n > 0).length} group types` },
          { icon: Calendar, tone: "bg-blue-50 text-blue-600", label: "Average age", value: stats.averageAge > 0 ? `${stats.averageAge} yrs` : "Not given", sub: ages[0] ? `Most common: ${ages[0][0]}` : "No ages recorded" },
          { icon: User, tone: "bg-violet-50 text-violet-600", label: "Gender split", value: genders.length ? genders.slice(0, 2).map(([g, n]) => `${pctOf(n)}%`).join(" / ") : "Not given", sub: genders.length ? genders.slice(0, 2).map(([g]) => g).join(" / ") : "No genders recorded" },
          { icon: Globe, tone: "bg-amber-50 text-amber-600", label: "Nationalities", value: Object.values(stats.nationalityStats || {}).filter((n) => n > 0).length.toLocaleString(), sub: nations[0] ? `Top: ${nations[0].nationality} (${nations[0].count})` : "None recorded" },
        ];
        return (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.label} className="flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tile.tone}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-medium text-neutral-500">{tile.label}</p>
                      <p className="m-0 text-xl font-bold leading-tight tabular-nums text-neutral-900">{tile.value}</p>
                      <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={tile.sub}>{tile.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Breakdown: gender, age and nationality as ranked share bars */}
      {(stats || statsLoading) && (() => {
        const ranked = (record: Record<string, number> | undefined) => Object.entries(record || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        const ageOrder = (label: string) => {
          const n = parseInt(label, 10);
          return Number.isFinite(n) ? n : 999;
        };
        const panels = [
          { key: "gender", icon: User, tone: "bg-violet-50 text-violet-600", bar: "bg-violet-500", title: "Gender", rows: mergeGenders(stats?.genderStats).map(([k, n]) => [k, n] as const), empty: "No genders recorded" },
          // Age bands read best youngest to oldest, not by size.
          { key: "age", icon: Calendar, tone: "bg-blue-50 text-blue-600", bar: "bg-blue-500", title: "Age groups", rows: ranked(stats?.ageGroups).sort((a, b) => ageOrder(a[0]) - ageOrder(b[0])).map(([k, n]) => [k, n] as const), empty: "No ages recorded" },
          { key: "nation", icon: Globe, tone: "bg-amber-50 text-amber-600", bar: "bg-amber-500", title: "Top nationalities", rows: (stats?.topNationalities?.length ? stats.topNationalities.map((t) => [t.nationality, t.count] as const) : ranked(stats?.nationalityStats).map(([k, n]) => [k, n] as const)).slice(0, 6), empty: "No nationalities recorded" },
        ];
        return (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {panels.map((panel) => {
              const Icon = panel.icon;
              const sum = panel.rows.reduce((acc, [, n]) => acc + n, 0);
              const base = stats?.totalPassengers || sum;
              return (
                <div key={panel.key} className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white">
                  <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${panel.tone}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="m-0 text-sm font-bold text-neutral-900">{panel.title}</h3>
                    {panel.rows.length > 0 && <span className="ml-auto text-xs tabular-nums text-neutral-400">{panel.rows.length} {panel.rows.length === 1 ? "group" : "groups"}</span>}
                  </div>
                  <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
                    {statsLoading ? (
                      <div className="flex h-20 items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                      </div>
                    ) : panel.rows.length === 0 ? (
                      <p className="m-0 py-2 text-sm text-neutral-500">{panel.empty}</p>
                    ) : (
                      <ul className="m-0 list-none space-y-2.5 p-0">
                        {panel.rows.map(([label, n], idx) => {
                          const pct = base > 0 ? Math.round((n / base) * 100) : 0;
                          return (
                            <li key={`${label}-${idx}`}>
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="truncate text-neutral-800">{label}</span>
                                <span className="flex-shrink-0 tabular-nums text-neutral-500">
                                  <span className="font-semibold text-neutral-900">{n.toLocaleString()}</span> · {pct}%
                                </span>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                                <div className={`h-full rounded-full ${panel.bar}`} style={{ width: `${Math.max(pct, 3)}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Roster: filters + table in one card */}
      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <h3 className="m-0 text-sm font-bold text-neutral-900">Roster</h3>
          <span className="text-xs tabular-nums text-neutral-400">
            {loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "passenger" : "passengers"}`}
          </span>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
            >
              <X className="h-3.5 w-3.5" /> Clear {activeFilters} {activeFilters === 1 ? "filter" : "filters"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3 sm:px-5 md:grid-cols-4 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.3fr)]">
          <div className="relative col-span-2 min-w-0 md:col-span-4 xl:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              className={`${inputCls} pl-9 pr-9`}
              placeholder="Search name, phone or nationality"
              value={q}
              onChange={(e) => {
                qRef.current = e.target.value;
                setQ(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPage(1);
                  load();
                }
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  qRef.current = "";
                  setQ("");
                  setPage(1);
                  load();
                }}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <input
            type="number"
            placeholder="Booking ID"
            value={bookingId}
            onChange={(e) => {
              setBookingId(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          />
          <select
            value={groupType}
            onChange={(e) => {
              setGroupType(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          >
            <option value="">All group types</option>
            <option value="family">Family</option>
            <option value="workers">Workers</option>
            <option value="event">Event</option>
            <option value="students">Students</option>
            <option value="team">Team</option>
            <option value="other">Other</option>
          </select>
          <select
            value={gender}
            onChange={(e) => {
              setGender(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          >
            <option value="">All genders</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="OTHER">Other</option>
          </select>
          <input
            type="text"
            placeholder="Nationality"
            value={nationality}
            onChange={(e) => {
              setNationality(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          />
          <div className="col-span-2 flex min-w-0 items-center gap-1.5 md:col-span-1 xl:col-span-1">
            <SlidersHorizontal className="h-4 w-4 flex-shrink-0 text-neutral-400" aria-hidden />
            <input
              type="number"
              placeholder="Min age"
              value={ageMin}
              onChange={(e) => {
                setAgeMin(e.target.value);
                setPage(1);
              }}
              className={inputCls}
            />
            <span className="text-neutral-300">to</span>
            <input
              type="number"
              placeholder="Max"
              value={ageMax}
              onChange={(e) => {
                setAgeMax(e.target.value);
                setPage(1);
              }}
              className={inputCls}
            />
          </div>
        </div>

        {loading && list.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading passengers
          </div>
        ) : list.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <UsersRound className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No passengers found</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">
              {activeFilters > 0 ? "Try removing a filter or changing the search." : "Passengers appear here once customers add their group roster."}
            </p>
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold sm:pl-5">Passenger</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Age · Gender</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Nationality</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Booking</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Status</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Customer</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Stay</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 text-right font-bold sm:pr-5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const phone = formatPhone(p.phone);
                    const status = String(p.booking?.status || "").toUpperCase();
                    const checkIn = fmtDay(p.booking?.checkIn);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => openPassengerModal(p)}
                        className="cursor-pointer border-0 border-b border-solid border-neutral-100 transition-colors last:border-b-0 hover:bg-neutral-50/70"
                      >
                        <td className="px-4 py-3.5 sm:pl-5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[11px] font-semibold text-emerald-700">
                              {initials(p.firstName, p.lastName)}
                            </span>
                            <div className="min-w-0">
                              <div className="max-w-[16rem] truncate font-medium text-neutral-900">{tidyName(`${p.firstName} ${p.lastName}`)}</div>
                              <div className="mt-0.5 truncate text-xs tabular-nums text-neutral-400">{phone || "No phone"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="tabular-nums text-neutral-800">{p.age != null ? `${p.age} yrs` : <span className="text-neutral-400">Not given</span>}</div>
                          <div className="mt-0.5 text-xs text-neutral-400">{genderLabel(p.gender)}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="max-w-[10rem] truncate text-neutral-800">{p.nationality || <span className="text-neutral-400">Not given</span>}</div>
                          <div className="mt-0.5 text-xs tabular-nums text-neutral-400">Seat #{p.sequenceNumber}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          {p.booking ? (
                            <>
                              <span className="inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">{gsRef(p.booking.id)}</span>
                              <div className="mt-0.5 truncate text-xs text-neutral-400">{humanizeLabel(p.booking.groupType)}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">No booking</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {p.booking ? (
                            <span className={`whitespace-nowrap text-sm ${STATUS_TONE[status] || "text-neutral-500"}`}>{humanizeLabel(status)}</span>
                          ) : (
                            <span className="text-neutral-400">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {p.booking?.customer ? (
                            <>
                              <div className="max-w-[12rem] truncate text-neutral-800">{tidyName(p.booking.customer.name)}</div>
                              <div className="mt-0.5 max-w-[12rem] truncate text-xs text-neutral-400" title={p.booking.customer.email}>{p.booking.customer.email}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">Not linked</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {p.booking ? (
                            <>
                              <div className="max-w-[12rem] truncate text-neutral-800">{formatPlaceName(p.booking.destination) || "Not set"}</div>
                              <div className="mt-0.5 text-xs text-neutral-400">{checkIn ? `Arrives ${checkIn}` : "Dates not set"}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right sm:pr-5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPassengerModal(p);
                            }}
                            className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="m-0 list-none p-0 md:hidden">
              {list.map((p) => {
                const status = String(p.booking?.status || "").toUpperCase();
                return (
                  <li key={p.id} className="border-0 border-t border-solid border-neutral-100">
                    <button
                      type="button"
                      onClick={() => openPassengerModal(p)}
                      className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                    >
                      <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700">
                        {initials(p.firstName, p.lastName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-neutral-900">{tidyName(`${p.firstName} ${p.lastName}`)}</span>
                        <span className="mt-0.5 block truncate text-xs text-neutral-500">
                          {[p.age != null ? `${p.age} yrs` : null, p.gender ? genderLabel(p.gender) : null, p.nationality].filter(Boolean).join(" · ") || "No details"}
                        </span>
                        {p.booking && (
                          <span className="mt-1 flex items-center gap-2 text-xs">
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{gsRef(p.booking.id)}</span>
                            <span className="truncate text-neutral-400">{formatPlaceName(p.booking.destination)}</span>
                            <span className={`ml-auto flex-shrink-0 ${STATUS_TONE[status] || "text-neutral-500"}`}>{humanizeLabel(status)}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Passenger details modal */}
      {passengerModalMounted && selectedPassenger && (() => {
        const p = selectedPassenger;
        const phone = formatPhone(p.phone);
        const status = String(p.booking?.status || "").toUpperCase();
        const facts = [
          { icon: Phone, label: "Phone", value: phone || "Not given" },
          { icon: Calendar, label: "Age", value: p.age != null ? `${p.age} yrs` : "Not given" },
          { icon: User, label: "Gender", value: genderLabel(p.gender) },
          { icon: Hash, label: "Roster position", value: `#${p.sequenceNumber}` },
        ];
        const bookingFacts = p.booking
          ? [
              { label: "Status", value: humanizeLabel(status), cls: STATUS_TONE[status] },
              { label: "Group type", value: humanizeLabel(p.booking.groupType) },
              { label: "Destination", value: formatPlaceName(p.booking.destination) || "Not set" },
              { label: "Customer", value: p.booking.customer ? tidyName(p.booking.customer.name) : "Not linked", sub: p.booking.customer?.email },
              { label: "Check-in", value: fmtDay(p.booking.checkIn) || "Not set" },
              { label: "Check-out", value: fmtDay(p.booking.checkOut) || "Not set" },
            ]
          : [];
        return (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${passengerModalVisible ? "bg-neutral-900/50 opacity-100" : "bg-neutral-900/0 opacity-0"}`}
            onClick={closePassengerModal}
            role="dialog"
            aria-modal="true"
            aria-label="Passenger details"
          >
            <div
              className={`flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-2xl transition-all duration-200 ease-out ${
                passengerModalVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.98] opacity-0"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 px-5 py-4">
                <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">
                  {initials(p.firstName, p.lastName)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 truncate text-base font-bold text-neutral-900">{tidyName(`${p.firstName} ${p.lastName}`)}</h2>
                  <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500">
                    <Globe className="h-3.5 w-3.5 text-neutral-400" />
                    {p.nationality || "Nationality not given"}
                    {p.booking ? <span className="text-neutral-300">·</span> : null}
                    {p.booking ? <span className="font-mono text-neutral-600">{gsRef(p.booking.id)}</span> : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePassengerModal}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto border-0 border-t border-solid border-neutral-100 px-5 py-4">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-100 bg-neutral-100">
                  {facts.map((f) => {
                    const Icon = f.icon;
                    return (
                      <div key={f.label} className="min-w-0 bg-white px-3 py-2.5">
                        <p className="m-0 flex items-center gap-1.5 text-[11px] text-neutral-400">
                          <Icon className="h-3.5 w-3.5" /> {f.label}
                        </p>
                        <p className="m-0 mt-0.5 truncate text-sm tabular-nums text-neutral-900">{f.value}</p>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <p className="m-0 mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                    <MapPin className="h-3.5 w-3.5" /> Booking
                  </p>
                  {p.booking ? (
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-100 bg-neutral-100">
                      {bookingFacts.map((f) => (
                        <div key={f.label} className="min-w-0 bg-white px-3 py-2.5">
                          <p className="m-0 text-[11px] text-neutral-400">{f.label}</p>
                          <p className={`m-0 mt-0.5 truncate text-sm ${f.cls || "text-neutral-900"}`} title={f.value}>{f.value}</p>
                          {f.sub ? <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={f.sub}>{f.sub}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-sm text-neutral-500">No booking linked</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-5 py-3">
                <button
                  type="button"
                  onClick={closePassengerModal}
                  className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  Close
                </button>
                {p.booking?.id ? (
                  <Link
                    href={`/admin/group-stays/bookings?bookingId=${p.booking.id}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-emerald-700 hover:no-underline"
                  >
                    Open booking <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
