"use client";

import { useEffect, useState, useMemo } from "react";
import apiClient from "@/lib/apiClient";
import {
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogOut,
  Search,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import LogoSpinner from "@/components/LogoSpinner";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Booking = {
  id: number;
  property: string; // Property title from API
  propertyId?: number;
  checkIn: string;
  checkOut: string;
  status: string;
  totalAmount: number | string;
  transportFare?: number | string | null;
  ownerBaseAmount?: number | string | null;
  guestName?: string | null;
  checkedInAt?: string | null;
};

type FilterTab = 'all' | 'recent' | 'waiting' | 'checked-in' | 'checked-out' | 'cancelled';

export default function OwnerBookingsPage() {
  const [list, setList] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [expandedHotels, setExpandedHotels] = useState<Set<string>>(new Set());
  const router = useRouter();
  const searchParams = useSearchParams();

  const isValidTab = (v: string | null): v is FilterTab =>
    v === 'all' || v === 'recent' || v === 'waiting' || v === 'checked-in' || v === 'checked-out' || v === 'cancelled';

  // Allow deep-linking from sidebar: /owner/bookings?tab=checked-out
  useEffect(() => {
    const tab = searchParams?.get('tab') ?? null;
    if (isValidTab(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams, activeTab]);

  useEffect(() => {
    let mounted = true;
    
    const loadBookings = async () => {
      try {
        // The reports API enforces a max window (~12 months). Keep the request within that
        // so we don't accidentally exclude current bookings due to server-side clamping.
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 180);
        const toDate = new Date();
        toDate.setDate(toDate.getDate() + 180);
        
        const response = await api.get('/api/owner/reports/bookings', {
          params: {
            from: fromDate.toISOString().split('T')[0],
            to: toDate.toISOString().split('T')[0],
          }
        });
        
        if (!mounted) return;
        
        // Extract bookings from the table data
        const bookings = response.data?.table || [];
        setList(bookings);
      } catch (err: any) {
        console.error('Failed to load bookings:', err);
        if (mounted) setList([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadBookings();
    return () => { mounted = false; };
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return null;
    }
  };

  const toggleHotel = (hotelKey: string) => {
    setExpandedHotels(prev => {
      const next = new Set(prev);
      if (next.has(hotelKey)) {
        next.delete(hotelKey);
      } else {
        next.add(hotelKey);
      }
      return next;
    });
  };

  const selectTab = (tab: FilterTab) => {
    setActiveTab(tab);
    try {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (tab === 'all') next.delete('tab');
      else next.set('tab', tab);
      router.replace(`/owner/bookings${next.toString() ? `?${next.toString()}` : ''}`);
    } catch {}
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-TZ', {
      style: 'currency',
      currency: 'TZS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Calculate counts for filter tabs
  const filterCounts = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    
    return {
      all: list.length,
      recent: list.filter(b => {
        const checkInDate = new Date(b.checkIn);
        return checkInDate >= thirtyDaysAgo && checkInDate <= thirtyDaysLater;
      }).length,
      waiting: list.filter(b => b.status.toUpperCase() === 'CONFIRMED').length,
      'checked-in': list.filter(b => b.status.toUpperCase() === 'CHECKED_IN').length,
      'checked-out': list.filter(b => b.status.toUpperCase() === 'CHECKED_OUT').length,
      cancelled: list.filter(b => 
        b.status.toUpperCase() === 'CANCELLED' || 
        b.status.toUpperCase() === 'CANCELED'
      ).length,
    };
  }, [list]);

  const propertyOptions = useMemo(() => {
    const unique = new Map<string, string>();
    list.forEach((booking) => {
      const key = booking.propertyId ? String(booking.propertyId) : booking.property;
      if (!unique.has(key)) unique.set(key, booking.property);
    });
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [list]);

  // Apply the status/time scope first, then the workspace search controls.
  const filteredBookings = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

    const scoped = list.filter((booking) => {
      switch (activeTab) {
        case 'recent': {
          const checkInDate = new Date(booking.checkIn);
          return checkInDate >= thirtyDaysAgo && checkInDate <= thirtyDaysLater;
        }
        case 'waiting':
          return booking.status.toUpperCase() === 'CONFIRMED';
        case 'checked-in':
          return booking.status.toUpperCase() === 'CHECKED_IN';
        case 'checked-out':
          return booking.status.toUpperCase() === 'CHECKED_OUT';
        case 'cancelled':
          return booking.status.toUpperCase() === 'CANCELLED' || booking.status.toUpperCase() === 'CANCELED';
        default:
          return true;
      }
    });

    const query = searchQuery.trim().toLowerCase();
    return scoped.filter((booking) => {
      const propertyKey = booking.propertyId ? String(booking.propertyId) : booking.property;
      if (propertyFilter !== 'all' && propertyKey !== propertyFilter) return false;
      if (!query) return true;
      return [booking.property, booking.guestName, String(booking.id)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [list, activeTab, propertyFilter, searchQuery]);

  // Group bookings by hotel/property
  const groupedBookings = useMemo(() => {
    const groups: Record<string, {
      property: string;
      propertyId?: number;
      bookings: Booking[];
      checkedIn: Booking[];
      notCheckedIn: Booking[];
    }> = {};

    filteredBookings.forEach(booking => {
      const key = booking.propertyId ? `${booking.propertyId}` : booking.property;
      if (!groups[key]) {
        groups[key] = {
          property: booking.property,
          propertyId: booking.propertyId,
          bookings: [],
          checkedIn: [],
          notCheckedIn: [],
        };
      }
      groups[key].bookings.push(booking);
      if (booking.status.toUpperCase() === 'CHECKED_IN') {
        groups[key].checkedIn.push(booking);
      } else if (booking.status.toUpperCase() === 'CONFIRMED') {
        // Only paid (CONFIRMED) bookings appear in Awaiting Arrival — never NEW (unpaid)
        groups[key].notCheckedIn.push(booking);
      }
    });

    return Object.entries(groups).map(([key, data]) => ({
      key,
      ...data,
    }));
  }, [filteredBookings]);

  const statusTabs: { key: Exclude<FilterTab, 'recent'>; label: string; icon: any; count: number }[] = [
    { key: 'all', label: 'All', icon: Calendar, count: filterCounts.all },
    { key: 'waiting', label: 'Awaiting arrival', icon: Clock, count: filterCounts.waiting },
    { key: 'checked-in', label: 'Checked in', icon: CheckCircle, count: filterCounts['checked-in'] },
    { key: 'checked-out', label: 'Checked out', icon: LogOut, count: filterCounts['checked-out'] },
    { key: 'cancelled', label: 'Cancelled', icon: XCircle, count: filterCounts.cancelled },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <div className="h-14 w-14 rounded-2xl bg-[#02665e]/10 border border-[#02665e]/20 flex items-center justify-center">
          <LogoSpinner size="md" ariaLabel="Loading bookings" />
        </div>
        <div className="text-center">
          <div className="text-base font-semibold text-slate-800">Loading your bookings…</div>
          <div className="text-sm text-slate-400 mt-1">Fetching activity across all properties</div>
        </div>
      </div>
    );
  }

  const totalCheckedIn   = list.filter(b => b.status.toUpperCase() === 'CHECKED_IN').length;
  const totalWaiting     = list.filter(b => b.status.toUpperCase() === 'CONFIRMED').length;
  const totalCheckedOut  = list.filter(b => b.status.toUpperCase() === 'CHECKED_OUT').length;
  const totalCancelled   = list.filter(b => b.status.toUpperCase() === 'CANCELLED' || b.status.toUpperCase() === 'CANCELED').length;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const bookingMetrics = [
    { label: 'Total bookings', value: filterCounts.all, icon: Calendar, tone: 'bg-slate-100 text-slate-700' },
    { label: 'Awaiting arrival', value: totalWaiting, icon: Clock, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Checked in', value: totalCheckedIn, icon: CheckCircle, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Checked out', value: totalCheckedOut, icon: LogOut, tone: 'bg-sky-50 text-sky-700' },
    { label: 'Cancelled', value: totalCancelled, icon: XCircle, tone: 'bg-rose-50 text-rose-700' },
  ];

  return (
    <div className="mx-auto w-full max-w-[88rem] px-3 py-4 sm:px-5 sm:py-6">
      <header className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              {/* breadcrumb label */}
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-block h-[3px] w-5 rounded-full bg-[#02665e]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#02665e]">Owner workspace</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-[1.75rem]">
                My bookings
              </h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Monitor arrivals, active stays and completed bookings.
              </p>
            </div>
            {/* today's date — hidden on very small screens */}
            <div className="hidden flex-shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 sm:flex sm:flex-col sm:items-end">
              <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Today</span>
              <span className="mt-0.5 text-right text-[13px] font-medium text-slate-700">{today}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Booking overview */}
      <div className="mt-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {bookingMetrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <button
                key={metric.label}
                type="button"
                onClick={() => {
                  const tab: FilterTab = metric.label === 'Awaiting arrival'
                    ? 'waiting'
                    : metric.label === 'Checked in'
                      ? 'checked-in'
                      : metric.label === 'Checked out'
                        ? 'checked-out'
                        : metric.label === 'Cancelled'
                          ? 'cancelled'
                          : 'all';
                  selectTab(tab);
                }}
                className="flex min-h-24 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
              >
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${metric.tone}`}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xl font-semibold tabular-nums leading-none text-slate-950">{metric.value}</span>
                  <span className="mt-1.5 block text-xs font-medium leading-tight text-slate-500">{metric.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search and filters */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Booking filters">
        <div className="grid gap-3 p-3 sm:grid-cols-[minmax(15rem,1fr)_minmax(12rem,0.5fr)_auto] sm:p-4">
          <label className="relative block">
            <span className="sr-only">Search bookings</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search guest, property or booking ID"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/10"
            />
          </label>

          <label className="relative block">
            <span className="sr-only">Filter by property</span>
            <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <select
              value={propertyFilter}
              onChange={(event) => setPropertyFilter(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-medium text-slate-700 outline-none transition focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/10"
            >
              <option value="all">All properties</option>
              {propertyOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            aria-pressed={activeTab === 'recent'}
            onClick={() => selectTab(activeTab === 'recent' ? 'all' : 'recent')}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 ${
              activeTab === 'recent'
                ? 'border-[#02665e] bg-[#02665e] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            30-day activity
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeTab === 'recent' ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
              {filterCounts.recent}
            </span>
          </button>
        </div>

        <div className="border-t border-slate-100 px-2 py-2">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Booking status">
            {statusTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    selectTab(tab.key);
                  }}
                  className={`inline-flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${
                    isActive
                      ? 'bg-[#02665e]/10 text-[#02665e]'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{tab.label}</span>
                  <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] ${isActive ? 'bg-[#02665e] text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Property groups */}
      <div className="space-y-3 pb-10 pt-4">
        <div className="mb-1 flex items-center gap-3 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">
            {filteredBookings.length} booking{filteredBookings.length === 1 ? '' : 's'} across {groupedBookings.length} propert{groupedBookings.length === 1 ? 'y' : 'ies'}
          </span>
          <div className="flex-1 h-px bg-slate-200/70" />
        </div>

        {groupedBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-8 py-16 text-center shadow-sm">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
              <Calendar className="h-7 w-7 text-slate-300" />
            </div>
            <p className="text-base font-semibold text-slate-800">No bookings found</p>
            <p className="mt-1 text-sm text-slate-500">Try another status, property or search term.</p>
            <button
              type="button"
              onClick={() => {
                selectTab('all');
                setPropertyFilter('all');
                setSearchQuery('');
              }}
              className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {groupedBookings.map((group) => {
              const isExpanded = expandedHotels.has(group.key);
              const hasNotCheckedIn = group.notCheckedIn.length > 0;
              const checkedOutBookings = group.bookings.filter(b => b.status.toUpperCase() === 'CHECKED_OUT');
              const cancelledBookings = group.bookings.filter(b => {
                const status = b.status.toUpperCase();
                return status === 'CANCELLED' || status === 'CANCELED';
              });
              const otherBookings   = group.bookings.filter(b => {
                const s = b.status.toUpperCase();
                // NEW (unpaid) is excluded from all owner views entirely
                return !['CHECKED_IN', 'CONFIRMED', 'CHECKED_OUT', 'CANCELLED', 'CANCELED', 'NEW'].includes(s);
              });
              const isLive = group.checkedIn.length > 0;

              // Show value for non-cancelled bookings; this is not accounting revenue.
              const groupBookingValue = group.bookings
                .filter((booking) => !['CANCELLED', 'CANCELED', 'NEW'].includes(booking.status.toUpperCase()))
                .reduce((sum, b) => {
                const v = Number(String(b.ownerBaseAmount ?? b.totalAmount ?? 0).replace(/,/g, ''));
                return sum + (Number.isFinite(v) && v > 0 ? v : 0);
              }, 0);

              const accentLine = isLive
                ? 'bg-emerald-500'
                : hasNotCheckedIn
                  ? 'bg-amber-400'
                  : cancelledBookings.length === group.bookings.length
                    ? 'bg-rose-400'
                    : 'bg-sky-400';

              return (
                <div
                  key={group.key}
                  className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(15,23,42,0.055)]"
                >
                  {/* ── Card header ── */}
                  <button
                    type="button"
                    onClick={() => toggleHotel(group.key)}
                    aria-expanded={isExpanded}
                    aria-controls={`property-bookings-${group.key}`}
                    className={`grid w-full !min-h-0 appearance-none !border-0 !outline-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-4 text-left transition-colors duration-150 hover:!bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#02665e]/30 sm:grid-cols-[minmax(0,1fr)_auto_20px] sm:px-6 ${isExpanded ? '!bg-[#f7fbfa]' : '!bg-white'}`}
                    style={{ border: 'none', boxShadow: 'none' }}
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className={`h-9 w-1 flex-none rounded-full ${accentLine}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium leading-tight text-slate-900 sm:text-[15px]">{group.property}</span>
                          {isLive && (
                            <span className="inline-flex flex-none items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Live
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-xs text-slate-500">
                            {group.bookings.length} booking{group.bookings.length === 1 ? '' : 's'}
                          </span>
                          {group.checkedIn.length > 0 && <ActivityLabel count={group.checkedIn.length} label="checked in" color="emerald" />}
                          {group.notCheckedIn.length > 0 && <ActivityLabel count={group.notCheckedIn.length} label="awaiting" color="amber" />}
                          {checkedOutBookings.length > 0 && <ActivityLabel count={checkedOutBookings.length} label="checked out" color="sky" />}
                          {cancelledBookings.length > 0 && <ActivityLabel count={cancelledBookings.length} label="cancelled" color="rose" />}
                          {otherBookings.length > 0 && <ActivityLabel count={otherBookings.length} label="other" color="slate" />}
                        </div>
                      </div>
                    </div>

                    <div className="hidden min-w-[9.5rem] text-right sm:block">
                      {groupBookingValue > 0 ? (
                        <>
                          <div className="text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">Confirmed value</div>
                          <div className="mt-0.5 text-sm font-medium tabular-nums text-slate-800">
                            {new Intl.NumberFormat('en-TZ', { style: 'currency', currency: 'TZS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(groupBookingValue)}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">No confirmed value</span>
                      )}
                    </div>

                    <div className="flex items-center justify-end">
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#02665e]' : ''}`} aria-hidden="true" />
                      <span className="sr-only">{isExpanded ? 'Collapse' : 'Expand'} {group.property}</span>
                    </div>

                    {groupBookingValue > 0 && (
                      <div className="col-span-2 pl-5 text-xs tabular-nums text-slate-500 sm:hidden">
                        Confirmed value <span className="ml-1 font-medium text-slate-800">{new Intl.NumberFormat('en-TZ', { style: 'currency', currency: 'TZS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(groupBookingValue)}</span>
                      </div>
                    )}
                  </button>

                  {/* ── Expanded content ── */}
                  {isExpanded && (
                    <PropertyBookingsTable
                      id={`property-bookings-${group.key}`}
                      bookings={group.bookings}
                      formatDate={formatDate}
                      formatDateTime={formatDateTime}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   ActivityLabel — lightweight status metadata for a property row
────────────────────────────────────────────────────────────────── */
function ActivityLabel({ count, label, color }: { count: number; label: string; color: 'emerald' | 'amber' | 'slate' | 'sky' | 'rose' }) {
  const dot = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-400',
    slate: 'bg-slate-400',
    sky: 'bg-sky-500',
    rose: 'bg-rose-500',
  }[color];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {count} {label}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────
   BookingSection  — expandable section label inside a property card
────────────────────────────────────────────────────────────────── */
type PropertyBookingFilter = 'all' | 'checked-in' | 'waiting' | 'checked-out' | 'cancelled';

const PROPERTY_BOOKING_PAGE_SIZE = 6;

function bookingMatchesFilter(booking: Booking, filter: PropertyBookingFilter) {
  const status = booking.status.toUpperCase();
  if (filter === 'checked-in') return status === 'CHECKED_IN';
  if (filter === 'waiting') return status === 'CONFIRMED';
  if (filter === 'checked-out') return status === 'CHECKED_OUT';
  if (filter === 'cancelled') return status === 'CANCELLED' || status === 'CANCELED';
  return true;
}

function PropertyBookingsTable({
  id,
  bookings,
  formatDate,
  formatDateTime,
  formatCurrency,
}: {
  id: string;
  bookings: Booking[];
  formatDate: (d: string) => string;
  formatDateTime: (d: string | null | undefined) => string | null;
  formatCurrency: (n: number) => string;
}) {
  const [filter, setFilter] = useState<PropertyBookingFilter>('all');
  const [page, setPage] = useState(1);

  const counts = useMemo(() => ({
    all: bookings.length,
    'checked-in': bookings.filter((booking) => bookingMatchesFilter(booking, 'checked-in')).length,
    waiting: bookings.filter((booking) => bookingMatchesFilter(booking, 'waiting')).length,
    'checked-out': bookings.filter((booking) => bookingMatchesFilter(booking, 'checked-out')).length,
    cancelled: bookings.filter((booking) => bookingMatchesFilter(booking, 'cancelled')).length,
  }), [bookings]);

  const filteredBookings = useMemo(
    () => bookings.filter((booking) => bookingMatchesFilter(booking, filter)),
    [bookings, filter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / PROPERTY_BOOKING_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageBookings = filteredBookings.slice(
    (page - 1) * PROPERTY_BOOKING_PAGE_SIZE,
    page * PROPERTY_BOOKING_PAGE_SIZE,
  );

  const filterOptions: { key: PropertyBookingFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'checked-in', label: 'Checked in', count: counts['checked-in'] },
    { key: 'waiting', label: 'Awaiting', count: counts.waiting },
    { key: 'checked-out', label: 'Checked out', count: counts['checked-out'] },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled },
  ];

  const firstVisible = filteredBookings.length === 0 ? 0 : (page - 1) * PROPERTY_BOOKING_PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PROPERTY_BOOKING_PAGE_SIZE, filteredBookings.length);

  return (
    <section id={id} className="bg-slate-50/70 px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
      <div className="rounded-xl bg-white p-2 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter bookings by status">
          {filterOptions.map((option) => {
            const selected = filter === option.key;
            const disabled = option.count === 0;
            return (
              <button
                key={option.key}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => {
                  setFilter(option.key);
                  setPage(1);
                }}
                className={`inline-flex !min-h-0 appearance-none items-center gap-2 rounded-lg !border-0 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/25 ${
                  selected
                    ? '!bg-[#02665e] text-white'
                    : disabled
                      ? '!bg-transparent text-slate-300'
                      : '!bg-transparent text-slate-600 hover:!bg-slate-100 hover:text-slate-900'
                }`}
                style={{ border: 'none', boxShadow: 'none' }}
              >
                {option.label}
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl bg-white shadow-[0_4px_18px_rgba(15,23,42,0.045)]">
        <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(10rem,0.9fr)_minmax(8rem,0.7fr)_minmax(8rem,0.75fr)_20px] items-center gap-4 bg-slate-50 px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 md:grid">
          <span>Guest</span>
          <span>Stay</span>
          <span>Status</span>
          <span className="text-right">Booking value</span>
          <span aria-hidden="true" />
        </div>

        <div>
          {pageBookings.map((booking, index) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              alternate={index % 2 === 1}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
              formatCurrency={formatCurrency}
            />
          ))}
        </div>

        {pageBookings.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No bookings in this status.
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 px-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>Showing {firstVisible}–{lastVisible} of {filteredBookings.length}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="flex !min-h-0 h-8 w-8 appearance-none items-center justify-center rounded-lg !border-0 !bg-white text-slate-500 shadow-sm transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ border: 'none' }}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[5rem] text-center font-medium text-slate-600">Page {page} of {totalPages}</span>
          <button
            type="button"
            disabled={page === totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="flex !min-h-0 h-8 w-8 appearance-none items-center justify-center rounded-lg !border-0 !bg-white text-slate-500 shadow-sm transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ border: 'none' }}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   BookingRow  — single booking entry inside an expanded property card
────────────────────────────────────────────────────────────────── */
function BookingRow({
  booking,
  alternate,
  formatDate,
  formatDateTime,
  formatCurrency,
}: {
  booking: Booking;
  alternate: boolean;
  formatDate: (d: string) => string;
  formatDateTime: (d: string | null | undefined) => string | null;
  formatCurrency: (n: number) => string;
}) {
  const s = booking.status.toUpperCase();
  const isCheckedIn = s === 'CHECKED_IN';
  const checkedInTime = formatDateTime(booking.checkedInAt);

  const nights = (() => {
    try {
      const diff = new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime();
      return Number.isFinite(diff) && diff > 0 ? Math.max(1, Math.ceil(diff / 86400000)) : 1;
    } catch { return 1; }
  })();

  const guestInitial = String(booking.guestName || 'G').trim().charAt(0).toUpperCase() || 'G';

  const safeAmount = (() => {
    const toNum = (v: any) => Number(typeof v === 'string' ? v.replace(/,/g, '') : String(v ?? 0));
    const oba = toNum(booking.ownerBaseAmount);
    if (Number.isFinite(oba) && oba > 0) return oba;
    const total = toNum(booking.totalAmount);
    if (Number.isFinite(total) && total > 0) return total;
    return 0;
  })();

  const fmtDay = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
    catch { return formatDate(d); }
  };

  const statusCfg: Record<string, { pill: string; label: string; avatarBg: string }> = {
    CHECKED_IN:  { pill: 'bg-emerald-50 text-emerald-700', label: 'Checked in',  avatarBg: 'bg-emerald-100 text-emerald-700' },
    CHECKED_OUT: { pill: 'bg-sky-50 text-sky-700',         label: 'Checked out', avatarBg: 'bg-sky-100 text-sky-700'         },
    CONFIRMED:   { pill: 'bg-amber-50 text-amber-700',     label: 'Awaiting',    avatarBg: 'bg-amber-100 text-amber-700'     },
    NEW:         { pill: 'bg-slate-100 text-slate-600',    label: 'New',         avatarBg: 'bg-slate-100 text-slate-600'     },
    PENDING:     { pill: 'bg-amber-50 text-amber-700',     label: 'Pending',     avatarBg: 'bg-amber-100 text-amber-700'     },
    CANCELLED:   { pill: 'bg-rose-50 text-rose-700',       label: 'Cancelled',   avatarBg: 'bg-rose-100 text-rose-700'       },
    CANCELED:    { pill: 'bg-rose-50 text-rose-700',       label: 'Cancelled',   avatarBg: 'bg-rose-100 text-rose-700'       },
  };
  const cfg = statusCfg[s] ?? { pill: 'bg-slate-100 text-slate-600', label: booking.status, avatarBg: 'bg-slate-100 text-slate-600' };

  return (
    <Link
      href={`/owner/bookings/checked-in/${booking.id}`}
      className={`group block no-underline transition-colors hover:bg-[#f4faf9] ${alternate ? 'bg-slate-50/55' : 'bg-white'}`}
      style={{ textDecoration: 'none' }}
    >
      <div className="flex items-center gap-3.5 px-4 py-3.5 transition-colors duration-150 md:hidden">

        {/* Circle guest avatar */}
        <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 text-[14px] font-semibold shadow-sm ${cfg.avatarBg}`}>
          {guestInitial}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: name + amount */}
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-slate-900 truncate flex-1" style={{ textDecoration: 'none' }}>
              {booking.guestName || 'Guest'}
            </span>
            <span className={`text-[13px] font-semibold tabular-nums flex-shrink-0 ${safeAmount > 0 ? 'text-[#02665e]' : 'text-slate-400'}`}>
              {formatCurrency(safeAmount)}
            </span>
          </div>
          {/* Row 2: dates · nights · status */}
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 font-medium">
              {fmtDay(booking.checkIn)} – {fmtDay(booking.checkOut)}
            </span>
            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 flex-shrink-0">
              {nights}n
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-px text-[10px] font-medium tracking-wide flex-shrink-0 ${cfg.pill}`}>
              {cfg.label}
            </span>
            {isCheckedIn && checkedInTime && (
              <span className="text-[11px] text-emerald-600 font-semibold flex-shrink-0">
                · {checkedInTime}
              </span>
            )}
          </div>
        </div>

        {/* Subtle arrow */}
        <ArrowRight className="h-4 w-4 text-slate-200 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all duration-150 flex-shrink-0" />
      </div>

      <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(10rem,0.9fr)_minmax(8rem,0.7fr)_minmax(8rem,0.75fr)_20px] items-center gap-4 px-5 py-3.5 md:grid">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-medium ${cfg.avatarBg}`}>
            {guestInitial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">{booking.guestName || 'Guest'}</div>
          </div>
        </div>

        <div>
          <div className="text-sm text-slate-700">{fmtDay(booking.checkIn)} – {fmtDay(booking.checkOut)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {nights} night{nights === 1 ? '' : 's'}
            {isCheckedIn && checkedInTime ? ` · In ${checkedInTime}` : ''}
          </div>
        </div>

        <div>
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${cfg.pill}`}>{cfg.label}</span>
        </div>

        <span className={`text-right text-sm font-medium tabular-nums ${safeAmount > 0 ? 'text-[#02665e]' : 'text-slate-400'}`}>
          {formatCurrency(safeAmount)}
        </span>

        <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>
    </Link>
  );
}



