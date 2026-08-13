"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { 
  CalendarDays, 
  Loader2, 
  AlertCircle,
  ChevronRight,
  MapPin,
  Building2,
  BedDouble,
  Layers,
  Sparkles,
} from "lucide-react";

const api = apiClient;

type Property = {
  id: number;
  title: string;
  photos?: string[];
  regionName?: string | null;
  district?: string | null;
  city?: string | null;
  type?: string | null;
  status: string;
  roomsSpec?: any;
  layout?: any;
  totalFloors?: number | null;
  buildingType?: string | null;
};

type FloorInfo = {
  floorNumber: number;
  floorLabel: string;
  roomTypes: Array<{
    roomType: string;
    roomsCount: number;
    beds?: any;
  }>;
  totalRooms: number;
};

type SummaryPeriod = "today" | "week" | "month";

type AvailabilitySummary = {
  totalRooms: number;
  totalBookedRooms: number;
  totalBlockedRooms: number;
  totalAvailableRooms: number;
  overallAvailabilityPercentage: number;
};

type PeriodRange = { startDate: string; endDate: string };

function toIsoDateTime(d: Date): string {
  return d.toISOString();
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeekMonday(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // days since Monday
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

// Helper to get floor label
function getFloorLabel(floorNum: number): string {
  if (floorNum === 0) return "Ground Floor";
  const mod100 = floorNum % 100;
  const mod10 = floorNum % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${floorNum}${suffix} Floor`;
}

// Extract building structure from roomsSpec
function extractBuildingStructure(property: Property): FloorInfo[] {
  const floors: FloorInfo[] = [];
  
  if (!property.roomsSpec) {
    // Fallback: create a single floor with all rooms
    return [{
      floorNumber: 0,
      floorLabel: "Ground Floor",
      roomTypes: [],
      totalRooms: 0,
    }];
  }

  const roomsSpec = Array.isArray(property.roomsSpec) ? property.roomsSpec : [];
  const isMultiStorey = property.buildingType === "multi_storey";

  // Group rooms by floor
  const floorMap = new Map<number, Map<string, { roomType: string; roomsCount: number; beds?: any }>>();

  roomsSpec.forEach((room: any) => {
    const roomType = String(room?.roomType || room?.name || "Room").trim();
    const roomsCount = Number(room?.roomsCount || room?.count || 0);
    
    if (roomsCount === 0) return;

    // Parse floor distribution
    let floorDistribution: Record<number, number> = {};
    if (isMultiStorey && room.floorDistribution) {
      if (typeof room.floorDistribution === "string") {
        try {
          floorDistribution = JSON.parse(room.floorDistribution);
        } catch {
          floorDistribution = {};
        }
      } else if (typeof room.floorDistribution === "object" && room.floorDistribution !== null) {
        floorDistribution = room.floorDistribution;
      }
    }

    // If no floor distribution, default to ground floor (0)
    const floorsToUse = Object.keys(floorDistribution).length > 0 
      ? Object.keys(floorDistribution).map(Number)
      : [0];

    floorsToUse.forEach((floorNum) => {
      const countOnFloor = floorDistribution[floorNum] || roomsCount;
      
      if (!floorMap.has(floorNum)) {
        floorMap.set(floorNum, new Map());
      }
      
      const roomTypeMap = floorMap.get(floorNum)!;
      const existing = roomTypeMap.get(roomType);
      
      if (existing) {
        existing.roomsCount += countOnFloor;
      } else {
        roomTypeMap.set(roomType, {
          roomType,
          roomsCount: countOnFloor,
          beds: room.beds,
        });
      }
    });
  });

  // Convert to FloorInfo array
  const floorNumbers = Array.from(floorMap.keys()).sort((a, b) => a - b);
  
  if (floorNumbers.length === 0) {
    // No floor data, create default
    return [{
      floorNumber: 0,
      floorLabel: "Ground Floor",
      roomTypes: roomsSpec.map((r: any) => ({
        roomType: String(r?.roomType || r?.name || "Room"),
        roomsCount: Number(r?.roomsCount || r?.count || 0),
        beds: r?.beds,
      })).filter((rt: any) => rt.roomsCount > 0),
      totalRooms: roomsSpec.reduce((sum: number, r: any) => sum + Number(r?.roomsCount || r?.count || 0), 0),
    }];
  }

  floorNumbers.forEach((floorNum) => {
    const roomTypeMap = floorMap.get(floorNum)!;
    const roomTypes = Array.from(roomTypeMap.values());
    const totalRooms = roomTypes.reduce((sum, rt) => sum + rt.roomsCount, 0);

    floors.push({
      floorNumber: floorNum,
      floorLabel: getFloorLabel(floorNum),
      roomTypes,
      totalRooms,
    });
  });

  return floors;
}

export default function PropertyAvailabilitySelectionPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ranges = useMemo<Record<SummaryPeriod, PeriodRange>>(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeekMonday(now);
    const monthStart = startOfMonth(now);

    return {
      today: { startDate: toIsoDateTime(todayStart), endDate: toIsoDateTime(addDays(todayStart, 1)) },
      week: { startDate: toIsoDateTime(weekStart), endDate: toIsoDateTime(addDays(weekStart, 7)) },
      month: { startDate: toIsoDateTime(monthStart), endDate: toIsoDateTime(addMonths(monthStart, 1)) },
    };
  }, []);

  const [availabilityByPropertyId, setAvailabilityByPropertyId] = useState<
    Record<number, Partial<Record<SummaryPeriod, AvailabilitySummary>>>
  >({});
  const [availabilityLoadingByPropertyId, setAvailabilityLoadingByPropertyId] = useState<
    Record<number, Partial<Record<SummaryPeriod, boolean>>>
  >({});

  useEffect(() => {
    let mounted = true;

      api.get<any>("/api/owner/properties/mine", { params: { status: "APPROVED" } })
      .then((r) => {
        if (!mounted) return;
        const data = r.data;
        const propertiesList = Array.isArray(data) ? data : (data?.items || []);
        setProperties(propertiesList);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err?.response?.data?.error || "Failed to load properties");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Fetch lightweight availability summaries for Today / This Week / This Month.
  useEffect(() => {
    if (!properties.length) return;

    let cancelled = false;

    const periods: SummaryPeriod[] = ["today", "week", "month"];

    const fetchOne = async (propertyId: number, period: SummaryPeriod) => {
      setAvailabilityLoadingByPropertyId((prev) => ({
        ...prev,
        [propertyId]: { ...prev[propertyId], [period]: true },
      }));
      try {
        const r = await api.get<any>("/api/owner/availability/summary", {
          params: { propertyId, ...ranges[period] },
        });
        const s = r?.data?.summary;
        if (!s || cancelled) return;
        setAvailabilityByPropertyId((prev) => ({
          ...prev,
          [propertyId]: { ...prev[propertyId], [period]: s },
        }));
      } catch {
        // ignore - card will show placeholder values
      } finally {
        if (!cancelled) {
          setAvailabilityLoadingByPropertyId((prev) => ({
            ...prev,
            [propertyId]: { ...prev[propertyId], [period]: false },
          }));
        }
      }
    };

    for (const p of properties) {
      for (const period of periods) fetchOne(p.id, period);
    }

    return () => {
      cancelled = true;
    };
  }, [properties, ranges]);

  if (loading) {
    return (
      <div className="relative min-h-screen bg-slate-50 rounded-3xl overflow-hidden border border-slate-200 shadow-xl shadow-slate-200/60">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[600px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-100/80 blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="mb-8 h-9 w-32 rounded-xl bg-slate-200 animate-pulse" />
          <div className="mb-12 h-36 rounded-3xl bg-slate-200 border border-slate-300 animate-pulse" />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-3xl border border-slate-200 bg-slate-100 overflow-hidden">
                <div className="h-36 bg-slate-200 animate-pulse" />
                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {[0,1,2].map(j => <div key={j} className="h-16 rounded-2xl bg-slate-200 animate-pulse" />)}
                  </div>
                  <div className="h-20 rounded-2xl bg-slate-200 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-center justify-center gap-3 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading your approved properties…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative min-h-screen bg-slate-50 rounded-3xl overflow-hidden border border-slate-200 shadow-xl shadow-slate-200/60 flex items-center justify-center p-4">
        <div className="rounded-3xl border border-white/10 bg-slate-900 p-8 max-w-md w-full shadow-2xl shadow-black/60">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/20 flex items-center justify-center mb-5">
            <AlertCircle className="w-6 h-6 text-rose-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Could not load properties</h1>
          <p className="mt-2 text-sm text-white/50">{error}</p>
          <div className="mt-6 flex items-center gap-3">
            <Link
              href="/owner/properties/approved"
              className="no-underline inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-white hover:bg-white/10 transition"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              <span>Back</span>
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-sm font-semibold text-white hover:from-emerald-500 hover:to-teal-500 transition"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (properties.length === 0) {
    return (
      <div className="relative min-h-screen bg-slate-50 rounded-3xl overflow-hidden border border-slate-200 shadow-xl shadow-slate-200/60 flex items-center justify-center p-4">
        <div className="rounded-3xl border border-white/10 bg-slate-900 p-8 max-w-md w-full text-center shadow-2xl shadow-black/60">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_-4px_rgba(52,211,153,0.4)]">
            <CalendarDays className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">No approved properties yet</h1>
          <p className="mt-2 text-sm text-white/50">
            You need at least one approved property before you can manage room availability.
          </p>
          <div className="mt-6">
            <Link
              href="/owner/properties/add"
              className="no-underline inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-bold hover:from-emerald-500 hover:to-teal-500 transition shadow-lg shadow-emerald-900/40"
            >
              <Sparkles className="w-4 h-4" />
              <span>Add New Property</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50 rounded-3xl overflow-hidden border border-slate-200 shadow-xl shadow-slate-200/60">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-200/50 blur-3xl" />
        <div className="absolute top-1/3 -left-40 h-[400px] w-[600px] rounded-full bg-teal-200/40 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[500px] rounded-full bg-cyan-200/30 blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* ── Nav bar ── */}
        <nav className="mb-8 flex items-center justify-between">
          <Link
            href="/owner/properties/approved"
            className="no-underline inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 shadow-sm transition"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            <span>Properties</span>
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
            <BedDouble className="w-3.5 h-3.5" />
            {properties.length} {properties.length === 1 ? "property" : "properties"}
          </span>
        </nav>

        {/* ── Hero header ── */}
        <div className="relative mb-12 overflow-hidden rounded-3xl border border-white/10 bg-slate-900 bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-cyan-500/5 p-8 shadow-2xl shadow-black/40">
          {/* decorative arcs */}
          <svg className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-10" viewBox="0 0 400 300" fill="none">
            <circle cx="400" cy="0" r="220" stroke="white" strokeWidth="1" />
            <circle cx="400" cy="0" r="160" stroke="white" strokeWidth="1" />
            <circle cx="400" cy="0" r="100" stroke="white" strokeWidth="1" />
          </svg>
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-6">
            {/* icon */}
            <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-[0_0_40px_-4px_rgba(52,211,153,0.5)]">
              <CalendarDays className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-400/80 mb-1">Owner Dashboard</p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Room Availability</h1>
              <p className="mt-2 text-sm text-white/50 max-w-md">
                Monitor bookings, block external reservations, and keep every room's calendar up to date. All in one place.
              </p>
            </div>
            {/* quick stat pills */}
            <div className="sm:ml-auto flex flex-wrap gap-2 sm:flex-col sm:items-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live sync
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60">
                <Layers className="w-3.5 h-3.5" />
                {properties.reduce((s, p) => s + extractBuildingStructure(p).length, 0)} floors total
              </span>
            </div>
          </div>
        </div>

        {/* ── Properties Grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {properties.map((property) => {
            const buildingStructure = extractBuildingStructure(property);
            const location = [property.city, property.district, property.regionName]
              .filter(Boolean)
              .join(", ") || "Location not specified";

            const totalRooms = buildingStructure.reduce((sum, floor) => sum + floor.totalRooms, 0);
            const cover = Array.isArray(property.photos) && property.photos.length > 0 ? property.photos[0] : null;

            const avail = availabilityByPropertyId[property.id];
            const avLoading = availabilityLoadingByPropertyId[property.id];

            const fmt = (value: number | undefined, isLoading?: boolean) => {
              if (typeof value === "number") return value;
              if (isLoading) return "…";
              return "—";
            };

            const bookedToday = avail?.today?.totalBookedRooms;
            const bookedWeek  = avail?.week?.totalBookedRooms;
            const bookedMonth = avail?.month?.totalBookedRooms;
            const blockedToday = avail?.today?.totalBlockedRooms;
            const blockedWeek  = avail?.week?.totalBlockedRooms;
            const blockedMonth = avail?.month?.totalBlockedRooms;

            const availPct = avail?.today?.overallAvailabilityPercentage ?? null;

            return (
              <Link
                key={property.id}
                href={`/owner/properties/${property.id}/availability`}
                className="no-underline group block"
              >
                <div className="relative rounded-3xl border border-white/10 bg-slate-900 backdrop-blur-sm overflow-hidden shadow-xl shadow-black/30 hover:-translate-y-1 hover:shadow-[0_28px_60px_-10px_rgba(2,102,94,0.35)] hover:border-emerald-500/30 transition-all duration-300">
                  {/* hover glow */}
                  <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                    <div className="absolute -top-20 -right-20 h-52 w-52 rounded-full bg-emerald-500/15 blur-2xl" />
                  </div>

                  {/* 4px accent bar */}
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 rounded-t-3xl" />

                  {/* Cover photo / hero gradient */}
                  <div className="relative h-36 overflow-hidden">
                    {cover ? (
                      <div
                        className="absolute inset-0 bg-cover bg-center scale-105 group-hover:scale-100 transition-transform duration-700"
                        style={{ backgroundImage: `url(${cover})` }}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/60 via-teal-900/40 to-slate-900/70" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />

                    {/* Status + rooms badges */}
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                        {property.status}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-white/80">
                        <BedDouble className="w-3 h-3" />
                        {totalRooms} rooms
                      </span>
                    </div>

                    {/* Property name overlaid on photo */}
                    <div className="absolute bottom-4 left-5 right-5 flex items-end gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-white/80" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-white leading-tight truncate group-hover:text-emerald-300 transition-colors">
                          {property.title}
                        </h3>
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-white/40 flex-shrink-0" />
                          <span className="text-xs text-white/50 truncate">{location}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-5 pb-5 pt-4">

                    {/* Quick stat strip */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label: "Floors", value: String(buildingStructure.length), icon: <Layers className="w-3.5 h-3.5 text-emerald-400" /> },
                        { label: "Rooms", value: String(totalRooms), icon: <BedDouble className="w-3.5 h-3.5 text-teal-400" /> },
                        { label: "Avail. today", value: availPct !== null ? `${availPct}%` : fmt(undefined, avLoading?.today), icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> },
                      ].map((s) => (
                        <div key={s.label} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2.5">
                          <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[10px] font-bold uppercase tracking-wider text-white/40">{s.label}</span></div>
                          <div className="text-lg font-bold text-white tabular-nums">{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Booking / block table */}
                    <div className="rounded-2xl border border-white/8 bg-white/4 overflow-hidden">
                      {/* Table head */}
                      <div className="grid grid-cols-4 px-3 py-2 border-b border-white/8 bg-white/5 text-[10px] font-bold uppercase tracking-wider text-white/35">
                        <span />
                        <span className="text-right">Today</span>
                        <span className="text-right">Week</span>
                        <span className="text-right">Month</span>
                      </div>
                      {/* NoLSAF booked */}
                      <div className="grid grid-cols-4 px-3 py-2.5 items-center">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                          <span className="text-[11px] font-semibold text-white/60">NoLSAF</span>
                        </div>
                        <span className="text-right text-sm font-bold text-emerald-400 tabular-nums">{fmt(bookedToday, avLoading?.today)}</span>
                        <span className="text-right text-sm font-bold text-emerald-400 tabular-nums">{fmt(bookedWeek,  avLoading?.week)}</span>
                        <span className="text-right text-sm font-bold text-emerald-400 tabular-nums">{fmt(bookedMonth, avLoading?.month)}</span>
                      </div>
                      {/* External blocked */}
                      <div className="grid grid-cols-4 px-3 py-2.5 border-t border-white/8 items-center">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                          <span className="text-[11px] font-semibold text-white/60">Blocked</span>
                        </div>
                        <span className="text-right text-sm font-bold text-white/70 tabular-nums">{fmt(blockedToday, avLoading?.today)}</span>
                        <span className="text-right text-sm font-bold text-white/70 tabular-nums">{fmt(blockedWeek,  avLoading?.week)}</span>
                        <span className="text-right text-sm font-bold text-white/70 tabular-nums">{fmt(blockedMonth, avLoading?.month)}</span>
                      </div>
                    </div>

                    {/* CTA footer */}
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-xs text-white/30">Click to manage calendar</span>
                      <div className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-900/40 group-hover:from-emerald-500 group-hover:to-teal-500 transition-all">
                        <span>Manage</span>
                        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
