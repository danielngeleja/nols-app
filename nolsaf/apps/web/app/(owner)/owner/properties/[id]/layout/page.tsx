"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import apiClient from "@/lib/apiClient";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Calendar, RefreshCw, Home, Sparkles, X, Users, Clock, CheckCircle2, ShieldBan, Trash2, ExternalLink, Layers, BedDouble } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import DatePicker from "@/components/ui/DatePicker";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Door = { x:number; y:number; dir:"N"|"S"|"E"|"W" };
type Rect = { w:number; h:number };
type Pos = { x:number; y:number };
type RoomNode = {
  id:string; name:string; pos:Pos; size:Rect; doors:Door[];
  pricePerNight:number; photos:string[]; amenities:string[]; accessible:boolean; code:string;
};
type SpaceNode = { id:string; type:string; name?:string; pos:Pos; size:Rect };
type Floor = { id:string; label:string; size:Rect; rooms:RoomNode[]; spaces:SpaceNode[] };
type Layout = { version:1; metric:"cm"; entrances:{floor:string;space:string}[]; floors:Floor[] };

type AvItem = {
  code:string;
  busy:boolean;
  occupancyPct:number;  // 0..100
  nightsBooked:number;
  nightsTotal:number;
  bookings:{id:number;checkIn:string;checkOut:string;status:string;guestName:string | null;totalAmount:number | null}[];
};
type Availability = { window:{from:string;to:string}; rooms:AvItem[]; nightsTotal:number };

type OwnerAvailabilityBlock = {
  id: number;
  propertyId: number;
  propertyTitle?: string;
  startDate: string;
  endDate: string;
  roomCode: string | null;
  source: string | null;
  bedsBlocked: number | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

const getSocketUrl = () => {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  // Prefer IPv4 loopback in dev to avoid IPv6 ::1 binding issues on some systems.
  return typeof window !== "undefined" ? "http://127.0.0.1:4000" : "";
};

export default function OwnerPropertyLayoutPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const propertyId = Number(idParam);
  const [layout, setLayout] = useState<Layout|null>(null);
  const [activeFloor, setActiveFloor] = useState<string|undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<{ room: RoomNode; bookings: AvItem['bookings'] } | null>(null);
  const planWrapRef = useRef<HTMLDivElement | null>(null);
  const [planWrapSize, setPlanWrapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const planWrapElRef = useCallback((el: HTMLDivElement | null) => {
    planWrapRef.current = el;
  }, []);
  const [hoveredRoom, setHoveredRoom] = useState<RoomNode | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // date range for overlay
  const todayISO = new Date().toISOString().slice(0,10);
  const tomorrowISO = new Date(Date.now()+86400000).toISOString().slice(0,10);
  const [from, setFrom] = useState<string>(todayISO);
  const [to, setTo] = useState<string>(tomorrowISO);
  const [overlayRangePickerOpen, setOverlayRangePickerOpen] = useState(false);

  // Format date as "DD MMM YY" (e.g., "17 Jan 26")
  const formatDateShort = (dateStr: string): string => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = date.getDate();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const year = date.getFullYear() % 100; // Get 2-digit year
    return `${day} ${monthNames[date.getMonth()]} ${year}`;
  };

  // availability map
  const [availability, setAvailability] = useState<Record<string, AvItem>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  // External block (non-NoLSAF bookings)
  const [blockStart, setBlockStart] = useState<string>(todayISO);
  const [blockEnd, setBlockEnd] = useState<string>(tomorrowISO);
  const [blockRangePickerOpen, setBlockRangePickerOpen] = useState(false);
  const [blockSource, setBlockSource] = useState<string>("WALK_IN");
  const [blockAgreed, setBlockAgreed] = useState(false);
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockSuccess, setBlockSuccess] = useState<string | null>(null);
  const [roomBlocks, setRoomBlocks] = useState<OwnerAvailabilityBlock[]>([]);
  const [roomBlocksLoading, setRoomBlocksLoading] = useState(false);

  const loadRoomBlocks = useCallback(async (opts: { roomCode: string; startDate: string; endDate: string }) => {
    if (!Number.isFinite(propertyId) || propertyId <= 0) return;
    try {
      setRoomBlocksLoading(true);
      const r = await api.get<{ ok: true; blocks: OwnerAvailabilityBlock[] }>(`/api/owner/availability/blocks`, {
        params: {
          propertyId,
          startDate: opts.startDate,
          endDate: opts.endDate,
        },
      });
      const blocks = Array.isArray(r.data?.blocks) ? r.data.blocks : [];
      const windowStart = new Date(`${opts.startDate}T00:00:00`);
      const windowEnd = new Date(`${opts.endDate}T00:00:00`);

      const withinWindow = (b: OwnerAvailabilityBlock) => {
        const bs = new Date(`${String(b.startDate).slice(0, 10)}T00:00:00`);
        const be = new Date(`${String(b.endDate).slice(0, 10)}T00:00:00`);
        if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime()) || isNaN(bs.getTime()) || isNaN(be.getTime())) return false;
        // Overlap check for [start, end) windows (end treated as checkout)
        return bs < windowEnd && be > windowStart;
      };

      setRoomBlocks(
        blocks
          .filter((b) => String(b.roomCode || "") === String(opts.roomCode || ""))
          .filter(withinWindow)
      );
    } catch {
      // Non-blocking: blocks are optional UI
      setRoomBlocks([]);
    } finally {
      setRoomBlocksLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    if (!selectedRoom?.room?.code) return;
    setBlockError(null);
    setBlockSuccess(null);
    setBlockSource("WALK_IN");
    setBlockAgreed(false);
    setBlockStart(from);
    setBlockEnd(to);
  }, [selectedRoom, from, to, loadRoomBlocks]);

  // Keep the "Blocks in this window" list accurate as the user changes the external-block date range.
  useEffect(() => {
    if (!selectedRoom?.room?.code) return;
    if (!blockStart || !blockEnd) return;
    loadRoomBlocks({ roomCode: selectedRoom.room.code, startDate: blockStart, endDate: blockEnd });
  }, [selectedRoom?.room?.code, blockStart, blockEnd, loadRoomBlocks]);

  useEffect(()=>{
    if (!Number.isFinite(propertyId) || propertyId <= 0) return;
    (async()=>{
      try {
        setError(null);
        const r = await api.get<Layout| null>(`/api/owner/properties/${propertyId}/layout`);
        if (!r.data) {
          const g = await api.post<Layout>(`/api/owner/properties/${propertyId}/layout/generate`);
          setLayout(g.data);
          if (g.data.floors && g.data.floors.length > 0) {
            setActiveFloor(g.data.floors[0].id);
          }
        } else {
          setLayout(r.data);
          if (r.data.floors && r.data.floors.length > 0) {
            setActiveFloor(r.data.floors[0].id);
          }
        }
      } catch (e: any) {
        const msg = e?.response?.data?.error || e?.message || "Failed to load floor plan";
        setError(String(msg));
      }
      finally { setLoading(false); }
    })();
  },[propertyId]);

  const fetchAvailability = useCallback(async () => {
    if (!from || !to) return;
    try {
      setAvailabilityLoading(true);
      const r = await api.get<Availability>(`/api/owner/properties/${propertyId}/availability`, { params: { from, to }});
      const map: Record<string, AvItem> = {};
      for (const it of r.data.rooms) map[it.code] = it;
      setAvailability(map);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Failed to load availability overlay";
      setError(String(msg));
    } finally {
      setAvailabilityLoading(false);
    }
  }, [from, to, propertyId]);

  // Connect live updates when the page is open.
  useEffect(() => {
    if (!Number.isFinite(propertyId) || propertyId <= 0) return;
    const socketUrl = getSocketUrl();
    if (!socketUrl) return;

    const s = io(socketUrl, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socketRef.current = s;
    s.on("connect", () => {
      setConnected(true);
      s.emit("join-property-availability", { propertyId });
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    // Any availability update -> refresh overlay (best-effort)
    s.on("availability:update", (payload: any) => {
      if (payload?.propertyId && Number(payload.propertyId) !== propertyId) return;
      fetchAvailability();
    });

    return () => {
      try {
        s.emit("leave-property-availability", { propertyId });
      } catch {}
      s.disconnect();
      socketRef.current = null;
    };
  }, [propertyId, fetchAvailability]);

  useEffect(() => {
    if (layout) {
      fetchAvailability();
    }
  }, [layout, fetchAvailability]);

  const floor = useMemo(()=> {
    if (!layout || !layout.floors || layout.floors.length === 0) return null;
    // Find floor by activeFloor, or default to first floor
    const result = layout.floors.find(f=>f.id===activeFloor) ?? layout.floors[0];
    return result;
  }, [layout, activeFloor]);

  useEffect(() => {
    const el = planWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      setPlanWrapSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, activeFloor]);

  const planViewBox = useMemo(() => {
    if (!floor) return "0 0 100 100";
    const pad = 48;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const considerRect = (x: number, y: number, w: number, h: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };

    for (const s of floor.spaces || []) {
      considerRect(s.pos.x, s.pos.y, s.size.w, s.size.h);
    }
    for (const r of floor.rooms || []) {
      considerRect(r.pos.x, r.pos.y, r.size.w, r.size.h);
      for (const d of r.doors || []) {
        considerRect(d.x - 14, d.y - 14, 28, 28);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return `0 0 ${floor.size.w} ${floor.size.h}`;
    }

    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    return `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
  }, [floor]);

  const hoveredMeta = useMemo(() => {
    if (!hoveredRoom) return null;
    const av = availability[hoveredRoom.code];
    const pct = av?.occupancyPct ?? 0;
    const isFullyBusy = pct >= 80;
    const isPartial = pct > 0 && pct < 80;
    const label = isFullyBusy ? "Busy" : isPartial ? `${pct}% Booked` : "Free";
    return {
      label,
      pct,
      price: new Intl.NumberFormat(undefined, { style: "currency", currency: "TZS" }).format(hoveredRoom.pricePerNight),
      bookingsCount: av?.bookings?.length ?? 0,
      nightsBooked: av?.nightsBooked ?? 0,
      nightsTotal: av?.nightsTotal ?? 0,
    };
  }, [hoveredRoom, availability]);

  if (loading) return (
    <div className="relative min-h-screen bg-slate-950 rounded-3xl overflow-hidden border border-white/5 shadow-2xl shadow-black/40">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-9 w-28 rounded-xl bg-white/8 animate-pulse" />
          <div className="h-8 w-48 rounded-xl bg-white/8 animate-pulse" />
        </div>
        <div className="h-32 rounded-3xl bg-white/5 border border-white/10 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-4">
            {[0,1,2].map(i => <div key={i} className="h-28 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />)}
          </div>
          <div className="lg:col-span-8">
            <div className="h-[480px] rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 py-6 text-sm text-white/40">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading floor plan…</span>
        </div>
      </div>
    </div>
  );
  if (!layout || !layout.floors || layout.floors.length === 0) {
    return (
      <div className="relative min-h-screen bg-slate-950 rounded-3xl overflow-hidden border border-white/5 shadow-2xl shadow-black/40 flex items-center justify-center p-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 max-w-md w-full shadow-2xl shadow-black/40">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mb-5">
            <Layers className="w-6 h-6 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Floor plan unavailable</h1>
          {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
          <p className="mt-2 text-sm text-white/50">Try refreshing, or regenerate the layout from the property settings.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-sm font-semibold text-white hover:from-emerald-500 hover:to-teal-500 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
    );
  }
  if (!floor) {
    // If no floor is selected, select the first one
    if (layout.floors.length > 0 && !activeFloor) {
      setActiveFloor(layout.floors[0].id);
    }
    return (
      <div className="relative min-h-screen bg-slate-950 rounded-3xl overflow-hidden border border-white/5 shadow-2xl shadow-black/40 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-white/50">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span className="text-sm font-medium">Loading floor…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-950 rounded-3xl overflow-hidden border border-white/5 shadow-2xl shadow-black/40">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-[420px] w-[520px] rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href={`/owner/properties/${propertyId}/availability/manage`}
              className="no-underline mt-1 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition"
            >
              <ChevronLeft className="h-4 w-4" />
              Availability
            </Link>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Floor Plan</h1>
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${connected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-white/70"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-300 animate-pulse" : "bg-white/30"}`} />
                  {connected ? "Connected" : "Offline"}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70">
                  <Home className="h-3.5 w-3.5" />
                  {layout.floors.length} floors
                </span>
              </div>
              <p className="mt-1 text-sm text-white/60">See occupancy overlay and quickly jump between floors.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white transition"
              onClick={fetchAvailability}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition"
              onClick={async()=>{
                const r = await api.post<Layout>(`/api/owner/properties/${propertyId}/layout/generate`);
                setLayout(r.data);
                setActiveFloor(r.data.floors[0]?.id);
                fetchAvailability();
              }}
            >
              <Sparkles className="h-4 w-4" />
              Regenerate
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-4 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-white/70" />
                  <h2 className="text-sm font-semibold text-white">Overlay window</h2>
                </div>
                {availabilityLoading ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Refreshing…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Live
                  </span>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-white/60" htmlFor="date-from">From</label>
                  <button
                    type="button"
                    onClick={() => setOverlayRangePickerOpen(true)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10 hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:border-emerald-400/40 transition"
                    aria-label="Select from date"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{formatDateShort(from)}</span>
                      <Calendar className="h-4 w-4 text-white/50" />
                    </div>
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-white/60" htmlFor="date-to">To</label>
                  <button
                    type="button"
                    onClick={() => setOverlayRangePickerOpen(true)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10 hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:border-emerald-400/40 transition"
                    aria-label="Select to date"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{formatDateShort(to)}</span>
                      <Calendar className="h-4 w-4 text-white/50" />
                    </div>
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-white/50">Pick a date range — room colors update instantly to show occupancy.</p>
            </div>

            {overlayRangePickerOpen && (
              <>
                <div
                  className="fixed inset-0 z-[100] bg-black/50"
                  onClick={() => setOverlayRangePickerOpen(false)}
                  aria-hidden="true"
                />
                <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
                  <div className="pointer-events-auto">
                    <DatePicker
                      selected={from && to ? [from, to] : from ? [from] : undefined}
                      onSelectAction={(s) => {
                        if (Array.isArray(s) && s.length === 2) {
                          setFrom(s[0]);
                          setTo(s[1]);
                          setOverlayRangePickerOpen(false);
                          return;
                        }
                        const d = Array.isArray(s) ? s[0] : s;
                        if (d) {
                          setFrom(d);
                          setTo(d);
                        }
                      }}
                      onCloseAction={() => setOverlayRangePickerOpen(false)}
                      allowRange={true}
                      minDate="2000-01-01"
                      twoMonths
                      resetRangeAnchor
                    />
                  </div>
                </div>
              </>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Floors</h2>
                <span className="text-xs text-white/50">Switch view</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {layout.floors && layout.floors.length > 0 ? (
                  layout.floors.map(f=>{
                    const isActive = floor && f.id === floor.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                          isActive
                            ? "border-emerald-400/30 bg-emerald-400/10 text-white shadow-lg shadow-emerald-400/20"
                            : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white hover:border-white/20"
                        }`}
                        onClick={()=>{
                          setActiveFloor(f.id);
                        }}
                      >
                        {f.label}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-white/50">No floors available</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <h2 className="text-sm font-semibold text-white">Legend</h2>
              <div className="mt-4 space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-white/70"><ColorBox hex="#10b981" /> Free</span>
                  <span className="text-[10px] font-bold text-emerald-400/70 tabular-nums">0%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-white/70"><ColorBox hex="#f59e0b" /> Partial</span>
                  <span className="text-[10px] font-bold text-amber-400/70 tabular-nums">1–79%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-white/70"><ColorBox hex="#ef4444" /> Busy</span>
                  <span className="text-[10px] font-bold text-rose-400/70 tabular-nums">80–100%</span>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-white/40 leading-relaxed">% = nights booked ÷ nights in your selected window.</p>
            </div>
          </aside>

          <main className="lg:col-span-8 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm shadow-emerald-500/30 flex-shrink-0">
                    <Layers className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white leading-none">Floor Plan</h2>
                    <p className="mt-0.5 text-[11px] text-white/50">{floor.label}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                  <BedDouble className="w-3 h-3" />
                  {floor.rooms.length} rooms
                </span>
              </div>
              <p className="mt-3 text-xs text-white/50">Click a room to view bookings and open the full external booking form.</p>

              <div
                ref={planWrapElRef}
                className="relative mt-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 shadow-2xl shadow-black/50"
              >
                <div key={floor.id} className="w-full animate-in fade-in zoom-in-[0.99] duration-300">
                  <svg
                    className="w-full"
                    viewBox={planViewBox}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <defs>
                      {/* Pattern definition for fully booked rooms */}
                      <pattern id="booked-pattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                        <line x1="0" y1="0" x2="8" y2="8" stroke="#dc2626" strokeWidth="1" opacity="0.35" />
                      </pattern>

                      {/* Subtle grid to reduce the “blank canvas” feel */}
                      <pattern id="plan-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" strokeOpacity="0.04" strokeWidth="1" />
                      </pattern>

                      {/* Premium-ish soft shadow for room cards */}
                      <filter id="room-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0b1220" floodOpacity="0.18" />
                        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0b1220" floodOpacity="0.10" />
                      </filter>
                    </defs>

                    <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#plan-grid)" />
        {/* spaces */}
        {floor.spaces.map((s, spaceIndex)=>(
          <g key={s.id ? `space-${floor.id}-${s.id}` : `space-${floor.id}-${spaceIndex}`}>
            <rect
              x={s.pos.x}
              y={s.pos.y}
              width={s.size.w}
              height={s.size.h}
              fill="#1e293b"
              stroke="#334155"
              strokeWidth="1"
              rx="10"
            />
            <text
              x={s.pos.x + 12}
              y={s.pos.y + 22}
              fontSize="16"
              fill="#94a3b8"
              fontWeight="600"
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {s.name ?? s.type}
            </text>
          </g>
        ))}

        {/* rooms with gradient availability */}
        {floor.rooms.map((r, roomIndex)=>{
          const av = availability[r.code];
          const pct = av?.occupancyPct ?? 0; // 0..100
          const isBooked = pct > 0;
          const isFullyBooked = pct >= 100;
          // High-contrast, premium-ish palette (still intuitive)
          const fill = isFullyBooked ? "#2d1115" : isBooked ? "#2a1f0a" : "#0a2420";
          const stroke = isFullyBooked ? "#e11d48" : isBooked ? "#f59e0b" : "#10b981";
          const strokeWidth = isBooked ? 3 : 2;
          // Loading pulse: if availability is being refreshed, dim all rooms slightly
          const roomOpacity = availabilityLoading ? 0.55 : 1;
          const label = isFullyBooked ? "Fully Booked" : isBooked ? `${pct}% Booked` : "Available";
          const textColor = isFullyBooked ? "#fda4af" : isBooked ? "#fcd34d" : "#6ee7b7";
          const priceColor = "#cbd5e1";

          const margin = 14;
          const nameFont = Math.max(14, Math.min(22, Math.floor(r.size.h * 0.18)));
          const priceFont = Math.max(12, Math.min(18, Math.floor(r.size.h * 0.14)));
          const statusFont = Math.max(11, Math.min(16, Math.floor(r.size.h * 0.12)));
          const yName = r.pos.y + margin + nameFont;
          const yPrice = yName + priceFont + 8;
          const yStatus = yPrice + statusFont + 8;
          const clipId = `clip-room-${floor.id}-${r.code || r.id || roomIndex}`;
          const barW = Math.max(24, r.size.w - margin * 2);
          const barH = 9;
          const barX = r.pos.x + margin;
          const barY = r.pos.y + r.size.h - 16;
          const barFillW = Math.max(0, Math.min(barW, (barW * pct) / 100));

          return (
            <g
              key={`room-${floor.id}-${r.code || r.id || roomIndex}`}
              className="group cursor-pointer"
              role="button"
              tabIndex={0}
              opacity={roomOpacity}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              onClick={() => {
                setSelectedRoom({ room: r, bookings: av?.bookings || [] });
              }}
              onMouseEnter={() => {
                setHoveredRoom(r);
              }}
              onMouseLeave={() => {
                setHoveredRoom((cur) => (cur?.code === r.code ? null : cur));
                setHoverPos(null);
              }}
              onMouseMove={(e) => {
                const wrap = planWrapRef.current;
                if (!wrap) return;
                const rect = wrap.getBoundingClientRect();
                const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                setHoverPos({ x, y });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedRoom({ room: r, bookings: av?.bookings || [] });
                }
              }}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={r.pos.x} y={r.pos.y} width={r.size.w} height={r.size.h} rx="14" />
                </clipPath>
              </defs>
              <title>{`${r.name} — ${label}`}</title>
              <rect 
                x={r.pos.x} 
                y={r.pos.y} 
                width={r.size.w} 
                height={r.size.h} 
                fill={fill} 
                stroke={stroke} 
                strokeWidth={strokeWidth}
                rx="14"
                filter="url(#room-shadow)"
                className="transition-all duration-200 ease-out group-hover:opacity-95 group-hover:translate-y-[-2px] group-hover:scale-[1.01]"
              />
              {/* Loading pulse overlay */}
              {availabilityLoading && (
                <rect
                  x={r.pos.x} y={r.pos.y} width={r.size.w} height={r.size.h}
                  fill="#0f172a" opacity="0.45" rx="14"
                  className="animate-pulse"
                />
              )}
              {/* Pattern overlay for fully booked rooms */}
              {isFullyBooked && (
                <rect 
                  x={r.pos.x} 
                  y={r.pos.y} 
                  width={r.size.w} 
                  height={r.size.h} 
                  fill="url(#booked-pattern)"
                  opacity="0.25"
                />
              )}
              {r.doors.map((d, i)=>(
                <line
                  key={i}
                  x1={d.x - 10}
                  y1={d.y}
                  x2={d.x + 10}
                  y2={d.y}
                  stroke="#0f172a"
                  strokeOpacity="0.85"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ))}
              <g clipPath={`url(#${clipId})`}>
                {/* Room name */}
                <text
                  x={r.pos.x + margin}
                  y={yName}
                  fontSize={nameFont}
                  fill={textColor}
                  fontWeight="800"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  paintOrder="stroke"
                  stroke="#000000"
                  strokeOpacity="0.5"
                  strokeWidth="3"
                >
                  {r.name}
                </text>

                {/* Price */}
                <text
                  x={r.pos.x + margin}
                  y={yPrice}
                  fontSize={priceFont}
                  fill={priceColor}
                  fontWeight="700"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  paintOrder="stroke"
                  stroke="#000000"
                  strokeOpacity="0.4"
                  strokeWidth="2"
                >
                  {new Intl.NumberFormat(undefined, { style: "currency", currency: "TZS" }).format(r.pricePerNight)}
                </text>

                {/* Status */}
                <text
                  x={r.pos.x + margin}
                  y={Math.min(yStatus, r.pos.y + r.size.h - 14)}
                  fontSize={statusFont}
                  fill={textColor}
                  fontWeight="800"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  paintOrder="stroke"
                  stroke="#000000"
                  strokeOpacity="0.4"
                  strokeWidth="2"
                >
                  {label}
                </text>

                {/* Occupancy bar (adds premium detail + uses empty space) */}
                <rect x={barX} y={barY} width={barW} height={barH} rx="999" fill="#ffffff" opacity="0.65" />
                <rect x={barX} y={barY} width={barFillW} height={barH} rx="999" fill={stroke} opacity="0.95" />
              </g>
            </g>
          );
        })}
                  </svg>
                </div>
              </div>

              {hoveredRoom && hoveredMeta && hoverPos ? (
                <div
                  className="pointer-events-none absolute z-10"
                  style={(() => {
                    const tooltipW = 272;
                    const tooltipH = 104;
                    const pad = 12;
                    const w = planWrapSize.w || 0;
                    const h = planWrapSize.h || 0;
                    const maxLeft = Math.max(pad, w - tooltipW - pad);
                    const maxTop = Math.max(pad, h - tooltipH - pad);
                    const left = Math.min(Math.max(pad, hoverPos.x + 14), maxLeft);
                    const top = Math.min(Math.max(pad, hoverPos.y + 14), maxTop);
                    return { left, top };
                  })()}
                >
                  <div className="w-64 rounded-2xl border border-slate-200/70 bg-white/92 backdrop-blur px-4 py-3 shadow-2xl shadow-black/25 ring-1 ring-black/5">
                    <div className="text-sm font-extrabold text-slate-900 leading-tight">
                      {hoveredRoom.name}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        hoveredMeta.pct >= 80 ? "bg-rose-50 text-rose-700" :
                        hoveredMeta.pct > 0 ? "bg-amber-50 text-amber-700" :
                        "bg-emerald-50 text-emerald-700"
                      }`}>
                        {hoveredMeta.label}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600">
                        {hoveredMeta.price}
                      </span>
                    </div>
                    {hoveredMeta.nightsTotal > 0 ? (
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nights booked in window</span>
                          <span className="text-[11px] font-extrabold text-slate-800">{hoveredMeta.nightsBooked} / {hoveredMeta.nightsTotal}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              hoveredMeta.pct >= 80 ? "bg-rose-500" :
                              hoveredMeta.pct > 0 ? "bg-amber-400" :
                              "bg-emerald-500"
                            }`}
                            style={{ width: `${hoveredMeta.pct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] font-medium text-slate-500">
                        {hoveredMeta.bookingsCount} booking{hoveredMeta.bookingsCount === 1 ? "" : "s"} in window
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 text-xs text-white/50">Schematic plan (not for construction).</div>
            </div>
          </main>
        </div>
      </div>

      {/* Room Details Modal */}
      {selectedRoom && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-black/60 p-3 py-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-sm animate-in fade-in duration-200 sm:p-4 md:p-6">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-slate-200/60 bg-gradient-to-br from-white via-slate-50/30 to-white sm:px-5 sm:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-500/20 flex-shrink-0">
                    <Home className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                      {selectedRoom.room.name}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Room Code: {selectedRoom.room.code || "N/A"} • {selectedRoom.room.pricePerNight ? new Intl.NumberFormat(undefined,{style:"currency", currency:"TZS"}).format(selectedRoom.room.pricePerNight) : "Price N/A"} per night
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRoom(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all flex-shrink-0"
                  title="Close"
                  aria-label="Close room details"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {/* Reservations in selected window (classified) */}
              {(() => {
                const ws = new Date(`${blockStart}T00:00:00`);
                const we = new Date(`${blockEnd}T00:00:00`);
                const hasValidWindow = !isNaN(ws.getTime()) && !isNaN(we.getTime());
                const overlaps = (startIso: string, endIso: string) => {
                  const s = new Date(`${String(startIso).slice(0, 10)}T00:00:00`);
                  const e = new Date(`${String(endIso).slice(0, 10)}T00:00:00`);
                  if (!hasValidWindow || isNaN(s.getTime()) || isNaN(e.getTime())) return false;
                  return s < we && e > ws;
                };

                const bookingsInWindow = (Array.isArray(selectedRoom.bookings) ? selectedRoom.bookings : []).filter((b: any) =>
                  overlaps(b.checkIn, b.checkOut)
                );

                const hasAny = bookingsInWindow.length > 0 || roomBlocks.length > 0;

                return (
                  <div className="mb-6">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-emerald-600" />
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 uppercase tracking-wider">Reservations in this window</h3>
                      </div>
                      <div className="text-xs font-semibold text-slate-600">
                        {new Date(blockStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(blockEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        <span className="text-slate-500"> (end date is checkout)</span>
                      </div>
                    </div>

                    {!hasAny ? (
                      <div className="text-center py-8 text-slate-500">
                        <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500 opacity-50" />
                        <p className="text-sm font-medium">No reservations found</p>
                        <p className="text-xs mt-1">This room is available for the selected period</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {/* NoLSAF bookings */}
                        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                          <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100">
                                <Home className="h-4 w-4 text-emerald-700" />
                              </span>
                              <div className="text-xs font-extrabold uppercase tracking-wider text-slate-800">NoLSAF bookings</div>
                            </div>
                            <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
                              {bookingsInWindow.length}
                            </span>
                          </div>

                          <div className="p-4">
                            {bookingsInWindow.length === 0 ? (
                              <div className="text-sm text-slate-500">No NoLSAF bookings in this window.</div>
                            ) : (
                              <div className="space-y-3">
                                {bookingsInWindow.map((booking: any) => (
                                  <div
                                    key={booking.id}
                                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 hover:bg-slate-50 transition"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-2">
                                          <Users className="w-4 h-4 text-slate-600" />
                                          <p className="text-sm font-semibold text-slate-900 truncate">
                                            {booking.guestName || "Guest"}
                                          </p>
                                          <span
                                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                              booking.status === "CONFIRMED"
                                                ? "bg-emerald-100 text-emerald-700"
                                                : booking.status === "CHECKED_IN"
                                                ? "bg-blue-100 text-blue-700"
                                                : booking.status === "CHECKED_OUT"
                                                ? "bg-slate-100 text-slate-700"
                                                : "bg-amber-100 text-amber-700"
                                            }`}
                                          >
                                            {booking.status}
                                          </span>
                                        </div>
                                        <div className="space-y-1.5 text-xs sm:text-sm text-slate-600">
                                          <div className="flex items-center gap-2">
                                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                                            <span>
                                              <span className="font-medium">Check-in:</span> {new Date(booking.checkIn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                                            <span>
                                              <span className="font-medium">Check-out:</span> {new Date(booking.checkOut).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                            </span>
                                          </div>
                                          {booking.totalAmount && booking.totalAmount > 0 && (
                                            <div className="flex items-center gap-2 mt-1">
                                              <span className="text-xs font-medium text-emerald-700">
                                                Amount: {new Intl.NumberFormat(undefined, { style: "currency", currency: "TZS" }).format(booking.totalAmount)}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* External blocks */}
                        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                          <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 border border-amber-100">
                                <ShieldBan className="h-4 w-4 text-amber-700" />
                              </span>
                              <div className="text-xs font-extrabold uppercase tracking-wider text-slate-800">External blocks</div>
                            </div>
                            <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
                              {roomBlocks.length}
                            </span>
                          </div>

                          <div className="p-4">
                            {roomBlocks.length === 0 ? (
                              <div className="text-sm text-slate-500">No external blocks in this window.</div>
                            ) : (
                              <div className="space-y-3">
                                {roomBlocks.map((b) => (
                                  <div key={b.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-slate-900">
                                        {(b.source || "External").replaceAll("_", " ")} • {new Date(b.startDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(b.endDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                      </p>
                                      {b.notes ? <p className="mt-1 text-xs text-slate-600 break-words">{b.notes}</p> : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          setBlockError(null);
                                          await api.delete(`/api/owner/availability/blocks/${b.id}`);
                                          if (selectedRoom?.room?.code) {
                                            await loadRoomBlocks({ roomCode: selectedRoom.room.code, startDate: blockStart, endDate: blockEnd });
                                          }
                                          fetchAvailability();
                                        } catch (e: any) {
                                          const msg = e?.response?.data?.error || e?.message || "Failed to delete block";
                                          setBlockError(String(msg));
                                        }
                                      }}
                                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-700 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 transition"
                                      title="Remove block"
                                      aria-label="Remove block"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* External block / non-NoLSAF booking */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldBan className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 uppercase tracking-wider">External Booking</h3>
                </div>
                <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-5 sm:p-6 shadow-sm">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
                  <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-100/70 to-cyan-100/40 blur-2xl" />
                  <div className="pointer-events-none absolute -left-24 -bottom-24 h-56 w-56 rounded-full bg-gradient-to-br from-slate-100/70 to-emerald-100/40 blur-2xl" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-base font-extrabold text-slate-900 tracking-tight">Use the full external booking form</p>
                      <p className="mt-1 text-xs sm:text-sm text-slate-600">
                        This keeps guest details, nationality, payment, paid via, date validation, and room availability checks in one clean flow.
                      </p>
                      <div className="hidden">
                        <button
                          type="button"
                          onClick={() => setBlockRangePickerOpen(true)}
                          className="group inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/80 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 shadow-sm hover:shadow-md hover:bg-white transition"
                          aria-label="Select block date range"
                        >
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100">
                            <Calendar className="h-4 w-4 text-[#02665e]" />
                          </span>
                          {new Date(blockStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(blockEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </button>
                        <span className="text-[11px] text-slate-500">(end date is checkout)</span>
                      </div>
                    </div>

                    <Link
                      href={`/owner/properties/${propertyId}/availability?externalBlock=1${selectedRoom.room.code ? `&roomCode=${encodeURIComponent(selectedRoom.room.code)}` : ""}`}
                      className="no-underline inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-extrabold text-white shadow-[0_14px_38px_-24px_rgba(2,102,94,0.75)] ring-1 ring-inset ring-white/20 hover:to-cyan-600 active:scale-[0.99] transition sm:w-auto"
                    >
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/12 ring-1 ring-inset ring-white/20">
                        <ExternalLink className="h-4 w-4" />
                      </span>
                      <span className="whitespace-nowrap tracking-tight">Add External Booking</span>
                    </Link>

                    <div className="hidden">
                      <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                        <label className="block text-xs font-semibold text-slate-700">Source</label>
                        <select
                          value={blockSource}
                          onChange={(e) => setBlockSource(e.target.value)}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        >
                          <option value="WALK_IN">Walk-in</option>
                          <option value="AIRBNB">Airbnb</option>
                          <option value="BOOKING_COM">Booking.com</option>
                          <option value="AGENT">Agent</option>
                          <option value="OTHER">Other</option>
                        </select>

                        <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white/70 p-3 shadow-sm">
                          <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={blockAgreed}
                              onChange={(e) => setBlockAgreed(e.target.checked)}
                              className="peer sr-only"
                            />
                            <span
                              aria-hidden="true"
                              className="mt-0.5 relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border border-slate-400 bg-slate-300 shadow-inner transition-colors peer-checked:border-emerald-600 peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40"
                            >
                              <span className="inline-block h-5 w-5 translate-x-1 rounded-full bg-white shadow-sm ring-1 ring-slate-300 transition-transform peer-checked:translate-x-6 peer-checked:ring-emerald-700/20" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-800">I agree to the external block terms</div>
                              <div className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                                I confirm this is an outside booking (walk-in/Airbnb/Booking.com/etc). This will mark the room as unavailable on NoLSAF for the selected dates.
                              </div>
                            </div>
                          </label>
                        </div>

                        <button
                          type="button"
                          disabled={blockSaving || !blockAgreed}
                          onClick={async () => {
                          try {
                            setBlockError(null);
                            setBlockSuccess(null);
                            if (!selectedRoom?.room?.code) return;
                            if (!blockAgreed) {
                              setBlockError("Please agree to the terms before blocking this room.");
                              return;
                            }
                            if (!blockStart || !blockEnd) {
                              setBlockError("Please select a valid date range.");
                              return;
                            }
                              const sd = new Date(`${blockStart}T00:00:00`);
                              let payloadEnd = blockEnd;
                              let ed = new Date(`${payloadEnd}T00:00:00`);
                              if (isNaN(sd.getTime()) || isNaN(ed.getTime())) {
                                setBlockError("Please select a valid date range.");
                                return;
                              }
                              // Treat end date as checkout; if same-day, default to one night.
                              if (ed <= sd) {
                                payloadEnd = addDaysISO(blockStart, 1);
                                setBlockEnd(payloadEnd);
                                ed = new Date(`${payloadEnd}T00:00:00`);
                              }
                            setBlockSaving(true);
                            await api.post(`/api/owner/availability/blocks`, {
                              propertyId,
                              startDate: blockStart,
                                endDate: payloadEnd,
                              roomCode: selectedRoom.room.code,
                              source: blockSource || null,
                              bedsBlocked: 1,
                            });
                            setBlockSuccess("Room blocked successfully.");
                              await loadRoomBlocks({ roomCode: selectedRoom.room.code, startDate: blockStart, endDate: payloadEnd });
                            fetchAvailability();
                          } catch (e: any) {
                              const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || "Failed to create block";
                            setBlockError(String(msg));
                          } finally {
                            setBlockSaving(false);
                          }
                          }}
                          className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2.5 text-[13px] font-extrabold leading-none text-white shadow-[0_14px_38px_-24px_rgba(2,102,94,0.75)] ring-1 ring-inset ring-white/20 hover:to-cyan-600 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:to-teal-600 transition"
                        >
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/12 ring-1 ring-inset ring-white/20">
                            <ExternalLink className="h-4 w-4" />
                          </span>
                          <span className="whitespace-nowrap tracking-tight">{blockSaving ? "Blocking…" : "Block This Room"}</span>
                        </button>

                        {blockError ? <div className="text-xs font-semibold text-rose-600 mt-3">{blockError}</div> : null}
                        {blockSuccess ? <div className="text-xs font-semibold text-emerald-700 mt-3">{blockSuccess}</div> : null}
                      </div>
                    </div>
                  </div>

                  {roomBlocksLoading ? <p className="mt-4 text-xs text-slate-500">Loading blocks…</p> : null}
                </div>
              </div>

              {blockRangePickerOpen && (
                <>
                  <div
                    className="fixed inset-0 z-[120] bg-black/50"
                    onClick={() => setBlockRangePickerOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="fixed inset-0 z-[121] flex items-center justify-center p-4 pointer-events-none">
                    <div className="pointer-events-auto">
                      <DatePicker
                        selected={blockStart && blockEnd ? [blockStart, blockEnd] : blockStart ? [blockStart] : undefined}
                        onSelectAction={(s) => {
                          if (Array.isArray(s) && s.length === 2) {
                            setBlockStart(s[0]);
                            setBlockEnd(s[1]);
                            setBlockRangePickerOpen(false);
                            return;
                          }
                          const d = Array.isArray(s) ? s[0] : s;
                          if (!d) return;
                          setBlockStart(d);
                          setBlockEnd((prev) => {
                            if (prev && prev > d) return prev;
                            return addDaysISO(d, 1);
                          });
                        }}
                        onCloseAction={() => setBlockRangePickerOpen(false)}
                        allowRange={true}
                        minDate="2000-01-01"
                        twoMonths
                        resetRangeAnchor
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Available Dates Calculation */}
              {selectedRoom.bookings.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 uppercase tracking-wider">Available Dates</h3>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
                    <p className="text-xs sm:text-sm text-slate-700">
                      Dates outside the booked periods shown above are available for new bookings.
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      Adjust the date range in the sidebar to see availability for different periods.
                    </p>
                  </div>
                </div>
              )}

              {/* Availability Period Info */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/30 p-4">
                <p className="text-xs sm:text-sm text-slate-600">
                  <span className="font-semibold">Viewing period:</span> {new Date(from).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} - {new Date(to).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Available dates are those not covered by the bookings listed above.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ---- small UI bits ---- */
function ColorBox({hex}:{hex:string}) {
  const boxRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.style.background = hex;
    }
  }, [hex]);

  return <span ref={boxRef} className="w-4 h-4 inline-block rounded"/>;
}
