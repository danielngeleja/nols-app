"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet, Calendar, Eye, DollarSign, Building2, Receipt, FileText, Download, ChevronLeft, ChevronRight, ArrowUpDown, CheckSquare, Square, Printer, Filter, X, CheckCircle2, ArrowUp, ArrowDown, HandCoins, CreditCard, Info } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import TableRow from "@/components/TableRow";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import Link from "next/link";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type InvoiceRow = {
  id: number;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  status: string;
  issuedAt: string; // ISO
  total: number;
  commissionPercent: number;
  commissionAmount: number;
  taxPercent: number;
  netPayable: number;
  booking: { id: number; property: { id: number; title: string } };
  effectiveCommissionPercent?: number;
  financialPreview?: {
    grossTotal: number;
    baseAmount: number;
    commissionPercent: number;
    commissionAmount: number;
    taxPercent: number;
    taxAmount: number;
    netPayable: number;
  };
};

function isOwnerClaimInvoice(inv: InvoiceRow) {
  const n = String(inv.invoiceNumber ?? "");
  return n.toUpperCase().startsWith("OINV-");
}

function paidStatusLabel(inv?: InvoiceRow | null) {
  return inv && isOwnerClaimInvoice(inv) ? "Disbursed" : "Paid";
}

function bulkCompletionVerb(invoices: InvoiceRow[]) {
  if (invoices.length > 0 && invoices.every((inv) => isOwnerClaimInvoice(inv))) {
    return "Mark Disbursed";
  }
  if (invoices.length > 0 && invoices.every((inv) => !isOwnerClaimInvoice(inv))) {
    return "Mark Paid";
  }
  return "Mark Completed";
}

function bulkCompletionNoun(invoices: InvoiceRow[]) {
  if (invoices.length > 0 && invoices.every((inv) => isOwnerClaimInvoice(inv))) {
    return "disbursed";
  }
  if (invoices.length > 0 && invoices.every((inv) => !isOwnerClaimInvoice(inv))) {
    return "paid";
  }
  return "completed";
}

function isDraftStatus(statusRaw: string) {
  return String(statusRaw || "").toUpperCase() === "DRAFT";
}

function invoiceTypeInfo(inv: InvoiceRow) {
  const n = String(inv.invoiceNumber ?? "").toUpperCase();
  if (n.startsWith("OINV-")) {
    return { label: "Owner Claim", description: "Owner payout request (admin approval flow)" };
  }
  if (n.startsWith("INV-")) {
    return { label: "Customer Payment", description: "Customer payment record (booking paid)" };
  }
  return { label: "Invoice", description: "" };
}

function InvoiceTypeIcon({ inv, size = "sm" }: { inv: InvoiceRow; size?: "sm" | "xs" }) {
  const { label, description } = invoiceTypeInfo(inv);
  const n = String(inv.invoiceNumber ?? "").toUpperCase();

  const isOwnerClaim = n.startsWith("OINV-");
  const isCustomerPayment = n.startsWith("INV-");

  const Icon = isOwnerClaim ? HandCoins : isCustomerPayment ? CreditCard : Info;
  const colorClass = isOwnerClaim
    ? "text-amber-700"
    : isCustomerPayment
      ? "text-blue-700"
      : "text-gray-600";

  const iconSizeClass = size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4";
  const buttonSizeClass = size === "xs" ? "p-1" : "p-1.5";

  const tooltipText = description ? `${label}: ${description}` : label;

  return (
    <div className="relative group/tooltip inline-flex flex-shrink-0">
      <button
        type="button"
        className={`${buttonSizeClass} inline-flex items-center justify-center ${colorClass} focus:outline-none focus:ring-2 focus:ring-[#02665e]/20`}
        aria-label={tooltipText}
        onClick={(e) => {
          // Keep it simple: tap focuses the button (mobile) so tooltip can show.
          e.preventDefault();
          try {
            (e.currentTarget as HTMLButtonElement).focus();
          } catch {
            // ignore
          }
        }}
      >
        <Icon className={iconSizeClass} aria-hidden />
      </button>

      {!!(label || description) && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 max-w-[calc(100vw-1rem)] translate-x-0 whitespace-normal break-words rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-900 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
        >
          <div className="font-semibold">{label}</div>
          {description ? <div className="mt-0.5 text-[11px] text-gray-600">{description}</div> : null}
        </div>
      )}
    </div>
  );
}

function statusScore(statusRaw: string) {
  const s = String(statusRaw || "").toUpperCase();
  switch (s) {
    case "PAID":
      return 60;
    case "APPROVED":
      return 50;
    case "PROCESSING":
      return 40;
    case "VERIFIED":
      return 30;
    case "REQUESTED":
      return 20;
    case "REJECTED":
      return 10;
    default:
      return 0;
  }
}

function pickBetterInvoice(a: InvoiceRow, b: InvoiceRow) {
  // We keep both records in DB (public payment invoice: INV-..., owner-claim invoice: OINV-...).
  // For the Admin list, show a single row per booking:
  // - Before owner submits/requests payout, show the public invoice (INV-...)
  // - After owner submits (OINV status != DRAFT), switch to the owner-claim invoice (OINV-...)
  const aIsClaim = isOwnerClaimInvoice(a);
  const bIsClaim = isOwnerClaimInvoice(b);
  if (aIsClaim !== bIsClaim) {
    const claim = aIsClaim ? a : b;
    const normal = aIsClaim ? b : a;
    if (!isDraftStatus(claim.status)) return claim;
    return normal;
  }

  // Prefer higher lifecycle status.
  const as = statusScore(a.status);
  const bs = statusScore(b.status);
  if (as !== bs) return as > bs ? a : b;

  // Prefer the most recently issued.
  const at = +new Date(a.issuedAt);
  const bt = +new Date(b.issuedAt);
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at > bt ? a : b;

  // Finally, prefer higher id.
  return a.id >= b.id ? a : b;
}

function collapseMirrorInvoices(rows: InvoiceRow[]) {
  const map = new Map<number, InvoiceRow>();
  const firstIndex = new Map<number, number>();

  rows.forEach((inv, idx) => {
    const bookingId = Number(inv.booking?.id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) return;
    if (!firstIndex.has(bookingId)) firstIndex.set(bookingId, idx);

    const existing = map.get(bookingId);
    if (!existing) {
      map.set(bookingId, inv);
      return;
    }
    map.set(bookingId, pickBetterInvoice(existing, inv));
  });

  return Array.from(map.entries())
    .sort((a, b) => (firstIndex.get(a[0]) ?? 0) - (firstIndex.get(b[0]) ?? 0))
    .map(([, inv]) => inv);
}

export default function AdminRevenue() {
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [date, setDate] = useState<string | string[]>("");
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // keep legacy from/to in sync with the DatePicker selection
  useEffect(() => {
    if (!date) return;
    if (Array.isArray(date)) {
      setFrom(date[0] || "");
      setTo(date[1] || "");
    } else {
      setFrom(date as string);
      setTo(date as string);
    }
  }, [date]);

  // autofocus search input on load
  useEffect(() => {
    try {
      searchRef.current?.focus();
    } catch (e) {
      // ignore if not available
    }
  }, []);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  
  // Sorting
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  
  // Advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [propertyFilter, setPropertyFilter] = useState<string>("");
  const [amountMin, setAmountMin] = useState<string>("");
  const [amountMax, setAmountMax] = useState<string>("");
  const [owners, setOwners] = useState<Array<{ id: number; name: string | null; email: string }>>([]);
  const [properties, setProperties] = useState<Array<{ id: number; title: string }>>([]);

  // Load owners and properties for filters (optional - filters will work without this)
  useEffect(() => {
    (async () => {
      try {
        // Try to load owners and properties, but don't fail if endpoints don't exist
        const [ownersRes, propertiesRes] = await Promise.all([
          api.get("/api/admin/users", { 
            params: { role: "OWNER", page: 1, pageSize: 100 },
            headers: { 'Accept': 'application/json' },
          }).catch((err: any) => {
            console.warn("Failed to load owners for filter:", err?.response?.status || err?.message);
            return { data: { data: [] } };
          }),
          api.get("/api/admin/properties", { 
            params: { status: "APPROVED", page: 1, pageSize: 100 },
            headers: { 'Accept': 'application/json' },
          }).catch((err: any) => {
            console.warn("Failed to load properties for filter:", err?.response?.status || err?.message);
            return { data: { items: [] } };
          }),
        ]);
        const ownersData = (ownersRes.data as any)?.data || [];
        const propertiesData = (propertiesRes.data as any)?.items || [];
        setOwners(ownersData.map((u: any) => ({ id: u.id, name: u.name, email: u.email || "" })));
        setProperties(propertiesData.map((p: any) => ({ id: p.id, title: p.title || "" })));
      } catch (e) {
        // ignore - filters will still work with manual entry
        console.warn("Error loading filter data:", e);
      }
    })();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params: any = {
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
        page,
        pageSize,
      };
      
      // Advanced filters
      if (ownerFilter) params.ownerId = Number(ownerFilter);
      if (propertyFilter) params.propertyId = Number(propertyFilter);
      if (amountMin) params.amountMin = Number(amountMin);
      if (amountMax) params.amountMax = Number(amountMax);
      
      // Sorting
      if (sortBy) {
        params.sortBy = sortBy;
        params.sortDir = sortDir;
      }

      // If "New" is selected we treat it as REQUESTED + VERIFIED (combine both)
      if (status === "REQUESTED") {
        const [r1, r2] = await Promise.all([
          api.get<{ items: InvoiceRow[]; total: number }>("/api/admin/revenue/invoices", {
            params: { ...params, status: "REQUESTED" },
          }),
          api.get<{ items: InvoiceRow[]; total: number }>("/api/admin/revenue/invoices", {
            params: { ...params, status: "VERIFIED" },
          }),
        ]);

        // merge and dedupe by id
        const map = new Map<number, InvoiceRow>();
        (r1.data.items || []).forEach((it) => map.set(it.id, it));
        (r2.data.items || []).forEach((it) => map.set(it.id, it));
        let merged = Array.from(map.values());
        
        // Client-side sorting for merged results
        if (sortBy) {
          merged = [...merged].sort((a, b) => {
            let aVal: any, bVal: any;
            switch (sortBy) {
              case "invoiceNumber":
                aVal = a.invoiceNumber ?? a.id;
                bVal = b.invoiceNumber ?? b.id;
                break;
              case "issuedAt":
                aVal = new Date(a.issuedAt).getTime();
                bVal = new Date(b.issuedAt).getTime();
                break;
              case "total":
                aVal = Number(a.total);
                bVal = Number(b.total);
                break;
              case "netPayable":
                aVal = Number(a.netPayable);
                bVal = Number(b.netPayable);
                break;
              default:
                return 0;
            }
            if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
            if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
            return 0;
          });
        }
        
        setItems(q?.trim() ? merged : collapseMirrorInvoices(merged));
        // Use the larger total from the two requests
        setTotal(Math.max(r1.data.total || 0, r2.data.total || 0));
      } else {
        const r = await api.get<{ items: InvoiceRow[]; total: number }>("/api/admin/revenue/invoices", {
          params: { ...params, status: status || undefined },
        });
        setItems(q?.trim() ? (r.data.items || []) : collapseMirrorInvoices(r.data.items || []));
        setTotal(r.data.total || 0);
      }
    } catch (e: any) {
      // Handle errors gracefully - log but don't crash
      console.error("Error loading invoices:", e?.response?.data || e?.message || e);
      setItems([]);
      setTotal(0);
      
      // If it's a network error or non-JSON response, show a user-friendly message
      if (e?.response?.status === 0 || !e?.response?.data) {
        console.warn("Network error or non-JSON response received");
      }
    } finally {
      setLoading(false);
    }
  }

  // reusable counts fetch (used on mount, when date range changes, and when invoices update via socket)
  const fetchCounts = useMemo(() => {
    return async function () {
      try {
        const statuses = ["", "REQUESTED", "VERIFIED", "APPROVED", "PAID", "REJECTED"];
        const map: Record<string, number> = {};

        // helper to fetch total for a given status
        const getTotal = async (s: string) => {
          if (s === "") {
            const r = await api.get("/api/admin/revenue/invoices", { params: { from: from || undefined, to: to || undefined, page: 1, pageSize: 1 } });
            return (r?.data?.total ?? (Array.isArray(r?.data?.items) ? r.data.items.length : 0)) as number;
          }

          if (s === "REQUESTED") {
            // New = REQUESTED + VERIFIED
            const [a, b] = await Promise.all([
              api.get("/api/admin/revenue/invoices", { params: { status: "REQUESTED", from: from || undefined, to: to || undefined, page: 1, pageSize: 1 } }),
              api.get("/api/admin/revenue/invoices", { params: { status: "VERIFIED", from: from || undefined, to: to || undefined, page: 1, pageSize: 1 } }),
            ]);
            const ta = (a?.data?.total ?? (Array.isArray(a?.data?.items) ? a.data.items.length : 0)) as number;
            const tb = (b?.data?.total ?? (Array.isArray(b?.data?.items) ? b.data.items.length : 0)) as number;
            return ta + tb;
          }

          const r = await api.get("/api/admin/revenue/invoices", { params: { status: s || undefined, from: from || undefined, to: to || undefined, page: 1, pageSize: 1 } });
          return (r?.data?.total ?? (Array.isArray(r?.data?.items) ? r.data.items.length : 0)) as number;
        };

        for (const s of statuses) {
          try {
            map[s || ''] = await getTotal(s);
          } catch (e) {
            map[s || ''] = 0;
          }
        }

        setCounts(map);
      } catch (e) {
        // ignore failures
      }
    };
  }, [from, to]);

  // initial auth + first load
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload on filter change or page change
  useEffect(() => {
    setPage(1); // Reset to page 1 when filters change
    setSelectedIds(new Set()); // Clear selection when filters change
  }, [status, from, to, q, ownerFilter, propertyFilter, amountMin, amountMax]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, from, to, q, page, sortBy, sortDir, ownerFilter, propertyFilter, amountMin, amountMax]);

  // Fetch counts for each status so we can show badges on the filter pills (best-effort)
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // 🔌 Socket.io: refresh when an invoice is marked PAID by webhook/admin action
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Use direct API URL for Socket.IO in browser to ensure WebSocket works in dev
    // Convert http:// to ws:// for WebSocket connections
    const apiUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    
    let s: Socket | null = null;
    try {
      s = io(apiUrl, { 
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
        autoConnect: true,
        forceNew: false,
      });

      const refresh = () => {
        load();
        fetchCounts();
      };

      s.on("admin:invoice:paid", refresh);
      s.on("admin:invoice:status", refresh);
      s.on("connect", () => {
        console.debug("Socket.IO connected successfully");
      });
      s.on("connect_error", (err) => {
        // Only log as warning, don't throw - Socket.IO will retry
        console.warn("Socket.IO connection error:", err.message);
      });
      s.on("disconnect", (reason) => {
        console.log("Socket.IO disconnected:", reason);
      });
    } catch (err) {
      console.error("Failed to initialize Socket.IO:", err);
    }

    return () => {
      if (s) {
        try {
          s.off("admin:invoice:paid");
          s.off("admin:invoice:status");
          s.off("connect");
          s.off("connect_error");
          s.off("disconnect");
          s.disconnect();
        } catch (err) {
          console.warn("Error cleaning up Socket.IO:", err);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sumNet = useMemo(
    () => items.reduce((s, i) => s + Number(i.netPayable || 0), 0),
    [items]
  );

  const emptyMessage = useMemo(() => {
    if (status === "") return "No invoices.";
    if (status === "REQUESTED") return "No new invoices.";
    const map: Record<string, string> = {
      VERIFIED: "No verified invoices.",
      APPROVED: "No approved invoices.",
      PAID: "No paid or disbursed invoices.",
      REJECTED: "No rejected invoices.",
    };
    return map[status] ?? "No invoices.";
  }, [status]);

  const selectedApprovedInvoices = useMemo(
    () => items.filter((inv) => selectedIds.has(inv.id) && inv.status === "APPROVED"),
    [items, selectedIds]
  );
  const bulkMarkActionLabel = useMemo(
    () => bulkCompletionVerb(selectedApprovedInvoices),
    [selectedApprovedInvoices]
  );
  const bulkMarkActionNoun = useMemo(
    () => bulkCompletionNoun(selectedApprovedInvoices),
    [selectedApprovedInvoices]
  );

  // Bulk selection functions
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Bulk actions
  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Approve ${selectedIds.size} invoice(s)?`)) return;
    
    setBulkActionLoading(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        api.post(`/api/admin/revenue/invoices/${id}/approve`).catch(err => ({ error: err }))
      );
      await Promise.all(promises);
      await load();
      clearSelection();
      alert(`Successfully approved ${selectedIds.size} invoice(s)`);
    } catch (err) {
      console.error("Bulk approve failed", err);
      alert("Some invoices failed to approve. Please check individually.");
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function bulkMarkPaid() {
    if (selectedIds.size === 0) return;
    const referenceLabel = bulkMarkActionNoun === "disbursed" ? "disbursement reference" : "payment reference";
    const paymentRef = prompt(`Enter ${referenceLabel} for ${selectedIds.size} invoice(s):`);
    if (!paymentRef) return;
    
    setBulkActionLoading(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        api.post(`/api/admin/invoices/${id}/mark-paid`, { method: "BANK", ref: paymentRef }).catch(err => ({ error: err }))
      );
      await Promise.all(promises);
      await load();
      clearSelection();
      alert(`Successfully marked ${selectedIds.size} invoice(s) as ${bulkMarkActionNoun}`);
    } catch (err) {
      console.error("Bulk mark paid failed", err);
      alert(`Some invoices failed to mark as ${bulkMarkActionNoun}. Please check individually.`);
    } finally {
      setBulkActionLoading(false);
    }
  }

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // Sort handler
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  };

  function getStatusBadge(status: string, inv?: InvoiceRow) {
    const statusLower = status.toLowerCase();
    if (statusLower === 'paid') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium">
          {paidStatusLabel(inv)}
        </span>
      );
    }
    if (statusLower === 'approved') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium">
          {status}
        </span>
      );
    }
    if (statusLower === 'verified') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
          {status}
        </span>
      );
    }
    if (statusLower === 'requested') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-medium">
          {status}
        </span>
      );
    }
    if (statusLower === 'rejected') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-red-100 text-red-800 text-xs font-medium">
          {status}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
        {status}
      </span>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 min-w-0">
      {/* Header */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)" }}
      >
        {/* Decorative sparkline viz */}
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 220"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="860" cy="45"  r="200" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
          <circle cx="860" cy="45"  r="155" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
          <circle cx="820" cy="15"  r="115" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          <circle cx="28"  cy="208" r="130" stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
          {[44, 88, 132, 176].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.030)" strokeWidth="1" />
          ))}
          <polyline
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78"
            fill="none" stroke="white" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
          <polygon
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78 900,220 0,220"
            fill="white" fillOpacity="0.026"
          />
          <polyline
            points="0,200 100,186 200,194 300,172 400,180 500,160 600,168 700,148 800,156 900,136"
            fill="none" stroke="white" strokeOpacity="0.07" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          />
          {([[720,90],[560,108],[880,78],[240,145]] as [number,number][]).map(([px,py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3" fill="white" fillOpacity="0.22" />
          ))}
          <radialGradient id="revHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(10,92,130,0.45)" />
            <stop offset="100%" stopColor="rgba(10,92,130,0)" />
          </radialGradient>
          <ellipse cx="450" cy="110" rx="300" ry="140" fill="url(#revHeaderGlow)" />
        </svg>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 sm:py-14">
          {/* Icon orb */}
          <div
            className="mb-5 inline-flex items-center justify-center rounded-full"
            style={{
              width: 64, height: 64,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Wallet className="h-7 w-7" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>

          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            Revenue (Invoices &amp; Payouts)
          </h1>
          <p className="mt-2 text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.55)" }}>
            Invoices, payouts and exports
          </p>

          {/* Info tooltip */}
          <div className="mt-4 relative group/tooltip inline-flex">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-150 focus:outline-none"
              style={{
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.70)",
              }}
              aria-label="Invoice type info"
              onClick={(e) => {
                e.preventDefault();
                try { (e.currentTarget as HTMLButtonElement).focus(); } catch { /* ignore */ }
              }}
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
              <span>Invoice types</span>
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 w-72 max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-xl px-3 py-2.5 text-left text-xs opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
              style={{ background: "#0b2a38", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.85)" }}
            >
              <div className="font-semibold mb-1" style={{ color: "#fff" }}>Invoice types</div>
              <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                <span className="font-semibold" style={{ color: "#6ee7b7" }}>INV-</span>: Customer payment record (booking paid)
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                <span className="font-semibold" style={{ color: "#93c5fd" }}>OINV-</span>: Owner payout claim (approval flow)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
        <div className="px-4 pt-4 pb-4 sm:px-5 sm:pt-5 sm:pb-5 lg:px-6 lg:pt-6 lg:pb-6">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* Search */}
          <div className="w-full min-w-0 max-w-full">
            <div className="relative w-full min-w-0 max-w-full">
                <input
                  ref={searchRef}
                className="w-full min-w-0 max-w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-lg outline-none text-xs sm:text-sm transition-all box-border"
                  placeholder="Search # / receipt / property"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } }}
                  aria-label="Search invoices"
                style={{ boxSizing: 'border-box', maxWidth: '100%', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.90)' }}
                />
              <FileText className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 pointer-events-none" style={{ color: 'rgba(255,255,255,0.40)' }} />
        </div>
      </div>

          {/* Status Filters */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
          {[
            ["", "All"],
            ["REQUESTED", "New"],
            ["VERIFIED", "Verified"],
            ["APPROVED", "Approved"],
            ["PAID", "Paid / Disbursed"],
            ["REJECTED", "Rejected"],
          ].map(([val, label]) => {
            const v = val as string;
            const isActive = status === v || (v === "" && status === "");
            type PillColors = { activeBg: string; activeBorder: string; activeText: string; inactiveBg: string; inactiveBorder: string; badgeBg: string; badgeText: string };
            const colorMap: Record<string, PillColors> = {
              '':         { activeBg: 'rgba(255,255,255,0.18)', activeBorder: 'rgba(255,255,255,0.38)', activeText: '#ffffff',   inactiveBg: 'rgba(255,255,255,0.06)', inactiveBorder: 'rgba(255,255,255,0.12)', badgeBg: 'rgba(255,255,255,0.15)', badgeText: '#e2e8f0' },
              REQUESTED:  { activeBg: 'rgba(59,130,246,0.25)',  activeBorder: 'rgba(59,130,246,0.55)',  activeText: '#93c5fd',   inactiveBg: 'rgba(59,130,246,0.08)',  inactiveBorder: 'rgba(59,130,246,0.20)',  badgeBg: 'rgba(59,130,246,0.20)',  badgeText: '#93c5fd'  },
              VERIFIED:   { activeBg: 'rgba(245,158,11,0.25)',  activeBorder: 'rgba(245,158,11,0.55)',  activeText: '#fcd34d',   inactiveBg: 'rgba(245,158,11,0.08)',  inactiveBorder: 'rgba(245,158,11,0.20)',  badgeBg: 'rgba(245,158,11,0.20)',  badgeText: '#fcd34d'  },
              APPROVED:   { activeBg: 'rgba(16,185,129,0.25)',  activeBorder: 'rgba(16,185,129,0.55)',  activeText: '#6ee7b7',   inactiveBg: 'rgba(16,185,129,0.08)',  inactiveBorder: 'rgba(16,185,129,0.20)',  badgeBg: 'rgba(16,185,129,0.20)',  badgeText: '#6ee7b7'  },
              PAID:       { activeBg: 'rgba(20,184,166,0.25)',  activeBorder: 'rgba(20,184,166,0.55)',  activeText: '#5eead4',   inactiveBg: 'rgba(20,184,166,0.08)',  inactiveBorder: 'rgba(20,184,166,0.20)',  badgeBg: 'rgba(20,184,166,0.20)',  badgeText: '#5eead4'  },
              REJECTED:   { activeBg: 'rgba(239,68,68,0.25)',   activeBorder: 'rgba(239,68,68,0.55)',   activeText: '#fca5a5',   inactiveBg: 'rgba(239,68,68,0.08)',   inactiveBorder: 'rgba(239,68,68,0.20)',   badgeBg: 'rgba(239,68,68,0.20)',   badgeText: '#fca5a5'  },
            };
            const col = colorMap[v] ?? colorMap[''];
            const btnStyle = isActive
              ? { background: col.activeBg, border: `1.5px solid ${col.activeBorder}`, color: col.activeText }
              : { background: col.inactiveBg, border: `1.5px solid ${col.inactiveBorder}`, color: 'rgba(255,255,255,0.65)' };
            const badgeStyle = { background: col.badgeBg, color: col.badgeText };

            return (
              <button
                key={String(val) || "all"}
                type="button"
                onClick={() => { setStatus(v); setTimeout(() => load(), 0); }}
                className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs flex items-center gap-1 sm:gap-1.5 transition-all duration-200 flex-shrink-0 whitespace-nowrap"
                style={btnStyle}
              >
                  <span className="whitespace-nowrap">{String(label)}</span>
                <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full flex-shrink-0" style={badgeStyle}>{counts[v || ''] ?? 0}</span>
              </button>
            );
          })}

            {/* Date Picker */}
            <div className="relative flex-shrink-0">
          <button
            type="button"
            aria-label="Open date picker"
            title="Pick date range"
            onClick={() => {
              setPickerAnim(true);
              window.setTimeout(() => setPickerAnim(false), 350);
              setPickerOpen((v) => !v);
            }}
                className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs flex items-center justify-center transition-all flex-shrink-0"
                style={{ background: pickerAnim ? 'rgba(2,102,94,0.30)' : 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)' }}
          >
                <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
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

            {/* Advanced Filters Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs flex items-center gap-1.5 justify-center transition-all flex-shrink-0 whitespace-nowrap"
              style={showAdvancedFilters ? { background: 'rgba(2,102,94,0.30)', border: '1.5px solid rgba(2,102,94,0.65)', color: '#5eead4' } : { background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)' }}
            >
              <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>

            {/* Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs flex items-center gap-1.5 justify-center transition-all flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)' }}
              title="Print invoices"
            >
              <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
      </div>

          <div className="text-[11px] sm:text-xs" style={{ color: 'rgba(255,255,255,0.38)' }}>
            {q?.trim()
              ? "Search shows all invoice records (INV and OINV)."
              : "List shows one row per booking when both INV and OINV exist. Use search to view both."}
          </div>

          {/* Advanced Filters Panel */}
          {showAdvancedFilters && (
            <div className="pt-3 sm:pt-4 space-y-3 sm:space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>Advanced Filters</h3>
                <button
                  type="button"
                  onClick={() => {
                    setOwnerFilter("");
                    setPropertyFilter("");
                    setAmountMin("");
                    setAmountMax("");
                    setShowAdvancedFilters(false);
                  }}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-colors duration-200"
                  style={{ color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.06)' }}
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* Owner Filter */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Owner</label>
                  <select
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg outline-none text-xs sm:text-sm transition-all box-border"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.85)' }}
                  >
                    <option value="" style={{ background: '#0d2320' }}>All Owners</option>
                    {owners.map(owner => (
                      <option key={owner.id} value={owner.id} style={{ background: '#0d2320' }}>
                        {owner.name || owner.email} ({owner.id})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Property Filter */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Property</label>
                  <select
                    value={propertyFilter}
                    onChange={(e) => setPropertyFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg outline-none text-xs sm:text-sm transition-all box-border"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.85)' }}
                  >
                    <option value="" style={{ background: '#0d2320' }}>All Properties</option>
                    {properties.map(prop => (
                      <option key={prop.id} value={prop.id} style={{ background: '#0d2320' }}>
                        {prop.title} ({prop.id})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount Min */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Min Amount (TZS)</label>
                  <input
                    type="number"
                    value={amountMin}
                    onChange={(e) => setAmountMin(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg outline-none text-xs sm:text-sm transition-all box-border"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.85)' }}
                  />
                </div>

                {/* Amount Max */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Max Amount (TZS)</label>
                  <input
                    type="number"
                    value={amountMax}
                    onChange={(e) => setAmountMax(e.target.value)}
                    placeholder="No limit"
                    className="w-full px-3 py-2 rounded-lg outline-none text-xs sm:text-sm transition-all box-border"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.85)' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bulk Actions Bar */}
          {selectedIds.size > 0 && (
            <div className="pt-3 sm:pt-4 flex flex-wrap items-center gap-2 sm:gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
              <div className="text-xs sm:text-sm font-medium" style={{ color: 'rgba(255,255,255,0.80)' }}>
                {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''} selected
              </div>
              <button
                onClick={clearSelection}
                className="text-xs flex items-center gap-1"
                style={{ color: 'rgba(255,255,255,0.45)' }}
              >
                <X className="h-3 w-3" />
                Clear
              </button>
              <div className="flex-1"></div>
              <button
                onClick={bulkApprove}
                disabled={bulkActionLoading || !Array.from(selectedIds).some(id => {
                  const inv = items.find(i => i.id === id);
                  return inv && (inv.status === "VERIFIED" || inv.status === "REQUESTED");
                })}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all text-xs sm:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {bulkActionLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve Selected
                  </>
                )}
              </button>
              <button
                onClick={bulkMarkPaid}
                disabled={bulkActionLoading || !Array.from(selectedIds).some(id => {
                  const inv = items.find(i => i.id === id);
                  return inv && inv.status === "APPROVED";
                })}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all text-xs sm:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {bulkActionLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Receipt className="h-3.5 w-3.5" />
                    {bulkMarkActionLabel}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Total Summary & Export */}
      <div className="bg-gradient-to-r from-[#02665e]/10 to-emerald-50 rounded-xl border border-[#02665e]/20 p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#02665e]/20 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-[#02665e]" />
            </div>
            <div>
              <div className="text-xs sm:text-sm font-medium text-gray-600">Total Net (shown)</div>
              <div className="text-xl sm:text-2xl font-bold text-[#02665e]">
                {new Intl.NumberFormat('en-US').format(sumNet)} TZS
              </div>
            </div>
          </div>
          {/* Export Button - Only show for APPROVED invoices */}
          {status === "APPROVED" && items.length > 0 && (
            <button
              onClick={async () => {
                try {
                  const params = new URLSearchParams();
                  params.set("status", "APPROVED");
                  if (from) params.set("from", from);
                  if (to) params.set("to", to);
                  if (q) params.set("q", q);

                  const response = await fetch(`/api/admin/revenue/invoices/export.csv?${params.toString()}`, {
                    credentials: "include",
                  });

                  if (!response.ok) {
                    const errorText = await response.text().catch(() => "Unknown error");
                    console.error("CSV export failed:", response.status, errorText);
                    throw new Error(`Export failed: ${response.status} ${errorText}`);
                  }

                  const blob = await response.blob();

                  // Check if blob is actually CSV (not an error response)
                  if (blob.type && !blob.type.includes('csv') && !blob.type.includes('text')) {
                    const text = await blob.text();
                    console.error("CSV export returned non-CSV:", text);
                    throw new Error("Server returned an error instead of CSV");
                  }

                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `approved_invoices_payout_${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (err: any) {
                  console.error("Failed to export CSV:", err);
                  alert(`Failed to export CSV: ${err.message || "Please try again."}`);
                }
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#02665e] text-white rounded-lg hover:bg-[#02665e]/90 transition-all duration-200 shadow-sm hover:shadow-md font-medium text-sm sm:text-base whitespace-nowrap"
            >
              <Download className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              <span>Export Approved for Payout</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Card Layout */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 shadow-sm">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-emerald-600"></div>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <>
          {/* Mobile Cards - Hidden on md and up */}
          <div className="md:hidden space-y-3">
            {items.map((inv) => (
              <div
                key={inv.id}
                className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <button
                      onClick={() => toggleSelect(inv.id)}
                      className="p-1.5 hover:bg-gray-100 rounded-md transition-all duration-200 flex-shrink-0 mt-0.5 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                      title={selectedIds.has(inv.id) ? "Deselect" : "Select"}
                    >
                      {selectedIds.has(inv.id) ? (
                        <CheckSquare className="h-4 w-4 text-[#02665e] stroke-2" />
                      ) : (
                        <Square className="h-4 w-4 text-gray-400 stroke-1.5" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <InvoiceTypeIcon inv={inv} size="xs" />
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {inv.invoiceNumber ?? `#${inv.id}`}
                          </div>
                        </div>
                      </div>
                      {inv.receiptNumber && (
                        <div className="text-xs font-medium text-[#02665e] ml-6">Receipt: {inv.receiptNumber}</div>
                      )}
                    </div>
                  </div>
                  <Link
                href={`/admin/revenue/${inv.id}`}
                    className="p-2 rounded-lg text-[#02665e] hover:bg-[#02665e]/10 transition-all flex-shrink-0"
                    title="View invoice details"
                  >
                    <Eye className="h-5 w-5" />
                  </Link>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-900 truncate">{inv.booking.property.title}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">
                      {new Date(inv.issuedAt).toLocaleDateString()} {new Date(inv.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                    <div>
                        <div className="text-xs text-gray-500">Total Paid</div>
                        <div className="text-sm font-medium text-gray-900">{fmt(inv.financialPreview?.grossTotal ?? (Number(inv.netPayable || 0) + Number(inv.commissionAmount || 0)))}</div>
                    </div>
                    <div>
                        <div className="text-xs text-gray-500">Owner Payout</div>
                        <div className="text-sm font-bold text-[#02665e]">{fmt(inv.financialPreview?.netPayable ?? inv.netPayable)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Commission</div>
                        <div className="text-sm text-gray-900">
                          {Number(inv.financialPreview?.commissionPercent ?? inv.effectiveCommissionPercent ?? inv.commissionPercent) || 0}% ({fmt(inv.financialPreview?.commissionAmount ?? inv.commissionAmount)})
                        </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Tax</div>
                      <div className="text-sm text-gray-900">
                        {Number(inv.financialPreview?.taxPercent ?? inv.taxPercent) || 0}% ({fmt(inv.financialPreview?.taxAmount ?? 0)})
                      </div>
                    </div>
                  </div>

                  <div className="pt-2">
                    {getStatusBadge(inv.status, inv)}
                  </div>
            </div>
          </div>
        ))}
      </div>

          {/* Desktop Table - Hidden on mobile */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-visible">
            <div className="overflow-x-auto overflow-y-visible">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-10 border-r border-gray-200">
                      <button
                        onClick={toggleSelectAll}
                        className="p-1.5 hover:bg-gray-100 rounded-md transition-all duration-200 mx-auto focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                        title={selectedIds.size === items.length ? "Deselect all" : "Select all"}
                        aria-label="Select all invoices"
                      >
                        {selectedIds.size === items.length && items.length > 0 ? (
                          <CheckSquare className="h-4 w-4 text-[#02665e] stroke-2" />
                        ) : (
                          <Square className="h-4 w-4 text-gray-400 stroke-1.5" />
                        )}
                      </button>
                    </th>
                    <th 
                      className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort("invoiceNumber")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Invoice</span>
                        {sortBy === "invoiceNumber" ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Property
                    </th>
                    <th 
                      className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort("issuedAt")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Date</span>
                        {sortBy === "issuedAt" ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Total Paid
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Commission
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Tax
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Owner Payout
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((inv) => (
                    <TableRow key={inv.id}>
                      <td className="px-2 py-3 whitespace-nowrap text-center border-r border-gray-100">
                        <button
                          onClick={() => toggleSelect(inv.id)}
                          className="p-1.5 hover:bg-gray-100 rounded-md transition-all duration-200 mx-auto focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                          title={selectedIds.has(inv.id) ? "Deselect" : "Select"}
                          aria-label={selectedIds.has(inv.id) ? "Deselect invoice" : "Select invoice"}
                        >
                          {selectedIds.has(inv.id) ? (
                            <CheckSquare className="h-4 w-4 text-[#02665e] stroke-2" />
                          ) : (
                            <Square className="h-4 w-4 text-gray-400 stroke-1.5" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <InvoiceTypeIcon inv={inv} size="xs" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">
                                {inv.invoiceNumber ?? `#${inv.id}`}
                              </div>
                            </div>
                            {inv.receiptNumber && (
                              <div className="text-xs font-medium text-[#02665e] truncate">
                                Receipt: {inv.receiptNumber}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-900 truncate">{inv.booking.property.title}</span>
                        </div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {new Date(inv.issuedAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(inv.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{fmt(inv.financialPreview?.grossTotal ?? (Number(inv.netPayable || 0) + Number(inv.commissionAmount || 0)))}</div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="text-xs text-gray-600">
                          {Number(inv.financialPreview?.commissionPercent ?? inv.effectiveCommissionPercent ?? inv.commissionPercent) || 0}%
                        </div>
                        <div className="text-sm font-medium text-gray-900">{fmt(inv.financialPreview?.commissionAmount ?? inv.commissionAmount)}</div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="text-xs text-gray-600">
                          {Number(inv.financialPreview?.taxPercent ?? inv.taxPercent) || 0}%
                        </div>
                        <div className="text-sm font-medium text-gray-900">{fmt(inv.financialPreview?.taxAmount ?? 0)}</div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(inv.status, inv)}
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-bold text-[#02665e]">{fmt(inv.financialPreview?.netPayable ?? inv.netPayable)}</div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-center">
                        <Link
                          href={`/admin/revenue/${inv.id}`}
                          className="inline-flex items-center justify-center p-2 rounded-lg text-[#02665e] hover:bg-[#02665e]/10 transition-all duration-200"
                          title="View invoice details"
                        >
                          <Eye className="h-5 w-5" />
                        </Link>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-sm text-gray-600">
                  Showing <span className="font-semibold text-gray-900">{(page - 1) * pageSize + 1}</span> to{" "}
                  <span className="font-semibold text-gray-900">{Math.min(page * pageSize, total)}</span> of{" "}
                  <span className="font-semibold text-gray-900">{total}</span> invoices
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                    className="p-2 border border-gray-300 rounded-lg hover:border-[#02665e] hover:text-[#02665e] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="flex items-center gap-1">
                    {(() => {
                      const totalPages = Math.ceil(total / pageSize);
                      const pages: (number | string)[] = [];
                      
                      if (totalPages <= 7) {
                        // Show all pages if 7 or fewer
                        for (let i = 1; i <= totalPages; i++) {
                          pages.push(i);
                        }
                      } else {
                        // Always show first page
                        pages.push(1);
                        
                        if (page <= 4) {
                          // Near the start: show 1, 2, 3, 4, 5, ..., last
                          for (let i = 2; i <= 5; i++) {
                            pages.push(i);
                          }
                          pages.push('...');
                          pages.push(totalPages);
                        } else if (page >= totalPages - 3) {
                          // Near the end: show 1, ..., last-4, last-3, last-2, last-1, last
                          pages.push('...');
                          for (let i = totalPages - 4; i <= totalPages; i++) {
                            pages.push(i);
                          }
                        } else {
                          // In the middle: show 1, ..., page-1, page, page+1, ..., last
                          pages.push('...');
                          pages.push(page - 1);
                          pages.push(page);
                          pages.push(page + 1);
                          pages.push('...');
                          pages.push(totalPages);
                        }
                      }
                      
                      return pages.map((p, idx) => {
                        if (p === '...') {
                          return <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>;
                        }
                        return (
                          <button
                            key={p}
                            onClick={() => setPage(p as number)}
                            disabled={loading}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                              page === p
                                ? "bg-[#02665e] text-white"
                                : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-300"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {p}
                          </button>
                        );
                      });
                    })()}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(Math.ceil(total / pageSize), p + 1))}
                    disabled={page >= Math.ceil(total / pageSize) || loading}
                    className="p-2 border border-gray-300 rounded-lg hover:border-[#02665e] hover:text-[#02665e] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmt(n: any) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "TZS" }).format(
    Number(n || 0)
  );
}
