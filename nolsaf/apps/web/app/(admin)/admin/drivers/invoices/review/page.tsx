"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Barcode,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPinned,
  Percent,
  Route,
  ShieldCheck,
  Star,
  Zap,
  UserRound,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

type InvoiceDetail = {
  id: number;
  invoiceNumber: string;
  status: string;
  amount: number;
  currency: string;
  gross: number;
  commissionPercent: number;
  commissionAmount: number;
  paymentMethod: string | null;
  paymentRef: string | null;
  adminNotes: string | null;
  requestedAt: string | null;
  verifiedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  driver: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    paymentPhone?: string | null;
    payout?: {
      payoutPreferred?: string | null;
      bankAccountName?: string | null;
      bankName?: string | null;
      bankAccountNumber?: string | null;
      bankBranch?: string | null;
      mobileMoneyProvider?: string | null;
      mobileMoneyNumber?: string | null;
    } | null;
    vehicleType?: string | null;
    plateNumber?: string | null;
    kycStatus?: string | null;
  } | null;
  approvedBy: { id: number; name: string | null; email: string | null } | null;
  verifiedBy: { id: number; name: string | null; email: string | null } | null;
  paidBy: { id: number; name: string | null; email: string | null } | null;
  trip: {
    id: number;
    code: string;
    status: string;
    paymentStatus: string | null;
    paymentMethod: string | null;
    paymentRef: string | null;
    scheduledAt: string | null;
    pickupTime: string | null;
    dropoffTime: string | null;
    pickup: string;
    dropoff: string;
    pickupCoordinate?: string | null;
    dropoffCoordinate?: string | null;
    distanceKm?: number | null;
    durationMinutes?: number | null;
    tripType?: "SCHEDULED" | "AUTO_DISPATCHED" | string | null;
    vehicleType: string | null;
    passengerCount: number | null;
    amount: number;
    currency: string;
    notes: string | null;
    customerRating: number | null;
    customerReview: string | null;
    driverRating: number | null;
    driverReview: string | null;
    user: { id: number; name: string | null; email: string | null; phone: string | null } | null;
  } | null;
};

function badgeClasses(status: string) {
  switch (status) {
    case "PENDING":
      return "bg-gray-100 text-gray-700";
    case "VERIFIED":
      return "bg-teal-100 text-teal-700";
    case "APPROVED":
      return "bg-blue-100 text-blue-700";
    case "PAID":
      return "bg-emerald-100 text-emerald-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function payoutStatusLabel(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING":
      return "Requested";
    case "VERIFIED":
      return "Verified";
    case "APPROVED":
    case "PROCESSING":
      return "Approved";
    case "PAID":
      return "Disbursed";
    default:
      return "Requested";
  }
}

function formatMoney(value: number | null | undefined, currency = "TZS") {
  return `${Number(value ?? 0).toLocaleString()} ${currency || "TZS"}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatRating(value: number | null | undefined) {
  return value == null ? "Not rated" : `${value.toFixed(1)}/5`;
}

function formatTripDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "N/A";
  const total = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

function tripTypeLabel(value: string | null | undefined) {
  return String(value || "").toUpperCase() === "AUTO_DISPATCHED" ? "AUTO-DISPATCHED" : "SCHEDULED";
}

function tripTypeDescription(value: string | null | undefined) {
  return String(value || "").toUpperCase() === "AUTO_DISPATCHED"
    ? "System allocated by driver qualification"
    : "Assigned pickup from origin to destination";
}

function routeValue(address?: string | null, coordinate?: string | null) {
  return address && address !== "N/A" ? address : coordinate || "N/A";
}

function cleanLabel(value?: string | null) {
  return String(value || "")
    .replace(/_/g, " ")
    .trim();
}

function paymentClassification(invoice: InvoiceDetail) {
  const payout = invoice.driver?.payout;
  const submittedMethod = cleanLabel(invoice.paymentMethod || payout?.mobileMoneyProvider || payout?.bankName || invoice.trip?.paymentMethod) || "N/A";
  const preferred = cleanLabel(payout?.payoutPreferred).toUpperCase();
  const method = submittedMethod.toUpperCase();
  const isBank = preferred.includes("BANK") || Boolean(payout?.bankName || payout?.bankAccountNumber);
  const isMobile =
    preferred.includes("MOBILE") ||
    ["M-PESA", "MPESA", "AIRTEL", "TIGO", "HALOPESA", "MONEY"].some((token) => method.includes(token)) ||
    Boolean(payout?.mobileMoneyProvider || payout?.mobileMoneyNumber || invoice.driver?.paymentPhone);

  if (isBank) {
    return {
      type: "Bank Transfer",
      method: submittedMethod !== "N/A" ? submittedMethod : payout?.bankName || "Bank",
      destination: [payout?.bankName, payout?.bankAccountNumber].filter(Boolean).join(" / ") || "N/A",
      holder: payout?.bankAccountName || invoice.driver?.name || "N/A",
    };
  }

  if (isMobile) {
    return {
      type: "Mobile Money",
      method: submittedMethod !== "N/A" ? submittedMethod : payout?.mobileMoneyProvider || "Mobile money",
      destination: payout?.mobileMoneyNumber || invoice.driver?.paymentPhone || invoice.driver?.phone || "N/A",
      holder: invoice.driver?.name || "N/A",
    };
  }

  return {
    type: "Submitted Payout",
    method: submittedMethod,
    destination: invoice.driver?.paymentPhone || invoice.driver?.phone || "N/A",
    holder: invoice.driver?.name || "N/A",
  };
}

const payoutSteps = [
  {
    title: "Requested",
    color: "emerald",
  },
  {
    title: "Verified",
    color: "teal",
  },
  {
    title: "Approved",
    color: "sky",
  },
  {
    title: "Disbursed",
    color: "violet",
  },
];

function workflowStepState(status: string, stepIndex: number) {
  const normalized = status.toUpperCase();

  if (normalized === "PAID") return "complete";
  if (normalized === "REJECTED") {
    if (stepIndex === 0) return "complete";
    if (stepIndex === 1) return "rejected";
    return "waiting";
  }

  const activeIndex = normalized === "VERIFIED" || normalized === "APPROVED" || normalized === "PROCESSING" ? 2 : 1;
  if (stepIndex < activeIndex) return "complete";
  if (normalized === "APPROVED" || normalized === "PROCESSING") {
    if (stepIndex === 2) return "complete";
    if (stepIndex === 3) return "active";
  }
  if (stepIndex === activeIndex) return "active";
  return "waiting";
}

function payoutLabels(status: string) {
  const normalized = status.toUpperCase();
  const isPaid = normalized === "PAID";

  return {
    headerAmount: isPaid ? "Driver Paid" : "Driver Payable",
    breakdownTitle: isPaid ? "Payout Breakdown" : "Calculated Payable",
    driverAmount: isPaid ? "Driver Paid" : "Driver Payable",
    method: isPaid ? "Payment method" : "Requested method",
    reference: isPaid ? "Payment reference" : "Submitted reference",
  };
}

function workflowCardClasses(color: string, state: string, hasAction: boolean) {
  const active = state === "active" || hasAction;
  const complete = state === "complete";
  const rejected = state === "rejected";

  if (rejected) return "border-red-200 bg-red-50 text-red-900";
  if (color === "emerald") return complete || active ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-emerald-100 bg-white text-gray-900";
  if (color === "teal") return complete || active ? "border-teal-200 bg-teal-50 text-teal-950" : "border-teal-100 bg-white text-gray-900";
  if (color === "sky") return complete || active ? "border-sky-200 bg-sky-50 text-sky-950" : "border-sky-100 bg-white text-gray-900";
  return complete || active ? "border-violet-200 bg-violet-50 text-violet-950" : "border-violet-100 bg-white text-gray-900";
}

function workflowIconClasses(color: string, state: string, hasAction: boolean) {
  const active = state === "active" || hasAction;
  const complete = state === "complete";
  const rejected = state === "rejected";

  if (rejected) return "bg-red-600 text-white ring-red-600";
  if (color === "emerald") return complete ? "bg-emerald-700 text-white ring-emerald-700" : active ? "bg-white text-emerald-700 ring-emerald-700" : "bg-white text-emerald-400 ring-emerald-200";
  if (color === "teal") return complete ? "bg-teal-700 text-white ring-teal-700" : active ? "bg-white text-teal-700 ring-teal-700" : "bg-white text-teal-400 ring-teal-200";
  if (color === "sky") return complete ? "bg-sky-700 text-white ring-sky-700" : active ? "bg-white text-sky-700 ring-sky-700" : "bg-white text-sky-400 ring-sky-200";
  return complete ? "bg-violet-700 text-white ring-violet-700" : active ? "bg-white text-violet-700 ring-violet-700" : "bg-white text-violet-400 ring-violet-200";
}

function workflowLineClasses(color: string, filled: boolean) {
  if (!filled) return "bg-gray-200";
  if (color === "emerald") return "bg-emerald-500";
  if (color === "teal") return "bg-teal-500";
  if (color === "sky") return "bg-sky-500";
  return "bg-violet-500";
}

export default function AdminDriverInvoiceReviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"verify" | "approve" | null>(null);

  const id = searchParams.get("id") || "";

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ invoice: InvoiceDetail }>(`/api/admin/drivers/invoices/${id}`);
      setInvoice(response.data.invoice);
    } catch (err: any) {
      console.error("Failed to load driver payout invoice", err);
      setError(err?.response?.data?.error || "Unable to load this driver payout invoice.");
      setInvoice(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = useCallback(async () => {
    if (!invoice || invoice.status !== "PENDING") return;
    setVerifying(true);
    setApproveError(null);
    try {
      await api.post(`/api/admin/drivers/invoices/${invoice.id}/verify`, {
        adminNotes: "Verified by admin from driver payout invoice review.",
      });
      await load();
      router.refresh();
    } catch (err: any) {
      console.error("Failed to verify driver payout invoice", err);
      setApproveError(err?.response?.data?.error || "Unable to verify this invoice.");
    } finally {
      setVerifying(false);
    }
  }, [invoice, load, router]);

  const approve = useCallback(async () => {
    if (!invoice || invoice.status !== "VERIFIED") return;
    setApproving(true);
    setApproveError(null);
    try {
      await api.post(`/api/admin/drivers/invoices/${invoice.id}/approve`, {
        adminNotes: "Verified by admin from driver payout invoice review.",
      });
      await load();
      router.refresh();
    } catch (err: any) {
      console.error("Failed to approve driver payout invoice", err);
      setApproveError(err?.response?.data?.error || "Unable to approve this invoice.");
    } finally {
      setApproving(false);
    }
  }, [invoice, load, router]);

  const confirmAndRun = useCallback(async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "verify") {
      await verify();
    } else if (action === "approve") {
      await approve();
    }
  }, [approve, confirmAction, verify]);

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#02665e]" />
          <p className="mt-3 text-sm text-gray-500">Loading payout invoice...</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/admin/drivers/invoices" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error || "Driver payout invoice not found."}
        </div>
      </div>
    );
  }

  const labels = payoutLabels(invoice.status);
  const payment = paymentClassification(invoice);
  const barcodeValue = [
    invoice.invoiceNumber,
    invoice.trip?.code || `TRIP-${invoice.trip?.id || invoice.id}`,
    Math.round(Number(invoice.amount || 0)),
  ].join("-");
  const verifiedAt =
    invoice.verifiedAt ||
    (invoice.approvedAt && ["APPROVED", "PROCESSING", "PAID"].includes(invoice.status)
      ? invoice.approvedAt
      : null);
  const canVerify = invoice.status === "PENDING";
  const canApprove = invoice.status === "VERIFIED" && Boolean(verifiedAt);

  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-[#02665e] p-5 text-white shadow-xl sm:p-6 lg:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(110,231,183,0.14),transparent_38%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/admin/drivers/invoices"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-100 no-underline transition-colors hover:bg-white/15 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to invoices
            </Link>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{invoice.invoiceNumber}</h1>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-100">
                {payoutStatusLabel(invoice.status)}
              </span>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200 sm:text-base">
              Review submitted trip payout details, confirm route and payout compliance, then approve the invoice for disbursement.
            </p>
          </div>

          <div className="w-full rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm lg:w-auto lg:min-w-[280px]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">{labels.headerAmount}</p>
                <p className="mt-1 text-2xl font-black text-white">{formatMoney(invoice.amount, invoice.currency)}</p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeClasses(invoice.status)}`}>
                {payoutStatusLabel(invoice.status)}
              </span>
            </div>
            {canVerify && (
              <button
                type="button"
                onClick={() => setConfirmAction("verify")}
                disabled={verifying}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#02665e] shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Verify invoice
              </button>
            )}
            {canApprove && (
              <button
                type="button"
                onClick={() => setConfirmAction("approve")}
                disabled={approving}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#02665e] shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve for disbursement
              </button>
            )}
          </div>
        </div>
      </div>

      {approveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{approveError}</div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-[#02665e] ring-1 ring-teal-100">
                {confirmAction === "verify" ? <ShieldCheck className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </span>
              <div>
                <h2 className="text-base font-black text-gray-900">
                  {confirmAction === "verify" ? "Verify this invoice?" : "Approve this invoice?"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {confirmAction === "verify"
                    ? "Are you sure you want to verify this invoice? The verification timestamp will be recorded."
                    : "Are you sure you want to approve this invoice for disbursement? The approval timestamp will be recorded."}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmAndRun()}
                disabled={verifying || approving}
                className="inline-flex items-center gap-2 rounded-lg bg-[#02665e] px-4 py-2 text-sm font-bold text-white hover:bg-[#024d47] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying || approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {confirmAction === "verify" ? "Yes, verify" : "Yes, approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="relative grid grid-cols-1 gap-4 md:grid-cols-4">
          {payoutSteps.map((step, index) => {
            const state = workflowStepState(invoice.status, index);
            const isComplete = state === "complete";
            const timestamp =
              index === 0
                ? invoice.requestedAt
                : index === 1
                  ? verifiedAt
                  : index === 2
                    ? invoice.approvedAt
                    : invoice.paidAt;
            const action =
              index === 1 && canVerify
                ? { label: "Verify", loading: verifying, type: "verify" as const }
                : index === 2 && canApprove
                  ? { label: "Approve", loading: approving, type: "approve" as const }
                  : null;
            const cardContent = (
              <>
                {index < payoutSteps.length - 1 && (
                  <span
                    className={`pointer-events-none absolute left-[calc(100%-0.25rem)] top-9 z-0 hidden h-1 w-[calc(1rem+100%)] md:block ${workflowLineClasses(
                      step.color,
                      isComplete,
                    )}`}
                  />
                )}
                <div className="relative z-10 flex items-start gap-4">
                  <span
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ring-2 ${workflowIconClasses(
                      step.color,
                      state,
                      Boolean(action),
                    )}`}
                  >
                    {isComplete ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-black">{step.title}</p>
                    <p className="mt-3 min-h-[2.5rem] text-sm font-semibold leading-5 text-gray-700">
                      {timestamp ? formatDateTime(timestamp) : "Waiting"}
                    </p>
                    {action?.loading && <Loader2 className="mt-2 h-4 w-4 animate-spin text-current" />}
                  </div>
                </div>
              </>
            );

            if (action) {
              return (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setConfirmAction(action.type)}
                  disabled={action.loading}
                  className={`relative overflow-visible rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70 ${workflowCardClasses(
                    step.color,
                    state,
                    true,
                  )}`}
                >
                  {cardContent}
                </button>
              );
            }

            return (
              <div
                key={step.title}
                className={`relative overflow-visible rounded-xl border p-4 shadow-sm ${workflowCardClasses(step.color, state, false)}`}
              >
                {cardContent}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{labels.headerAmount}</p>
          <p className="mt-2 text-xl font-bold text-emerald-700">{formatMoney(invoice.amount, invoice.currency)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Trip Rate</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{formatMoney(invoice.gross, invoice.currency)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">NoLSAF %</p>
          <p className="mt-2 inline-flex items-center gap-2 text-xl font-bold text-gray-900">
            <Percent className="h-5 w-5 text-gray-400" />
            {Number(invoice.commissionPercent ?? 0).toLocaleString()}%
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Requested At</p>
          <p className="mt-2 text-sm font-semibold text-gray-900">{formatDateTime(invoice.requestedAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Route className="h-4 w-4 text-sky-600" />
            Trip Details
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Trip ID</dt>
              <dd className="text-right font-medium text-gray-900">{invoice.trip?.code || `TRIP-${invoice.trip?.id || invoice.id}`}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Status</dt>
              <dd className="text-right text-gray-900">{invoice.trip?.status || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Payment</dt>
              <dd className="text-right text-gray-900">{invoice.trip?.paymentStatus || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Vehicle</dt>
              <dd className="text-right text-gray-900">{invoice.trip?.vehicleType || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Scheduled</dt>
              <dd className="text-right text-gray-900">{formatDateTime(invoice.trip?.scheduledAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <UserRound className="h-4 w-4 text-emerald-600" />
            Driver and Customer
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Driver</dt>
              <dd className="text-right font-medium text-gray-900">{invoice.driver?.name || "Unassigned"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Driver Contact</dt>
              <dd className="text-right text-gray-900">{invoice.driver?.phone || invoice.driver?.email || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">KYC</dt>
              <dd className="text-right text-gray-900">{invoice.driver?.kycStatus || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Customer</dt>
              <dd className="text-right text-gray-900">{invoice.trip?.user?.name || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Customer Contact</dt>
              <dd className="text-right text-gray-900">{invoice.trip?.user?.phone || invoice.trip?.user?.email || "N/A"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <MapPinned className="h-4 w-4 text-sky-600" />
          Route
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Pickup</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{routeValue(invoice.trip?.pickup, invoice.trip?.pickupCoordinate)}</p>
            {invoice.trip?.pickupCoordinate && invoice.trip?.pickup && invoice.trip.pickup !== "N/A" && (
              <p className="mt-1 text-xs text-gray-500">{invoice.trip.pickupCoordinate}</p>
            )}
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Dropoff</p>
            <p className="mt-2 text-sm font-medium text-gray-900">{routeValue(invoice.trip?.dropoff, invoice.trip?.dropoffCoordinate)}</p>
            {invoice.trip?.dropoffCoordinate && invoice.trip?.dropoff && invoice.trip.dropoff !== "N/A" && (
              <p className="mt-1 text-xs text-gray-500">{invoice.trip.dropoffCoordinate}</p>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-700">
              {tripTypeLabel(invoice.trip?.tripType) === "AUTO-DISPATCHED" ? <Zap className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
              Trip Type
            </div>
            <p className="mt-2 text-sm font-black text-gray-900">{tripTypeLabel(invoice.trip?.tripType)}</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">{tripTypeDescription(invoice.trip?.tripType)}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <MapPinned className="h-4 w-4" />
              Distance
            </div>
            <p className="mt-2 text-sm font-black text-gray-900">
              {invoice.trip?.distanceKm != null ? `${Number(invoice.trip.distanceKm).toLocaleString()} KM` : "N/A"}
            </p>
          </div>
          <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-700">
              <Clock className="h-4 w-4" />
              Trip Time
            </div>
            <p className="mt-2 text-sm font-black text-gray-900">{formatTripDuration(invoice.trip?.durationMinutes)}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <CreditCard className="h-4 w-4 text-violet-600" />
            {labels.breakdownTitle}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Trip Rate</p>
              <p className="mt-2 text-sm font-bold text-gray-900">{formatMoney(invoice.gross, invoice.currency)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">NoLSAF Commission</p>
              <p className="mt-2 text-sm font-bold text-amber-700">-{formatMoney(invoice.commissionAmount, invoice.currency)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">{labels.driverAmount}</p>
              <p className="mt-2 text-sm font-bold text-emerald-700">{formatMoney(invoice.amount, invoice.currency)}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px]">
            <div className="rounded-xl border border-teal-100 bg-teal-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Payout Classification</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-teal-700">Payment type</p>
                  <p className="mt-1 text-sm font-bold text-gray-900">{payment.type}</p>
                </div>
                <div>
                  <p className="text-xs text-teal-700">Submitted method</p>
                  <p className="mt-1 text-sm font-bold text-gray-900">{payment.method}</p>
                </div>
                <div>
                  <p className="text-xs text-teal-700">Payout destination</p>
                  <p className="mt-1 break-words text-sm font-bold text-gray-900">{payment.destination}</p>
                </div>
                <div>
                  <p className="text-xs text-teal-700">Account holder</p>
                  <p className="mt-1 text-sm font-bold text-gray-900">{payment.holder}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Barcode className="h-4 w-4 text-gray-500" />
                Verification Code
              </div>
              <div
                aria-label={`Verification barcode ${barcodeValue}`}
                className="mt-4 h-16 rounded bg-white"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg,#111827 0 2px,transparent 2px 4px,#111827 4px 5px,transparent 5px 8px,#111827 8px 11px,transparent 11px 14px)",
                }}
              />
              <p className="mt-3 break-all font-mono text-xs font-semibold text-gray-900">{barcodeValue}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            Ratings
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3">
            {[
              { label: "Customer", value: invoice.trip?.customerRating, color: "amber" },
              { label: "Driver", value: invoice.trip?.driverRating, color: "teal" },
            ].map((rating) => {
              const value = rating.value == null ? null : Number(rating.value);
              const filled = Math.max(0, Math.min(5, Math.round(value ?? 0)));
              const isAmber = rating.color === "amber";
              return (
                <div
                  key={rating.label}
                  className={`rounded-xl border p-4 ${
                    isAmber ? "border-amber-100 bg-amber-50/70" : "border-teal-100 bg-teal-50/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-xs font-semibold uppercase tracking-wider ${isAmber ? "text-amber-700" : "text-teal-700"}`}>
                      {rating.label}
                    </p>
                    <p className="text-xl font-black text-gray-900">{formatRating(value)}</p>
                  </div>
                  <div className="mt-3 flex gap-1">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star
                        key={index}
                        className={`h-5 w-5 ${
                          index < filled
                            ? isAmber
                              ? "fill-amber-500 text-amber-500"
                              : "fill-teal-500 text-teal-500"
                            : "fill-white text-gray-300"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Clock className="h-4 w-4 text-gray-500" />
          Submitted Notes
        </h2>
        <p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-700">
          {invoice.adminNotes || invoice.trip?.notes || "No notes were submitted for this payout invoice."}
        </p>
      </section>
    </div>
  );
}
