"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import apiClient from "@/lib/apiClient";
import { Users, User, Check, CheckCircle, Loader2, Search, Clock, XCircle, X, ChevronDown, ChevronRight, MapPin, Calendar, Building2, Mail, AlertCircle, Percent, FileText, History, Ban, Gavel } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import Link from "next/link";
import TablePagination from "@/components/TablePagination";

const api = apiClient;

// Bookings store region slugs ("dar-es-salaam") while properties store names ("Dar es Salaam").
// Compare on a normalised key so the two ever match.
function placeKey(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// --- Row tones ---------------------------------------------------------------
// Each row carries its stage as a faint tint and a short horizontal bar in the first column.
// Class names are spelled out in full so Tailwind keeps them.
const ROW_TONES = {
  action: { label: "Needs you", row: "bg-amber-50/50", swatch: "bg-amber-500" },
  bidding: { label: "Owners bidding", row: "bg-violet-50/40", swatch: "bg-violet-500" },
  customer: { label: "Waiting on customer", row: "bg-sky-50/40", swatch: "bg-sky-500" },
  deposit: { label: "Awaiting deposit", row: "bg-green-50/40", swatch: "bg-green-600" },
  paid: { label: "Deposit paid", row: "bg-blue-50/40", swatch: "bg-blue-600" },
  completed: { label: "Completed", row: "bg-white", swatch: "bg-neutral-400" },
  canceled: { label: "Canceled", row: "bg-rose-50/40", swatch: "bg-rose-500" },
} as const;
type RowTone = keyof typeof ROW_TONES;

// --- Activity timeline helpers -------------------------------------------

function activityTone(action: string | null | undefined) {
  const a = String(action || "").toUpperCase();
  if (a.includes("CLOSED") || a.includes("CANCEL")) return { icon: Ban, cls: "bg-rose-50 text-rose-600" };
  if (a.includes("OPENED")) return { icon: Gavel, cls: "bg-emerald-50 text-emerald-600" };
  if (a.includes("ASSIGNED")) return { icon: User, cls: "bg-blue-50 text-blue-600" };
  if (a.includes("RECOMMEND") || a.includes("SUGGESTION")) return { icon: Building2, cls: "bg-indigo-50 text-indigo-600" };
  if (a.includes("MESSAGE")) return { icon: Mail, cls: "bg-sky-50 text-sky-600" };
  if (a.includes("STATUS")) return { icon: Clock, cls: "bg-amber-50 text-amber-600" };
  return { icon: History, cls: "bg-neutral-100 text-neutral-500" };
}

// Turn raw audit metadata into a few readable chips; internal flags are dropped.
function describeActivityMeta(meta: any): string[] {
  if (!meta || typeof meta !== "object") return [];
  const out: string[] = [];
  const reasons: Record<string, string> = {
    DEADLINE_REACHED: "Deadline reached",
    OWNER_CONFIRMED: "Owner confirmed",
    NO_VALID_OFFERS: "No valid offers",
    POLICY_DECISION: "Policy decision",
  };
  if (meta.closeReasonCode) out.push(`Reason: ${reasons[meta.closeReasonCode] || humanizeLabel(meta.closeReasonCode)}`);
  if (meta.closeReasonDetails && !/auto-close/i.test(String(meta.closeReasonDetails))) out.push(String(meta.closeReasonDetails));
  if (meta.deadline) {
    const d = new Date(meta.deadline);
    out.push(`Deadline ${Number.isNaN(d.getTime()) ? String(meta.deadline) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`);
  }
  if (meta.minDiscountPercent != null) out.push(`Min discount ${meta.minDiscountPercent}%`);
  if (meta.previousStatus && meta.newStatus) out.push(`${humanizeLabel(meta.previousStatus)} → ${humanizeLabel(meta.newStatus)}`);
  if (meta.ownerName) out.push(`Owner: ${meta.ownerName}`);
  if (Array.isArray(meta.propertyIds) && meta.propertyIds.length) out.push(`${meta.propertyIds.length} ${meta.propertyIds.length === 1 ? "property" : "properties"}`);
  if (meta.claimCount) out.push(`${meta.claimCount} ${meta.claimCount === 1 ? "claim" : "claims"}`);
  const included = ["hasAccommodationOptions", "hasPricing", "hasRecommendations", "hasNextSteps"]
    .filter((k) => meta[k] === true)
    .map((k) => ({ hasAccommodationOptions: "options", hasPricing: "pricing", hasRecommendations: "recommendations", hasNextSteps: "next steps" } as Record<string, string>)[k]);
  if (included.length) out.push(`Included ${included.join(", ")}`);
  return out.slice(0, 4);
}

// Group by calendar day (newest first as supplied) and fold identical back-to-back entries.
function groupActivity(audits: any[]) {
  const days: Array<{ label: string; items: Array<{ key: string; audit: any; count: number }> }> = [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  audits.forEach((audit, idx) => {
    const when = new Date(audit.createdAt);
    const label = sameDay(when, today) ? "Today" : sameDay(when, yesterday) ? "Yesterday" : when.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { label, items: [] };
      days.push(day);
    }
    const prev = day.items[day.items.length - 1];
    const minute = (d: string) => new Date(d).toISOString().slice(0, 16);
    if (prev && prev.audit.action === audit.action && prev.audit.description === audit.description && minute(prev.audit.createdAt) === minute(audit.createdAt)) {
      prev.count += 1;
    } else {
      day.items.push({ key: String(audit.id ?? idx), audit, count: 1 });
    }
  });
  return days;
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

type GroupStay = {
  id: number;
  groupType: string;
  accommodationType: string;
  headcount: number;
  roomsNeeded: number;
  toRegion: string;
  toDistrict?: string | null;
  toWard?: string | null;
  toLocation?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  user: { id: number; name: string; email: string; phone: string | null } | null;
  assignedOwner: { id: number; name: string; email: string; phone: string | null } | null;
  confirmedProperty: { id: number; title: string; type: string; status: string } | null;
  recommendedPropertyIds?: number[] | null;
  isOpenForClaims?: boolean;
  openedForClaimsAt?: string | null;
  claimsCount?: number;
  claimsPreview?: Array<{
    id: number;
    status: string;
    discountPercent: any;
    offeredPricePerNight: any;
    totalAmount: any;
    currency: string;
    createdAt: string;
    owner: { id: number; name: string; email: string; phone: string | null };
    property: { id: number; title: string; type: string; regionName: string | null; district: string | null };
  }>;
  claimsConfig?: {
    deadline: string | null;
    notes: string | null;
    minDiscountPercent: number | null;
    updatedAt: string | null;
  };
  totalAmount?: string | number | null;
  currency?: string | null;
  depositAmount?: string | number | null;
  depositPaid?: boolean;
  depositPaidAt?: string | null;
  depositDueAt?: string | null;
  ownerAmount?: string | number | null;
  commissionPercent?: string | number | null;
  paymentRef?: string | null;
  payerPhone?: string | null;
  paymentProvider?: string | null;
  confirmedAt?: string | null;
  checkedInAt?: string | null;
  ownerPayoutAmount?: string | number | null;
  ownerPayoutStatus?: string | null;
  ownerPayoutPaidAt?: string | null;
  ownerPayoutRef?: string | null;
  paymentEvents?: Array<{
    id: number;
    provider: string;
    amount: string | number;
    currency: string;
    status: string;
    paymentChannel: string | null;
    phone: string | null;
    createdAt: string;
  }>;
  createdAt: string;
};

function toAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(value: number | null, currency = "TZS") {
  return value === null ? "Not recorded" : `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CHANNEL_LABELS: Record<string, string> = { MNO: "Mobile money", BANK: "Bank", CARD: "Card" };

type Owner = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  suspendedAt?: string | null;
  properties?: {
    regionName: string | null;
    district: string | null;
    ward: string | null;
  }[];
};

type Property = {
  id: number;
  title: string;
  type: string;
  regionName: string | null;
  district: string | null;
  ownerId?: number; // Add ownerId for batch loading
  owner?: { id: number; name: string | null; email: string | null } | null;
};

export default function AdminGroupStayAssignmentsPage() {
  const [groupStays, setGroupStays] = useState<GroupStay[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ total: number; admin: number; claims: number; statuses: Record<string, number> } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [linking, setLinking] = useState<number | null>(null);
  const [openingForClaims, setOpeningForClaims] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedOwner, setSelectedOwner] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [showClaimsModal, setShowClaimsModal] = useState(false);
  const [selectedGroupStayForClaims, setSelectedGroupStayForClaims] = useState<number | null>(null);
  const [claimsDeadline, setClaimsDeadline] = useState<string>("");
  const [claimsNotes, setClaimsNotes] = useState<string>("");
  const [minDiscount, setMinDiscount] = useState<string>("");
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);
  const [claimsModalMode, setClaimsModalMode] = useState<"open" | "edit">("open");
  const [reAdvertiseConfirmed, setReAdvertiseConfirmed] = useState(false);
  const [showCloseClaimsModal, setShowCloseClaimsModal] = useState(false);
  const [selectedGroupStayForCloseClaims, setSelectedGroupStayForCloseClaims] = useState<number | null>(null);
  const [closeClaimsReasonCode, setCloseClaimsReasonCode] = useState<string>("");
  const [closeClaimsReasonDetails, setCloseClaimsReasonDetails] = useState<string>("");
  const [closeClaimsReasonError, setCloseClaimsReasonError] = useState<string>("");
  const [auditHistory, setAuditHistory] = useState<Record<number, any[]>>({});
  const [auditLoading, setAuditLoading] = useState<Record<number, boolean>>({});
  const [expandedAudits, setExpandedAudits] = useState<Record<number, boolean>>({});
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  // Assigning an owner or linking properties changes the booking, so both go through a confirm step.
  const [pendingAssign, setPendingAssign] = useState<
    | { kind: "owner"; gsId: number; ownerId: number; ownerName: string; note: string | null }
    | { kind: "properties"; gsId: number; propertyIds: number[]; titles: string[] }
    | null
  >(null);
  const [propertyPicks, setPropertyPicks] = useState<Record<number, number[]>>({});
  const [view, setView] = useState<"all" | "claims" | "admin">("admin");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [totalItems, setTotalItems] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const params: any = {};
      params.view = view;
      params.page = page;
      params.pageSize = pageSize;
      if (selectedStatus) params.status = selectedStatus;
      if (selectedOwner) params.assignedOwnerId = selectedOwner;

      const response = await api.get("/api/admin/group-stays/assignments", { params });
      setGroupStays(response.data.items || []);
      setTotalItems(Number(response.data.total || 0));
      setPageSize(Number(response.data.pageSize || pageSize));
    } catch (err: any) {
      console.error("Failed to load group stays:", err);
      setGroupStays([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, selectedOwner, view, page, pageSize]);

  const loadSummary = useCallback(async () => {
    try {
      setSummaryLoading(true);
      const params: any = {};
      if (selectedStatus) params.status = selectedStatus;
      if (selectedOwner) params.assignedOwnerId = selectedOwner;

      const response = await api.get("/api/admin/group-stays/assignments/stats", { params });
      const next = response.data as { total?: number; admin?: number; claims?: number; statuses?: Record<string, number> };
      setSummary({
        total: Number(next?.total ?? 0),
        admin: Number(next?.admin ?? 0),
        claims: Number(next?.claims ?? 0),
        statuses: next?.statuses || {},
      });
    } catch (err: any) {
      console.error("Failed to load assignment summary stats:", err);
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedStatus, selectedOwner]);

  const loadOwners = useCallback(async () => {
    try {
      setOwnersLoading(true);
      setOwnersError(null);
      
      // Load owners
      const response = await api.get("/api/admin/owners", { params: { page: "1", pageSize: "100", assignable: "true" } });
      // Belt and braces for an API that predates the assignable filter.
      const ownersData = (response.data.items || []).filter((o: Owner) => !o.suspendedAt && (o.name || o.email));
      
      if (ownersData.length === 0) {
        setOwners([]);
        setOwnersLoading(false);
        return;
      }

      // Batch load all approved properties at once (much more efficient)
      try {
        const allPropertiesResponse = await api.get("/api/admin/properties", {
          params: { page: "1", pageSize: "1000", status: "APPROVED" }
        });
        const allProperties = allPropertiesResponse.data.items || [];
        
        // Group properties by ownerId
        const propertiesByOwner = new Map<number, Property[]>();
        allProperties.forEach((prop: any) => {
          const ownerId = prop.ownerId || prop.owner?.id;
          if (ownerId) {
            if (!propertiesByOwner.has(ownerId)) {
              propertiesByOwner.set(ownerId, []);
            }
            propertiesByOwner.get(ownerId)!.push({
              id: prop.id,
              title: prop.title,
              type: prop.type,
              regionName: prop.regionName,
              district: prop.district,
            });
          }
        });

        // Map owners with their properties
        const ownersWithLocations = ownersData
          .filter((owner: Owner) => (propertiesByOwner.get(owner.id) || []).length > 0)
          .map((owner: Owner) => {
          const ownerProps = propertiesByOwner.get(owner.id) || [];
          return {
            ...owner,
            properties: ownerProps.map((p: Property) => ({
              regionName: p.regionName,
              district: p.district,
              ward: null, // Property type doesn't have ward in current schema
            }))
          };
        });
        
        setOwners(ownersWithLocations);
      } catch (propErr: any) {
        console.warn("Failed to load properties for owners, continuing without location data:", propErr);
        // Continue with owners but without location data
        setOwners(ownersData.map((owner: Owner) => ({ ...owner, properties: [] })));
      }
    } catch (err: any) {
      console.error("Failed to load owners:", err);
      setOwnersError(err.response?.data?.error || "Failed to load owners. Please try again.");
      setOwners([]);
    } finally {
      setOwnersLoading(false);
    }
  }, []);

  const loadProperties = useCallback(async () => {
    try {
      setPropertiesLoading(true);
      setPropertiesError(null);
      const response = await api.get("/api/admin/properties", { params: { page: "1", pageSize: "100", status: "APPROVED" } });
      setProperties(response.data.items || []);
    } catch (err: any) {
      console.error("Failed to load properties:", err);
      setPropertiesError(err.response?.data?.error || "Failed to load properties. Please try again.");
      setProperties([]);
    } finally {
      setPropertiesLoading(false);
    }
  }, []);

  const loadAuditHistory = useCallback(async (groupStayId: number) => {
    try {
      setAuditLoading(prev => ({ ...prev, [groupStayId]: true }));
      const response = await api.get(`/api/admin/group-stays/assignments/${groupStayId}/audits`);
      const audits = response.data?.items || [];
      setAuditHistory(prev => ({ ...prev, [groupStayId]: audits }));
    } catch (err: any) {
      console.error("Failed to load audit history:", err);
      setAuditHistory(prev => ({ ...prev, [groupStayId]: [] }));
    } finally {
      setAuditLoading(prev => ({ ...prev, [groupStayId]: false }));
    }
  }, []);

  useEffect(() => {
    loadOwners();
    loadProperties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleAssignOwner = async (groupStayId: number, ownerId: number) => {
    try {
      setAssigning(groupStayId);
      await api.post(`/api/admin/group-stays/assignments/${groupStayId}/owner`, { ownerId });
      await loadData();
    } catch (err: any) {
      console.error("Failed to assign owner:", err);
      alert(err.response?.data?.error || "Failed to assign owner");
    } finally {
      setAssigning(null);
    }
  };

  const handleLinkProperties = async (groupStayId: number, propertyIds: number[]) => {
    try {
      setLinking(groupStayId);
      await api.post(`/api/admin/group-stays/assignments/${groupStayId}/properties`, { propertyIds });
      await loadData();
      await loadAuditHistory(groupStayId);
      // Show success feedback (could be enhanced with toast notification)
    } catch (err: any) {
      console.error("Failed to link properties:", err);
      const errorMessage = err.response?.data?.error || "Failed to link properties. Please try again.";
      alert(errorMessage);
      throw err; // Re-throw for potential retry logic
    } finally {
      setLinking(null);
    }
  };

  const handleToggleOpenForClaims = async (groupStayId: number, isOpen: boolean) => {
    // If closing, require a reason
    if (isOpen) {
      setSelectedGroupStayForCloseClaims(groupStayId);
      setCloseClaimsReasonCode("");
      setCloseClaimsReasonDetails("");
      setCloseClaimsReasonError("");
      setShowCloseClaimsModal(true);
      return;
    }

    // If opening, show modal first
    setSelectedGroupStayForClaims(groupStayId);
    setClaimsModalMode("open");
    setShowClaimsModal(true);
    setReAdvertiseConfirmed(false);
    // Reset form
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setClaimsDeadline(tomorrow.toISOString().split('T')[0]);
    setClaimsNotes("");
    setMinDiscount("");
    setDeadlinePickerOpen(false);
  };

  const openClaimsSettingsModal = (gs: GroupStay) => {
    setSelectedGroupStayForClaims(gs.id);
    setClaimsModalMode("edit");
    setShowClaimsModal(true);
    setReAdvertiseConfirmed(false);

    const deadline = gs.claimsConfig?.deadline ? gs.claimsConfig.deadline.slice(0, 10) : "";
    setClaimsDeadline(deadline);
    setClaimsNotes(gs.claimsConfig?.notes ?? "");
    setMinDiscount(
      gs.claimsConfig?.minDiscountPercent !== null && gs.claimsConfig?.minDiscountPercent !== undefined
        ? String(gs.claimsConfig.minDiscountPercent)
        : ""
    );
    setDeadlinePickerOpen(false);
  };

  const handleSubmitClaimsForm = async () => {
    if (!selectedGroupStayForClaims) return;

    const selected = groupStays.find((gs) => gs.id === selectedGroupStayForClaims) || null;
    const hasManualHandling = Boolean(selected?.assignedOwner) || (Array.isArray(selected?.recommendedPropertyIds) && (selected?.recommendedPropertyIds?.length || 0) > 0);
    const hasConfirmed = Boolean(selected?.confirmedProperty);
    const needsReadvertise = claimsModalMode === "open" && hasManualHandling;

    // Validate required fields
    if (!claimsDeadline) {
      alert("Please set a deadline for claims submission");
      return;
    }

    if (hasConfirmed) {
      alert("This booking already has a confirmed property and cannot be opened for competitive claims.");
      return;
    }

    if (needsReadvertise && !reAdvertiseConfirmed) {
      alert("Confirm re-advertise to clear manual handling before opening claims.");
      return;
    }

    const deadlineDate = new Date(claimsDeadline);
    if (deadlineDate < new Date()) {
      alert("Deadline must be in the future");
      return;
    }

    try {
      setOpeningForClaims(selectedGroupStayForClaims);
      await api.patch(`/api/admin/group-stays/assignments/${selectedGroupStayForClaims}/open-for-claims`, {
        open: true,
        deadline: claimsDeadline,
        notes: claimsNotes.trim() || null,
        minDiscountPercent: minDiscount ? Number(minDiscount) : null,
        reAdvertise: needsReadvertise ? true : undefined,
      });
      await loadData();
      if (selectedGroupStayForClaims) {
        await loadAuditHistory(selectedGroupStayForClaims);
      }
      setShowClaimsModal(false);
      setSelectedGroupStayForClaims(null);
      setClaimsDeadline("");
      setClaimsNotes("");
      setMinDiscount("");
      setDeadlinePickerOpen(false);
      setClaimsModalMode("open");
      setReAdvertiseConfirmed(false);
    } catch (err: any) {
      const actionLabel = claimsModalMode === "edit" ? "save auction settings" : "open for claims";
      console.error(`Failed to ${actionLabel}:`, err);
      alert(err.response?.data?.error || `Failed to ${actionLabel}`);
    } finally {
      setOpeningForClaims(null);
    }
  };

  const handleSubmitCloseClaims = async () => {
    if (!selectedGroupStayForCloseClaims) return;
    const reasonCode = closeClaimsReasonCode.trim();
    const reasonDetails = closeClaimsReasonDetails.trim();
    if (!reasonCode) {
      setCloseClaimsReasonError("Select a reason to enable closing.");
      return;
    }

    if (reasonCode === "POLICY_DECISION" && !reasonDetails) {
      setCloseClaimsReasonError("Add details for Policy decision.");
      return;
    }

    try {
      setOpeningForClaims(selectedGroupStayForCloseClaims);
      await api.patch(`/api/admin/group-stays/assignments/${selectedGroupStayForCloseClaims}/open-for-claims`, {
        open: false,
        reasonCode,
        reasonDetails: reasonDetails || undefined,
      });
      await loadData();
      await loadAuditHistory(selectedGroupStayForCloseClaims);
      setShowCloseClaimsModal(false);
      setSelectedGroupStayForCloseClaims(null);
      setCloseClaimsReasonCode("");
      setCloseClaimsReasonDetails("");
      setCloseClaimsReasonError("");
    } catch (err: any) {
      console.error("Failed to close claims:", err);
      alert(err.response?.data?.error || "Failed to close claims");
    } finally {
      setOpeningForClaims(null);
    }
  };

  // Calculate filter counts
  const statusCounts = useMemo(() => {
    const statuses = summary?.statuses || {};
    return {
      all: Object.values(statuses).reduce((sum, count) => sum + Number(count || 0), 0),
      ...statuses,
      CANCELED: Number(statuses.CANCELED || 0) + Number(statuses.CANCELLED || 0),
    } as Record<string, number>;
  }, [summary]);

  const ownerCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: groupStays.length,
    };
    owners.forEach(owner => {
      counts[owner.id.toString()] = groupStays.filter(gs => gs.assignedOwner?.id === owner.id).length;
    });
    return counts;
  }, [groupStays, owners]);

  // Calculate location match score for owner (higher = better match)
  const getLocationMatchScore = useCallback((owner: Owner, groupStay: GroupStay): number => {
    if (!owner.properties || owner.properties.length === 0) return 0;
    
    let maxScore = 0;
    for (const prop of owner.properties) {
      let score = 0;
      
      // Region match = 3 points
      if (prop.regionName && groupStay.toRegion && 
          placeKey(prop.regionName) === placeKey(groupStay.toRegion)) {
        score += 3;
        
        // District match = +2 points (total 5)
        if (prop.district && groupStay.toDistrict && 
            placeKey(prop.district) === placeKey(groupStay.toDistrict)) {
          score += 2;
          
          // Ward match = +1 point (total 6)
          if (prop.ward && groupStay.toWard && 
              placeKey(prop.ward) === placeKey(groupStay.toWard)) {
            score += 1;
          }
        }
      }
      
      maxScore = Math.max(maxScore, score);
    }
    
    return maxScore;
  }, []);

  // Get human-readable location match label
  const getLocationMatchLabel = useCallback((owner: Owner, groupStay: GroupStay, score: number): string => {
    if (score === 0) return "No location match";
    if (score >= 6) return "✓ Exact match (Region, District, Ward)";
    if (score >= 5) return "✓ Region & District match";
    if (score >= 3) return "✓ Region match";
    return "";
  }, []);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: "bg-neutral-100 text-neutral-600",
      REVIEWING: "bg-violet-50 text-violet-700",
      AWAITING_DEPOSIT: "bg-amber-50 text-amber-700",
      PROCESSING: "bg-blue-50 text-blue-700",
      CONFIRMED: "bg-emerald-50 text-emerald-700",
      COMPLETED: "bg-teal-50 text-teal-700",
      CANCELED: "bg-rose-50 text-rose-700",
      CANCELLED: "bg-rose-50 text-rose-700",
    };
    return colors[(status || "").toUpperCase()] || "bg-neutral-100 text-neutral-600";
  };

  const filteredGroupStays = useMemo(() => {
    return groupStays.filter((gs) => {
      if (selectedStatus && gs.status.toUpperCase() !== selectedStatus.toUpperCase()) return false;

      if (selectedOwner) {
        const ownerId = Number(selectedOwner);
        if (gs.assignedOwner?.id !== ownerId) return false;
      }

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const haystacks = [
          gs.user?.name,
          gs.user?.email,
          gs.user?.phone,
          gs.toRegion,
          gs.toDistrict,
          gs.toWard,
          gs.toLocation,
          gs.groupType,
          gs.accommodationType,
          gs.assignedOwner?.name,
          gs.assignedOwner?.email,
          gs.confirmedProperty?.title,
        ]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase());

        return haystacks.some((value) => value.includes(query));
      }

      return true;
    });
  }, [groupStays, selectedStatus, selectedOwner, searchQuery]);

  const closeClaimsModal = () => {
    setShowClaimsModal(false);
    setSelectedGroupStayForClaims(null);
    setClaimsDeadline("");
    setClaimsNotes("");
    setMinDiscount("");
    setDeadlinePickerOpen(false);
    setClaimsModalMode("open");
    setReAdvertiseConfirmed(false);
  };

  const closeCloseClaimsModal = () => {
    setShowCloseClaimsModal(false);
    setSelectedGroupStayForCloseClaims(null);
    setCloseClaimsReasonCode("");
    setCloseClaimsReasonDetails("");
    setCloseClaimsReasonError("");
  };

  const fmtDay = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;

  // Two lines per row: what is attached (property, owner, offers) and where it stands next.
  // Owner / Property / Stage, each answering one question.
  const rowColumns = (gs: GroupStay) => {
    const status = (gs.status || "").toUpperCase();
    const recommendedIds = Array.isArray(gs.recommendedPropertyIds) ? gs.recommendedPropertyIds : [];
    const offers = gs.claimsCount ?? 0;
    const confirmed = gs.confirmedProperty ? properties.find((p) => p.id === gs.confirmedProperty!.id) : null;
    const confirmedOwner = confirmed?.owner ?? null;

    const owner =
      gs.assignedOwner ? { text: gs.assignedOwner.name || gs.assignedOwner.email, sub: "Assigned", muted: false }
      : confirmedOwner ? { text: confirmedOwner.name || confirmedOwner.email || "Owner", sub: "Owner of confirmed property", muted: false }
      : gs.isOpenForClaims ? { text: "Open to all owners", sub: `${offers} ${offers === 1 ? "offer" : "offers"} so far`, muted: false }
      : { text: "Not assigned", sub: null as string | null, muted: true };

    const property =
      gs.confirmedProperty ? { text: tidyName(gs.confirmedProperty.title), sub: "Confirmed", muted: false }
      : recommendedIds.length === 1 ? { text: tidyName(properties.find((p) => p.id === recommendedIds[0])?.title || "1 property"), sub: "Recommended", muted: false }
      : recommendedIds.length > 1 ? { text: `${recommendedIds.length} properties`, sub: "Recommended", muted: false }
      : gs.isOpenForClaims ? { text: "Chosen from offers", sub: null as string | null, muted: true }
      : { text: "None linked", sub: null as string | null, muted: true };

    // Stage reads like the other columns: what is happening, then who moves next.
    // Only "admin must act" rows get a coloured icon; everything else stays neutral.
    const checkInDay = fmtDay(gs.checkIn);
    const stage =
      gs.isOpenForClaims
        ? { text: "Owners bidding", next: gs.claimsConfig?.deadline ? `Closes ${fmtDay(gs.claimsConfig.deadline)}` : "No closing date set", icon: Gavel, attention: !gs.claimsConfig?.deadline, tone: "bidding" as const }
      : status === "CANCELED" || status === "CANCELLED"
        ? { text: "Canceled", next: "No action needed", icon: Ban, attention: false, tone: "canceled" as const }
      : status === "COMPLETED"
        ? { text: "Stay completed", next: "Closed", icon: CheckCircle, attention: false, tone: "completed" as const }
      : status === "CONFIRMED"
        ? { text: "Deposit paid", next: checkInDay ? `Owner hosts from ${checkInDay}` : "Owner hosts on arrival", icon: CheckCircle, attention: false, tone: "paid" as const }
      : status === "AWAITING_DEPOSIT"
        ? { text: "Awaiting deposit", next: "Customer to pay", icon: Clock, attention: false, tone: "deposit" as const }
      : recommendedIds.length > 0 && !gs.confirmedProperty
        ? { text: "Options sent", next: "Customer to choose", icon: Clock, attention: false, tone: "customer" as const }
      : gs.assignedOwner
        ? { text: "Owner assigned", next: "Link a matching property", icon: User, attention: true, tone: "action" as const }
      : { text: "Not started", next: "Assign an owner or open claims", icon: AlertCircle, attention: true, tone: "action" as const };

    return { owner, property, stage };
  };

  const handlingOf = (gs: GroupStay) => {
    const status = (gs.status || "").toUpperCase();
    const recommendedCount = Array.isArray(gs.recommendedPropertyIds) ? gs.recommendedPropertyIds.length : 0;
    const offers = gs.claimsCount ?? 0;
    if (gs.isOpenForClaims) {
      return {
        icon: Gavel, tile: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-500",
        title: `Auction live · ${offers} ${offers === 1 ? "offer" : "offers"}`,
        sub: gs.claimsConfig?.deadline ? `Closes ${fmtDay(gs.claimsConfig.deadline)}` : "No deadline set",
      };
    }
    if (gs.confirmedProperty) {
      const stage =
        status === "AWAITING_DEPOSIT" ? { sub: "Confirmed · awaiting deposit", dot: "bg-amber-500" }
        : status === "CONFIRMED" ? { sub: "Deposit paid · ready to host", dot: "bg-emerald-500" }
        : status === "COMPLETED" ? { sub: "Stay completed", dot: "bg-teal-500" }
        : status === "CANCELED" || status === "CANCELLED" ? { sub: "Booking canceled", dot: "bg-rose-500" }
        : { sub: "Property confirmed", dot: "bg-teal-500" };
      return { icon: Building2, tile: "bg-teal-50 text-teal-700", dot: stage.dot, title: gs.confirmedProperty.title, sub: stage.sub };
    }
    if (gs.assignedOwner) {
      return { icon: User, tile: "bg-blue-50 text-blue-600", dot: "bg-blue-500", title: gs.assignedOwner.name || gs.assignedOwner.email, sub: "Owner assigned" };
    }
    if (recommendedCount > 0) {
      return { icon: Clock, tile: "bg-amber-50 text-amber-600", dot: "bg-amber-500", title: `${recommendedCount} ${recommendedCount === 1 ? "property" : "properties"} recommended`, sub: "Awaiting customer choice" };
    }
    return { icon: AlertCircle, tile: "bg-neutral-100 text-neutral-500", dot: "bg-neutral-300", title: "Not handled yet", sub: "Assign an owner or open claims" };
  };

  const statusOptions: Array<{ value: string; label: string; count: number | undefined }> = [
    { value: "", label: "All statuses", count: statusCounts.all },
    { value: "PENDING", label: "Pending request", count: statusCounts.PENDING },
    { value: "REVIEWING", label: "Under review", count: statusCounts.REVIEWING },
    { value: "PROCESSING", label: "Recommendations sent", count: statusCounts.PROCESSING },
    { value: "AWAITING_DEPOSIT", label: "Awaiting deposit", count: statusCounts.AWAITING_DEPOSIT },
    { value: "CONFIRMED", label: "Confirmed", count: statusCounts.CONFIRMED },
    { value: "COMPLETED", label: "Completed", count: statusCounts.COMPLETED },
    { value: "CANCELED", label: "Canceled", count: statusCounts.CANCELED },
  ];

  const hasFilters = Boolean(searchQuery || selectedStatus || selectedOwner);

  return (
    <div className="w-full min-w-0 space-y-4 pb-12 sm:space-y-6">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100 sm:h-12 sm:w-12">
            <Users className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Group Stay Assignments</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Assign owners, link properties and run owner auctions</p>
          </div>
        </div>
        <Link
          href="/admin/group-stays"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline sm:self-auto"
        >
          <Building2 className="h-3.5 w-3.5 text-teal-600" />
          Group Stays overview
        </Link>
      </div>

      {/* Toolbar: view tabs, then search and filters, always visible */}
      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-neutral-100 p-1" role="tablist" aria-label="Assignment view">
            {([
              { key: "admin" as const, label: "Admin-handled", icon: User, value: summary?.admin },
              { key: "claims" as const, label: "Open for claims", icon: Gavel, value: summary?.claims },
              { key: "all" as const, label: "All", icon: Users, value: summary?.total },
            ]).map(({ key, label, icon: Icon, value }) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setView(key); setPage(1); }}
                  className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border-0 px-3 py-1.5 text-xs font-semibold transition ${
                    active ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? "text-teal-600" : ""}`} />
                  {label}
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? "bg-teal-50 text-teal-700" : "bg-neutral-200/70 text-neutral-500"}`}>
                    {summaryLoading || typeof value !== "number" ? "…" : value.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
          {loading && groupStays.length > 0 ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/50 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_13rem_15rem]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search customer, region, owner or property"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search group stays"
              className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-10 pr-10 font-[inherit] text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                aria-label="Clear search"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
            aria-label="Filter by status"
            className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 font-[inherit] text-sm text-neutral-700 outline-none transition hover:border-neutral-300 focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
          >
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}{typeof o.count === "number" ? ` (${o.count})` : ""}</option>
            ))}
          </select>
          <select
            value={selectedOwner}
            onChange={(e) => { setSelectedOwner(e.target.value); setPage(1); }}
            aria-label="Filter by owner"
            disabled={owners.length === 0}
            className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 font-[inherit] text-sm text-neutral-700 outline-none transition hover:border-neutral-300 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 disabled:opacity-60"
          >
            <option value="">{ownersLoading ? "Loading owners…" : `All owners (${ownerCounts.all})`}</option>
            {owners.map((owner) => {
              const count = ownerCounts[owner.id.toString()] || 0;
              return (
                <option key={owner.id} value={owner.id.toString()}>
                  {owner.name || owner.email}{count > 0 ? ` (${count})` : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Load errors */}
      {[
        { error: ownersError, title: "Couldn't load owners", retry: loadOwners },
        { error: propertiesError, title: "Couldn't load properties", retry: loadProperties },
      ].filter((e) => e.error).map((e) => (
        <div key={e.title} role="alert" className="flex items-center gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3">
          <XCircle className="h-4 w-4 flex-shrink-0 text-rose-600" />
          <p className="m-0 min-w-0 flex-1 text-sm text-rose-800"><span className="font-semibold">{e.title}.</span> {e.error}</p>
          <button type="button" onClick={e.retry} className="rounded-lg border border-solid border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">
            Retry
          </button>
        </div>
      ))}

      {/* Group stays */}
      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        {/* Row colour legend (counts reflect the rows on this page) */}
        {filteredGroupStays.length > 0 && (() => {
          const counts = filteredGroupStays.reduce((acc, gs) => {
            const t = rowColumns(gs).stage.tone as RowTone;
            acc[t] = (acc[t] || 0) + 1;
            return acc;
          }, {} as Partial<Record<RowTone, number>>);
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-0 border-b border-solid border-neutral-100 px-5 py-2.5">
              {(Object.keys(ROW_TONES) as RowTone[]).filter((t) => counts[t]).map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                  <span className={`h-1 w-4 rounded-full ${ROW_TONES[t].swatch}`} />
                  {ROW_TONES[t].label}
                  <span className="tabular-nums text-neutral-400">{counts[t]}</span>
                </span>
              ))}
            </div>
          );
        })()}

        {/* Column captions (desktop) */}
        <div className="hidden grid-cols-[6rem_minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.05fr)_1rem] items-center gap-x-5 bg-neutral-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 lg:grid">
          <span>Booking</span>
          <span>Customer</span>
          <span>Group</span>
          <span>Destination</span>
          <span>Stay</span>
          <span>Owner</span>
          <span>Property</span>
          <span>Stage</span>
          <span />
        </div>

        {loading && groupStays.length === 0 ? (
          <ul className="m-0 list-none p-0">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex animate-pulse items-center gap-4 border-0 border-t border-solid border-neutral-100 px-5 py-4">
                <div className="h-5 w-20 rounded bg-neutral-200" />
                <div className="h-4 flex-1 rounded bg-neutral-100" />
                <div className="hidden h-4 w-40 rounded bg-neutral-100 md:block" />
                <div className="h-6 w-28 rounded-full bg-neutral-100" />
              </li>
            ))}
          </ul>
        ) : filteredGroupStays.length === 0 ? (
          <div className="flex flex-col items-center justify-center border-0 border-t border-solid border-neutral-100 px-4 py-14 text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <Users className="h-6 w-6" />
            </span>
            <p className="m-0 text-sm font-semibold text-neutral-800">No group stays found</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{hasFilters ? "Try adjusting your search or filters." : "There are no group stays to display right now."}</p>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); setSelectedStatus(""); setSelectedOwner(""); setPage(1); }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {filteredGroupStays.map((gs) => {
              const expanded = Boolean(expandedRows[gs.id]);
              const columns = rowColumns(gs);
              const checkIn = fmtDay(gs.checkIn);
              const checkOut = fmtDay(gs.checkOut);
              const nights = gs.checkIn && gs.checkOut ? Math.max(0, Math.round((new Date(gs.checkOut).getTime() - new Date(gs.checkIn).getTime()) / 86_400_000)) : null;
              const statusKey = (gs.status || "").toUpperCase();
              const claimsSwitch = (
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <Gavel className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Competitive claims</p>
                    <p className="m-0 mt-0.5 text-xs leading-snug text-neutral-500">
                      {gs.isOpenForClaims
                        ? `Open${gs.openedForClaimsAt ? ` since ${fmtDay(gs.openedForClaimsAt)}` : ""}. Closing needs a reason.`
                        : "Let verified owners compete with offers."}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(gs.isOpenForClaims)}
                    onClick={() => handleToggleOpenForClaims(gs.id, gs.isOpenForClaims || false)}
                    disabled={openingForClaims === gs.id}
                    aria-label={gs.isOpenForClaims ? "Close for claims" : "Open for claims"}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-0 transition-colors focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 ${gs.isOpenForClaims ? "bg-emerald-600" : "bg-neutral-300"}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${gs.isOpenForClaims ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              );
              const assignableOwnerIds = new Set(owners.map((o) => o.id));
              const ownerOf = (p: Property) => p.owner?.id ?? p.ownerId ?? null;
              // Before owners load we cannot judge, so nothing is hidden yet.
              const isAssignableProperty = (p: Property) => owners.length === 0 || (ownerOf(p) != null && assignableOwnerIds.has(ownerOf(p) as number));
              // What the customer asked for: region, district and accommodation type ("other" means any type).
              const wantType = gs.accommodationType && placeKey(gs.accommodationType) !== "other" ? placeKey(gs.accommodationType) : null;
              const wantDistrict = gs.toDistrict ? placeKey(gs.toDistrict) : null;
              const requestLabel = [
                wantType ? `${humanizeLabel(gs.accommodationType)}s` : "Properties",
                wantDistrict ? `in ${formatPlaceName(gs.toDistrict as string)}` : gs.toRegion ? `in ${formatPlaceName(gs.toRegion)}` : "",
              ].filter(Boolean).join(" ");
              const matchingProperties = properties.filter(
                (p) =>
                  isAssignableProperty(p) &&
                  (!gs.toRegion || placeKey(p.regionName) === placeKey(gs.toRegion)) &&
                  (!wantDistrict || placeKey(p.district) === wantDistrict) &&
                  (!wantType || placeKey(p.type) === wantType),
              );
              // Once an owner is assigned, only their matching properties can be linked.
              const regionProperties = matchingProperties.filter((p) => !gs.assignedOwner || ownerOf(p) === gs.assignedOwner.id);
              const picks = propertyPicks[gs.id] || [];
              // Only owners who actually have a property matching the request can be assigned.
              const matchingOwnerIds = new Set(matchingProperties.map((p) => ownerOf(p)).filter((id): id is number => id != null));
              const regionOwners = [...owners]
                .filter((o) => matchingOwnerIds.has(o.id))
                .sort((a, b) => getLocationMatchScore(b, gs) - getLocationMatchScore(a, gs));
              const recommendedOwners = (() => {
                const ids = Array.isArray(gs.recommendedPropertyIds) ? gs.recommendedPropertyIds : [];
                const byOwner = new Map<number, { owner: { id: number; name: string | null; email: string | null }; titles: string[] }>();
                for (const id of ids) {
                  const prop = properties.find((p) => p.id === id);
                  const oid = prop ? ownerOf(prop) : null;
                  if (!prop || oid == null) continue;
                  const known = owners.find((o) => o.id === oid);
                  const owner = prop.owner ?? (known ? { id: known.id, name: known.name, email: known.email } : null);
                  if (!owner) continue;
                  const entry = byOwner.get(oid) ?? { owner, titles: [] };
                  entry.titles.push(prop.title);
                  byOwner.set(oid, entry);
                }
                return Array.from(byOwner.values());
              })();

              return (
                <li key={gs.id} className={`border-0 border-t border-solid border-neutral-100 ${ROW_TONES[columns.stage.tone as RowTone].row}`}>
                  {/* Summary row: click anywhere to open the workspace */}
                  <button
                    type="button"
                    onClick={() => setExpandedRows((prev) => ({ ...prev, [gs.id]: !prev[gs.id] }))}
                    aria-expanded={expanded}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-0 bg-transparent px-4 py-3.5 text-left transition-colors hover:bg-black/[0.02] sm:px-5 lg:grid-cols-[6rem_minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.05fr)_1rem]"
                  >
                    <div className="min-w-0">
                      <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-700">
                        GS-{String(gs.id).padStart(4, "0")}
                      </span>
                      {/* Stage colour as a short horizontal bar, matching the legend */}
                      <span
                        className={`mt-1.5 block h-1 w-12 rounded-full ${ROW_TONES[columns.stage.tone as RowTone].swatch}`}
                        title={ROW_TONES[columns.stage.tone as RowTone].label}
                        aria-label={ROW_TONES[columns.stage.tone as RowTone].label}
                      />
                      {/* Status lives in the Stage column; here, when the request came in. */}
                      <div className="mt-1.5 text-xs text-neutral-400" title={humanizeLabel(statusKey)}>
                        {fmtDay(gs.createdAt) || " "}
                      </div>
                    </div>

                    <ChevronDown className={`h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform lg:hidden ${expanded ? "rotate-180" : ""}`} />

                    <div className="col-span-2 min-w-0 lg:col-span-1">
                      <div className="truncate text-sm font-semibold text-neutral-900">{gs.user?.name || gs.user?.email || "Unknown customer"}</div>
                      <div className="mt-0.5 truncate text-xs text-neutral-400">{gs.user?.phone || gs.user?.email || ""}</div>
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-sm text-neutral-700">{humanizeLabel(gs.groupType)}</div>
                      <div className="mt-0.5 text-xs text-neutral-400">{gs.headcount} guests · {gs.roomsNeeded} rooms</div>
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-sm text-neutral-700">{gs.toRegion ? formatPlaceName(gs.toRegion) : "Not set"}</div>
                      <div className="mt-0.5 truncate text-xs text-neutral-400">{gs.toDistrict ? formatPlaceName(gs.toDistrict) : " "}</div>
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-sm tabular-nums text-neutral-700">{checkIn || "Flexible"}</div>
                      <div className="mt-0.5 text-xs text-neutral-400">{checkIn ? (nights != null ? `${nights} ${nights === 1 ? "night" : "nights"}` : "Open checkout") : " "}</div>
                    </div>

                    {/* Owner */}
                    <div className="min-w-0">
                      <div className="lg:hidden text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Owner</div>
                      <div className={`truncate text-sm ${columns.owner.muted ? "text-neutral-400" : "text-neutral-800"}`} title={columns.owner.text}>{columns.owner.text}</div>
                      <div className="mt-0.5 truncate text-xs text-neutral-400">{columns.owner.sub || "\u00a0"}</div>
                    </div>

                    {/* Property */}
                    <div className="min-w-0">
                      <div className="lg:hidden text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Property</div>
                      <div className={`truncate text-sm ${columns.property.muted ? "text-neutral-400" : "text-neutral-800"}`} title={columns.property.text}>{columns.property.text}</div>
                      <div className="mt-0.5 truncate text-xs text-neutral-400">{columns.property.sub || "\u00a0"}</div>
                    </div>

                    {/* Stage */}
                    {(() => {
                      const StageIcon = columns.stage.icon;
                      return (
                        <div className="col-span-2 flex min-w-0 items-start gap-2 lg:col-span-1">
                          <StageIcon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${columns.stage.attention ? "text-amber-600" : "text-neutral-400"}`} aria-hidden />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-neutral-800">{columns.stage.text}</div>
                            <div className={`mt-0.5 truncate text-xs ${columns.stage.attention ? "font-medium text-amber-700" : "text-neutral-400"}`}>
                              {columns.stage.next}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <ChevronDown className={`hidden h-4 w-4 justify-self-end text-neutral-400 transition-transform lg:block ${expanded ? "rotate-180" : ""}`} />
                  </button>

                  {/* Workspace */}
                  {expanded && (
                    <div className="px-4 pb-4 sm:px-5">
                    <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                      {gs.isOpenForClaims ? (
                        <div className="bg-white">
                          <div className="flex flex-wrap items-center gap-2 bg-emerald-50/40 px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                              <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
                              Auction live
                            </span>
                            <span className="text-xs text-neutral-500">Manual owner assignment is paused while owners compete.</span>
                            <div className="ml-auto flex gap-2">
                              <button
                                type="button"
                                onClick={() => openClaimsSettingsModal(gs)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50"
                              >
                                <FileText className="h-3.5 w-3.5" /> Settings
                              </button>
                              <Link
                                href={`/admin/group-stays/claims?bookingId=${gs.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white no-underline transition hover:bg-emerald-700 hover:no-underline"
                              >
                                <Gavel className="h-3.5 w-3.5" /> Manage auction
                              </Link>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-3">
                            {[
                              { label: "Deadline", value: gs.claimsConfig?.deadline ? new Date(gs.claimsConfig.deadline).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not set", sub: gs.claimsConfig?.updatedAt ? `Updated ${fmtDay(gs.claimsConfig.updatedAt)}` : null },
                              { label: "Minimum discount", value: gs.claimsConfig?.minDiscountPercent != null ? `${gs.claimsConfig.minDiscountPercent}%` : "None", sub: "Quality gate" },
                              { label: "Offers", value: (gs.claimsCount ?? 0).toLocaleString(), sub: gs.openedForClaimsAt ? `Opened ${fmtDay(gs.openedForClaimsAt)}` : null },
                            ].map((t) => (
                              <div key={t.label} className="bg-white px-4 py-3">
                                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">{t.label}</p>
                                <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{t.value}</p>
                                {t.sub ? <p className="m-0 mt-0.5 text-xs text-neutral-500">{t.sub}</p> : null}
                              </div>
                            ))}
                          </div>
                          {gs.claimsConfig?.notes ? (
                            <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-sm text-neutral-700 whitespace-pre-wrap">{gs.claimsConfig.notes}</p>
                          ) : null}
                          <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
                            <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Best offers</p>
                            {gs.claimsPreview && gs.claimsPreview.length > 0 ? (
                              <ul className="m-0 list-none space-y-1.5 p-0">
                                {gs.claimsPreview.map((c) => {
                                  const amount = Number(c.totalAmount);
                                  const perNight = Number(c.offeredPricePerNight);
                                  const discount = c.discountPercent !== null && c.discountPercent !== undefined ? Number(c.discountPercent) : null;
                                  return (
                                    <li key={c.id} className="flex items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="m-0 truncate text-sm font-semibold text-neutral-900">{c.property?.title || "Property"}</p>
                                        <p className="m-0 truncate text-xs text-neutral-500">{c.owner?.name || c.owner?.email} · {humanizeLabel(c.status)}</p>
                                      </div>
                                      {discount !== null && Number.isFinite(discount) && discount > 0 ? (
                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{discount}% off</span>
                                      ) : null}
                                      <div className="text-right">
                                        <p className="m-0 text-sm font-bold tabular-nums text-neutral-900">{Number.isFinite(amount) ? amount.toLocaleString() : String(c.totalAmount)} {c.currency}</p>
                                        <p className="m-0 text-[11px] tabular-nums text-neutral-400">{Number.isFinite(perNight) ? perNight.toLocaleString() : String(c.offeredPricePerNight)}/night</p>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="m-0 text-sm text-neutral-500">No offers submitted yet.</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-px bg-neutral-100 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
                          {/* Owner */}
                          <div className="bg-white p-4">
                            <p className="m-0 mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                              <User className="h-3.5 w-3.5" /> Assigned owner
                            </p>
                            {gs.assignedOwner ? (
                              <div className="flex items-center gap-3">
                                <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                                  {(gs.assignedOwner.name || gs.assignedOwner.email || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="m-0 truncate text-sm font-bold text-neutral-900">{gs.assignedOwner.name || gs.assignedOwner.email}</p>
                                  <p className="m-0 mt-0.5 flex items-center gap-1 truncate text-xs text-neutral-500"><Mail className="h-3 w-3" />{gs.assignedOwner.email}</p>
                                </div>
                                <CheckCircle className="h-4 w-4 flex-shrink-0 text-blue-600" />
                              </div>
                            ) : recommendedOwners.length > 0 ? (
                              // The owner follows the recommended property; no free choice here.
                              <div className="space-y-2">
                                {recommendedOwners.map(({ owner, titles }) => (
                                  <div key={owner.id} className="flex items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2.5">
                                    <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-700">
                                      {(owner.name || owner.email || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="m-0 truncate text-sm font-semibold text-neutral-900">{owner.name || owner.email}</p>
                                      <p className="m-0 mt-0.5 truncate text-xs text-neutral-500" title={titles.join(", ")}>Owns {titles.map((t) => tidyName(t)).join(", ")}</p>
                                    </div>
                                    {gs.status !== "REVIEWING" && recommendedOwners.length === 1 ? (
                                      <button
                                        type="button"
                                        onClick={() => setPendingAssign({ kind: "owner", gsId: gs.id, ownerId: owner.id, ownerName: owner.name || owner.email || "this owner", note: `Owns ${titles.map((t) => tidyName(t)).join(", ")}` })}
                                        disabled={assigning === gs.id}
                                        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border-0 bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
                                      >
                                        {assigning === gs.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                        {assigning === gs.id ? "Assigning…" : "Assign"}
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                                <p className="m-0 text-[11px] text-neutral-400">
                                  {gs.status === "REVIEWING"
                                    ? "Matched from the recommended properties. The owner is set when the customer confirms one."
                                    : recommendedOwners.length === 1
                                      ? "Matched from the recommended property."
                                      : "Matched from the recommended properties. The owner is set when the customer picks one."}
                                </p>
                              </div>
                            ) : gs.status === "REVIEWING" ? (
                              <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                                <p className="m-0 text-sm font-semibold text-amber-900">Waiting for customer consultation</p>
                                <p className="m-0 mt-1 text-xs leading-relaxed text-amber-800">
                                  Owners aren&apos;t assigned from here while the booking is under review. Send the three quoted options from the booking; the owner fills in automatically once the customer confirms.
                                </p>
                                <Link href={`/admin/group-stays/bookings?bookingId=${gs.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 no-underline hover:underline">
                                  Open booking <ChevronRight className="h-3 w-3" />
                                </Link>
                              </div>
                            ) : ownersLoading ? (
                              <p className="m-0 flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading owners…</p>
                            ) : regionOwners.length === 0 ? (
                              <p className="m-0 text-sm text-neutral-500">
                                No owner has approved {requestLabel.charAt(0).toLowerCase() + requestLabel.slice(1)} yet.
                              </p>
                            ) : (
                              <>
                                <select
                                  disabled={assigning === gs.id || ownersLoading}
                                  value=""
                                  onChange={(e) => {
                                    const ownerId = Number(e.target.value);
                                    const owner = owners.find((o) => o.id === ownerId);
                                    if (!owner) return;
                                    const match = getLocationMatchLabel(owner, gs, getLocationMatchScore(owner, gs)).replace(/^✓\s*/, "");
                                    setPendingAssign({ kind: "owner", gsId: gs.id, ownerId, ownerName: owner.name || owner.email, note: match || null });
                                  }}
                                  aria-label="Select owner to assign"
                                  className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 font-[inherit] text-sm text-neutral-800 outline-none transition hover:border-neutral-300 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 disabled:opacity-60"
                                >
                                  <option value="">{assigning === gs.id ? "Assigning…" : `Choose an owner with ${requestLabel.charAt(0).toLowerCase() + requestLabel.slice(1)}`}</option>
                                  {regionOwners.map((owner) => {
                                      const count = matchingProperties.filter((p) => ownerOf(p) === owner.id).length;
                                      return (
                                        <option key={owner.id} value={owner.id}>
                                          {owner.name || owner.email} · {count} matching {count === 1 ? "property" : "properties"}
                                        </option>
                                      );
                                    })}
                                </select>
                                <p className="m-0 mt-1.5 flex items-center gap-1 text-[11px] text-neutral-400">
                                  <MapPin className="h-3 w-3" /> Only owners with an approved property matching the request
                                </p>
                              </>
                            )}
                          </div>

                          {/* Recommended properties */}
                          <div className="bg-white p-4">
                            <p className="m-0 mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                              <Building2 className="h-3.5 w-3.5" /> Recommended properties
                            </p>
                            {Array.isArray(gs.recommendedPropertyIds) && gs.recommendedPropertyIds.length > 0 ? (
                              <ul className="m-0 list-none space-y-1.5 p-0">
                                {gs.recommendedPropertyIds.map((propId) => {
                                  const prop = properties.find((p) => p.id === propId);
                                  return prop ? (
                                    <li key={propId} className="flex items-center gap-2.5 rounded-lg bg-neutral-50 px-3 py-2">
                                      <Building2 className="h-4 w-4 flex-shrink-0 text-indigo-600" />
                                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">{tidyName(prop.title)}</span>
                                      <span className="text-[11px] text-neutral-500">{humanizeLabel(prop.type)}</span>
                                    </li>
                                  ) : null;
                                })}
                              </ul>
                            ) : gs.status === "REVIEWING" ? (
                              <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
                                <p className="m-0 text-sm font-semibold text-neutral-800">No recommendations sent yet</p>
                                <p className="m-0 mt-1 text-xs leading-relaxed text-neutral-500">Send the recommended options from the booking; they show here automatically.</p>
                                <Link href={`/admin/group-stays/bookings?bookingId=${gs.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-neutral-800 no-underline hover:underline">
                                  Open booking <ChevronRight className="h-3 w-3" />
                                </Link>
                              </div>
                            ) : propertiesLoading ? (
                              <p className="m-0 flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading properties…</p>
                            ) : (
                              <>
                                {/* What is being matched, so the admin knows why the list is short */}
                                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">{requestLabel}</span>
                                  {gs.assignedOwner ? (
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">Owner: {gs.assignedOwner.name || gs.assignedOwner.email}</span>
                                  ) : null}
                                  <span className="ml-auto text-[11px] tabular-nums text-neutral-400">{regionProperties.length} {regionProperties.length === 1 ? "match" : "matches"}</span>
                                </div>

                                {regionProperties.length === 0 ? (
                                  <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center">
                                    <p className="m-0 text-sm font-medium text-neutral-700">No matching properties</p>
                                    <p className="m-0 mt-0.5 text-xs text-neutral-500">
                                      {gs.assignedOwner
                                        ? `${gs.assignedOwner.name || gs.assignedOwner.email} has no approved ${requestLabel.charAt(0).toLowerCase() + requestLabel.slice(1)}.`
                                        : `There are no approved ${requestLabel.charAt(0).toLowerCase() + requestLabel.slice(1)} yet.`}
                                    </p>
                                  </div>
                                ) : (
                                <>
                                <ul className="m-0 max-h-52 list-none space-y-1.5 overflow-y-auto p-0">
                                  {regionProperties.map((prop) => {
                                    const checked = picks.includes(prop.id);
                                    const toggle = () =>
                                      setPropertyPicks((prev) => {
                                        const cur = prev[gs.id] || [];
                                        return { ...prev, [gs.id]: cur.includes(prop.id) ? cur.filter((id) => id !== prop.id) : [...cur, prop.id] };
                                      });
                                    return (
                                      <li key={prop.id}>
                                        <button
                                          type="button"
                                          role="checkbox"
                                          aria-checked={checked}
                                          disabled={linking === gs.id}
                                          onClick={toggle}
                                          className={`flex w-full items-center gap-3 rounded-lg border border-solid px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                                            checked ? "border-teal-300 bg-teal-50" : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
                                          }`}
                                        >
                                          {/* Custom tick box: always visible, unlike the UA checkbox on a white row */}
                                          <span
                                            aria-hidden
                                            className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 border-solid transition-colors ${
                                              checked ? "border-teal-600 bg-teal-600 text-white" : "border-neutral-300 bg-white"
                                            }`}
                                          >
                                            {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                                          </span>
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-neutral-900">{tidyName(prop.title)}</span>
                                            <span className="mt-0.5 block truncate text-xs text-neutral-500">
                                              {humanizeLabel(prop.type)}
                                              {prop.district ? ` · ${formatPlaceName(prop.district)}` : ""}
                                              {!gs.assignedOwner && prop.owner ? ` · ${prop.owner.name || prop.owner.email}` : ""}
                                            </span>
                                          </span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                                <div className="mt-2.5 flex items-center justify-between gap-2">
                                  <span className="text-xs text-neutral-500">{picks.length > 0 ? `${picks.length} selected` : "Select one or more"}</span>
                                  <button
                                    type="button"
                                    disabled={picks.length === 0 || linking === gs.id}
                                    onClick={() =>
                                      setPendingAssign({
                                        kind: "properties",
                                        gsId: gs.id,
                                        propertyIds: picks,
                                        titles: picks.map((id) => tidyName(properties.find((p) => p.id === id)?.title || `Property #${id}`)),
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                                  >
                                    {linking === gs.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
                                    {linking === gs.id ? "Linking…" : "Link selected"}
                                  </button>
                                </div>
                                </>
                                )}
                              </>
                            )}
                          </div>

                          {/* Claims */}
                          <div className="bg-white p-4 md:col-span-2 xl:col-span-1">
                            <p className="m-0 mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                              <Gavel className="h-3.5 w-3.5" /> Or run an auction
                            </p>
                            {claimsSwitch}
                          </div>
                        </div>
                      )}

                      {gs.isOpenForClaims && (
                        <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3">{claimsSwitch}</div>
                      )}

                      {gs.confirmedProperty && (
                        <div className="flex items-center gap-3 border-0 border-t border-solid border-teal-100 bg-teal-50/60 px-4 py-3">
                          <CheckCircle className="h-5 w-5 flex-shrink-0 text-teal-700" />
                          <div className="min-w-0">
                            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-teal-700">Confirmed property</p>
                            <p className="m-0 mt-0.5 truncate text-sm font-bold text-teal-900">{gs.confirmedProperty.title}</p>
                          </div>
                        </div>
                      )}

                      {/* Deposit: full payment picture once the customer has paid */}
                      {(gs.depositPaid || gs.depositPaidAt) && (() => {
                        const currency = gs.currency || "TZS";
                        const events = gs.paymentEvents || [];
                        const successful = events.filter((e) => String(e.status).toUpperCase() === "SUCCESS");
                        const paidEvent = successful[0] || null;
                        const eventsTotal = successful.reduce((sum, e) => sum + (toAmount(e.amount) ?? 0), 0);
                        const deposited = successful.length > 0 ? eventsTotal : toAmount(gs.depositAmount);
                        const total = toAmount(gs.totalAmount);
                        const balance = total !== null && deposited !== null ? Math.max(total - deposited, 0) : null;
                        const payout = toAmount(gs.ownerPayoutAmount);
                        const payoutStatus = String(gs.ownerPayoutStatus || "NONE").toUpperCase();
                        const provider = gs.paymentProvider || paidEvent?.provider || null;
                        const channel = paidEvent?.paymentChannel ? CHANNEL_LABELS[paidEvent.paymentChannel.toUpperCase()] || humanizeLabel(paidEvent.paymentChannel) : null;
                        const phone = gs.payerPhone || paidEvent?.phone || null;
                        const facts: Array<{ label: string; value: string; sub?: string | null; strong?: boolean }> = [
                          { label: "Deposited amount", value: fmtMoney(toAmount(gs.depositAmount) ?? deposited, currency), sub: gs.commissionPercent != null ? `NoLSAF commission ${Number(gs.commissionPercent)}%` : null, strong: true },
                          { label: "Deposited at", value: fmtDateTime(gs.depositPaidAt || paidEvent?.createdAt) || "Not recorded", sub: gs.depositDueAt ? `Due ${fmtDateTime(gs.depositDueAt)}` : null },
                          { label: "Deposited via", value: [provider ? humanizeLabel(provider) : null, channel].filter(Boolean).join(" · ") || "Not recorded", sub: phone },
                          { label: "Total deposited", value: fmtMoney(deposited, currency), sub: `${successful.length || (gs.depositPaid ? 1 : 0)} successful ${successful.length === 1 || (!successful.length && gs.depositPaid) ? "payment" : "payments"}`, strong: true },
                          { label: "Booking total", value: fmtMoney(total, currency), sub: toAmount(gs.ownerAmount) !== null ? `Owner price ${fmtMoney(toAmount(gs.ownerAmount), currency)}` : null },
                          { label: "Balance at property", value: fmtMoney(balance, currency), sub: "Customer pays the owner on arrival" },
                          { label: "Owner payout", value: fmtMoney(payout, currency), sub: payoutStatus === "PAID" ? `Paid ${fmtDateTime(gs.ownerPayoutPaidAt) || ""}${gs.ownerPayoutRef ? ` · ${gs.ownerPayoutRef}` : ""}` : payoutStatus === "PENDING" ? "Pending transfer" : "Due after check-in" },
                          { label: "Checked in", value: fmtDateTime(gs.checkedInAt) || "Not yet", sub: gs.confirmedAt ? `Confirmed ${fmtDateTime(gs.confirmedAt)}` : null },
                        ];
                        return (
                          <div className="border-0 border-t border-solid border-neutral-100">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                              <span className="h-1 w-8 rounded-full bg-blue-600" aria-hidden />
                              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">Deposit received</p>
                              {gs.paymentRef ? (
                                <span className="ml-auto font-mono text-[11px] text-neutral-500" title="Payment reference">Ref {gs.paymentRef}</span>
                              ) : null}
                            </div>
                            <div className="m-4 mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
                              {facts.map((f) => (
                                <div key={f.label} className="min-w-0 bg-white px-3 py-2.5">
                                  <p className="m-0 text-[11px] text-neutral-400">{f.label}</p>
                                  <p className={`m-0 mt-0.5 truncate text-sm tabular-nums ${f.strong ? "font-semibold text-blue-900" : "text-neutral-800"}`} title={f.value}>{f.value}</p>
                                  {f.sub ? <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={f.sub}>{f.sub}</p> : null}
                                </div>
                              ))}
                            </div>
                            {events.length > 1 && (
                              <div className="mx-4 mb-4">
                                <p className="m-0 mb-1.5 text-[11px] text-neutral-400">Payment attempts</p>
                                <ul className="m-0 list-none rounded-lg [&>li+li]:border-0 [&>li+li]:border-t [&>li+li]:border-solid [&>li+li]:border-neutral-100 border border-solid border-neutral-100 p-0">
                                  {events.map((e) => {
                                    const st = String(e.status).toUpperCase();
                                    return (
                                      <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${st === "SUCCESS" ? "bg-blue-600" : st === "FAILED" ? "bg-rose-500" : "bg-amber-500"}`} />
                                        <span className="w-32 flex-shrink-0 text-neutral-500">{fmtDateTime(e.createdAt)}</span>
                                        <span className="min-w-0 flex-1 truncate text-neutral-700">
                                          {humanizeLabel(e.provider)}
                                          {e.paymentChannel ? ` · ${CHANNEL_LABELS[e.paymentChannel.toUpperCase()] || humanizeLabel(e.paymentChannel)}` : ""}
                                          {e.phone ? ` · ${e.phone}` : ""}
                                        </span>
                                        <span className="tabular-nums text-neutral-800">{fmtMoney(toAmount(e.amount), e.currency || currency)}</span>
                                        <span className={`w-14 text-right ${st === "SUCCESS" ? "text-blue-700" : st === "FAILED" ? "text-rose-600" : "text-amber-700"}`}>{humanizeLabel(st)}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Activity: frame footer */}
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!expandedAudits[gs.id]) loadAuditHistory(gs.id);
                            setExpandedAudits((prev) => ({ ...prev, [gs.id]: !prev[gs.id] }));
                          }}
                          aria-expanded={Boolean(expandedAudits[gs.id])}
                          className="flex w-full items-center gap-3 border-0 border-t border-solid border-neutral-100 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-neutral-50"
                        >
                          <History className="h-4 w-4 text-neutral-400" />
                          <span className="text-sm font-semibold text-neutral-800">Activity</span>
                          {auditHistory[gs.id] ? (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">{auditHistory[gs.id].length}</span>
                          ) : null}
                          <ChevronDown className={`ml-auto h-4 w-4 text-neutral-400 transition-transform ${expandedAudits[gs.id] ? "rotate-180" : ""}`} />
                        </button>
                        {expandedAudits[gs.id] && (
                          <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
                            {auditLoading[gs.id] ? (
                              <p className="m-0 flex items-center gap-2 text-xs text-neutral-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading activity…</p>
                            ) : !auditHistory[gs.id] || auditHistory[gs.id].length === 0 ? (
                              <p className="m-0 text-xs text-neutral-500">No activity yet.</p>
                            ) : (
                              <div className="max-h-96 overflow-y-auto pr-1">
                                {groupActivity(auditHistory[gs.id]).map((day) => (
                                  <section key={day.label} className="mb-3 last:mb-0">
                                    <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{day.label}</p>
                                    <ol className="relative m-0 list-none space-y-3 p-0 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-neutral-200">
                                      {day.items.map((item) => {
                                        const tone = activityTone(item.audit.action);
                                        const ToneIcon = tone.icon;
                                        const details = describeActivityMeta(item.audit.metadata);
                                        return (
                                          <li key={item.key} className="relative flex items-start gap-3">
                                            <span className={`relative z-10 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-white ${tone.cls}`}>
                                              <ToneIcon className="h-3 w-3" />
                                            </span>
                                            <div className="min-w-0 flex-1 pt-0.5">
                                              <div className="flex flex-wrap items-baseline gap-x-2">
                                                <span className="text-sm font-medium text-neutral-900">{humanizeLabel(item.audit.action || "Activity")}</span>
                                                {item.count > 1 ? (
                                                  <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] font-semibold tabular-nums text-neutral-500" title="Recorded more than once in a row">×{item.count}</span>
                                                ) : null}
                                                <span className="ml-auto text-xs tabular-nums text-neutral-400">
                                                  {new Date(item.audit.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                              </div>
                                              {item.audit.description ? <p className="m-0 mt-0.5 text-xs leading-relaxed text-neutral-600">{item.audit.description}</p> : null}
                                              {details.length > 0 || item.audit.admin ? (
                                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                  {details.map((d) => (
                                                    <span key={d} className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">{d}</span>
                                                  ))}
                                                  {item.audit.admin ? (
                                                    <span className="text-[11px] text-neutral-400">by {item.audit.admin.name || item.audit.admin.email || `Admin #${item.audit.adminId}`}</span>
                                                  ) : null}
                                                </div>
                                              ) : null}
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ol>
                                  </section>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {totalItems > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={totalItems}
            onPageChange={(next) => setPage(Math.min(Math.max(1, Math.ceil(totalItems / pageSize)), Math.max(1, next)))}
          />
        )}
      </div>

      {/* Confirm owner assignment / property linking */}
      {pendingAssign && (() => {
        const target = groupStays.find((g) => g.id === pendingAssign.gsId);
        const ref = `GS-${String(pendingAssign.gsId).padStart(4, "0")}`;
        const busy = pendingAssign.kind === "owner" ? assigning === pendingAssign.gsId : linking === pendingAssign.gsId;
        const cancel = () => { if (!busy) setPendingAssign(null); };
        const confirm = async () => {
          const p = pendingAssign;
          try {
            if (p.kind === "owner") {
              await handleAssignOwner(p.gsId, p.ownerId);
            } else {
              await handleLinkProperties(p.gsId, p.propertyIds);
              setPropertyPicks((prev) => ({ ...prev, [p.gsId]: [] }));
            }
          } catch {
            // The handlers already surface the error message.
          } finally {
            setPendingAssign(null);
          }
        };
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="gs-assign-confirm-title">
            <button type="button" aria-label="Dismiss" onClick={cancel} className="absolute inset-0 border-0 bg-neutral-950/40 backdrop-blur-[2px]" />
            <div className="relative box-border w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                  {pendingAssign.kind === "owner" ? <User className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="gs-assign-confirm-title" className="m-0 text-base font-bold text-neutral-900">
                    {pendingAssign.kind === "owner" ? "Assign this owner?" : `Link ${pendingAssign.propertyIds.length === 1 ? "this property" : `${pendingAssign.propertyIds.length} properties`}?`}
                  </h3>
                  <p className="m-0 mt-1 text-sm text-neutral-600">
                    Booking <span className="font-semibold text-neutral-900">{ref}</span>
                    {target?.toRegion ? ` · ${formatPlaceName(target.toRegion)}` : ""}
                    {target ? ` · ${target.headcount} guests` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-neutral-50 px-3.5 py-3">
                {pendingAssign.kind === "owner" ? (
                  <>
                    <p className="m-0 text-sm font-semibold text-neutral-900">{pendingAssign.ownerName}</p>
                    {pendingAssign.note ? <p className="m-0 mt-0.5 text-xs text-neutral-500">{pendingAssign.note}</p> : null}
                    {target?.assignedOwner && target.assignedOwner.id !== pendingAssign.ownerId ? (
                      <p className="m-0 mt-2 text-xs text-amber-700">This replaces {target.assignedOwner.name || target.assignedOwner.email}.</p>
                    ) : null}
                  </>
                ) : (
                  <ul className="m-0 list-none space-y-1 p-0">
                    {pendingAssign.titles.map((t, i) => (
                      <li key={`${t}-${i}`} className="flex items-center gap-2 text-sm text-neutral-800">
                        <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600" />
                        <span className="truncate">{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="m-0 mt-3 text-xs text-neutral-500">This is recorded in the booking&apos;s activity.</p>

              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={cancel} disabled={busy} className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">
                  Go back
                </button>
                <button type="button" onClick={confirm} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg border-0 bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {busy ? "Saving…" : pendingAssign.kind === "owner" ? "Assign owner" : "Link properties"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Open / manage claims modal */}
      {showClaimsModal && (() => {
        const selected = groupStays.find((gs) => gs.id === selectedGroupStayForClaims) || null;
        const hasManualHandling = Boolean(selected?.assignedOwner) || (Array.isArray(selected?.recommendedPropertyIds) && (selected?.recommendedPropertyIds?.length || 0) > 0);
        const hasConfirmed = Boolean(selected?.confirmedProperty);
        const needsReadvertise = claimsModalMode === "open" && hasManualHandling;
        const submitting = openingForClaims === selectedGroupStayForClaims;
        const submitDisabled = !claimsDeadline || submitting || hasConfirmed || (needsReadvertise && !reAdvertiseConfirmed);
        const inputCls = "box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white font-[inherit] text-sm text-neutral-900 outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100";

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" onClick={closeClaimsModal}>
            <div className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm" />
            <div className="relative box-border flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Gavel className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-base font-bold text-neutral-900">{claimsModalMode === "edit" ? "Auction settings" : "Open for competitive claims"}</h2>
                  <p className="m-0 mt-0.5 text-xs text-neutral-500">
                    {selected ? `GS-${String(selected.id).padStart(4, "0")} · ` : ""}
                    {claimsModalMode === "edit" ? "Adjust the auction without closing it" : "Owners can submit offers until the deadline"}
                  </p>
                </div>
                <button type="button" onClick={closeClaimsModal} aria-label="Close" className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {hasConfirmed ? (
                  <div className="rounded-lg bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
                    <span className="font-semibold">Can&apos;t open claims.</span> This booking already has a confirmed property.
                  </div>
                ) : needsReadvertise ? (
                  <div className="overflow-hidden rounded-xl border border-solid border-amber-200 bg-amber-50/70">
                    <div className="flex items-start gap-2.5 px-3.5 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-semibold text-amber-900">Re-advertise required</p>
                        <p className="m-0 mt-0.5 text-[13px] leading-relaxed text-amber-800">
                          This booking was handled directly (owner or properties assigned). Opening claims clears that manual handling.
                        </p>
                      </div>
                    </div>
                    {/* The confirmation gates the submit button, so it is a full-width switch row, not a faint checkbox. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={reAdvertiseConfirmed}
                      onClick={() => setReAdvertiseConfirmed((v) => !v)}
                      className={`flex w-full items-center gap-3 border-0 border-t border-solid px-3.5 py-2.5 text-left transition-colors ${
                        reAdvertiseConfirmed ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-white hover:bg-amber-50"
                      }`}
                    >
                      <span
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                          reAdvertiseConfirmed ? "bg-emerald-600" : "bg-neutral-300"
                        }`}
                        aria-hidden
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${reAdvertiseConfirmed ? "translate-x-6" : "translate-x-1"}`} />
                      </span>
                      <span className={`text-sm font-medium ${reAdvertiseConfirmed ? "text-emerald-800" : "text-neutral-800"}`}>
                        {reAdvertiseConfirmed ? "Confirmed: re-advertise and clear manual handling" : "Confirm re-advertising and clearing manual handling"}
                      </span>
                      {reAdvertiseConfirmed ? <CheckCircle className="ml-auto h-4 w-4 flex-shrink-0 text-emerald-600" /> : null}
                    </button>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-neutral-700">Submission deadline <span className="text-rose-500">*</span></label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setDeadlinePickerOpen(true)}
                        aria-label="Claims submission deadline (required)"
                        className={`${inputCls} flex items-center gap-2 px-3 text-left`}
                      >
                        <Calendar className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                        <span className={claimsDeadline ? "text-neutral-900" : "text-neutral-400"}>
                          {claimsDeadline ? new Date(claimsDeadline + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Select a date"}
                        </span>
                      </button>
                      {deadlinePickerOpen && (
                        <>
                          <div className="fixed inset-0 z-[60]" onClick={() => setDeadlinePickerOpen(false)} />
                          <div className="absolute left-0 top-full z-[70] mt-2">
                            <DatePicker
                              selected={claimsDeadline || undefined}
                              onSelectAction={(s) => {
                                const dateStr = Array.isArray(s) ? s[0] : s;
                                setClaimsDeadline(dateStr);
                                setDeadlinePickerOpen(false);
                              }}
                              onCloseAction={() => setDeadlinePickerOpen(false)}
                              allowRange={false}
                              minDate={new Date().toISOString().split("T")[0]}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <p className="m-0 mt-1 text-[11px] text-neutral-400">Owners must submit before this date.</p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-neutral-700">Minimum discount <span className="font-normal text-neutral-400">(optional)</span></label>
                    <div className="relative">
                      <Percent className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                      <input
                        type="number"
                        value={minDiscount}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || (Number(val) >= 0 && Number(val) <= 100)) setMinDiscount(val);
                        }}
                        placeholder="e.g. 10"
                        min="0"
                        max="100"
                        aria-label="Minimum discount percentage"
                        inputMode="decimal"
                        className={`${inputCls} pl-9 pr-3 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                      />
                    </div>
                    <p className="m-0 mt-1 text-[11px] text-neutral-400">Between 0 and 100%.</p>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-700">Notes for owners <span className="font-normal text-neutral-400">(optional)</span></label>
                  <textarea
                    value={claimsNotes}
                    onChange={(e) => setClaimsNotes(e.target.value)}
                    placeholder="Special requirements or preferences owners should know"
                    rows={3}
                    aria-label="Additional notes for claims"
                    className="box-border w-full resize-y rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2.5 font-[inherit] text-sm text-neutral-900 outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  />
                  <p className="m-0 mt-1 text-[11px] text-neutral-400">Visible to owners when they submit.</p>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-neutral-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
                {!hasConfirmed && submitDisabled && !submitting ? (
                  <p className="m-0 text-center text-xs text-neutral-500 sm:mr-auto sm:text-left">
                    {!claimsDeadline ? "Set a deadline to continue." : needsReadvertise && !reAdvertiseConfirmed ? "Confirm re-advertising to continue." : ""}
                  </p>
                ) : null}
                <button type="button" onClick={closeClaimsModal} className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitClaimsForm}
                  disabled={submitDisabled}
                  aria-label={claimsModalMode === "edit" ? "Save auction settings" : "Open for claims"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border-0 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {submitting ? (claimsModalMode === "edit" ? "Saving…" : "Opening…") : claimsModalMode === "edit" ? "Save settings" : "Open for claims"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Close claims modal (reason required) */}
      {showCloseClaimsModal && (() => {
        const closing = openingForClaims === selectedGroupStayForCloseClaims;
        const disabled = !closeClaimsReasonCode.trim() || (closeClaimsReasonCode === "POLICY_DECISION" && !closeClaimsReasonDetails.trim()) || closing;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" onClick={closeCloseClaimsModal}>
            <div className="absolute inset-0 bg-neutral-950/50 backdrop-blur-sm" />
            <div className="relative box-border flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <Ban className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-base font-bold text-neutral-900">Close competitive claims</h2>
                  <p className="m-0 mt-0.5 text-xs text-neutral-500">
                    {selectedGroupStayForCloseClaims ? `GS-${String(selectedGroupStayForCloseClaims).padStart(4, "0")} · ` : ""}A reason is saved to the audit log
                  </p>
                </div>
                <button type="button" onClick={closeCloseClaimsModal} aria-label="Close" className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-5 py-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-700">Reason <span className="text-rose-500">*</span></label>
                  <select
                    value={closeClaimsReasonCode}
                    onChange={(e) => { setCloseClaimsReasonCode(e.target.value); setCloseClaimsReasonError(""); }}
                    aria-label="Reason code for closing competitive claims"
                    className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 font-[inherit] text-sm text-neutral-900 outline-none transition hover:border-neutral-300 focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                  >
                    <option value="">Select a reason…</option>
                    <option value="OWNER_CONFIRMED">Owner confirmed</option>
                    <option value="NO_VALID_OFFERS">No valid offers</option>
                    <option value="POLICY_DECISION">Policy decision</option>
                  </select>
                  {closeClaimsReasonError ? <p className="m-0 mt-1 text-xs text-rose-600">{closeClaimsReasonError}</p> : null}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-700">
                    Details {closeClaimsReasonCode === "POLICY_DECISION" ? <span className="text-rose-500">*</span> : <span className="font-normal text-neutral-400">(optional)</span>}
                  </label>
                  <textarea
                    value={closeClaimsReasonDetails}
                    onChange={(e) => setCloseClaimsReasonDetails(e.target.value)}
                    placeholder="Short context, e.g. selected owner or key issue"
                    rows={3}
                    aria-label="Details for closing competitive claims"
                    className="box-border w-full resize-y rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2.5 font-[inherit] text-sm text-neutral-900 outline-none transition hover:border-neutral-300 focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-neutral-200 px-5 py-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeCloseClaimsModal} className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50">
                  Keep open
                </button>
                <button
                  type="button"
                  onClick={handleSubmitCloseClaims}
                  disabled={disabled}
                  aria-label="Close claims"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border-0 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  {closing ? "Closing…" : "Close claims"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

