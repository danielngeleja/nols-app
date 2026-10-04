"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import DatePicker from "@/components/ui/DatePicker";
import { Users, Calendar, CheckCircle, XCircle, User, Phone, Globe, ArrowRight, Building2, Clock, ChevronDown, MessageSquare, DollarSign, Tag, FileText, Sparkles, Gift, Send, MapPin, ImageIcon, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import LogoSpinner from "@/components/LogoSpinner";
import VerifiedIcon from "@/components/VerifiedIcon";

const api = apiClient;

type GroupStay = {
  id: number;
  groupStayReference: string;
  auction?: {
    isOpenForClaims?: boolean;
    recommendedPropertyCount?: number;
    confirmedPropertyId?: number | null;
  };
  arrangement: {
    id: number;
    property: {
      id: number;
      title: string;
      type: string;
      regionName?: string;
      district?: string;
      city?: string;
    };
  };
  checkIn: string;
  checkOut: string;
  status: string;
  totalAmount: number;
  ownerAmount?: number | null;
  numberOfGuests: number;
  passengers?: Array<{
    id: number;
    name: string;
    phone?: string;
    nationality?: string;
  }>;
  isValid: boolean;
  createdAt: string;
  /** The original request, used to pre-fill "Book again" */
  request?: Record<string, unknown> | null;
  deposit?: {
    amount: number | null;
    paid: boolean;
    paidAt?: string | null;
    dueAt?: string | null;
    currency?: string;
    commissionPercent?: number | null;
    ownerAmount?: number | null;
    expired: boolean;
  };
  adminSuggestions?: {
    accommodationOptions?: string;
    pricing?: string;
    recommendations?: string;
    nextSteps?: string;
    notes?: string;
  } | null;
};

type AuctionOffer = {
  claimId: number;
  property: {
    id: number;
    title: string;
    type: string;
    regionName?: string;
    district?: string;
    ward?: string;
    city?: string;
    imageUrl?: string | null;
  };
  offer: {
    offeredPricePerNight: number;
    discountPercent?: number | null;
    totalAmount: number;
    customerPricePerNight?: number | null;
    customerOriginalPricePerNight?: number | null;
    customerTotalAmount?: number | null;
    customerOriginalTotalAmount?: number | null;
    customerSavingsAmount?: number | null;
    currency: string;
    specialOffers?: string | null;
    notes?: string | null;
  };
};

/**
 * "Book again": hand the old request to the group stay form through its own
 * draft slot (GroupStaysCard restores `groupStaysDraft.v1` on mount). Dates and
 * the roster are left for the traveller to enter fresh.
 */
function saveRebookDraft(request: Record<string, unknown> | null | undefined) {
  if (!request) return;
  const str = (k: string) => (typeof request[k] === "string" ? (request[k] as string) : "");
  const num = (k: string, fallback: number) => (Number.isFinite(Number(request[k])) && request[k] != null ? Number(request[k]) : fallback);
  const bool = (k: string) => request[k] === true;
  // Stored as "02:30 PM"; the form's time input wants "14:30"
  const to24 = (value: string) => {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return "";
    let h = Number(m[1]) % 12;
    if (m[3]?.toUpperCase() === "PM") h += 12;
    else if (!m[3]) h = Number(m[1]);
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  };
  try {
    localStorage.setItem(
      "groupStaysDraft.v1",
      JSON.stringify({
        currentStep: 1,
        rebook: true,
        groupType: str("groupType"),
        fromCountry: str("fromCountry"),
        fromRegion: str("fromRegion"),
        fromDistrict: str("fromDistrict"),
        fromWard: str("fromWard"),
        fromLocation: str("fromLocation"),
        toRegion: str("toRegion"),
        toDistrict: str("toDistrict"),
        toWard: str("toWard"),
        toLocation: str("toLocation"),
        accommodationType: str("accommodationType"),
        minHotelStarLabel: str("minHotelStarLabel"),
        maleCount: num("maleCount", 0),
        femaleCount: num("femaleCount", 0),
        // Older requests only kept a headcount: carry it over so the group size survives
        otherCount:
          num("maleCount", 0) + num("femaleCount", 0) + num("otherCount", 0) > 0
            ? num("otherCount", 0)
            : num("headcount", 0),
        roomSize: num("roomSize", 2),
        needsPrivateRoom: bool("needsPrivateRoom"),
        privateRoomCount: num("privateRoomCount", 0),
        useDates: request.useDates !== false,
        checkInIso: "",
        checkOutIso: "",
        arrPickup: bool("arrPickup"),
        arrTransport: bool("arrTransport"),
        arrMeals: bool("arrMeals"),
        arrGuide: bool("arrGuide"),
        arrEquipment: bool("arrEquipment"),
        pickupLocation: str("pickupLocation"),
        pickupTime: to24(str("pickupTime")),
        arrangementNotes: str("arrangementNotes"),
      }),
    );
  } catch {
    // Storage unavailable: the form simply opens empty
  }
}

type StayBucket = "pending" | "reviewed" | "deposit" | "active" | "completed" | "expired" | "canceled";
type StayFilter = "all" | StayBucket;

/** One home per stay, in lifecycle order, so every status has a tab and nothing is counted twice. */
function bucketOf(stay: GroupStay): StayBucket {
  const s = String(stay.status || "").toUpperCase();
  if (s === "PENDING" || s === "REVIEWING") return "pending";
  if (s === "PROCESSING") return "reviewed";
  if (s === "CANCELED" || s === "CANCELLED") return "canceled";
  if (s === "COMPLETED") return "completed";
  if (s === "AWAITING_DEPOSIT") return stay.deposit?.expired || !stay.isValid ? "expired" : "deposit";
  return stay.isValid ? "active" : "expired";
}

const STAY_TABS: Array<{ key: StayFilter; label: string; empty: string }> = [
  { key: "all", label: "All", empty: "No group stays found." },
  { key: "pending", label: "Pending", empty: "Nothing is waiting for review right now." },
  { key: "reviewed", label: "Reviewed", empty: "No reviewed requests at the moment." },
  { key: "deposit", label: "Awaiting deposit", empty: "No deposits are due right now." },
  { key: "active", label: "Active", empty: "You don't have any active group stays at the moment." },
  { key: "completed", label: "Completed", empty: "You haven't completed any group stays yet." },
  { key: "expired", label: "Expired", empty: "You don't have any expired group stays." },
  { key: "canceled", label: "Canceled", empty: "No canceled group stays." },
];

const GUEST_OPTIONS = [0, 5, 10, 20, 50];

/** "2026-09-12" reads as "12 Sep 2026". */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const SORT_OPTIONS = [
  { key: "recent", label: "Newest request" },
  { key: "checkin-soon", label: "Check-in, soonest" },
  { key: "checkin-late", label: "Check-in, latest" },
  { key: "total-high", label: "Highest total" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["key"];

/** "DOSSI, MAGOMENI" and "dar-es-salaam" read as "Dossi, Magomeni" and "Dar es Salaam". */
function tidyName(value: string): string {
  const s = String(value || "").trim();
  if (!s) return s;
  // Leave mixed-case names as the owner typed them
  const shouting = s === s.toUpperCase() || s === s.toLowerCase();
  if (!shouting) return s;
  const small = new Set(["es", "wa", "la", "ya", "na", "of", "and", "the"]);
  return s
    .replace(/-/g, " ")
    .toLowerCase()
    .split(/(\s+|,\s*)/)
    .map((part, i) => (/^[a-z]/.test(part) && (i === 0 || !small.has(part)) ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

/** A calm chip and dot per status. */
function statusTone(stay: { status: string; isValid: boolean }): { chip: string; dot: string } {
  if (stay.status === "PENDING") return { chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500" };
  if (stay.status === "REVIEWING" || stay.status === "PROCESSING") return { chip: "bg-sky-50 text-sky-800", dot: "bg-sky-500" };
  if (stay.status === "AWAITING_DEPOSIT") return { chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500" };
  if (stay.isValid) return { chip: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" };
  if (stay.status === "COMPLETED") return { chip: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" };
  if (stay.status === "CANCELED") return { chip: "bg-rose-50 text-rose-700", dot: "bg-rose-500" };
  return { chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
}

function GroupStayCardSkeleton({ variant: _variant }: { variant: "active" | "expired" }) {
  return (
    <div className="relative overflow-hidden bg-white rounded-3xl border border-solid border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)] p-5 sm:p-6">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-3xl bg-gradient-to-b from-emerald-300 to-emerald-600 opacity-40" />
      <div className="flex flex-col gap-4 pl-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-slate-50 border border-solid border-slate-100 p-3 space-y-2">
              <div className="h-3 w-16 rounded-full bg-slate-200 animate-pulse" />
              <div className="h-4 w-24 rounded-full bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MyGroupStaysPage() {
  const router = useRouter();
  const [groupStays, setGroupStays] = useState<GroupStay[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<StayFilter>("all");
  const [query, setQuery] = useState("");
  // Advanced filters
  const [showFilters, setShowFilters] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [checkInFrom, setCheckInFrom] = useState("");
  const [checkInTo, setCheckInTo] = useState("");
  const [minGuests, setMinGuests] = useState(0);
  const [depositFilter, setDepositFilter] = useState<"any" | "paid" | "unpaid">("any");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [entered, setEntered] = useState(false);
  const [expandedPassengers, setExpandedPassengers] = useState<Set<number>>(new Set());
  const [auctionOffersByBooking, setAuctionOffersByBooking] = useState<Record<number, AuctionOffer[]>>({});
  const [auctionExpanded, setAuctionExpanded] = useState<Set<number>>(new Set());
  const [auctionLoading, setAuctionLoading] = useState<Set<number>>(new Set());
  const [auctionConfirming, setAuctionConfirming] = useState<Set<number>>(new Set());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    loadGroupStays();
  }, []);

  // Gentle mount animation
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  const loadGroupStays = async () => {
    try {
      setLoading(true);
      const response = await api.get("/api/customer/group-stays");
      const items: GroupStay[] = response.data.items || [];
      setGroupStays(items);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to fetch group stays";
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Group Stays", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const toggleAuction = async (bookingId: number) => {
    const next = new Set(auctionExpanded);
    if (next.has(bookingId)) {
      next.delete(bookingId);
      setAuctionExpanded(next);
      return;
    }

    next.add(bookingId);
    setAuctionExpanded(next);

    if (auctionOffersByBooking[bookingId]) return;
    const loadingNext = new Set(auctionLoading);
    loadingNext.add(bookingId);
    setAuctionLoading(loadingNext);

    try {
      const resp = await api.get(`/api/customer/group-stays/${bookingId}/auction-offers`);
      setAuctionOffersByBooking((prev) => ({
        ...prev,
        [bookingId]: resp.data?.offers || [],
      }));
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to fetch auction offers";
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Auction Offers", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      const loadingDone = new Set(auctionLoading);
      loadingDone.delete(bookingId);
      setAuctionLoading(loadingDone);
    }
  };

  const confirmAuctionOffer = async (bookingId: number, propertyId: number) => {
    const confirmingNext = new Set(auctionConfirming);
    confirmingNext.add(bookingId);
    setAuctionConfirming(confirmingNext);

    try {
      await api.post(`/api/customer/group-stays/${bookingId}/auction-confirm`, { propertyId });
      const reference = groupStays.find((stay) => stay.id === bookingId)?.groupStayReference || String(bookingId);
      router.push(`/account/group-stays/${encodeURIComponent(reference)}/deposit`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to confirm offer";
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Auction Offers", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      const confirmingDone = new Set(auctionConfirming);
      confirmingDone.delete(bookingId);
      setAuctionConfirming(confirmingDone);
    }
  };

  const bucketCounts = groupStays.reduce<Record<StayFilter, number>>(
    (acc, s) => {
      acc[bucketOf(s)] += 1;
      acc.all += 1;
      return acc;
    },
    { all: 0, pending: 0, reviewed: 0, deposit: 0, active: 0, completed: 0, expired: 0, canceled: 0 },
  );
  const pendingCount = bucketCounts.pending;
  const activeCount = bucketCounts.active + bucketCounts.deposit;
  const pendingOnlyCount = groupStays.filter((s) => s.status === "PENDING").length;
  const reviewingOnlyCount = groupStays.filter((s) => s.status === "REVIEWING").length;
  const filteredGroupStays = filter === "all" ? groupStays : groupStays.filter((stay) => bucketOf(stay) === filter);
  const activeTab = STAY_TABS.find((t) => t.key === filter) || STAY_TABS[0];

  // The stay that needs the customer most: deposit due, offers ready, next confirmed, then one being arranged
  const featureUpcoming = (s: GroupStay) => new Date(s.checkOut).getTime() >= now;
  const featureStay =
    groupStays.find((s) => s.status === "AWAITING_DEPOSIT" && !s.deposit?.expired && featureUpcoming(s)) ||
    groupStays.find((s) => (s.auction?.recommendedPropertyCount || 0) > 0 && !s.auction?.confirmedPropertyId && featureUpcoming(s)) ||
    [...groupStays].filter((s) => s.isValid && featureUpcoming(s)).sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0] ||
    groupStays.find((s) => (s.status === "PENDING" || s.status === "REVIEWING" || s.status === "PROCESSING") && featureUpcoming(s)) ||
    null;

  // Search across property, place and reference; every word must match somewhere
  const queryWords = query.trim().toLowerCase().split(/s+/).filter(Boolean);
  const dayStart = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).getTime() : null);
  const fromMs = dayStart(checkInFrom);
  const toMs = checkInTo ? (dayStart(checkInTo) as number) + 86_400_000 - 1 : null;
  const advancedCount = (checkInFrom ? 1 : 0) + (checkInTo ? 1 : 0) + (minGuests > 0 ? 1 : 0) + (depositFilter !== "any" ? 1 : 0) + (sortBy !== "recent" ? 1 : 0);
  const resetAdvanced = () => {
    setCheckInFrom("");
    setCheckInTo("");
    setMinGuests(0);
    setDepositFilter("any");
    setSortBy("recent");
  };
  const searchedGroupStays = filteredGroupStays.filter((stay) => {
    if (queryWords.length) {
      const p = stay.arrangement.property;
      const bag = [p.title, p.type, p.regionName, p.city, p.district, stay.groupStayReference].filter(Boolean).join(" ").toLowerCase();
      if (!queryWords.every((w) => bag.includes(w))) return false;
    }
    const checkIn = stay.checkIn ? new Date(stay.checkIn).getTime() : null;
    if (fromMs != null && (checkIn == null || checkIn < fromMs)) return false;
    if (toMs != null && (checkIn == null || checkIn > toMs)) return false;
    if (minGuests > 0 && Number(stay.numberOfGuests || 0) < minGuests) return false;
    if (depositFilter === "paid" && !stay.deposit?.paid) return false;
    if (depositFilter === "unpaid" && stay.deposit?.paid) return false;
    return true;
  });
  const narrowed = queryWords.length > 0 || advancedCount - (sortBy !== "recent" ? 1 : 0) > 0;

  const timeOf = (v?: string | null) => (v ? new Date(v).getTime() || 0 : 0);
  const displayGroupStays = [...searchedGroupStays].sort((a, b) => {
    if (sortBy === "checkin-soon") return timeOf(a.checkIn) - timeOf(b.checkIn);
    if (sortBy === "checkin-late") return timeOf(b.checkIn) - timeOf(a.checkIn);
    if (sortBy === "total-high") return Number(b.totalAmount || 0) - Number(a.totalAmount || 0);
    // Newest first; in Pending, the ones already under review lead
    if (filter === "pending") {
      const rank = (s: GroupStay) => (s.status === "REVIEWING" ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
    }
    return timeOf(b.createdAt) - timeOf(a.createdAt);
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getStatusLabel = (stay: GroupStay) => {
    if (stay.status === "PENDING") return "Pending";
    if (stay.status === "REVIEWING") return "Under Review";
    if (stay.status === "PROCESSING") return "Processing";
    if (stay.isValid) {
      return stay.status === "CONFIRMED" ? "Confirmed" : "Active";
    }
    if (stay.status === "COMPLETED") return "Completed";
    if (stay.status === "CANCELED") return "Canceled";
    return "Expired";
  };

  const getStatusColor = (stay: GroupStay) => {
    if (stay.status === "PENDING") return "bg-amber-50 text-amber-700 border-amber-200";
    if (stay.status === "REVIEWING") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (stay.status === "PROCESSING") return "bg-sky-50 text-sky-700 border-sky-200";
    if (stay.isValid) {
      return stay.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-emerald-50 text-emerald-700 border-emerald-200";
    }
    if (stay.status === "COMPLETED") return "bg-green-50 text-green-700 border-green-200";
    if (stay.status === "CANCELED") return "bg-red-50 text-red-700 border-red-200";
    return "bg-slate-100 text-slate-500 border-slate-200";
  };

  // Parse and format admin suggestions text (handles markdown-like formatting)
  const formatAdminText = (text: string) => {
    if (!text) return null;
    
    const lines = text.split('\n');
    const sections: Array<{ type: 'heading' | 'bullet' | 'text' | 'discount' | 'savings' | 'finalPrice'; content: string; value?: string }> = [];
    
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      // Check for bold headings (e.g., **Pricing Details:**)
      if (trimmed.startsWith('**') && trimmed.endsWith(':**')) {
        const heading = trimmed.replace(/\*\*/g, '').replace(':', '');
        sections.push({ type: 'heading', content: heading });
      }
      // Check for discount section (🎉 Special Discount)
      else if (trimmed.includes('🎉') || trimmed.includes('Special Discount')) {
        sections.push({ type: 'discount', content: trimmed.replace(/\*\*/g, '').replace('🎉', '').trim() });
      }
      // Check for savings line (💰 You Save)
      else if (trimmed.includes('💰') || trimmed.includes('You Save')) {
        const savingsMatch = trimmed.match(/(\d[\d,]*)\s*TZS/);
        sections.push({ 
          type: 'savings', 
          content: trimmed.replace(/\*\*/g, '').replace('💰', '').trim(),
          value: savingsMatch ? savingsMatch[1] : undefined
        });
      }
      // Check for Final Price (bolded)
      else if (trimmed.includes('Final Price') && trimmed.includes('**')) {
        const priceMatch = trimmed.match(/(\d[\d,]*)\s*TZS/);
        sections.push({ 
          type: 'finalPrice', 
          content: trimmed.replace(/\*\*/g, '').trim(),
          value: priceMatch ? priceMatch[1] : undefined
        });
      }
      // Check for bold text (e.g., **Final Price:**)
      else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        sections.push({ type: 'heading', content: trimmed.replace(/\*\*/g, '') });
      }
      // Check for bullet points
      else if (trimmed.startsWith('•')) {
        sections.push({ type: 'bullet', content: trimmed.substring(1).trim() });
      }
      // Regular text
      else {
        sections.push({ type: 'text', content: trimmed });
      }
    });
    
    return sections;
  };

  if (loading) {
    return (
      // The page's own shape: title row, control bar, cards
      <div className="w-full min-w-0 space-y-6" aria-busy="true">
        <span role="status" className="sr-only">Loading group stays</span>
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded-full bg-slate-200" />
            <div className="h-7 w-52 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-3.5 w-64 animate-pulse rounded-full bg-slate-100" />
          </div>
          <div className="h-10 w-40 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="flex flex-col gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200 lg:flex-row lg:justify-between">
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-slate-100" />
            ))}
          </div>
          <div className="h-10 w-full animate-pulse rounded-full bg-slate-100 lg:w-80" />
        </div>
        <div className="space-y-4">
          <GroupStayCardSkeleton variant="active" />
          <GroupStayCardSkeleton variant="expired" />
        </div>
      </div>
    );
  }

  return (
    // Full width of the account layout's container, like My tours and the other account pages
    <div
      id="group-stays-page"
      className={[
        "w-full min-w-0 space-y-6 transition-all duration-300 ease-out",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      ].join(" ")}
    >
      <style>{"#group-stays-page, #group-stays-page * { box-sizing: border-box; }"}</style>

      {/* Title row: one line at every width, the action beside the title */}
      <header className="flex items-start justify-between gap-3 sm:items-end">
        <div className="min-w-0">
          <p className="m-0 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#02665e]">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Group bookings
          </p>
          <h1 className="m-0 mt-1.5 text-[26px] font-extrabold leading-none tracking-tight text-slate-900 sm:text-[30px]">My group stays</h1>
          <p className="m-0 mt-2 text-[12.5px] text-slate-500 sm:text-[13.5px]">
            {groupStays.length === 0
              ? "Group stays you request will be kept here, from offers to check-out."
              : `${groupStays.length} group ${groupStays.length === 1 ? "stay" : "stays"} · ${activeCount} active · ${pendingCount} pending`}
          </p>
        </div>
        {/* Only when a ticket is shown; otherwise the invitation card below carries this action */}
        {featureStay ? (
          <Link
            href="/public/group-stays"
            aria-label="Plan a group stay"
            className="mt-5 inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-800 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e] sm:mt-0 sm:h-10 sm:px-4"
          >
            <span className="hidden min-[400px]:inline">Plan a group stay</span>
            <span className="min-[400px]:hidden">Plan</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </header>

      {/* Feature ticket: the stay that needs you most, or an invitation when none is in progress */}
      {(() => {
        const nowMs = now;
        const pick = featureStay;

        if (!pick) {
          return (
            <section aria-label="Plan a group stay" className="relative overflow-hidden rounded-3xl bg-[#02665e] text-white">
              <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15">
                    <Users className="h-6 w-6" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[18px] font-bold leading-tight">Travelling as a group?</p>
                    <p className="m-0 mt-1 text-[13.5px] text-white/75">Share your dates and headcount. Verified stays send offers, you pick the best.</p>
                  </div>
                </div>
                <Link
                  href="/public/group-stays"
                  className="inline-flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90"
                >
                  Plan a group stay <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </section>
          );
        }

        const p = pick.arrangement.property;
        const place = String(p.regionName || p.city || p.title || "GRP").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "GRP";
        const nights = Math.max(1, Math.round((new Date(pick.checkOut).getTime() - new Date(pick.checkIn).getTime()) / 86_400_000));
        const daysToCheckIn = Math.ceil((new Date(pick.checkIn).getTime() - nowMs) / 86_400_000);
        const hasOffers = (pick.auction?.recommendedPropertyCount || 0) > 0 && !pick.auction?.confirmedPropertyId;
        const depositDue = pick.status === "AWAITING_DEPOSIT";
        const eyebrow = depositDue ? "Deposit due" : hasOffers ? "Offers ready" : pick.isValid ? (daysToCheckIn <= 0 ? "Staying now" : "Next group stay") : "Being arranged";
        const depositLeftMs = pick.deposit?.dueAt ? new Date(pick.deposit.dueAt).getTime() - nowMs : null;
        const countdown = depositDue && depositLeftMs != null && depositLeftMs > 0
          ? { big: depositLeftMs >= 86_400_000 ? `${Math.floor(depositLeftMs / 86_400_000)}d` : `${Math.max(1, Math.floor(depositLeftMs / 3_600_000))}h`, small: "to pay deposit" }
          : daysToCheckIn > 0
            ? { big: String(daysToCheckIn), small: daysToCheckIn === 1 ? "day to check-in" : "days to check-in" }
            : { big: "Now", small: "checked in" };
        const action = depositDue
          ? { label: "Pay deposit", href: `/account/group-stays/${encodeURIComponent(pick.groupStayReference)}/deposit` }
          : null;
        return (
          <section aria-label={eyebrow} className="relative overflow-hidden rounded-3xl bg-[#02665e] text-white shadow-[0_24px_48px_-28px_rgba(2,102,94,0.9)]">
            <div className="grid md:grid-cols-[minmax(0,1fr)_14rem] lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="min-w-0 p-5 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">{eyebrow}</p>
                  <span className="font-mono text-[11px] text-white/50">{pick.groupStayReference}</span>
                </div>
                <div className="mt-4 flex items-end gap-3 sm:gap-4">
                  <span className="text-[40px] font-black leading-none tracking-[0.08em] text-white sm:text-[56px]">{place}</span>
                  <div className="min-w-0 pb-1.5">
                    <h2 className="m-0 truncate text-[19px] font-bold leading-tight text-white">{p.title}</h2>
                    <p className="m-0 mt-0.5 truncate text-[13px] text-white/70">{[p.type, p.regionName, p.city].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
                <dl className="m-0 mt-5 grid grid-cols-3 gap-3 sm:mt-6 sm:max-w-md sm:gap-4">
                  {[
                    { label: "Check-in", value: formatDate(pick.checkIn) },
                    { label: "Nights", value: String(nights) },
                    { label: "Guests", value: String(pick.numberOfGuests) },
                  ].map((fact) => (
                    <div key={fact.label}>
                      <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/55">{fact.label}</dt>
                      <dd className="m-0 mt-1 text-[16px] font-bold tabular-nums text-white">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Stub: countdown and the one next step */}
              <div className="relative flex items-center justify-between gap-4 border-0 border-t-2 border-dashed border-white/25 px-5 py-4 md:flex-col md:justify-center md:border-l-2 md:border-t-0 md:p-6 md:text-center">
                <span aria-hidden className="absolute -top-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                <span aria-hidden className="absolute -bottom-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                <div className="flex items-baseline gap-2 md:block">
                  <div className="text-[36px] font-black leading-none tabular-nums text-white md:text-[52px]">{countdown.big}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 md:mt-1.5 md:text-[12px]">{countdown.small}</div>
                </div>
                {action ? (
                  <Link href={action.href} className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90 md:w-full">
                    {action.label} <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // Jump to this stay's card in the list below
                      setFilter(bucketOf(pick));
                      if (hasOffers && !auctionExpanded.has(pick.id)) void toggleAuction(pick.id);
                      window.setTimeout(() => document.getElementById(`group-stay-${pick.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
                    }}
                    className="inline-flex h-10 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-white px-4 text-[13px] font-bold text-[#02665e] transition-colors hover:bg-white/90 md:w-full"
                  >
                    {hasOffers ? "Compare offers" : "View details"} <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      {/* Control bar: status and search, the same as My tours */}
      {groupStays.length > 0 ? (
        <section aria-label="Find your group stays" className="rounded-3xl border border-solid border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(15,23,42,0.25)] sm:p-4">
          {/* Row 1: search and filters; row 2: every status, always visible */}
          <div className="flex items-center gap-2">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]">
              <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span className="sr-only">Search group stays</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search property, place or reference"
                className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
            </label>
            <button
              type="button"
              aria-expanded={showFilters}
              aria-controls="group-stay-filters"
              onClick={() => setShowFilters((v) => !v)}
              className={`inline-flex h-10 flex-shrink-0 cursor-pointer items-center gap-2 rounded-full border border-solid px-3.5 text-[13px] font-semibold transition-colors sm:px-4 ${
                showFilters || advancedCount > 0
                  ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e]"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Filters</span>
              {advancedCount > 0 ? (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#02665e] px-1.5 text-[11px] font-bold text-white">{advancedCount}</span>
              ) : null}
            </button>
          </div>

          <div role="tablist" aria-label="Filter group stays by status" className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STAY_TABS.map((t) => {
              const on = filter === t.key;
              const count = bucketCounts[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(t.key)}
                  className={[
                    "inline-flex h-9 flex-shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                    on
                      ? "border-0 bg-slate-900 text-white"
                      : count === 0
                        ? "border border-solid border-slate-200 bg-white text-slate-400 hover:text-slate-600"
                        : "border border-solid border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {t.label}
                  <span
                    className={[
                      "inline-flex min-w-[20px] justify-center rounded-full px-1.5 text-[11.5px] font-bold tabular-nums",
                      on ? "bg-white/15 text-white" : t.key === "deposit" && count > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {showFilters ? (
            <div id="group-stay-filters" className="mt-3 grid gap-x-4 gap-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-2 sm:p-4 lg:grid-cols-[1.25fr_1.35fr_1fr_1fr]">
              {/* Every filter: a label on one line, then one 40px control */}
              <div className="relative min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Check-in dates</div>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={datePickerOpen}
                  onClick={() => setDatePickerOpen((v) => !v)}
                  className={`mt-1.5 flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl border border-solid bg-white px-3 text-left text-[13px] font-semibold transition-colors ${
                    checkInFrom || datePickerOpen ? "border-[#02665e] text-slate-900" : "border-slate-300 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  <Calendar className={`h-4 w-4 flex-shrink-0 ${checkInFrom ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {checkInFrom
                      ? `${shortDay(checkInFrom)} to ${checkInTo ? shortDay(checkInTo) : "any"}`
                      : "Any dates"}
                  </span>
                  {checkInFrom ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Clear dates"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCheckInFrom("");
                        setCheckInTo("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setCheckInFrom("");
                          setCheckInTo("");
                        }
                      }}
                      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </button>
                {datePickerOpen ? (
                  <div className="absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)]">
                    <DatePicker
                      selected={checkInFrom ? (checkInTo ? [checkInFrom, checkInTo] : checkInFrom) : undefined}
                      allowRange
                      allowPast
                      resetRangeAnchor
                      onSelectAction={(value) => {
                        if (Array.isArray(value)) {
                          // Range finished: first and last day of the selection
                          setCheckInFrom(value[0] || "");
                          setCheckInTo(value[value.length - 1] || "");
                          setDatePickerOpen(false);
                        } else {
                          // First click: start of the range, keep the calendar open for the end
                          setCheckInFrom(value);
                          setCheckInTo("");
                        }
                      }}
                      onCloseAction={() => setDatePickerOpen(false)}
                    />
                  </div>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Group size</div>
                <div role="radiogroup" aria-label="Group size" className="mt-1.5 flex h-10 rounded-xl bg-white p-1 ring-1 ring-slate-300">
                  {GUEST_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={minGuests === n}
                      onClick={() => setMinGuests(n)}
                      className={`h-full min-w-0 flex-1 cursor-pointer rounded-lg border-0 text-[12.5px] font-semibold transition-colors ${
                        minGuests === n ? "bg-[#02665e] text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {n === 0 ? "Any" : `${n}+`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Deposit</div>
                <div role="radiogroup" aria-label="Deposit" className="mt-1.5 flex h-10 rounded-xl bg-white p-1 ring-1 ring-slate-300">
                  {([
                    ["any", "Any"],
                    ["paid", "Paid"],
                    ["unpaid", "Not paid"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={depositFilter === key}
                      onClick={() => setDepositFilter(key)}
                      className={`h-full min-w-0 flex-1 cursor-pointer whitespace-nowrap rounded-lg border-0 px-1.5 text-[12.5px] font-semibold transition-colors ${
                        depositFilter === key ? "bg-[#02665e] text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block min-w-0">
                <span className="block text-[11.5px] font-bold text-slate-600">Sort by</span>
                <span className="relative mt-1.5 block">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortKey)}
                    className="h-10 w-full cursor-pointer appearance-none bg-none rounded-xl border border-solid border-slate-300 bg-white pl-3 pr-9 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus:border-[#02665e] focus:outline-none"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                </span>
              </label>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 pt-3">
            <span className="min-w-0 truncate text-[12.5px] text-slate-500">
              <span className="hidden sm:inline">Showing </span>
              <strong className="font-bold tabular-nums text-slate-900">{displayGroupStays.length}</strong> of {filteredGroupStays.length}
              <span className="hidden min-[400px]:inline">
                {" "}
                {filter === "all" ? "" : `${activeTab.label.toLowerCase()} `}
                {filteredGroupStays.length === 1 ? "stay" : "stays"}
              </span>
            </span>
            {query || advancedCount > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {checkInFrom || checkInTo ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
                    {checkInFrom ? shortDay(checkInFrom) : "Any"} to {checkInTo ? shortDay(checkInTo) : "any"}
                    <button type="button" aria-label="Clear dates" onClick={() => { setCheckInFrom(""); setCheckInTo(""); }} className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 hover:bg-slate-200"><X className="h-3 w-3" /></button>
                  </span>
                ) : null}
                {minGuests > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
                    {minGuests}+ guests
                    <button type="button" aria-label="Clear group size" onClick={() => setMinGuests(0)} className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 hover:bg-slate-200"><X className="h-3 w-3" /></button>
                  </span>
                ) : null}
                {depositFilter !== "any" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
                    Deposit {depositFilter === "paid" ? "paid" : "not paid"}
                    <button type="button" aria-label="Clear deposit filter" onClick={() => setDepositFilter("any")} className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 hover:bg-slate-200"><X className="h-3 w-3" /></button>
                  </span>
                ) : null}
                <button type="button" onClick={() => { setQuery(""); resetAdvanced(); }} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline">
                  Clear all
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {displayGroupStays.length === 0 && narrowed && filteredGroupStays.length > 0 ? (
        <div className="rounded-3xl border border-solid border-slate-200 bg-white px-6 py-10 text-center">
          <Search className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
          <p className="m-0 mt-3 text-[15px] font-bold text-slate-900">
            {query.trim() ? <>Nothing matches &ldquo;{query.trim()}&rdquo;</> : "No stays match these filters"}
          </p>
          <p className="m-0 mt-1 text-[13px] text-slate-500">Try another word, widen the dates or clear the filters.</p>
          <button type="button" onClick={() => { setQuery(""); resetAdvanced(); }} className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-800 hover:border-[#02665e] hover:text-[#02665e]">
            Clear all
          </button>
        </div>
      ) : filteredGroupStays.length === 0 ? (
        <div className="relative overflow-hidden rounded-3xl border border-solid border-slate-100 bg-white p-12 text-center shadow-[0_2px_20px_rgba(0,0,0,0.05)]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{ background: "radial-gradient(circle at 50% 0%, #059669, transparent 60%)" }} />
          <div className="relative">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl shadow-md"
            style={{ background: "linear-gradient(135deg, #0a2e19 0%, #059669 100%)" }}>
            <Users className="h-8 w-8 text-white" />
          </div>
          <div className="mt-5 text-xl font-bold text-slate-900">No group stays found</div>
          <div className="mt-2 text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
            {activeTab.empty}
          </div>
          {(filter === "active" || filter === "all") && (
            <div className="mt-7 flex justify-center">
              <Link
                href="/public/group-stays"
                className="group no-underline inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold text-white shadow-md hover:shadow-lg active:scale-[0.99] transition-all"
                style={{ background: "linear-gradient(135deg, #0a2e19 0%, #059669 100%)" }}
              >
                Book a group stay
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {displayGroupStays.map((stay, idx) => {
            const section = stay.status === "REVIEWING" ? "reviewing" : stay.status === "PENDING" ? "pending" : "other";
            const prev = idx > 0 ? displayGroupStays[idx - 1] : null;
            const next = idx + 1 < displayGroupStays.length ? displayGroupStays[idx + 1] : null;
            const prevSection =
              prev?.status === "REVIEWING" ? "reviewing" : prev?.status === "PENDING" ? "pending" : "other";
            const nextSection =
              next?.status === "REVIEWING" ? "reviewing" : next?.status === "PENDING" ? "pending" : "other";

            const showSectionHeader = filter === "pending" && section !== "other" && (idx === 0 || section !== prevSection);
            const showSectionDivider =
              filter === "pending" && section !== "other" && Boolean(next) && nextSection === section;
            const sectionTitle = section === "reviewing" ? "Under Review" : "Pending";
            const sectionDescription =
              section === "reviewing"
                ? "Admin is actively reviewing these requests."
                : "Submitted and waiting for admin to start review.";
            const sectionCount = section === "reviewing" ? reviewingOnlyCount : pendingOnlyCount;

            return (
              <div key={`${stay.id}-${section}`} id={`group-stay-${stay.id}`} className="scroll-mt-24 space-y-2">
                {showSectionHeader && (
                  <div className="pt-2 pb-1">
                    <div
                      className="flex items-center justify-between rounded-2xl px-4 py-2.5"
                      style={{ background: section === "reviewing" ? "linear-gradient(135deg, rgba(13,92,57,0.08), rgba(5,150,105,0.05))" : "rgba(251,191,36,0.07)", border: section === "reviewing" ? "1px solid rgba(5,150,105,0.15)" : "1px solid rgba(251,191,36,0.2)" }}
                    >
                      <div>
                        <div className="text-sm font-bold" style={{ color: section === "reviewing" ? "#065f46" : "#92400e" }}>{sectionTitle}</div>
                        <div className="mt-0.5 text-xs" style={{ color: section === "reviewing" ? "#047857" : "#b45309" }}>{sectionDescription}</div>
                      </div>
                      <span className="inline-flex items-center justify-center h-6 min-w-6 rounded-full px-2 text-xs font-bold"
                        style={{ background: section === "reviewing" ? "rgba(5,150,105,0.15)" : "rgba(251,191,36,0.2)", color: section === "reviewing" ? "#065f46" : "#92400e" }}>
                        {sectionCount}
                      </span>
                    </div>
                  </div>
                )}

                <div className="group">
                  {/* No overflow-hidden: the chat pop-over must escape the ticket. The perforation notches sit on the page background either way. */}
                  <div className="relative rounded-3xl border border-solid border-slate-300 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_10px_28px_-20px_rgba(15,23,42,0.35)] transition-shadow duration-200 hover:shadow-[0_18px_36px_-20px_rgba(15,23,42,0.4)]">
              <div className="flex flex-col gap-4 p-5 sm:p-6">
                <div className="min-w-0 flex-1">
                  {/* Ticket top: place code and status, what and where, the journey, the dates */}
                  {(() => {
                    const p = stay.arrangement.property;
                    const placeParts = [p.district, p.city, p.regionName].filter(Boolean).map((x) => tidyName(String(x)));
                    const where = placeParts.filter((x, i) => placeParts.indexOf(x) === i).join(", ");
                    const code = String(p.regionName || p.city || p.title || "GRP").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "GRP";
                    const muted = !stay.isValid && stay.status !== "PENDING" && stay.status !== "REVIEWING" && stay.status !== "PROCESSING" && stay.status !== "AWAITING_DEPOSIT";
                    const tone = statusTone(stay);
                    const nights = Math.max(1, Math.round((new Date(stay.checkOut).getTime() - new Date(stay.checkIn).getTime()) / 86_400_000));
                    const hasOffers = (stay.auction?.recommendedPropertyCount || 0) > 0;
                    // Where the request has reached: Requested, Reviewed, Offers, Deposit, Confirmed
                    const reached =
                      stay.status === "COMPLETED" || (stay.isValid && stay.status !== "AWAITING_DEPOSIT" && stay.status !== "PENDING" && stay.status !== "REVIEWING" && stay.status !== "PROCESSING") ? 4
                      : stay.status === "AWAITING_DEPOSIT" ? 3
                      : hasOffers ? 2
                      : stay.status === "REVIEWING" || stay.status === "PROCESSING" ? 1
                      : 0;
                    const steps = ["Requested", "Reviewed", "Offers", "Deposit", "Confirmed"];
                    return (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <span className={`text-[34px] font-black leading-none tracking-[0.08em] ${muted ? "text-slate-300" : "text-[#02665e]"}`}>{code}</span>
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${tone.chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                            {getStatusLabel(stay)}
                          </span>
                        </div>
                        <h3 className="m-0 mt-3 text-[16px] font-bold leading-snug text-slate-900">{tidyName(p.title)}</h3>
                        <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-slate-500">
                          <span className="capitalize">{p.type ? String(p.type).toLowerCase() : "Stay"}</span>
                          {where ? (
                            <>
                              <span aria-hidden className="text-slate-300">·</span>
                              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-400" />{where}</span>
                            </>
                          ) : null}
                        </p>

                        <dl className="m-0 mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {[
                            { label: "Check-in", value: formatDate(stay.checkIn) },
                            { label: "Check-out", value: formatDate(stay.checkOut) },
                            { label: "Nights", value: String(nights) },
                            { label: "Guests", value: String(stay.numberOfGuests) },
                          ].map((fact) => (
                            <div key={fact.label} className="min-w-0">
                              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{fact.label}</dt>
                              <dd className={`m-0 mt-0.5 truncate text-[14px] font-bold tabular-nums ${muted ? "text-slate-500" : "text-slate-900"}`}>{fact.value}</dd>
                            </div>
                          ))}
                        </dl>

                        {/* Journey: each step a segment, reached ones filled */}
                        <div className="mt-4" aria-label={`Progress: ${steps[reached]}`}>
                          <div className="flex gap-1">
                            {steps.map((s, i) => (
                              <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= reached ? (muted ? "bg-slate-300" : "bg-[#02665e]") : "bg-slate-100"}`} />
                            ))}
                          </div>
                          <div className="mt-1.5 hidden grid-cols-5 sm:grid">
                            {steps.map((s, i) => (
                              <span key={s} className={`text-[10.5px] ${i === reached ? `font-bold ${muted ? "text-slate-500" : "text-[#02665e]"}` : i < reached ? "text-slate-500" : "text-slate-300"}`}>{s}</span>
                            ))}
                          </div>
                        </div>

                        {/* Perforation: the ticket tears here */}
                        <div aria-hidden className="relative -mx-5 my-4 sm:-mx-6">
                          {/* Notches: only the inner half is drawn, so the card border bends into a clean cut-out */}
                          <span className="absolute -left-[11px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-solid border-slate-300 bg-neutral-50 [clip-path:inset(0_0_0_50%)]" />
                          <span className="absolute -right-[11px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-solid border-slate-300 bg-neutral-50 [clip-path:inset(0_50%_0_0)]" />
                          <div className="mx-5 border-0 border-t-2 border-dashed border-slate-300" />
                        </div>

                        {/* Ticket bottom: the money, the people, the conversation */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            {Number(stay.totalAmount || 0) > 0 ? (
                              <div className={`text-[18px] font-extrabold leading-tight tabular-nums ${muted ? "text-slate-500" : "text-slate-900"}`}>
                                {Math.round(Number(stay.totalAmount)).toLocaleString("en-US")} <span className="text-[11.5px] font-semibold text-slate-400">TZS</span>
                              </div>
                            ) : (
                              <div className="text-[16px] font-bold leading-tight text-slate-500">To be quoted</div>
                            )}
                            <div className="mt-0.5 text-[11.5px] text-slate-400">
                              {stay.deposit?.paid ? "Deposit paid" : stay.status === "AWAITING_DEPOSIT" ? "Deposit due to confirm" : Number(stay.totalAmount || 0) > 0 ? "Group total" : "Offers pending"}
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            {stay.passengers && stay.passengers.length > 0 ? (
                              <button
                                type="button"
                                aria-expanded={expandedPassengers.has(stay.id)}
                                aria-label={`${stay.passengers.length} travellers`}
                                onClick={() => {
                                  const next = new Set(expandedPassengers);
                                  if (next.has(stay.id)) next.delete(stay.id);
                                  else next.add(stay.id);
                                  setExpandedPassengers(next);
                                }}
                                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-solid border-slate-200 bg-white py-0.5 pl-0.5 pr-3 text-[12.5px] font-semibold text-slate-700 transition hover:border-slate-300"
                              >
                                <span className="flex -space-x-2">
                                  {stay.passengers.slice(0, 3).map((pg) => (
                                    <span key={pg.id} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#02665e] text-[10px] font-bold text-white ring-2 ring-white">
                                      {pg.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "G"}
                                    </span>
                                  ))}
                                </span>
                                {stay.passengers.length}
                                <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expandedPassengers.has(stay.id) ? "rotate-180" : ""}`} />
                              </button>
                            ) : null}
                            <GroupStayMessaging bookingId={stay.id} />
                          </div>
                        </div>

                        {expandedPassengers.has(stay.id) && stay.passengers?.length ? (
                          <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                            {stay.passengers.map((passenger) => (
                              <li key={passenger.id} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                                  <User className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 leading-tight">
                                  <span className="block truncate text-[13.5px] font-semibold text-slate-900">{passenger.name}</span>
                                  {passenger.nationality ? <span className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-500"><Globe className="h-3 w-3" />{passenger.nationality}</span> : null}
                                  {passenger.phone ? <span className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-500"><Phone className="h-3 w-3" />{passenger.phone}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    );
                  })()}

                  {/* Admin Messages & Recommendations */}
                  {stay.adminSuggestions && (stay.status !== "PENDING" && stay.status !== "REVIEWING") && (
                    <div className="mt-4 sm:mt-5 rounded-2xl border border-solid border-gray-200 bg-white shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden">
                      <div className="p-4 sm:p-5 lg:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-5 sm:mb-6 pb-4 border-0 border-b border-solid border-gray-200">
                          <div className="h-12 w-12 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0" style={{ backgroundColor: '#02665e' }}>
                            <MessageSquare className="h-6 w-6 text-white" />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-base sm:text-lg font-bold text-gray-900">Admin Updates & Recommendations</h4>
                            <p className="text-xs sm:text-sm text-gray-600 mt-1">Important information about your booking</p>
                          </div>
                        </div>
                        
                        <div className="space-y-4 sm:space-y-5">
                          {/* Pricing & Budget - Sidebar Style */}
                          {stay.adminSuggestions.pricing && (() => {
                            const formatted = formatAdminText(stay.adminSuggestions.pricing);
                            return (
                              <div className="bg-white rounded-2xl border-0 border-l-4 border-solid shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden" style={{ borderLeftColor: '#02665e' }}>
                                <div className="flex flex-col sm:flex-row">
                                  <div className="w-full sm:w-48 px-4 sm:px-5 py-4 sm:py-5 flex sm:flex-col items-center sm:items-start justify-center sm:justify-start gap-3" style={{ backgroundColor: '#02665e' }}>
                                    <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center">
                                      <DollarSign className="h-5 w-5" style={{ color: '#02665e' }} />
                                    </div>
                                    <div className="text-center sm:text-left">
                                      <h5 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Pricing & Budget</h5>
                                      <div className="h-0.5 w-12 bg-white/30 mx-auto sm:mx-0"></div>
                                    </div>
                                  </div>
                                  <div className="flex-1 p-4 sm:p-5">
                                  {formatted ? (
                                    <div className="space-y-3">
                                      {formatted.map((item, idx) => {
                                        if (item.type === 'heading') {
                                          return (
                                            <div key={idx} className="font-bold text-gray-900 text-sm sm:text-base mt-4 first:mt-0 flex items-center gap-2">
                                              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#02665e' }}></div>
                                              {item.content}
                                            </div>
                                          );
                                        } else if (item.type === 'discount') {
                                          return (
                                            <div key={idx} className="mt-4 pt-4 border-0 border-t-2 border-solid border-gray-200">
                                              <div className="flex items-center gap-2.5 mb-3">
                                                <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: '#02665e' }}>
                                                  <Gift className="h-4 w-4 text-white" />
                                                </div>
                                                <span className="font-bold text-gray-900 text-sm sm:text-base">{item.content}</span>
                                              </div>
                                            </div>
                                          );
                                        } else if (item.type === 'finalPrice') {
                                          return (
                                            <div key={idx} className="mt-3 p-3 sm:p-4 bg-gray-50 rounded-lg border-2 border-solid border-gray-200">
                                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                <span className="font-semibold text-gray-700 text-sm sm:text-base">Final Price:</span>
                                                <span className="font-bold text-lg sm:text-xl" style={{ color: '#02665e' }}>
                                                  {item.value ? `${item.value.replace(/,/g, ',')} TZS` : item.content.match(/(\d[\d,]*)\s*TZS/)?.[0] || item.content}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        } else if (item.type === 'savings') {
                                          return (
                                            <div key={idx} className="mt-3 p-3 sm:p-4 bg-gray-100 rounded-lg border-2 border-solid border-gray-300 shadow-sm">
                                              <div className="flex items-center gap-2.5">
                                                <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: '#02665e' }}>
                                                  <Tag className="h-4 w-4 text-white" />
                                                </div>
                                                <div className="flex-1">
                                                  <span className="font-bold text-sm sm:text-base block" style={{ color: '#02665e' }}>
                                                    {item.content}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        } else if (item.type === 'bullet') {
                                          // Check if it's a discount-related bullet
                                          const isDiscountInfo = item.content.includes('Discount:') || item.content.includes('Original Price:') || item.content.includes('Discount Amount:');
                                          const isPriceInfo = item.content.includes('Price per Night:') || item.content.includes('Total Nights:') || item.content.includes('Total Amount:');
                                          
                                          return (
                                            <div key={idx} className={`flex items-start gap-3 text-sm sm:text-base ${isDiscountInfo ? 'text-gray-900 font-semibold' : isPriceInfo ? 'text-gray-800' : 'text-gray-700'}`}>
                                              <span className="mt-1.5 flex-shrink-0 font-bold" style={{ color: '#02665e' }}>•</span>
                                              <span className="flex-1 leading-relaxed">{item.content}</span>
                                            </div>
                                          );
                                        } else {
                                          return (
                                            <div key={idx} className="text-sm sm:text-base text-gray-700 leading-relaxed">
                                              {item.content}
                                            </div>
                                          );
                                        }
                                      })}
                                    </div>
                                  ) : (
                                    <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                      {stay.adminSuggestions.pricing}
                                    </div>
                                  )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Accommodation Options - Top Bar Style */}
                          {stay.adminSuggestions.accommodationOptions && (
                            <div className="bg-white rounded-2xl border border-solid border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="border-0 border-b-2 border-solid px-4 sm:px-5 py-3.5 bg-gray-50" style={{ borderBottomColor: '#02665e' }}>
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-xl border-2 border-solid bg-white flex items-center justify-center" style={{ borderColor: '#02665e' }}>
                                    <Building2 className="h-5 w-5" style={{ color: '#02665e' }} />
                                  </div>
                                  <div>
                                    <span className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider block">Accommodation Options</span>
                                    <div className="h-0.5 w-16 mt-1" style={{ backgroundColor: '#02665e' }}></div>
                                  </div>
                                </div>
                              </div>
                              <div className="p-4 sm:p-5">
                                <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                  {stay.adminSuggestions.accommodationOptions}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Recommendations - Icon Badge Style */}
                          {stay.adminSuggestions.recommendations && (
                            <div className="bg-white rounded-2xl border border-solid border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="p-4 sm:p-5">
                                <div className="flex items-start gap-4 mb-4">
                                  <div className="h-14 w-14 rounded-2xl border-2 border-solid bg-gray-50 flex items-center justify-center flex-shrink-0" style={{ borderColor: '#02665e' }}>
                                    <Sparkles className="h-7 w-7" style={{ color: '#02665e' }} />
                                  </div>
                                  <div className="flex-1 pt-1">
                                    <h5 className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider mb-1">Recommendations</h5>
                                    <div className="h-1 w-20 rounded-full" style={{ backgroundColor: '#02665e' }}></div>
                                  </div>
                                </div>
                                <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed pl-0 sm:pl-18">
                                  {stay.adminSuggestions.recommendations}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Next Steps - Bottom Accent Style */}
                          {stay.adminSuggestions.nextSteps && (
                            <div className="bg-white rounded-2xl border border-solid border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="p-4 sm:p-5 pb-6">
                                <div className="flex items-center gap-3 mb-4">
                                  <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#02665e' }}>
                                    <ArrowRight className="h-5 w-5 text-white" />
                                  </div>
                                  <div>
                                    <h5 className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider">Next Steps</h5>
                                    <div className="flex items-center gap-1 mt-1">
                                      <div className="h-1 w-8 rounded-full" style={{ backgroundColor: '#02665e' }}></div>
                                      <div className="h-1 w-1 bg-gray-400 rounded-full"></div>
                                      <div className="h-1 w-1 bg-gray-400 rounded-full"></div>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                  {stay.adminSuggestions.nextSteps}
                                </div>
                              </div>
                              <div className="h-1" style={{ backgroundColor: '#02665e' }}></div>
                            </div>
                          )}

                          {/* General Notes - Minimalist Style */}
                          {stay.adminSuggestions.notes && (
                            <div className="bg-gray-50 rounded-2xl border-2 border-solid border-gray-300 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="p-4 sm:p-5">
                                <div className="flex items-center gap-3 mb-4 pb-3 border-0 border-b border-solid border-gray-300">
                                  <FileText className="h-6 w-6" style={{ color: '#02665e' }} />
                                  <h5 className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider">Additional Notes</h5>
                                </div>
                                <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                  {stay.adminSuggestions.notes}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Deposit due — confirm the booking by paying the deposit */}
                  {stay.status === "AWAITING_DEPOSIT" && (() => {
                    const dep = stay.deposit;
                    const currency = dep?.currency || "TZS";
                    const depositAmount = Number(dep?.amount || 0);
                    const total = Number(stay.totalAmount || 0);
                    const remaining = Number(dep?.ownerAmount ?? stay.ownerAmount ?? Math.max(0, total - depositAmount));
                    const fmtMoney = (v: number) => `${currency} ${Math.round(v).toLocaleString()}`;
                    const dueMs = dep?.dueAt ? new Date(dep.dueAt).getTime() - now : null;
                    const expired = !!dep?.expired || (dueMs != null && dueMs <= 0);

                    if (expired) {
                      return (
                        <div className="mt-4 sm:mt-5 rounded-2xl border border-solid border-rose-200 bg-rose-50 p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-white border border-solid border-rose-200">
                              <Clock className="h-5 w-5 text-rose-600" />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <h4 className="m-0 text-base font-bold text-rose-900">Deposit window expired</h4>
                                <p className="m-0 mt-1 text-xs text-rose-700/90 sm:text-sm">
                                  {`The ${fmtMoney(depositAmount)} deposit wasn't paid in time, so this offer has lapsed. Book again to get fresh offers.`}
                                </p>
                                {dep?.dueAt && (
                                  <p className="m-0 mt-1.5 text-[11px] text-rose-500/80">
                                    Expired{" "}
                                    {new Date(dep.dueAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                )}
                              </div>
                              <Link
                                href="/public/group-stays"
                                onClick={() => saveRebookDraft(stay.request)}
                                className="group/again inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-full bg-[#02665e] px-4 text-[13px] font-semibold text-white no-underline shadow-sm transition-colors hover:bg-[#014e47] sm:self-auto"
                              >
                                Book again
                                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/again:translate-x-0.5" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const dueLabel = dueMs == null ? null : (() => {
                      const mins = Math.ceil(dueMs / 60000);
                      const d = Math.floor(mins / 1440);
                      const h = Math.floor((mins % 1440) / 60);
                      const m = mins % 60;
                      if (d > 0) return `${d}d ${h}h ${m}m left`;
                      return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
                    })();
                    const dueDateLabel = dep?.dueAt
                      ? new Date(dep.dueAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : null;
                    const urgent = dueMs != null && dueMs < 3 * 60 * 60 * 1000;

                    return (
                      <div className="mt-4 sm:mt-5 rounded-2xl border border-solid border-amber-200 bg-amber-50 overflow-hidden">
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-white border border-solid border-amber-200">
                                <DollarSign className="h-5 w-5 text-amber-600" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-base font-bold text-slate-900">Deposit due to confirm</h4>
                                <p className="text-xs text-slate-600 mt-0.5">
                                  Pay the deposit to lock your rooms. The stay balance is settled on check-in.
                                </p>
                                {dueLabel && dueDateLabel && (
                                  <div className={`mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-solid px-2.5 py-1.5 text-xs font-semibold ${urgent ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-white/70 text-amber-800'}`}>
                                    <span className="inline-flex items-center gap-1">
                                      <Clock className="h-3.5 w-3.5" /> {dueLabel}
                                    </span>
                                    <span className="text-slate-300">•</span>
                                    <span>Deadline: {dueDateLabel}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <Link
                              href={`/account/group-stays/${encodeURIComponent(stay.groupStayReference)}/deposit`}
                              className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#02665e] to-emerald-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow-lg shadow-emerald-900/15 ring-4 ring-emerald-100 transition-all hover:-translate-y-0.5 hover:from-[#014e47] hover:to-emerald-700 hover:shadow-xl whitespace-nowrap self-start"
                            >
                              Pay here · {fmtMoney(depositAmount)}
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                                <ArrowRight className="h-3.5 w-3.5" />
                              </span>
                            </Link>
                          </div>

                          {total > 0 && (
                            <div className="mt-4 grid grid-cols-3 gap-2">
                              <div className="rounded-xl border border-solid border-amber-200/70 bg-white px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                                  Deposit to secure
                                </div>
                                <div className="text-sm font-bold text-amber-700 tabular-nums">{fmtMoney(depositAmount)}</div>
                              </div>
                              <div className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-slate-400">Total</div>
                                <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(total)}</div>
                              </div>
                              <div className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-slate-400">Stay balance</div>
                                <div className="text-sm font-bold text-slate-600 tabular-nums">{fmtMoney(remaining)}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {stay.deposit?.paid && (
                    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 p-4 sm:mt-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
                          <CheckCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-emerald-900">Deposit payment confirmed</div>
                          <div className="mt-0.5 text-xs text-emerald-700">Your receipt remains available with this booking.</div>
                        </div>
                      </div>
                      <Link href={`/account/group-stays/${encodeURIComponent(stay.groupStayReference)}/receipt`} className="inline-flex items-center justify-center rounded-xl border border-solid border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-[#02665e] no-underline shadow-sm hover:bg-emerald-50">
                        View receipt
                      </Link>
                    </div>
                  )}

                  {/* Auction Offers (separate from normal recommendations) */}
                  {((stay.auction?.recommendedPropertyCount || 0) > 0) && !stay.auction?.confirmedPropertyId && (
                    <div className="relative mt-4 overflow-hidden rounded-3xl border border-solid border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-white to-white shadow-[0_10px_30px_rgba(15,23,42,0.06)] animate-in fade-in slide-in-from-bottom-2 duration-500 sm:mt-5">
                      <div className="relative p-5 sm:p-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e] shadow-sm">
                              <Sparkles className="h-5 w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-lg font-extrabold tracking-tight text-slate-950 sm:text-xl">Your shortlisted stays are ready</h4>
                                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
                                  {stay.auction?.recommendedPropertyCount} {stay.auction?.recommendedPropertyCount === 1 ? "offer" : "offers"}
                                </span>
                              </div>
                              <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">
                                Compare prices and inclusions, then choose the accommodation that suits your group.
                              </p>
                            </div>
                          </div>

                          <button
                            onClick={() => toggleAuction(stay.id)}
                            className="group inline-flex w-full flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-[#02665e] px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#014e47] sm:w-auto"
                          >
                            {auctionExpanded.has(stay.id) ? "Hide offers" : "View offers"}
                            <ChevronDown
                              className="h-4 w-4 text-white/80 transition-transform group-hover:text-white"
                              style={{ transform: auctionExpanded.has(stay.id) ? "rotate(180deg)" : "rotate(0deg)" }}
                            />
                          </button>
                        </div>

                        <div
                          className={`overflow-hidden transition-all duration-300 ease-in-out ${
                            auctionExpanded.has(stay.id) ? "max-h-[3000px] opacity-100 mt-5" : "max-h-0 opacity-0"
                          }`}
                        >
                          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-2 pr-8 touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-2 md:overflow-visible md:pb-0 md:pr-0 xl:grid-cols-3">
                            {auctionLoading.has(stay.id) && (
                              <div className="rounded-xl border border-solid border-slate-200 bg-slate-50 p-4 flex items-center gap-3 text-sm text-slate-700">
                                <LogoSpinner size="xs" ariaLabel="Loading offers" />
                                Loading offers...
                              </div>
                            )}

                            {!auctionLoading.has(stay.id) && (auctionOffersByBooking[stay.id] || []).length === 0 && (
                              <div className="rounded-xl border border-solid border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                                No offers available yet.
                              </div>
                            )}

                            {(auctionOffersByBooking[stay.id] || []).map((offer) => {
                              const offers = auctionOffersByBooking[stay.id] || [];
                              const total = Number(offer.offer.customerTotalAmount ?? offer.offer.totalAmount ?? 0);
                              const nightly = Number(offer.offer.customerPricePerNight ?? offer.offer.offeredPricePerNight ?? 0);
                              const discount = Number(offer.offer.discountPercent || 0);
                              const bestTotal = Math.min(...offers.map((item) => Number(item.offer.customerTotalAmount ?? item.offer.totalAmount ?? Infinity)));
                              const isBestPrice = offers.length > 1 && total > 0 && total === bestTotal;
                              const originalNightly = Number(offer.offer.customerOriginalPricePerNight ?? 0) > 0
                                ? Number(offer.offer.customerOriginalPricePerNight)
                                : (discount > 0 && discount < 100 ? nightly / (1 - discount / 100) : null);
                              const originalTotal = Number(offer.offer.customerOriginalTotalAmount ?? 0) > 0
                                ? Number(offer.offer.customerOriginalTotalAmount)
                                : (originalNightly && nightly > 0 ? total * (originalNightly / nightly) : null);
                              const savings = Number(offer.offer.customerSavingsAmount ?? 0) > 0
                                ? Number(offer.offer.customerSavingsAmount)
                                : (originalTotal && total > 0 ? originalTotal - total : null);
                              const amenities = (offer.offer.specialOffers || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
                              const location = [offer.property.regionName, offer.property.district, offer.property.ward || offer.property.city].filter(Boolean).join(", ");

                              return (
                                <div key={offer.claimId} className="group flex h-full w-[92%] flex-none snap-start flex-col rounded-2xl border border-solid border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:w-[78%] md:w-auto md:min-w-0">
                                  <div className="px-4 pt-4">
                                    <div className="flex min-w-0 items-start gap-2">
                                      <h5 className="min-w-0 flex-1 truncate text-base font-bold text-slate-900">{offer.property.title}</h5>
                                      {isBestPrice && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">Best price</span>}
                                    </div>
                                  </div>

                                  <div className="px-4 pt-3">
                                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
                                      {offer.property.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={offer.property.imageUrl} alt={offer.property.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                                      ) : (
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(2,102,94,0.18),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(2,132,199,0.12),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]">
                                          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-solid border-slate-200 bg-white/90 shadow-sm">
                                              <ImageIcon className="h-6 w-6 text-slate-500" />
                                            </div>
                                            <span className="mt-2 text-xs font-semibold">Property photo unavailable</span>
                                          </div>
                                        </div>
                                      )}
                                      <VerifiedIcon />
                                      {discount > 0 && <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-extrabold text-white shadow-sm">-{Math.round(discount)}% OFF</span>}
                                    </div>
                                  </div>

                                  <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                                    <div className="flex min-w-0 items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                          <MapPin className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
                                          <span className="truncate">{location || "Location not provided"}</span>
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <div className="text-sm font-extrabold text-slate-900">{nightly.toLocaleString("en-US")} {offer.offer.currency}</div>
                                        <div className="text-[11px] text-slate-500">per night</div>
                                      </div>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                                      <div>
                                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Stay total</div>
                                        <div className="mt-0.5 text-sm font-extrabold text-slate-800">{total.toLocaleString("en-US")} {offer.offer.currency}</div>
                                      </div>
                                      <div className="text-right">
                                        {originalNightly && <div className="text-[11px] text-slate-400 line-through">{Math.round(originalNightly).toLocaleString("en-US")} / night</div>}
                                        {savings && savings > 0 ? <div className="mt-0.5 text-xs font-bold text-emerald-700">Save {Math.round(savings).toLocaleString("en-US")}</div> : null}
                                      </div>
                                    </div>

                                    {amenities.length > 0 && (
                                      <div className="mt-3 min-w-0">
                                        <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Included with this offer</div>
                                        <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                          <div className="grid w-max grid-flow-col grid-rows-2 gap-1.5">
                                            {amenities.map((amenity, index) => (
                                              <span key={`${offer.claimId}-${index}`} className="whitespace-nowrap rounded-lg border border-solid border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                                {amenity}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {offer.offer.notes && <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{offer.offer.notes}</p>}

                                    <button disabled={auctionConfirming.has(stay.id)} onClick={() => confirmAuctionOffer(stay.id, offer.property.id)} className={["mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 pt-3 text-sm font-semibold transition-colors", auctionConfirming.has(stay.id) ? "cursor-not-allowed bg-slate-100 text-slate-500" : "bg-[#02665e] text-white hover:bg-[#014e47]"].join(" ")}>
                                      {auctionConfirming.has(stay.id) ? <><LogoSpinner size="xs" ariaLabel="Confirming offer" />Confirming...</> : <><CheckCircle className="h-4 w-4" />Choose this offer</>}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
                </div>

                  {showSectionDivider && (
                    <div className="h-[2px] rounded-full bg-slate-300/80 opacity-80 transition-all duration-200 ease-out group-hover:bg-slate-400/80 group-hover:opacity-100 transform scale-x-[0.98] group-hover:scale-x-100 origin-center" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Messaging component for group stays
type ConversationMessage = {
  id: number;
  messageType: string;
  message: string;
  senderRole: string;
  senderName: string;
  createdAt: string;
  formattedDate: string;
};

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function GroupStayMessaging({ bookingId }: { bookingId: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messageType, setMessageType] = useState("Ask for Feedback");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const response = await api.get(`/api/customer/group-stays/${bookingId}/messages`);
      if (response.data.success && response.data.messages) {
        const formattedMessages: ConversationMessage[] = response.data.messages.map((m: any) => ({
          id: m.id,
          messageType: m.messageType || "General",
          message: m.message,
          senderRole: m.senderRole,
          senderName: m.senderName || "Unknown",
          createdAt: m.createdAt,
          formattedDate: m.formattedDate,
        }));
        setConversationMessages(formattedMessages);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
      setConversationMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [bookingId]);

  // Initialize Socket.IO connection
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Use NEXT_PUBLIC_SOCKET_URL if available, otherwise fall back to API_URL or localhost
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 
                      process.env.NEXT_PUBLIC_API_URL || 
                      'http://localhost:4000';
    
    // Only connect if we have a valid URL
    if (!socketUrl) {
      console.warn('Socket.IO: No API URL configured, skipping connection');
      return;
    }
    
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('Socket connected for group booking messages');
      // Join user room for receiving messages
      const userId = localStorage.getItem('userId') || '';
      if (userId) {
        // Use the correct event name based on API handlers
        newSocket.emit('join-user-room', { userId: userId });
      }
    });

    newSocket.on('connect_error', (error) => {
      console.warn('Socket.IO connection error:', error.message);
      // Don't show error to user, just log it - polling fallback will handle it
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
    });

    newSocket.on('group-stay:message:new', (data: any) => {
      if (data.groupBookingId === bookingId) {
        // Reload messages when new message arrives
        loadMessages();
      }
    });

    // Also listen for the alternative event name
    newSocket.on('group-booking:message:new', (data: any) => {
      if (data.groupBookingId === bookingId) {
        // Reload messages when new message arrives
        loadMessages();
      }
    });

    return () => {
      if (newSocket && newSocket.connected) {
        const userId = localStorage.getItem('userId') || '';
        if (userId) {
          newSocket.emit('leave-user-room', { userId: userId });
        }
        newSocket.close();
      }
    };
  }, [bookingId, loadMessages]);

  // Load messages on mount and when bookingId changes
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const messageTypes = [
    "Ask for Feedback",
    "Ask for Clarification",
    "Request Status Update",
    "Provide Additional Information",
    "Other",
  ];

  // Auto-fill messages based on message type
  const getMessageTemplate = (type: string): string => {
    const templates: Record<string, string> = {
      "Ask for Feedback": "Hello,\n\nI would appreciate your feedback on my group stay booking. Please let me know if you need any additional information or if there are any concerns I should address.\n\nThank you.",
      "Ask for Clarification": "Hello,\n\nI would like to request some clarification regarding my group stay booking. Could you please provide more details on the following:\n\n[Please specify what you need clarification on]\n\nThank you for your assistance.",
      "Request Status Update": "Hello,\n\nI would like to request an update on the status of my group stay booking. Could you please let me know the current progress and expected timeline?\n\nThank you.",
      "Provide Additional Information": "Hello,\n\nI would like to provide some additional information regarding my group stay booking:\n\n[Please add your additional information here]\n\nPlease let me know if you need anything else.\n\nThank you.",
      "Other": "",
    };
    return templates[type] || "";
  };

  const handleMessageTypeChange = (newType: string) => {
    setMessageType(newType);
    const template = getMessageTemplate(newType);
    setMessage(template);
  };

  const handleSend = async () => {
    if (!message.trim()) {
      alert("Please enter a message");
      return;
    }

    setSending(true);
    try {
      const response = await api.post(`/api/customer/group-stays/${bookingId}/message`, {
        messageType,
        message: message.trim(),
      });

      if (response.data.success) {
        setSent(true);
        setMessage("");
        await loadMessages();
        setTimeout(() => {
          setIsOpen(false);
          setSent(false);
        }, 2000);
        
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "success", title: "Message Sent", message: "Your message has been sent to the admin.", duration: 3000 },
          })
        );
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to send message";
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { type: "error", title: "Error", message: msg, duration: 4000 },
        })
      );
    } finally {
      setSending(false);
    }
  };

  // Show loading state while fetching messages
  if (messagesLoading && conversationMessages.length === 0) {
    return (
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-200 bg-white">
        <LogoSpinner size="xs" ariaLabel="Loading messages" />
      </span>
    );
  }

  // Show conversation history if messages exist, or just the button if no messages
  if (!isOpen && conversationMessages.length === 0) {
    return (
      <div>
        <button
          onClick={() => {
            setIsOpen(true);
            setMessage(getMessageTemplate(messageType));
          }}
          className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-solid border-emerald-200 bg-emerald-50 px-3.5 text-[12.5px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
        >
          <MessageSquare className="h-4 w-4" />
          Message NoLSAF
        </button>
      </div>
    );
  }

  if (!isOpen && conversationMessages.length > 0) {
    return (
      <div className="relative">
        {/* Compact notification-style icon — tap to reveal the conversation */}
        <button
          type="button"
          aria-label="Conversation history"
          aria-expanded={isExpanded}
          title={`Conversation history (${conversationMessages.length} message${conversationMessages.length !== 1 ? 's' : ''})`}
          onClick={() => setIsExpanded((v) => !v)}
          className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-[#059669] shadow-sm transition-colors hover:bg-slate-50"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#059669] px-1 text-[10px] font-bold text-white">
            {conversationMessages.length}
          </span>
        </button>

        {/* Chat panel: floats above the ticket, anchored to the icon, so the row never stretches */}
        <div className={`absolute right-0 top-full z-30 mt-2 w-[min(380px,calc(100vw-2.5rem))] ${isExpanded ? 'block' : 'hidden'}`}>
          <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.35)]">
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#0a2e19] to-[#059669]">
              <p className="text-xs font-semibold text-white leading-none">Conversation History</p>
              <span
                onClick={() => {
                  setIsOpen(true);
                  setMessage(getMessageTemplate(messageType));
                }}
                className="flex items-center gap-1.5 rounded-full bg-white/20 hover:bg-white/30 px-3 py-1.5 text-[11px] font-semibold text-white transition-all cursor-pointer"
              >
                <MessageSquare className="h-3 w-3" />
                Reply
              </span>
            </div>
          <div className="bg-slate-50/60 px-4 py-4 space-y-4 max-h-[380px] overflow-y-auto">
            {conversationMessages.map((msg) => {
              const isUser = msg.senderRole === 'USER';
              const decoded = decodeHtmlEntities(msg.message);
              return (
                <div key={msg.id} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar */}
                  <div className={`h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold shadow-sm ${
                    isUser
                      ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white'
                      : 'bg-gradient-to-br from-slate-700 to-slate-900 text-white'
                  }`}>
                    {isUser ? 'Me' : msg.senderRole === 'SYSTEM' ? 'N' : 'A'}
                  </div>

                  {/* Bubble + meta */}
                  <div className={`flex flex-col max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
                    {/* Sender + time row */}
                    <div className={`flex items-center gap-1.5 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                      <span className="text-[11px] font-semibold text-slate-700">
                        {isUser ? 'You' : msg.senderRole === 'SYSTEM' ? 'NoLSAF' : 'Admin'}
                      </span>
                      <span className="text-[10px] text-slate-400">{msg.formattedDate}</span>
                      {isUser && (
                        <span className="text-[9px] font-medium text-emerald-600 bg-emerald-50 border border-solid border-emerald-100 rounded px-1.5 py-px">
                          {msg.messageType}
                        </span>
                      )}
                    </div>

                    {/* Bubble */}
                    <div className={`relative rounded-2xl px-3.5 py-2.5 shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-tr-sm'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                    }`}>
                      {decoded}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>{/* end animation wrapper */}
        </div>
      </div>
    );
  }

  // Message form (when isOpen is true): a pop-over anchored to the chat icon, like the history panel
  return (
    <div className="relative">
    <button
      type="button"
      aria-label="Close message form"
      aria-expanded
      onClick={() => setIsOpen(false)}
      className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-solid border-[#059669] bg-[#059669] text-white shadow-sm"
    >
      <MessageSquare className="h-4 w-4" />
    </button>
    <div className="absolute right-0 top-full z-30 mt-2 w-[min(400px,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.35)]">
      {/* Form header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#0a2e19] to-[#059669]">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center">
            <MessageSquare className="h-3.5 w-3.5 text-white" />
          </div>
          <p className="text-xs font-semibold text-white">Contact Admin</p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="h-7 w-7 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white/80 hover:text-white transition-all"
          aria-label="Close"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>

      <div className="bg-white px-4 py-4">
        {sent ? (
          <div className="flex items-center gap-2.5 text-sm text-emerald-700 bg-emerald-50 border border-solid border-emerald-200 rounded-xl p-3.5">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">Message sent successfully!</span>
          </div>
        ) : (
          <>
            {/* Message Type Dropdown */}
            <div className="mb-3">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Message Type
              </label>
              <div className="relative">
                <select
                  value={messageType}
                  onChange={(e) => handleMessageTypeChange(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-solid border-slate-200 bg-slate-50 px-3 py-2.5 pr-9 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all"
                >
                  {messageTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Message Textarea */}
            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Your Message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                rows={4}
                className="w-full rounded-xl border border-solid border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all resize-none"
              />
              {(message.includes("[") && message.includes("]")) && (
                <p className="mt-2 text-xs text-amber-700 font-medium flex items-center gap-1.5 bg-amber-50 border border-solid border-amber-100 rounded-lg px-2.5 py-2">
                  <span>⚠️</span>
                  <span>Replace the text in <span className="font-bold bg-amber-100 px-1 rounded">[brackets]</span> with your specific information.</span>
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={handleSend}
                disabled={sending || !message.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0a2e19] to-[#059669] text-white font-semibold px-4 py-2.5 text-sm hover:opacity-90 hover:shadow-md active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-solid border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send Message
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setMessage("");
                  setMessageType("Ask for Feedback");
                }}
                className="px-4 py-2.5 rounded-xl border border-solid border-slate-200 bg-slate-50 text-slate-600 font-medium text-sm hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
