"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { ArrowLeft, User, Building2, FileText, DollarSign, Mail, Phone, Calendar, CheckCircle2, XCircle, Clock, Eye, Shield, Ban, Copy, MapPin, ImageIcon, Bell, Send, X, History, Activity, Home, Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, FileX, RefreshCw, Check, ExternalLink, Radar, Wallet, Handshake, Briefcase, Users, Printer } from "lucide-react";
import VerifiedIcon from "@/components/VerifiedIcon";
import TableRow from "@/components/TableRow";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Owner = {
  id:number; name:string|null; email:string; phone:string|null;
  suspendedAt:string|null; kycStatus:string|null; createdAt:string;
  profile?: any;
  _count: { properties:number };
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

type TabKey = "overview" | "properties" | "documents" | "bookings" | "notes";

const OWNER_TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "properties", label: "Properties" },
  { key: "documents", label: "Documents" },
  { key: "bookings", label: "Bookings" },
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
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const ownerId = Number(idParam);
  const [owner, setOwner] = useState<Owner|null>(null);
  const [snap, setSnap] = useState<Snapshot|null>(null);
  const [caps, setCaps] = useState<Capabilities|null>(null);
  const [partners, setPartners] = useState<Partners|null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [note, setNote] = useState("");
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
    if (!impersonateReason.trim()) {
      showToast("error", "Please provide a reason for impersonation. This action will be logged.");
      return;
    }
    
    setActionLoading(true);
    try {
      const r = await api.post<{token:string; expiresIn:number}>(`/api/admin/owners/${ownerId}/impersonate`, {
        reason: impersonateReason.trim()
      });
      navigator.clipboard.writeText(r.data.token);
      setImpersonateReason("");
      setShowImpersonateForm(false);
      showToast("success", "Temporary OWNER token copied to clipboard (10 min). Use in a private tab for support.");
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || "Failed to impersonate owner");
    } finally {
      setActionLoading(false);
    }
  }
  async function addNote(){
    if(!note.trim()) return;
    setActionLoading(true);
    try {
      await api.post(`/api/admin/owners/${ownerId}/notes`, { text: note.trim() });
      setNote("");
      showToast("success", "Note added.");
    } catch (err: any) {
      showToast("error", err?.response?.data?.error || "Failed to add note");
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
    notes: auditHistory.length,
  };

  return (
    <div className="max-w-7xl 2xl:max-w-[1720px] mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 min-w-0">
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

      {/* Header */}
      <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <Link
              href="/admin/owners"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title="Back to owners"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 sm:h-5 sm:w-5 text-brand" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
                  {owner.name ?? `Owner #${owner.id}`}
                </h1>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {getKycStatusBadge(owner.kycStatus)}
                {getAccountStatusBadge(!!owner.suspendedAt)}
                {/* A printable record of everything this owner did, for the
                    case where they come back disputing a payment. */}
                <Link
                  href={`/admin/owners/${ownerId}/statement`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 no-underline ring-1 ring-gray-300 hover:bg-gray-50 hover:text-brand transition-colors"
                  title="Open a printable statement for this owner"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Statement
                </Link>
              </div>
            </div>
          </div>

          {/* What this owner actually has switched on, and since when. Fills the
              header's right side, which was empty. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[30rem] lg:shrink-0">
            <CapabilityTile
              icon={<Radar className="h-3.5 w-3.5" aria-hidden />}
              title="NRMS"
              active={caps?.nrms.active ?? false}
              headline={
                caps?.nrms.active
                  ? (caps.nrms.activatedAt ? `Since ${fmtDay(caps.nrms.activatedAt)}` : "Activation date not recorded")
                  : "Not activated"
              }
              meta={
                caps
                  ? `${caps.nrms.activeProperties} of ${caps.nrms.totalProperties} ${caps.nrms.totalProperties === 1 ? "property" : "properties"}`
                  : null
              }
            />
            <CapabilityTile
              icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
              title="Payments"
              active={caps?.payments.active ?? false}
              headline={
                caps?.payments.active
                  ? (caps.payments.activatedAt ? `Since ${fmtDay(caps.payments.activatedAt)}` : "Activation date not recorded")
                  : caps?.payments.stage
                    ? `In setup: ${prettyStage(caps.payments.stage)}`
                    : "No payment method"
              }
              meta={
                caps?.payments.merchantName
                  ? [caps.payments.merchantName, caps.payments.providerName].filter(Boolean).join(" · ")
                  : null
              }
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Tabs. They sit at the top of the content column so switching
              never moves content that is already below the fold. */}
          <div className="bg-white rounded-xl ring-1 ring-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto p-2 sm:p-3 bg-gray-50/50">
              <div className="inline-flex min-w-full items-center gap-1 sm:gap-2 p-1 bg-white rounded-full ring-1 ring-gray-200 shadow-sm">
                {OWNER_TABS.map(({ key, label }) => {
                  const count = tabCounts[key];
                  const isActive = tab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative flex-1 border-0 px-3 sm:px-5 py-2 sm:py-2.5 text-sm font-medium transition-all duration-300 whitespace-nowrap rounded-full ${
                        isActive
                          ? "text-white bg-brand shadow-md shadow-brand/20"
                          : "bg-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                      {count !== null ? (
                        <span
                          className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                            isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

          {tab !== "overview" && (
        <div className="p-4 sm:p-6">
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
                      href={`/admin/properties/previews?ownerId=${ownerId}`}
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
                    href={`/admin/properties/previews?ownerId=${ownerId}`}
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
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">Required documents</div>
                <button
                  type="button"
                  onClick={() => loadDocs()}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                  aria-label="Reload documents"
                  title="Reload"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {REQUIRED_OWNER_DOCS.map((req) => {
                  const latest = getLatestDocByType(docs, req.type);
                  const status = String(latest?.status || "NOT_UPLOADED").toUpperCase();
                  const isApproved = status === "APPROVED";
                  const isRejected = status === "REJECTED";
                  const isPending = status === "PENDING";
                  const canPreview = Boolean(latest?.url);
                  const isNotUploaded = !latest?.url;

                  const expiresAtRaw = req.type === "BUSINESS_LICENCE" ? (latest as any)?.metadata?.expiresAt : null;
                  const expiresAt = expiresAtRaw ? new Date(String(expiresAtRaw)) : null;
                  const isExpired =
                    req.type === "BUSINESS_LICENCE" &&
                    isApproved &&
                    expiresAt instanceof Date &&
                    Number.isFinite(expiresAt.getTime()) &&
                    expiresAt.getTime() < Date.now();

                  const badge = isExpired
                    ? { cls: "bg-red-100 text-red-800", Icon: XCircle, text: "Expired" }
                    : isApproved
                      ? { cls: "bg-emerald-100 text-emerald-800", Icon: CheckCircle2, text: "Approved" }
                    : isRejected
                      ? { cls: "bg-red-100 text-red-800", Icon: XCircle, text: "Rejected" }
                      : isPending
                        ? { cls: "bg-amber-100 text-amber-800", Icon: Clock, text: "Pending" }
                        : { cls: "bg-gray-100 text-gray-700", Icon: FileX, text: "Not uploaded" };

                  return (
                    <div key={req.type} className="ring-1 ring-gray-200 rounded-xl p-4 bg-white shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{req.label}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Type: <span className="font-mono">{req.type}</span>
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                          <badge.Icon className="h-3 w-3" />
                          {badge.text}
                        </span>
                      </div>

                      {isRejected && latest?.reason ? (
                        <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                          Rejection reason: {latest.reason}
                        </div>
                      ) : null}

                      {req.type === "BUSINESS_LICENCE" && expiresAt && Number.isFinite(expiresAt.getTime()) ? (
                        <div className="mt-3 text-xs text-gray-700 bg-gray-50 ring-1 ring-gray-200 rounded-md px-3 py-2">
                          Expires on: <span className="font-semibold">{expiresAt.toLocaleDateString()}</span>
                        </div>
                      ) : null}

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {latest?.createdAt ? new Date(latest.createdAt).toLocaleDateString() : "-"}
                        </div>

                        <div className="flex items-center gap-2">
                          {isNotUploaded ? (
                            <span
                              className="inline-flex items-center justify-center h-9 w-9 rounded-lg ring-1 ring-gray-200 bg-gray-50 text-gray-500"
                              title="Not uploaded"
                              aria-label={`${req.label} not uploaded`}
                            >
                              <FileX className="h-4.5 w-4.5" />
                            </span>
                          ) : null}

                          {canPreview ? (
                            <a
                              href={latest!.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-9 w-9 rounded-lg ring-1 ring-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-all duration-200 hover:-translate-y-[1px]"
                              aria-label={`View ${req.label}`}
                              title="View"
                            >
                              <Eye className="h-4.5 w-4.5" />
                            </a>
                          ) : null}

                          {canPreview && !isApproved ? (
                            <>
                              <button
                                type="button"
                                disabled={!latest?.id || actionLoading}
                                onClick={() => {
                                  if (!latest?.id) return;
                                  void docApprove(
                                    ownerId,
                                    latest.id,
                                    () => {
                                      showToast("success", "Document approved.");
                                      void loadDocs();
                                    },
                                    (msg) => showToast("error", msg),
                                  );
                                }}
                                className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-brand text-white hover:bg-brand-700 transition-all duration-200 hover:-translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label={`Approve ${req.label}`}
                                title="Approve"
                              >
                                <Check className="h-4.5 w-4.5" />
                              </button>

                              <button
                                type="button"
                                disabled={!latest?.id || actionLoading}
                                onClick={() => {
                                  if (!latest?.id) return;
                                  setDocRejectModal({ docId: latest.id, label: req.label, reason: "" });
                                }}
                                className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 transition-all duration-200 hover:-translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label={`Reject ${req.label}`}
                                title="Reject"
                              >
                                <X className="h-4.5 w-4.5" />
                              </button>
                            </>
                          ) : null}

                          {canPreview && isApproved ? (
                            <a
                              href={latest!.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-9 w-9 rounded-lg ring-1 ring-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-all duration-200 hover:-translate-y-[1px]"
                              aria-label={`Open ${req.label} in new tab`}
                              title="Open"
                            >
                              <ExternalLink className="h-4.5 w-4.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {REQUIRED_OWNER_DOCS.every((req) => !getLatestDocByType(docs, req.type)?.url) ? (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-3">
                    <FileText className="h-8 w-8 text-gray-400" />
                  </div>
                  <p className="text-gray-600 font-medium mb-1">No documents uploaded</p>
                  <p className="text-sm text-gray-500">Documents will appear here once uploaded by the owner</p>
                </div>
              ) : null}
            </div>
          )}

          {tab === "bookings" && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 shadow-sm">
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="Search by guest name, property, booking code..."
                      value={bookingsSearch}
                      onChange={(e) => setBookingsSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-brand transition-all text-sm box-border"
                    />
                  </div>
                </div>
                {/* Status Filters */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-4 shadow-[inset_0_1px_0_0_#e5e7eb]">
                  {BOOKING_STATUS_FILTERS.map((f) => (
                    <button
                      key={f.value || "all"}
                      type="button"
                      onClick={() => { setBookingsStatus(f.value); setBookingsPage(1); }}
                      className={`px-4 py-2 rounded-lg border-0 text-sm font-medium transition-all duration-200 ${
                        bookingsStatus === f.value ? f.on : f.off
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bookings Table */}
              <div className="bg-white rounded-xl ring-1 ring-gray-200 shadow-sm overflow-hidden">
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="bg-gray-50">
                      <tr className="[&>th]:shadow-[inset_0_-1px_0_0_#e5e7eb]">
                        <th 
                          className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => {
                            if (bookingsSortBy === "id") {
                              setBookingsSortDir(bookingsSortDir === "asc" ? "desc" : "asc");
                            } else {
                              setBookingsSortBy("id");
                              setBookingsSortDir("desc");
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>ID</span>
                            {bookingsSortBy === "id" ? (
                              bookingsSortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-gray-400" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => {
                            if (bookingsSortBy === "property") {
                              setBookingsSortDir(bookingsSortDir === "asc" ? "desc" : "asc");
                            } else {
                              setBookingsSortBy("property");
                              setBookingsSortDir("desc");
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Property</span>
                            {bookingsSortBy === "property" ? (
                              bookingsSortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-gray-400" />
                            )}
                          </div>
                        </th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Guest
                        </th>
                        <th 
                          className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => {
                            if (bookingsSortBy === "checkIn") {
                              setBookingsSortDir(bookingsSortDir === "asc" ? "desc" : "asc");
                            } else {
                              setBookingsSortBy("checkIn");
                              setBookingsSortDir("desc");
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Check-in</span>
                            {bookingsSortBy === "checkIn" ? (
                              bookingsSortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-gray-400" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => {
                            if (bookingsSortBy === "checkOut") {
                              setBookingsSortDir(bookingsSortDir === "asc" ? "desc" : "asc");
                            } else {
                              setBookingsSortBy("checkOut");
                              setBookingsSortDir("desc");
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Check-out</span>
                            {bookingsSortBy === "checkOut" ? (
                              bookingsSortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-gray-400" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => {
                            if (bookingsSortBy === "amount") {
                              setBookingsSortDir(bookingsSortDir === "asc" ? "desc" : "asc");
                            } else {
                              setBookingsSortBy("amount");
                              setBookingsSortDir("desc");
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Amount</span>
                            {bookingsSortBy === "amount" ? (
                              bookingsSortDir === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-gray-400" />
                            )}
                          </div>
                        </th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-3 sm:px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {bookingsLoading ? (
                        <TableRow hover={false}>
                          <td colSpan={8} className="px-3 sm:px-4 py-12 text-center">
                            <div className="flex items-center justify-center">
                              <div className="animate-spin rounded-full h-8 w-8 border-2 border-solid border-gray-300 border-t-brand"></div>
                            </div>
                          </td>
                        </TableRow>
                      ) : bookings.length === 0 ? (
                        <TableRow hover={false}>
                          <td colSpan={8} className="px-3 sm:px-4 py-12 text-center">
                            <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No bookings found</p>
                            <p className="text-sm text-gray-400 mt-1">Bookings for this owner&apos;s properties will appear here</p>
                          </td>
                        </TableRow>
                      ) : (
                        bookings.map((b: any) => {
                          const getStatusBadge = () => {
                            const statusLower = b.status?.toLowerCase() || '';
                            if (statusLower.includes('confirmed') || statusLower.includes('active')) {
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {b.status}
                                </span>
                              );
                            }
                            if (statusLower.includes('pending') || statusLower.includes('new')) {
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                                  <Clock className="h-3 w-3" />
                                  {b.status}
                                </span>
                              );
                            }
                            if (statusLower.includes('cancel') || statusLower.includes('reject')) {
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-medium">
                                  <XCircle className="h-3 w-3" />
                                  {b.status}
                                </span>
                              );
                            }
                            if (statusLower.includes('check') || statusLower.includes('complete')) {
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {b.status}
                                </span>
                              );
                            }
                            return (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
                                {b.status}
                              </span>
                            );
                          };

                          return (
                            <TableRow key={b.id} className="[&>td]:shadow-[inset_0_1px_0_0_#f3f4f6]">
                              <td className="px-3 sm:px-4 py-3 text-sm font-medium text-gray-900">#{b.id}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                  <Home className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                  <span className="truncate">{b.property?.title ?? '-'}</span>
                                </div>
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                  <span className="truncate">{b.guestName ?? b.user?.name ?? b.user?.email ?? '-'}</span>
                                </div>
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                                <div>{new Date(b.checkIn).toLocaleDateString()}</div>
                                <div className="text-xs text-gray-500">{new Date(b.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                                <div>{new Date(b.checkOut).toLocaleDateString()}</div>
                                <div className="text-xs text-gray-500">{new Date(b.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm font-semibold text-gray-900">
                                {b.totalAmount ? Number(b.totalAmount).toLocaleString() : '-'}
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm">{getStatusBadge()}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm">
                                <div className="flex justify-center">
                                  <Link
                                    href={`/admin/management/bookings/${b.id}`}
                                    className="p-2 rounded-lg text-brand hover:bg-brand/10 transition-all duration-200"
                                    title="View booking details"
                                  >
                                    <Eye className="h-5 w-5" />
                                  </Link>
                                </div>
                              </td>
                            </TableRow>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card Layout */}
                <div className="md:hidden [&>*+*]:shadow-[inset_0_1px_0_0_#e5e7eb]">
                  {bookingsLoading ? (
                    <div className="p-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-solid border-gray-300 border-t-brand mx-auto"></div>
                    </div>
                  ) : bookings.length === 0 ? (
                    <div className="p-8 text-center">
                      <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 font-medium">No bookings found</p>
                    </div>
                  ) : (
                    bookings.map((b: any) => {
                      const getStatusBadge = () => {
                        const statusLower = b.status?.toLowerCase() || '';
                        if (statusLower.includes('confirmed') || statusLower.includes('active')) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium">
                              <CheckCircle2 className="h-3 w-3" />
                              {b.status}
                            </span>
                          );
                        }
                        if (statusLower.includes('pending') || statusLower.includes('new')) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                              <Clock className="h-3 w-3" />
                              {b.status}
                            </span>
                          );
                        }
                        if (statusLower.includes('cancel') || statusLower.includes('reject')) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-medium">
                              <XCircle className="h-3 w-3" />
                              {b.status}
                            </span>
                          );
                        }
                        if (statusLower.includes('check') || statusLower.includes('complete')) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
                              <CheckCircle2 className="h-3 w-3" />
                              {b.status}
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
                            {b.status}
                          </span>
                        );
                      };

                      return (
                        <div key={b.id} className="p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex items-start justify-between mb-3">
              <div>
                              <div className="font-semibold text-gray-900">Booking #{b.id}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{getStatusBadge()}</div>
                            </div>
                            <Link
                              href={`/admin/management/bookings/${b.id}`}
                              className="p-2 rounded-lg text-brand hover:bg-brand/10 transition-all"
                            >
                              <Eye className="h-5 w-5" />
                            </Link>
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2 text-gray-700">
                              <Home className="h-4 w-4 text-gray-400 flex-shrink-0" />
                              <span className="truncate">{b.property?.title ?? '-'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-700">
                              <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                              <span className="truncate">{b.guestName ?? b.user?.name ?? b.user?.email ?? '-'}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 pt-3 shadow-[inset_0_1px_0_0_#f3f4f6]">
                              <div>
                                <div className="text-xs text-gray-500 mb-0.5">Check-in</div>
                                <div className="text-sm font-medium text-gray-900">{new Date(b.checkIn).toLocaleDateString()}</div>
                                <div className="text-xs text-gray-500">{new Date(b.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 mb-0.5">Check-out</div>
                                <div className="text-sm font-medium text-gray-900">{new Date(b.checkOut).toLocaleDateString()}</div>
                                <div className="text-xs text-gray-500">{new Date(b.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              </div>
                            </div>
                            {b.totalAmount && (
                              <div className="text-sm font-semibold text-gray-900 pt-3 shadow-[inset_0_1px_0_0_#f3f4f6]">
                                {Number(b.totalAmount).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Pagination */}
              {bookingsTotal > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 shadow-sm">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-sm text-gray-600">
                      Showing <span className="font-semibold text-gray-900">{Math.min((bookingsPage - 1) * BOOKINGS_PAGE_SIZE + 1, bookingsTotal)}</span> to <span className="font-semibold text-gray-900">{Math.min(bookingsPage * BOOKINGS_PAGE_SIZE, bookingsTotal)}</span> of <span className="font-semibold text-gray-900">{bookingsTotal}</span> bookings
              </div>
              <div className="flex items-center gap-2">
                      <button
                        onClick={() => setBookingsPage(p => Math.max(1, p - 1))}
                        disabled={bookingsPage === 1 || bookingsLoading}
                        className="p-2 border border-gray-300 rounded-lg hover:border-brand hover:text-brand transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Previous bookings page"
                        title="Previous bookings page"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(Math.ceil(bookingsTotal / BOOKINGS_PAGE_SIZE), 5) }, (_, i) => {
                          const pageNum = i + 1;
                          if (pageNum > Math.ceil(bookingsTotal / BOOKINGS_PAGE_SIZE)) return null;
                          return (
                            <button
                              key={pageNum}
                              onClick={() => setBookingsPage(pageNum)}
                              disabled={bookingsLoading}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                                bookingsPage === pageNum
                                  ? "bg-brand text-white shadow-md"
                                  : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-300"
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
              </div>
                      <button
                        onClick={() => setBookingsPage(p => Math.min(Math.ceil(bookingsTotal / BOOKINGS_PAGE_SIZE), p + 1))}
                        disabled={bookingsPage >= Math.ceil(bookingsTotal / BOOKINGS_PAGE_SIZE) || bookingsLoading}
                        className="p-2 border border-gray-300 rounded-lg hover:border-brand hover:text-brand transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Next bookings page"
                        title="Next bookings page"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
            </div>
                  </div>
                </div>
              )}
        </div>
      )}

          {tab === "notes" && (
            <div className="space-y-4">
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Add Note <span className="text-gray-400 font-normal">(visible to admins only)</span>
                </label>
                <textarea
                  className="w-full min-h-[100px] px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-brand transition-all resize-none text-sm sm:text-base box-border"
                  placeholder="Write a private note..."
                  value={note}
                  onChange={e=>setNote(e.target.value)}
                />
          </div>
              <button
                className="px-4 py-2.5 bg-brand text-white rounded-lg text-sm sm:text-base font-medium hover:bg-brand/90 active:bg-brand/80 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={addNote}
                disabled={actionLoading || !note.trim()}
              >
                {actionLoading ? "Adding..." : "Add Note"}
              </button>
              <div className="text-xs text-gray-500">
                Notes are logged with your admin ID and timestamp.
              </div>
        </div>
      )}
        </div>
          )}
      </div>

          {tab === "overview" && (
            <>
          {/* Owner Information Card */}
          <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-start gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Owner Information</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Email</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900 truncate">{owner.email}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Phone</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900 truncate">{owner.phone || "-"}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Joined Date</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900">
                        {new Date(owner.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 ml-6 mt-0.5">
                      {new Date(owner.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Properties</div>
                    <button
                      type="button"
                      onClick={() => setTab("properties")}
                      className="flex items-center gap-2 min-w-0 rounded-md border-0 bg-transparent p-0 text-left hover:text-brand transition-colors"
                      title="View this owner's properties"
                    >
                      <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900">{owner._count.properties}</span>
                      <span className="text-xs text-brand font-medium">View</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Financial Summary Card */}
          <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-start gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Financial Summary</h2>

                {/* ── Stream 1: bookings ── */}
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bookings</span>
                  <span className="text-xs text-gray-400">{snap.revenue.paidCount} paid {snap.revenue.paidCount === 1 ? "invoice" : "invoices"}</span>
                </div>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
                    <span className="text-xs sm:text-sm font-medium text-gray-700 truncate pr-2">Gross Revenue</span>
                    <span className="text-base sm:text-lg font-bold text-gray-900 flex-shrink-0">{fmt(snap.revenue.grossSum)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="p-3 sm:p-4 bg-blue-50 rounded-lg min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Commission</div>
                      <div className="text-base sm:text-lg font-bold text-blue-900 mt-1 break-words">{fmt(snap.revenue.commissionSum)}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">NoLSAF earns</div>
                    </div>
                    <div className="p-3 sm:p-4 bg-emerald-50 rounded-lg ring-2 ring-emerald-200 min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Net Revenue</div>
                      <div className="text-base sm:text-lg font-bold text-emerald-900 mt-1 break-words">{fmt(snap.revenue.netSum)}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">Owner keeps</div>
                    </div>
                  </div>
                </div>

                {/* ── Stream 2: NRMS subscription billing ──
                    A separate revenue stream: the owner pays NoLSAF for the
                    tool, so the whole amount is NoLSAF revenue with no partner
                    split. Same definition as the platform finance overview. */}
                <div className="mt-6 pt-5 shadow-[inset_0_1px_0_0_#e5e7eb]">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <Radar className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                      NRMS billing
                    </span>
                    {snap.nrmsBilling ? (
                      <span className="text-xs text-gray-400">
                        {snap.nrmsBilling.accountsCount} {snap.nrmsBilling.accountsCount === 1 ? "property account" : "property accounts"}
                        {snap.nrmsBilling.paymentsCount > 0
                          ? ` · ${snap.nrmsBilling.paymentsCount} ${snap.nrmsBilling.paymentsCount === 1 ? "payment" : "payments"}`
                          : ""}
                      </span>
                    ) : null}
                  </div>

                  {!snap.nrmsBilling || snap.nrmsBilling.accountsCount === 0 ? (
                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                      No NRMS billing account. This owner has not run a property on NRMS.
                    </div>
                  ) : (
                    <div className="space-y-3 sm:space-y-4">
                      <div className="p-3 sm:p-4 bg-violet-50 rounded-lg ring-2 ring-violet-200 min-w-0">
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">NRMS Revenue Collected</div>
                        <div className="text-base sm:text-lg font-bold text-violet-900 mt-1 break-words">{fmt(snap.nrmsBilling.collected, snap.nrmsBilling.currency)}</div>
                        <div className="mt-0.5 text-[11px] text-gray-500">NoLSAF keeps all of it, no partner split</div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <div className="p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Billed To Date</div>
                          <div className="text-sm sm:text-base font-bold text-gray-900 mt-1 break-words">{fmt(snap.nrmsBilling.billed, snap.nrmsBilling.currency)}</div>
                          <div className="mt-0.5 text-[11px] text-gray-500">
                            {snap.nrmsBilling.statementsCount} {snap.nrmsBilling.statementsCount === 1 ? "statement" : "statements"}
                          </div>
                        </div>
                        <div className="p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Not Yet Billed</div>
                          <div className="text-sm sm:text-base font-bold text-gray-900 mt-1 break-words">{fmt(snap.nrmsBilling.unbilledUsage, snap.nrmsBilling.currency)}</div>
                          <div className="mt-0.5 text-[11px] text-gray-500">Usage earned, statement not closed</div>
                        </div>
                      </div>
                      {snap.nrmsBilling.outstanding > 0 ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200 min-w-0">
                          <span className="text-xs sm:text-sm font-medium text-amber-800 truncate pr-2">
                            Awaiting collection ({snap.nrmsBilling.outstandingCount} open)
                          </span>
                          <span className="text-sm sm:text-base font-bold text-amber-900 flex-shrink-0">{fmt(snap.nrmsBilling.outstanding, snap.nrmsBilling.currency)}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Business Partners Card */}
          <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Handshake className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Business Partners</h2>
                  <span className="text-xs text-gray-400">
                    {(partners?.merchantCount ?? 0) + (partners?.agentCount ?? 0)} total
                  </span>
                </div>

                {/* ── Operating companies ── */}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <Briefcase className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                    Operating companies
                  </span>
                  <span className="text-xs text-gray-400">{partners?.merchantCount ?? 0}</span>
                </div>
                {/* Abandoned drafts are filtered out of the list, but the
                    properties they still hold are not silently dropped. */}
                {partners && partners.hiddenDraftCount > 0 ? (
                  <p className="m-0 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                    {partners.hiddenDraftCount} unnamed draft {partners.hiddenDraftCount === 1 ? "company" : "companies"} not
                    listed, covering {partners.hiddenDraftProperties}{" "}
                    {partners.hiddenDraftProperties === 1 ? "property" : "properties"}. Onboarding was started but no company
                    details were ever entered.
                  </p>
                ) : null}
                {!partners || partners.merchants.length === 0 ? (
                  <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                    No named company is registered to operate this owner&apos;s properties.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {partners.merchants.map((m) => {
                      // "Partner since" and "Registered" are the same day for a
                      // company created during onboarding, so only show the
                      // second when it actually differs.
                      const sinceDay = m.since ? fmtDay(m.since) : null;
                      const registeredDay = m.registeredAt ? fmtDay(m.registeredAt) : null;
                      const showRegistered = registeredDay !== null && registeredDay !== sinceDay;
                      const identifiers = [
                        m.registrationNumber ? `Reg. ${m.registrationNumber}` : null,
                        m.tin ? `TIN ${m.tin}` : null,
                        m.country,
                      ].filter(Boolean) as string[];

                      return (
                        <div key={m.id} className="rounded-lg bg-gray-50 p-3 sm:p-4 ring-1 ring-gray-200 min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className={`text-sm font-semibold truncate ${m.name ? "text-gray-900" : "text-gray-400 italic"}`}>
                                {m.name ?? "Company not named yet"}
                              </div>
                              {m.legalName && m.legalName !== m.name ? (
                                <div className="text-xs text-gray-500 truncate">{m.legalName}</div>
                              ) : null}
                            </div>
                            <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${partnerTone(m.status)}`}>
                              {prettyStage(m.status)}
                            </span>
                          </div>

                          {/* One readable line of facts beats a grid that is
                              mostly "Not provided". */}
                          <div className="mt-2 text-xs text-gray-600">
                            {sinceDay ? `Partner since ${sinceDay}` : "Partnership start not recorded"}
                            {` · ${m.propertyCount} ${m.propertyCount === 1 ? "property" : "properties"}`}
                            {showRegistered ? ` · Company registered ${registeredDay}` : ""}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {identifiers.length > 0
                              ? identifiers.join(" · ")
                              : "Registration number and TIN not provided yet"}
                          </div>

                          {m.properties.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {m.properties.map((title, i) => (
                                <span
                                  key={`${m.id}-${i}`}
                                  className="inline-flex max-w-full items-center rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-gray-200"
                                >
                                  <span className="truncate">{title}</span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Travel agencies ── */}
                <div className="mt-6 pt-5 shadow-[inset_0_1px_0_0_#e5e7eb]">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <Users className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                      Travel agencies
                    </span>
                    <span className="text-xs text-gray-400">
                      {partners?.agentCount ?? 0}
                      {partners && partners.agentCount > 0 ? ` · ${partners.activeAgentCount} active` : ""}
                    </span>
                  </div>
                  {!partners || partners.agents.length === 0 ? (
                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                      No travel agency sells this owner&apos;s rooms.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {partners.agents.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200 min-w-0">
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold truncate ${a.name ? "text-gray-900" : "text-gray-400 italic"}`}>
                              {a.name ?? "Agency not named yet"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {a.since ? `Partner since ${fmtDay(a.since)}` : "Not selling yet"}
                              {` · ${a.propertyCount} ${a.propertyCount === 1 ? "property" : "properties"}`}
                            </div>
                          </div>
                          {/* Two separate facts. The link status is the
                              partnership; verification is NoLSAF's own KYC on
                              the agency. Unlabelled chips read as one thing. */}
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            {a.verificationStatus !== "VERIFIED" ? (
                              <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                                KYC {prettyStage(a.verificationStatus).toLowerCase()}
                              </span>
                            ) : null}
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${partnerTone(a.status)}`}>
                              {prettyStage(a.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

            </>
          )}
        </div>

        {/* Sidebar - Actions. Sticky so the admin's controls stay reachable
            whichever tab the content column is showing. */}
        <div className="space-y-4 sm:space-y-6 min-w-0 lg:sticky lg:top-6 lg:self-start">
          {/* Account Actions */}
          <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Shield className="h-4 w-4 text-blue-600" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900">Account Actions</h3>
            </div>
            <div className="space-y-2 sm:space-y-3">
              {owner.suspendedAt ? (
                <button
                  className="w-full px-4 py-2.5 sm:py-3 bg-green-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-green-700 active:bg-green-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  onClick={unsuspend}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-solid border-white border-t-transparent"></div>
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
                      Suspend Owner
                    </button>
                  ) : (
                    <div className="space-y-3 p-3 sm:p-4 bg-red-50 rounded-lg border border-red-200">
        <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                          Reason for Suspension <span className="text-red-600">*</span>
                        </label>
                        <textarea
                          className="w-full min-h-[100px] px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none text-xs sm:text-sm box-border"
                          placeholder="Please provide a clear reason for suspending this owner (e.g., policy violation, non-compliance, etc.)"
                          value={suspendReason}
                          onChange={(e) => setSuspendReason(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">This notification will be sent to the owner.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          id="notify-owner"
                          checked={notifyOwner}
                          onChange={(e) => setNotifyOwner(e.target.checked)}
                          className="mt-1 h-4 w-4 text-brand border-gray-300 rounded focus:ring-brand flex-shrink-0"
                        />
                        <label htmlFor="notify-owner" className="text-xs sm:text-sm text-gray-700">
                          Send notification to owner about this suspension
                        </label>
        </div>
        <div className="flex gap-2">
                        <button
                          className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-red-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                          onClick={handleSuspendSubmit}
                          disabled={actionLoading || !suspendReason.trim()}
                        >
                          {actionLoading ? (
                            <>
                              <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-solid border-white border-t-transparent"></div>
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
                  className="w-full px-4 py-2.5 sm:py-3 bg-brand text-white rounded-lg text-sm sm:text-base font-medium hover:bg-brand/90 active:bg-brand/80 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  onClick={handleImpersonateClick}
                  disabled={actionLoading}
                >
                  <Copy className="h-4 w-4" />
                  Impersonate
                </button>
              ) : (
                <div className="space-y-3 p-3 sm:p-4 bg-brand/5 rounded-lg border border-brand/20">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                      Reason for Impersonation <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      className="w-full min-h-[80px] px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-brand transition-all resize-none text-xs sm:text-sm box-border"
                      placeholder="Please provide a reason for impersonating this owner (e.g., customer support, troubleshooting, etc.)"
                      value={impersonateReason}
                      onChange={(e) => setImpersonateReason(e.target.value)}
                    />
                    <p className="text-xs text-gray-500 mt-1">This action will be logged in the audit trail.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-brand text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-brand/90 active:bg-brand/80 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
                      onClick={confirmImpersonate}
                      disabled={actionLoading || !impersonateReason.trim()}
                    >
                      {actionLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-solid border-white border-t-transparent"></div>
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
              
              {/* Send Notification Button */}
              <button
                className="w-full px-4 py-2.5 sm:py-3 bg-blue-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                onClick={() => setShowNotificationForm(!showNotificationForm)}
                disabled={actionLoading}
              >
                <Bell className="h-4 w-4" />
                {showNotificationForm ? "Hide Notification Form" : "Send Notification"}
              </button>
              
              {/* Notification Form */}
              {showNotificationForm && (
                <div className="space-y-3 p-3 sm:p-4 bg-blue-50 rounded-lg border border-blue-200 mt-3">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-gray-900 mb-2">
                      Subject <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-xs sm:text-sm box-border"
                      placeholder="e.g., Account Suspension, KYC Approval, Promotion, etc."
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
                      placeholder="Enter the notification message to be sent to the owner..."
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
                      {actionLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-solid border-white border-t-transparent"></div>
                          <span className="hidden sm:inline">Sending...</span>
                          <span className="sm:hidden">...</span>
                        </>
                      ) : (
                        <>
                          <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                          <span className="hidden sm:inline">Send Notification</span>
                          <span className="sm:hidden">Send</span>
                        </>
                      )}
                    </button>
                    <button
                      className="p-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
                      onClick={() => {
                        setShowNotificationForm(false);
                        setNotificationSubject("");
                        setNotificationMessage("");
                      }}
                      disabled={actionLoading}
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
      </div>

          {/* KYC Actions */}
          {owner.kycStatus !== 'APPROVED_KYC' && (
            <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">KYC Actions</h3>
          </div>
              <div className="space-y-2 sm:space-y-3">
                {owner.kycStatus !== 'APPROVED_KYC' && (
                  <button
                    className="w-full px-4 py-2.5 sm:py-3 bg-emerald-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-emerald-700 active:bg-emerald-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    onClick={kycApprove}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-solid border-white border-t-transparent"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Approve KYC
                      </>
                    )}
                  </button>
                )}
                {owner.kycStatus !== 'REJECTED_KYC' && (
                  <button
                    className="w-full px-4 py-2.5 sm:py-3 bg-red-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-red-700 active:bg-red-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    onClick={kycReject}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-solid border-white border-t-transparent"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" />
                        Reject KYC
                      </>
                    )}
                  </button>
                )}
                </div>
            </div>
          )}

          {/* Audit & History */}
          <div className="bg-white rounded-xl ring-1 ring-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
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
function CapabilityTile({
  icon,
  title,
  active,
  headline,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  headline: string;
  meta: string | null;
}) {
  return (
    <div className={`rounded-lg px-3.5 py-3 ring-1 ${active ? "bg-emerald-50 ring-emerald-200" : "bg-gray-50 ring-gray-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${active ? "text-emerald-700" : "text-gray-500"}`}>
          {icon}
          {title}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            active ? "bg-white text-emerald-700 ring-1 ring-emerald-200" : "bg-white text-gray-500 ring-1 ring-gray-200"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-gray-300"}`} aria-hidden />
          {active ? "Active" : "Off"}
        </span>
      </div>
      <div className={`mt-1.5 text-sm font-semibold ${active ? "text-emerald-900" : "text-gray-700"}`}>{headline}</div>
      {meta ? <div className="mt-0.5 text-xs text-gray-500 truncate">{meta}</div> : null}
    </div>
  );
}

function PropertyCard({ property }: { property: Property }) {
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
      href={`/admin/properties/previews?previewId=${property.id}`}
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
