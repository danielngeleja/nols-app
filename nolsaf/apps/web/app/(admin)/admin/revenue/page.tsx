"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet, Calendar, Eye, Building2, Receipt, Download, ChevronLeft, ChevronRight, ArrowUpDown, CheckSquare, Square, Printer, Filter, X, CheckCircle2, ArrowUp, ArrowDown, HandCoins, CreditCard, RefreshCw, Search, Send, Clock, ArrowRight, Info } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import TableRow from "@/components/TableRow";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type InvoiceRow = {
  id: number;
  invoiceReference: string;
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

function isInteractiveRowTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea, [role='button']"));
}

function invoiceDetailsHref(inv: Pick<InvoiceRow, "invoiceReference">) {
  return `/admin/revenue/${encodeURIComponent(inv.invoiceReference)}`;
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
  const router = useRouter();
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

  async function exportApprovedCsv() {
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
      if (blob.type && !blob.type.includes("csv") && !blob.type.includes("text")) {
        const text = await blob.text();
        console.error("CSV export returned non-CSV:", text);
        throw new Error("Server returned an error instead of CSV");
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `approved_invoices_payout_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Failed to export CSV:", err);
      alert(`Failed to export CSV: ${err.message || "Please try again."}`);
    }
  }

  const STATUS_TABS: Array<{ value: string; label: string; hint: string; dot: string }> = [
    { value: "", label: "All", hint: "Every invoice", dot: "bg-neutral-400" },
    { value: "REQUESTED", label: "New", hint: "Waiting for review", dot: "bg-sky-500" },
    { value: "VERIFIED", label: "Verified", hint: "Checked, needs approval", dot: "bg-amber-500" },
    { value: "APPROVED", label: "Approved", hint: "Ready to disburse", dot: "bg-emerald-500" },
    { value: "PAID", label: "Paid / disbursed", hint: "Money moved", dot: "bg-teal-600" },
    { value: "REJECTED", label: "Rejected", hint: "Declined claims", dot: "bg-red-500" },
  ];
  const fmtShortDate = (iso: string) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const dateLabel = from && to ? (from === to ? fmtShortDate(from) : `${fmtShortDate(from)} to ${fmtShortDate(to)}`) : from ? `From ${fmtShortDate(from)}` : "";
  const ownerName = ownerFilter ? (owners.find((o) => String(o.id) === ownerFilter)?.name || owners.find((o) => String(o.id) === ownerFilter)?.email || `Owner #${ownerFilter}`) : "";
  const propertyName = propertyFilter ? (properties.find((p) => String(p.id) === propertyFilter)?.title || `Property #${propertyFilter}`) : "";
  const filterChips = [
    dateLabel ? { key: "date", label: dateLabel, clear: () => { setDate(""); setFrom(""); setTo(""); } } : null,
    ownerName ? { key: "owner", label: `Owner: ${ownerName}`, clear: () => setOwnerFilter("") } : null,
    propertyName ? { key: "property", label: `Property: ${propertyName}`, clear: () => setPropertyFilter("") } : null,
    amountMin ? { key: "min", label: `From ${Number(amountMin).toLocaleString()} TZS`, clear: () => setAmountMin("") } : null,
    amountMax ? { key: "max", label: `Up to ${Number(amountMax).toLocaleString()} TZS`, clear: () => setAmountMax("") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;
  const advancedCount = [ownerFilter, propertyFilter, amountMin, amountMax].filter(Boolean).length;
  const readyToDisburse = counts["APPROVED"] ?? 0;
  const waitingReview = counts["REQUESTED"] ?? 0;
  const FIELD = "block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
  const TOOL = "inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid px-3 text-xs font-bold transition";

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 w-full">
      <div id="revenue-top" className="min-w-0 space-y-4">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#revenue-top, #revenue-top * { box-sizing: border-box; }`}</style>

      {/* Workspace header */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-solid border-white/[0.06]" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm">
                <Wallet className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Finance</p>
                <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Revenue</h1>
                <p className="m-0 mt-1 text-xs leading-5 text-emerald-100/80 sm:text-sm">
                  <span className="font-bold text-white">INV</span> is what a guest paid.{" "}
                  <span className="font-bold text-white">OINV</span> is the owner&apos;s payout claim on it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { void load(); void fetchCounts(); }}
              disabled={loading}
              suppressHydrationWarning
              title="Refresh"
              aria-label="Refresh revenue"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-wait"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
          <nav aria-label="Related workspaces" className="flex flex-wrap gap-2 border-0 border-t border-solid border-white/15 pt-4">
            {[
              { href: "/admin/disbursements", label: "Disbursements", Icon: Send },
              { href: "/admin/finance", label: "Finance overview", Icon: HandCoins },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="inline-flex items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 no-underline transition hover:bg-white/15">
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* Status strip: every count is also the filter for it */}
      <section
        aria-label="Filter by status"
        className="grid min-w-0 grid-cols-2 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-0 [&>*]:border-b [&>*]:border-r [&>*]:border-solid [&>*]:border-neutral-100"
      >
        {STATUS_TABS.map((tab) => {
          const on = status === tab.value;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              aria-pressed={on}
              onClick={() => setStatus(tab.value)}
              className={`relative flex min-w-0 cursor-pointer flex-col items-start gap-1 bg-transparent p-3.5 text-left transition sm:p-4 ${on ? "bg-emerald-50/70" : "hover:bg-neutral-50"}`}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                <span className={`h-2 w-2 rounded-full ${tab.dot}`} aria-hidden /> {tab.label}
              </span>
              <span className={`text-xl font-black leading-none tabular-nums ${on ? "text-emerald-800" : "text-neutral-950"}`}>{counts[tab.value] ?? 0}</span>
              <span className="text-[11px] leading-snug text-neutral-500">{tab.hint}</span>
              {on ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-700" aria-hidden /> : null}
            </button>
          );
        })}
      </section>

      {/* Work waiting on an admin */}
      {(readyToDisburse > 0 && status !== "APPROVED") || (waitingReview > 0 && status !== "REQUESTED") ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {readyToDisburse > 0 && status !== "APPROVED" ? (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50/70 px-4 py-3">
              <p className="m-0 flex min-w-0 items-center gap-2.5 text-[13px] text-emerald-950">
                <Send className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                <span><span className="font-bold">{readyToDisburse} approved {readyToDisburse === 1 ? "invoice is" : "invoices are"}</span> ready to disburse.</span>
              </p>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setStatus("APPROVED")} className="cursor-pointer rounded-lg border border-solid border-emerald-300 bg-white px-2.5 py-1.5 text-[12px] font-bold text-emerald-800 transition hover:bg-emerald-100">Show them</button>
                <Link href="/admin/disbursements" className="inline-flex items-center gap-1 rounded-lg bg-[#02665e] px-2.5 py-1.5 text-[12px] font-bold text-white no-underline transition hover:bg-[#014d47]">
                  Disburse <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          ) : null}
          {waitingReview > 0 && status !== "REQUESTED" ? (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-solid border-sky-200 bg-sky-50/70 px-4 py-3">
              <p className="m-0 flex min-w-0 items-center gap-2.5 text-[13px] text-sky-950">
                <Clock className="h-4 w-4 shrink-0 text-sky-700" aria-hidden />
                <span><span className="font-bold">{waitingReview} {waitingReview === 1 ? "claim waits" : "claims wait"}</span> for review.</span>
              </p>
              <button type="button" onClick={() => setStatus("REQUESTED")} className="shrink-0 cursor-pointer rounded-lg border border-solid border-sky-300 bg-white px-2.5 py-1.5 text-[12px] font-bold text-sky-800 transition hover:bg-sky-100">Review now</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Toolbar */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-2.5 px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); load(); } }}
              placeholder="Search invoice number, receipt or property"
              aria-label="Search invoices"
              className={`${FIELD} pl-9 pr-9`}
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                type="button"
                title="Pick a date range"
                onClick={() => {
                  setPickerAnim(true);
                  window.setTimeout(() => setPickerAnim(false), 350);
                  setPickerOpen((v) => !v);
                }}
                className={`${TOOL} ${dateLabel || pickerAnim ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden /> {dateLabel || "Any date"}
              </button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                  <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
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
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              aria-expanded={showAdvancedFilters}
              className={`${TOOL} ${showAdvancedFilters || advancedCount ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden /> Filters{advancedCount ? ` (${advancedCount})` : ""}
            </button>
            <button type="button" onClick={handlePrint} title="Print invoices" className={`${TOOL} border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300`}>
              <Printer className="h-3.5 w-3.5" aria-hidden /> Print
            </button>
          </div>
        </div>

        {showAdvancedFilters ? (
          <div className="grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Owner</span>
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className={FIELD}>
                <option value="">All owners</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name || owner.email} ({owner.id})</option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Property</span>
              <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className={FIELD}>
                <option value="">All properties</option>
                {properties.map((prop) => (
                  <option key={prop.id} value={prop.id}>{prop.title} ({prop.id})</option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Min amount (TZS)</span>
              <input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="0" className={FIELD} />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-neutral-500">Max amount (TZS)</span>
              <input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="No limit" className={FIELD} />
            </label>
          </div>
        ) : null}

        {filterChips.length ? (
          <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 sm:px-5">
            {filterChips.map((chip) => (
              <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-solid border-emerald-200 bg-emerald-50 py-0.5 pl-2.5 pr-1 text-[11px] font-bold text-emerald-800">
                {chip.label}
                <button type="button" onClick={chip.clear} aria-label={`Remove ${chip.label}`} className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-emerald-700 hover:bg-emerald-100">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => { setDate(""); setFrom(""); setTo(""); setOwnerFilter(""); setPropertyFilter(""); setAmountMin(""); setAmountMax(""); }}
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-neutral-500 hover:text-neutral-900 hover:underline"
            >
              Clear all
            </button>
          </div>
        ) : null}

        {/* What is on screen, and the export for approved invoices */}
        <div className="flex flex-col gap-2.5 border-0 border-t border-solid border-neutral-100 bg-neutral-50/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold text-neutral-500">Net payable, this page</p>
            <p className="m-0 mt-0.5 text-lg font-black tabular-nums tracking-tight text-emerald-700">
              {new Intl.NumberFormat("en-US").format(sumNet)} <span className="text-xs font-bold text-neutral-400">TZS</span>
            </p>
            <p className="m-0 mt-0.5 text-[11px] text-neutral-400">
              {q?.trim() ? "Search shows every INV and OINV record." : "One row per booking when both INV and OINV exist. Search to see both."}
            </p>
          </div>
          {status === "APPROVED" && items.length > 0 ? (
            <button
              type="button"
              onClick={() => void exportApprovedCsv()}
              className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-[13px] font-bold text-white transition hover:bg-[#014d47]"
            >
              <Download className="h-4 w-4" aria-hidden /> Export approved for payout
            </button>
          ) : null}
        </div>
      </section>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-solid border-emerald-200 bg-emerald-50/70 px-4 py-3 sm:gap-3">
          <p className="m-0 text-[13px] font-bold text-emerald-950">
            {selectedIds.size} invoice{selectedIds.size !== 1 ? "s" : ""} selected
          </p>
          <button type="button" onClick={clearSelection} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-bold text-emerald-800/70 hover:text-emerald-900">
            <X className="h-3 w-3" aria-hidden /> Clear
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={bulkApprove}
            suppressHydrationWarning
            disabled={bulkActionLoading || !Array.from(selectedIds).some((id) => {
              const inv = items.find((i) => i.id === id);
              return inv && (inv.status === "VERIFIED" || inv.status === "REQUESTED");
            })}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-[12.5px] font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {bulkActionLoading ? "Working…" : "Approve selected"}
          </button>
          <button
            type="button"
            onClick={bulkMarkPaid}
            suppressHydrationWarning
            disabled={bulkActionLoading || !Array.from(selectedIds).some((id) => {
              const inv = items.find((i) => i.id === id);
              return inv && inv.status === "APPROVED";
            })}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-emerald-300 bg-white px-3 text-[12.5px] font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Receipt className="h-3.5 w-3.5" aria-hidden /> {bulkActionLoading ? "Working…" : bulkMarkActionLabel}
          </button>
        </div>
      )}
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
                role="link"
                tabIndex={0}
                aria-label={`Open invoice ${inv.invoiceNumber ?? `#${inv.id}`}`}
                onClick={(event) => {
                  if (isInteractiveRowTarget(event.target)) return;
                  router.push(invoiceDetailsHref(inv));
                }}
                onKeyDown={(event) => {
                  if (isInteractiveRowTarget(event.target) || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  router.push(invoiceDetailsHref(inv));
                }}
                className="cursor-pointer bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/40"
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
                href={invoiceDetailsHref(inv)}
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
                    <TableRow
                      key={inv.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open invoice ${inv.invoiceNumber ?? `#${inv.id}`}`}
                      title="Open invoice details"
                      onClick={(event) => {
                        if (isInteractiveRowTarget(event.target)) return;
                        router.push(invoiceDetailsHref(inv));
                      }}
                      onKeyDown={(event) => {
                        if (isInteractiveRowTarget(event.target) || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        router.push(invoiceDetailsHref(inv));
                      }}
                      className="cursor-pointer focus:outline-none focus-visible:bg-sky-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#02665e]/40"
                    >
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
                          href={invoiceDetailsHref(inv)}
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
