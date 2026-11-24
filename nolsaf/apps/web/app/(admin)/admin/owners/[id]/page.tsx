"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import apiClient, { clearAuthToken } from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import AdminRecordGate from "@/components/admin/AdminRecordGate";
import { adminRefOrId, useAdminHref } from "@/lib/adminRecordRefs";
import { BadgeCheck as BadgeCheckIcon, AlertTriangle, ArrowLeft, User, Building2, FileText, DollarSign, Mail, Phone, Calendar, CheckCircle2, XCircle, Clock, Eye, Shield, Ban, Copy, MapPin, ImageIcon, Bell, Send, X, History, Activity, Home, Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, FileX, RefreshCw, Check, ExternalLink, Radar, Wallet, Handshake, Briefcase, Users, Printer } from "lucide-react";
import VerifiedIcon from "@/components/VerifiedIcon";
import OwnerLongStayCard from "@/components/admin/owners/OwnerLongStayCard";
import OwnerAccountActivity from "@/components/admin/owners/OwnerAccountActivity";
import OwnerNotes from "@/components/admin/owners/OwnerNotes";
import TableRow from "@/components/TableRow";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Owner = {
  id:number; name:string|null; email:string; phone:string|null;
  suspendedAt:string|null; kycStatus:string|null; createdAt:string;
  profile?: any;
  _count: { properties:number; adminNotesReceived?: number };
};

type Snapshot = {
  invoicesCount: number;
  revenue: { netSum:number; grossSum:number; commissionSum:number; paidCount:number };
  /** NRMS pay-as-you-go billing across every property this owner runs. */
  nrmsBilling?: {
    collected:number; paymentsCount:number;
    billed:number; statementsCount:number;
    outstanding:number; outstandingCount:number;
    unbilledUsage:number; accountsCount:number;
    currency:string;
  } | null;
};

type Partners = {
  merchants: {
    id:number; name:string|null; legalName:string|null;
    registrationNumber:string|null; tin:string|null; country:string|null;
    status:string; since:string|null; registeredAt:string|null;
    propertyCount:number; properties:string[];
  }[];
  merchantCount:number;
  /** Unnamed draft companies excluded from the list above. */
  hiddenDraftCount:number;
  hiddenDraftProperties:number;
  agents: {
    id:number; name:string|null; legalName:string|null;
    status:string; verificationStatus:string;
    since:string|null; propertyCount:number;
  }[];
  agentCount:number;
  activeAgentCount:number;
};

type Capabilities = {
  nrms: {
    active: boolean;
    activatedAt: string | null;
    activeProperties: number;
    totalProperties: number;
  };
  payments: {
    active: boolean;
    activatedAt: string | null;
    /** Furthest onboarding stage reached, so "not active" is distinguishable
     *  from "never started". */
    stage: string | null;
    merchantName: string | null;
    providerName: string | null;
  };
};

type Doc = { id:number; type:string; url:string; status:string; reason?:string|null; createdAt:string; metadata?: any | null };

const REQUIRED_OWNER_DOCS = [
  { type: "BUSINESS_LICENCE", label: "Business Licence (Valid)" },
  { type: "TIN_CERTIFICATE", label: "TIN Number Certificate" },
] as const;

// ── Tunables ────────────────────────────────────────────────────────────────
// Everything the page used to spell out inline lives here, so a change is made
// in one place rather than hunted through the JSX.

/** Money of record. The API returns the currency it used; this is the fallback
 *  for figures that predate that field. */
const DEFAULT_CURRENCY = "TZS";
const TOAST_DURATION_MS = 3000;
const BOOKINGS_PAGE_SIZE = 25;
const PROPERTIES_PAGE_SIZE = 100;
/** Only used when neither NEXT_PUBLIC_SOCKET_URL nor NEXT_PUBLIC_API_URL is set. */
const FALLBACK_SOCKET_URL = "http://127.0.0.1:4000";

type TabKey = "overview" | "properties" | "documents" | "bookings" | "activity" | "notes";

const OWNER_TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "properties", label: "Properties" },
  { key: "documents", label: "Documents" },
  { key: "bookings", label: "Bookings" },
  { key: "activity", label: "Account activity" },
  { key: "notes", label: "Notes" },
];

/** Booking status filter chips. Tone encodes what the status means, so the
 *  chips stay readable without six copy-pasted button blocks. */
const BOOKING_STATUS_FILTERS: { value: string; label: string; on: string; off: string }[] = [
  { value: "", label: "All", on: "bg-brand text-white shadow-md", off: "bg-gray-100 text-gray-700 hover:bg-gray-200" },
  { value: "NEW", label: "New", on: "bg-amber-600 text-white shadow-md", off: "bg-amber-50 text-amber-700 hover:bg-amber-100" },
  { value: "CONFIRMED", label: "Confirmed", on: "bg-emerald-600 text-white shadow-md", off: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" },
  { value: "CHECKED_IN", label: "Check-in", on: "bg-blue-600 text-white shadow-md", off: "bg-blue-50 text-blue-700 hover:bg-blue-100" },
  { value: "CHECKED_OUT", label: "Check-out", on: "bg-gray-600 text-white shadow-md", off: "bg-gray-50 text-gray-700 hover:bg-gray-100" },
  { value: "CANCELED", label: "Canceled", on: "bg-red-600 text-white shadow-md", off: "bg-red-50 text-red-700 hover:bg-red-100" },
];

function getLatestDocByType(docs: Doc[], type: string): Doc | null {
  const normalizedType = String(type).toUpperCase();
  for (const d of docs) {
    if (String(d?.type ?? "").toUpperCase() === normalizedType) return d;
  }
  return null;
}

type Property = {
  id: number;
  title: string;
  status: string;
  type: string;
  regionName: string | null;
  district: string | null;
  ward: string | null;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  totalBedrooms: number;
  totalBathrooms: number;
  maxGuests: number;
};

export default function OwnerDetailPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  return (
    <AdminRecordGate kind="owner" param={routeParams?.id} backHref="/admin/owners">
      {(ownerId) => <OwnerDetail key={ownerId} ownerId={ownerId} />}
    </AdminRecordGate>
  );
}

function OwnerDetail({ ownerId }: { ownerId: number }) {
  const recordHref = useAdminHref();
  const searchParams = useSearchParams();
  const activityCategory = searchParams?.get("category");
  const tabParam = searchParams?.get("tab");
  const tab = OWNER_TABS.find(({ key }) => key === tabParam)?.key ?? "overview";
  const [owner, setOwner] = useState<Owner|null>(null);
  const [snap, setSnap] = useState<Snapshot|null>(null);
  const [caps, setCaps] = useState<Capabilities|null>(null);
  const [partners, setPartners] = useState<Partners|null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  function selectTab(next: TabKey) {
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    if (next !== "activity") url.searchParams.delete("category");
    window.history.replaceState(null, "", url);
  }
  const [noteDraft, setNoteDraft] = useState("");
  const updateNotesCount = useCallback((total: number) => {
    setOwner((current) => current ? { ...current, _count: { ...current._count, adminNotesReceived: total } } : current);
  }, []);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [notifyOwner, setNotifyOwner] = useState(true);
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [notificationSubject, setNotificationSubject] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [showImpersonateForm, setShowImpersonateForm] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [bookings, setBookings] = useState<any[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsPage, setBookingsPage] = useState(1);
  const [bookingsTotal, setBookingsTotal] = useState(0);
  const [bookingsStatus, setBookingsStatus] = useState<string>("");
  const [bookingsSearch, setBookingsSearch] = useState<string>("");
  const [bookingsSortBy, setBookingsSortBy] = useState<string | null>(null);
  const [bookingsSortDir, setBookingsSortDir] = useState<"asc" | "desc">("desc");

  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [kycModal, setKycModal] = useState<{ mode: "approve" | "reject"; note: string; stage: "input" | "confirm" } | null>(null);
  /** Rejecting a document used to call the browser's native prompt(). It now
   *  uses the same modal language as every other decision on this page. */
  const [docRejectModal, setDocRejectModal] = useState<{ docId: number; label: string; reason: string } | null>(null);

  const showToast = useCallback((tone: "success" | "error", message: string) => {
    setToast({ tone, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);


  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get<{ owner:Owner; snapshot:Snapshot; capabilities?:Capabilities|null; partners?:Partners|null }>(`/api/admin/owners/${ownerId}`);
      setOwner(r.data.owner);
      setSnap(r.data.snapshot);
      setCaps(r.data.capabilities ?? null);
      setPartners(r.data.partners ?? null);
    } catch (err: any) {
      console.error('Failed to load owner:', err);
      console.error('Error details:', {
        message: err?.message,
        response: err?.response?.data,
        status: err?.response?.status,
        url: err?.config?.url,
      });
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  const loadDocs = useCallback(async () => {
    try {
      const r = await api.get<{ items:Doc[] }>(`/api/admin/owners/${ownerId}/documents`);
    setDocs(r.data.items);
    } catch (err: any) {
      console.error('Failed to load documents:', err);
      setDocs([]);
    }
  }, [ownerId]);

  const loadAuditHistory = useCallback(async () => {
    try {
      setAuditLoading(true);
      // API shape (admin.audits): { ok: true, data: { page, total, items: [...] } }
      const r = await api.get<any>(`/api/admin/audits?targetId=${ownerId}`);
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
    } catch (err: any) {
      console.error("Failed to load audit history:", err);
      setAuditHistory([]);
    } finally {
      setAuditLoading(false);
    }
  }, [ownerId]);

  /** Bookings load lazily, so the tab badge stays blank until we actually know
   *  the number rather than implying zero. */
  const [bookingsSeen, setBookingsSeen] = useState(false);

  async function loadBookings() {
    try {
      setBookingsLoading(true);
      const params: any = {
        ownerId,
        page: bookingsPage,
        pageSize: BOOKINGS_PAGE_SIZE,
      };
      if (bookingsStatus) params.status = bookingsStatus;
      if (bookingsSearch) params.q = bookingsSearch;
      if (bookingsSortBy) {
        params.sortBy = bookingsSortBy;
        params.sortDir = bookingsSortDir;
      }
      const r = await api.get<{ items: any[]; total: number }>("/api/admin/bookings", { params });
      setBookings(r.data.items || []);
      setBookingsTotal(r.data.total || 0);
    } catch (err: any) {
      console.error("Failed to load bookings:", err);
      setBookings([]);
      setBookingsTotal(0);
    } finally {
      setBookingsLoading(false);
      setBookingsSeen(true);
    }
  }

  async function loadProperties(){
    try {
      setPropertiesLoading(true);
      const r = await api.get<{ items: any[]; total: number }>(`/api/admin/properties`, {
        params: { ownerId, page: 1, pageSize: PROPERTIES_PAGE_SIZE }
      });
      
      // Transform properties to match our Property type
      const transformed = r.data.items.map((p: any) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        type: p.type,
        regionName: p.regionName,
        district: p.district,
        ward: p.ward,
        primaryImage: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : 
                     (p.images && Array.isArray(p.images) && p.images.length > 0 ? p.images[0].url : null),
        basePrice: p.basePrice || null,
        currency: p.currency || DEFAULT_CURRENCY,
        totalBedrooms: p.totalBedrooms || 0,
        totalBathrooms: p.totalBathrooms || 0,
        maxGuests: p.maxGuests || 0,
      }));
      
      setProperties(transformed);
    } catch (err: any) {
      console.error('Failed to load properties:', err);
      setProperties([]);
    } finally {
      setPropertiesLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadDocs();
    void loadAuditHistory();
  }, [load, loadAuditHistory, loadDocs]);

  // Load properties when properties tab is active
  useEffect(() => {
    if (tab === "properties" && properties.length === 0 && !propertiesLoading) {
      loadProperties();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Load bookings when bookings tab is active
  useEffect(() => {
    if (tab === "bookings") {
      loadBookings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, bookingsPage, bookingsStatus, bookingsSearch, bookingsSortBy, bookingsSortDir]);

  // Reset bookings page when filters change
  useEffect(() => {
    if (tab === "bookings") {
      setBookingsPage(1);
    }
  }, [bookingsStatus, bookingsSearch, tab]);

  // live updates
  useEffect(()=>{
    // Use direct API URL for Socket.IO in browser to ensure WebSocket works in dev
    const url = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || FALLBACK_SOCKET_URL)
      : (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "");
    const s: Socket = io(url, { transports: ["websocket"] });
    const refresh = ()=>{ load(); loadDocs(); loadAuditHistory(); };
    s.on("admin:owner:updated", (p:any)=>{ if(p?.ownerId===ownerId) refresh(); });
    s.on("admin:kyc:updated", (p:any)=>{ if(p?.ownerId===ownerId) refresh(); });
    return ()=>{ s.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ownerId]);

  function getKycStatusBadge(status: string | null) {
    const statusLower = status?.toLowerCase() || '';
    if (statusLower === 'approved_kyc') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Approved KYC
        </span>
      );
    }
    if (statusLower === 'pending_kyc') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium">
          <Clock className="h-4 w-4" />
          Pending KYC
        </span>
      );
    }
    if (statusLower === 'rejected_kyc') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-100 text-red-800 text-sm font-medium">
          <XCircle className="h-4 w-4" />
          Rejected KYC
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 text-gray-800 text-sm font-medium">
        {status || 'Not Set'}
      </span>
    );
  }

  function getAccountStatusBadge(isSuspended: boolean) {
    if (isSuspended) {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-100 text-red-800 text-sm font-medium">
          <Ban className="h-4 w-4" />
          Suspended
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-800 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4" />
        Active
      </span>
    );
  }

  const auditItems = Array.isArray(auditHistory) ? auditHistory : [];

  async function handleSuspendSubmit(){
    if (!suspendReason.trim()) {
      showToast("error", "Please provide a reason for suspension. This notification will be sent to the owner.");
      return;
    }
    
    setActionLoading(true);
    try {
      await api.post(`/api/admin/owners/${ownerId}/suspend`, { 
        reason: suspendReason.trim(),
        notifyOwner: notifyOwner 
      });
      setSuspendReason("");
      setShowSuspendForm(false);
      await load();
      showToast("success", "Owner has been suspended successfully.");
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || "Failed to suspend owner");
    } finally {
      setActionLoading(false);
    }
  }
  
  function handleSuspendClick(){
    setShowSuspendForm(true);
    setSuspendReason("");
  }
  
  function cancelSuspend(){
    setShowSuspendForm(false);
    setSuspendReason("");
  }
  async function unsuspend(){
    setActionLoading(true);
    try {
      await api.post(`/api/admin/owners/${ownerId}/unsuspend`);
      await load();
      showToast("success", "Owner has been unsuspended.");
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || "Failed to unsuspend owner");
    } finally {
      setActionLoading(false);
    }
  }
  function kycApprove() {
    setKycModal({ mode: "approve", note: "", stage: "input" });
  }
  function kycReject() {
    setKycModal({ mode: "reject", note: "", stage: "input" });
  }
  function advanceKycToConfirm() {
    if (!kycModal) return;
    if (kycModal.mode === "reject" && !kycModal.note.trim()) {
      showToast("error", "Please provide a reason for rejection.");
      return;
    }
    setKycModal(m => m ? { ...m, stage: "confirm" } : m);
  }
  async function submitKycModal() {
    if (!kycModal) return;
    if (kycModal.mode === "reject" && !kycModal.note.trim()) {
      showToast("error", "Please provide a reason for rejection.");
      return;
    }
    setActionLoading(true);
    try {
      if (kycModal.mode === "approve") {
        await api.post(`/api/admin/owners/${ownerId}/kyc/approve`, { note: kycModal.note.trim() || "KYC approved by admin" });
        showToast("success", "KYC approved successfully.");
      } else {
        await api.post(`/api/admin/owners/${ownerId}/kyc/reject`, { reason: kycModal.note.trim() });
        showToast("success", "KYC rejected.");
      }
      setKycModal(null);
      await load();
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || `Failed to ${kycModal.mode === "approve" ? "approve" : "reject"} KYC`);
    } finally {
      setActionLoading(false);
    }
  }
  function handleImpersonateClick(){
    setShowImpersonateForm(true);
    setImpersonateReason("");
  }
  
  function cancelImpersonate(){
    setShowImpersonateForm(false);
    setImpersonateReason("");
  }
  
  async function confirmImpersonate(){
    if (impersonateReason.trim().length < 10) {
      showToast("error", "Please provide a reason of at least 10 characters. This action will be logged.");
      return;
    }
    
    setActionLoading(true);
    try {
      const r = await api.post<{ok:boolean; redirectTo:string; expiresIn:number}>(`/api/admin/owners/${ownerId}/impersonate`, {
        reason: impersonateReason.trim()
      });
      if (!r.data.ok || r.data.redirectTo !== "/owner") throw new Error("Support session was not started");
      clearAuthToken();
      window.location.assign(r.data.redirectTo);
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || "Could not start the support session.");
    } finally {
      setActionLoading(false);
    }
  }
  
  async function sendNotification(){
    if (!notificationSubject.trim() || !notificationMessage.trim()) {
      showToast("error", "Please provide both subject and message for the notification.");
      return;
    }
    
    setActionLoading(true);
    try {
      await api.post(`/api/admin/owners/${ownerId}/notify`, { 
        subject: notificationSubject.trim(),
        message: notificationMessage.trim()
      });
      setNotificationSubject("");
      setNotificationMessage("");
      setShowNotificationForm(false);
      showToast("success", "Notification sent successfully to the owner.");
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || "Failed to send notification");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
  return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-solid border-gray-300 border-t-brand"></div>
        </div>
      </div>
    );
  }

  if (!owner || !snap) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6">
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">Owner not found</p>
          <Link href="/admin/owners" className="text-brand hover:text-brand/90 underline">
            ← Back to owners
          </Link>
        </div>
      </div>
    );
  }

  // Badge numbers for the tab bar. null means "not known yet", which stays
  // blank rather than showing a zero the page has not actually verified.
  const tabCounts: Record<TabKey, number | null> = {
    overview: null,
    properties: owner._count.properties,
    documents: docs.length,
    bookings: bookingsSeen ? bookingsTotal : null,
    activity: null,
    notes: owner._count.adminNotesReceived ?? null,
  };

  return (
    <div id="owner-record" className="w-full min-w-0 space-y-4">
      <style>{`#owner-record, #owner-record * { box-sizing: border-box; }`}</style>
      {toast ? (
        <div className="fixed top-4 right-4 z-50">
          <div
            className={
              "min-w-[280px] max-w-[420px] rounded-2xl border shadow-xl px-4 py-3 backdrop-blur bg-white/95 transition-all duration-200 " +
              (toast.tone === "success" ? "border-emerald-200" : "border-red-200")
            }
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <div
                className={
                  "mt-0.5 h-9 w-9 rounded-xl flex items-center justify-center " +
                  (toast.tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
                }
              >
                {toast.tone === "success" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{toast.tone === "success" ? "Success" : "Error"}</div>
                <div className="text-sm text-gray-700 mt-0.5 break-words">{toast.message}</div>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="ml-auto inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                aria-label="Close notification"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Document rejection modal */}
      {docRejectModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => (actionLoading ? null : setDocRejectModal(null))}
            aria-hidden
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-red-50 shadow-[inset_0_-1px_0_0_#f3f4f6]">
              <div className="text-sm font-semibold text-red-800">Reject document</div>
              <div className="mt-0.5 text-xs text-red-700">{docRejectModal.label}</div>
            </div>
            <div className="px-5 py-4">
              <label htmlFor="doc-reject-reason" className="block text-xs font-medium text-gray-700 mb-1.5">
                Reason for rejection
              </label>
              <textarea
                id="doc-reject-reason"
                autoFocus
                value={docRejectModal.reason}
                onChange={(e) => setDocRejectModal((m) => (m ? { ...m, reason: e.target.value } : m))}
                placeholder="Tell the owner what is wrong so they can fix it."
                className="w-full min-h-[96px] box-border rounded-xl border-2 border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500 resize-none transition"
              />
              <p className="mt-2 text-xs text-gray-500">The owner sees this reason and can re-upload.</p>
            </div>
            <div className="px-5 py-3.5 flex items-center justify-end gap-2 shadow-[inset_0_1px_0_0_#f3f4f6] bg-gray-50">
              <button
                type="button"
                onClick={() => setDocRejectModal(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !docRejectModal.reason.trim()}
                onClick={async () => {
                  const { docId, reason } = docRejectModal;
                  setActionLoading(true);
                  await docReject(
                    ownerId,
                    docId,
                    reason,
                    () => {
                      showToast("success", "Document rejected.");
                      void loadDocs();
                    },
                    (msg) => showToast("error", msg),
                  );
                  setActionLoading(false);
                  setDocRejectModal(null);
                }}
                className="px-4 py-2 rounded-xl border-0 bg-red-600 text-sm font-semibold text-white hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? "Rejecting..." : "Reject document"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* KYC approve / reject modal */}
      {kycModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setKycModal(null); }}
        >
          <div className="w-full max-w-[400px] rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 overflow-hidden flex flex-col" style={{ maxHeight: "min(92vh, 640px)" }}>
            {/* Header */}
            <div className={"px-5 py-4 flex items-center justify-between gap-3 shadow-[inset_0_-1px_0_0_#f3f4f6] " + (kycModal.mode === "approve" ? "bg-emerald-50" : "bg-red-50")}>
              <div className="flex items-center gap-3">
                <div className={"h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 " + (kycModal.mode === "approve" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                  {kycModal.mode === "approve" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    KYC Review · {kycModal.stage === "input" ? "Step 1 of 2" : "Step 2 of 2"}
                  </div>
                  <div className="text-sm font-bold text-gray-900">
                    {kycModal.stage === "input"
                      ? (kycModal.mode === "approve" ? "Approve KYC" : "Reject KYC")
                      : "Confirm your decision"}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setKycModal(null)}
                className="h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition"
                aria-label="Close">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            {kycModal.stage === "input" ? (
              <>
                {/* Body — input stage */}
                <div className="px-5 py-4 space-y-3">
                  <div className="text-sm text-gray-600 leading-relaxed">
                    {kycModal.mode === "approve"
                      ? <>You are approving KYC for <span className="font-semibold text-gray-900">{owner.name ?? `Owner #${owner.id}`}</span>. Add an optional note below.</>
                      : <>You are rejecting KYC for <span className="font-semibold text-gray-900">{owner.name ?? `Owner #${owner.id}`}</span>. A reason is required and will be shared with the owner.</>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      {kycModal.mode === "approve" ? "Note (optional)" : "Rejection reason (required)"}
                    </label>
                    <textarea
                      autoFocus
                      rows={2}
                      value={kycModal.note}
                      onChange={e => setKycModal(m => m ? { ...m, note: e.target.value } : m)}
                      placeholder={kycModal.mode === "approve" ? "e.g. All documents verified successfully." : "e.g. ID document is expired or unclear."}
                      className="w-full box-border rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-brand resize-none transition"
                    />
                  </div>
                </div>
                {/* Footer — input stage */}
                <div className="px-5 py-3.5 flex items-center justify-end gap-2 shadow-[inset_0_1px_0_0_#f3f4f6] bg-gray-50">
                  <button type="button" onClick={() => setKycModal(null)}
                    className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
                    Cancel
                  </button>
                  <button type="button" onClick={advanceKycToConfirm}
                    className={"px-5 py-2 rounded-xl text-sm font-semibold text-white transition flex items-center gap-2 " +
                      (kycModal.mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700")}>
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Body — confirm stage */}
                <div className="px-5 py-4 space-y-3">
                  <div className={"rounded-xl border px-4 py-3 " + (kycModal.mode === "approve" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
                    <div className={"text-xs font-bold uppercase tracking-wider mb-1 " + (kycModal.mode === "approve" ? "text-emerald-700" : "text-red-700")}>
                      {kycModal.mode === "approve" ? "⚠ You are about to approve KYC" : "⚠ You are about to reject KYC"}
                    </div>
                    <div className="text-sm text-gray-800 leading-relaxed">
                      Are you sure you want to <span className="font-bold">{kycModal.mode === "approve" ? "approve" : "reject"}</span> KYC for{" "}
                      <span className="font-bold">{owner.name ?? `Owner #${owner.id}`}</span>? This action will be logged and the owner will be notified.
                    </div>
                  </div>
                  {kycModal.note.trim() ? (
                    <div className="rounded-xl ring-1 ring-gray-200 bg-gray-50 px-3.5 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                        {kycModal.mode === "approve" ? "Note" : "Rejection reason"}
                      </div>
                      <div className="text-sm text-gray-800 leading-relaxed">{kycModal.note.trim()}</div>
                    </div>
                  ) : null}
                </div>
                {/* Footer — confirm stage */}
                <div className="px-5 py-3.5 flex items-center justify-between gap-2 shadow-[inset_0_1px_0_0_#f3f4f6] bg-gray-50">
                  <button type="button" onClick={() => setKycModal(m => m ? { ...m, stage: "input" } : m)}
                    className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition flex items-center gap-1.5">
                    ← Back
                  </button>
                  <button type="button" onClick={submitKycModal} disabled={actionLoading}
                    className={"px-5 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 " +
                      (kycModal.mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700")}>
                    {actionLoading
                      ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Processing…</>
                      : kycModal.mode === "approve" ? "Yes, approve KYC" : "Yes, reject KYC"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Header: who this is, their standing, and what they have switched on */}
      <header className="rounded-lg border border-solid border-[#12342f] bg-[#0b2420] text-white">
        <div className="flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link href="/admin/owners" title="Back to owners" aria-label="Back to owners"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-white/15 bg-white/[0.04] text-white/80 no-underline hover:bg-white/10 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-white/10 text-base font-bold text-white">
              {String(owner.name || owner.email || "?").trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Owner</p>
              <h1 className="m-0 mt-0.5 truncate text-xl font-bold tracking-tight text-white sm:text-2xl">{owner.name ?? "Name not set"}</h1>
              <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/60">
                {owner.email ? <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{owner.email}</span></span> : null}
                {owner.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{owner.phone}</span> : null}
                <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />Joined {fmtDay(owner.createdAt)}</span>
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold ${owner.kycStatus === "APPROVED_KYC" ? "bg-emerald-400/15 text-emerald-200" : owner.kycStatus === "REJECTED_KYC" ? "bg-red-400/15 text-red-200" : owner.kycStatus === "PENDING_KYC" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-white/70"}`}>
                  <Shield className="h-3.5 w-3.5" />
                  {owner.kycStatus === "APPROVED_KYC" ? "KYC approved" : owner.kycStatus === "REJECTED_KYC" ? "KYC rejected" : owner.kycStatus === "PENDING_KYC" ? "KYC pending" : "KYC not submitted"}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold ${owner.suspendedAt ? "bg-red-400/15 text-red-200" : "bg-emerald-400/15 text-emerald-200"}`}>
                  {owner.suspendedAt ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {owner.suspendedAt ? "Suspended" : "Active"}
                </span>
                {/* A printable record of everything this owner did, for the
                    case where they come back disputing a payment. */}
                <Link href={recordHref("owner", ownerId, { suffix: "/statement" })} title="Open a printable statement for this owner"
                  className="inline-flex items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white">
                  <Printer className="h-3.5 w-3.5" /> Statement
                </Link>
              </div>
            </div>
          </div>

          {/* What this owner actually has switched on, and since when */}
          <dl className="m-0 grid min-w-0 grid-cols-1 overflow-hidden rounded-md border border-solid border-white/15 bg-white/[0.04] sm:grid-cols-2 xl:w-[30rem] xl:shrink-0">
            <BandCapability
              icon={<Radar className="h-3.5 w-3.5" aria-hidden />}
              title="NRMS"
              active={caps?.nrms.active ?? false}
              headline={caps?.nrms.active ? (caps.nrms.activatedAt ? `Since ${fmtDay(caps.nrms.activatedAt)}` : "Date not recorded") : "Not activated"}
              meta={caps ? `${caps.nrms.activeProperties} of ${caps.nrms.totalProperties} ${caps.nrms.totalProperties === 1 ? "property" : "properties"}` : null}
            />
            <BandCapability
              icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
              title="Payments"
              active={caps?.payments.active ?? false}
              headline={caps?.payments.active ? (caps.payments.activatedAt ? `Since ${fmtDay(caps.payments.activatedAt)}` : "Date not recorded") : caps?.payments.stage ? `In setup: ${prettyStage(caps.payments.stage)}` : "No payment method"}
              meta={caps?.payments.merchantName ? [caps.payments.merchantName, caps.payments.providerName].filter(Boolean).join(" · ") : null}
              divided
            />
          </dl>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main Content */}
        <div className="space-y-4 min-w-0">
          {/* Tabs. They sit at the top of the content column so switching
              never moves content that is already below the fold. */}
          <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <div className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-200 px-2" role="tablist" aria-label="Owner record">
              {OWNER_TABS.map(({ key, label }) => {
                const count = tabCounts[key];
                const isActive = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => selectTab(key)}
                    className={`relative inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3 text-[13px] font-semibold [font-family:inherit] transition-colors ${isActive ? "text-[#02665e]" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    {label}
                    {count !== null ? (
                      <span className={`rounded px-1.5 text-[11px] tabular-nums ${isActive ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-500"}`}>{count}</span>
                    ) : null}
                    {isActive ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#02665e]" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>

          {tab !== "overview" && (
        <div className={tab === "bookings" ? "" : "p-4"}>
          {tab === "properties" && (
            <div>
              {propertiesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-solid border-gray-300 border-t-brand"></div>
                </div>
              ) : properties.length > 0 ? (
                <>
                  {/* Three across through laptop widths, five only once the
                      page hits its 2xl width. xl:4 made cards too narrow to
                      show a property title. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4 sm:gap-6">
                    {properties.map((p) => (
                      <PropertyCard key={p.id} property={p} />
                    ))}
                  </div>
                  <div className="mt-6 text-center">
                    <Link
                      href={`/admin/properties/previews?ownerId=${adminRefOrId("owner", ownerId)}`}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand bg-brand/5 rounded-lg hover:bg-brand/10 hover:text-brand transition-all duration-300 no-underline hover:no-underline group"
                      style={{ textDecoration: 'none' }}
                    >
                      <span>View all properties in management</span>
                      <Eye className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-4">No properties found for this owner</p>
                  <Link
                    href={`/admin/properties/previews?ownerId=${adminRefOrId("owner", ownerId)}`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors duration-200 no-underline hover:no-underline"
                    style={{ textDecoration: 'none' }}
                  >
                    View in Properties Management
                    <Eye className="h-4 w-4" />
                  </Link>
                </div>
              )}
        </div>
      )}

          {tab === "documents" && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="m-0 text-sm font-bold text-slate-900">Required documents</p>
                <button type="button" onClick={() => loadDocs()} aria-label="Reload documents" title="Reload"
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>

              <ul className="m-0 list-none overflow-hidden rounded-lg border border-solid border-slate-200 p-0">
                {REQUIRED_OWNER_DOCS.map((req) => {
                  const latest = getLatestDocByType(docs, req.type);
                  const status = String(latest?.status || "NOT_UPLOADED").toUpperCase();
                  const isApproved = status === "APPROVED";
                  const isRejected = status === "REJECTED";
                  const isPending = status === "PENDING";
                  const canPreview = Boolean(latest?.url);
                  const expiresAtRaw = req.type === "BUSINESS_LICENCE" ? (latest as any)?.metadata?.expiresAt : null;
                  const expiresAt = expiresAtRaw ? new Date(String(expiresAtRaw)) : null;
                  const hasExpiry = expiresAt instanceof Date && Number.isFinite(expiresAt.getTime());
                  const isExpired = req.type === "BUSINESS_LICENCE" && isApproved && hasExpiry && expiresAt!.getTime() < Date.now();
                  const tag = isExpired
                    ? { cls: "bg-red-50 text-red-700", Icon: XCircle, text: "Expired" }
                    : isApproved ? { cls: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2, text: "Approved" }
                    : isRejected ? { cls: "bg-red-50 text-red-700", Icon: XCircle, text: "Rejected" }
                    : isPending ? { cls: "bg-amber-50 text-amber-800", Icon: Clock, text: "To review" }
                    : { cls: "bg-slate-100 text-slate-500", Icon: FileX, text: "Not uploaded" };

                  return (
                    <li key={req.type} className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${canPreview ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-400"}`}>
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                          {req.label}
                          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tag.cls}`}><tag.Icon className="h-3 w-3" />{tag.text}</span>
                        </p>
                        <p className="m-0 mt-0.5 text-xs text-slate-500">
                          {latest?.createdAt ? `Uploaded ${fmtDay(latest.createdAt)}` : "The owner has not uploaded this yet"}
                          {hasExpiry ? <span className={isExpired ? "font-semibold text-red-700" : ""}>{` · ${isExpired ? "Expired" : "Expires"} ${fmtDay(expiresAt!.toISOString())}`}</span> : null}
                        </p>
                        {isRejected && latest?.reason ? <p className="m-0 mt-1 text-xs text-red-700">Rejected: {latest.reason}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {canPreview ? (
                          <a href={latest!.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${req.label}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-700 no-underline hover:bg-slate-50">
                            <Eye className="h-4 w-4" /> Open
                          </a>
                        ) : null}
                        {canPreview && !isApproved ? (
                          <>
                            <button type="button" disabled={!latest?.id || actionLoading} aria-label={`Approve ${req.label}`}
                              onClick={() => {
                                if (!latest?.id) return;
                                void docApprove(ownerId, latest.id, () => { showToast("success", "Document approved."); void loadDocs(); }, (msg) => showToast("error", msg));
                              }}
                              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-2.5 text-[13px] font-semibold text-white hover:bg-[#014e47] disabled:opacity-50 [font-family:inherit]">
                              <Check className="h-4 w-4" /> Approve
                            </button>
                            <button type="button" disabled={!latest?.id || actionLoading} aria-label={`Reject ${req.label}`}
                              onClick={() => { if (latest?.id) setDocRejectModal({ docId: latest.id, label: req.label, reason: "" }); }}
                              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-red-200 bg-white px-2.5 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 [font-family:inherit]">
                              <X className="h-4 w-4" /> Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {tab === "bookings" && (() => {
            const pagesCount = Math.max(1, Math.ceil(bookingsTotal / BOOKINGS_PAGE_SIZE));
            const sortBy = (key: string) => {
              if (bookingsSortBy === key) setBookingsSortDir(bookingsSortDir === "asc" ? "desc" : "asc");
              else { setBookingsSortBy(key); setBookingsSortDir("desc"); }
            };
            const SortHead = ({ label, column }: { label: string; column: string }) => (
              <th className="px-4 py-2.5">
                <button type="button" onClick={() => sortBy(column)} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 [font-family:inherit] hover:text-slate-800">
                  {label}
                  {bookingsSortBy === column ? (bookingsSortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-slate-300" />}
                </button>
              </th>
            );
            const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" });
            return (
              <div>
                {/* Search and status, left aligned */}
                <div className="flex flex-col gap-2 border-0 border-b border-solid border-slate-100 p-3 lg:flex-row lg:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Search guest, property or booking code" value={bookingsSearch} onChange={(e) => setBookingsSearch(e.target.value)}
                      className="h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#02665e]" />
                  </div>
                  <div className="flex min-w-0 gap-1.5 overflow-x-auto">
                    {BOOKING_STATUS_FILTERS.map((f) => {
                      const on = bookingsStatus === f.value;
                      return (
                        <button key={f.value || "all"} type="button" onClick={() => { setBookingsStatus(f.value); setBookingsPage(1); }}
                          className={`h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-md border border-solid px-3 text-[13px] font-semibold [font-family:inherit] ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {bookingsLoading ? (
                  <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-slate-200 border-t-[#02665e]" /></div>
                ) : bookings.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Calendar className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="m-0 mt-2 text-sm font-semibold text-slate-700">No bookings</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">Bookings at this owner&apos;s properties show here.</p>
                  </div>
                ) : (
                  <>
                    {/* Phones */}
                    <ul className="m-0 list-none p-0 md:hidden">
                      {bookings.map((b: any) => (
                        <li key={b.id} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                          <Link href={`/admin/management/bookings/${b.reference ?? b.id}`} className="flex items-start gap-3 px-4 py-3 text-slate-900 no-underline hover:bg-slate-50">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{b.guestName ?? b.user?.name ?? b.user?.email ?? "Guest"}</span>
                              <span className="block truncate text-xs text-slate-500">{b.property?.title ?? "-"}</span>
                              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <BookingStatusTag status={b.status} />
                                {day(b.checkIn)} to {day(b.checkOut)}
                                {b.totalAmount ? <b className="tabular-nums text-slate-800">{fmt(b.totalAmount)}</b> : null}
                              </span>
                            </span>
                            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                          </Link>
                        </li>
                      ))}
                    </ul>

                    {/* Tablet and up */}
                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2.5">Guest</th>
                            <SortHead label="Property" column="property" />
                            <SortHead label="Stay" column="checkIn" />
                            <SortHead label="Amount" column="amount" />
                            <th className="px-4 py-2.5">Status</th>
                            <th className="w-10 px-2 py-2.5"><span className="sr-only">Open</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bookings.map((b: any) => (
                            <TableRow key={b.id} className="border-0 border-t border-solid border-slate-100 hover:bg-slate-50/70">
                              <td className="max-w-[220px] px-4 py-2.5"><span className="block truncate font-semibold text-slate-900">{b.guestName ?? b.user?.name ?? b.user?.email ?? "Guest"}</span></td>
                              <td className="max-w-[240px] px-4 py-2.5"><span className="block truncate text-slate-700">{b.property?.title ?? "-"}</span></td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{day(b.checkIn)} to {day(b.checkOut)}</td>
                              <td className="whitespace-nowrap px-4 py-2.5 font-semibold tabular-nums text-slate-900">{b.totalAmount ? fmt(b.totalAmount) : "-"}</td>
                              <td className="whitespace-nowrap px-4 py-2.5"><BookingStatusTag status={b.status} /></td>
                              <td className="px-2 py-2.5 text-right">
                                <Link href={`/admin/management/bookings/${b.reference ?? b.id}`} aria-label="Open booking" title="Open booking"
                                  className="inline-grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#02665e]/10 hover:text-[#02665e]">
                                  <ChevronRight className="h-4 w-4" />
                                </Link>
                              </td>
                            </TableRow>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {bookingsTotal > 0 ? (
                  <div className="flex flex-col gap-2 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[13px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <span>Showing <b className="text-slate-900">{Math.min((bookingsPage - 1) * BOOKINGS_PAGE_SIZE + 1, bookingsTotal)}</b> to <b className="text-slate-900">{Math.min(bookingsPage * BOOKINGS_PAGE_SIZE, bookingsTotal)}</b> of <b className="text-slate-900">{bookingsTotal}</b></span>
                    {pagesCount > 1 ? (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setBookingsPage((p) => Math.max(1, p - 1))} disabled={bookingsPage === 1 || bookingsLoading} aria-label="Previous bookings page"
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                        <span className="px-2 tabular-nums">{bookingsPage} of {pagesCount}</span>
                        <button type="button" onClick={() => setBookingsPage((p) => Math.min(pagesCount, p + 1))} disabled={bookingsPage >= pagesCount || bookingsLoading} aria-label="Next bookings page"
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })()}

          {tab === "activity" && <OwnerAccountActivity key={activityCategory} ownerId={ownerId} initialCategory={activityCategory} />}
          {tab === "notes" && <OwnerNotes ownerId={ownerId} onTotal={updateNotesCount} draft={noteDraft} onDraftChange={setNoteDraft} />}
        </div>
          )}
      </div>

          {tab === "overview" && (
            <>
          {/* At a glance. Contact details live in the header above. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-100 lg:grid-cols-4">
            {[
              { label: "Properties", value: String(owner._count.properties), Icon: Building2, action: () => selectTab("properties"), hint: "View all" },
              { label: "Paid invoices", value: String(snap.revenue.paidCount), Icon: FileText, hint: `of ${snap.invoicesCount} issued` },
              { label: "Bookings value", value: moneyShort(snap.revenue.grossSum), full: moneyWhole(snap.revenue.grossSum), Icon: DollarSign, hint: "Paid by guests" },
              { label: "Joined", value: fmtDay(owner.createdAt), Icon: Calendar, hint: `${new Date(owner.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` },
            ].map((cell) => (
              <div key={cell.label} className="flex min-w-0 items-start gap-3 bg-white px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><cell.Icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-[12px] text-slate-500">{cell.label}</p>
                  <p className="m-0 truncate text-[17px] font-bold tabular-nums leading-tight text-slate-900" title={cell.full}>{cell.value}</p>
                  {cell.action ? (
                    <button type="button" onClick={cell.action} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-[#02665e] hover:underline [font-family:inherit]">{cell.hint}</button>
                  ) : (
                    <p className="m-0 truncate text-xs text-slate-400">{cell.hint}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Money: where each shilling of a booking went, then NRMS billing */}
          {(() => {
            const gross = Number(snap.revenue.grossSum || 0);
            const commission = Number(snap.revenue.commissionSum || 0);
            const net = Number(snap.revenue.netSum || 0);
            const commissionPct = gross > 0 ? Math.round((commission / gross) * 1000) / 10 : 0;
            const ownerPct = gross > 0 ? Math.round((net / gross) * 1000) / 10 : 0;
            const nrms = snap.nrmsBilling;
            const collectedPct = nrms && Number(nrms.billed) > 0 ? Math.min(100, Math.round((Number(nrms.collected) / Number(nrms.billed)) * 100)) : 0;
            return (
              <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
                <header className="flex items-center gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                  <DollarSign className="h-4 w-4 text-[#02665e]" />
                  <h2 className="m-0 text-sm font-bold text-slate-900">Money</h2>
                  <span className="ml-auto text-xs text-slate-400">{snap.revenue.paidCount} paid {snap.revenue.paidCount === 1 ? "booking" : "bookings"}</span>
                </header>

                {/* Bookings: one total, split into what the owner keeps and NoLSAF's commission */}
                <div className="px-4 py-4">
                  <p className="m-0 text-[12px] font-semibold text-slate-500">Paid by guests</p>
                  <p className="m-0 mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{moneyWhole(gross)}</p>
                  {gross > 0 ? (
                    <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Owner keeps ${ownerPct}%, NoLSAF commission ${commissionPct}%`}>
                      <span className="h-full bg-[#02665e]" style={{ width: `${ownerPct}%` }} />
                      <span className="h-full bg-amber-400" style={{ width: `${commissionPct}%` }} />
                    </div>
                  ) : null}
                  <dl className="m-0 mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm bg-[#02665e]" aria-hidden />
                      <div className="min-w-0">
                        <dt className="text-[12px] text-slate-500">Owner keeps {gross > 0 ? <span className="text-slate-400">· {ownerPct}%</span> : null}</dt>
                        <dd className="m-0 truncate text-base font-bold tabular-nums text-slate-900">{moneyWhole(net)}</dd>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm bg-amber-400" aria-hidden />
                      <div className="min-w-0">
                        <dt className="text-[12px] text-slate-500">NoLSAF commission {gross > 0 ? <span className="text-slate-400">· {commissionPct}%</span> : null}</dt>
                        <dd className="m-0 truncate text-base font-bold tabular-nums text-slate-900">{moneyWhole(commission)}</dd>
                      </div>
                    </div>
                  </dl>
                </div>

                {/* NRMS is a separate stream: the owner pays NoLSAF for the tool,
                    so all of it is NoLSAF revenue. Same definition as the finance overview. */}
                <div className="border-0 border-t border-solid border-slate-100 px-4 py-4">
                  <p className="m-0 flex flex-wrap items-center justify-between gap-2 text-[12px] font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><Radar className="h-3.5 w-3.5" aria-hidden />NRMS billing</span>
                    {nrms ? (
                      <span className="font-normal text-slate-400">
                        {nrms.accountsCount} {nrms.accountsCount === 1 ? "property" : "properties"}
                        {nrms.paymentsCount > 0 ? ` · ${nrms.paymentsCount} ${nrms.paymentsCount === 1 ? "payment" : "payments"}` : ""}
                      </span>
                    ) : null}
                  </p>
                  {!nrms || nrms.accountsCount === 0 ? (
                    <p className="m-0 mt-2 text-sm text-slate-500">No NRMS billing yet. This owner has not run a property on NRMS.</p>
                  ) : (
                    <>
                      <p className="m-0 mt-1.5 flex flex-wrap items-baseline gap-x-2 text-slate-900">
                        <span className="text-xl font-bold tabular-nums">{moneyWhole(nrms.collected, nrms.currency)}</span>
                        <span className="text-[13px] text-slate-500">collected of {moneyWhole(nrms.billed, nrms.currency)} billed ({nrms.statementsCount} {nrms.statementsCount === 1 ? "statement" : "statements"})</span>
                      </p>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${collectedPct}% of billed collected`}>
                        <span className="block h-full bg-[#02665e]" style={{ width: `${collectedPct}%` }} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
                          Not billed yet <b className="tabular-nums text-slate-900">{moneyWhole(nrms.unbilledUsage, nrms.currency)}</b>
                        </span>
                        {nrms.outstanding > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-800 ring-1 ring-amber-200">
                            Waiting to collect <b className="tabular-nums">{moneyWhole(nrms.outstanding, nrms.currency)}</b> · {nrms.outstandingCount} open
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </section>
            );
          })()}

          <PartnersCard partners={partners} />

            </>
          )}
        </div>

        {/* Sidebar - Actions. Sticky so the admin's controls stay reachable
            whichever tab the content column is showing. */}
        <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <OwnerLongStayCard ownerId={ownerId} />
          {/* Account actions: one row each; a row opens its own short form */}
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <header className="flex items-center gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
              <Shield className="h-4 w-4 text-[#02665e]" />
              <h3 className="m-0 text-sm font-bold text-slate-900">Account actions</h3>
            </header>

            {/* Support session */}
            <div className="border-0 border-b border-solid border-slate-100">
              {!showImpersonateForm ? (
                <ActionRow icon={<Eye className="h-4 w-4" />} title="Read-only support session" hint="See their workspace for 10 minutes" onClick={handleImpersonateClick} disabled={actionLoading} />
              ) : (
                <div className="space-y-2 p-4">
                  <label htmlFor="impersonate-reason" className="block text-xs font-semibold text-slate-700">Why do you need to see their workspace?</label>
                  <textarea id="impersonate-reason" value={impersonateReason} onChange={(e) => setImpersonateReason(e.target.value)} placeholder="For example: owner reports their payout page is empty."
                    className="min-h-20 w-full resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
                  <p className="m-0 text-[11px] text-slate-500">Read-only, ends after 10 minutes, logged with your reason (at least 10 characters).</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={confirmImpersonate} disabled={actionLoading || impersonateReason.trim().length < 10}
                      className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-50 [font-family:inherit]">
                      {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />} Start session
                    </button>
                    <button type="button" onClick={cancelImpersonate} disabled={actionLoading} className="h-9 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Notice to the owner */}
            <div className="border-0 border-b border-solid border-slate-100">
              {!showNotificationForm ? (
                <ActionRow icon={<Bell className="h-4 w-4" />} title="Send a notice" hint="Message the owner's inbox" onClick={() => setShowNotificationForm(true)} disabled={actionLoading} />
              ) : (
                <div className="space-y-2 p-4">
                  <label htmlFor="notice-subject" className="block text-xs font-semibold text-slate-700">Subject</label>
                  <input id="notice-subject" type="text" value={notificationSubject} onChange={(e) => setNotificationSubject(e.target.value)} placeholder="e.g. Your KYC was approved"
                    className="h-9 w-full rounded-md border border-solid border-slate-300 px-3 text-sm outline-none focus:border-[#02665e]" />
                  <label htmlFor="notice-message" className="block text-xs font-semibold text-slate-700">Message</label>
                  <textarea id="notice-message" value={notificationMessage} onChange={(e) => setNotificationMessage(e.target.value)} placeholder="What should the owner know?"
                    className="min-h-24 w-full resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
                  <div className="flex gap-2">
                    <button type="button" onClick={sendNotification} disabled={actionLoading || !notificationSubject.trim() || !notificationMessage.trim()}
                      className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-50 [font-family:inherit]">
                      {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                    </button>
                    <button type="button" onClick={() => { setShowNotificationForm(false); setNotificationSubject(""); setNotificationMessage(""); }} disabled={actionLoading}
                      className="h-9 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Suspend or restore, last and in red: it locks the owner out */}
            {owner.suspendedAt ? (
              <ActionRow icon={<CheckCircle2 className="h-4 w-4" />} title="Unsuspend" hint="Let the owner sign in again" onClick={unsuspend} disabled={actionLoading} tone="good" />
            ) : !showSuspendForm ? (
              <ActionRow icon={<Ban className="h-4 w-4" />} title="Suspend owner" hint="Signs them out and blocks sign-in" onClick={handleSuspendClick} disabled={actionLoading} tone="danger" />
            ) : (
              <div className="space-y-2 bg-red-50/60 p-4">
                <label htmlFor="suspend-reason" className="block text-xs font-semibold text-red-800">Reason for suspending</label>
                <textarea id="suspend-reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="e.g. policy breach under review"
                  className="min-h-20 w-full resize-y rounded-md border border-solid border-red-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400 [font-family:inherit]" />
                <label htmlFor="notify-owner" className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" id="notify-owner" checked={notifyOwner} onChange={(e) => setNotifyOwner(e.target.checked)} className="h-4 w-4" />
                  Tell the owner why
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={handleSuspendSubmit} disabled={actionLoading || !suspendReason.trim()}
                    className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 [font-family:inherit]">
                    {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Suspend
                  </button>
                  <button type="button" onClick={cancelSuspend} disabled={actionLoading} className="h-9 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Cancel</button>
                </div>
              </div>
            )}
          </section>

          {/* KYC decision, only while it is not approved */}
          {owner.kycStatus !== 'APPROVED_KYC' && (
            <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
              <header className="flex items-center gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                <BadgeCheckIcon className="h-4 w-4 text-[#02665e]" />
                <h3 className="m-0 text-sm font-bold text-slate-900">KYC decision</h3>
              </header>
              <div className="flex gap-2 p-4">
                <button type="button" onClick={kycApprove} disabled={actionLoading}
                  className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-50 [font-family:inherit]">
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                {owner.kycStatus !== 'REJECTED_KYC' && (
                  <button type="button" onClick={kycReject} disabled={actionLoading}
                    className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 [font-family:inherit]">
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Audit & History */}
          <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-[#02665e]" />
              <h3 className="m-0 text-sm font-bold text-slate-900">Audit and history</h3>
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
                    const action = audit.action?.toUpperCase() || '';
                    if (action.includes('SUSPEND')) return <Ban className="h-4 w-4 text-red-600" />;
                    if (action.includes('UNSUSPEND')) return <CheckCircle2 className="h-4 w-4 text-green-600" />;
                    if (action.includes('KYC') || action.includes('APPROVE')) return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
                    if (action.includes('REJECT')) return <XCircle className="h-4 w-4 text-red-600" />;
                    if (action.includes('IMPERSONATE')) return <Copy className="h-4 w-4 text-blue-600" />;
                    if (action.includes('NOTIFY')) return <Bell className="h-4 w-4 text-blue-600" />;
                    return <Activity className="h-4 w-4 text-gray-600" />;
                  };

                  const getActionColor = () => {
                    const action = audit.action?.toUpperCase() || '';
                    if (action.includes('SUSPEND') || action.includes('REJECT')) return 'bg-red-50 border-red-200';
                    if (action.includes('UNSUSPEND') || action.includes('APPROVE') || action.includes('KYC')) return 'bg-emerald-50 border-emerald-200';
                    if (action.includes('IMPERSONATE') || action.includes('NOTIFY')) return 'bg-blue-50 border-blue-200';
                    return 'bg-gray-50 border-gray-200';
                  };

                  return (
                    <div key={audit.id || idx} className={`p-3 rounded-lg border ${getActionColor()} transition-all hover:shadow-sm`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getActionIcon()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                              {audit.action?.replace(/_/g, ' ') || 'Unknown Action'}
                            </span>
                            <span className="text-xs text-gray-500 flex-shrink-0">
                              {new Date(audit.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {audit.details && (
                            <p className="text-xs text-gray-600 mb-1 line-clamp-2">
                              {typeof audit.details === 'string' ? audit.details : JSON.stringify(audit.details)}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />
                            <span>
                              {new Date(audit.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            {audit.adminId && (
                              <>
                                <span>•</span>
                                <span>Admin ID: {audit.adminId}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {auditItems.length > 10 && (
              <div className="mt-3 text-center">
                <p className="text-xs text-gray-500">
                  Showing 10 of {auditItems.length} entries
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

async function docApprove(
  ownerId: number,
  docId: number,
  onSuccess?: () => void,
  onError?: (message: string) => void,
) {
  try {
    await api.post(`/api/admin/owners/${ownerId}/documents/${docId}/approve`);
    onSuccess?.();
  } catch (err: any) {
    console.error(err);
    onError?.(err?.response?.data?.error || "Failed to approve document");
  }
}

async function docReject(
  ownerId: number,
  docId: number,
  reason: string,
  onSuccess?: () => void,
  onError?: (message: string) => void,
) {
  if (!reason.trim()) return;
  try {
    await api.post(`/api/admin/owners/${ownerId}/documents/${docId}/reject`, { reason });
    onSuccess?.();
  } catch (err: any) {
    console.error(err);
    onError?.(err?.response?.data?.error || "Failed to reject document");
  }
}
/** Formats money in the currency the API reported, not an assumed one. */
function fmt(n:any, currency: string = DEFAULT_CURRENCY){
  return new Intl.NumberFormat(undefined,{ style:"currency", currency }).format(Number(n||0));
}

/** Whole units for shillings (no ".00"), cents only for other currencies. */
function moneyWhole(n: any, currency: string = DEFAULT_CURRENCY) {
  const digits = currency === "TZS" ? 0 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n || 0)).replace(/\u00a0/g, " ");
}

/** Short form for tight spaces: TZS 28.99M, TZS 450K. The full figure goes in a title. */
function moneyShort(n: any, currency: string = DEFAULT_CURRENCY) {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  const unit = abs >= 1e9 ? ["B", 1e9] : abs >= 1e6 ? ["M", 1e6] : abs >= 1e4 ? ["K", 1e3] : null;
  if (!unit) return moneyWhole(v, currency);
  const scaled = Math.round((v / (unit[1] as number)) * 100) / 100;
  return `${currency} ${scaled.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit[0]}`;
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Provider account statuses are SCREAMING_SNAKE on the wire. */
function prettyStage(stage: string) {
  return stage.replace(/_/g, " ").toLowerCase().replace(/^\S/, (c) => c.toUpperCase());
}

/** Colour by what the partnership state actually means, not by category. */
function partnerTone(status: string) {
  if (status === "ACTIVE" || status === "VERIFIED") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (status === "SUSPENDED" || status === "REJECTED" || status === "CLOSED") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (status === "DRAFT" || status === "INVITED" || status === "REQUESTED" || status === "PENDING") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }
  return "bg-gray-50 text-gray-600 ring-1 ring-gray-200";
}

/** Header tile for one capability: whether it is live, since when, and the
 *  supporting detail. Preflight is off project-wide, so outlines are rings. */
/** One action in the side column: icon, what it does, and a short hint. */
function ActionRow({ icon, title, hint, onClick, disabled, tone }: {
  icon: React.ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean; tone?: "danger" | "good";
}) {
  const color = tone === "danger" ? "text-red-700" : tone === "good" ? "text-emerald-700" : "text-slate-800";
  const box = tone === "danger" ? "bg-red-50 text-red-600" : tone === "good" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-600";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex w-full cursor-pointer items-center gap-3 border-0 bg-white px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${box}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${color}`}>{title}</span>
        <span className="block truncate text-xs text-slate-500">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

/** A booking status as a small tag, coloured by what it means. */
function BookingStatusTag({ status }: { status: string | null | undefined }) {
  const s = String(status || "").toLowerCase();
  const cls = s.includes("cancel") || s.includes("reject") ? "bg-red-50 text-red-700"
    : s.includes("pending") || s.includes("new") ? "bg-amber-50 text-amber-800"
    : s.includes("confirm") || s.includes("active") ? "bg-emerald-50 text-emerald-700"
    : s.includes("check") || s.includes("complete") ? "bg-sky-50 text-sky-800"
    : "bg-slate-100 text-slate-600";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status ? prettyStage(String(status)) : "Unknown"}</span>;
}

/** A money figure in the Money card. */
function MoneyCell({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="min-w-0 bg-white px-3 py-2.5">
      <dt className="truncate text-[11px] font-semibold text-slate-500">{label}</dt>
      <dd className={`m-0 mt-0.5 truncate text-base font-bold tabular-nums ${strong ? "text-[#02665e]" : "text-slate-900"}`} title={value}>{value}</dd>
      {sub ? <dd className="m-0 truncate text-[11px] text-slate-400">{sub}</dd> : null}
    </div>
  );
}

/** A capability on the dark header: on/off, since when, and a short detail. */
function BandCapability({ icon, title, active, headline, meta, divided }: {
  icon: React.ReactNode; title: string; active: boolean; headline: string; meta: string | null; divided?: boolean;
}) {
  return (
    <div className={`min-w-0 px-4 py-3 ${divided ? "border-0 border-t border-solid border-white/10 sm:border-l sm:border-t-0" : ""}`}>
      <dt className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/55">{icon}{title}</span>
        <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${active ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-white/50"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-white/30"}`} aria-hidden />
          {active ? "Active" : "Off"}
        </span>
      </dt>
      <dd className={`m-0 mt-1 truncate text-sm font-semibold ${active ? "text-white" : "text-white/75"}`}>{headline}</dd>
      {meta ? <dd className="m-0 mt-0.5 truncate text-xs text-white/45" title={meta}>{meta}</dd> : null}
    </div>
  );
}

function PropertyCard({ property }: { property: Property }) {
  useAdminHref();
  const location = [property.ward, property.district, property.regionName].filter(Boolean).join(", ") || "Location not specified";
  const price = property.basePrice 
    ? fmt(property.basePrice)
    : "Price not set";
  
  const PhotoPlaceholder = () => (
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(2,102,94,0.18),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(2,132,199,0.12),transparent_55%),linear-gradient(135deg,#f8fafc,#e2e8f0)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/0 via-black/0 to-white/35" />
      <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700">
        <div className="h-12 w-12 rounded-2xl bg-white/85 border border-slate-200 shadow-sm flex items-center justify-center">
          <ImageIcon className="w-6 h-6 text-slate-500" aria-hidden />
        </div>
        <div className="mt-2 text-[13px] font-semibold">Photo preview</div>
        <div className="text-[11px] text-slate-500">No photo available</div>
      </div>
    </div>
  );

  const getStatusBadge = () => {
    const statusLower = property.status?.toLowerCase() || '';
    if (statusLower === 'approved') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-medium">
          Approved
        </span>
      );
    }
    if (statusLower === 'pending') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-medium">
          Pending
        </span>
      );
    }
    if (statusLower === 'rejected') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-medium">
          Rejected
        </span>
      );
    }
    if (statusLower === 'requested' || statusLower === 'request_for_fix') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-medium">
          Request for Fix
        </span>
      );
    }
    return null;
  };

  const isApproved = property.status?.toLowerCase() === 'approved';

  return (
    <Link
      href={`/admin/properties/previews?previewId=${adminRefOrId("property", property.id)}`}
      className="group no-underline text-slate-900"
      aria-label={`View ${property.title}`}
    >
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200">
        {/* Title (above image) */}
        <div className="px-4 pt-4">
          <div className="text-sm font-bold text-slate-900 truncate">{property.title}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{property.type}</div>
        </div>

        {/* Image */}
        <div className="px-4 mt-3">
          <div className="relative aspect-square bg-slate-100 rounded-2xl overflow-hidden">
            {property.primaryImage ? (
              <Image
                src={property.primaryImage}
                alt={property.title}
                fill
                sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 22vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
              />
            ) : (
              <PhotoPlaceholder />
            )}
            {/* Verification badge only for approved properties */}
            {isApproved && <VerifiedIcon />}
          </div>
        </div>

        {/* Below image: location and details */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mb-2.5">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{location}</span>
          </div>
          
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2.5">
            <div className="flex items-center gap-3">
              {property.totalBedrooms > 0 && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" />
                  {property.totalBedrooms}
                </span>
              )}
              {property.maxGuests > 0 && (
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {property.maxGuests}
                </span>
              )}
            </div>
            <div className="text-right flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-[13px] font-bold text-slate-900">{price}</div>
                  {property.basePrice && <div className="text-[10px] text-slate-500">per night</div>}
                </div>
                {getStatusBadge()}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <span className="inline-flex items-center justify-center w-full rounded-xl bg-brand text-white py-2 text-[13px] font-semibold transition-colors group-hover:bg-brand-700">
              View details
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/** "SHERATON HOTEL" reads as shouting; show it as "Sheraton Hotel". Mixed case is kept. */
function tidyName(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function nameInitials(value: string | null | undefined): string {
  return String(value || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

/**
 * Who this owner does business through: the companies that operate their
 * properties, and the travel agencies that sell them. One list at a time.
 */
function PartnersCard({ partners }: { partners: Partners | null }) {
  const companies = partners?.merchants ?? [];
  const agencies = partners?.agents ?? [];
  const [view, setView] = useState<"companies" | "agencies">(companies.length || !agencies.length ? "companies" : "agencies");
  const tabs: Array<{ key: "companies" | "agencies"; label: string; count: number; Icon: typeof Briefcase }> = [
    { key: "companies", label: "Operating companies", count: partners?.merchantCount ?? 0, Icon: Briefcase },
    { key: "agencies", label: "Travel agencies", count: partners?.agentCount ?? 0, Icon: Users },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3">
        <Handshake className="h-4 w-4 text-[#02665e]" />
        <h2 className="m-0 text-sm font-bold text-slate-900">Business partners</h2>
        <span className="ml-auto text-xs text-slate-400">{(partners?.merchantCount ?? 0) + (partners?.agentCount ?? 0)} in total</span>
      </header>
      <div className="mt-2 flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-100 px-2" role="tablist" aria-label="Partner type">
        {tabs.map(({ key, label, count, Icon }) => {
          const on = view === key;
          return (
            <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setView(key)}
              className={`relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 text-[13px] font-semibold [font-family:inherit] ${on ? "text-[#02665e]" : "text-slate-500 hover:text-slate-800"}`}>
              <Icon className="h-4 w-4" />{label}
              <span className={`rounded px-1.5 text-[11px] tabular-nums ${on ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-500"}`}>{count}</span>
              {on ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#02665e]" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      {view === "companies" ? (
        <>
          {/* Abandoned drafts are not listed, but the properties they hold are not dropped silently. */}
          {partners && partners.hiddenDraftCount > 0 ? (
            <p className="m-0 flex items-start gap-2 border-0 border-b border-solid border-amber-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>{partners.hiddenDraftCount} unnamed draft {partners.hiddenDraftCount === 1 ? "company holds" : "companies hold"} {partners.hiddenDraftProperties} {partners.hiddenDraftProperties === 1 ? "property" : "properties"}. Onboarding started, but no company details were entered.</span>
            </p>
          ) : null}
          {companies.length === 0 ? (
            <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">No named company operates this owner&apos;s properties.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {companies.map((m) => {
                const sinceDay = m.since ? fmtDay(m.since) : null;
                const name = tidyName(m.name) || "Company not named yet";
                return (
                  <li key={m.id} className="border-0 border-t border-solid border-slate-100 px-4 py-3.5 first:border-t-0">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-[13px] font-bold text-white">{nameInitials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`m-0 truncate text-sm font-bold ${m.name ? "text-slate-900" : "italic text-slate-400"}`}>{name}</p>
                          <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${partnerTone(m.status)}`}>{prettyStage(m.status)}</span>
                        </div>
                        {m.legalName && m.legalName !== m.name ? <p className="m-0 truncate text-xs text-slate-500">{tidyName(m.legalName)}</p> : null}
                        <dl className="m-0 mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                          <Fact label="Partner since" value={sinceDay ?? "Not recorded"} />
                          <Fact label="Properties" value={String(m.propertyCount)} />
                          <Fact label="Registration" value={m.registrationNumber ?? "Not given"} muted={!m.registrationNumber} mono />
                          <Fact label="TIN" value={m.tin ? `${m.tin}${m.country ? ` · ${m.country}` : ""}` : "Not given"} muted={!m.tin} mono />
                        </dl>
                        {m.properties.length > 0 ? (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {m.properties.map((title, i) => (
                              <span key={`${m.id}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-solid border-slate-200 px-2 py-0.5 text-[12px] text-slate-700">
                                <Building2 className="h-3 w-3 shrink-0 text-slate-400" /><span className="truncate">{tidyName(title)}</span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : agencies.length === 0 ? (
        <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">No travel agency sells this owner&apos;s rooms.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {agencies.map((a) => {
            const name = tidyName(a.name) || "Agency not named yet";
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-[12px] font-bold text-slate-600">{nameInitials(name)}</span>
                <div className="min-w-0 flex-1">
                  <p className={`m-0 truncate text-sm font-semibold ${a.name ? "text-slate-900" : "italic text-slate-400"}`}>{name}</p>
                  <p className="m-0 text-xs text-slate-500">{a.since ? `Selling since ${fmtDay(a.since)}` : "Not selling yet"} · {a.propertyCount} {a.propertyCount === 1 ? "property" : "properties"}</p>
                </div>
                {/* The link status is the partnership; KYC is NoLSAF's own check on the agency. */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {a.verificationStatus !== "VERIFIED" ? (
                    <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">KYC {prettyStage(a.verificationStatus).toLowerCase()}</span>
                  ) : null}
                  <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${partnerTone(a.status)}`}>{prettyStage(a.status)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Fact({ label, value, muted, mono }: { label: string; value: string; muted?: boolean; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className={`m-0 truncate ${muted ? "text-slate-400" : "font-semibold text-slate-800"} ${mono && !muted ? "tabular-nums" : ""}`} title={value}>{value}</dd>
    </div>
  );
}
