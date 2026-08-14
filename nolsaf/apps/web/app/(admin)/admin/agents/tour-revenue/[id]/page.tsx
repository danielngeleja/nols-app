"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  MapPin,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import QRCode from "@/components/QRCode";

const api = apiClient;

type RevenueStatus = "DRAFT" | "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED";
type RevenueAction = "verify" | "approve" | "reject";

type RevenueAuditTrailItem = {
  action: "VERIFY" | "APPROVE" | "DISBURSE" | "REJECT";
  at: string;
  reason: string | null;
  paymentRef: string | null;
  admin: { id: number; name: string | null } | null;
};

type RevenueDetail = {
  id: number;
  bookingId: number;
  bookingCode: string;
  status: RevenueStatus;
  paymentStatus: string;
  payoutStatus: string;
  paymentRef: string | null;
  rejectionReason: string | null;
  title: string;
  destination: string;
  category: string | null;
  travelerCount: number;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  grossAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  taxPercent: number;
  taxAmount: number;
  netAmount: number;
  operatorPayoutAmount: number;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  payoutRequestedAt: string | null;
  payoutApprovedAt: string | null;
  payoutPaidAt: string | null;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  disbursedAt?: string | null;
  verifiedReason?: string | null;
  approvedReason?: string | null;
  verifiedByUser?: { id: number; name: string | null } | null;
  approvedByUser?: { id: number; name: string | null } | null;
  auditTrail?: RevenueAuditTrailItem[];
  operator: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    payoutPreferred?: string | null;
    bankAccountName?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankBranch?: string | null;
    mobileMoneyProvider?: string | null;
    mobileMoneyNumber?: string | null;
  };
  customer: { id: number | null; name: string; email: string | null; phone: string | null };
};

function money(value: number, currency = "TZS") {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      currencyDisplay: "narrowSymbol",
    }).format(Math.round(Number(value || 0)));
  } catch {
    return `${currency} ${Math.round(Number(value || 0)).toLocaleString()}`;
  }
}

const statusConfig: Record<RevenueStatus, { label: string; color: string; bgColor: string; icon: any }> = {
  DRAFT: { label: "Draft", color: "text-slate-700", bgColor: "bg-slate-50 border-slate-200", icon: FileText },
  NEW: { label: "New", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200", icon: Clock },
  CLAIMED: { label: "Claimed", color: "text-sky-700", bgColor: "bg-sky-50 border-sky-200", icon: FileText },
  VERIFIED: { label: "Verified", color: "text-yellow-700", bgColor: "bg-yellow-50 border-yellow-200", icon: AlertCircle },
  APPROVED: { label: "Approved", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  DISBURSED: { label: "Disbursed", color: "text-green-700", bgColor: "bg-green-50 border-green-200", icon: TrendingUp },
  REJECTED: { label: "Rejected", color: "text-rose-700", bgColor: "bg-rose-50 border-rose-200", icon: XCircle },
};

// Pipeline: NEW → CLAIMED (by operator) → VERIFIED → APPROVED, then paid
// exclusively through the AzamPay Disbursement queue (see the banner shown
// once a record is APPROVED, below). Verify only unlocks after a claim
// (CLAIMED).
function isActionAllowed(status: RevenueStatus, action: RevenueAction): boolean {
  if (action === "verify") return status === "CLAIMED";
  if (action === "approve") return status === "VERIFIED";
  if (action === "reject") return status !== "DRAFT" && status !== "DISBURSED" && status !== "REJECTED";
  return false;
}

export default function AdminTourRevenueDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id || 0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<RevenueDetail | null>(null);
  const [actionType, setActionType] = useState<RevenueAction | "">("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifyReason, setVerifyReason] = useState("");
  const [approveReason, setApproveReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setError("Invalid revenue record");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ ok: boolean; revenue: RevenueDetail }>(`/api/admin/tour-revenue/${id}`);
      if (res.data.ok) {
        setRevenue(res.data.revenue);
      } else {
        setError("Failed to load revenue details");
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to load revenue details");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function executeAction() {
    if (!revenue || !actionType) return;

    if (!isActionAllowed(revenue.status, actionType)) {
      alert("This action is not allowed at the current stage.");
      return;
    }

    if (actionType === "verify" && !String(verifyReason || "").trim()) {
      alert("Verification reason is required.");
      return;
    }

    if (actionType === "approve" && !String(approveReason || "").trim()) {
      alert("Approval reason is required.");
      return;
    }

    if (actionType === "reject" && !String(rejectionReason || "").trim()) {
      alert("Rejection reason is required.");
      return;
    }

    setActionLoading(true);
    try {
      const payload: Record<string, any> = { revenueId: revenue.id, action: actionType };
      if (actionType === "verify" && verifyReason) payload.reason = verifyReason.trim();
      if (actionType === "approve" && approveReason) payload.reason = approveReason.trim();
      if (actionType === "reject" && rejectionReason) payload.reason = rejectionReason.trim();

      const res = await api.post("/api/admin/tour-revenue/action", payload);
      if (res.data.ok) {
        setActionType("");
        setVerifyReason("");
        setApproveReason("");
        setRejectionReason("");
        await load();
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  const actionOptions = useMemo(() => {
    if (!revenue) return [] as Array<{ value: RevenueAction; label: string; enabled: boolean }>;
    const ordered: Array<{ value: RevenueAction; label: string }> = [
      { value: "verify", label: "Verify" },
      { value: "approve", label: "Approve" },
      { value: "reject", label: "Reject" },
    ];
    return ordered.map((item) => ({
      ...item,
      enabled: isActionAllowed(revenue.status, item.value),
    }));
  }, [revenue]);

  const enabledActions = useMemo(() => actionOptions.filter((item) => item.enabled), [actionOptions]);

  useEffect(() => {
    if (enabledActions.length === 0 && actionType !== "") {
      setActionType("");
    }
  }, [enabledActions, actionType]);

  useEffect(() => {
    if (!revenue) return;
    if (actionType === "verify" && !String(verifyReason || "").trim()) {
      setVerifyReason(`The invoice is genuine and belongs to ${revenue.operator.name}. Booking details and financial amounts have been reviewed and verified.`);
    }
  }, [actionType, revenue, verifyReason]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 min-w-0 animate-pulse">
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-72 rounded bg-slate-200" />
              <div className="h-4 w-40 rounded bg-slate-100" />
            </div>
            <div className="h-9 w-24 rounded-lg bg-slate-200" />
          </div>
          <div className="mt-4 h-7 w-28 rounded-full bg-slate-200" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm space-y-4">
              <div className="h-5 w-44 rounded bg-slate-200" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="h-16 rounded-lg bg-slate-100" />
                <div className="h-16 rounded-lg bg-slate-100" />
                <div className="h-16 rounded-lg bg-slate-100" />
                <div className="h-16 rounded-lg bg-slate-100" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="h-20 rounded-lg bg-slate-100" />
                <div className="h-20 rounded-lg bg-slate-100" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm space-y-4">
              <div className="h-5 w-40 rounded bg-slate-200" />
              <div className="h-14 rounded-lg bg-slate-100" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-20 rounded-lg bg-slate-100" />
                <div className="h-20 rounded-lg bg-slate-100" />
              </div>
              <div className="h-16 rounded-lg bg-emerald-100/70" />
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6 min-w-0">
            <div className="h-28 rounded-xl border border-gray-200 bg-white" />
            <div className="h-52 rounded-xl border border-gray-200 bg-white" />
            <div className="h-80 rounded-xl border border-gray-200 bg-white" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !revenue) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error || "Revenue record not found"}</div>
        <Link href="/admin/agents/tour-revenue" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#02665e] hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to Tour Revenue
        </Link>
      </div>
    );
  }

  const status = statusConfig[revenue.status];
  const StatusIcon = status.icon;
  const canExecuteAction =
    !!actionType &&
    !actionLoading &&
    (actionType !== "verify" || !!String(verifyReason || "").trim()) &&
    (actionType !== "approve" || !!String(approveReason || "").trim()) &&
    (actionType !== "reject" || !!String(rejectionReason || "").trim());

  const isDisbursed =
    revenue.status === "DISBURSED" ||
    String(revenue.paymentStatus || "").toUpperCase() === "DISBURSED" ||
    String(revenue.payoutStatus || "").toUpperCase() === "DISBURSED" ||
    Boolean(revenue.disbursedAt || revenue.payoutPaidAt);

  const payoutPreferred = String(revenue.operator?.payoutPreferred || "").toUpperCase();
  const isMobilePayout = payoutPreferred === "MOBILE_MONEY";
  const disbursementMethodLabel = isMobilePayout ? "MOBILE MONEY" : "BANK";
  const disbursementMethodDetail = isMobilePayout
    ? [revenue.operator?.mobileMoneyProvider, revenue.operator?.mobileMoneyNumber].filter(Boolean).join(" • ")
    : [revenue.operator?.bankName, revenue.operator?.bankAccountNumber].filter(Boolean).join(" • ");
  const receiptReference = String(revenue.paymentRef || "").trim();

  const paidAt = revenue.disbursedAt || revenue.payoutPaidAt || revenue.updatedAt;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const receiptUrl = `${origin}/admin/agents/tour-revenue/${revenue.id}`;
  const disbursementReceiptPayload = [
    "NoLSAF Disbursement Receipt",
    `Tour Code: ${revenue.bookingCode}`,
    `Revenue ID: ${revenue.id}`,
    `Payout: ${money(revenue.netAmount, revenue.currency)}`,
    `Reference: ${revenue.paymentRef || "N/A"}`,
    `Paid At: ${new Date(paidAt).toISOString()}`,
    `Receipt URL: ${receiptUrl}`,
  ].join("\n");

  const actorLabel = (actor?: { id: number; name: string | null } | null) => {
    if (!actor) return null;
    return actor.name || `User #${actor.id}`;
  };

  const actionMeta: Record<RevenueAuditTrailItem["action"], { title: string; color: string; icon: any }> = {
    VERIFY: { title: "Verified", color: "border-blue-400 bg-blue-50", icon: CheckCircle2 },
    APPROVE: { title: "Approved", color: "border-emerald-400 bg-emerald-50", icon: ShieldCheck },
    DISBURSE: { title: "Disbursed", color: "border-purple-400 bg-purple-50", icon: CreditCard },
    REJECT: { title: "Rejected", color: "border-rose-400 bg-rose-50", icon: XCircle },
  };

  const historyItems: Array<{ key: string; title: string; at: string | null; color: string; icon: any; note?: string; by?: string | null; tourCode?: string | null }> = (() => {
    const base: Array<{ key: string; title: string; at: string | null; color: string; icon: any; note?: string; by?: string | null; tourCode?: string | null }> = [
      { key: "created", title: "Booking Created", at: revenue.createdAt, color: "border-gray-400 bg-gray-50", icon: FileText, tourCode: revenue.bookingCode },
      { key: "paid", title: "Payment Received", at: revenue.paymentStatus === "PAID" || revenue.paidAt ? (revenue.paidAt || null) : null, color: "border-teal-400 bg-teal-50", icon: CreditCard, tourCode: revenue.bookingCode },
      { key: "requested", title: "Payout Claimed", at: revenue.payoutRequestedAt, color: "border-amber-400 bg-amber-50", icon: Clock, by: revenue.operator.name, tourCode: revenue.bookingCode },
    ];

    const auditTrail = Array.isArray(revenue.auditTrail) ? revenue.auditTrail : [];
    if (auditTrail.length > 0) {
      const auditItems = auditTrail.map((row, idx) => {
        const meta = actionMeta[row.action];
        const notes: string[] = [];
        if (row.reason) notes.push(row.reason);
        if (row.paymentRef) notes.push(`Reference: ${row.paymentRef}`);
        return {
          key: `audit-${row.action}-${row.at}-${idx}`,
          title: meta.title,
          at: row.at,
          color: meta.color,
          icon: meta.icon,
          note: notes.join(" | ") || undefined,
          by: actorLabel(row.admin),
        };
      });
      return [...base, ...auditItems].filter((item) => !!item.at);
    }

    const fallback = [
      {
        key: "verified",
        title: "Verified",
        // Only an explicit admin verification counts — a PAID customer payment
        // must not fabricate a "Verified" step (payout stays NEW until claimed).
        at: revenue.verifiedAt || null,
        color: "border-blue-400 bg-blue-50",
        icon: CheckCircle2,
        note: revenue.verifiedReason || undefined,
        by: actorLabel(revenue.verifiedByUser),
      },
      {
        key: "approved",
        title: "Approved",
        at: revenue.approvedAt || revenue.payoutApprovedAt || (revenue.paymentStatus === "APPROVED" ? revenue.updatedAt : null),
        color: "border-emerald-400 bg-emerald-50",
        icon: ShieldCheck,
        note: revenue.approvedReason || undefined,
        by: actorLabel(revenue.approvedByUser),
      },
      {
        key: "disbursed",
        title: "Disbursed",
        at: revenue.disbursedAt || revenue.payoutPaidAt || (revenue.paymentStatus === "DISBURSED" ? revenue.updatedAt : null),
        color: "border-purple-400 bg-purple-50",
        icon: CreditCard,
        note: revenue.paymentRef ? `Reference: ${revenue.paymentRef}` : undefined,
      },
      {
        key: "rejected",
        title: "Rejected",
        at: revenue.paymentStatus === "REJECTED" ? revenue.updatedAt : null,
        color: "border-rose-400 bg-rose-50",
        icon: XCircle,
        note: revenue.rejectionReason || undefined,
      },
    ];
    return [...base, ...fallback].filter((item) => !!item.at);
  })();

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 min-w-0">
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <Link href="/admin/agents/tour-revenue" className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0" title="Back to tour revenue">
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-[#02665e]" />
                </div>
                <div className="min-w-0">
                  <h1 className={`text-xl sm:text-2xl font-bold truncate ${isDisbursed ? "text-[#02665e]" : "text-gray-900"}`}>
                    {revenue.bookingCode}
                  </h1>
                  {isDisbursed && receiptReference ? (
                    <div className="mt-0.5 text-sm font-semibold text-[#02665e] break-words">
                      Receipt: {receiptReference}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold bg-green-50 border-green-200 text-green-700">
                <StatusIcon className="h-4 w-4" />
                {status.label}
              </div>
              <div className="mt-2 text-xs sm:text-sm text-gray-600">
                Type: <span className="font-medium text-gray-800">Tour Revenue Record</span>
              </div>
              <div className="mt-1 text-xs sm:text-sm text-gray-600">
                Payment status: <span className="font-medium text-gray-800">{revenue.paymentStatus}</span> • Payout status: <span className="font-medium text-gray-800">{revenue.payoutStatus}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            title="Refresh"
            aria-label="Refresh revenue details"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Receipt className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Booking Information</h2>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Package</div>
                    <div className="font-semibold text-sm text-gray-900 truncate">{revenue.title}</div>
                    <div className="text-xs text-gray-500 truncate">{revenue.category || "—"}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Destination</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900 truncate">{revenue.destination || "—"}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Travelers</div>
                    <div className="font-semibold text-sm text-gray-900">{revenue.travelerCount}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Created</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900">{new Date(revenue.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-6 mt-0.5">{new Date(revenue.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Operator</div>
                    <div className="font-semibold text-sm text-gray-900">{revenue.operator.name}</div>
                    <div className="text-xs text-gray-600">{revenue.operator.email || "—"}</div>
                    <div className="text-xs text-gray-600">{revenue.operator.phone || "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Customer</div>
                    <div className="font-semibold text-sm text-gray-900">{revenue.customer.name}</div>
                    <div className="text-xs text-gray-600">{revenue.customer.email || "—"}</div>
                    <div className="text-xs text-gray-600">{revenue.customer.phone || "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Financial Details</h2>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
                    <span className="text-xs sm:text-sm font-medium text-gray-700 truncate pr-2">Gross Amount</span>
                    <span className="text-base sm:text-lg font-bold text-gray-900 flex-shrink-0">{money(revenue.grossAmount, revenue.currency)}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="p-3 sm:p-4 bg-blue-50 rounded-lg min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Commission</div>
                      <div className="text-xs sm:text-sm font-semibold text-blue-900">{Number(revenue.commissionPercent || 0)}%</div>
                      <div className="text-base sm:text-lg font-bold text-blue-900 mt-1 break-words">{money(revenue.commissionAmount, revenue.currency)}</div>
                    </div>

                    <div className="p-3 sm:p-4 bg-purple-50 rounded-lg min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Tax (on commission)</div>
                      <div className="text-xs sm:text-sm font-semibold text-purple-900">{Number(revenue.taxPercent || 0)}%</div>
                      <div className="text-base sm:text-lg font-bold text-purple-900 mt-1 break-words">{money(revenue.taxAmount, revenue.currency)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 sm:p-4 bg-emerald-50 rounded-lg border-2 border-emerald-200 min-w-0">
                    <span className="text-sm sm:text-base font-semibold text-emerald-900 truncate pr-2">Tour Payout</span>
                    <span className="text-xl sm:text-2xl font-bold text-emerald-900 flex-shrink-0 break-words">{money(revenue.netAmount, revenue.currency)}</span>
                  </div>

                  {(revenue.paymentRef || revenue.paidAt || isDisbursed) && (
                    <div className="space-y-3">
                      {isDisbursed ? (
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Disbursement Successful
                        </div>
                      ) : null}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="rounded-lg bg-gray-50 p-3 sm:p-4 min-w-0">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Disbursement Method</div>
                          <div className="flex items-center gap-2 min-w-0">
                            <CreditCard className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <span className="font-semibold text-lg text-gray-900 truncate">{disbursementMethodLabel}</span>
                          </div>
                          {disbursementMethodDetail ? (
                            <div className="mt-1 text-xs text-gray-600 break-words">{disbursementMethodDetail}</div>
                          ) : null}
                          {revenue.paymentRef && (
                            <div className="mt-3 min-w-0">
                              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Disbursement Reference</div>
                              <span className="font-semibold text-base text-gray-900 break-words">{revenue.paymentRef}</span>
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg bg-gray-50 p-3 sm:p-4 min-w-0">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Receipt QR</div>
                          {isDisbursed ? (
                            <div className="rounded-md bg-white border border-gray-200 p-2 inline-flex">
                              <QRCode value={disbursementReceiptPayload} size={180} />
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">QR receipt will appear after disbursement is completed.</div>
                          )}
                          <div className="mt-2 text-xs text-gray-500">
                            {new Date(revenue.updatedAt).toLocaleDateString()} at {new Date(revenue.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 sm:space-y-6 min-w-0">
          <div className={`rounded-xl border p-4 sm:p-5 overflow-hidden ${revenue.status === "REJECTED" ? "border-rose-200 bg-rose-50/80" : "border-emerald-200 bg-emerald-50/70"}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${revenue.status === "REJECTED" ? "bg-rose-100" : "bg-emerald-100"}`}>
                {revenue.status === "REJECTED" ? <AlertCircle className="h-5 w-5 text-rose-700" /> : <CheckCircle2 className="h-5 w-5 text-emerald-700" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900">Revenue workflow</h3>
                <p className="mt-1 text-sm font-medium text-gray-900">Current stage: {status.label}</p>
                <p className="mt-1 text-xs text-gray-700">
                  {revenue.status === "REJECTED"
                    ? (revenue.rejectionReason || "Rejected by admin")
                    : revenue.status === "DRAFT"
                      ? "Payment is not completed yet. This record will move to New automatically after successful payment."
                    : revenue.status === "NEW"
                      ? "Waiting for the operator to submit a payout claim before this invoice can be verified."
                      : "Claimed - proceed to verify, then approve and disburse to complete this tour revenue."}
                </p>
                {(() => {
                  const stageTs =
                    revenue.status === "DISBURSED" ? (revenue.disbursedAt || revenue.payoutPaidAt) :
                    revenue.status === "APPROVED"  ? (revenue.approvedAt || revenue.payoutApprovedAt) :
                    revenue.status === "VERIFIED"  ? revenue.verifiedAt :
                    revenue.status === "CLAIMED"   ? revenue.payoutRequestedAt :
                    revenue.status === "REJECTED"  ? revenue.updatedAt :
                    revenue.createdAt;
                  if (!stageTs) return null;
                  const d = new Date(stageTs);
                  return (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      <span>
                        {d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        {" · "}
                        {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-indigo-600" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900">Revenue Action</h3>
            </div>
            <div className="space-y-3 sm:space-y-4">
              <div className="min-w-0">
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Select Action</label>
                <select
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-all bg-white text-sm sm:text-base box-border"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as any)}
                  disabled={enabledActions.length === 0}
                >
                  <option value="">Select action</option>
                  {actionOptions.map((item) => (
                    <option key={item.value} value={item.value} disabled={!item.enabled}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              {revenue.status === "APPROVED" && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Ready to pay through AzamPay instead of a manual reference?{" "}
                  <Link
                    href={`/admin/disbursements?sourceType=TOUR_BOOKING&sourceId=${revenue.id}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    Send via AzamPay disbursement
                  </Link>
                  .
                </div>
              )}

              {actionType === "verify" && (
                <div className="min-w-0">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Verification Reason</label>
                  <textarea
                    className="w-full min-h-[90px] px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-all resize-none text-sm sm:text-base box-border"
                    placeholder="Write verification note"
                    value={verifyReason}
                    onChange={(e) => setVerifyReason(e.target.value)}
                  />
                </div>
              )}

              {actionType === "approve" && (
                <div className="min-w-0">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Approval Reason</label>
                  <textarea
                    className="w-full min-h-[90px] px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-all resize-none text-sm sm:text-base box-border"
                    placeholder="Explain why this revenue is approved"
                    value={approveReason}
                    onChange={(e) => setApproveReason(e.target.value)}
                  />
                </div>
              )}

              {actionType === "reject" && (
                <div className="min-w-0">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Rejection Reason</label>
                  <textarea
                    className="w-full min-h-[90px] px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-all resize-none text-sm sm:text-base box-border"
                    placeholder="Explain rejection reason"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </div>
              )}

              <button
                className="w-full px-4 py-2.5 sm:py-3 bg-[#02665e] text-white rounded-lg text-sm sm:text-base font-medium hover:bg-[#01544d] transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                onClick={() => void executeAction()}
                disabled={!canExecuteAction}
              >
                {actionLoading ? "Processing..." : "Execute Action"}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Clock className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Invoice History</h2>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">Audit trail of revenue status changes</p>
              </div>
            </div>
            <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1 sm:max-h-[34rem] sm:space-y-4 sm:pr-2 [scrollbar-width:thin]">
              {historyItems.map((item, idx) => {
                const Icon = item.icon;
                const isLast = idx === historyItems.length - 1;
                return (
                  <div key={item.key} className="relative pl-10">
                    {!isLast ? (
                      <span className="absolute left-[15px] top-8 bottom-[-14px] w-px bg-slate-300" aria-hidden />
                    ) : null}
                    <div className="absolute left-0 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white shadow-sm">
                      <Icon className="h-4 w-4 text-slate-600" />
                    </div>
                    <div className={`rounded-lg p-3 sm:p-4 ${item.color}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{item.title}</span>
                        {item.tourCode && (
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-slate-600 border border-slate-200">
                            {item.tourCode}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {item.at
                          ? `${new Date(item.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} at ${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                          : "-"}
                      </div>
                      {item.by ? <div className="text-xs font-medium text-gray-700 mt-1">By: <span className="font-semibold">{item.by}</span></div> : null}
                      {item.note ? <div className="text-xs text-gray-500 mt-1 break-words">{item.note}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
