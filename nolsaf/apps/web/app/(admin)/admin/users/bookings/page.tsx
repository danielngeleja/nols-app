"use client";
import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown, User, Building2, CreditCard, Clock, ExternalLink, Search } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

type Row = {
  id: number;
  /** Opaque id for the booking URL. */
  reference?: string;
  status: string;
  checkIn: string;
  checkOut: string;
  guestName?: string | null;
  roomCode?: string | null;
  totalAmount: number;
  property: { id: number; title: string; ownerId: number };
  code?: { id: number; code: string; status: string } | null;
  user?: { id: number; name: string; email: string } | null;
};

function badgeClasses(v: string) {
  switch (v) {
    case "CONFIRMED":
      return "bg-blue-100 text-blue-700";
    case "PENDING_CHECKIN":
      return "bg-amber-100 text-amber-700";
    case "CHECKED_IN":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function _CompletedStatusBadge({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  const label =
    s === "CONFIRMED" ? "Paid" : s === "PENDING_CHECKIN" ? "Waiting" : s === "CHECKED_IN" ? "Checked In" : s || "Unknown";
  const cls = badgeClasses(s);
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`} title={label} aria-label={`Status: ${label}`}>
      {label}
    </span>
  );
}

function CompletedStatusIcon({ status }: { status: string }) {
  const s = String(status || "").toUpperCase();
  const config =
    s === "CONFIRMED"
      ? { Icon: CreditCard, label: "Paid", cls: "text-blue-600" }
      : s === "PENDING_CHECKIN"
        ? { Icon: Clock, label: "Waiting check-in", cls: "text-amber-600" }
        : s === "CHECKED_IN"
          ? { Icon: Calendar, label: "Checked in", cls: "text-emerald-600" }
          : { Icon: Calendar, label: s || "Unknown", cls: "text-gray-500" };

  const Icon = config.Icon;
  return (
    <span
      className="inline-flex items-center justify-center"
      title={config.label}
      aria-label={`Status: ${config.label}`}
    >
      <Icon className={`h-4 w-4 ${config.cls}`} />
      <span className="sr-only">{config.label}</span>
    </span>
  );
}

// Skeleton components
// Table skeleton shows animated placeholder rows with staggered delays
// Each row has pulsing gray boxes matching the actual table structure
function TableSkeleton() {
  return (
    <div className="hidden sm:block overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Booking</th>
            <th className="px-3 py-2 text-left font-medium">Guest</th>
            <th className="px-3 py-2 text-left font-medium">Property / Room</th>
            <th className="px-3 py-2 text-left font-medium">Amount</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Check‑in</th>
            <th className="px-3 py-2 text-left font-medium">Check‑out</th>
            <th className="px-3 py-2 text-left font-medium">Nights</th>
            <th className="px-3 py-2 text-left font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i} className="border-t animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
              <td className="px-3 py-3 align-top">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-32"></div>
                  <div className="h-3 bg-gray-200 rounded w-40"></div>
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-36"></div>
                  <div className="h-3 bg-gray-200 rounded w-20"></div>
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="h-6 bg-gray-200 rounded-full w-20"></div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="h-4 bg-gray-200 rounded w-12"></div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="h-7 bg-gray-200 rounded w-16"></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="sm:hidden space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm animate-pulse"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 space-y-2">
              <div className="h-5 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="h-4 bg-gray-200 rounded w-20"></div>
              <div className="h-6 bg-gray-200 rounded-full w-24"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Modern Button Components
type FilterButtonProps = {
  label: string;
  value: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  badgeClass: string;
};

function FilterButton({ label, value: _value, count, isActive, onClick, badgeClass }: FilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`Filter ${label} bookings`}
      className={`
        relative px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium
        transition-all duration-300 ease-out
        flex items-center gap-1.5 sm:gap-2
        overflow-hidden whitespace-nowrap
        ${isActive
          ? 'bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 border-2 border-indigo-200 shadow-md scale-105'
          : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm'
        }
        transform hover:scale-105 active:scale-100
      `}
    >
      {/* Animated background on active */}
      {isActive && (
        <span className="absolute inset-0 bg-gradient-to-r from-indigo-100/50 to-blue-100/50 animate-pulse" />
      )}
      <span className="relative z-10 truncate">{label}</span>
      <span className={`relative z-10 text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-semibold transition-all duration-300 flex-shrink-0 ${badgeClass} ${isActive ? 'scale-110' : ''}`}>
        {count}
      </span>
      {/* Ripple effect on click */}
      {isActive && (
        <span className="absolute inset-0 bg-indigo-200/30 rounded-xl animate-ping opacity-75" />
      )}
    </button>
  );
}

type ActionButtonProps = {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  className?: string;
};

function ActionButton({ 
  href, 
  onClick, 
  children, 
  variant = 'primary', 
  size = 'md',
  icon,
  iconPosition = 'right',
  className = ''
}: ActionButtonProps) {
  const baseClasses = `
    relative inline-flex items-center justify-center gap-2
    font-medium rounded-xl
    transition-all duration-300 ease-out
    transform hover:scale-105 active:scale-100
    overflow-hidden group
    ${size === 'sm' ? 'px-3 py-1.5 text-xs' : size === 'md' ? 'px-4 py-2.5 text-sm' : 'px-6 py-3 text-base'}
  `;

  const variantClasses = {
    primary: `
      bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600
      text-white shadow-lg shadow-emerald-500/30
      hover:shadow-xl hover:shadow-emerald-500/40
      hover:from-emerald-700 hover:via-teal-700 hover:to-emerald-700
      before:absolute before:inset-0 before:bg-gradient-to-r before:from-white/0 before:via-white/20 before:to-white/0
      before:translate-x-[-100%] hover:before:translate-x-[100%] before:transition-transform before:duration-700
    `,
    secondary: `
      bg-white text-gray-700 border-2 border-gray-200
      hover:border-gray-300 hover:bg-gray-50 hover:shadow-md
    `,
    ghost: `
      text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50
    `
  };

  const content = (
    <>
      {/* Shimmer effect */}
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
      
      {/* Content */}
      <span className="relative z-10 flex items-center gap-2">
        {icon && iconPosition === 'left' && <span className="transition-transform group-hover:scale-110">{icon}</span>}
        <span>{children}</span>
        {icon && iconPosition === 'right' && <span className="transition-transform group-hover:translate-x-1">{icon}</span>}
      </span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
    >
      {content}
    </button>
  );
}

type ToggleButtonProps = {
  isOpen: boolean;
  onClick: () => void;
  openLabel?: string;
  closeLabel?: string;
};

function ToggleButton({ isOpen, onClick, openLabel = 'Details', closeLabel = 'Hide' }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      className="
        relative inline-flex items-center gap-1.5
        px-3 py-1.5 rounded-lg
        text-xs font-medium
        text-indigo-600 hover:text-indigo-700
        bg-indigo-50/50 hover:bg-indigo-50
        border border-indigo-100 hover:border-indigo-200
        transition-all duration-300 ease-out
        transform hover:scale-105 active:scale-100
        group
      "
    >
      <span className="relative z-10">{isOpen ? closeLabel : openLabel}</span>
      <span className={`relative z-10 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
        <ChevronDown className="h-3.5 w-3.5" />
      </span>
      {/* Hover glow effect */}
      <span className="absolute inset-0 bg-indigo-100/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-sm" />
    </button>
  );
}

export default function UserBookingsPage() {
  const [status, setStatus] = useState<string>("");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  function toggleMobile(id: number) {
    setOpenIds((p) => ({ ...(p || {}), [id]: !p[id] }));
  }

  async function load() {
    try {
      setLoading(true);
      authify();

      const baseParams: any = { page: "1", pageSize: "100" };
      if (date) {
        if (Array.isArray(date) && date.length === 2) {
          baseParams.date = date[0];
        } else if (typeof date === "string") {
          baseParams.date = date;
        }
      }
      if (q) baseParams.q = q;

      const fetchStatus = async (st: string) => {
        const r = await api.get("/api/admin/bookings", { params: { ...baseParams, status: st } });
        const items = Array.isArray(r.data?.items) ? (r.data.items as Row[]) : [];
        // Backend treats status=CHECKED_IN as (CHECKED_IN + PENDING_CHECKIN). For this page,
        // keep the UX strict.
        if (st === "CHECKED_IN") return items.filter((b) => b.status === "CHECKED_IN");
        return items.filter((b) => b.status === st);
      };

      let next: Row[] = [];

      if (status) {
        next = await fetchStatus(status);
      } else {
        const [paid, waiting, checkedIn] = await Promise.all([
          fetchStatus("CONFIRMED"),
          fetchStatus("PENDING_CHECKIN"),
          fetchStatus("CHECKED_IN"),
        ]);
        next = [...paid, ...waiting, ...checkedIn];
      }

      // Sort newest-first (stable-ish)
      next.sort((a, b) => Number(b.id) - Number(a.id));
      setList(next);
    } catch (err: any) {
      console.error("Failed to load bookings", err);
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCounts() {
    try {
      authify();

      const r = await api.get("/api/admin/bookings/counts");
      const data = r.data as Record<string, number>;
      const confirmed = Number(data?.CONFIRMED || 0);
      const pending = Number(data?.PENDING_CHECKIN || 0);
      const checkedIn = Number(data?.CHECKED_IN || 0);
      setCounts({
        "": confirmed + pending + checkedIn,
        CONFIRMED: confirmed,
        PENDING_CHECKIN: pending,
        CHECKED_IN: checkedIn,
      });
    } catch (err) {
      // ignore failures
    }
  }

  // initial load + socket attach
  useEffect(() => {
    authify();
    load();
    fetchCounts();

    // Use explicit socket URL for browser to ensure WebSocket works in dev
    const url = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
      : (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "");

    const s = io(url, {
      transports: ["websocket"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
    });

    socketRef.current = s;

    // Live refresh on important events (reload list + counts)
    const refresh = () => {
      // fire-and-forget
      load().catch(() => {});
      fetchCounts().catch(() => {});
    };
    s.on("connect", () => {
      // console.debug("socket connected", s.id);
    });
    s.on("disconnect", () => {
      // console.debug("socket disconnected");
    });

    // Emitted by backend in admin.bookings.ts
    s.on("admin:code:generated", refresh);
    s.on("admin:code:voided", refresh);
    s.on("booking.changed", refresh);

    return () => {
      s.off("admin:code:generated", refresh);
      s.off("admin:code:voided", refresh);
      s.off("booking.changed", refresh);
      s.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload when filters change
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, date, q]);

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shimmer {
          0% {
            background-position: -1000px 0;
          }
          100% {
            background-position: 1000px 0;
          }
        }
        @keyframes pulse-glow {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.05);
          }
        }
        .animate-fade-in {
          animation: fadeInUp 0.4s ease-out;
        }
        .animate-in {
          animation: fadeInUp 0.2s ease-out;
        }
        .zoom-in-95 {
          animation: fadeInUp 0.2s ease-out, scale 0.2s ease-out;
        }
      `}</style>
      {/* Header - Centered */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center justify-center rounded-full bg-indigo-50 p-3 mb-4">
            <Calendar className="h-8 w-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 mb-2">
            User Bookings
          </h1>
          <p className="text-sm sm:text-base text-gray-600 max-w-2xl">
            View all completed bookings: paid, checked-in, and waiting to check-in
          </p>
        </div>
      </div>

      {/* Filters - Modernized & Centered */}
      <div className="w-full max-w-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-6 w-full box-border">
          {/* Filter Buttons - Centered */}
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
            {[
              { label: 'All', value: '' },
              { label: 'Paid', value: 'CONFIRMED' },
              { label: 'Waiting Check-in', value: 'PENDING_CHECKIN' },
              { label: 'Checked In', value: 'CHECKED_IN' },
            ].map((s) => (
              <FilterButton
                key={s.value}
                label={s.label}
                value={s.value}
                count={counts[s.value] ?? 0}
                isActive={status === s.value}
                onClick={() => { setStatus(s.value); setTimeout(() => load(), 0); }}
                badgeClass={badgeClasses(s.value)}
              />
            ))}
          </div>

          {/* Date Picker and Search - Centered Row */}
          <div className="w-full flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-center">
            {/* Date Picker Button */}
            <div className="relative w-full sm:w-auto flex-shrink-0">
              <button
                type="button"
                aria-label="Open date picker"
                title="Pick a date"
                onClick={() => {
                  setPickerAnim(true);
                  window.setTimeout(() => setPickerAnim(false), 350);
                  setPickerOpen((v) => !v);
                }}
                className={`
                  relative w-full sm:w-auto h-[42px] px-5 py-2.5 rounded-xl
                  border border-gray-200 bg-white
                  text-gray-700 text-sm font-medium
                  flex items-center justify-center gap-2
                  transition-all duration-300 ease-out
                  hover:border-gray-300 hover:bg-gray-50 hover:shadow-md
                  transform hover:scale-105 active:scale-100
                  group whitespace-nowrap
                  ${pickerAnim ? 'ring-2 ring-indigo-100 scale-105' : ''}
                `}
              >
                <Calendar className={`h-4 w-4 transition-transform duration-300 flex-shrink-0 ${pickerOpen ? 'rotate-180' : ''}`} />
                <span className="hidden sm:inline">Pick Date</span>
                <span className="sm:hidden">Date</span>
                {/* Tooltip */}
                <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 hidden sm:block">
                  Pick a date
                </span>
              </button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setPickerOpen(false)} />
                  <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-in zoom-in-95 duration-200">
                    <DatePicker
                      selected={date || undefined}
                      onSelectAction={(s) => {
                        setDate(s as string | string[]);
                      }}
                      onCloseAction={() => setPickerOpen(false)}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Search Input - Matching Date Picker Size, Contained */}
            <div className="w-full sm:flex-1 min-w-0 max-w-full">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none z-10" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
                  placeholder="Search bookings..."
                  className={`w-full h-[42px] pl-10 pr-4 py-2.5 box-border border border-gray-200 rounded-xl bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all duration-200 placeholder:text-gray-400`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden transition-all duration-300">
        {loading ? (
          <>
            <TableSkeleton />
            <CardSkeleton />
          </>
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center animate-fade-in">
            <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No bookings found.</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <>
            {/* 
              Mobile Card Design Preview:
              ┌─────────────────────────────────────┐
              │ [#123] Property Title               │
              │ 👤 Guest Name                       │
              │ 📅 Nov 15 → Nov 20                 │
              │                                     │
              │                     150,000 TZS     │
              │                     [Paid] ✓        │
              │                     Details ▼        │
              ├─────────────────────────────────────┤
              │ Room: 101  Code: ABC123            │
              │ User: user@example.com              │
              │ [View Full Details]                 │
              └─────────────────────────────────────┘
              
              Features:
              - Gradient badge with booking ID
              - Status icons (CreditCard/Clock/Calendar)
              - Smooth expand/collapse animation
              - Hover effects with shadow elevation
              - Staggered fade-in animations
            */}
            {/* Mobile: Enhanced collapsible cards */}
            <div className="sm:hidden space-y-3 p-4">
              {list.map((b, index) => {
                const statusConfig = {
                  CONFIRMED: { icon: CreditCard, color: "blue", label: "Paid" },
                  PENDING_CHECKIN: { icon: Clock, color: "amber", label: "Waiting" },
                  CHECKED_IN: { icon: Calendar, color: "emerald", label: "Checked In" },
                }[b.status] || { icon: Calendar, color: "gray", label: b.status };
                
                const StatusIcon = statusConfig.icon;
                const isOpen = !!openIds[b.id];
                
                return (
                  <div
                    key={`m-${b.id}`}
                    className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-all duration-300 hover:border-gray-300 group"
                    style={{
                      animation: `fadeInUp 0.4s ease-out ${index * 50}ms both`,
                    }}
                  >
                    {/* Main card content */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Booking ID and Property */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold">
                              #{b.id}
                            </div>
                            <div className="font-semibold text-gray-900 truncate">{b.property.title}</div>
                          </div>
                        </div>
                        
                        {/* Guest Info */}
                        <div className="flex items-center gap-2 mb-2">
                          <User className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{b.guestName ?? b.user?.name ?? '-'}</span>
                        </div>
                        
                        {/* Dates */}
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Calendar className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          <span>{new Date(b.checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → {new Date(b.checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                      </div>
                      
                      {/* Right side: Amount, Status, Toggle */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <div className="text-sm font-semibold text-gray-900">
                          {new Intl.NumberFormat('en-US').format(b.totalAmount)} <span className="text-xs text-gray-500">TZS</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <StatusIcon 
                            className={`h-3.5 w-3.5 ${
                              statusConfig.color === 'blue' ? 'text-blue-500' :
                              statusConfig.color === 'amber' ? 'text-amber-500' :
                              statusConfig.color === 'emerald' ? 'text-emerald-500' :
                              'text-gray-500'
                            }`}
                          />
                          <span className="sr-only">{statusConfig.label}</span>
                        </div>
                        <ToggleButton
                          isOpen={isOpen}
                          onClick={() => toggleMobile(b.id)}
                        />
                      </div>
                    </div>
                    
                    {/* Expandable details section */}
                    <div
                      id={`booking-${b.id}-details`}
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        isOpen ? 'max-h-96 opacity-100 mt-4' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="pt-4 border-t border-gray-100 space-y-3">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5 text-gray-400" />
                            <div>
                              <div className="text-gray-500">Room</div>
                              <div className="font-medium text-gray-900">{b.roomCode ?? '-'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-3.5 w-3.5 flex items-center justify-center">
                              <span className="text-gray-400 text-xs">#</span>
                            </div>
                            <div>
                              <div className="text-gray-500">Code</div>
                              <div className="font-medium text-gray-900 font-mono">{b.code?.code ?? '-'}</div>
                            </div>
                          </div>
                        </div>
                        {b.user?.email && (
                          <div className="text-xs">
                            <div className="text-gray-500 mb-1">User Email</div>
                            <div className="font-medium text-gray-900 break-all">{b.user.email}</div>
                          </div>
                        )}
                        <div className="pt-2">
                          <ActionButton
                            href={`/admin/bookings/${b.reference ?? b.id}`}
                            variant="primary"
                            size="sm"
                            icon={<ExternalLink className="h-3.5 w-3.5" />}
                            iconPosition="right"
                          >
                            View Full Details
                          </ActionButton>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop/table: hidden on small screens */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Booking</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Guest</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Property / Room</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Check‑in</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Check‑out</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Nights</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b, index) => (
                    <tr
                      key={b.id}
                      className="border-b border-gray-100 hover:bg-gradient-to-r hover:from-gray-50 hover:to-white transition-all duration-200 group"
                      style={{
                        animation: `fadeInUp 0.4s ease-out ${index * 30}ms both`,
                      }}
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            #{b.id}
                          </div>
                          {b.code?.code && (
                            <div className="font-mono text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
                              {b.code.code}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-gray-900">{b.guestName ?? b.user?.name ?? '-'}</div>
                            {b.user?.email && (
                              <div className="text-xs text-gray-500 mt-0.5">{b.user.email}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <div>
                            <span className="font-medium text-gray-900">{b.property.title}</span>
                            {b.roomCode && (
                              <div className="text-xs text-gray-500 mt-0.5">Room: {b.roomCode}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-gray-900">
                          {new Intl.NumberFormat('en-US').format(b.totalAmount)} <span className="text-xs text-gray-500 font-normal">TZS</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <CompletedStatusIcon status={b.status} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-gray-700">
                          {new Date(b.checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-gray-700">
                          {new Date(b.checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                          {(() => {
                            try {
                              const d1 = new Date(b.checkIn);
                              const d2 = new Date(b.checkOut);
                              const nights = Math.max(0, Math.round((+d2 - +d1) / (1000 * 60 * 60 * 24)));
                              return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
                            } catch (e) {
                              return '-';
                            }
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <ActionButton
                            href={`/admin/bookings/${b.reference ?? b.id}`}
                            variant="primary"
                            size="sm"
                            icon={<ExternalLink className="h-3.5 w-3.5" />}
                            iconPosition="right"
                            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          >
                            View
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

