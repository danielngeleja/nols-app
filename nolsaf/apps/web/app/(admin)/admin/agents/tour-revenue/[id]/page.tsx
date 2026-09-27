"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  MapPin,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import QRCode from "@/components/QRCode";
import TourAdvancePanel, { type TourAdvanceRow } from "@/components/admin/TourAdvancePanel";

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
  advancePaid?: number;
  advanceInFlight?: number;
  balanceAmount?: number;
  advances?: TourAdvanceRow[];
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
      <div className="space-y-4 min-w-0 animate-pulse">
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
      <div className="min-w-0">
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

  // ── Payout pipeline: Paid, Claimed, Verified, Approved, Disbursed ──
  const STAGE_ORDER: Record<RevenueStatus, number> = { DRAFT: 0, NEW: 1, CLAIMED: 2, VERIFIED: 3, APPROVED: 4, DISBURSED: 5, REJECTED: -1 };
  const order = STAGE_ORDER[revenue.status];
  const isRejected = revenue.status === "REJECTED";
  const longDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const pipeline = [
    { key: "paid", label: "Paid", at: revenue.paidAt },
    { key: "claimed", label: "Claimed", at: revenue.payoutRequestedAt },
    { key: "verified", label: "Verified", at: revenue.verifiedAt },
    { key: "approved", label: "Approved", at: revenue.approvedAt || revenue.payoutApprovedAt },
    { key: "disbursed", label: "Disbursed", at: revenue.disbursedAt || revenue.payoutPaidAt },
  ].map((stage, i) => {
    const done = isRejected ? Boolean(stage.at) : order >= i + 1;
    const current = !isRejected && order === i;
    return { ...stage, done, current };
  });
  let leadingDone = 0;
  while (leadingDone < pipeline.length && pipeline[leadingDone].done) leadingDone += 1;

  const openAction = (value: RevenueAction) => {
    setActionType(value);
    window.setTimeout(() => document.getElementById("revenue-actions")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const nextStep: { tone: "slate" | "amber" | "teal" | "green" | "red"; title: string; text: string; cta?: { label: string; run?: () => void; href?: string } } =
    revenue.status === "DRAFT"
      ? { tone: "slate", title: "Waiting for payment", text: "The traveller hasn't paid yet. This record moves to New on its own once they do." }
      : revenue.status === "NEW"
        ? { tone: "slate", title: "Waiting for the operator's claim", text: "The operator must claim the payout before you can verify it." }
        : revenue.status === "CLAIMED"
          ? { tone: "amber", title: "Verify this invoice", text: "Check the booking and the amounts, then verify.", cta: { label: "Verify now", run: () => openAction("verify") } }
          : revenue.status === "VERIFIED"
            ? { tone: "amber", title: "Approve the payout", text: "Verified and waiting for your approval.", cta: { label: "Approve now", run: () => openAction("approve") } }
            : revenue.status === "APPROVED"
              ? { tone: "teal", title: "Send the payout", text: "Approved. Pay the operator through the AzamPay disbursement queue.", cta: { label: "Send via AzamPay", href: `/admin/disbursements?sourceType=TOUR_BOOKING&sourceId=${revenue.id}` } }
              : revenue.status === "DISBURSED"
                ? { tone: "green", title: "Paid out", text: receiptReference ? `Reference ${receiptReference}.` : "The operator has been paid." }
                : { tone: "red", title: "Rejected", text: revenue.rejectionReason || "Rejected by an admin." };
  const NEXT_TONES = {
    slate: { box: "border-neutral-200 bg-neutral-50", eyebrow: "text-neutral-500", title: "text-neutral-900", text: "text-neutral-600", button: "border-neutral-300 text-neutral-800 hover:bg-white" },
    amber: { box: "border-amber-200 bg-amber-50", eyebrow: "text-amber-700", title: "text-amber-950", text: "text-amber-800", button: "border-amber-300 text-amber-900 hover:bg-amber-100" },
    teal: { box: "border-emerald-200 bg-emerald-50", eyebrow: "text-emerald-700", title: "text-emerald-950", text: "text-emerald-800", button: "border-emerald-300 text-emerald-900 hover:bg-emerald-100" },
    green: { box: "border-emerald-200 bg-emerald-50", eyebrow: "text-emerald-700", title: "text-emerald-950", text: "text-emerald-800", button: "border-emerald-300 text-emerald-900 hover:bg-emerald-100" },
    red: { box: "border-red-200 bg-red-50", eyebrow: "text-red-700", title: "text-red-950", text: "text-red-800", button: "border-red-300 text-red-900 hover:bg-red-100" },
  } as const;
  const nextTone = NEXT_TONES[nextStep.tone];

  const gross = Number(revenue.grossAmount || 0);
  const payoutShare = gross > 0 ? Math.min(100, Math.round((Number(revenue.netAmount || 0) / gross) * 100)) : 0;
  const commissionShare = gross > 0 ? Math.min(100 - payoutShare, Math.round((Number(revenue.commissionAmount || 0) / gross) * 100)) : 0;
  const CARD = "min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]";
  const reasonValue = actionType === "verify" ? verifyReason : actionType === "approve" ? approveReason : rejectionReason;
  const setReasonValue = (v: string) => (actionType === "verify" ? setVerifyReason(v) : actionType === "approve" ? setApproveReason(v) : setRejectionReason(v));
  const ACTION_COPY: Record<RevenueAction, { label: string; prompt: string; placeholder: string }> = {
    verify: { label: "Verify", prompt: "Verification note", placeholder: "What you checked before verifying" },
    approve: { label: "Approve", prompt: "Approval note", placeholder: "Why this payout is approved" },
    reject: { label: "Reject", prompt: "Reason for rejecting", placeholder: "Tell the operator what is wrong" },
  };

  return (
    <div id="tour-revenue-detail" className="space-y-4 min-w-0 w-full">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#tour-revenue-detail, #tour-revenue-detail * { box-sizing: border-box; }`}</style>

      {/* Hero: which booking, whose money, and what to do next */}
      <section className={CARD}>
        <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <Link href="/admin/agents/tour-revenue" className="inline-flex items-center gap-1 text-[11px] font-bold text-neutral-400 no-underline transition hover:text-emerald-700">
                <ArrowLeft className="h-3 w-3" aria-hidden /> Tour revenue
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                title="Refresh"
                aria-label="Refresh revenue details"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800 lg:hidden"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="m-0 break-all font-mono text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">{revenue.bookingCode}</h1>
              <span className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-[11px] font-bold ${status.bgColor} ${status.color}`}>
                <StatusIcon className="h-3.5 w-3.5" aria-hidden /> {status.label}
              </span>
            </div>
            <p className="m-0 mt-1 break-words text-sm font-semibold text-neutral-700">{revenue.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-500">
              {revenue.destination ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {revenue.destination}</span> : null}
              <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5 shrink-0" aria-hidden /> {revenue.travelerCount} {revenue.travelerCount === 1 ? "traveller" : "travellers"}</span>
              {revenue.startDate ? (
                <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden /> {longDate(revenue.startDate)}{revenue.endDate ? ` to ${longDate(revenue.endDate)}` : ""}</span>
              ) : null}
              <span className="text-neutral-400">Created {longDate(revenue.createdAt)}</span>
            </div>
          </div>

          <div className={`min-w-0 rounded-xl border border-solid p-3.5 ${nextTone.box}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={`m-0 text-[10px] font-bold uppercase tracking-[0.12em] ${nextTone.eyebrow}`}>{nextStep.tone === "green" || nextStep.tone === "red" ? "Outcome" : "Next step"}</p>
              <button
                type="button"
                onClick={() => void load()}
                title="Refresh"
                aria-label="Refresh revenue details"
                className="-mr-1 -mt-1 hidden h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition hover:bg-white/70 hover:text-neutral-700 lg:inline-flex"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <p className={`m-0 mt-1 text-[14px] font-bold leading-snug ${nextTone.title}`}>{nextStep.title}</p>
            <p className={`m-0 mt-0.5 break-words text-[12px] leading-snug ${nextTone.text}`}>{nextStep.text}</p>
            {nextStep.cta?.href ? (
              <Link href={nextStep.cta.href} className={`mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-solid bg-white px-3 py-1.5 text-[12px] font-bold no-underline transition ${nextTone.button}`}>
                {nextStep.cta.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : nextStep.cta?.run ? (
              <button type="button" onClick={nextStep.cta.run} className={`mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid bg-white px-3 py-1.5 text-[12px] font-bold transition ${nextTone.button}`}>
                {nextStep.cta.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        {/* Payout pipeline */}
        <ol className="relative m-0 grid list-none grid-cols-5 border-0 border-t border-solid border-neutral-100 px-1 py-4 sm:px-5">
          <span className="absolute left-[10%] right-[10%] top-[30px] h-0.5 rounded-full bg-neutral-200" aria-hidden />
          <span
            className={`absolute left-[10%] top-[30px] h-0.5 rounded-full transition-all duration-500 ${isRejected ? "bg-red-400" : "bg-emerald-600"}`}
            style={{ width: `${(Math.max(0, leadingDone - 1) / (pipeline.length - 1)) * 80}%` }}
            aria-hidden
          />
          {pipeline.map((stage) => (
            <li key={stage.key} className="relative flex min-w-0 flex-col items-center px-0.5 text-center">
              <span
                className={[
                  "inline-flex h-7 w-7 items-center justify-center rounded-full",
                  stage.done ? "bg-emerald-600 text-white" : stage.current ? "border-2 border-solid border-amber-400 bg-amber-50 text-amber-700" : "border-2 border-solid border-neutral-200 bg-white text-neutral-300",
                ].join(" ")}
              >
                {stage.done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : stage.current ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />}
              </span>
              <span className="mt-1.5 text-[12px] font-bold text-neutral-800">{stage.label}</span>
              <span className={`text-[11px] leading-tight ${stage.current ? "text-amber-700" : "text-neutral-400"}`}>
                {stage.at ? longDate(stage.at) : stage.current ? "Waiting" : ""}
              </span>
            </li>
          ))}
        </ol>
        {isRejected ? (
          <div className="flex items-start gap-2 border-0 border-t border-solid border-red-100 bg-red-50 px-4 py-3 text-[12.5px] text-red-800 sm:px-5">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span><span className="font-bold">Rejected.</span> {revenue.rejectionReason || "No reason was recorded."}</span>
          </div>
        ) : null}
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* Money */}
          <section className={CARD}>
            <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Money</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">What the traveller paid and how it splits</p>
            </div>
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="m-0 text-[11px] font-semibold text-neutral-500">Paid by the traveller</p>
                  <p className="m-0 mt-0.5 text-2xl font-black tabular-nums tracking-tight text-neutral-950">{money(revenue.grossAmount, revenue.currency)}</p>
                </div>
                <div className="text-right">
                  <p className="m-0 text-[11px] font-semibold text-neutral-500">Operator payout</p>
                  <p className="m-0 mt-0.5 text-2xl font-black tabular-nums tracking-tight text-emerald-700">{money(revenue.netAmount, revenue.currency)}</p>
                </div>
              </div>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                <span className="bg-emerald-600" style={{ width: `${payoutShare}%` }} />
                <span className="bg-violet-500" style={{ width: `${commissionShare}%` }} />
              </div>
              <dl className="m-0 mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-neutral-50/80 px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden /> Operator</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black tabular-nums text-neutral-900">{money(revenue.netAmount, revenue.currency)}</dd>
                  <dd className="m-0 text-[11px] text-neutral-400">{payoutShare}% of what was paid</dd>
                </div>
                <div className="rounded-xl bg-neutral-50/80 px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden /> NoLSAF commission</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black tabular-nums text-neutral-900">{money(revenue.commissionAmount, revenue.currency)}</dd>
                  <dd className="m-0 text-[11px] text-neutral-400">{Number(revenue.commissionPercent || 0)}% rate</dd>
                </div>
                <div className="rounded-xl bg-neutral-50/80 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold text-neutral-500">Tax on commission</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black tabular-nums text-neutral-900">{money(revenue.taxAmount, revenue.currency)}</dd>
                  <dd className="m-0 text-[11px] text-neutral-400">{Number(revenue.taxPercent || 0)}% rate</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* People */}
          <section className={CARD}>
            <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
              <h2 className="m-0 text-sm font-bold text-neutral-900">People</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Who ran the tour, who paid, and where the payout goes</p>
            </div>
            <div className="grid min-w-0 gap-px bg-neutral-100 sm:grid-cols-2">
              {[
                { role: "Operator", name: revenue.operator.name, email: revenue.operator.email, phone: revenue.operator.phone, extra: disbursementMethodDetail ? `Paid by ${disbursementMethodLabel.toLowerCase()} · ${disbursementMethodDetail}` : `Paid by ${disbursementMethodLabel.toLowerCase()}` },
                { role: "Traveller", name: revenue.customer.name, email: revenue.customer.email, phone: revenue.customer.phone, extra: "" },
              ].map((person) => (
                <div key={person.role} className="min-w-0 bg-white px-4 py-3.5 sm:px-5">
                  <p className="m-0 text-[11px] font-semibold text-neutral-500">{person.role}</p>
                  <p className="m-0 mt-0.5 break-words text-[14px] font-bold text-neutral-900">{person.name || "Not recorded"}</p>
                  {person.email ? <a href={`mailto:${person.email}`} className="mt-1 block truncate text-[12px] text-emerald-700 no-underline hover:underline">{person.email}</a> : null}
                  {person.phone ? <a href={`tel:${person.phone}`} className="block text-[12px] text-neutral-600 no-underline hover:text-emerald-700">{person.phone}</a> : null}
                  {person.extra ? <p className="m-0 mt-2 break-words rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11.5px] text-neutral-600">{person.extra}</p> : null}
                </div>
              ))}
            </div>
          </section>

          {/* Disbursement proof */}
          {isDisbursed ? (
            <section className={CARD}>
              <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Disbursement receipt</h2>
                <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Scan to confirm this payout</p>
              </div>
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="inline-flex self-start rounded-xl border border-solid border-neutral-200 bg-white p-2">
                  <QRCode value={disbursementReceiptPayload} size={150} />
                </div>
                <dl className="m-0 min-w-0 space-y-2 text-[13px]">
                  <div><dt className="text-[11px] font-semibold text-neutral-500">Paid out</dt><dd className="m-0 font-black text-emerald-700">{money(revenue.netAmount, revenue.currency)}</dd></div>
                  <div><dt className="text-[11px] font-semibold text-neutral-500">Method</dt><dd className="m-0 break-words font-semibold text-neutral-900">{disbursementMethodLabel}{disbursementMethodDetail ? ` · ${disbursementMethodDetail}` : ""}</dd></div>
                  <div><dt className="text-[11px] font-semibold text-neutral-500">Reference</dt><dd className="m-0 break-all font-mono font-semibold text-neutral-900">{receiptReference || "Not recorded"}</dd></div>
                  <div><dt className="text-[11px] font-semibold text-neutral-500">Date</dt><dd className="m-0 font-semibold text-neutral-900">{longDate(paidAt)}</dd></div>
                </dl>
              </div>
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {/* Actions: only what is allowed at this stage */}
          <section id="revenue-actions" className={CARD}>
            <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Actions</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Every action needs a note and is kept in the history</p>
            </div>
            <div className="space-y-2.5 p-4 sm:p-5">
              {enabledActions.length === 0 ? (
                <p className="m-0 rounded-xl bg-neutral-50 px-3 py-2.5 text-[12.5px] text-neutral-600">
                  {revenue.status === "APPROVED"
                    ? "Approved. The payout is sent from the disbursement queue."
                    : revenue.status === "DISBURSED"
                      ? "Paid out. Nothing left to do."
                      : revenue.status === "REJECTED"
                        ? "Rejected. No further actions."
                        : "Nothing to do until the operator claims the payout."}
                </p>
              ) : !actionType ? (
                enabledActions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setActionType(item.value)}
                    className={
                      item.value === "reject"
                        ? "flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-solid border-red-200 bg-white px-3.5 py-2 text-[13px] font-bold text-red-700 transition hover:bg-red-50"
                        : "flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-3.5 py-2 text-[13px] font-bold text-white transition hover:bg-[#014d47]"
                    }
                  >
                    {item.value === "reject" ? <XCircle className="h-4 w-4" aria-hidden /> : item.value === "approve" ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                    {ACTION_COPY[item.value].label}
                  </button>
                ))
              ) : (
                <div className={`space-y-2.5 rounded-xl border border-solid p-3 ${actionType === "reject" ? "border-red-200 bg-red-50/60" : "border-emerald-200 bg-emerald-50/50"}`}>
                  <label htmlFor="revenue-action-note" className="block text-[12.5px] font-bold text-neutral-800">
                    {ACTION_COPY[actionType].prompt} <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="revenue-action-note"
                    value={reasonValue}
                    onChange={(e) => setReasonValue(e.target.value)}
                    placeholder={ACTION_COPY[actionType].placeholder}
                    className="block min-h-[96px] w-full resize-y rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setActionType("")}
                      disabled={actionLoading}
                      className="inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[12.5px] font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void executeAction()}
                      disabled={!canExecuteAction}
                      suppressHydrationWarning
                      className={`inline-flex min-h-9 flex-[2] cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 px-3 text-[12.5px] font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${actionType === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-[#02665e] hover:bg-[#014d47]"}`}
                    >
                      {actionLoading ? "Working…" : `Confirm ${ACTION_COPY[actionType].label.toLowerCase()}`}
                    </button>
                  </div>
                </div>
              )}

              {revenue.status === "APPROVED" ? (
                <Link
                  href={`/admin/disbursements?sourceType=TOUR_BOOKING&sourceId=${revenue.id}`}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-3.5 py-2 text-[13px] font-bold text-white no-underline transition hover:bg-[#014d47]"
                >
                  <CreditCard className="h-4 w-4" aria-hidden /> Send via AzamPay
                </Link>
              ) : null}
            </div>
          </section>

          <TourAdvancePanel
            currency={revenue.currency}
            operatorNet={revenue.operatorPayoutAmount}
            advancePaid={revenue.advancePaid ?? 0}
            balanceAmount={revenue.balanceAmount ?? revenue.operatorPayoutAmount}
            advances={revenue.advances ?? []}
            onChanged={() => void load()}
          />

          {/* History */}
          <section className={CARD}>
            <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
              <h2 className="m-0 text-sm font-bold text-neutral-900">History</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Every change to this revenue record</p>
            </div>
            <ol className="m-0 max-h-[30rem] list-none overflow-y-auto p-4 [scrollbar-width:thin] sm:p-5">
              {historyItems.map((item, idx) => {
                const Icon = item.icon;
                const isLast = idx === historyItems.length - 1;
                return (
                  <li key={item.key} className="relative pb-4 pl-8 last:pb-0">
                    {!isLast ? <span className="absolute bottom-0 left-[11px] top-7 w-px bg-neutral-200" aria-hidden /> : null}
                    <span className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-1 ring-neutral-200">
                      <Icon className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                    </span>
                    <p className="m-0 text-[13px] font-bold text-neutral-900">{item.title}</p>
                    <p className="m-0 mt-0.5 text-[11px] text-neutral-400">
                      {item.at ? `${longDate(item.at)}, ${new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                      {item.by ? ` · ${item.by}` : ""}
                    </p>
                    {item.note ? <p className="m-0 mt-1 break-words rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11.5px] text-neutral-600">{item.note}</p> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
