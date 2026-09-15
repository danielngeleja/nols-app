"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPinned,
  Percent,
  Route,
  ShieldCheck,
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
  approvedAt: string | null;
  paidAt: string | null;
  driver: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    paymentPhone?: string | null;
    vehicleType?: string | null;
    plateNumber?: string | null;
    kycStatus?: string | null;
  } | null;
  approvedBy: { id: number; name: string | null; email: string | null } | null;
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

function routeValue(address?: string | null, coordinate?: string | null) {
  return address && address !== "N/A" ? address : coordinate || "N/A";
}

const payoutSteps = [
  {
    title: "Submitted",
    description: "Driver invoice request received.",
  },
  {
    title: "Verification",
    description: "Admin checks trip details and NoLSAF payout compliance.",
  },
  {
    title: "Approved for disbursement",
    description: "Finance can prepare the driver payout.",
  },
  {
    title: "Disbursed",
    description: "Driver payout has been completed.",
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

  const activeIndex = normalized === "APPROVED" || normalized === "PROCESSING" ? 2 : 1;
  if (stepIndex < activeIndex) return "complete";
  if (stepIndex === activeIndex) return "active";
  return "waiting";
}

function payoutLabels(status: string) {
  const normalized = status.toUpperCase();
  const isPaid = normalized === "PAID";
  const isApproved = normalized === "APPROVED" || normalized === "PROCESSING";

  return {
    amount: isPaid ? "Driver Paid" : isApproved ? "Ready to Disburse" : "Driver Payable",
    breakdownTitle: isPaid ? "Payout Breakdown" : "Calculated Payable",
    driverAmount: isPaid ? "Driver Paid" : isApproved ? "Amount to Disburse" : "Driver Payable",
    method: isPaid ? "Payment method" : "Requested method",
    reference: isPaid ? "Payment reference" : "Submitted reference",
  };
}

export default function AdminDriverInvoiceReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const id = params?.id;

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

  const approve = useCallback(async () => {
    if (!invoice || invoice.status !== "PENDING") return;
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

  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin/drivers/invoices" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            Back to invoices
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
          <p className="mt-1 text-sm text-gray-500">Review the submitted trip payout invoice, verify trip details, then approve for disbursement.</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <span className={`inline-flex justify-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClasses(invoice.status)}`}>
            {invoice.status === "APPROVED" ? "APPROVED - WAITING FOR DISBURSEMENT" : invoice.status}
          </span>
          {invoice.status === "PENDING" && (
            <button
              type="button"
              onClick={() => void approve()}
              disabled={approving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#02665e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#024d47] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Verify and approve
            </button>
          )}
        </div>
      </div>

      {approveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{approveError}</div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ShieldCheck className="h-4 w-4 text-[#02665e]" />
              Invoice and Disbursement Flow
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Track this driver request from verification to approved disbursement and final payout.
            </p>
          </div>
          {invoice.status === "PENDING" && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              Not paid yet
            </span>
          )}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          {payoutSteps.map((step, index) => {
            const state = workflowStepState(invoice.status, index);
            const isComplete = state === "complete";
            const isActive = state === "active";
            const isRejected = state === "rejected";

            return (
              <div
                key={step.title}
                className={`relative rounded-xl border p-4 ${
                  isRejected
                    ? "border-red-200 bg-red-50"
                    : isActive
                      ? "border-[#02665e]/30 bg-emerald-50"
                      : isComplete
                        ? "border-emerald-100 bg-white"
                        : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isRejected
                        ? "bg-red-600 text-white"
                        : isComplete
                          ? "bg-[#02665e] text-white"
                          : isActive
                            ? "bg-white text-[#02665e] ring-2 ring-[#02665e]"
                            : "bg-white text-gray-400 ring-1 ring-gray-200"
                    }`}
                  >
                    {isComplete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-bold ${isRejected ? "text-red-800" : isActive ? "text-[#02665e]" : "text-gray-900"}`}>
                      {step.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{step.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {invoice.status === "PENDING" && (
          <p className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This request is still under admin verification. Approval moves it to approved, waiting for disbursement.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{labels.amount}</p>
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
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 rounded-lg border border-gray-100 px-3 py-2">
              <dt className="text-gray-500">{labels.method}</dt>
              <dd className="text-right text-gray-900">{invoice.paymentMethod || invoice.trip?.paymentMethod || "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-4 rounded-lg border border-gray-100 px-3 py-2">
              <dt className="text-gray-500">{labels.reference}</dt>
              <dd className="text-right font-mono text-xs text-gray-900">{invoice.paymentRef || invoice.trip?.paymentRef || "N/A"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            Verification Signals
          </h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Customer Rating</p>
              <p className="mt-1 font-medium text-gray-900">{formatRating(invoice.trip?.customerRating)}</p>
              <p className="mt-1 text-xs text-gray-500">{invoice.trip?.customerReview || "No customer review provided."}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Driver Rating</p>
              <p className="mt-1 font-medium text-gray-900">{formatRating(invoice.trip?.driverRating)}</p>
              <p className="mt-1 text-xs text-gray-500">{invoice.trip?.driverReview || "No driver review provided."}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Approved At</p>
              <p className="mt-1 font-medium text-gray-900">{formatDateTime(invoice.approvedAt)}</p>
            </div>
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
