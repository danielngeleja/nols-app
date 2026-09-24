"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Gift, Search, X, MapPin, Clock, Loader2, Sparkles, Tag, Building2, Users as UsersIcon,
  ArrowRight, ArrowLeft, FileText, ChevronDown, CheckCircle2, ListFilter, Lock,
} from "lucide-react";
import Image from "next/image";
import apiClient from "@/lib/apiClient";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TablePagination from "@/components/TablePagination";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;

function authify() {}

type ClaimRow = {
  id: number;
  groupBookingId: number;
  ownerId: number;
  propertyId: number;
  offeredPricePerNight: number;
  discountPercent: number | null;
  totalAmount: number;
  currency: string;
  specialOffers: string | null;
  notes: string | null;
  status: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
  createdAt: string;
  isRecommended?: boolean;
  owner: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
  };
  property: {
    id: number;
    title: string;
    type: string;
    regionName: string;
    district: string | null;
    city: string | null;
    primaryImage: string | null;
    images: string[];
    basePrice: number | null;
  } | null;
  groupBooking: {
    id: number;
    groupType: string;
    accommodationType: string;
    headcount: number;
    roomsNeeded: number;
    toRegion: string;
    checkIn: string | null;
    checkOut: string | null;
    user: {
      id: number;
      name: string;
      email: string;
      phone: string | null;
    } | null;
  };
  pricePerGuest: number | null;
  pricePerRoom: number | null;
  savingsAmount: number | null;
  nights: number;
};

type ClaimsSummary = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  withdrawn: number;
};

// NRMS-style status pill tones for owner claims.
function claimStatusClasses(v: string) {
  switch (v) {
    case "PENDING": return "bg-blue-50 text-blue-700";
    case "REVIEWING": return "bg-purple-50 text-purple-700";
    case "ACCEPTED": return "bg-emerald-600 text-white"; // customer chose it and paid the deposit
    case "REJECTED": return "bg-rose-50 text-rose-700";
    default: return "bg-neutral-100 text-neutral-600";
  }
}

function humanizeLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

// "dar-es-salaam" -> "Dar es Salaam", "UBUNGO" -> "Ubungo", "CBD" stays "CBD".
function formatPlaceName(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase())) return word.toLowerCase();
      // Keep real abbreviations only; "DAR" in "DAR es Salaam" is a word, not one.
      if (["CBD", "UDSM", "JNIA", "KIA"].includes(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

type BookingClaimsResponse = {
  groupBooking: any;
  claimsConfig?: {
    deadline: string | null;
    notes: string | null;
    minDiscountPercent: number | null;
    updatedAt: string | null;
  };
  claims: ClaimRow[];
  shortlist: {
    high: { id: number; totalAmount: number };
    mid: { id: number; totalAmount: number } | null;
    low: { id: number; totalAmount: number };
    targetTotalAmount: number;
    currency: string | null;
  } | null;
  recommendedClaimIds: number[];
  summary: any;
};

type AuditItem = {
  id: number;
  action: string;
  description: string | null;
  metadata: any;
  createdAt: string;
  admin?: { id: number; name: string | null; email: string | null };
};

export default function AdminGroupStaysClaimsPage() {
  const searchParams = useSearchParams();
  const didAutoOpenRef = useRef(false);
  const focusedBookingId = (() => {
    const bookingIdParam = searchParams?.get("bookingId");
    if (!bookingIdParam) return null;
    const bookingId = Number(bookingIdParam);
    if (!Number.isFinite(bookingId) || bookingId <= 0) return null;
    return bookingId;
  })();
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [summary, setSummary] = useState<ClaimsSummary | null>(null);

  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);
  const [bookingClaims, setBookingClaims] = useState<BookingClaimsResponse | null>(null);
  const [bookingClaimsLoading, setBookingClaimsLoading] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [showShortlistOnly, setShowShortlistOnly] = useState(true);
  const [selectedClaimIds, setSelectedClaimIds] = useState<number[]>([]);
  const [startingReview, setStartingReview] = useState(false);
  const [recommending, setRecommending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      authify();
      
      // Direct API call to get all claims (regardless of booking status)
      const params: any = {
        page,
        pageSize,
      };

      if (focusedBookingId) {
        params.bookingId = focusedBookingId;
      }
      
      if (status && status.trim()) {
        params.status = status.trim();
      }
      
      if (q && q.trim()) {
        params.q = q.trim();
      }

      const response = await api.get<{
        items: ClaimRow[];
        total: number;
        totalAll: number;
        page: number;
        pageSize: number;
        summary: ClaimsSummary;
      }>("/api/admin/group-stays/claims", { params });

      if (response.data) {
        setList(response.data.items || []);
        setTotal(response.data.total || 0);
        setSummary(response.data.summary || {
          total: 0,
          pending: 0,
          accepted: 0,
          rejected: 0,
          withdrawn: 0,
        });
      } else {
        setList([]);
        setTotal(0);
        setSummary({
          total: 0,
          pending: 0,
          accepted: 0,
          rejected: 0,
          withdrawn: 0,
        });
      }
    } catch (err: any) {
      console.error("Failed to load claims", err);
      setList([]);
      setTotal(0);
      setSummary({
        total: 0,
        pending: 0,
        accepted: 0,
        rejected: 0,
        withdrawn: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [page, status, q, pageSize, focusedBookingId]);

  useEffect(() => {
    if (!focusedBookingId) return;
    if (page !== 1) setPage(1);
  }, [focusedBookingId, page]);

  // Reset to page 1 when search query changes
  useEffect(() => {
    if (q && page !== 1) {
      setPage(1);
    }
  }, [q, page]);

  // Load data when dependencies change
  useEffect(() => {
    // Debounce search query
    const timer = setTimeout(() => {
      load();
    }, q ? 500 : 0); // Only debounce when searching, immediate load for filters
    return () => clearTimeout(timer);
  }, [load, q]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const openBookingReview = useCallback(async (bookingId: number) => {
    setActiveBookingId(bookingId);
    setBookingClaims(null);
    setBookingClaimsLoading(true);
    setAuditItems([]);
    setAuditLoading(true);
    setAuditOpen(false);
    // Prevent stale selections from a previous booking causing 404s.
    setSelectedClaimIds([]);
    setShowShortlistOnly(true);
    try {
      authify();
      const r = await api.get<BookingClaimsResponse>(`/api/admin/group-stays/claims/${bookingId}`);
      setBookingClaims(r.data);

      // Load audit history for this booking so admins can verify when it was recommended.
      try {
        const a = await api.get<{ items: AuditItem[] }>(`/api/admin/group-stays/bookings/${bookingId}/audit`);
        setAuditItems(Array.isArray(a.data?.items) ? a.data.items : []);
      } catch {
        setAuditItems([]);
      } finally {
        setAuditLoading(false);
      }

      const recommendedIds = Array.isArray(r.data?.recommendedClaimIds) ? r.data.recommendedClaimIds : [];
      if (recommendedIds.length > 0) {
        setSelectedClaimIds(Array.from(new Set(recommendedIds)).slice(0, 3));
      } else {
        const shortlistIds = [
          r.data?.shortlist?.high?.id,
          r.data?.shortlist?.mid?.id,
          r.data?.shortlist?.low?.id,
        ].filter(Boolean) as number[];
        setSelectedClaimIds(Array.from(new Set(shortlistIds)).slice(0, 3));
        setShowShortlistOnly(shortlistIds.length > 0);
      }
    } catch (err: any) {
      console.error("Failed to load booking claims", err);
      setBookingClaims(null);
      setAuditItems([]);
    } finally {
      setBookingClaimsLoading(false);
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (didAutoOpenRef.current) return;
    if (!focusedBookingId) return;
    didAutoOpenRef.current = true;
    openBookingReview(focusedBookingId);
  }, [focusedBookingId, openBookingReview]);

  const closeBookingReview = () => {
    setActiveBookingId(null);
    if (!focusedBookingId) {
      setBookingClaims(null);
    }
    setAuditItems([]);
    setAuditLoading(false);
    setAuditOpen(false);
    setSelectedClaimIds([]);
    setShowShortlistOnly(true);
  };

  const toggleSelection = (claimId: number) => {
    const recommendationsLocked = (bookingClaims?.recommendedClaimIds?.length || 0) > 0;
    if (recommendationsLocked) return;
    setSelectedClaimIds((prev) => {
      if (prev.includes(claimId)) return prev.filter((id) => id !== claimId);
      if (prev.length >= 3) return prev;
      return [...prev, claimId];
    });
  };

  const startReview = async () => {
    if (!activeBookingId) return;
    setStartingReview(true);
    try {
      authify();
      await api.post(`/api/admin/group-stays/claims/${activeBookingId}/start-review`);
      await openBookingReview(activeBookingId);
      load();
    } catch (err: any) {
      console.error("Failed to start review", err);
      alert(err?.response?.data?.error || "Failed to start review");
    } finally {
      setStartingReview(false);
    }
  };

  const recommendSelected = async () => {
    if (!activeBookingId) return;
    if (bookingClaimsLoading || !bookingClaims) return;
    if (Number(bookingClaims.groupBooking?.id) !== Number(activeBookingId)) return;
    // Once a booking has saved recommendations, treat them as locked.
    if ((bookingClaims.recommendedClaimIds?.length || 0) > 0) return;
    if (selectedClaimIds.length === 0) return;
    setRecommending(true);
    try {
      authify();
      const claimMeta = bookingClaims?.claims
        ? new Map<number, number>(bookingClaims.claims.map((c) => [c.id, c.groupBookingId]))
        : null;

      const claimIds = claimMeta
        ? selectedClaimIds.filter((id) => claimMeta.get(id) === activeBookingId)
        : selectedClaimIds;
      const uniqueClaimIds = Array.from(new Set(claimIds));
      if (uniqueClaimIds.length === 0) {
        setSelectedClaimIds([]);
        return;
      }
      if (uniqueClaimIds.length !== selectedClaimIds.length) {
        setSelectedClaimIds(uniqueClaimIds);
      }

      await api.post(`/api/admin/group-stays/claims/${activeBookingId}/recommendations`, { claimIds: uniqueClaimIds });
      await openBookingReview(activeBookingId);
      load();
    } catch (err: any) {
      console.error("Failed to recommend", err);
      alert(err?.response?.data?.error || "Failed to recommend");
    } finally {
      setRecommending(false);
    }
  };

  const recommendationsLockedGlobal = (bookingClaims?.recommendedClaimIds?.length || 0) > 0;
  const statusTiles: Array<{ value: string; label: string; count: number | undefined; tone: string; active: string }> = [
    { value: "", label: "All claims", count: summary?.total, tone: "text-neutral-900", active: "border-neutral-400 bg-neutral-50 ring-neutral-100" },
    { value: "PENDING", label: "Pending", count: summary?.pending, tone: "text-blue-700", active: "border-blue-400 bg-blue-50/60 ring-blue-100" },
    { value: "RECOMMENDED_INFO", label: "Recommended", count: summary?.accepted, tone: "text-violet-700", active: "" },
    { value: "REJECTED", label: "Rejected", count: summary?.rejected, tone: "text-rose-700", active: "border-rose-400 bg-rose-50/60 ring-rose-100" },
    { value: "WITHDRAWN", label: "Withdrawn", count: summary?.withdrawn, tone: "text-neutral-600", active: "border-neutral-400 bg-neutral-50 ring-neutral-100" },
  ];

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-6">
      {/* In-page review modal (keeps the auction workflow on this page) */}
      {activeBookingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm" onClick={closeBookingReview} />
          <div className="relative box-border flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-neutral-50 shadow-2xl">
            {/* Header */}
            <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 bg-white px-4 py-4 sm:gap-4 sm:px-6">
              <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
                <Gift className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-900">Review offers</h2>
                  <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-700">
                    GS-{String(activeBookingId).padStart(4, "0")}
                  </span>
                  {recommendationsLockedGlobal && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                      <Sparkles className="h-3 w-3" /> Recommendations saved
                    </span>
                  )}
                </div>
                {bookingClaims?.groupBooking ? (
                  <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-neutral-400" />
                      {formatPlaceName(bookingClaims.groupBooking.toRegion || "")}
                      {bookingClaims.groupBooking.toDistrict ? `, ${formatPlaceName(bookingClaims.groupBooking.toDistrict)}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UsersIcon className="h-3.5 w-3.5 text-neutral-400" />
                      {bookingClaims.groupBooking.headcount} guests · {bookingClaims.groupBooking.roomsNeeded} rooms
                    </span>
                  </p>
                ) : (
                  <p className="m-0 mt-1 text-xs text-neutral-500">Loading booking...</p>
                )}
              </div>
              <button
                type="button"
                onClick={closeBookingReview}
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Toolbar: counts on the left, the workflow actions on the right (hidden once locked) */}
            {bookingClaims && (() => {
              const pendingCount = bookingClaims.claims.filter((c) => c.status === "PENDING").length;
              const recommendedCount = bookingClaims.recommendedClaimIds?.length || 0;
              return (
                <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-200 bg-white px-4 py-2.5 sm:px-6">
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-neutral-700">
                    {bookingClaims.claims.length} {bookingClaims.claims.length === 1 ? "offer" : "offers"}
                  </span>
                  {recommendationsLockedGlobal ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-violet-700">
                      <Sparkles className="h-3 w-3" /> {recommendedCount} recommended
                    </span>
                  ) : (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${selectedClaimIds.length === 3 ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-700"}`}>
                      {selectedClaimIds.length}/3 selected
                    </span>
                  )}
                  {bookingClaims.shortlist && bookingClaims.claims.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setShowShortlistOnly((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-solid border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 transition hover:border-neutral-300"
                      title={showShortlistOnly ? "Showing the shortlist only" : "Showing every offer"}
                    >
                      <ListFilter className="h-3 w-3 text-neutral-500" />
                      {showShortlistOnly ? "Shortlist" : "All offers"}
                    </button>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {pendingCount > 0 && (
                      <button
                        type="button"
                        onClick={startReview}
                        disabled={startingReview}
                        className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                        title={`Mark ${pendingCount} pending ${pendingCount === 1 ? "offer" : "offers"} as reviewing`}
                      >
                        {startingReview ? "Starting..." : `Mark reviewing (${pendingCount})`}
                      </button>
                    )}
                    {recommendationsLockedGlobal ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500" title="Recommendations cannot be changed once saved">
                        <Lock className="h-3.5 w-3.5" /> Locked
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={recommendSelected}
                        disabled={bookingClaimsLoading || recommending || selectedClaimIds.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                        title="Save recommendations for the customer"
                      >
                        {recommending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {recommending ? "Saving..." : `Recommend ${selectedClaimIds.length || ""}`.trim()}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {bookingClaimsLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="mb-3 h-7 w-7 animate-spin text-emerald-600" />
                  <p className="m-0 text-sm text-neutral-500">Loading offers...</p>
                </div>
              ) : !bookingClaims ? (
                <p className="m-0 py-10 text-center text-sm text-neutral-500">Failed to load offers.</p>
              ) : (() => {
                const visible = bookingClaims.claims.filter((c) => {
                  if (!showShortlistOnly || !bookingClaims.shortlist) return true;
                  const ids = [bookingClaims.shortlist.high.id, bookingClaims.shortlist.mid?.id, bookingClaims.shortlist.low.id].filter(Boolean) as number[];
                  return ids.includes(c.id);
                });
                return (
                <div className="space-y-4">
                  {!recommendationsLockedGlobal && (
                    <p className="m-0 text-xs text-neutral-500">Pick up to three offers to recommend to the customer, then save.</p>
                  )}

                  {/* A lone offer spans the full width instead of leaving half the modal empty */}
                  <div className={`grid grid-cols-1 gap-3 ${visible.length > 1 ? "lg:grid-cols-2" : ""}`}>
                    {visible.map((c) => {
                        const isSelected = selectedClaimIds.includes(c.id);
                        const isRecommended = (bookingClaims.recommendedClaimIds || []).includes(c.id);
                        const isHigh = bookingClaims.shortlist?.high?.id === c.id;
                        const isMid = bookingClaims.shortlist?.mid?.id === c.id;
                        const isLow = bookingClaims.shortlist?.low?.id === c.id;
                        const band = isHigh ? { label: "High match", cls: "bg-amber-50 text-amber-800" } : isMid ? { label: "Mid match", cls: "bg-slate-100 text-slate-700" } : isLow ? { label: "Low match", cls: "bg-indigo-50 text-indigo-700" } : null;
                        const perks = (c.specialOffers || "").split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
                        const shownPerks = perks.slice(0, 5);
                        const cardTone = isRecommended
                          ? "border-violet-300 ring-4 ring-violet-50"
                          : isSelected
                            ? "border-emerald-400 ring-4 ring-emerald-50"
                            : "border-neutral-200";

                        return (
                          <div key={c.id} className={`flex flex-col rounded-xl border border-solid bg-white p-4 transition-colors ${cardTone}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="m-0 truncate text-sm font-bold text-neutral-900">{c.property?.title || `Property #${c.propertyId}`}</p>
                                <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{c.owner.name}</p>
                              </div>
                              <div className="flex-shrink-0 text-right">
                                <p className="m-0 text-base font-bold tabular-nums text-neutral-900">{c.currency} {Number(c.totalAmount).toLocaleString()}</p>
                                <p className="m-0 mt-0.5 text-[11px] tabular-nums text-neutral-400">{Number(c.offeredPricePerNight).toLocaleString()} per room night</p>
                              </div>
                            </div>

                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${claimStatusClasses(c.status)}`}>
                                {c.status.replace(/_/g, " ").toLowerCase()}
                              </span>
                              {band && <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${band.cls}`}>{band.label}</span>}
                              {c.discountPercent && c.discountPercent > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                  <Tag className="h-3 w-3" /> {c.discountPercent}% off
                                </span>
                              ) : null}
                            </div>

                            {perks.length > 0 && (
                              <div className="mt-3 flex flex-wrap items-center gap-1" title={perks.join("\n")}>
                                {shownPerks.map((p) => (
                                  <span key={p} className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">{p}</span>
                                ))}
                                {perks.length > shownPerks.length && (
                                  <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">+{perks.length - shownPerks.length} more</span>
                                )}
                              </div>
                            )}

                            <div className="mt-auto flex items-center justify-end gap-2 pt-3">
                              {isRecommended ? (
                                // A saved recommendation is a state, not an action.
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">
                                  <Sparkles className="h-3.5 w-3.5" /> Recommended to customer
                                </span>
                              ) : recommendationsLockedGlobal ? (
                                <span className="text-xs text-neutral-400">Not recommended</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleSelection(c.id)}
                                  disabled={!isSelected && selectedClaimIds.length >= 3}
                                  aria-pressed={isSelected}
                                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    isSelected
                                      ? "border-0 bg-emerald-600 text-white hover:bg-emerald-700"
                                      : "border border-solid border-neutral-200 bg-white text-neutral-700 hover:border-emerald-300 hover:bg-emerald-50"
                                  }`}
                                >
                                  {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                                  {isSelected ? "Selected" : "Select offer"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Audit history: collapsed by default, a compact log for confirming recommendations */}
                  <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setAuditOpen((v) => !v)}
                      className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-neutral-50"
                      aria-expanded={auditOpen}
                      aria-controls="audit-history-panel"
                    >
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
                        <FileText className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-sm font-semibold text-neutral-900">Activity</span>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">{auditItems.length}</span>
                      <ChevronDown className={`ml-auto h-4 w-4 text-neutral-400 transition-transform ${auditOpen ? "rotate-180" : ""}`} />
                    </button>
                    {auditOpen && (
                      <div id="audit-history-panel" className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
                        {auditLoading ? (
                          <p className="m-0 text-xs text-neutral-500">Loading activity...</p>
                        ) : auditItems.length === 0 ? (
                          <p className="m-0 text-xs text-neutral-500">No activity yet.</p>
                        ) : (
                          <ul className="m-0 list-none space-y-2.5 p-0">
                            {auditItems.slice(0, 12).map((a) => {
                              const meta = a?.metadata as any;
                              const claimIds = Array.isArray(meta?.claimIds) ? meta.claimIds : null;
                              const when = new Date(a.createdAt);
                              return (
                                <li key={a.id} className="flex items-start gap-3 text-xs">
                                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neutral-300" />
                                  <div className="min-w-0 flex-1">
                                    <p className="m-0 font-semibold text-neutral-800">
                                      {humanizeLabel(a.action)}
                                      {claimIds ? <span className="font-normal text-neutral-500"> · claims {claimIds.join(", ")}</span> : null}
                                    </p>
                                    {a.description ? <p className="m-0 mt-0.5 text-neutral-500">{a.description}</p> : null}
                                  </div>
                                  <span className="flex-shrink-0 text-right text-neutral-400">
                                    {when.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                    <br />
                                    {a.admin?.name || a.admin?.email || ""}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="flex justify-end border-0 border-t border-solid border-neutral-200 bg-white px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={closeBookingReview}
                className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auction focus (arrived from Assignments with ?bookingId) */}
      {focusedBookingId && (
        <div className="rounded-xl border border-solid border-emerald-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <Link
              href="/admin/group-stays/assignments"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 no-underline transition hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline"
              aria-label="Back to assignments"
              title="Back to assignments"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="text-sm font-bold text-neutral-900">Auction focus</span>
            <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-700">
              GS-{String(focusedBookingId).padStart(4, "0")}
            </span>
            <button
              type="button"
              onClick={() => openBookingReview(focusedBookingId)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border-0 bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
            >
              Review offers <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-3">
            {[
              { icon: MapPin, label: "Destination", value: bookingClaims?.groupBooking?.toRegion ? formatPlaceName(bookingClaims.groupBooking.toRegion) : "Not set", sub: bookingClaims?.groupBooking?.toDistrict ? formatPlaceName(bookingClaims.groupBooking.toDistrict) : bookingClaims?.groupBooking?.toLocation || null },
              { icon: Clock, label: "Deadline", value: bookingClaims?.claimsConfig?.deadline ? new Date(bookingClaims.claimsConfig.deadline).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not set", sub: bookingClaims?.claimsConfig?.updatedAt ? `Updated ${new Date(bookingClaims.claimsConfig.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : null },
              { icon: Tag, label: "Minimum discount", value: bookingClaims?.claimsConfig?.minDiscountPercent != null ? `${bookingClaims.claimsConfig.minDiscountPercent}%` : "None", sub: "Quality gate" },
            ].map((fact) => {
              const Icon = fact.icon;
              return (
                <div key={fact.label} className="flex min-w-0 items-start gap-3 bg-white px-4 py-3 sm:px-5">
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">{fact.label}</p>
                    <p className="m-0 mt-0.5 truncate text-sm font-bold text-neutral-900">{fact.value}</p>
                    {fact.sub ? <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{fact.sub}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
          {bookingClaims?.claimsConfig?.notes ? (
            <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Notes</p>
              <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-neutral-700">{bookingClaims.claimsConfig.notes}</p>
            </div>
          ) : null}
        </div>
      )}

      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100 sm:h-12 sm:w-12">
            <Gift className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Owner offers</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Owner offers submitted for group stay bookings</p>
          </div>
        </div>
        <Link
          href="/admin/group-stays"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline sm:self-auto"
        >
          <Building2 className="h-3.5 w-3.5 text-emerald-600" />
          Group Stays overview
        </Link>
      </div>

      {/* Status tiles (also the status filter) + search */}
      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-5">
          {statusTiles.map((t) => {
            const isActive = status === t.value;
            // summary.accepted is the recommended count (admin shortlist), which has no status filter.
            if (t.value === "RECOMMENDED_INFO") {
              return (
                <div key={t.label} className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 px-3.5 py-3" title="Offers an admin shortlisted for the customer">
                  <span className="flex items-center gap-1 text-xs font-medium text-violet-700"><Sparkles className="h-3 w-3" />{t.label}</span>
                  <span className={`block text-xl font-bold leading-tight tabular-nums ${t.tone}`}>{typeof t.count === "number" ? t.count.toLocaleString() : "..."}</span>
                </div>
              );
            }
            return (
              <button
                key={t.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setStatus(t.value);
                  setPage(1);
                }}
                className={`rounded-xl border border-solid px-3.5 py-3 text-left transition-all ${isActive ? `${t.active} ring-4` : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/70"}`}
              >
                <span className="block text-xs font-medium text-neutral-500">{t.label}</span>
                <span className={`block text-xl font-bold leading-tight tabular-nums ${t.tone}`}>
                  {typeof t.count === "number" ? t.count.toLocaleString() : "..."}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/50 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by property, owner, customer or region"
              className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-10 pr-10 font-[inherit] text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              aria-label="Search claims"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* Reviewing has no summary tile, so the full status list stays available here */}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="box-border h-10 rounded-lg border border-solid border-neutral-200 bg-white px-3 font-[inherit] text-sm font-medium text-neutral-700 outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 sm:w-44"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="REVIEWING">Reviewing</option>
            <option value="ACCEPTED">Accepted (deposit paid)</option>
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </div>
      </div>

      {/* Claims */}
      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="mb-3 h-7 w-7 animate-spin text-emerald-600" />
            <p className="m-0 text-sm text-neutral-500">Loading claims...</p>
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <Gift className="h-6 w-6" />
            </span>
            <p className="m-0 text-sm font-semibold text-neutral-800">No claims found</p>
            <p className="m-0 mt-1 max-w-md text-xs text-neutral-500">
              {q || status ? "Try adjusting your search or status filter." : "No owner offers have been submitted yet."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table: follows the NRMS reservations table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="whitespace-nowrap px-4 py-3">Property &amp; owner</th>
                    <th className="whitespace-nowrap px-4 py-3">Booking</th>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Per night</th>
                    <th className="whitespace-nowrap px-4 py-3 text-center">Discount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Per guest</th>
                    <th className="whitespace-nowrap px-4 py-3 text-center">Status</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((claim) => {
                    const gb = claim.groupBooking;
                    const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                    // Preflight is off: each cell carries its own top rule instead of divide-y.
                    const cell = "border-0 border-t border-solid border-neutral-100 px-4 py-3.5 align-top";
                    return (
                      <tr key={claim.id} className="transition-colors hover:bg-neutral-50/80">
                        <td className={`max-w-[22rem] ${cell}`}>
                          <div className="flex min-w-0 items-start gap-3">
                            {claim.property?.primaryImage ? (
                              <Image
                                src={claim.property.primaryImage}
                                alt={claim.property.title || "Property"}
                                width={44}
                                height={44}
                                className="h-11 w-11 flex-shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400">
                                <Building2 className="h-5 w-5" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <div className="truncate font-bold text-neutral-900" title={claim.property?.title || undefined}>
                                {claim.property?.title || `Property #${claim.propertyId}`}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-neutral-500" title={claim.owner.email}>
                                {claim.owner.name}
                                {claim.property ? ` · ${[formatPlaceName(claim.property.regionName || ""), claim.property.district ? formatPlaceName(claim.property.district) : null].filter(Boolean).join(", ")}` : ""}
                              </div>
                              {claim.specialOffers ? (() => {
                                const perks = claim.specialOffers.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
                                return (
                                  // Compact count; the full list lives in the tooltip so rows stay two lines tall.
                                  <span
                                    className="mt-1 inline-flex cursor-help items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                                    title={perks.join("\n")}
                                    aria-label={`Special offers: ${perks.join(", ")}`}
                                  >
                                    <Tag className="h-3 w-3" />
                                    {perks.length} {perks.length === 1 ? "perk" : "perks"}
                                  </span>
                                );
                              })() : null}
                            </div>
                          </div>
                        </td>
                        <td className={`whitespace-nowrap ${cell}`}>
                          <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-700">
                            GS-{String(claim.groupBookingId).padStart(4, "0")}
                          </span>
                          <div className="mt-1 text-xs text-neutral-500">
                            {gb.headcount} guests · {gb.roomsNeeded} rooms · {claim.nights} {claim.nights === 1 ? "night" : "nights"}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {gb.checkIn ? `${fmtDay(gb.checkIn)} to ${gb.checkOut ? fmtDay(gb.checkOut) : "TBD"}` : "Flexible dates"}
                          </div>
                        </td>
                        <td className={`max-w-[14rem] ${cell}`}>
                          {gb.user ? (
                            <>
                              <div className="truncate font-semibold text-neutral-800">{gb.user.name}</div>
                              <div className="mt-0.5 truncate text-xs text-neutral-400" title={gb.user.email}>{gb.user.email}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">Unknown</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap text-right ${cell}`}>
                          <div className="font-bold tabular-nums text-neutral-900">{claim.totalAmount.toLocaleString()}</div>
                          <div className="mt-0.5 text-[11px] font-semibold text-neutral-400">{claim.currency}</div>
                        </td>
                        <td className={`whitespace-nowrap text-right ${cell}`}>
                          <div className="font-semibold tabular-nums text-neutral-700">{claim.offeredPricePerNight.toLocaleString()}</div>
                          <div className="mt-0.5 text-[11px] text-neutral-400">per room night</div>
                        </td>
                        <td className={`whitespace-nowrap text-center ${cell}`}>
                          {claim.discountPercent && claim.discountPercent > 0 ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-emerald-700">{claim.discountPercent}% off</span>
                          ) : (
                            <span className="text-xs text-neutral-300">None</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap text-right ${cell}`}>
                          {claim.pricePerGuest ? (
                            <div className="font-semibold tabular-nums text-neutral-700">{Math.round(claim.pricePerGuest).toLocaleString()}</div>
                          ) : (
                            <span className="text-xs text-neutral-300">None</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap text-center ${cell}`}>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${claimStatusClasses(claim.status)}`}>
                            {claim.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                          {claim.isRecommended ? (
                            <div className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-violet-700" title="Shortlisted by an admin for the customer">
                              <Sparkles className="h-3 w-3" /> Recommended
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] text-neutral-400">
                            {new Date(claim.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </div>
                        </td>
                        <td className={`whitespace-nowrap text-right ${cell}`}>
                          <button
                            type="button"
                            onClick={() => openBookingReview(claim.groupBookingId)}
                            className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                          >
                            Review
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
              {list.map((claim, i) => (
                <li key={claim.id} className={`px-4 py-3.5 ${i > 0 ? "border-0 border-t border-solid border-neutral-100" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-bold text-neutral-900">{claim.property?.title || `Property #${claim.propertyId}`}</p>
                      <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{claim.owner.name} · GS-{String(claim.groupBookingId).padStart(4, "0")}</p>
                    </div>
                    <span className={`inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${claimStatusClasses(claim.status)}`}>
                      {claim.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div className="text-xs text-neutral-500">
                      {claim.groupBooking.headcount} guests · {claim.nights} {claim.nights === 1 ? "night" : "nights"}
                      {claim.isRecommended ? <span className="ml-1 font-semibold text-violet-700">· Recommended</span> : null}
                    </div>
                    <div className="text-right">
                      <p className="m-0 text-sm font-bold tabular-nums text-neutral-900">{claim.currency} {claim.totalAmount.toLocaleString()}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openBookingReview(claim.groupBookingId)}
                    className="mt-2.5 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    Review offers
                  </button>
                </li>
              ))}
            </ul>

            {/* Pagination: the shared table footer used by the NRMS reservations table */}
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={(next) => setPage(Math.min(pages, Math.max(1, next)))}
            />
          </>
        )}
      </div>
    </div>
  );
}
