"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  Building2,
  DollarSign,
  ShieldCheck,
  Bell,
  Copy,
  History,
  Activity,
  Clock,
  RefreshCw,
  Ban,
  CheckCircle2,
  Eye,
  Check,
  X,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  MapPin,
  Package,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import TableRow from "@/components/TableRow";

const api = apiClient;

const REQUIRED_OPERATOR_DOC_TYPES = [
  "VEHICLE_PERMIT",
  "BRELA_CERTIFICATE",
  "TIN_NUMBER",
  "BUSINESS_LICENCE",
  "TOURISM_LICENSE",
  "NDA",
] as const;

const DOC_TYPE_ALIASES: Record<string, string> = {
  BUSINESS_LICENSE: "BUSINESS_LICENCE",
  BUSINESS_LISENCE: "BUSINESS_LICENCE",
  TOURISM_LICENCE: "TOURISM_LICENSE",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  VEHICLE_PERMIT: "Vehicle Permit",
  BRELA_CERTIFICATE: "BRELA Certificate",
  TIN_NUMBER: "TIN Number",
  BUSINESS_LICENCE: "Business Licence",
  TOURISM_LICENSE: "Tourism License",
  NDA: "NDA",
};

function unwrapApiData<T = any>(axiosData: any): T {
  return axiosData && typeof axiosData === "object" && "data" in axiosData ? (axiosData.data as T) : (axiosData as T);
}

function authify() {}

type Agent = {
  id: number;
  status: string;
  isAvailable: boolean;
  bio: string | null;
  areasOfOperation: string[];
  specializations: string[];
  operatorProfile?: {
    companyName?: string;
    physicalLocation?: string;
    operatingRegions?: string[];
    description?: string;
    tourismTypes?: string[];
    contactPhone?: string;
    contactEmail?: string;
  } | null;
  educationLevel: string | null;
  yearsOfExperience: number | null;
  level?: string;
  totalCompletedTrips?: number;
  totalRevenueGenerated?: number;
  financialSummary?: {
    paidCount: number;
    grossSum: number;
    commissionSum: number;
    netSum: number;
    commissionPercent: number;
    currency?: string;
  };
  suspendedAt?: string | null;
  createdAt: string;
  user: {
    id: number;
    name: string | null;
    fullName?: string | null;
    email: string | null;
    phone: string | null;
    region?: string | null;
    district?: string | null;
    avatarUrl?: string | null;
  };
  maxActiveRequests: number;
  currentActiveRequests: number;
  assignedPlanRequests?: Array<{ id: number; status: string }>;
};

type AgentDocument = {
  id: number;
  type: string | null;
  status: string;
  reason?: string | null;
  url?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type AgentAdminNote = {
  id: number;
  text: string;
  createdAt: string;
  adminId: number;
  admin?: {
    id: number;
    name?: string | null;
    fullName?: string | null;
    email?: string | null;
  };
};

type Booking = {
  id: number;
  guestName: string;
  property: string;
  checkIn: string;
  checkOut: string;
  amount: number;
  platformFee: number;
  operatorPayout: number;
  status: string;
  createdAt: string;
};

function fmtDate(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB");
}

function fmtTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtMoney(value?: number | null, currency: string = "USD") {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function initials(name: string | null | undefined) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] || "?";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + second).toUpperCase();
}

function kycLikeBadge(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE") return "bg-emerald-50 border border-emerald-200 text-emerald-700";
  if (s === "SUSPENDED") return "bg-red-50 border border-red-200 text-red-700";
  return "bg-amber-50 border border-amber-200 text-amber-800";
}

function accountStatusBadge(suspendedAt?: string | null) {
  return suspendedAt
    ? "bg-red-50 border border-red-200 text-red-700"
    : "bg-emerald-50 border border-emerald-200 text-emerald-700";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function slugifyProfile(name: string, agentId?: number | null) {
  const base = String(name || `agent-${agentId || "profile"}`)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "operator-profile"}${agentId ? `-${agentId}` : ""}`;
}

function SubmittedProfileCard({
  profile,
  reviewHref,
  reviewStatus,
  commissionPercent,
}: {
  profile: Record<string, any>;
  reviewHref: string;
  reviewStatus?: string;
  commissionPercent?: number | null;
}) {
  const [currentPhoto, setCurrentPhoto] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const companyName = String(profile.companyName || "Submitted tour profile");
  const classified = profile.classifiedPhotos && typeof profile.classifiedPhotos === "object" ? (profile.classifiedPhotos as Record<string, unknown>) : {};
  const photos = [...stringList(classified.attractions), ...stringList(classified.proof), ...stringList(classified.office), ...stringList(classified.vehicles)].slice(0, 6);
  const services = [...stringList(profile.services), ...stringList(profile.addOns), ...stringList(profile.tourismTypes)].filter((item, index, arr) => item && arr.indexOf(item) === index);
  const packages = Array.isArray(profile.packageItems) ? profile.packageItems : [];
  const packagePrices = packages
    .map((pkg: any) => ({ currency: String(pkg?.currency || "USD"), basePrice: Number(pkg?.pricePerPerson || pkg?.price || 0) }))
    .filter((pkg) => Number.isFinite(pkg.basePrice) && pkg.basePrice > 0)
    .sort((a, b) => a.basePrice - b.basePrice);
  const lowestBase = packagePrices[0] || null;
  const profileCommission = Number(
    profile?.commissionPercent ??
    (profile?.services && typeof profile.services === "object" ? (profile.services as any).commissionPercent : undefined)
  );
  const localCommissionRaw = Number(
    (Number.isFinite(profileCommission) ? profileCommission : undefined) ?? commissionPercent ?? 0
  );
  const effectiveCommissionPercent = Number.isFinite(localCommissionRaw) && localCommissionRaw > 0 ? localCommissionRaw : 0;
  const lowest = lowestBase
    ? {
        currency: lowestBase.currency,
        price: Math.round(lowestBase.basePrice * (1 + effectiveCommissionPercent / 100)),
        basePrice: lowestBase.basePrice,
      }
    : null;
  const contactPhone = String(profile.contactPhone || "").trim();
  const location = String(profile.physicalLocation || profile.businessAddress || stringList(profile.operatingRegions)[0] || "Location not set");
  const localReviewState = String(
    reviewStatus || profile.reviewStatus || (profile.review && (profile.review as Record<string, unknown>).status) || ""
  ).toUpperCase();
  const isVerified = localReviewState === "APPROVED";

  const goToPhoto = (nextIndex: number) => {
    const el = trackRef.current;
    if (!el || photos.length === 0) return;
    const clamped = Math.max(0, Math.min(nextIndex, photos.length - 1));
    el.scrollTo({ left: clamped * el.offsetWidth, behavior: "smooth" });
    setCurrentPhoto(clamped);
  };

  const onPhotoScroll = () => {
    const el = trackRef.current;
    if (!el || el.offsetWidth <= 0) return;
    setCurrentPhoto(Math.round(el.scrollLeft / el.offsetWidth));
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Submitted card preview</div>
          <h3 className="mt-1 min-w-0 truncate text-xl font-black text-slate-950">{companyName}</h3>
        </div>
      </div>

      <div className="max-w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative mx-3 mt-3 overflow-hidden rounded-xl bg-slate-100">
          {photos.length === 0 ? (
            <div className="flex h-52 items-center justify-center bg-gradient-to-br from-[#02665e] via-emerald-600 to-teal-400">
              <Building2 className="h-16 w-16 text-white/30" />
            </div>
          ) : (
            <>
              <div
                ref={trackRef}
                onScroll={onPhotoScroll}
                className="flex h-52 snap-x snap-mandatory overflow-x-auto"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
              >
                {photos.map((url, index) => (
                  <div key={index} className="relative h-52 w-full flex-none snap-start bg-slate-200">
                    <Image src={url} alt={`${companyName} photo ${index + 1}`} fill sizes="420px" className="object-cover" unoptimized />
                  </div>
                ))}
              </div>

              {photos.length > 1 && currentPhoto > 0 ? (
                <button
                  type="button"
                  onClick={() => goToPhoto(currentPhoto - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/60"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
              ) : null}

              {photos.length > 1 && currentPhoto < photos.length - 1 ? (
                <button
                  type="button"
                  onClick={() => goToPhoto(currentPhoto + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/60"
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              ) : null}

              {photos.length > 1 ? (
                <div className="absolute bottom-2.5 left-0 right-0 flex justify-center gap-1">
                  {photos.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => goToPhoto(index)}
                      aria-label={`Photo ${index + 1}`}
                      className={`h-1.5 rounded-full transition-all duration-200 ${index === currentPhoto ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="px-4 pb-4 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
              <MapPin className="h-3 w-3 shrink-0 text-[#02665e]" aria-hidden />
              <span className="truncate">{location}</span>
            </div>
            {lowest ? (
              <div className="flex shrink-0 items-baseline gap-0.5">
                <span className="text-sm font-bold text-[#02665e]">{lowest.currency} {lowest.price.toLocaleString()}</span>
                <span className="text-[10px] text-slate-400">/ person</span>
              </div>
            ) : contactPhone ? (
              <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#02665e]">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {contactPhone}
              </div>
            ) : null}
          </div>

          <div className="my-3 h-px bg-slate-100" />

          {services.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {services.slice(0, 4).map((service) => (
                <span
                  key={service}
                  className="truncate rounded-md border border-[#02665e]/20 bg-[#02665e]/5 px-2.5 py-1 text-[11px] font-medium text-[#02665e]"
                >
                  {service}
                </span>
              ))}
              {services.length > 4 ? (
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                  +{services.length - 4} more
                </span>
              ) : null}
            </div>
          ) : null}

          {packages.length > 0 ? (
            <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400">
              <div className="flex min-w-0 items-center gap-1.5">
                <Package className="h-3 w-3 shrink-0 text-[#02665e]" aria-hidden />
                <span className="truncate">{packages.length} tour package{packages.length === 1 ? "" : "s"} available</span>
              </div>
              {isVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Verified
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="px-4 pb-4">
          <Link
            href={reviewHref}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#02665e] py-2.5 text-xs font-bold text-white no-underline transition hover:bg-[#024d47]"
          >
            View full profile
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AdminAgentDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const searchParams = useSearchParams();
  const idParam = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const agentId = Number(idParam);

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [notifyAgent, setNotifyAgent] = useState(true);
  const [showImpersonateForm, setShowImpersonateForm] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [notificationSubject, setNotificationSubject] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "documents" | "notes" | "bookings" | "profile">(
    searchParams.get("tab") === "profile" ? "profile" : "overview",
  );
  const [documents, setDocuments] = useState<AgentDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docActionLoadingId, setDocActionLoadingId] = useState<number | null>(null);
  const [notes, setNotes] = useState<AgentAdminNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatus, setBookingStatus] = useState("all");
  const [bookingPage, setBookingPage] = useState(1);
  const [bookingTotal, setBookingTotal] = useState(0);
  const [adminCommissionPercent, setAdminCommissionPercent] = useState<number | null>(null);
  const [tourCurrency, setTourCurrency] = useState<string>("USD");
  const [bookingSortBy, setBookingSortBy] = useState("createdAt");
  const [bookingSortDir, setBookingSortDir] = useState<"asc" | "desc">("desc");
  const pageSize = 25;

  const load = useCallback(async () => {
    if (!Number.isFinite(agentId) || agentId <= 0) {
      setError("Invalid tour operator id");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      authify();
      const r = await api.get<Agent>(`/api/admin/agents/${agentId}`);
      setAgent(unwrapApiData<Agent>(r.data));
      const settingsResp = await api.get("/api/admin/settings");
      const settingsData = unwrapApiData<any>(settingsResp.data);
      const settingsPct = Number(settingsData?.agentCommissionPercent ?? settingsData?.commissionPercent);
      setAdminCommissionPercent(Number.isFinite(settingsPct) ? settingsPct : null);
      const settingsCurrency = String(settingsData?.agentCommissionCurrency || "").trim().toUpperCase();
      if (settingsCurrency) setTourCurrency(settingsCurrency);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to load tour operator details");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadAuditHistory = useCallback(async (targetUserId: number) => {
    try {
      setAuditLoading(true);
      const r = await api.get<any>(`/api/admin/audits?targetId=${targetUserId}`);
      const raw: any = r.data;
      const next =
        Array.isArray(raw)
          ? raw
          : (
              (Array.isArray(raw?.items) && raw.items) ||
              (Array.isArray(raw?.data) && raw.data) ||
              (Array.isArray(raw?.data?.items) && raw.data.items) ||
              []
            );
      setAuditHistory(next);
    } catch {
      setAuditHistory([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (agent?.user?.id) {
      void loadAuditHistory(agent.user.id);
    }
  }, [agent?.user?.id, loadAuditHistory]);

  const loadDocuments = useCallback(async (targetAgentId: number) => {
    try {
      setDocsLoading(true);
      setDocsError(null);
      authify();
      const resp = await api.get(`/api/admin/agents/${targetAgentId}/documents`);
      const payload = unwrapApiData<{ documents: AgentDocument[] }>(resp.data);
      const docs = Array.isArray(payload?.documents) ? payload.documents : [];
      setDocuments(docs);
    } catch (err: any) {
      setDocuments([]);
      setDocsError(err?.response?.data?.error || err?.message || "Failed to load documents");
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "documents" && agent?.id) {
      void loadDocuments(agent.id);
    }
  }, [tab, agent?.id, loadDocuments]);

  const loadNotes = useCallback(async (targetAgentId: number) => {
    try {
      setNotesLoading(true);
      setNotesError(null);
      authify();
      const resp = await api.get(`/api/admin/agents/${targetAgentId}/notes`);
      const payload = unwrapApiData<{ notes: AgentAdminNote[] }>(resp.data);
      setNotes(Array.isArray(payload?.notes) ? payload.notes : []);
    } catch (err: any) {
      setNotes([]);
      setNotesError(err?.response?.data?.error || err?.message || "Failed to load admin notes");
    } finally {
      setNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "notes" && agent?.id) {
      void loadNotes(agent.id);
    }
  }, [tab, agent?.id, loadNotes]);

  async function addNote() {
    if (!agent?.id) return;
    const text = noteText.trim();
    if (!text) return;
    try {
      setSavingNote(true);
      authify();
      await api.post(`/api/admin/agents/${agent.id}/notes`, { text });
      setNoteText("");
      await loadNotes(agent.id);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || "Failed to save note");
    } finally {
      setSavingNote(false);
    }
  }

  const loadBookings = useCallback(async (targetAgentId: number) => {
    try {
      setBookingsLoading(true);
      setBookingsError(null);
      authify();
      const queryParams: any = {
        page: String(bookingPage),
        pageSize: String(pageSize),
      };
      if (bookingStatus && bookingStatus !== "all") {
        queryParams.status = bookingStatus;
      }
      if (bookingSearch) {
        queryParams.search = bookingSearch;
      }
      const params = new URLSearchParams(queryParams);
      const resp = await api.get(`/api/admin/agents/${targetAgentId}/bookings?${params}`);
      const payload = unwrapApiData<{ bookings: Booking[]; total: number }>(resp.data);
      setBookings(Array.isArray(payload?.bookings) ? payload.bookings : []);
      setBookingTotal(payload?.total || 0);
    } catch (err: any) {
      setBookings([]);
      setBookingsError(err?.response?.data?.error || err?.message || "Failed to load bookings");
    } finally {
      setBookingsLoading(false);
    }
  }, [bookingPage, bookingSearch, bookingStatus]);

  useEffect(() => {
    if (tab === "bookings" && agent?.id) {
      void loadBookings(agent.id);
    }
  }, [tab, agent?.id, loadBookings]);

  const getStatusGradient = (status: string) => {
    const gradients: Record<string, string> = {
      all: "bg-gradient-to-r from-blue-500 to-blue-600",
      new: "bg-gradient-to-r from-sky-500 to-blue-600",
      in_progress: "bg-gradient-to-r from-cyan-500 to-blue-600",
      completed: "bg-gradient-to-r from-emerald-500 to-teal-600",
      cancelled: "bg-gradient-to-r from-red-500 to-rose-600",
    };
    return gradients[status] || "bg-gradient-to-r from-gray-500 to-gray-600";
  };

  const sortedBookings = useMemo(() => {
    const rows = [...bookings];
    const read = (b: Booking) => {
      switch (bookingSortBy) {
        case "id":
          return Number(b.id || 0);
        case "guest":
          return String(b.guestName || "").toLowerCase();
        case "property":
          return String(b.property || "").toLowerCase();
        case "checkIn":
          return new Date(b.checkIn || "").getTime() || 0;
        case "checkOut":
          return new Date(b.checkOut || "").getTime() || 0;
        case "amount":
          return Number(b.amount || 0);
        case "operatorPayout":
          return Number(b.operatorPayout || 0);
        case "platformFee":
          return Number(b.platformFee || 0);
        case "status":
          return String(b.status || "").toLowerCase();
        case "createdAt":
        default:
          return new Date(b.createdAt || "").getTime() || 0;
      }
    };

    rows.sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (typeof av === "number" && typeof bv === "number") {
        return bookingSortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return bookingSortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [bookings, bookingSortBy, bookingSortDir]);

  const handleBookingSortClick = (field: string) => {
    if (bookingSortBy === field) {
      setBookingSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setBookingSortBy(field);
    setBookingSortDir(field === "id" ? "desc" : "asc");
  };

  const renderBookingSortIcon = (field: string) => {
    if (bookingSortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return bookingSortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-blue-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-blue-600" />;
  };

  async function approveDocument(docId: number) {
    if (!agent?.id) return;
    try {
      setDocActionLoadingId(docId);
      authify();
      const resp = await api.patch(`/api/admin/agents/${agent.id}/documents/${docId}`, {
        status: "APPROVED",
      });
      const payload = unwrapApiData<{ doc?: AgentDocument }>(resp.data);
      if (payload?.doc) {
        setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, ...payload.doc } : d)));
      }
      await loadDocuments(agent.id);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || "Failed to approve document");
    } finally {
      setDocActionLoadingId(null);
    }
  }

  async function suspendAgent() {
    if (!agent) return;
    if (!suspendReason.trim()) {
      alert("Please provide a reason for suspension.");
      return;
    }
    try {
      setActionLoading(true);
      authify();
      await api.post(`/api/admin/agents/${agent.id}/suspend`, { reason: suspendReason.trim() });
      setSuspendReason("");
      setShowSuspendForm(false);
      await load();
      if (notifyAgent && agent.user.email) {
        const subject = encodeURIComponent("Account suspension notice");
        const body = encodeURIComponent(`Hello ${agent.user.fullName || agent.user.name || "Tour Operator"},\n\nYour account has been suspended for the following reason:\n${suspendReason.trim()}\n\nPlease contact support for further guidance.`);
        window.open(`mailto:${agent.user.email}?subject=${subject}&body=${body}`, "_blank");
      }
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to suspend tour operator");
    } finally {
      setActionLoading(false);
    }
  }

  async function restoreAgent() {
    if (!agent) return;
    if (!window.confirm(`Restore ${agent.user.fullName || agent.user.name || "this tour operator"}?`)) return;
    try {
      setActionLoading(true);
      authify();
      await api.post(`/api/admin/agents/${agent.id}/restore`, { notes: "Restored by admin from detail page" });
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to restore tour operator");
    } finally {
      setActionLoading(false);
    }
  }

  function handleSuspendClick() {
    setShowSuspendForm(true);
    setSuspendReason("");
  }

  function cancelSuspend() {
    setShowSuspendForm(false);
    setSuspendReason("");
  }

  function handleNotificationToggle() {
    setShowNotificationForm((prev) => !prev);
  }

  function sendNotification() {
    if (!agent?.user.email) {
      alert("Tour operator email is not available");
      return;
    }
    if (!notificationSubject.trim() || !notificationMessage.trim()) {
      alert("Please provide both subject and message.");
      return;
    }

    const subject = encodeURIComponent(notificationSubject.trim());
    const body = encodeURIComponent(notificationMessage.trim());
    window.open(`mailto:${agent.user.email}?subject=${subject}&body=${body}`, "_blank");

    setNotificationSubject("");
    setNotificationMessage("");
    setShowNotificationForm(false);
  }

  function handleImpersonateClick() {
    setShowImpersonateForm(true);
    setImpersonateReason("");
  }

  function cancelImpersonate() {
    setShowImpersonateForm(false);
    setImpersonateReason("");
  }

  async function confirmImpersonate() {
    if (!agent) return;
    if (!impersonateReason.trim()) {
      alert("Please provide a reason for impersonation. This action will be logged.");
      return;
    }

    try {
      setActionLoading(true);
      authify();
      const r = await api.post<{ token: string; expiresIn: number }>(`/api/admin/agents/${agent.id}/impersonate`, {
        reason: impersonateReason.trim(),
      });
      const payload = unwrapApiData<{ token: string; expiresIn: number }>(r.data);
      if (!payload?.token) throw new Error("No token returned from impersonation endpoint");
      await navigator.clipboard.writeText(payload.token);
      setImpersonateReason("");
      setShowImpersonateForm(false);
      alert("Temporary AGENT token copied to clipboard (10 min). Use in a private tab for support.");
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to impersonate tour operator");
    } finally {
      setActionLoading(false);
    }
  }

  const submittedProfile = useMemo(() => {
    if (!agent?.operatorProfile || typeof agent.operatorProfile !== "object") return null;
    return agent.operatorProfile;
  }, [agent?.operatorProfile]);

  const companyName = submittedProfile?.companyName || agent?.user.fullName || agent?.user.name || "-";
  const profileEmail = submittedProfile?.contactEmail || agent?.user.email || "-";
  const profilePhone = submittedProfile?.contactPhone || agent?.user.phone || "-";
  const profileRegion =
    Array.isArray(submittedProfile?.operatingRegions) && submittedProfile.operatingRegions.length > 0
      ? submittedProfile.operatingRegions[0]
      : agent?.user.region || "-";
  const profileDistrict = agent?.user.district || "-";
  const physicalLocation =
    submittedProfile?.physicalLocation || [agent?.user.region, agent?.user.district].filter(Boolean).join(", ") || "-";
  const tourismTypes =
    Array.isArray(submittedProfile?.tourismTypes) && submittedProfile.tourismTypes.length > 0
      ? submittedProfile.tourismTypes.join(", ")
      : Array.isArray(agent?.specializations) && agent.specializations.length > 0
        ? agent.specializations.join(", ")
        : "-";
  const areaOfOperation =
    Array.isArray(submittedProfile?.operatingRegions) && submittedProfile.operatingRegions.length > 0
      ? submittedProfile.operatingRegions.join(", ")
      : Array.isArray(agent?.areasOfOperation) && agent.areasOfOperation.length > 0
        ? agent.areasOfOperation.join(", ")
        : "-";
  const profileDescription = submittedProfile?.description || agent?.bio || "-";
  const auditItems = Array.isArray(auditHistory) ? auditHistory : [];
  const formatAuditActionLabel = (value: unknown) => {
    const action = String(value || "").toUpperCase().trim();
    if (!action) return "Unknown Action";
    if (action.includes("SUSPEND")) return "Suspend Agent";
    if (action.includes("RESTORE") || action.includes("UNSUSPEND")) return "Unsuspend Agent";
    if (action.includes("IMPERSONATE")) return "Impersonate Agent";
    if (action.includes("NOTIFY") || action.includes("NOTIFICATION")) return "Send Notification";
    if (action.includes("APPROVE")) return "Approve Agent";
    if (action.includes("REJECT")) return "Reject Agent";
    return action
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  };
  const formatDocType = (value: string | null | undefined) => {
    const raw = String(value || "DOCUMENT").trim();
    if (!raw) return "Document";
    const canonical = DOC_TYPE_ALIASES[raw.toUpperCase()] || raw.toUpperCase();
    return DOC_TYPE_LABELS[canonical] || canonical;
  };
  const docStatusBadge = (status: string) => {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return "bg-emerald-50 border-emerald-200 text-emerald-700";
    if (s === "REJECTED") return "bg-red-50 border-red-200 text-red-700";
    return "bg-amber-50 border-amber-200 text-amber-700";
  };
  const docCardTone = (status: string) => {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return "border-emerald-200 bg-emerald-50/30";
    if (s === "REJECTED") return "border-red-200 bg-red-50/25";
    return "border-gray-200 bg-white";
  };
  const docStatusLabel = (status: string | undefined) => {
    const s = String(status || "PENDING").toUpperCase();
    return s.charAt(0) + s.slice(1).toLowerCase();
  };
  const canonicalDocType = (value: string | null | undefined) => {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    return DOC_TYPE_ALIASES[raw] || raw;
  };
  const requiredDocumentCards = useMemo(() => {
    return REQUIRED_OPERATOR_DOC_TYPES.map((requiredType) => {
      const latest = documents.find((d) => canonicalDocType(d.type) === requiredType);
      return {
        requiredType,
        doc: latest || null,
      };
    });
  }, [documents]);
  const financialSummary = useMemo(() => {
    if (agent?.financialSummary) return agent.financialSummary;
    const gross = Number(agent?.totalRevenueGenerated || 0);
    const fallbackCommissionPercent = 15;
    const commission = Math.round((gross * fallbackCommissionPercent) * 100) / 100;
    return {
      paidCount: Number(agent?.totalCompletedTrips || 0),
      grossSum: gross,
      commissionSum: commission,
      netSum: Math.round((gross - commission) * 100) / 100,
      commissionPercent: fallbackCommissionPercent,
      currency: tourCurrency,
    };
  }, [agent, tourCurrency]);
  const financialCurrency = String(financialSummary.currency || tourCurrency || "USD").toUpperCase();
  const submittedProfileReviewStatus = String(
    (agent?.operatorProfile as any)?.reviewStatus || (agent?.operatorProfile as any)?.review?.status || "PENDING",
  ).toUpperCase();
  const submittedProfileReviewNote = String(
    (agent?.operatorProfile as any)?.reviewReason || (agent?.operatorProfile as any)?.review?.reason || "",
  ).trim();
  const submittedProfileReviewBadge =
    submittedProfileReviewStatus === "APPROVED"
      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
      : submittedProfileReviewStatus === "REJECTED"
        ? "bg-red-50 border border-red-200 text-red-700"
        : "bg-amber-50 border border-amber-200 text-amber-700";
  const submittedProfileRaw = submittedProfile && typeof submittedProfile === "object"
    ? (submittedProfile as Record<string, any>)
    : {};
  const submittedProfileSlug = String(
    submittedProfileRaw.profileSlug || slugifyProfile(String(submittedProfileRaw.companyName || companyName || "operator-profile"), agent?.id),
  );
  const submittedProfileReviewHref = agent?.id ? `/admin/agents/${agent.id}/submitted-profile/${submittedProfileSlug}` : "#";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {loading ? (
        <AgentDetailSkeleton />
      ) : error || !agent ? (
        <div className="bg-red-50 rounded-xl border border-red-200 p-6 text-red-700">
          <div className="font-semibold">Failed to load tour operator details</div>
          <div className="mt-1 text-sm">{error || "Tour operator not found"}</div>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                <Link
                  href="/admin/agents/tour-operators"
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title="Back to operators"
                >
                  <ArrowLeft className="h-5 w-5 text-gray-600" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {agent.user.avatarUrl ? (
                        <Image src={agent.user.avatarUrl} alt="avatar" fill unoptimized={/^https?:\/\//i.test(agent.user.avatarUrl)} className="object-cover" />
                      ) : (
                        <span className="text-[#02665e] font-bold">{initials(agent.user.fullName || agent.user.name)}</span>
                      )}
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
                      {agent.user.fullName || agent.user.name || `Tour Operator #${agent.id}`}
                    </h1>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${kycLikeBadge(agent.status)}`}>
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" /> {agent.status}
                    </span>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${accountStatusBadge(agent.suspendedAt)}`}>
                      {agent.suspendedAt ? "Suspended" : "Active"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6 min-w-0">
              <Card
                icon={<User className="h-5 w-5 text-blue-600" />}
                title="Tour Operator Information"
                subtitle="Submitted company and operation profile details"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <Field label="Company Name" icon={<Building2 className="h-4 w-4 text-gray-400" />} value={companyName} />
                  <Field label="Hired At" icon={<Calendar className="h-4 w-4 text-gray-400" />} value={fmtDate(agent.createdAt)} sub={fmtTime(agent.createdAt)} />
                  <Field label="Email" icon={<Mail className="h-4 w-4 text-gray-400" />} value={profileEmail} />
                  <Field label="Phone" icon={<Phone className="h-4 w-4 text-gray-400" />} value={profilePhone} />
                  <Field label="Region" icon={<Building2 className="h-4 w-4 text-gray-400" />} value={profileRegion} />
                  <Field label="District" icon={<Building2 className="h-4 w-4 text-gray-400" />} value={profileDistrict} />
                  <Field
                    label="Physical Location"
                    icon={<Building2 className="h-4 w-4 text-gray-400" />}
                    value={physicalLocation}
                  />
                  <Field
                    label="Type of Tourism"
                    icon={<Building2 className="h-4 w-4 text-gray-400" />}
                    value={tourismTypes}
                  />
                  <Field
                    label="Area of Operation"
                    icon={<Building2 className="h-4 w-4 text-gray-400" />}
                    value={areaOfOperation}
                  />
                  <Field label="Experience (years)" icon={<Building2 className="h-4 w-4 text-gray-400" />} value={String(agent.yearsOfExperience ?? "-")} />
                </div>
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Description</div>
                  <p className="text-sm text-gray-800 leading-6">{profileDescription}</p>
                </div>
              </Card>

              <Card
                icon={<DollarSign className="h-5 w-5 text-amber-600" />}
                title="Financial Summary"
                subtitle="Revenue and commission overview"
              >
                <div className="space-y-3 sm:space-y-4">
                  <MetricRow label="Paid Invoices" value={String(financialSummary.paidCount)} />
                  <MetricRow label="Gross Revenue" value={fmtMoney(financialSummary.grossSum, financialCurrency)} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="p-3 sm:p-4 bg-blue-50 rounded-lg min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Commission</div>
                      <div className="text-base sm:text-lg font-bold text-blue-900 mt-1 break-words">{fmtMoney(financialSummary.commissionSum, financialCurrency)}</div>
                    </div>
                    <div className="p-3 sm:p-4 bg-emerald-50 rounded-lg border-2 border-emerald-200 min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Net Revenue</div>
                      <div className="text-base sm:text-lg font-bold text-emerald-900 mt-1 break-words">{fmtMoney(financialSummary.netSum, financialCurrency)}</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
                <div className="flex items-start gap-3 mb-4 sm:mb-6">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Account Actions</h2>

                    <div className="space-y-2 sm:space-y-3">
                      {agent.suspendedAt ? (
                        <button
                          className="w-full px-4 py-2.5 sm:py-3 bg-green-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-green-700 active:bg-green-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          onClick={() => void restoreAgent()}
                          disabled={actionLoading}
                        >
                          {actionLoading ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                              Processing...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              Unsuspend
                            </>
                          )}
                        </button>
                      ) : (
                        <>
                          {!showSuspendForm ? (
                            <button
                              className="w-full px-4 py-2.5 sm:py-3 bg-red-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-red-700 active:bg-red-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              onClick={handleSuspendClick}
                              disabled={actionLoading}
                            >
                              <Ban className="h-4 w-4" />
                              Suspend Tour Operator
                            </button>
                          ) : (
                            <div className="space-y-3 p-3 sm:p-4 bg-red-50 rounded-lg border border-red-200">
                              <div>
                                <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                                  Reason for Suspension <span className="text-red-600">*</span>
                                </label>
                                <textarea
                                  className="w-full min-h-[100px] px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none text-xs sm:text-sm box-border"
                                  placeholder="Please provide a clear reason for suspending this agent."
                                  value={suspendReason}
                                  onChange={(e) => setSuspendReason(e.target.value)}
                                />
                                <p className="text-xs text-gray-500 mt-1">This can be shared with the tour operator.</p>
                              </div>
                              <div className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  id="notify-agent"
                                  checked={notifyAgent}
                                  onChange={(e) => setNotifyAgent(e.target.checked)}
                                  className="mt-1 h-4 w-4 text-[#02665e] border-gray-300 rounded focus:ring-[#02665e] flex-shrink-0"
                                />
                                <label htmlFor="notify-agent" className="text-xs sm:text-sm text-gray-700">
                                  Open notification draft email after suspension
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-red-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                                  onClick={() => void suspendAgent()}
                                  disabled={actionLoading || !suspendReason.trim()}
                                >
                                  {actionLoading ? (
                                    <>
                                      <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-white border-t-transparent"></div>
                                      <span className="hidden sm:inline">Suspending...</span>
                                      <span className="sm:hidden">...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Ban className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                                      <span className="hidden sm:inline">Confirm Suspension</span>
                                      <span className="sm:hidden">Suspend</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  className="p-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
                                  onClick={cancelSuspend}
                                  disabled={actionLoading}
                                  title="Cancel"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {!showImpersonateForm ? (
                        <button
                          className="w-full px-4 py-2.5 sm:py-3 bg-[#02665e] text-white rounded-lg text-sm sm:text-base font-medium hover:bg-[#02665e]/90 active:bg-[#02665e]/80 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          onClick={handleImpersonateClick}
                          disabled={actionLoading}
                        >
                          <Copy className="h-4 w-4" />
                          Impersonate
                        </button>
                      ) : (
                        <div className="space-y-3 p-3 sm:p-4 bg-[#02665e]/5 rounded-lg border border-[#02665e]/20">
                          <div>
                            <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                              Reason for Impersonation <span className="text-red-600">*</span>
                            </label>
                            <textarea
                              className="w-full min-h-[80px] px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-all resize-none text-xs sm:text-sm box-border"
                              placeholder="Please provide a reason for impersonating this tour operator (e.g., customer support, troubleshooting, etc.)"
                              value={impersonateReason}
                              onChange={(e) => setImpersonateReason(e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1">This action will be logged in the audit trail.</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-[#02665e] text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-[#02665e]/90 active:bg-[#02665e]/80 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                              onClick={() => void confirmImpersonate()}
                              disabled={actionLoading || !impersonateReason.trim()}
                            >
                              {actionLoading ? (
                                <>
                                  <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-white border-t-transparent"></div>
                                  <span className="hidden sm:inline">Processing...</span>
                                  <span className="sm:hidden">...</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                                  <span className="hidden sm:inline">Confirm Impersonation</span>
                                  <span className="sm:hidden">Confirm</span>
                                </>
                              )}
                            </button>
                            <button
                              className="p-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
                              onClick={cancelImpersonate}
                              disabled={actionLoading}
                              title="Cancel"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      <button
                        className="w-full px-4 py-2.5 sm:py-3 bg-blue-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        onClick={handleNotificationToggle}
                        disabled={actionLoading || !agent.user.email}
                      >
                        <Bell className="h-4 w-4" />
                        {showNotificationForm ? "Hide Notification Form" : "Send Notification"}
                      </button>

                      {showNotificationForm ? (
                        <div className="space-y-3 p-3 sm:p-4 bg-blue-50 rounded-lg border border-blue-200 mt-3">
                          <div>
                            <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                              Subject <span className="text-red-600">*</span>
                            </label>
                            <input
                              type="text"
                              className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs sm:text-sm box-border"
                              placeholder="Type notification subject"
                              value={notificationSubject}
                              onChange={(e) => setNotificationSubject(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                              Message <span className="text-red-600">*</span>
                            </label>
                            <textarea
                              className="w-full min-h-[100px] px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none text-xs sm:text-sm box-border"
                              placeholder="Enter the notification message to send to the tour operator"
                              value={notificationMessage}
                              onChange={(e) => setNotificationMessage(e.target.value)}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                              onClick={sendNotification}
                              disabled={actionLoading || !notificationSubject.trim() || !notificationMessage.trim()}
                            >
                              <Bell className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              <span className="hidden sm:inline">Send Notification</span>
                              <span className="sm:hidden">Send</span>
                            </button>
                            <button
                              className="p-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
                              onClick={() => setShowNotificationForm(false)}
                              disabled={actionLoading}
                              title="Cancel"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                    <History className="h-4 w-4 text-purple-600" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900">Audit & History</h3>
                </div>
                {auditLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-purple-600"></div>
                  </div>
                ) : auditItems.length === 0 ? (
                  <div className="text-center py-6">
                    <Activity className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No audit history found</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {auditItems.slice(0, 10).map((audit: any, idx: number) => {
                      const getActionIcon = () => {
                        const action = String(audit.action || "").toUpperCase();
                        if (action.includes("SUSPEND")) return <Ban className="h-4 w-4 text-red-600" />;
                        if (action.includes("RESTORE") || action.includes("UNSUSPEND")) return <CheckCircle2 className="h-4 w-4 text-green-600" />;
                        if (action.includes("IMPERSONATE")) return <Copy className="h-4 w-4 text-blue-600" />;
                        if (action.includes("NOTIFY")) return <Bell className="h-4 w-4 text-blue-600" />;
                        return <Activity className="h-4 w-4 text-gray-600" />;
                      };

                      const getActionColor = () => {
                        const action = String(audit.action || "").toUpperCase();
                        if (action.includes("SUSPEND") || action.includes("REJECT")) return "bg-red-50 border-red-200";
                        if (action.includes("RESTORE") || action.includes("UNSUSPEND") || action.includes("APPROVE")) return "bg-emerald-50 border-emerald-200";
                        if (action.includes("IMPERSONATE") || action.includes("NOTIFY")) return "bg-blue-50 border-blue-200";
                        return "bg-gray-50 border-gray-200";
                      };

                      return (
                        <div key={audit.id || idx} className={`p-3 rounded-lg border ${getActionColor()} transition-all hover:shadow-sm`}>
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-0.5">{getActionIcon()}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                                  {formatAuditActionLabel(audit.action)}
                                </span>
                                <span className="text-xs text-gray-500 flex-shrink-0">
                                  {new Date(audit.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                              {audit.details && (
                                <p className="text-xs text-gray-600 mb-1 line-clamp-2">
                                  {typeof audit.details === "string" ? audit.details : JSON.stringify(audit.details)}
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <Clock className="h-3 w-3" />
                                <span>{new Date(audit.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                                {audit.adminId ? (
                                  <>
                                    <span>•</span>
                                    <span>Admin ID: {audit.adminId}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {auditItems.length > 10 ? (
                  <div className="mt-3 text-center">
                    <p className="text-xs text-gray-500">Showing 10 of {auditItems.length} entries</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-white/90 backdrop-blur rounded-2xl border border-gray-200 px-3 py-2 sm:px-4 sm:py-3 shadow-sm">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
              {[
                { key: "overview", label: "Overview" },
                { key: "documents", label: "Documents" },
                { key: "notes", label: "Notes" },
                { key: "profile", label: "Submitted Profile" },
                { key: "bookings", label: "Bookings" },
              ].map((item) => {
                const active = tab === (item.key as typeof tab);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key as typeof tab)}
                    className={`w-full px-2 sm:px-5 py-2.5 rounded-full border text-sm sm:text-base font-medium transition-all ${
                      active
                        ? "bg-[#02665e] text-white border-[#02665e] shadow-md"
                        : "bg-white text-gray-600 border-gray-400 hover:bg-gray-50"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {tab === "documents" ? (
            <Card
              icon={<FileText className="h-5 w-5 text-blue-600" />}
              title="Submitted Documents"
              subtitle="Verification files provided by the tour operator"
            >
              {docsLoading ? (
                <div className="text-sm text-gray-500">Loading documents...</div>
              ) : docsError ? (
                <div className="text-sm text-red-600">{docsError}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                  {requiredDocumentCards.map(({ requiredType, doc }) => (
                    <div key={requiredType} className={`rounded-xl border p-4 shadow-sm ${docCardTone(doc?.status || "PENDING")}`}>
                      {(() => {
                        const statusUpper = String(doc?.status || "PENDING").toUpperCase();
                        const isApproved = statusUpper === "APPROVED";
                        const isRejected = statusUpper === "REJECTED";
                        const isUploaded = Boolean(doc?.id);
                        const hasViewUrl = Boolean(doc?.url);
                        return (
                          <>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="font-semibold text-gray-900 text-sm sm:text-base truncate pr-2">{formatDocType(requiredType)}</div>
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${docStatusBadge(doc?.status || "PENDING")}`}>
                          {docStatusLabel(doc?.status)}
                        </span>
                      </div>
                      {!doc ? <p className="text-xs sm:text-sm text-gray-500 mb-2">No file uploaded yet.</p> : null}
                      {doc && isApproved ? (
                        <div className="text-xs text-emerald-700 mb-2 font-medium">
                          Approved: {fmtDate(doc.updatedAt || doc.createdAt)} at {fmtTime(doc.updatedAt || doc.createdAt)}
                        </div>
                      ) : null}
                      {doc && !isApproved ? (
                        <div className="text-xs text-gray-500 mb-2">
                          Uploaded: {fmtDate(doc.createdAt)} at {fmtTime(doc.createdAt)}
                        </div>
                      ) : null}
                      {isRejected && doc?.reason ? <p className="text-xs sm:text-sm text-red-700 mb-2">Reason: {doc.reason}</p> : null}
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="View document"
                          title="View"
                          onClick={() => {
                            if (!isUploaded) return;
                            if (hasViewUrl && doc?.url) {
                              window.open(doc.url, "_blank", "noopener,noreferrer");
                              return;
                            }
                            alert("This file is uploaded but no preview URL is available yet.");
                          }}
                          disabled={!isUploaded}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium border transition-colors ${
                            isUploaded
                              ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              : "border-gray-200 bg-gray-100 text-gray-400"
                          } disabled:opacity-60 disabled:cursor-not-allowed`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {!isApproved ? (
                          <button
                            type="button"
                            onClick={() => doc?.id && void approveDocument(doc.id)}
                            disabled={!doc?.id || docActionLoadingId === doc.id}
                            aria-label={doc?.id && docActionLoadingId === doc.id ? "Approving document" : "Approve document"}
                            title={doc?.id && docActionLoadingId === doc.id ? "Approving..." : "Approve"}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {doc?.id && docActionLoadingId === doc.id ? (
                              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : null}
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {tab === "notes" ? (
            <Card
              icon={<Bell className="h-5 w-5 text-blue-600" />}
              title="Admin Notes"
              subtitle="Internal support notes for this tour operator"
            >
              <div className="space-y-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 sm:p-4">
                  <div className="text-xs font-medium text-blue-800 uppercase tracking-wide mb-1">How to use Admin Notes</div>
                  <p className="text-sm text-blue-900 leading-6">
                    Use this section to record internal follow-ups, decisions, escalation context, and handover updates for other admins.
                    Notes are for admin team coordination and are shown in Note History with date/time and author.
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Add Support Note</div>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className="w-full min-h-[110px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] resize-none text-sm"
                    placeholder="Example: Called operator, requested updated tourism license, follow-up due tomorrow 10:00."
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void addNote()}
                      disabled={savingNote || !noteText.trim()}
                      className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium border border-[#02665e] bg-[#02665e] text-white hover:bg-[#02554e] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingNote ? "Saving..." : "Save Note"}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Note History</div>
                  {notesLoading ? (
                    <div className="text-sm text-gray-500">Loading notes...</div>
                  ) : notesError ? (
                    <div className="text-sm text-red-600">{notesError}</div>
                  ) : notes.length === 0 ? (
                    <div className="text-sm text-gray-500">No admin notes yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {notes.map((n) => (
                        <div key={n.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.text}</p>
                          <div className="mt-1 text-xs text-gray-500">
                            {fmtDate(n.createdAt)} {fmtTime(n.createdAt)}
                            {n.admin ? ` • ${(n.admin.fullName || n.admin.name || n.admin.email || `Admin #${n.adminId}`)}` : ` • Admin #${n.adminId}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : null}

          {tab === "profile" ? (
            <Card
              icon={<FileText className="h-5 w-5 text-amber-600" />}
              title="Submitted Operator Profile"
              subtitle="Admin review controls and audit policy"
            >
              <div className="mb-5 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4 sm:p-5">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      <ShieldCheck className="h-4 w-4" />
                      Admin Can
                    </div>
                    <div className="space-y-1.5 text-sm text-slate-700">
                      <div>Approve submitted operator profile</div>
                      <div>Reject with mandatory reason</div>
                      <div>Review all submitted details before decision</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                      <Ban className="h-4 w-4" />
                      Admin Cannot
                    </div>
                    <div className="space-y-1.5 text-sm text-slate-700">
                      <div>Edit submitted profile content here</div>
                      <div>Approve without viewing full submitted card</div>
                      <div>Reject without providing a reason</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                      <History className="h-4 w-4" />
                      Audit Notice
                    </div>
                    <p className="text-sm text-amber-900">
                      Every admin review action is logged with timestamp, admin identity, and decision reason for compliance.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Review Status</span>
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${submittedProfileReviewBadge}`}>
                    {submittedProfileReviewStatus}
                  </span>
                </div>
                {submittedProfileReviewNote ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <span className="font-semibold text-slate-800">Last review note:</span> {submittedProfileReviewNote}
                  </div>
                ) : null}
              </div>

              <div className="mb-4">
                <SubmittedProfileCard
                  profile={submittedProfileRaw}
                  reviewHref={submittedProfileReviewHref}
                  reviewStatus={submittedProfileReviewStatus}
                  commissionPercent={adminCommissionPercent}
                />
              </div>
            </Card>
          ) : null}

          {tab === "bookings" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                  type="text"
                  placeholder="Search by request ID, requester, or destination..."
                  value={bookingSearch}
                  onChange={(e) => {
                    setBookingSearch(e.target.value);
                    setBookingPage(1);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-center">
                {["all", "new", "in_progress", "completed", "cancelled"].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setBookingStatus(s);
                      setBookingPage(1);
                    }}
                    className={
                      bookingStatus === s
                        ? `px-4 py-2 rounded-full text-xs font-semibold transition-all text-white border-0 shadow-lg ${getStatusGradient(s)}`
                        : "px-4 py-2 rounded-full text-xs font-medium transition-colors bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-sm"
                    }
                  >
                    {s.toUpperCase().replace(/_/g, " ")}
                  </button>
                ))}
              </div>

              {bookingsError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{bookingsError}</div>
              )}

              {bookingsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-gray-500">Loading bookings...</div>
                </div>
              ) : bookings.length > 0 ? (
                <>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("id")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Request ID
                              {renderBookingSortIcon("id")}
                            </span>
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("guest")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Requester
                              {renderBookingSortIcon("guest")}
                            </span>
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("property")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Destination/Trip
                              {renderBookingSortIcon("property")}
                            </span>
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("checkIn")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Start Date
                              {renderBookingSortIcon("checkIn")}
                            </span>
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("checkOut")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              End Date
                              {renderBookingSortIcon("checkOut")}
                            </span>
                          </th>
                          <th className="text-right px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("amount")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Amount
                              {renderBookingSortIcon("amount")}
                            </span>
                          </th>
                          <th className="text-right px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("operatorPayout")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Op. Payout
                              {renderBookingSortIcon("operatorPayout")}
                            </span>
                          </th>
                          <th className="text-right px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("platformFee")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Platform Fee
                              {renderBookingSortIcon("platformFee")}
                            </span>
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleBookingSortClick("status")}>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              Status
                              {renderBookingSortIcon("status")}
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBookings.map((booking) => (
                          <TableRow key={booking.id} className="border-b border-gray-200">
                            <td className="px-4 py-3 text-gray-900 font-mono text-xs whitespace-nowrap">{String(booking.id).slice(0, 8)}...</td>
                            <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{booking.guestName}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{booking.property}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDate(booking.checkIn)}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDate(booking.checkOut)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtMoney(booking.amount, financialCurrency)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-green-600 whitespace-nowrap">{fmtMoney(booking.operatorPayout, financialCurrency)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-600 whitespace-nowrap">{fmtMoney(booking.platformFee, financialCurrency)}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                {booking.status.replace(/_/g, " ")}
                              </span>
                            </td>
                          </TableRow>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-600 px-2">
                    <span>
                      Showing {(bookingPage - 1) * pageSize + 1} to {Math.min(bookingPage * pageSize, bookingTotal)} of {bookingTotal} bookings
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setBookingPage((p) => Math.max(1, p - 1))}
                        disabled={bookingPage <= 1}
                        className="px-3 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setBookingPage((p) => (p * pageSize < bookingTotal ? p + 1 : p))}
                        disabled={bookingPage * pageSize >= bookingTotal}
                        className="px-3 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">No assigned tour requests found for this operator.</div>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Card({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      <div className="flex items-start gap-3 mb-4 sm:mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon, value, sub }: { label: string; icon: ReactNode; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="font-semibold text-sm text-gray-900 truncate">{value}</span>
      </div>
      {sub ? <div className="text-xs text-gray-500 ml-6 mt-0.5">{sub}</div> : null}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
      <span className="text-xs sm:text-sm font-medium text-gray-700 truncate pr-2">{label}</span>
      <span className="text-base sm:text-lg font-bold text-gray-900 flex-shrink-0">{value}</span>
    </div>
  );
}

function AgentDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-label="Loading operator details">
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-9 w-9 rounded-lg bg-gray-200" />
          <div className="h-10 w-10 rounded-lg bg-gray-200" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-6 w-56 rounded bg-gray-200" />
            <div className="h-4 w-36 rounded bg-gray-100" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
            <div className="h-5 w-56 rounded bg-gray-200 mb-2" />
            <div className="h-4 w-72 rounded bg-gray-100 mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-24 rounded bg-gray-100" />
                  <div className="h-4 w-full rounded bg-gray-200" />
                </div>
              ))}
            </div>
            <div className="mt-5 h-24 w-full rounded-lg bg-gray-100" />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
            <div className="h-5 w-40 rounded bg-gray-200 mb-2" />
            <div className="h-4 w-60 rounded bg-gray-100 mb-5" />
            <div className="space-y-3">
              <div className="h-12 w-full rounded-lg bg-gray-100" />
              <div className="h-12 w-full rounded-lg bg-gray-100" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="h-16 w-full rounded-lg bg-gray-100" />
                <div className="h-16 w-full rounded-lg bg-gray-100" />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
            <div className="h-5 w-36 rounded bg-gray-200 mb-4" />
            <div className="space-y-3">
              <div className="h-10 w-full rounded-lg bg-gray-100" />
              <div className="h-10 w-full rounded-lg bg-gray-100" />
              <div className="h-10 w-full rounded-lg bg-gray-100" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
            <div className="h-5 w-28 rounded bg-gray-200 mb-4" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-gray-100" />
              <div className="h-4 w-4/5 rounded bg-gray-100" />
              <div className="h-4 w-3/5 rounded bg-gray-100" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 w-32 rounded-full bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
