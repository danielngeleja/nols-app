"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { AlertCircle, BedDouble, Building2, CalendarDays, ChevronRight, MapPin, Search, Sparkles } from "lucide-react";

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
  const [query, setQuery] = useState("");

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

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const style = (
    <style>{`:where(#owner-avail-list, #owner-avail-list *, #owner-avail-list *::before, #owner-avail-list *::after) { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e2e8f0; }`}</style>
  );

  if (loading) {
    return (
      <div id="owner-avail-list" className={shell} aria-busy="true" aria-label="Loading properties">
        {style}
        <div className="h-56 animate-pulse rounded-3xl bg-[#012a26]" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-[330px] animate-pulse rounded-2xl bg-slate-200/70" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div id="owner-avail-list" className={shell}>
        {style}
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
            <div>
              <p className="m-0 text-sm font-bold text-rose-900">Your properties could not be loaded</p>
              <p className="m-0 mt-0.5 text-xs text-rose-800">{error}</p>
            </div>
          </div>
          <button type="button" onClick={() => window.location.reload()} className="h-10 rounded-xl bg-[#012a26] px-4 text-sm font-bold text-white hover:bg-[#02665e]">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div id="owner-avail-list" className={shell}>
        {style}
        <section className="grid overflow-hidden rounded-3xl border border-slate-300/80 bg-white md:grid-cols-2">
          <div className="p-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#012a26] text-[#5eead4]"><CalendarDays className="h-6 w-6" aria-hidden /></span>
            <p className="m-0 mt-4 text-xl font-bold text-slate-900">No approved properties yet</p>
            <p className="m-0 mt-1.5 max-w-sm text-sm text-slate-500">Room availability opens once a property is approved.</p>
          </div>
          <div className="flex flex-col justify-center gap-2.5 border-0 border-t border-slate-200 bg-slate-50 p-8 md:border-l md:border-t-0">
            <Link href="/owner/properties/add" className="group inline-flex h-12 items-center justify-between rounded-xl bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white no-underline hover:bg-[#02665e]">
              Add a property
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26]"><Sparkles className="h-4 w-4" aria-hidden /></span>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // Portfolio, tonight.
  const sumToday = (k: keyof AvailabilitySummary) =>
    properties.reduce((t, p) => t + Number(availabilityByPropertyId[p.id]?.today?.[k] ?? 0), 0);
  const roomsAll = properties.reduce((t, p) => t + extractBuildingStructure(p).reduce((s, f) => s + f.totalRooms, 0), 0);
  const todayLoaded = properties.some((p) => availabilityByPropertyId[p.id]?.today);
  const q = query.trim().toLowerCase();
  const visible = q
    ? properties.filter((p) => [p.title, p.city, p.district, p.regionName, p.type].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    : properties;

  return (
    <div id="owner-avail-list" className={shell}>
      {style}

      {/* ── Header band ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pt-6">
          <Link href="/owner/properties/approved" className="inline-flex items-center gap-1 text-sm font-semibold text-white/60 no-underline transition hover:text-white">
            <ChevronRight className="h-4 w-4 rotate-180" aria-hidden /> My properties
          </Link>
          <div className="mt-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Front desk</p>
            <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Room availability</h1>
            <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">Pick a property to see its rooms by floor, check dates and block rooms booked outside NoLSAF.</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {[
              { label: "Properties", value: String(properties.length), Icon: Building2 },
              { label: "Rooms", value: String(roomsAll), Icon: BedDouble },
              { label: "Free tonight", value: todayLoaded ? String(sumToday("totalAvailableRooms")) : "...", Icon: Sparkles },
              { label: "Booked tonight", value: todayLoaded ? String(sumToday("totalBookedRooms")) : "...", Icon: CalendarDays },
            ].map((s) => (
              <div key={s.label} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  <s.Icon className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden /> {s.label}
                </span>
                <span className="mt-1 block text-2xl font-bold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-slate-600">
          <span className="font-bold text-slate-900">{visible.length}</span> {visible.length === 1 ? "property" : "properties"}
        </p>
        {properties.length > 3 ? (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search properties</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or area"
              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
            />
          </label>
        ) : null}
      </div>

      {/* ── Properties ── */}
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((property) => {
          const structure = extractBuildingStructure(property);
          const totalRooms = structure.reduce((sum, f) => sum + f.totalRooms, 0);
          const location = [property.city, property.district, property.regionName].filter(Boolean).join(", ");
          const cover = Array.isArray(property.photos) && property.photos.length > 0 ? property.photos[0] : null;
          const avail = availabilityByPropertyId[property.id];
          const avLoading = availabilityLoadingByPropertyId[property.id];
          const today = avail?.today;
          const total = Number(today?.totalRooms ?? totalRooms) || 0;
          const pct = (n: number | undefined) => (total > 0 && typeof n === "number" ? Math.round((n / total) * 100) : 0);
          const show = (v: number | undefined, isLoading?: boolean) => (typeof v === "number" ? String(v) : isLoading ? "..." : "0");

          return (
            <li key={property.id}>
              <Link
                href={`/owner/properties/${property.id}/availability`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-300/80 bg-white no-underline shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#02665e]/40 hover:shadow-[0_22px_44px_-26px_rgba(1,42,38,0.5)]"
              >
                {/* Photo */}
                <div className="relative h-32 overflow-hidden bg-slate-100">
                  {cover ? (
                    <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.04]" style={{ backgroundImage: `url(${cover})` }} />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-slate-400"><Building2 className="h-8 w-8" aria-hidden /></div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-800">{totalRooms} rooms</span>
                    <span className="rounded-full bg-[#012a26]/85 px-2.5 py-1 text-[11px] font-bold text-[#5eead4]">{structure.length} {structure.length === 1 ? "floor" : "floors"}</span>
                  </div>
                  <div className="absolute inset-x-3 bottom-2.5 text-white">
                    <p className="m-0 truncate text-base font-bold">{property.title}</p>
                    <p className="m-0 flex items-center gap-1 truncate text-[11px] text-white/80">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {location || "Location not set"}
                    </p>
                  </div>
                </div>

                {/* Tonight */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tonight</p>
                    <p className="m-0 text-[11px] text-slate-500">
                      {typeof today?.overallAvailabilityPercentage === "number" ? `${today.overallAvailabilityPercentage}% open` : ""}
                    </p>
                  </div>
                  <p className="m-0 mt-1 flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold tabular-nums text-slate-900">{show(today?.totalAvailableRooms, avLoading?.today)}</span>
                    <span className="text-sm text-slate-500">of {total} free</span>
                  </p>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <span className="h-full bg-amber-400" style={{ width: `${pct(today?.totalBookedRooms)}%` }} />
                    <span className="h-full bg-slate-400" style={{ width: `${pct(today?.totalBlockedRooms)}%` }} />
                    <span className="h-full bg-[#5eead4]" style={{ width: `${pct(today?.totalAvailableRooms)}%` }} />
                  </div>

                  {/* Booked and blocked, today / week / month */}
                  <table className="mt-4 w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
                        <th className="pb-1.5 text-left font-semibold" />
                        <th className="pb-1.5 text-right font-semibold">Today</th>
                        <th className="pb-1.5 text-right font-semibold">Week</th>
                        <th className="pb-1.5 text-right font-semibold">Month</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-0 border-t border-slate-100">
                        <td className="py-1.5 text-slate-600"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" aria-hidden />Booked</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{show(avail?.today?.totalBookedRooms, avLoading?.today)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{show(avail?.week?.totalBookedRooms, avLoading?.week)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{show(avail?.month?.totalBookedRooms, avLoading?.month)}</td>
                      </tr>
                      <tr className="border-0 border-t border-slate-100">
                        <td className="py-1.5 text-slate-600"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" aria-hidden />Blocked</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{show(avail?.today?.totalBlockedRooms, avLoading?.today)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{show(avail?.week?.totalBlockedRooms, avLoading?.week)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{show(avail?.month?.totalBlockedRooms, avLoading?.month)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <span className="mt-auto pt-4">
                    <span className="flex h-10 items-center justify-between rounded-xl bg-[#012a26] pl-4 pr-1.5 text-sm font-bold text-white transition group-hover:bg-[#02665e]">
                      Open availability
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#5eead4] text-[#012a26] transition group-hover:translate-x-0.5">
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </span>
                    </span>
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
