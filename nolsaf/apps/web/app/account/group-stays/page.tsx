"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { Users, Calendar, CheckCircle, XCircle, User, Phone, Globe, ArrowRight, Building2, Clock, ChevronDown, MessageSquare, DollarSign, Tag, FileText, Sparkles, Gift, Send, MapPin, ImageIcon } from "lucide-react";
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

function GroupStayCardSkeleton({ variant: _variant }: { variant: "active" | "expired" }) {
  return (
    <div className="relative overflow-hidden bg-white rounded-3xl border border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)] p-5 sm:p-6">
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
            <div key={i} className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2">
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
  const [filter, setFilter] = useState<"pending" | "reviewed" | "active" | "completed" | "expired">("active");
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
      setGroupStays(response.data.items || []);
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

  const filteredGroupStays = groupStays.filter((stay) => {
    if (filter === "pending") return stay.status === "PENDING" || stay.status === "REVIEWING";
    if (filter === "reviewed") return stay.status === "PROCESSING";
    if (filter === "active") {
      return (
        stay.isValid &&
        stay.status !== "PENDING" &&
        stay.status !== "REVIEWING" &&
        stay.status !== "PROCESSING"
      );
    }
    if (filter === "completed") return !stay.isValid && stay.status === "COMPLETED";
    if (filter === "expired") return !stay.isValid && stay.status !== "COMPLETED" && stay.status !== "CANCELED";
    return false;
  });

  const pendingCount = groupStays.filter((s) => s.status === "PENDING" || s.status === "REVIEWING").length;
  const pendingOnlyCount = groupStays.filter((s) => s.status === "PENDING").length;
  const reviewingOnlyCount = groupStays.filter((s) => s.status === "REVIEWING").length;
  const reviewedCount = groupStays.filter((s) => s.status === "PROCESSING").length;
  const activeCount = groupStays.filter(
    (s) =>
      s.isValid &&
      s.status !== "PENDING" &&
      s.status !== "REVIEWING" &&
      s.status !== "PROCESSING"
  ).length;
  const completedCount = groupStays.filter((s) => !s.isValid && s.status === "COMPLETED").length;
  const expiredCount = groupStays.filter((s) => !s.isValid && s.status !== "COMPLETED" && s.status !== "CANCELED").length;

  const displayGroupStays =
    filter === "pending"
      ? [...filteredGroupStays].sort((a, b) => {
          const rank = (s: GroupStay) => (s.status === "REVIEWING" ? 0 : 1);
          const byStatus = rank(a) - rank(b);
          if (byStatus !== 0) return byStatus;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
      : filteredGroupStays;

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
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div
          className="relative overflow-hidden rounded-3xl p-8 sm:p-10 animate-pulse"
          style={{ background: "linear-gradient(135deg, #091e2e 0%, #0e3f5e 42%, #02665e 100%)" }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-white/10" />
            <div className="h-8 w-48 rounded-full bg-white/10" />
            <div className="h-4 w-64 rounded-full bg-white/10" />
            <div className="flex gap-3 mt-1">
              {[80, 96, 80, 80].map((w, i) => (
                <div key={i} className="h-7 rounded-full bg-white/10" style={{ width: w }} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-center">
          <div className="inline-flex gap-2 rounded-2xl bg-slate-100 p-1.5 border border-slate-200">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 w-24 rounded-xl bg-white animate-pulse" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <GroupStayCardSkeleton variant="active" />
          <GroupStayCardSkeleton variant="expired" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "mx-auto w-full max-w-5xl space-y-6 transition-all duration-300 ease-out",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      ].join(" ")}
    >
      {/* ══════════════ PREMIUM HEADER ══════════════ */}
      <div
        className="relative overflow-hidden rounded-3xl shadow-[0_4px_40px_rgba(2,60,80,0.38)]"
        style={{ background: "linear-gradient(135deg, #091e2e 0%, #0e3f5e 42%, #02665e 100%)" }}
      >
        {/* ── Radial glow layers (blue + teal) ── */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0" style={{
            background: "radial-gradient(600px circle at 15% 20%, rgba(56,189,248,0.18), transparent 55%), radial-gradient(500px circle at 90% 75%, rgba(2,102,94,0.38), transparent 60%)"
          }} />
        </div>

        {/* ── SVG Graph Visualization Background ── */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 800 220"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="gsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(56,189,248,0.18)" />
                <stop offset="100%" stopColor="rgba(56,189,248,0)" />
              </linearGradient>
              <linearGradient id="gsAreaGrad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(2,180,160,0.16)" />
                <stop offset="100%" stopColor="rgba(2,180,160,0)" />
              </linearGradient>
            </defs>

            {/* Bar chart columns (background layer) */}
            {[
              { x: 30,  h: 60,  c: "rgba(56,189,248,0.10)" },
              { x: 80,  h: 90,  c: "rgba(56,189,248,0.13)" },
              { x: 130, h: 50,  c: "rgba(2,180,160,0.10)" },
              { x: 180, h: 110, c: "rgba(56,189,248,0.14)" },
              { x: 230, h: 75,  c: "rgba(2,180,160,0.11)" },
              { x: 280, h: 130, c: "rgba(56,189,248,0.15)" },
              { x: 330, h: 85,  c: "rgba(2,180,160,0.12)" },
              { x: 380, h: 145, c: "rgba(56,189,248,0.16)" },
              { x: 430, h: 95,  c: "rgba(2,180,160,0.11)" },
              { x: 480, h: 120, c: "rgba(56,189,248,0.13)" },
              { x: 530, h: 70,  c: "rgba(2,180,160,0.10)" },
              { x: 580, h: 105, c: "rgba(56,189,248,0.14)" },
              { x: 630, h: 155, c: "rgba(2,180,160,0.14)" },
              { x: 680, h: 90,  c: "rgba(56,189,248,0.12)" },
              { x: 730, h: 125, c: "rgba(2,180,160,0.13)" },
              { x: 780, h: 60,  c: "rgba(56,189,248,0.10)" },
            ].map((b, i) => (
              <rect key={i} x={b.x - 16} y={220 - b.h} width={32} height={b.h} rx={4} fill={b.c} />
            ))}

            {/* Area fill under line 1 (sky-blue) */}
            <path
              d="M0,160 C60,140 120,110 180,95 C240,80 300,105 360,70 C420,35 480,60 540,45 C600,30 660,55 720,40 C760,30 800,35 800,35 L800,220 L0,220 Z"
              fill="url(#gsAreaGrad)"
            />
            {/* Line 1 */}
            <path
              d="M0,160 C60,140 120,110 180,95 C240,80 300,105 360,70 C420,35 480,60 540,45 C600,30 660,55 720,40 C760,30 800,35 800,35"
              fill="none"
              stroke="rgba(56,189,248,0.45)"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* Area fill under line 2 (teal) */}
            <path
              d="M0,185 C80,175 160,165 240,150 C320,135 400,155 480,130 C560,105 640,120 720,100 C760,90 800,95 800,95 L800,220 L0,220 Z"
              fill="url(#gsAreaGrad2)"
            />
            {/* Line 2 */}
            <path
              d="M0,185 C80,175 160,165 240,150 C320,135 400,155 480,130 C560,105 640,120 720,100 C760,90 800,95 800,95"
              fill="none"
              stroke="rgba(2,180,160,0.38)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="6 3"
            />

            {/* Data point dots on line 1 */}
            {[
              [180, 95], [360, 70], [540, 45], [720, 40],
            ].map(([cx, cy], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r={4} fill="rgba(56,189,248,0.5)" />
                <circle cx={cx} cy={cy} r={7} fill="rgba(56,189,248,0.12)" />
              </g>
            ))}

            {/* Horizontal grid lines */}
            {[55, 110, 165].map((y, i) => (
              <line key={i} x1="0" y1={y} x2="800" y2={y}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            ))}
          </svg>
        </div>

        <div className="relative px-6 py-10 sm:px-10 sm:py-12">
          <div className="flex flex-col items-center text-center gap-4">
            {/* Icon with glow */}
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl blur-md scale-110"
                style={{ background: "rgba(56,189,248,0.22)" }} />
              <div className="relative h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg"
                style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.18) 0%, rgba(2,102,94,0.22) 100%)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <Users className="h-8 w-8 text-white drop-shadow-md" />
              </div>
            </div>

            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow">
                My Group Stay
              </h1>
              <p className="mt-1.5 text-sm sm:text-base text-sky-200/70 font-medium">
                View all your group booking arrangements
              </p>
            </div>

            {/* Stats chips */}
            <div className="flex flex-wrap justify-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.28)", color: "#7dd3fc" }}>
                <Users className="h-3.5 w-3.5" />
                {groupStays.length} Total
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                style={{ background: "rgba(2,180,160,0.14)", border: "1px solid rgba(2,180,160,0.30)", color: "#5eead4" }}>
                <CheckCircle className="h-3.5 w-3.5" />
                {activeCount} Active
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.28)", color: "#fde68a" }}>
                <Clock className="h-3.5 w-3.5" />
                {pendingCount} Pending
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════ FILTER TABS ══════════════ */}
      <div className="flex justify-center">
        <div className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100/80 border border-slate-200 p-1.5 shadow-sm flex-wrap">
          {[
            { key: "pending" as const, label: "Pending", count: pendingCount },
            { key: "reviewed" as const, label: "Reviewed", count: reviewedCount },
            { key: "active" as const, label: "Active", count: activeCount },
            { key: "completed" as const, label: "Completed", count: completedCount },
            { key: "expired" as const, label: "Expired", count: expiredCount },
          ].map((t) => {
            const active = filter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(t.key)}
                className={[
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30 focus-visible:ring-offset-1",
                  active
                    ? "text-white shadow-md"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300",
                ].join(" ")}
                style={active ? { background: "linear-gradient(135deg, #0a2e19 0%, #059669 100%)", border: "none" } : {}}
              >
                <span>{t.label}</span>
                <span
                  className={[
                    "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold",
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600",
                  ].join(" ")}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredGroupStays.length === 0 ? (
        <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-12 text-center shadow-[0_2px_20px_rgba(0,0,0,0.05)]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{ background: "radial-gradient(circle at 50% 0%, #059669, transparent 60%)" }} />
          <div className="relative">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl shadow-md"
            style={{ background: "linear-gradient(135deg, #0a2e19 0%, #059669 100%)" }}>
            <Users className="h-8 w-8 text-white" />
          </div>
          <div className="mt-5 text-xl font-bold text-slate-900">No group stays found</div>
          <div className="mt-2 text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
            {filter === "pending"
              ? "You don't have any group stays waiting for review at the moment."
              : filter === "reviewed"
              ? "You don't have any reviewed group stays at the moment."
              : filter === "active"
              ? "You don't have any active group stays at the moment."
              : filter === "completed"
              ? "You haven't completed any group stays yet."
              : filter === "expired"
              ? "You don't have any expired group stays."
              : "No group stays found."}
          </div>
          {filter === "active" && (
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
        <div className="space-y-4">
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
              <div key={`${stay.id}-${section}`} className="space-y-2">
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
                  <div className="relative overflow-hidden bg-white rounded-3xl border border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)] transition-all duration-200 hover:shadow-[0_6px_32px_rgba(5,150,105,0.12)] hover:-translate-y-[2px]">
              <div className="flex flex-col gap-4 pl-5 pr-5 pt-5 pb-5 sm:pl-6 sm:pr-6 sm:pt-6 sm:pb-5">
                <div className="min-w-0 flex-1">
                  {/* Header with property title and status */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
                        style={{ background: stay.status === "PENDING" ? "linear-gradient(135deg, #fef9c3, #fef08a)" : "linear-gradient(135deg, #d1fae5, #a7f3d0)" }}>
                        <Users className={`h-5 w-5 ${stay.status === "PENDING" ? "text-amber-600" : "text-emerald-700"}`} />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">
                          {stay.arrangement.property.title}
                        </h3>
                        <div className="mt-1 text-sm text-slate-600">
                          {stay.arrangement.property.type}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${getStatusColor(stay)}`}
                    >
                      {stay.status === "PENDING" || stay.status === "REVIEWING" ? (
                        <Clock className="h-4 w-4" />
                      ) : stay.status === "PROCESSING" ? (
                        <Clock className="h-4 w-4" />
                      ) : stay.isValid ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Calendar className="h-4 w-4" />
                      )}
                      {getStatusLabel(stay)}
                    </span>
                  </div>

                  {/* Location */}
                  {stay.arrangement.property.regionName && (
                    <div className="mt-2 text-sm text-slate-600">
                      {[
                        stay.arrangement.property.regionName,
                        stay.arrangement.property.city,
                        stay.arrangement.property.district,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  )}

                  {/* Booking Information Grid */}
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    {/* Check-in */}
                    <div className="rounded-2xl bg-emerald-50/60 border border-emerald-100 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 mb-0.5">
                        <Calendar className="h-3 w-3" />
                        Check-in
                      </div>
                      <div className="font-bold text-slate-800 text-sm">{formatDate(stay.checkIn)}</div>
                    </div>

                    {/* Check-out */}
                    <div className="rounded-2xl bg-indigo-50/60 border border-indigo-100 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-500 mb-0.5">
                        <Calendar className="h-3 w-3" />
                        Check-out
                      </div>
                      <div className="font-bold text-slate-800 text-sm">{formatDate(stay.checkOut)}</div>
                    </div>

                    {/* Number of Guests */}
                    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">
                        <Users className="h-3 w-3" />
                        Guests
                      </div>
                      <div className="font-bold text-slate-800 text-sm">{stay.numberOfGuests} {stay.numberOfGuests === 1 ? "guest" : "guests"}</div>
                    </div>

                    {/* Total Amount */}
                    <div className="rounded-2xl bg-amber-50/60 border border-amber-100 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-500 mb-0.5">
                        <Building2 className="h-3 w-3" />
                        Total Amount
                      </div>
                      <div className="font-bold text-slate-800 text-sm">{Number(stay.totalAmount).toLocaleString("en-US")} TZS</div>
                    </div>
                  </div>

                  {/* Admin Messages & Recommendations */}
                  {stay.adminSuggestions && (stay.status !== "PENDING" && stay.status !== "REVIEWING") && (
                    <div className="mt-4 sm:mt-5 rounded-2xl border border-gray-200 bg-white shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden">
                      <div className="p-4 sm:p-5 lg:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-5 sm:mb-6 pb-4 border-b border-gray-200">
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
                              <div className="bg-white rounded-2xl border-l-4 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden" style={{ borderLeftColor: '#02665e' }}>
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
                                            <div key={idx} className="mt-4 pt-4 border-t-2 border-gray-200">
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
                                            <div key={idx} className="mt-3 p-3 sm:p-4 bg-gray-50 rounded-lg border-2 border-gray-200">
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
                                            <div key={idx} className="mt-3 p-3 sm:p-4 bg-gray-100 rounded-lg border-2 border-gray-300 shadow-sm">
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
                            <div className="bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="border-b-2 px-4 sm:px-5 py-3.5 bg-gray-50" style={{ borderBottomColor: '#02665e' }}>
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-xl border-2 bg-white flex items-center justify-center" style={{ borderColor: '#02665e' }}>
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
                            <div className="bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="p-4 sm:p-5">
                                <div className="flex items-start gap-4 mb-4">
                                  <div className="h-14 w-14 rounded-2xl border-2 bg-gray-50 flex items-center justify-center flex-shrink-0" style={{ borderColor: '#02665e' }}>
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
                            <div className="bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
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
                            <div className="bg-gray-50 rounded-2xl border-2 border-gray-300 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                              <div className="p-4 sm:p-5">
                                <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-300">
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
                        <div className="mt-4 sm:mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-white border border-rose-200">
                              <Clock className="h-5 w-5 text-rose-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-base font-bold text-rose-900">Deposit window expired</h4>
                              <p className="text-xs sm:text-sm text-rose-700/90 mt-1">
                                The {fmtMoney(depositAmount)} deposit wasn&apos;t paid in time, so this offer has lapsed. Request a new group stay offer to continue.
                              </p>
                              {dep?.dueAt && (
                                <p className="text-[11px] text-rose-500/80 mt-1">Expired {new Date(dep.dueAt).toLocaleString()}</p>
                              )}
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
                      <div className="mt-4 sm:mt-5 rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-white border border-amber-200">
                                <DollarSign className="h-5 w-5 text-amber-600" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-base font-bold text-slate-900">Deposit due to confirm</h4>
                                <p className="text-xs text-slate-600 mt-0.5">
                                  Pay the deposit to lock your rooms. The stay balance is settled on check-in.
                                </p>
                                {dueLabel && dueDateLabel && (
                                  <div className={`mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${urgent ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-white/70 text-amber-800'}`}>
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
                              <div className="rounded-xl border border-amber-200/70 bg-white px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                                  Deposit to secure
                                </div>
                                <div className="text-sm font-bold text-amber-700 tabular-nums">{fmtMoney(depositAmount)}</div>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-slate-400">Total</div>
                                <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(total)}</div>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
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
                    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:mt-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
                          <CheckCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-emerald-900">Deposit payment confirmed</div>
                          <div className="mt-0.5 text-xs text-emerald-700">Your receipt remains available with this booking.</div>
                        </div>
                      </div>
                      <Link href={`/account/group-stays/${encodeURIComponent(stay.groupStayReference)}/receipt`} className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-[#02665e] no-underline shadow-sm hover:bg-emerald-50">
                        View receipt
                      </Link>
                    </div>
                  )}

                  {/* Auction Offers (separate from normal recommendations) */}
                  {((stay.auction?.recommendedPropertyCount || 0) > 0) && !stay.auction?.confirmedPropertyId && (
                    <div className="relative mt-4 overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-white to-white shadow-[0_10px_30px_rgba(15,23,42,0.06)] animate-in fade-in slide-in-from-bottom-2 duration-500 sm:mt-5">
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
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-3 text-sm text-slate-700">
                                <LogoSpinner size="xs" ariaLabel="Loading offers" />
                                Loading offers...
                              </div>
                            )}

                            {!auctionLoading.has(stay.id) && (auctionOffersByBooking[stay.id] || []).length === 0 && (
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
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
                                <div key={offer.claimId} className="group flex h-full w-[92%] flex-none snap-start flex-col rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:w-[78%] md:w-auto md:min-w-0">
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
                                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
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
                                              <span key={`${offer.claimId}-${index}`} className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
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

                  {/* Passengers + Conversation — compact icons on one row */}
                  <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                  {stay.passengers && stay.passengers.length > 0 && (
                    <div className="relative">
                      {/* Compact notification-style icon — tap to reveal passengers */}
                      <button
                        type="button"
                        aria-label={`Passengers (${stay.passengers.length})`}
                        aria-expanded={expandedPassengers.has(stay.id)}
                        title={`Passengers (${stay.passengers.length})`}
                        onClick={() => {
                          const newExpanded = new Set(expandedPassengers);
                          if (newExpanded.has(stay.id)) {
                            newExpanded.delete(stay.id);
                          } else {
                            newExpanded.add(stay.id);
                          }
                          setExpandedPassengers(newExpanded);
                        }}
                        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-[#02665e] shadow-sm transition-colors hover:bg-slate-50"
                      >
                        <Users className="h-5 w-5" />
                        <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#02665e] px-1 text-[10px] font-bold text-white">
                          {stay.passengers.length}
                        </span>
                      </button>
                      <div
                        className={`mt-2 w-[340px] max-w-full rounded-xl border border-slate-200 bg-white shadow-sm ${
                          expandedPassengers.has(stay.id) ? 'block' : 'hidden'
                        }`}
                      >
                        <div className="p-3">
                          <div className="grid grid-cols-2 gap-2">
                        {stay.passengers.map((passenger) => (
                          <div
                            key={passenger.id}
                                className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 flex items-start gap-2.5 transition-shadow duration-200 hover:shadow-sm"
                          >
                            <div className="h-8 w-8 rounded-full bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                                  <User className="h-3.5 w-3.5 text-[#02665e]" />
                            </div>
                            <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium text-slate-900">
                                {passenger.name}
                              </div>
                                  <div className="flex flex-col gap-1 mt-1">
                                {passenger.nationality && (
                                  <div className="flex items-center gap-1 text-xs text-slate-600">
                                    <Globe className="h-3 w-3" />
                                    {passenger.nationality}
                                  </div>
                                )}
                                {passenger.phone && (
                                  <div className="flex items-center gap-1 text-xs text-slate-600">
                                    <Phone className="h-3 w-3" />
                                    {passenger.phone}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Contact Admin - Messaging Component */}
                  <div className="ml-auto min-w-0">
                    <GroupStayMessaging bookingId={stay.id} />
                  </div>
                  </div>
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
      <div className="mt-4 flex items-center justify-center p-4">
        <LogoSpinner size="sm" ariaLabel="Loading messages" />
      </div>
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
          className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold px-4 py-2.5 text-sm hover:bg-emerald-100 transition-all duration-200 active:scale-[0.98] whitespace-nowrap"
        >
          <MessageSquare className="h-4 w-4" />
          Contact Admin
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
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-[#059669] shadow-sm transition-colors hover:bg-slate-50"
        >
          <MessageSquare className="h-5 w-5" />
          <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#059669] px-1 text-[10px] font-bold text-white">
            {conversationMessages.length}
          </span>
        </button>

        {/* Chat panel — expands in flow when the icon is tapped */}
        <div className={`mt-2 w-[360px] max-w-full ${isExpanded ? 'block' : 'hidden'}`}>
          <div className="overflow-hidden rounded-2xl border border-slate-100 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
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
                        <span className="text-[9px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-px">
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

  // Message form (when isOpen is true)
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
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
          <div className="flex items-center gap-2.5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
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
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 pr-9 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-all resize-none"
              />
              {(message.includes("[") && message.includes("]")) && (
                <p className="mt-2 text-xs text-amber-700 font-medium flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
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
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 font-medium text-sm hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
