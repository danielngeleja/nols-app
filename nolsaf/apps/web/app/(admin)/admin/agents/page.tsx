"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X, User, CheckCircle, XCircle, Clock, Eye, Filter, GraduationCap, MapPin, Award, Languages, Briefcase, UsersRound, ChevronDown, Star, CheckCircle2, Mail, Phone, TrendingUp, Target, Trophy, Loader2, AlertCircle, RefreshCw, ExternalLink, FileX, FileText, FileCheck, Check, Undo2, ShieldOff, ShieldCheck, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";

const api = apiClient;

function unwrapApiData<T = any>(axiosData: any): T {
  // admin.agents endpoints respond as { ok: true, data: ... }
  // but some other endpoints in the app respond as plain objects.
  return (axiosData && typeof axiosData === "object" && "data" in axiosData) ? (axiosData.data as T) : (axiosData as T);
}

function authify() {}

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

// Validate agent ID
function isValidAgentId(id: number | null | undefined): boolean {
  return id !== null && id !== undefined && Number.isInteger(id) && id > 0;
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

function isProbablyPdf(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

function isProbablyImage(url: string): boolean {
  return /\.(png|jpg|jpeg|webp|gif)($|\?)/i.test(url);
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

// Toast notification helper
function showToast(type: "success" | "error" | "info" | "warning", title: string, message?: string, duration?: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("nols:toast", {
        detail: { type, title, message, duration: duration ?? 5000 },
      })
    );
  }
}

type Agent = {
  id: number;
  userId: number;
  status: string;
  educationLevel: string | null;
  areasOfOperation: string[] | null;
  certifications: any[] | null;
  languages: string[] | string | null;
  yearsOfExperience: number | null;
  specializations: string[] | null;
  bio: string | null;
  isAvailable: boolean;
  maxActiveRequests: number;
  currentActiveRequests: number;
  performanceMetrics: any;
  level?: string;
  completedTours?: number;
  noLSAFRevenue?: number;
  overallRating?: number | null;
  totalReviews?: number;
  promotionProgress?: {
    currentTrips: number;
    minTrips: number;
    maxTrips: number;
    currentRevenue: number;
    minRevenue: number;
    revenueCurrency?: string;
    currentRating?: number | null;
    minRating?: number | null;
    currentReviews?: number;
    minReviews?: number | null;
    ratingProgress?: number;
    reviewsProgress?: number;
    tripsProgress: number;
    revenueProgress: number;
    overallProgress: number;
    eligibleForPromotion: boolean;
  };
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  suspendedBy?: number | null;
  restoredAt?: string | null;
  restoredBy?: number | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    name: string | null;
    fullName?: string | null;
    email: string | null;
    phone: string | null;
    nationality?: string | null;
    region?: string | null;
    district?: string | null;
    timezone?: string | null;
    avatarUrl?: string | null;
  };
};

type AgentDocument = {
  id: number;
  userId: number;
  type: string | null;
  status: string;
  reason?: string | null;
  url?: string | null;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
};

export default function AdminAgentsPage() {
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [loadingAgentDetails, setLoadingAgentDetails] = useState(false);
  const [agentDetailsError, setAgentDetailsError] = useState<string | null>(null);
  const [personalDetailsOpen, setPersonalDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suspend / Restore modal state
  const [suspendModal, setSuspendModal] = useState<{ open: boolean; agentId: number | null; reason: string; step: 1 | 2; confirmName: string }>({ open: false, agentId: null, reason: "", step: 1, confirmName: "" });
  const [restoreModal, setRestoreModal] = useState<{ open: boolean; agentId: number | null; notes: string }>({ open: false, agentId: null, notes: "" });
  const [isSuspending, setIsSuspending] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const [agentDocuments, setAgentDocuments] = useState<AgentDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docActionLoadingId, setDocActionLoadingId] = useState<number | null>(null);
  const docsRef = useRef<HTMLDivElement | null>(null);

  const [docPreview, setDocPreview] = useState<{ open: boolean; url: string; title: string }>({
    open: false,
    url: "",
    title: "",
  });


  // Filter states
  const [status, setStatus] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  // Client-side sort of the current page (pageSize 30). null = API order (newest first).
  const [sortKey, setSortKey] = useState<"company" | "tier" | "performance" | "status" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [areasOfOperation, setAreasOfOperation] = useState<string>("");
  const [languages, setLanguages] = useState<string>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (searchParams) {
      setStatus(searchParams.get("status") || "");
      setLevel(searchParams.get("level") || "");
    }
  }, [searchParams]);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQ(q);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      authify();
      const params: any = {
        page,
        pageSize,
      };

      if (status && status.trim()) params.status = sanitizeInput(status.trim());
      if (level && level.trim()) params.level = sanitizeInput(level.trim());
      if (areasOfOperation && areasOfOperation.trim()) params.areasOfOperation = sanitizeInput(areasOfOperation.trim());
      if (languages && languages.trim()) params.languages = sanitizeInput(languages.trim());
      if (debouncedQ && debouncedQ.trim()) params.q = sanitizeInput(debouncedQ.trim());

      const response = await api.get<{ items: Agent[]; total: number; page: number; pageSize: number }>("/api/admin/agents", { params });
      const payload = unwrapApiData<{ items: Agent[]; total: number; page: number; pageSize: number }>(response.data);
      setAgents(payload?.items || []);
      setTotal(payload?.total || 0);
    } catch (err: any) {
      console.error("Failed to load agents", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load agents";
      setError(errorMessage);
      showToast("error", "Failed to Load Agents", errorMessage);
    } finally {
      setLoading(false);
    }
  }, [page, status, level, areasOfOperation, languages, debouncedQ]);

  useEffect(() => {
    authify();
    load();
  }, [load]);

  const getStatusColor = (agentStatus: string) => {
    switch (agentStatus) {
      case "ACTIVE":
        return "bg-green-100 text-green-700";
      case "INACTIVE":
        return "bg-gray-100 text-gray-700";
      case "SUSPENDED":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const getStatusIcon = (agentStatus: string) => {
    switch (agentStatus) {
      case "ACTIVE":
        return <CheckCircle className="h-4 w-4" />;
      case "INACTIVE":
        return <Clock className="h-4 w-4" />;
      case "SUSPENDED":
        return <XCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getTierBadgeClass = (tier?: string) => {
    switch ((tier || "BRONZE").toUpperCase()) {
      case "PLATINUM":
        return "bg-purple-100 text-purple-700 border-purple-200";
      case "GOLD":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "SILVER":
        return "bg-slate-100 text-slate-700 border-slate-200";
      default:
        return "bg-amber-50 text-amber-700 border-amber-200";
    }
  };

  const toggleSort = (key: "company" | "tier" | "performance" | "status") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const TIER_RANK: Record<string, number> = { BRONZE: 0, SILVER: 1, GOLD: 2, PLATINUM: 3 };
  const sortedAgents = (() => {
    if (!sortKey) return agents;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (a: Agent): number | string => {
      switch (sortKey) {
        case "company": return (a.user?.name || a.user?.email || "").toLowerCase();
        case "tier": return TIER_RANK[(a.level || "BRONZE").toUpperCase()] ?? 0;
        case "performance": return a.completedTours ?? 0;
        case "status": return (a.status || "").toLowerCase();
        default: return 0;
      }
    };
    return [...agents].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  })();

  const SortIcon = ({ k }: { k: "company" | "tier" | "performance" | "status" }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 text-gray-300" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-[#02665e]" /> : <ArrowDown className="h-3 w-3 text-[#02665e]" />;
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const closeAgentDetails = useCallback(() => {
    setViewingAgent(null);
    setAgentDetailsError(null);
    setLoadingAgentDetails(false);
  }, []);

  async function handleSuspendConfirmed() {
    if (!suspendModal.agentId || suspendModal.reason.trim().length < 10) return;
    setIsSuspending(true);
    try {
      authify();
      await api.post(`/api/admin/agents/${suspendModal.agentId}/suspend`, { reason: suspendModal.reason.trim() });
      setSuspendModal({ open: false, agentId: null, reason: "", step: 1, confirmName: "" });
      load();
      if (viewingAgent && viewingAgent.id === suspendModal.agentId) {
        const res = await api.get(`/api/admin/agents/${suspendModal.agentId}`);
        setViewingAgent(unwrapApiData<Agent>(res.data) ?? viewingAgent);
      }
    } catch (e: any) {
      alert(e?.response?.data?.message || "Failed to suspend agent.");
    } finally {
      setIsSuspending(false);
    }
  }

  async function handleRestoreConfirmed() {
    if (!restoreModal.agentId) return;
    setIsRestoring(true);
    try {
      authify();
      await api.post(`/api/admin/agents/${restoreModal.agentId}/restore`, { notes: restoreModal.notes.trim() || undefined });
      setRestoreModal({ open: false, agentId: null, notes: "" });
      load();
      if (viewingAgent && viewingAgent.id === restoreModal.agentId) {
        const res = await api.get(`/api/admin/agents/${restoreModal.agentId}`);
        setViewingAgent(unwrapApiData<Agent>(res.data) ?? viewingAgent);
      }
    } catch (e: any) {
      alert(e?.response?.data?.message || "Failed to restore agent.");
    } finally {
      setIsRestoring(false);
    }
  }

  useEffect(() => {
    if (!viewingAgent) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAgentDetails();
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [closeAgentDetails, viewingAgent]);

  // Obligatory tour-company documents — must mirror REQUIRED_DOCUMENTS in
  // app/account/agent/documents/page.tsx (the operator upload page) so the admin
  // panel checks for exactly what operators are asked to upload.
  const requiredDocTypes = useRef([
    { type: "BRELA_CERTIFICATE", label: "BRELA Certificate" },
    { type: "TIN_NUMBER", label: "TIN Number" },
    { type: "TOURISM_LICENSE", label: "Tourism License" },
    { type: "BUSINESS_LICENCE", label: "Business Licence" },
    { type: "NATIONAL_ID_OR_PASSPORT", label: "National ID / Passport" },
  ] as const);

  const getLatestDocByType = useCallback((docs: AgentDocument[], type: string) => {
    const upper = String(type || "").toUpperCase();
    return docs.find((d) => String(d.type || "").toUpperCase() === upper) || null;
  }, []);

  const loadDocuments = useCallback(async (agentId: number) => {
    if (!isValidAgentId(agentId)) return;
    setDocsLoading(true);
    setDocsError(null);
    try {
      authify();
      const resp = await api.get(`/api/admin/agents/${agentId}/documents`);
      const payload = unwrapApiData<{ documents: AgentDocument[] }>(resp.data);
      const docs = Array.isArray(payload?.documents) ? payload.documents : [];
      // Ensure newest-first ordering (API already does this)
      setAgentDocuments(docs);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to load agent documents";
      setDocsError(msg);
      setAgentDocuments([]);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!viewingAgent || !isValidAgentId(viewingAgent.id)) {
      setAgentDocuments([]);
      setDocsError(null);
      setDocsLoading(false);
      return;
    }
    void loadDocuments(viewingAgent.id);
  }, [loadDocuments, viewingAgent]);

  const updateDocumentStatus = useCallback(
    async (agentId: number, docId: number, status: "APPROVED" | "REJECTED", reason?: string) => {
      if (!isValidAgentId(agentId) || !Number.isInteger(docId) || docId <= 0) return;
      setDocActionLoadingId(docId);
      try {
        authify();
        const resp = await api.patch(`/api/admin/agents/${agentId}/documents/${docId}`, {
          status,
          reason: status === "REJECTED" ? String(reason || "").trim() : null,
        });
        const payload = unwrapApiData<{ doc: AgentDocument }>(resp.data);
        const updated = payload?.doc;
        if (updated) {
          setAgentDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        } else {
          // Fallback: reload
          await loadDocuments(agentId);
        }
        showToast("success", "Document updated", status === "APPROVED" ? "Approved" : "Rejected");
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || "Failed to update document";
        showToast("error", "Update failed", msg);
      } finally {
        setDocActionLoadingId(null);
      }
    },
    [loadDocuments],
  );


  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 w-full">
      {/* Header */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(135deg, #171437 0%, #123d52 42%, #0c6457 100%)", boxShadow: "0 28px 65px -15px rgba(12,100,87,0.42), 0 8px 22px -8px rgba(23,20,55,0.50)" }}
      >
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 220"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="800" cy="42" r="185" stroke="white" strokeOpacity="0.055" strokeWidth="1" fill="none" />
          <circle cx="110" cy="190" r="120" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          {[50, 96, 142, 188].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.028)" strokeWidth="1" />
          ))}
          <polyline
            points="0,170 100,145 210,156 330,118 460,138 590,94 710,116 830,78 900,88"
            fill="none"
            stroke="white"
            strokeOpacity="0.15"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon
            points="0,170 100,145 210,156 330,118 460,138 590,94 710,116 830,78 900,88 900,220 0,220"
            fill="white"
            fillOpacity="0.024"
          />
          <radialGradient id="tourCompaniesHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(45,212,191,0.22)" />
            <stop offset="100%" stopColor="rgba(45,212,191,0)" />
          </radialGradient>
          <ellipse cx="455" cy="112" rx="320" ry="145" fill="url(#tourCompaniesHeaderGlow)" />
        </svg>

        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 sm:py-14">
          <div
            className="mb-5 inline-flex items-center justify-center rounded-full"
            style={{
              width: 64,
              height: 64,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <UsersRound className="h-7 w-7" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>
          <div className="text-xs font-black uppercase tracking-widest text-teal-100">Company Operations</div>
          <h1
            className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            Tours Companies Management
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.60)" }}>
            Manage hired tour companies, assignments, availability, documents and operating capacity.
          </p>

          <div className="mt-4">
            <Link
              href="/admin/management/careers?tab=applications"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-white no-underline transition-all duration-150 hover:bg-white/15"
              style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }}
              title="Hire tour companies via job applications"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Hire via Applications
            </Link>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div
        className="rounded-xl p-4 sm:p-6 overflow-hidden transition-all duration-300 [&_label]:text-white/70"
        style={{ background: "linear-gradient(135deg, #10182e 0%, #143541 52%, #0f4f45 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2 mb-5">
          <Filter className="h-5 w-5 transition-transform duration-200" style={{ color: "#5eead4" }} />
          <h2 className="text-lg font-semibold text-white">Filters</h2>
        </div>
        
        <div className="space-y-5 w-full">
          {/* Search Row */}
          <div className="relative w-full min-w-0 box-border">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none z-10 transition-colors duration-200" />
            <input
              type="text"
              placeholder="Search tour companies by name, email, phone..."
              value={q}
              onChange={(e) => {
                const value = e.target.value;
                if (value.length <= 200) {
                  setQ(value);
                }
              }}
              aria-label="Search tour companies by name, email, phone, or other details"
              title="Search tour companies"
              maxLength={200}
              className="w-full min-w-0 max-w-full pl-12 pr-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] outline-none text-sm transition-all duration-200 bg-white hover:border-gray-300 focus:bg-white box-border placeholder:text-gray-400"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Status Filter */}
            <div className="flex flex-col min-w-0">
              <label htmlFor="status-filter" className="text-xs font-semibold text-gray-700 mb-2">Status</label>
              <select
                id="status-filter"
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full min-w-0 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] outline-none text-sm bg-white hover:border-gray-300 focus:bg-white transition-all duration-200 cursor-pointer box-border appearance-none"
              >
                <option value="">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>

            {/* Operator Tier Filter */}
            <div className="flex flex-col min-w-0">
              <label htmlFor="tier-filter" className="text-xs font-semibold text-gray-700 mb-2">Operator Tier</label>
              <select
                id="tier-filter"
                aria-label="Filter by operator tier"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="w-full min-w-0 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] outline-none text-sm bg-white hover:border-gray-300 focus:bg-white transition-all duration-200 cursor-pointer box-border appearance-none"
              >
                <option value="">All Tiers</option>
                <option value="BRONZE">Bronze</option>
                <option value="SILVER">Silver</option>
                <option value="GOLD">Gold</option>
                <option value="PLATINUM">Platinum</option>
              </select>
            </div>

            {/* Areas of Operation Filter */}
            <div className="flex flex-col min-w-0">
              <label className="text-xs font-semibold text-gray-700 mb-2">Area of Operation</label>
              <input
                type="text"
                placeholder="Filter by area..."
                value={areasOfOperation}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.length <= 100) {
                    setAreasOfOperation(value);
                  }
                }}
                aria-label="Filter by area of operation"
                title="Filter by area of operation"
                maxLength={100}
                className="w-full min-w-0 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] outline-none text-sm bg-white hover:border-gray-300 focus:bg-white transition-all duration-200 box-border placeholder:text-gray-400"
              />
            </div>

            {/* Languages Filter */}
            <div className="flex flex-col min-w-0">
              <label className="text-xs font-semibold text-gray-700 mb-2">Language</label>
              <input
                type="text"
                placeholder="Filter by language..."
                value={languages}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.length <= 50) {
                    setLanguages(value);
                  }
                }}
                aria-label="Filter by language"
                title="Filter by language"
                maxLength={50}
                className="w-full min-w-0 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] outline-none text-sm bg-white hover:border-gray-300 focus:bg-white transition-all duration-200 box-border placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Clear Filters Button */}
          {(status || level || areasOfOperation || languages || q) && (
            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setStatus("");
                  setLevel("");
                  setAreasOfOperation("");
                  setLanguages("");
                  setQ("");
                }}
                aria-label="Clear all filters"
                className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Agents List */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm">
          <div className="text-center">
            <Loader2 className="h-6 w-6 text-[#02665e] animate-spin mx-auto mb-2" />
            <p className="text-gray-500 text-sm">Loading tour companies...</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-white rounded-lg border border-red-200 p-8 shadow-sm">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 text-red-600 mx-auto mb-3" />
            <p className="text-red-800 font-medium mb-2">Failed to load tour companies</p>
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              aria-label="Retry loading agents"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm">
          <div className="text-center text-gray-500">
            {debouncedQ || status || level || areasOfOperation || languages
              ? "No tour companies found matching your filters"
              : "No tour companies found"}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("company")} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 m-0 cursor-pointer uppercase tracking-wider text-gray-500 hover:text-gray-700 focus:outline-none">
                      Company <SortIcon k="company" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("tier")} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 m-0 cursor-pointer uppercase tracking-wider text-gray-500 hover:text-gray-700 focus:outline-none">
                      Tier <SortIcon k="tier" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("performance")} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 m-0 cursor-pointer uppercase tracking-wider text-gray-500 hover:text-gray-700 focus:outline-none">
                      Performance <SortIcon k="performance" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Areas of Operation</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Languages</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 m-0 cursor-pointer uppercase tracking-wider text-gray-500 hover:text-gray-700 focus:outline-none">
                      Status <SortIcon k="status" />
                    </button>
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedAgents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-[#02665e]/10 flex items-center justify-center mr-3">
                          <User className="h-5 w-5 text-[#02665e]" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{agent.user.name || "N/A"}</div>
                          <div className="text-sm text-gray-500">{agent.user.email}</div>
                          {agent.user.phone && (
                            <div className="text-xs text-gray-400">{agent.user.phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTierBadgeClass(agent.level)}`}>
                        <Award className="h-3.5 w-3.5" />
                        {agent.level ? agent.level.charAt(0) + agent.level.slice(1).toLowerCase() : "Bronze"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-0.5 text-sm">
                        <div className="flex items-center gap-1.5 text-gray-900">
                          <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                          <span className="font-medium">{agent.completedTours ?? 0}</span>
                          <span className="text-xs text-gray-400">tours</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {(agent.noLSAFRevenue ?? 0).toLocaleString()} USD
                          {agent.overallRating != null && (
                            <span className="ml-2 text-amber-600">★ {agent.overallRating.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs">
                        {agent.areasOfOperation && Array.isArray(agent.areasOfOperation) && agent.areasOfOperation.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {agent.areasOfOperation.slice(0, 2).map((area, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs">
                                <MapPin className="h-3 w-3" />
                                {area}
                              </span>
                            ))}
                            {agent.areasOfOperation.length > 2 && (
                              <span className="text-xs text-gray-500">+{agent.areasOfOperation.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs">
                        {agent.languages && Array.isArray(agent.languages) && agent.languages.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {agent.languages.slice(0, 2).map((lang, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs">
                                <Languages className="h-3 w-3" />
                                {lang}
                              </span>
                            ))}
                            {agent.languages.length > 2 && (
                              <span className="text-xs text-gray-500">+{agent.languages.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(agent.status)}`}>
                        {getStatusIcon(agent.status)}
                        {agent.status}
                      </span>
                      {!agent.isAvailable && (
                        <div className="text-xs text-gray-500 mt-1">Not available</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={async () => {
                          if (!isValidAgentId(agent.id)) {
                            showToast("error", "Invalid Agent", "Invalid agent ID provided");
                            return;
                          }
                          setLoadingAgentDetails(true);
                          setAgentDetailsError(null);
                          try {
                            authify();
                            const response = await api.get<Agent>(`/api/admin/agents/${agent.id}`);
                            const payload = unwrapApiData<Agent>(response.data);
                            setViewingAgent(payload);
                          } catch (err: any) {
                            console.error("Failed to load agent details", err);
                            const errorMessage = err?.response?.data?.error || err?.message || "Failed to load agent details";
                            setAgentDetailsError(errorMessage);
                            showToast("error", "Failed to Load Agent", errorMessage);
                          } finally {
                            setLoadingAgentDetails(false);
                          }
                        }}
                        aria-label={`View details for agent ${agent.user.name || "Unknown"}`}
                        title="View agent details"
                        className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-[#02665e] hover:text-[#014d47] hover:bg-[#02665e]/10 transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                        <span className="sr-only">View</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-700">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} companies
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  aria-label="Go to previous page"
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="px-2 text-sm font-medium text-gray-600 tabular-nums">Page {page} of {pages}</span>
                <button
                  onClick={() => setPage(Math.min(pages, page + 1))}
                  disabled={page >= pages}
                  aria-label="Go to next page"
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agent Detail Modal */}
      {viewingAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAgentDetails();
          }}
        >
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" aria-hidden />
          <div className="relative bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.32)] ring-1 ring-black/8 flex flex-col">
            {/* Header */}
            <div
              className="relative flex-shrink-0 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #07332f 0%, #02665e 55%, #038a7e 100%)" }}
            >
              {/* Dot-grid texture */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                  maskImage: "radial-gradient(ellipse 80% 90% at 30% 50%, black 0%, transparent 100%)",
                  WebkitMaskImage: "radial-gradient(ellipse 80% 90% at 30% 50%, black 0%, transparent 100%)",
                }}
                aria-hidden
              />
              {/* Radial glow behind avatar */}
              <div className="pointer-events-none absolute -left-8 -top-8 h-48 w-48 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)" }} aria-hidden />
              {/* Bottom edge line */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10" aria-hidden />

              <div className="relative px-6 py-5 flex items-center justify-between gap-4">
                {/* Left: avatar + identity */}
                <div className="flex items-center gap-4 min-w-0">
                  {/* Avatar with ring */}
                  <div className="relative flex-shrink-0">
                    <div className="h-[52px] w-[52px] rounded-2xl bg-white/15 border border-white/25 shadow-[0_0_0_3px_rgba(255,255,255,0.08)] flex items-center justify-center">
                      <span className="text-lg font-extrabold tracking-wide text-white">{initials(viewingAgent.user.name)}</span>
                    </div>
                    {/* Online/status dot */}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#02665e] ${
                      viewingAgent.status === "ACTIVE" ? "bg-emerald-400" :
                      viewingAgent.status === "SUSPENDED" ? "bg-red-400" : "bg-amber-400"
                    }`} aria-hidden />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-white leading-tight truncate">{viewingAgent.user.name || "Agent Details"}</h2>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-[0.14em] ${
                        viewingAgent.status === "ACTIVE" ? "bg-emerald-400/20 text-emerald-200 border border-emerald-300/25" :
                        viewingAgent.status === "SUSPENDED" ? "bg-red-400/20 text-red-200 border border-red-300/25" :
                        "bg-amber-400/20 text-amber-200 border border-amber-300/25"
                      }`}>{viewingAgent.status}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-white/60 truncate">{viewingAgent.user.email || "—"}</div>
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {viewingAgent.status !== "SUSPENDED" ? (
                    <button
                      onClick={() => setSuspendModal({ open: true, agentId: viewingAgent.id, reason: "", step: 1, confirmName: "" })}
                      title="Suspend agent"
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/30 text-white text-xs font-semibold transition-colors border border-red-400/25"
                    >
                      <ShieldOff size={13} />
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => setRestoreModal({ open: true, agentId: viewingAgent.id, notes: "" })}
                      title="Restore agent access"
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-400/20 hover:bg-emerald-400/35 text-white text-xs font-semibold transition-colors border border-emerald-300/30"
                    >
                      <ShieldCheck size={13} />
                      Restore
                    </button>
                  )}
                  <button
                    onClick={closeAgentDetails}
                    aria-label="Close agent details"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-slate-50/60 min-w-0 min-h-0">
              {loadingAgentDetails ? (
                <div className="p-6 text-center">
                  <Loader2 className="h-6 w-6 text-[#02665e] animate-spin mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">Loading agent details...</p>
                </div>
              ) : agentDetailsError ? (
                <div className="p-6 text-center bg-red-50">
                  <AlertCircle className="h-8 w-8 text-red-600 mx-auto mb-3" />
                  <p className="text-red-800 font-medium mb-2">Failed to load agent details</p>
                  <p className="text-red-600 text-sm mb-4">{agentDetailsError}</p>
                  <button
                    onClick={async () => {
                      if (viewingAgent && isValidAgentId(viewingAgent.id)) {
                        setLoadingAgentDetails(true);
                        setAgentDetailsError(null);
                        try {
                          authify();
                          const response = await api.get<Agent>(`/api/admin/agents/${viewingAgent.id}`);
                          const payload = unwrapApiData<Agent>(response.data);
                          setViewingAgent(payload);
                        } catch (err: any) {
                          console.error("Failed to load agent details", err);
                          const errorMessage = err?.response?.data?.error || err?.message || "Failed to load agent details";
                          setAgentDetailsError(errorMessage);
                          showToast("error", "Failed to Load Agent", errorMessage);
                        } finally {
                          setLoadingAgentDetails(false);
                        }
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                    aria-label="Retry loading agent details"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </button>
                </div>
              ) : (
              <div className="p-5 sm:p-6 space-y-5">
                {/* Agent Information - Always Visible */}
                <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                  {/* Section header bar */}
                  <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <User className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Agent Information</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => docsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      aria-label="Review documents"
                      title="Review submitted documents"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Documents
                    </button>
                  </div>

                  <div className="p-5 space-y-5">
                    {/* Identity row */}
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="h-12 w-12 rounded-2xl bg-[#02665e]/10 border border-[#02665e]/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-base font-extrabold text-[#02665e]">{initials(viewingAgent.user.name)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Full Name</div>
                        <div className="mt-0.5 text-base font-bold text-slate-900 truncate">{viewingAgent.user.name || "N/A"}</div>
                        <div className="text-xs text-slate-500 truncate">{viewingAgent.user.email || "—"}</div>
                      </div>
                    </div>

                    {/* Location + Specialization */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2 flex items-center gap-1"><MapPin className="h-3 w-3" />Location</div>
                        {viewingAgent.areasOfOperation && Array.isArray(viewingAgent.areasOfOperation) && viewingAgent.areasOfOperation.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {viewingAgent.areasOfOperation.slice(0, 3).map((area: string, idx: number) => (
                              <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200">
                                <MapPin className="h-3 w-3" />{area}
                              </span>
                            ))}
                            {viewingAgent.areasOfOperation.length > 3 && (
                              <span className="text-xs text-slate-400 px-2 py-1">+{viewingAgent.areasOfOperation.length - 3} more</span>
                            )}
                          </div>
                        ) : <p className="text-sm text-slate-400">N/A</p>}
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2 flex items-center gap-1"><Briefcase className="h-3 w-3" />Specialization</div>
                        {viewingAgent.specializations && Array.isArray(viewingAgent.specializations) && viewingAgent.specializations.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {viewingAgent.specializations.slice(0, 3).map((spec: string, idx: number) => (
                              <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200">
                                <Briefcase className="h-3 w-3" />{spec}
                              </span>
                            ))}
                            {viewingAgent.specializations.length > 3 && (
                              <span className="text-xs text-slate-400 px-2 py-1">+{viewingAgent.specializations.length - 3} more</span>
                            )}
                          </div>
                        ) : <p className="text-sm text-slate-400">N/A</p>}
                      </div>
                    </div>

                    {/* Status / Availability / Workload / Rating grid */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Status</div>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full ${getStatusColor(viewingAgent.status)}`}>
                        {getStatusIcon(viewingAgent.status)}
                        <span>{viewingAgent.status}</span>
                      </span>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Availability</div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full ${
                        viewingAgent.isAvailable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${viewingAgent.isAvailable ? 'bg-emerald-500' : 'bg-red-400'}`} aria-hidden />
                        {viewingAgent.isAvailable ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">Workload</div>
                      <p className="text-sm font-bold text-slate-900">
                        {viewingAgent.currentActiveRequests} <span className="text-slate-400 font-normal">/ {viewingAgent.maxActiveRequests}</span>
                      </p>
                      <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            viewingAgent.currentActiveRequests >= viewingAgent.maxActiveRequests
                              ? "bg-red-500"
                              : viewingAgent.currentActiveRequests >= viewingAgent.maxActiveRequests * 0.8
                              ? "bg-amber-400"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, (viewingAgent.currentActiveRequests / viewingAgent.maxActiveRequests) * 100)}%` }}
                        />
                      </div>
                    </div>
                    {/* Ratings */}
                    <div className="col-span-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3.5">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3 flex items-center gap-1">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        Performance Ratings
                        {viewingAgent.performanceMetrics?.totalReviews > 0 && (
                          <span className="ml-auto text-[10px] font-semibold text-amber-600">({viewingAgent.performanceMetrics.totalReviews} {viewingAgent.performanceMetrics.totalReviews === 1 ? 'review' : 'reviews'})</span>
                        )}
                      </div>
                      {([
                        { label: 'Punctuality', val: viewingAgent.performanceMetrics?.punctualityRating || 0 },
                        { label: 'Customer Care', val: viewingAgent.performanceMetrics?.customerCareRating || 0 },
                        { label: 'Communication', val: viewingAgent.performanceMetrics?.communicationRating || 0 },
                      ] as { label: string; val: number }[]).map(({ label, val }) => (
                        <div key={label} className="flex items-center gap-2 mb-1.5 last:mb-0">
                          <span className="text-[11px] font-semibold text-slate-600 w-28 shrink-0">{label}</span>
                          <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(val / 5) * 100}%` }} />
                          </div>
                          <span className="text-[11px] font-bold text-slate-800 w-8 text-right shrink-0">{val > 0 ? val.toFixed(1) : '—'}</span>
                        </div>
                      ))}
                    </div>
                    </div>
                  </div>
                </div>

                {/* Agent Documents */}
                <div ref={docsRef} className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <GraduationCap className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Agent Documents</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => viewingAgent?.id && loadDocuments(viewingAgent.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      aria-label="Reload agent documents"
                      title="Reload"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reload
                    </button>
                  </div>
                  <div className="p-5">

                  {docsLoading ? (
                    <div className="py-6 text-center text-sm text-gray-500">
                      <Loader2 className="h-5 w-5 text-[#02665e] animate-spin mx-auto mb-2" />
                      Loading documents...
                    </div>
                  ) : docsError ? (
                    <div className="py-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4">
                      {docsError}
                    </div>
                  ) : (
                    <div className="flex gap-4 overflow-x-auto pb-3 snap-x scroll-smooth [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200">
                      {requiredDocTypes.current.map((reqDoc) => {
                        const latest = getLatestDocByType(agentDocuments, reqDoc.type);
                        const status = String(latest?.status || "NOT_UPLOADED").toUpperCase();
                        const _isPending = status === "PENDING";
                        const isApproved = status === "APPROVED";
                        const isRejected = status === "REJECTED";
                        const canPreview = Boolean(latest?.url);
                        const isNotUploaded = !latest?.url;

                        return (
                          <div key={reqDoc.type} className="group shrink-0 w-[260px] snap-start rounded-2xl border border-slate-200 bg-white p-4 flex flex-col transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                            <div className="flex items-start justify-between gap-2 min-w-0">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                                  isApproved ? 'bg-emerald-50 text-emerald-600' :
                                  isRejected ? 'bg-red-50 text-red-500' :
                                  canPreview  ? 'bg-amber-50 text-amber-600' :
                                  'bg-slate-100 text-slate-400'
                                }`} aria-hidden>
                                  {isApproved ? <FileCheck className="h-4.5 w-4.5" /> : isNotUploaded ? <FileX className="h-4.5 w-4.5" /> : <FileText className="h-4.5 w-4.5" />}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-slate-900 leading-snug truncate">{reqDoc.label}</div>
                                  <div className="text-[10px] text-slate-400 font-mono truncate">{reqDoc.type}</div>
                                </div>
                              </div>
                              <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                                isApproved ? 'bg-emerald-100 text-emerald-700' :
                                isRejected ? 'bg-red-100 text-red-600' :
                                canPreview  ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-500'
                              }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${
                                  isApproved ? 'bg-emerald-500' :
                                  isRejected ? 'bg-red-500' :
                                  canPreview  ? 'bg-amber-500' :
                                  'bg-slate-400'
                                }`} />
                                {isApproved ? 'Approved' : isRejected ? 'Rejected' : canPreview ? 'Pending' : 'Missing'}
                              </span>
                            </div>

                            {isRejected && latest?.reason ? (
                              <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {latest.reason}
                              </div>
                            ) : null}

                            <div className="mt-auto flex items-center justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
                              {/* NOT UPLOADED icon only */}
                              {isNotUploaded ? (
                                <span
                                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 bg-gray-50 text-gray-500"
                                  title="Not uploaded"
                                  aria-label={`${reqDoc.label} not uploaded`}
                                >
                                  <FileX className="h-4.5 w-4.5" />
                                </span>
                              ) : null}

                              {/* Uploaded: Eye (preview popup) */}
                              {canPreview ? (
                                <button
                                  type="button"
                                  disabled={docActionLoadingId === latest?.id}
                                  onClick={() => {
                                    if (!latest?.url) return;
                                    setDocPreview({ open: true, url: latest.url, title: reqDoc.label });
                                  }}
                                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  aria-label={`Preview ${reqDoc.label}`}
                                  title="Preview"
                                >
                                  <Eye className="h-4.5 w-4.5" />
                                </button>
                              ) : null}

                              {/* Pending/Rejected: Approve + Reject */}
                              {canPreview && !isApproved ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={!latest?.id || docActionLoadingId === latest.id}
                                    onClick={() => {
                                      if (!viewingAgent?.id || !latest?.id) return;
                                      void updateDocumentStatus(viewingAgent.id, latest.id, "APPROVED");
                                    }}
                                    className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-[#02665e] text-white hover:bg-[#014d47] disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label={`Approve ${reqDoc.label}`}
                                    title="Approve"
                                  >
                                    <Check className="h-4.5 w-4.5" />
                                  </button>

                                  <button
                                    type="button"
                                    disabled={!latest?.id || docActionLoadingId === latest.id}
                                    onClick={() => {
                                      if (!viewingAgent?.id || !latest?.id) return;
                                      void updateDocumentStatus(viewingAgent.id, latest.id, "REJECTED", "");
                                    }}
                                    className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label={`Reject ${reqDoc.label}`}
                                    title="Reject"
                                  >
                                    <X className="h-4.5 w-4.5" />
                                  </button>
                                </>
                              ) : null}

                              {/* Approved: Eye + Unapprove */}
                              {canPreview && isApproved ? (
                                <button
                                  type="button"
                                  disabled={!latest?.id || docActionLoadingId === latest.id}
                                  onClick={() => {
                                    if (!viewingAgent?.id || !latest?.id) return;
                                    const ok = window.confirm("Unapprove this document? It will be marked as rejected.");
                                    if (!ok) return;
                                    void updateDocumentStatus(viewingAgent.id, latest.id, "REJECTED", "");
                                  }}
                                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  aria-label={`Unapprove ${reqDoc.label}`}
                                  title="Unapprove"
                                >
                                  <Undo2 className="h-4.5 w-4.5" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 text-xs text-slate-400">
                    Approving / rejecting is stored server-side. When the agent re-uploads, status resets to <span className="font-semibold text-slate-600">PENDING</span>.
                  </div>
                  </div>
                </div>
                {docPreview.open ? (
                  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Document preview">
                    <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{docPreview.title}</div>
                          <div className="text-xs text-gray-500 truncate">Preview</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={docPreview.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            title="Open in new tab"
                            aria-label="Open in new tab"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open
                          </a>
                          <button
                            type="button"
                            onClick={() => setDocPreview({ open: false, url: "", title: "" })}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                            aria-label="Close preview"
                            title="Close"
                          >
                            <X className="h-4.5 w-4.5" />
                          </button>
                        </div>
                      </div>

                      <div className="h-[75vh] bg-gray-50">
                        {isProbablyImage(docPreview.url) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={docPreview.url} alt="Document preview" className="h-full w-full object-contain" />
                        ) : (
                          <iframe
                            title="Document preview"
                            src={docPreview.url}
                            className="h-full w-full"
                          />
                        )}
                        {isProbablyPdf(docPreview.url) ? null : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Promotion Progress */}
                {viewingAgent.promotionProgress && (
                  <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <Trophy className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Promotion Progress</h3>
                      {viewingAgent.level && (
                        <span className={`ml-auto px-2.5 py-1 text-xs font-bold rounded-full ${
                          viewingAgent.level === 'PLATINUM' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                          viewingAgent.level === 'GOLD' ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
                          viewingAgent.level === 'SILVER' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                          'bg-amber-100 text-amber-700 border border-amber-200'
                        }`}>
                          {viewingAgent.level}
                        </span>
                      )}
                    </div>
                    <div className="p-5">

                    <div className="space-y-4">
                      {/* Overall Progress */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">Overall Progress to Next Level</span>
                          <span className="text-sm font-semibold text-[#02665e]">
                            {viewingAgent.promotionProgress.overallProgress}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div
                            className="bg-gradient-to-r from-[#02665e] to-teal-500 h-3 rounded-full transition-all duration-500"
                            style={{ width: `${viewingAgent.promotionProgress.overallProgress}%` }}
                          />
                        </div>
                      </div>

                      {/* Trips Progress */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-[#02665e]" />
                            <span className="text-sm font-medium text-gray-700">Completed Events</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            {viewingAgent.promotionProgress.currentTrips} / {viewingAgent.promotionProgress.minTrips}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              viewingAgent.promotionProgress.tripsProgress >= 100
                                ? 'bg-green-500'
                                : 'bg-blue-500'
                            }`}
                            style={{ width: `${Math.min(100, viewingAgent.promotionProgress.tripsProgress)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {viewingAgent.promotionProgress.currentTrips >= viewingAgent.promotionProgress.minTrips
                            ? '✓ Event requirement met'
                            : `${viewingAgent.promotionProgress.minTrips - viewingAgent.promotionProgress.currentTrips} more events needed`
                          }
                        </p>
                      </div>

                      {/* Revenue Progress */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-[#02665e]" />
                            <span className="text-sm font-medium text-gray-700">NoLSAF Revenue</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            {viewingAgent.promotionProgress.revenueCurrency || "USD"} {Number(viewingAgent.promotionProgress.currentRevenue).toLocaleString()} / {viewingAgent.promotionProgress.minRevenue.toLocaleString()}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 mb-2">All of this belongs to NoLSAF.</p>
                        <div className="relative w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              viewingAgent.promotionProgress.revenueProgress >= 100
                                ? 'bg-green-500'
                                : 'bg-orange-500'
                            }`}
                            style={{ width: `${Math.min(100, viewingAgent.promotionProgress.revenueProgress)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-xs text-gray-500">
                            {viewingAgent.promotionProgress.currentRevenue >= viewingAgent.promotionProgress.minRevenue
                              ? '✓ Revenue requirement met'
                              : `${viewingAgent.promotionProgress.revenueCurrency || "USD"} ${(viewingAgent.promotionProgress.minRevenue - viewingAgent.promotionProgress.currentRevenue).toLocaleString()} more needed`
                            }
                          </p>
                          <span className={`text-xs font-semibold ${
                            viewingAgent.promotionProgress.revenueProgress >= 100 ? 'text-green-600' : 'text-orange-600'
                          }`}>
                            {Math.round(viewingAgent.promotionProgress.revenueProgress)}% of target
                          </span>
                        </div>
                      </div>

                      {/* Rating Progress */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Star className="h-4 w-4 text-[#02665e]" />
                            <span className="text-sm font-medium text-gray-700">Customer Rating</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            {viewingAgent.promotionProgress.currentRating != null
                              ? `${viewingAgent.promotionProgress.currentRating.toFixed(1)} / ${viewingAgent.promotionProgress.minRating ?? "—"} ★`
                              : "No ratings yet"}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              (viewingAgent.promotionProgress.ratingProgress ?? 0) >= 100 ? "bg-green-500" : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(100, viewingAgent.promotionProgress.ratingProgress ?? 0)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-xs text-gray-500">
                            {viewingAgent.promotionProgress.minRating != null && (viewingAgent.promotionProgress.currentRating ?? 0) >= viewingAgent.promotionProgress.minRating
                              ? "✓ Rating requirement met"
                              : `Needs ${viewingAgent.promotionProgress.minRating ?? "—"}★ average`}
                          </p>
                          <span className={`text-xs font-semibold ${
                            (viewingAgent.promotionProgress.ratingProgress ?? 0) >= 100 ? "text-green-600" : "text-amber-600"
                          }`}>
                            {Math.round(viewingAgent.promotionProgress.ratingProgress ?? 0)}% of target
                          </span>
                        </div>
                      </div>

                      {/* Reviews Progress */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <UsersRound className="h-4 w-4 text-[#02665e]" />
                            <span className="text-sm font-medium text-gray-700">Reviews</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            {viewingAgent.promotionProgress.currentReviews ?? 0} / {viewingAgent.promotionProgress.minReviews ?? "—"}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              (viewingAgent.promotionProgress.reviewsProgress ?? 0) >= 100 ? "bg-green-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${Math.min(100, viewingAgent.promotionProgress.reviewsProgress ?? 0)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-xs text-gray-500">
                            {viewingAgent.promotionProgress.minReviews != null && (viewingAgent.promotionProgress.currentReviews ?? 0) >= viewingAgent.promotionProgress.minReviews
                              ? "✓ Reviews requirement met"
                              : `${Math.max(0, (viewingAgent.promotionProgress.minReviews ?? 0) - (viewingAgent.promotionProgress.currentReviews ?? 0))} more reviews needed`}
                          </p>
                          <span className={`text-xs font-semibold ${
                            (viewingAgent.promotionProgress.reviewsProgress ?? 0) >= 100 ? "text-green-600" : "text-blue-600"
                          }`}>
                            {Math.round(viewingAgent.promotionProgress.reviewsProgress ?? 0)}% of target
                          </span>
                        </div>
                      </div>

                      {/* Promotion Eligibility */}
                      {viewingAgent.promotionProgress.eligibleForPromotion && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            <div>
                              <p className="text-sm font-bold text-emerald-800">Eligible for Promotion!</p>
                              <p className="text-xs text-emerald-700 mt-0.5">This agent has met all requirements for the next level.</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
                )}

                {/* Personal Details & Education - Collapsible */}
                <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPersonalDetailsOpen(!personalDetailsOpen)}
                    className="group w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-slate-50 to-white hover:from-white hover:to-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
                    aria-expanded={personalDetailsOpen}
                    aria-controls="personal-details-panel"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <User className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Personal Details &amp; Education</h3>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
                        personalDetailsOpen ? "rotate-180" : "rotate-0"
                      }`}
                    />
                  </button>
                  {personalDetailsOpen && (
                    <div id="personal-details-panel" className="px-5 pb-5 space-y-5 border-t border-slate-100">
                      {/* Personal Information */}
                      <div className="pt-5">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Personal Information</h4>

                        <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-12 w-12 rounded-full border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0 ring-2 ring-white">
                                {viewingAgent.user.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={viewingAgent.user.avatarUrl} alt="Profile photo" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-sm font-bold text-gray-600">{initials(viewingAgent.user.fullName || viewingAgent.user.name)}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900 truncate">{viewingAgent.user.fullName || viewingAgent.user.name || "N/A"}</div>
                                <div className="text-xs text-gray-500 truncate">{viewingAgent.user.email || ""}</div>
                              </div>
                            </div>
                            <div className="shrink-0">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#02665e]/10 text-[#02665e] border border-[#02665e]/15">
                                User #{viewingAgent.user.id}
                              </span>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">Full Name</label>
                              <p className="text-sm font-semibold text-gray-900 mt-1">{viewingAgent.user.fullName || viewingAgent.user.name || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">Email</label>
                              <p className="text-sm text-gray-900 mt-1 flex items-center gap-1.5">
                                <Mail className="h-3.5 w-3.5 text-gray-400" />
                                <span className="truncate">{viewingAgent.user.email || "N/A"}</span>
                              </p>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">Phone</label>
                              <p className="text-sm text-gray-900 mt-1 flex items-center gap-1.5">
                                <Phone className="h-3.5 w-3.5 text-gray-400" />
                                <span className="truncate">{viewingAgent.user.phone || "N/A"}</span>
                              </p>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">Nationality</label>
                              <p className="text-sm text-gray-900 mt-1">{viewingAgent.user.nationality || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">Region</label>
                              <p className="text-sm text-gray-900 mt-1">{viewingAgent.user.region || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">District</label>
                              <p className="text-sm text-gray-900 mt-1">{viewingAgent.user.district || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                              <label className="block text-[11px] font-semibold text-gray-500 tracking-wide uppercase">Timezone</label>
                              <p className="text-sm text-gray-900 mt-1">{viewingAgent.user.timezone || "N/A"}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Education & Experience */}
                      {(viewingAgent.educationLevel || viewingAgent.yearsOfExperience) && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <GraduationCap className="h-4 w-4 text-[#02665e]" />
                            Education & Experience
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {viewingAgent.educationLevel && (
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5">Education Level</label>
                                <p className="text-sm text-gray-900">{viewingAgent.educationLevel.replace('_', ' ')}</p>
                              </div>
                            )}
                            {viewingAgent.yearsOfExperience !== null && viewingAgent.yearsOfExperience !== undefined && (
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5">Years of Experience</label>
                                <p className="text-sm text-gray-900">{viewingAgent.yearsOfExperience} {viewingAgent.yearsOfExperience === 1 ? 'year' : 'years'}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Bio */}
                      {viewingAgent.bio && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3">Bio</h4>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-md p-3 border border-gray-100">{viewingAgent.bio}</p>
                        </div>
                      )}

                      {/* Areas of Operation / Languages / Specializations (3-column row) */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-[#02665e]" />
                            Areas of Operation
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {Array.isArray(viewingAgent.areasOfOperation) && viewingAgent.areasOfOperation.length > 0 ? (
                              viewingAgent.areasOfOperation.map((area: string, idx: number) => (
                                <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm border border-blue-200">
                                  <MapPin className="h-3 w-3" />
                                  {area}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">N/A</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <Languages className="h-4 w-4 text-[#02665e]" />
                            Languages
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {normalizeStringArray(viewingAgent.languages).length > 0 ? (
                              normalizeStringArray(viewingAgent.languages).map((lang: string, idx: number) => (
                                <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-purple-50 text-purple-700 rounded-lg text-sm border border-purple-200">
                                  <Languages className="h-3 w-3" />
                                  {lang}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">N/A</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <Briefcase className="h-4 w-4 text-[#02665e]" />
                            Specializations
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {Array.isArray(viewingAgent.specializations) && viewingAgent.specializations.length > 0 ? (
                              viewingAgent.specializations.map((spec: string, idx: number) => (
                                <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 rounded-lg text-sm border border-green-200">
                                  <Briefcase className="h-3 w-3" />
                                  {spec}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">N/A</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Certifications */}
                      {viewingAgent.certifications && Array.isArray(viewingAgent.certifications) && viewingAgent.certifications.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <Award className="h-4 w-4 text-[#02665e]" />
                            Certifications
                          </h4>
                          <div className="space-y-2">
                            {viewingAgent.certifications.map((cert: any, idx: number) => (
                              <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                <div className="font-medium text-amber-900">{cert.name}</div>
                                <div className="text-sm text-amber-700">
                                  {cert.issuer} • {cert.year}
                                  {cert.expiryDate && ` • Expires: ${cert.expiryDate}`}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Suspension / Restoration Audit */}
                {(viewingAgent.status === "SUSPENDED" || viewingAgent.suspendedAt || viewingAgent.restoredAt) && (
                  <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-500">
                        <ShieldOff className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Account Audit Trail</h3>
                    </div>
                    <div className="p-5">
                    <div className="space-y-3">
                      {/* Suspension record */}
                      {viewingAgent.suspendedAt && (
                        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                          <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2">Suspension</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">Reason</p>
                              <p className="text-sm font-semibold text-gray-800">{viewingAgent.suspensionReason || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">Date</p>
                              <p className="text-sm text-gray-700">{new Date(viewingAgent.suspendedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">Actioned by</p>
                              <p className="text-sm text-gray-700">{viewingAgent.suspendedBy ? `Admin #${viewingAgent.suspendedBy}` : "—"}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Restoration record */}
                      {viewingAgent.restoredAt && (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2">Reinstatement</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">Date</p>
                              <p className="text-sm text-gray-700">{new Date(viewingAgent.restoredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">Actioned by</p>
                              <p className="text-sm text-gray-700">{viewingAgent.restoredBy ? `Admin #${viewingAgent.restoredBy}` : "—"}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 bg-slate-50/80 px-6 py-3.5 flex items-center justify-between gap-3 flex-shrink-0">
              <p className="text-xs text-slate-400">Agent #{viewingAgent.id}</p>
              <button
                onClick={() => {
                  setViewingAgent(null);
                  setAgentDetailsError(null);
                }}
                aria-label="Close agent details"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#02665e] text-white text-sm font-semibold hover:bg-[#024d47] transition-colors shadow-sm"
              >
                <X size={14} />
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Suspend modal (premium multi-step) ──────────────────────────── */}
      {suspendModal.open && (() => {
        const suspendTarget = agents.find(a => a.id === suspendModal.agentId) ?? viewingAgent;
        const agentName = suspendTarget?.user?.name || suspendTarget?.user?.fullName || "Agent";
        const agentEmail = suspendTarget?.user?.email || "";
        const agentInitials = initials(agentName);
        const nameConfirmed = suspendModal.confirmName.trim().toLowerCase() === agentName.trim().toLowerCase();
        const reasonReady = suspendModal.reason.trim().length >= 10;

        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-gradient-to-br from-slate-950/80 via-red-950/20 to-slate-950/80 backdrop-blur-sm"
              onClick={() => !isSuspending && setSuspendModal({ open: false, agentId: null, reason: "", step: 1, confirmName: "" })}
            />

            <div className="relative w-full max-w-lg">
              {/* Glow ring */}
              <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-red-500/30 via-transparent to-orange-500/20 blur-sm" />

              <div className="relative bg-gradient-to-b from-[#1a0a0a] to-[#0f172a] rounded-3xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.7)] ring-1 ring-white/10 flex flex-col max-h-[90vh]">

                {/* ── TOP ACCENT BAR ── */}
                <div className="h-1 bg-gradient-to-r from-red-600 via-orange-500 to-red-600 flex-shrink-0" />

                {/* ── HEADER ── */}
                <div className="px-6 pt-5 pb-4 flex-shrink-0">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="relative">
                        <div className="h-12 w-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                          <ShieldOff className="text-red-400" size={22} />
                        </div>
                        <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-500 border-2 border-[#1a0a0a] animate-pulse" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-0.5">
                          {suspendModal.step === 1 ? "Step 1 of 2 — Review" : "Step 2 of 2 — Confirm"}
                        </p>
                        <h2 className="text-xl font-bold text-white leading-tight">
                          {suspendModal.step === 1 ? "Suspend Agent Account" : "Confirm Suspension"}
                        </h2>
                      </div>
                    </div>
                    <button
                      onClick={() => setSuspendModal({ open: false, agentId: null, reason: "", step: 1, confirmName: "" })}
                      disabled={isSuspending}
                      className="p-1.5 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors disabled:opacity-30"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Step progress bar */}
                  <div className="mt-5 flex gap-1.5">
                    <div className="h-1 flex-1 rounded-full bg-red-500" />
                    <div className={`h-1 flex-1 rounded-full transition-all duration-500 ${suspendModal.step === 2 ? "bg-red-500" : "bg-white/10"}`} />
                  </div>
                </div>

                {/* ── AGENT CARD ── */}
                <div className="mx-6 mb-4 rounded-2xl bg-white/5 border border-white/10 p-3.5 flex items-center gap-3.5 flex-shrink-0">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500/30 to-orange-500/20 border border-red-400/20 flex items-center justify-center text-sm font-bold text-red-300 flex-shrink-0 select-none">
                    {agentInitials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-sm truncate">{agentName}</div>
                    {agentEmail && <div className="text-xs text-white/40 truncate mt-0.5">{agentEmail}</div>}
                  </div>
                  <div className="flex-shrink-0">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      ACTIVE
                    </span>
                  </div>
                </div>

                {/* ── STEP 1 BODY ── */}
                {suspendModal.step === 1 && (
                  <div className="px-6 pb-6 overflow-y-auto flex-1 min-h-0">
                    {/* Consequences */}
                    <div className="mb-4 rounded-xl bg-amber-500/5 border border-amber-500/15 p-3.5">
                      <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2.5">What happens after suspension</p>
                      <ul className="space-y-1.5">
                        {[
                          ["Portal access blocked", "Agent is locked out immediately."],
                          ["Standard notice sent", "Agent receives a professional suspension email."],
                          ["Assignments paused", "No new requests can be assigned."],
                          ["Restorable any time", "Admin can reinstate access after review."],
                        ].map(([title, desc]) => (
                          <li key={title} className="flex items-start gap-2">
                            <span className="mt-1 h-3 w-3 rounded-full bg-amber-500/20 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
                              <span className="h-1 w-1 rounded-full bg-amber-400" />
                            </span>
                            <span className="text-xs text-white/65 leading-relaxed">
                              <span className="font-semibold text-white/85">{title}</span> — {desc}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Suspension reason picker */}
                    <div className="mb-5">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-xs font-bold text-white/60 uppercase tracking-widest">Select Reason</label>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-700/60 border border-white/8 text-[10px] font-medium text-white/40">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          Internal only
                        </span>
                      </div>
                      <div className="space-y-2">
                        {([
                          { id: "Policy Violation", desc: "Breach of platform rules, terms of service, or operational guidelines." },
                          { id: "Code of Conduct Breach", desc: "Misconduct, harassment, or inappropriate behaviour toward clients or staff." },
                          { id: "Fraudulent Activity", desc: "Suspected fraud, misrepresentation, or deliberate abuse of the system." },
                        ] as { id: string; desc: string }[]).map((opt) => {
                          const selected = suspendModal.reason === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSuspendModal((s) => ({ ...s, reason: opt.id }))}
                              disabled={isSuspending}
                              className={`w-full text-left rounded-xl border px-4 py-3 flex items-start gap-3 transition-all cursor-pointer disabled:opacity-50 ${
                                selected
                                  ? "border-red-500/40 bg-red-500/8"
                                  : "border-white/10 bg-transparent hover:border-white/20 hover:bg-white/[0.04]"
                              }`}
                            >
                              <span className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                                selected ? "border-red-400 bg-red-500/20" : "border-white/20"
                              }`}>
                                {selected && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
                              </span>
                              <span>
                                <span className={`block text-sm font-semibold leading-tight ${
                                  selected ? "text-white" : "text-white/70"
                                }`}>{opt.id}</span>
                                <span className="block text-xs text-white/35 leading-relaxed mt-0.5">{opt.desc}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                      <button
                        onClick={() => setSuspendModal({ open: false, agentId: null, reason: "", step: 1, confirmName: "" })}
                        disabled={isSuspending}
                        className="flex-1 py-3 rounded-xl bg-transparent border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 hover:text-white/80 transition-all disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => setSuspendModal((s) => ({ ...s, step: 2 }))}
                        disabled={!reasonReady}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-semibold hover:from-red-500 hover:to-red-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-red-900/30"
                      >
                        Continue
                        <span className="text-xs opacity-70">→</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* ── STEP 2 BODY ── */}
                {suspendModal.step === 2 && (
                  <div className="px-6 pb-6 overflow-y-auto flex-1 min-h-0">
                    {/* Internal note recap */}
                    <div className="mb-4 rounded-xl bg-white/4 border border-white/8 px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest">Suspension Reason</p>
                        <span className="text-[10px] text-white/25 font-medium">— internal record only</span>
                      </div>
                      <p className="text-sm text-white/65 leading-relaxed">{suspendModal.reason.trim()}</p>
                    </div>

                    {/* Name confirmation */}
                    <div className="mb-3">
                      <p className="text-xs text-white/35 mb-2">
                        Type <span className="text-white/70 font-semibold">{agentName}</span> to confirm.
                      </p>
                      <div className="relative inline-flex w-auto max-w-[220px]">
                        <input
                          type="text"
                          autoFocus
                          placeholder={agentName}
                          value={suspendModal.confirmName}
                          onChange={(e) => setSuspendModal((s) => ({ ...s, confirmName: e.target.value }))}
                          disabled={isSuspending}
                          className={`w-full rounded-xl bg-white/5 border px-3 py-2 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:ring-2 transition-all disabled:opacity-50 pr-9 ${
                            suspendModal.confirmName === ""
                              ? "border-white/10 focus:border-red-500/40 focus:ring-red-500/15"
                              : nameConfirmed
                              ? "border-emerald-500/40 bg-emerald-500/5 focus:ring-emerald-500/15"
                              : "border-red-500/30 bg-red-500/5 focus:ring-red-500/15"
                          }`}
                        />
                        {suspendModal.confirmName !== "" && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {nameConfirmed ? (
                              <div className="h-6 w-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                                <Check size={12} className="text-emerald-400" />
                              </div>
                            ) : (
                              <div className="h-6 w-6 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
                                <X size={12} className="text-red-400" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {suspendModal.confirmName !== "" && !nameConfirmed && (
                        <p className="mt-1.5 text-xs text-red-400">Name does not match — check capitalisation</p>
                      )}
                    </div>

                    {/* Final warning callout */}
                    {nameConfirmed && (
                      <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 flex items-start gap-3">
                        <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-red-300/80 leading-relaxed">
                          You are about to suspend <span className="font-bold text-red-300">{agentName}</span>.
                          This action will immediately lock their portal access and send them an official email notification.
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                      <button
                        onClick={() => setSuspendModal((s) => ({ ...s, step: 1, confirmName: "" }))}
                        disabled={isSuspending}
                        className="flex-1 py-3 rounded-xl bg-transparent border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 hover:text-white/80 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        <span className="text-xs opacity-60">←</span> Back
                      </button>
                      <button
                        onClick={handleSuspendConfirmed}
                        disabled={isSuspending || !nameConfirmed}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-red-700 to-red-600 text-white text-sm font-bold hover:from-red-600 hover:to-red-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xl shadow-red-900/40"
                      >
                        {isSuspending ? (
                          <><Loader2 size={15} className="animate-spin" /> Suspending…</>
                        ) : (
                          <><ShieldOff size={15} /> Suspend Account</>
                        )}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Restore modal ───────────────────────────────────── */}
      {restoreModal.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-950/80 via-emerald-950/20 to-slate-950/80 backdrop-blur-sm"
            onClick={() => !isRestoring && setRestoreModal({ open: false, agentId: null, notes: "" })}
          />
          <div className="relative w-full max-w-xs">
            {/* Glow ring */}
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-emerald-500/25 via-transparent to-teal-500/15 blur-sm" />
            <div className="relative bg-gradient-to-b from-[#071a14] to-[#0f172a] rounded-3xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.7)] ring-1 ring-white/10 flex flex-col max-h-[90vh]">

              {/* Top accent */}
              <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 flex-shrink-0" />

              {/* Header */}
              <div className="px-5 pt-4 pb-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="text-emerald-400" size={17} />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest mb-0.5">Reinstate Access</p>
                    <h2 className="text-base font-bold text-white leading-tight">Restore Agent</h2>
                  </div>
                </div>
                <button
                  onClick={() => setRestoreModal({ open: false, agentId: null, notes: "" })}
                  disabled={isRestoring}
                  className="p-1.5 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors disabled:opacity-30"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Body */}
              <div className="px-5 pb-5 overflow-y-auto flex-1 min-h-0">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Select reason</p>
                <div className="space-y-1.5">
                  {([
                    { id: "Issue Resolved", desc: "Violation addressed and verified." },
                    { id: "Successful Appeal", desc: "Suspension found to be unwarranted." },
                    { id: "Reinstatement Approved", desc: "Approved after formal review." },
                  ] as { id: string; desc: string }[]).map((opt) => {
                    const selected = restoreModal.notes === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRestoreModal((s) => ({ ...s, notes: opt.id }))}
                        disabled={isRestoring}
                        className={`w-full text-left rounded-xl border px-3.5 py-2.5 flex items-center gap-3 transition-all cursor-pointer disabled:opacity-50 ${
                          selected
                            ? "border-emerald-500/40 bg-emerald-500/8"
                            : "border-white/10 bg-transparent hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        <span className={`h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                          selected ? "border-emerald-400 bg-emerald-500/20" : "border-white/20"
                        }`}>
                          {selected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                        </span>
                        <span>
                          <span className={`block text-sm font-semibold leading-tight ${selected ? "text-white" : "text-white/70"}`}>{opt.id}</span>
                          <span className="block text-[11px] text-white/35 mt-0.5">{opt.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2.5 mt-4">
                  <button
                    onClick={() => setRestoreModal({ open: false, agentId: null, notes: "" })}
                    disabled={isRestoring}
                    className="flex-1 py-2.5 rounded-xl bg-transparent border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 hover:text-white/80 transition-all disabled:opacity-40"
                  >Cancel</button>
                  <button
                    onClick={handleRestoreConfirmed}
                    disabled={isRestoring || !restoreModal.notes}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:from-emerald-500 hover:to-teal-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
                  >
                    {isRestoring ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                    {isRestoring ? "Reinstating…" : "Restore"}
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

