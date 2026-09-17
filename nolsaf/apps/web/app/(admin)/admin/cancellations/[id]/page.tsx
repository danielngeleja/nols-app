"use client";

// Cancellation case file. One screen that answers, in order: what is being claimed,
// is it safe to refund, and what happens next. The workflow rules are unchanged:
// the API still gates approvals on a confirmed payment, and every status change
// messages the customer.

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Ban, Calendar, CheckCircle2, ChevronDown, ChevronRight, Clock,
  CreditCard, FileText, Loader2, Lock, Mail, MapPin, MessageSquare, Phone, RefreshCw,
  Save, Search, Send, Shield, ShieldCheck, User, XCircle,
} from "lucide-react";

const api = apiClient;

type Msg = { id: number; senderId: number; senderRole: string; body: string; createdAt: string };
type PaymentEvent = { id: number; eventId: string; provider: string; amount: number; currency: string; status: string; createdAt: string };
type PaymentInfo = {
  invoice: { id: number; invoiceNumber: string | null; receiptNumber: string | null; total: number; status: string; paymentMethod: string | null; paymentRef: string | null; createdAt: string };
  paymentEvents: PaymentEvent[];
  hasTransactionId: boolean;
  paymentConfirmed: boolean;
} | null;
type Item = {
  id: number;
  status: string;
  bookingCode: string;
  reason: string | null;
  decisionNote: string | null;
  policyEligible: boolean;
  policyRefundPercent: number | null;
  policyRule: string | null;
  approvedAt: string | null;
  approvedByAdminId: number | null;
  refundAmount: number | null;
  refundProvider: string | null;
  refundReference: string | null;
  refundChargesJson?: { exempt?: boolean; cardSurcharge?: number; bankCharges?: number; adminCharge?: number; totalCharges?: number; netRefundAmount?: number } | null;
  refundInitiatedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: number; name: string | null; email: string | null; phone: string | null };
  booking: {
    id: number;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    status: string;
    guestName: string | null;
    guestPhone: string | null;
    createdAt: string;
    property: { id: number; title: string; regionName?: string | null; city?: string | null; district?: string | null; type?: string | null };
    code: { id: number; code: string; codeVisible: string | null; status: string; generatedAt: string; usedAt: string | null } | null;
  };
  messages: Msg[];
};

/* ---------------------------------------------------------------- *
 * Workflow. Unchanged rules, one definition.
 * Reviewing cannot jump to Refunded; Refunded and Rejected are final.
 * ---------------------------------------------------------------- */
const NEXT_STEPS: Record<string, string[]> = {
  SUBMITTED: ["REVIEWING"],
  REVIEWING: ["NEED_INFO", "APPROVED", "REJECTED"],
  NEED_INFO: ["REVIEWING"],
  APPROVED: ["REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
  REJECTED: [],
};

const STATUS_META: Record<string, { label: string; text: string; dot: string; soft: string; ring: string }> = {
  SUBMITTED: { label: "Submitted", text: "text-slate-700", dot: "bg-slate-400", soft: "bg-slate-100", ring: "ring-slate-200" },
  REVIEWING: { label: "Reviewing", text: "text-blue-700", dot: "bg-blue-500", soft: "bg-blue-50", ring: "ring-blue-200" },
  NEED_INFO: { label: "Need info", text: "text-amber-700", dot: "bg-amber-500", soft: "bg-amber-50", ring: "ring-amber-200" },
  APPROVED: { label: "Approved", text: "text-emerald-700", dot: "bg-emerald-500", soft: "bg-emerald-50", ring: "ring-emerald-200" },
  REFUND_PENDING: { label: "Refund pending", text: "text-teal-700", dot: "bg-teal-500", soft: "bg-teal-50", ring: "ring-teal-200" },
  REFUNDED: { label: "Refunded", text: "text-emerald-700", dot: "bg-emerald-600", soft: "bg-emerald-50", ring: "ring-emerald-200" },
  REJECTED: { label: "Rejected", text: "text-rose-700", dot: "bg-rose-500", soft: "bg-rose-50", ring: "ring-rose-200" },
};
const meta = (status: string) => STATUS_META[String(status || "").toUpperCase()] || STATUS_META.SUBMITTED;

/** The happy path, for the progress rail. Rejected is shown as a fork, not a step. */
const TRACK = ["SUBMITTED", "REVIEWING", "APPROVED", "REFUND_PENDING", "REFUNDED"];

const money = (value: number | null | undefined) => `TZS ${Number(value || 0).toLocaleString("en-US")}`;
const dateOnly = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not set";
function ago(value: string | null | undefined) {
  if (!value) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 60) return `${mins || 1} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
const nights = (from: string, to: string) => Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));

export default function AdminCancellationDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(params?.id) ? params?.id?.[0] : params?.id;
  const id = Number(idParam);

  const [item, setItem] = useState<Item | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<string>("");
  const [decisionNote, setDecisionNote] = useState<string>("");
  const [refundProvider, setRefundProvider] = useState<string>("");
  const [refundReference, setRefundReference] = useState<string>("");
  const [bankCharges, setBankCharges] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [threadOpen, setThreadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/admin/cancellations/${id}`);
      const next: Item = res.data.item;
      setItem(next);
      setStatus("");
      setDecisionNote("");
      setRefundProvider(next.refundProvider || res.data.paymentInfo?.invoice?.paymentMethod || "");
      setRefundReference(next.refundReference || "");
      setPaymentInfo(res.data.paymentInfo || null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load cancellation request");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
  }, [id, load]);

  const canSave = useMemo(() => {
    if (!item || !status) return false;
    if (["NEED_INFO", "APPROVED", "REJECTED"].includes(status) && !decisionNote.trim()) return false;
    if (status === "REFUND_PENDING" && !refundProvider.trim()) return false;
    if (status === "REFUNDED" && refundReference.trim().length < 3) return false;
    return true;
  }, [decisionNote, item, refundProvider, refundReference, status]);

  async function save() {
    if (!item || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/admin/cancellations/${item.id}`, {
        status, decisionNote, refundProvider, refundReference,
        ...(Number(bankCharges) > 0 ? { actualBankCharges: Number(bankCharges) } : {}),
      });
      setBankCharges("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    if (!item) return;
    const body = message.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/admin/cancellations/${item.id}/messages`, { body });
      setMessage("");
      await load();
      setStatus("");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  if (loading && !item) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading cancellation request</div>;
  }
  if (error && !item) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><XCircle className="h-5 w-5" /></span>
        <p className="m-0 mt-3 text-sm font-semibold text-slate-900">Could not open this request</p>
        <p className="m-0 mt-1 text-xs text-slate-500">{error}</p>
        <Link href="/admin/cancellations" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white no-underline hover:bg-slate-800 hover:no-underline"><ArrowLeft className="h-4 w-4" /> Back to cancellations</Link>
      </div>
    );
  }
  if (!item) return null;

  const current = meta(item.status);
  const nextSteps = NEXT_STEPS[item.status] ?? [];
  const isFinal = nextSteps.length === 0;
  const rejected = item.status === "REJECTED";
  const paymentVerified = Boolean(paymentInfo?.hasTransactionId && paymentInfo?.paymentConfirmed);
  const stayNights = nights(item.booking.checkIn, item.booking.checkOut);
  const place = [item.booking.property.regionName, item.booking.property.city, item.booking.property.district].filter(Boolean).join(", ");
  const policyLabel = item.policyRefundPercent === 100 ? "100% refund" : item.policyRefundPercent != null ? `${item.policyRefundPercent}% refund` : "Manual review";
  const expectedRefund = item.refundAmount ?? (item.policyRefundPercent != null ? (Number(item.booking.totalAmount) * item.policyRefundPercent) / 100 : null);

  // Track position: a rejected case stops wherever it was.
  const trackIndex = rejected ? 1 : Math.max(0, TRACK.indexOf(item.status));
  const stepDate: Record<string, string | null> = {
    SUBMITTED: item.createdAt,
    REVIEWING: item.status === "SUBMITTED" ? null : item.createdAt,
    APPROVED: item.approvedAt,
    REFUND_PENDING: item.refundInitiatedAt,
    REFUNDED: item.refundedAt,
  };

  const lastMessage = item.messages[item.messages.length - 1];

  const checks = [
    { label: "Payment confirmed", ok: paymentVerified, detail: paymentVerified ? "Transaction identifier and successful payment on file" : "Approval stays blocked until the payment is confirmed" },
    { label: "Booking code matched", ok: true, detail: `Code ${item.bookingCode} matched this booking on submission` },
    { label: "Customer verified", ok: true, detail: "The requester was signed in and matched to the booking customer" },
    { label: "Policy checked", ok: item.policyEligible, detail: `${item.policyRefundPercent ?? 0}% under ${item.policyRule || "manual review"}` },
  ];
  const passed = checks.filter((c) => c.ok).length;

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Case header */}
      <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-start gap-3 px-4 py-4 sm:px-5">
          <Link href="/admin/cancellations" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-500 no-underline transition hover:bg-slate-50 hover:text-slate-900" aria-label="Back to cancellations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold uppercase tracking-[0.14em] text-slate-400">Cancellation</span>
              <span className="font-mono">#{item.id}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${current.soft} ${current.text} ${current.ring}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${current.dot}`} />{current.label}
              </span>
              {isFinal && <span className="text-[11px] text-slate-400">Final</span>}
            </p>
            <h1 className="m-0 mt-1 truncate text-lg font-bold tracking-tight text-slate-900">{item.booking.property.title}</h1>
            <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{item.user?.name || `User #${item.user.id}`}</span>
              <span className="inline-flex items-center gap-1 font-mono">{item.bookingCode}</span>
              <span title={dateTime(item.createdAt)}>Requested {ago(item.createdAt)}</span>
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="hidden text-right sm:block">
              <span className="block text-[11px] text-slate-400">Booking value</span>
              <span className="block text-sm font-bold tabular-nums text-slate-900">{money(item.booking.totalAmount)}</span>
            </span>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {/* Progress rail */}
        <ol className="m-0 flex list-none gap-0 overflow-x-auto border-0 border-t border-solid border-slate-100 px-4 py-3 sm:px-5">
          {TRACK.map((step, index) => {
            const done = !rejected && index < trackIndex;
            const active = !rejected && index === trackIndex;
            const stepMeta = meta(step);
            return (
              <li key={step} className="flex min-w-[8.5rem] flex-1 items-start gap-2">
                <span className={`mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-600 text-white" : active ? `${stepMeta.soft} ${stepMeta.text} ring-2 ring-inset ${stepMeta.ring}` : "bg-slate-100 text-slate-400"}`}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-xs font-semibold ${done || active ? "text-slate-900" : "text-slate-400"}`}>{stepMeta.label}</span>
                    {index < TRACK.length - 1 && <span className={`hidden h-px flex-1 sm:block ${done ? "bg-emerald-300" : "bg-slate-200"}`} />}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">{stepDate[step] ? dateOnly(stepDate[step]) : active ? "In progress" : "Pending"}</span>
                </span>
              </li>
            );
          })}
          {rejected && (
            <li className="flex min-w-[8.5rem] items-start gap-2">
              <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-rose-600 text-white"><Ban className="h-3.5 w-3.5" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-rose-700">Rejected</span>
                <span className="block truncate text-[11px] text-slate-400">{dateOnly(item.updatedAt)}</span>
              </span>
            </li>
          )}
        </ol>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- Case body ---------------- */}
        <div className="min-w-0 space-y-4">
          {/* Claim facts */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
            <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
              {[
                { icon: Calendar, label: "Check-in", value: dateOnly(item.booking.checkIn), sub: `${stayNights} ${stayNights === 1 ? "night" : "nights"} to ${dateOnly(item.booking.checkOut)}` },
                { icon: CreditCard, label: "Booking value", value: money(item.booking.totalAmount), sub: `Booking #${item.booking.id} · ${item.booking.status}` },
                { icon: Shield, label: "Policy", value: policyLabel, sub: item.policyRule || "No rule recorded" },
                { icon: FileText, label: expectedRefund != null ? "Refund due" : "Refund", value: expectedRefund != null ? money(expectedRefund) : "Not set", sub: item.refundAmount != null ? "Approved amount" : "Estimated from policy" },
              ].map((fact) => {
                const Icon = fact.icon;
                return (
                  <div key={fact.label} className="min-w-0 bg-white px-4 py-3">
                    <p className="m-0 flex items-center gap-1.5 text-[11px] text-slate-400"><Icon className="h-3.5 w-3.5" /> {fact.label}</p>
                    <p className="m-0 mt-0.5 truncate text-sm font-semibold text-slate-900" title={fact.value}>{fact.value}</p>
                    <p className="m-0 mt-0.5 truncate text-[11px] text-slate-500" title={fact.sub}>{fact.sub}</p>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-px border-0 border-t border-solid border-slate-100 bg-slate-100 sm:grid-cols-2">
              <div className="min-w-0 bg-white px-4 py-3">
                <p className="m-0 text-[11px] text-slate-400">Customer</p>
                <p className="m-0 mt-0.5 truncate text-sm font-semibold text-slate-900">{item.booking.guestName || item.user?.name || `User #${item.user.id}`}</p>
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 truncate"><Mail className="h-3.5 w-3.5" />{item.user?.email || "No email"}</span>
                  <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{item.booking.guestPhone || item.user?.phone || "No phone"}</span>
                </p>
              </div>
              <div className="min-w-0 bg-white px-4 py-3">
                <p className="m-0 text-[11px] text-slate-400">Property</p>
                <Link href={`/admin/nrms/${item.booking.property.id}`} className="m-0 mt-0.5 block truncate text-sm font-semibold text-slate-900 no-underline hover:text-[#02665e]">{item.booking.property.title}</Link>
                <p className="m-0 mt-1 flex items-center gap-1 truncate text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 flex-shrink-0" />{place || "Location not recorded"}{item.booking.property.type ? ` · ${item.booking.property.type}` : ""}</p>
              </div>
            </div>
            {item.reason && (
              <div className="border-0 border-t border-solid border-slate-100 px-4 py-3">
                <p className="m-0 text-[11px] text-slate-400">Customer&apos;s reason</p>
                <p className="m-0 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.reason}</p>
              </div>
            )}
          </section>

          {/* Verification */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
              <ShieldCheck className="h-4 w-4 text-[#02665e]" />
              <h2 className="m-0 text-sm font-bold text-slate-900">Verification</h2>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${passed === checks.length ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{passed} of {checks.length} cleared</span>
            </div>
            <ul className="m-0 grid list-none gap-px border-0 border-t border-solid border-slate-100 bg-slate-100 p-0 sm:grid-cols-2">
              {checks.map((check) => (
                <li key={check.label} className={`flex min-w-0 items-start gap-2.5 px-4 py-3 ${check.ok ? "bg-white" : "bg-amber-50/60"}`}>
                  {check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{check.label}</span>
                    <span className="block text-xs leading-5 text-slate-500">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>

            {/* Payment evidence */}
            <div className="border-0 border-t border-solid border-slate-100 px-4 py-3 sm:px-5">
              <p className="m-0 mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400"><CreditCard className="h-3.5 w-3.5" /> Original payment</p>
              {paymentInfo ? (
                <>
                  <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-[11px] text-slate-400">Invoice</dt><dd className="m-0 truncate font-mono text-slate-800">{paymentInfo.invoice.invoiceNumber || `#${paymentInfo.invoice.id}`}</dd></div>
                    <div><dt className="text-[11px] text-slate-400">Receipt</dt><dd className="m-0 truncate font-mono text-slate-800">{paymentInfo.invoice.receiptNumber || "Not issued"}</dd></div>
                    <div><dt className="text-[11px] text-slate-400">Paid</dt><dd className="m-0 font-semibold tabular-nums text-slate-900">{money(Number(paymentInfo.invoice.total))}</dd></div>
                    <div><dt className="text-[11px] text-slate-400">Method</dt><dd className="m-0 truncate text-slate-800">{paymentInfo.invoice.paymentMethod || "Not recorded"} · {paymentInfo.invoice.status}</dd></div>
                  </dl>
                  <div className={`mt-3 rounded-xl px-3 py-2.5 text-xs ring-1 ${paymentInfo.invoice.paymentRef ? "bg-emerald-50/70 text-emerald-900 ring-emerald-200" : paymentInfo.paymentEvents.length ? "bg-blue-50/70 text-blue-900 ring-blue-200" : "bg-rose-50/70 text-rose-900 ring-rose-200"}`}>
                    {paymentInfo.invoice.paymentRef ? (
                      <p className="m-0 flex flex-wrap items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Transaction reference <code className="break-all rounded bg-white/70 px-1.5 py-0.5 font-mono">{paymentInfo.invoice.paymentRef}</code></p>
                    ) : paymentInfo.paymentEvents.length ? (
                      <div>
                        <p className="m-0 font-semibold">No invoice reference, but {paymentInfo.paymentEvents.length} gateway {paymentInfo.paymentEvents.length === 1 ? "event" : "events"} found</p>
                        <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                          {paymentInfo.paymentEvents.map((event) => (
                            <li key={event.id} className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{event.provider}</span>
                              <code className="break-all rounded bg-white/70 px-1.5 py-0.5 font-mono">{event.eventId}</code>
                              <span>{event.status}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="m-0 flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> No transaction identifier was found. Confirm the payment before any refund is approved.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="m-0 rounded-xl bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900 ring-1 ring-amber-200">Payment information could not be loaded for this booking. Verify the payment and ask the customer for transaction details.</p>
              )}
            </div>
          </section>

          {/* Conversation */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
            {/* Collapsed by default: the thread is reference material, the decision is the work. */}
            <button
              type="button"
              onClick={() => setThreadOpen((open) => !open)}
              aria-expanded={threadOpen}
              className="flex w-full flex-wrap items-center gap-2 border-0 bg-transparent px-4 py-3 text-left transition hover:bg-slate-50 sm:px-5"
            >
              <MessageSquare className="h-4 w-4 flex-shrink-0 text-[#02665e]" />
              <h2 className="m-0 text-sm font-bold text-slate-900">Conversation</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{item.messages.length}</span>
              {!threadOpen && lastMessage && (
                <span className="hidden min-w-0 flex-1 truncate text-xs text-slate-400 sm:block">
                  {lastMessage.senderRole === "ADMIN" ? "You" : "Customer"}: {lastMessage.body}
                </span>
              )}
              <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                {threadOpen ? "Hide" : "Show"}
                <ChevronDown className={`h-4 w-4 transition-transform ${threadOpen ? "rotate-180" : ""}`} />
              </span>
            </button>

            {threadOpen && (<>
            <div className="max-h-96 space-y-3 overflow-y-auto border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
              {item.messages.length === 0 ? (
                <p className="m-0 py-6 text-center text-xs text-slate-400">No messages yet. Ask for evidence or explain the decision.</p>
              ) : (
                item.messages.map((m) => {
                  const mine = m.senderRole === "ADMIN";
                  return (
                    <div key={m.id} className={`flex gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                      {!mine && <span className="mt-auto grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200"><User className="h-3.5 w-3.5" /></span>}
                      <div className={`min-w-0 max-w-[80%] rounded-2xl px-3.5 py-2.5 ${mine ? "rounded-br-sm bg-[#02665e] text-white" : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200"}`}>
                        <p className={`m-0 text-[11px] font-semibold ${mine ? "text-white/70" : "text-slate-400"}`}>{mine ? "Admin" : "Customer"}</p>
                        <p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{m.body}</p>
                        <p className={`m-0 mt-1 text-[10px] ${mine ? "text-white/60" : "text-slate-400"}`} title={dateTime(m.createdAt)}>{ago(m.createdAt)}</p>
                      </div>
                      {mine && <span className="mt-auto grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-[#02665e]"><Shield className="h-3.5 w-3.5" /></span>}
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-0 border-t border-solid border-slate-100 p-3 sm:p-4">
              {isFinal ? (
                <p className="m-0 flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                  <Lock className="h-4 w-4" /> This claim is {current.label.toLowerCase()}. Messaging is closed.
                </p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
                    rows={2}
                    className="min-h-[3.25rem] w-full flex-1 resize-none rounded-xl border border-solid border-slate-200 bg-white px-3.5 py-2.5 font-[inherit] text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                    placeholder="Write to the customer, for example asking for the payment receipt"
                  />
                  <button type="button" onClick={send} disabled={sending || !message.trim()} className="inline-flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-semibold text-white transition hover:bg-[#014d47] disabled:opacity-50">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                  </button>
                </div>
              )}
            </div>
            </>)}
          </section>
        </div>

        {/* ---------------- Decision rail ---------------- */}
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
            <div className={`flex items-center gap-2 px-4 py-3 ${current.soft}`}>
              <span className={`h-2 w-2 rounded-full ${current.dot}`} />
              <h2 className={`m-0 text-sm font-bold ${current.text}`}>{isFinal ? `${current.label} · closed` : "Decision"}</h2>
            </div>

            {isFinal ? (
              <div className="space-y-3 px-4 py-4">
                <p className="m-0 text-xs leading-5 text-slate-600">
                  {item.status === "REFUNDED"
                    ? "The refund is complete. A refunded claim can never be rejected."
                    : "This claim was rejected. A rejected claim can never be refunded."}
                </p>
                {item.decisionNote && (
                  <p className="m-0 rounded-xl bg-slate-50 px-3 py-2.5 text-xs italic leading-5 text-slate-600">&ldquo;{item.decisionNote}&rdquo;</p>
                )}
              </div>
            ) : (
              <div className="space-y-3 px-4 py-4">
                {item.status === "SUBMITTED" && (
                  <p className="m-0 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Move the claim to Reviewing first. Approvals and rejections are not allowed straight from Submitted.
                  </p>
                )}
                {!paymentVerified && (
                  <p className="m-0 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-900">
                    <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" /> The API blocks approval until the original payment is confirmed.
                  </p>
                )}

                <div>
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Next step</p>
                  <div className="mt-2 grid gap-1.5">
                    {nextSteps.map((step) => {
                      const stepMeta = meta(step);
                      const chosen = status === step;
                      return (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setStatus(chosen ? "" : step)}
                          aria-pressed={chosen}
                          className={`flex items-center gap-2.5 rounded-xl border border-solid px-3 py-2.5 text-left text-sm transition ${chosen ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
                        >
                          <span className={`h-2 w-2 rounded-full ${chosen ? "bg-white" : stepMeta.dot}`} />
                          <span className="flex-1 font-medium">{stepMeta.label}</span>
                          <ChevronRight className={`h-4 w-4 ${chosen ? "text-white/70" : "text-slate-300"}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {["NEED_INFO", "APPROVED", "REJECTED"].includes(status) && (
                  <label className="block text-xs font-semibold text-slate-700">
                    {status === "NEED_INFO" ? "What do you need from the customer?" : status === "REJECTED" ? "Rejection reason" : "Approval note"}
                    <textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} rows={3} maxLength={4000} className="mt-1.5 w-full resize-none rounded-xl border border-solid border-slate-200 bg-white px-3 py-2.5 font-[inherit] text-sm font-normal text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" placeholder="Recorded on the claim and sent to the customer" />
                  </label>
                )}

                {status === "REFUND_PENDING" && (
                  <div className="space-y-2.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Refund provider
                      <input value={refundProvider} onChange={(e) => setRefundProvider(e.target.value)} maxLength={80} className="mt-1.5 h-10 w-full rounded-xl border border-solid border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" placeholder="Original payment provider or bank" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-700">
                      Actual bank charges <span className="font-normal text-slate-400">(optional)</span>
                      <input value={bankCharges} onChange={(e) => setBankCharges(e.target.value)} inputMode="decimal" className="mt-1.5 h-10 w-full rounded-xl border border-solid border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" placeholder="TZS amount from the bank advice" />
                    </label>
                    <p className="m-0 text-[11px] leading-4 text-slate-500">Policy 8.4: 6% card surcharge or actual bank charges, plus the administrative charge. Free-cancellation and pre-policy bookings are exempt.</p>
                  </div>
                )}

                {status === "REFUNDED" && (
                  <label className="block text-xs font-semibold text-slate-700">
                    Provider refund reference
                    <input value={refundReference} onChange={(e) => setRefundReference(e.target.value)} maxLength={160} className="mt-1.5 h-10 w-full rounded-xl border border-solid border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" placeholder="Proof that the refund completed" />
                    <span className="mt-1 block text-[11px] font-normal text-slate-400">At least 3 characters. This is the evidence the refund left the account.</span>
                  </label>
                )}

                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave || saving}
                  className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${status === "REJECTED" ? "bg-rose-600 hover:bg-rose-700" : "bg-[#02665e] hover:bg-[#014d47]"}`}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {status ? `Move to ${meta(status).label}` : "Choose a next step"}
                </button>
                <p className="m-0 text-center text-[11px] text-slate-400">The customer is messaged automatically on every change.</p>
              </div>
            )}
          </section>

          {/* Refund settlement */}
          {item.refundAmount != null && (
            <section className="overflow-hidden rounded-2xl border border-solid border-emerald-200 bg-white">
              <div className="flex items-center gap-2 bg-emerald-50 px-4 py-3">
                <CreditCard className="h-4 w-4 text-emerald-700" />
                <h2 className="m-0 text-sm font-bold text-emerald-800">Refund settlement</h2>
              </div>
              <dl className="m-0 space-y-2 px-4 py-3 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Approved</dt><dd className="m-0 font-semibold tabular-nums text-slate-900">{money(item.refundAmount)}</dd></div>
                {item.refundChargesJson && !item.refundChargesJson.exempt && (
                  <>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Card surcharge</dt><dd className="m-0 tabular-nums text-rose-600">- {money(item.refundChargesJson.cardSurcharge)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Bank charges</dt><dd className="m-0 tabular-nums text-rose-600">- {money(item.refundChargesJson.bankCharges)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Admin charge</dt><dd className="m-0 tabular-nums text-rose-600">- {money(item.refundChargesJson.adminCharge)}</dd></div>
                    <div className="flex justify-between gap-3 border-0 border-t border-solid border-slate-200 pt-2"><dt className="font-medium text-slate-700">Net payable</dt><dd className="m-0 font-bold tabular-nums text-emerald-700">{money(item.refundChargesJson.netRefundAmount)}</dd></div>
                  </>
                )}
                {item.refundChargesJson?.exempt && <p className="m-0 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">Exempt: no refund charges apply.</p>}
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Provider</dt><dd className="m-0 truncate text-slate-800">{item.refundProvider || "Not initiated"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Reference</dt><dd className="m-0 break-all text-right font-mono text-xs text-slate-800">{item.refundReference || "Awaiting confirmation"}</dd></div>
                {item.refundedAt && <div className="flex justify-between gap-3"><dt className="text-slate-500">Refunded</dt><dd className="m-0 text-slate-800">{dateOnly(item.refundedAt)}</dd></div>}
              </dl>
            </section>
          )}

          {/* Trail */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
            <div className="flex items-center gap-2 px-4 py-3">
              <Clock className="h-4 w-4 text-slate-400" />
              <h2 className="m-0 text-sm font-bold text-slate-900">Trail</h2>
            </div>
            <ul className="m-0 list-none space-y-2.5 border-0 border-t border-solid border-slate-100 px-4 py-3 p-0 text-xs">
              {[
                { label: "Booking created", at: item.booking.createdAt },
                { label: "Cancellation requested", at: item.createdAt },
                { label: "Approved", at: item.approvedAt },
                { label: "Refund initiated", at: item.refundInitiatedAt },
                { label: "Refunded", at: item.refundedAt },
                { label: "Last update", at: item.updatedAt },
              ].filter((row) => row.at).map((row) => (
                <li key={row.label} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-700">{row.label}</span>
                    <span className="block text-[11px] text-slate-400">{dateTime(row.at)}</span>
                  </span>
                </li>
              ))}
              {item.booking.code && (
                <li className="flex items-start gap-2.5 border-0 border-t border-solid border-slate-100 pt-2.5">
                  <Search className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-700">Check-in code</span>
                    <span className="block font-mono text-[11px] text-slate-500">{item.booking.code.codeVisible || item.booking.code.code} · {item.booking.code.status}</span>
                  </span>
                </li>
              )}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
