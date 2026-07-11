"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, MessageSquare, Save, Send, CheckCircle, XCircle, AlertTriangle, CreditCard, FileText, Calendar, MapPin, User, Phone, Mail, Building, DollarSign, Shield, Clock, Lock } from "lucide-react";

const api = apiClient;

type Msg = { id: number; senderId: number; senderRole: string; body: string; createdAt: string };
type PaymentEvent = {
  id: number;
  eventId: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
};
type PaymentInfo = {
  invoice: {
    id: number;
    invoiceNumber: string | null;
    receiptNumber: string | null;
    total: number;
    status: string;
    paymentMethod: string | null;
    paymentRef: string | null;
    createdAt: string;
  };
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
    property: { 
      id: number;
      title: string; 
      regionName?: string | null; 
      city?: string | null; 
      district?: string | null;
      type?: string | null;
    };
    code: {
      id: number;
      code: string;
      codeVisible: string | null;
      status: string;
      generatedAt: string;
      usedAt: string | null;
    } | null;
  };
  messages: Msg[];
};

function fmt(d: string) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function statusTone(status: string) {
  const key = String(status || "").toUpperCase();
  if (key === "REFUNDED") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (key === "REJECTED") return "bg-red-50 text-red-700 ring-red-200";
  if (key === "REFUND_PENDING") return "bg-teal-50 text-teal-700 ring-teal-200";
  if (key === "APPROVED") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (key === "NEED_INFO") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (key === "REVIEWING") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/admin/cancellations/${id}`);
      const it: Item = res.data.item;
      setItem(it);
      setStatus("");
      setDecisionNote("");
      setRefundProvider(it.refundProvider || res.data.paymentInfo?.invoice?.paymentMethod || "");
      setRefundReference(it.refundReference || "");
      setPaymentInfo(res.data.paymentInfo || null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load cancellation request");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canSave = useMemo(() => {
    if (!item || !status) return false;
    if (["NEED_INFO", "APPROVED", "REJECTED"].includes(status) && !decisionNote.trim()) return false;
    if (status === "REFUND_PENDING" && !refundProvider.trim()) return false;
    if (status === "REFUNDED" && refundReference.trim().length < 3) return false;
    return true;
  }, [decisionNote, item, refundProvider, refundReference, status]);

  // Get workflow flow - next possible actions based on current status
  // Workflow principles:
  // 1. From Reviewing: Can go to Need Info, Processing, or Rejected (NOT directly to Refunded)
  // 2. From Need Info: Can go back to Reviewing, or proceed to Processing/Rejected if info is sufficient
  //    - Admin should not use NEED_INFO as a required step if they can proceed directly to Processing
  // 3. Processing is required before Refunded (cannot skip Processing)
  // 4. Reviewing can be reached from both SUBMITTED and NEED_INFO (for re-review after getting info)
  // 5. REFUNDED and REJECTED are mutually exclusive final states:
  //    - Once REFUNDED, the claim cannot be REJECTED (void)
  //    - Once REJECTED, the claim cannot be REFUNDED (void)
  //    - These are terminal states with no further actions
  function getWorkflowFlow(currentStatus: string): { current: string; next: string[] } {
    const workflow: Record<string, { current: string; next: string[] }> = {
      SUBMITTED: {
        current: "Submitted",
        next: ["Reviewing"]
      },
      REVIEWING: {
        current: "Reviewing",
        // Can request more info, proceed to processing if all info is available, or reject
        // CANNOT go directly to Refunded - must go through Processing first
        // CANNOT go to both Refunded and Rejected - they are mutually exclusive
        next: ["Need Info", "Approved", "Rejected"]
      },
      NEED_INFO: {
        current: "Need Info",
        // After getting info: can re-review, or if info is sufficient, proceed to Processing/Rejected
        // Admin should not use NEED_INFO as a required step if they can proceed directly to Processing
        // CANNOT go to Refunded from here - must go through Processing
        next: ["Reviewing"]
      },
      APPROVED: { current: "Approved", next: ["Refund Pending"] },
      REFUND_PENDING: { current: "Refund Pending", next: ["Refunded"] },
      REFUNDED: {
        current: "Refunded",
        // Final state - mutually exclusive with REJECTED
        // Once refunded, cannot be rejected (void)
        next: []
      },
      REJECTED: {
        current: "Rejected",
        // Final state - mutually exclusive with REFUNDED
        // Once rejected, cannot be refunded (void)
        next: []
      }
    };
    
    return workflow[currentStatus] || { current: currentStatus, next: [] };
  }

  async function save() {
    if (!item) return;
    if (!canSave) return;
    
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/admin/cancellations/${item.id}`, { status, decisionNote, refundProvider, refundReference, ...(Number(bankCharges) > 0 ? { actualBankCharges: Number(bankCharges) } : {}) });
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
      await api.post(`/api/admin/cancellations/${item.id}/messages`, {
        body,
      });
      setMessage("");
      // Reload to get latest thread + status
      await load();
      // Keep local status aligned
      setStatus("");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-[calc(100%-1rem)] max-w-6xl min-w-0 space-y-5 overflow-x-clip py-5 sm:w-[calc(100%-1.5rem)]">
      {/* Header with Back Button */}
      <div className="flex items-center justify-between">
        <Link 
          href="/admin/cancellations" 
          className="inline-flex items-center justify-center w-10 h-10 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors duration-200"
          title="Back to Cancellations"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#02665e] mx-auto mb-4" />
          <p className="text-sm font-medium text-gray-600">Loading cancellation request...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-900 mb-1">Error</div>
              <div className="text-sm text-red-800">{error}</div>
            </div>
          </div>
        </div>
      ) : !item ? null : (
        <div className="min-w-0 max-w-full space-y-6 overflow-x-clip">
          {/* Main Request Card */}
          <div className="max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Header Section */}
            <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e] shadow-sm">
                      <FileText className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Cancellation Request</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span className="text-2xl font-black text-slate-950">#{item.id}</span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${statusTone(item.status)}`}>
                          {getWorkflowFlow(item.status).current}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                    <span className="font-semibold">Booking code</span>
                    <span className="break-all font-mono font-bold text-slate-950">{item.bookingCode}</span>
                  </div>
                </div>
                <div className="w-full min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:w-auto sm:min-w-[240px] sm:max-w-[320px]">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500"><User className="h-3.5 w-3.5 text-[#02665e]" />Customer</div>
                  <div className="font-bold text-slate-950">{item.user?.name || `User #${item.user.id}`}</div>
                  <div className="mt-1 break-all text-sm text-gray-600">{item.user.email || item.user.phone || "—"}</div>
                </div>
              </div>
            </div>

            {/* Quick Info Cards */}
            <div className="px-5 py-5 sm:px-6">
              <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Building className="h-4 w-4 text-blue-600" />
                    <div className="text-xs font-bold text-blue-700 uppercase tracking-wider">Property</div>
                  </div>
                  <div className="font-bold text-gray-900 text-sm mb-1">{item.booking.property.title}</div>
                  <div className="flex min-w-0 items-start gap-1 text-xs text-gray-600">
                    <MapPin className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span className="break-words">
                    {[item.booking.property.regionName, item.booking.property.city, item.booking.property.district].filter(Boolean).join(" • ") || "—"}
                    </span>
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Check-in</div>
                  </div>
                  <div className="font-bold text-gray-900 text-sm">{new Date(item.booking.checkIn).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  <div className="text-xs text-gray-600 mt-1">{new Date(item.booking.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-amber-600" />
                    <div className="text-xs font-bold text-amber-700 uppercase tracking-wider">Policy</div>
                  </div>
                  <div className="font-bold text-gray-900 text-sm">
                    {item.policyRefundPercent === 100 ? "100% (free)" : item.policyRefundPercent === 50 ? "50%" : "Manual"}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">{item.policyRule || "—"}</div>
                </div>
              </div>

              {/* Status Section */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Workflow action</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">Update cancellation status</div>
                  </div>
                  <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${statusTone(item.status)}`}>
                    Current: {getWorkflowFlow(item.status).current}
                  </span>
                </div>
                
                {/* Warning for SUBMITTED status - must review first */}
                {item.status === "SUBMITTED" && (
                  <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-amber-900 mb-1">Review Required - Cannot Skip</div>
                        <div className="text-xs text-amber-800 leading-relaxed">
                          This claim is in &quot;Submitted&quot; status. <strong>You must move it to Reviewing first</strong> before requesting information, approving, or rejecting it.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="min-w-0">
                    <label htmlFor="status-select" className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      New status
                    </label>
                    <select
                      id="status-select"
                      aria-label="Status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-all focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20"
                    >
                      <option value="" disabled>Select the next workflow step</option>
                      {(() => {
                        const flow = getWorkflowFlow(item.status);
                        return flow.next.map((nextStatus) => {
                          const valueMap: Record<string, string> = {
                            "Reviewing": "REVIEWING",
                            "Need Info": "NEED_INFO",
                            "Approved": "APPROVED",
                            "Refund Pending": "REFUND_PENDING",
                            "Refunded": "REFUNDED",
                            "Rejected": "REJECTED"
                          };
                          return (
                            <option key={valueMap[nextStatus]} value={valueMap[nextStatus]}>
                              {nextStatus}
                            </option>
                          );
                        });
                      })()}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!canSave || saving}
                    className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-[#02665e] px-5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:bg-[#014d47] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#02665e] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Changes
                  </button>
                </div>

                {["NEED_INFO", "APPROVED", "REJECTED"].includes(status) && (
                  <div className="mt-4">
                    <label htmlFor="decision-note" className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      {status === "NEED_INFO" ? "Information required" : status === "REJECTED" ? "Rejection reason" : "Approval decision"}
                    </label>
                    <textarea id="decision-note" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} rows={3} maxLength={4000} className="box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" placeholder="Record the evidence and reason for this decision" />
                  </div>
                )}

                {status === "REFUND_PENDING" && (
                  <div className="mt-4">
                    <label htmlFor="refund-provider" className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Refund provider</label>
                    <input id="refund-provider" value={refundProvider} onChange={(e) => setRefundProvider(e.target.value)} maxLength={80} className="box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" placeholder="Original payment provider or bank" />
                    <label htmlFor="bank-charges" className="mb-2 mt-3 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Actual bank charges debited (optional)</label>
                    <input id="bank-charges" value={bankCharges} onChange={(e) => setBankCharges(e.target.value)} inputMode="decimal" className="box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" placeholder="TZS amount from the bank debit advice" />
                    <p className="mt-2 text-xs text-slate-500">Refund payment charges apply per policy section 8.4: 6% card surcharge or actual bank charges, plus the administrative charge. Free-cancellation window and pre-policy bookings are exempt.</p>
                  </div>
                )}

                {status === "REFUNDED" && (
                  <div className="mt-4">
                    <label htmlFor="refund-reference" className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Provider refund reference</label>
                    <input id="refund-reference" value={refundReference} onChange={(e) => setRefundReference(e.target.value)} maxLength={160} className="box-border w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20" placeholder="Required proof that the refund completed" />
                  </div>
                )}
                
                {/* Workflow Flow Indicator */}
                {(() => {
                  const flow = getWorkflowFlow(item.status);
                  if (flow.next.length > 0) {
                    return (
                      <div className="mt-4 border-t border-slate-200 pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">Next allowed:</span>
                          {flow.next.map((next, idx) => (
                            <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                              <span className="h-1 w-1 rounded-full bg-[#02665e]"></span>
                              {next}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-4 border-t border-slate-200 pt-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-600"></div>
                        <span className="text-xs font-semibold text-gray-700">Status: <span className="text-emerald-600">{flow.current}</span> (Final)</span>
                      </div>
                    </div>
                  );
                })()}

                {item.refundAmount != null && (
                  <div className="mt-4 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:grid-cols-3">
                    <div><div className="text-xs font-semibold text-emerald-700">Approved refund</div><div className="mt-1 font-bold text-emerald-950">TZS {Number(item.refundAmount).toLocaleString()}</div></div>
                    <div><div className="text-xs font-semibold text-emerald-700">Provider</div><div className="mt-1 font-bold text-emerald-950">{item.refundProvider || "Not initiated"}</div></div>
                    <div><div className="text-xs font-semibold text-emerald-700">Refund reference</div><div className="mt-1 break-all font-bold text-emerald-950">{item.refundReference || "Awaiting confirmation"}</div></div>
                    {item.refundChargesJson && (
                      <div className="sm:col-span-3 border-t border-emerald-200 pt-3">
                        <div className="text-xs font-semibold text-emerald-700">Refund payment charges (policy 8.4)</div>
                        <div className="mt-1 text-sm font-semibold text-emerald-950">
                          {item.refundChargesJson.exempt
                            ? "Exempt: no charges apply to this refund."
                            : `Card surcharge TZS ${Number(item.refundChargesJson.cardSurcharge || 0).toLocaleString()} · Bank charges TZS ${Number(item.refundChargesJson.bankCharges || 0).toLocaleString()} · Admin charge TZS ${Number(item.refundChargesJson.adminCharge || 0).toLocaleString()} · Net payable TZS ${Number(item.refundChargesJson.netRefundAmount || 0).toLocaleString()}`}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                <p className="mt-3 text-xs text-slate-500">
                  Changing the status will automatically send a message to the customer
                </p>
              </div>
            </div>
          </div>

          {/* Verification & Investigation Section */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Section Header */}
            <div className="bg-gradient-to-r from-[#02665e]/5 to-transparent border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-[#02665e] to-[#014d47] flex items-center justify-center">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Verification & Investigation</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Review and verify all claim details before processing</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* Security Alert for Missing Transaction ID */}
              {paymentInfo && (!paymentInfo.hasTransactionId || !paymentInfo.paymentConfirmed) && (
                <div className="rounded-lg border-2 border-red-300 bg-gradient-to-r from-red-50 to-red-100/50 p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-red-900 mb-1.5 text-sm">Payment verification required</div>
                      <div className="text-sm text-red-800 leading-relaxed">
                        The original payment needs both a transaction identifier and a successful payment status.
                        <strong className="block mt-2 text-red-900">Approval is blocked by the API until the payment is confirmed.</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step-by-Step Verification Checklist */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#02665e]"></div>
                  Verification Steps
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-all ${
                    paymentInfo?.hasTransactionId && paymentInfo?.paymentConfirmed
                      ? "border-emerald-200 bg-emerald-50/50" 
                      : "border-amber-200 bg-amber-50/50"
                  }`}>
                    <div className="mt-0.5 flex-shrink-0">
                      {paymentInfo?.hasTransactionId && paymentInfo?.paymentConfirmed ? (
                        <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        </div>
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center">
                          <Clock className="h-4 w-4 text-amber-600" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm mb-1">1. Payment {paymentInfo?.hasTransactionId && paymentInfo?.paymentConfirmed ? "Verified" : "Not Verified"}</div>
                      <div className="text-xs text-gray-600 leading-relaxed">
                        A successful payment status and transaction identifier are required
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-4">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm mb-1">2. Booking Code Verified</div>
                      <div className="text-xs text-gray-600 leading-relaxed">
                        The authenticated submission route matched this code to the booking
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-4">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm mb-1">3. Customer Ownership Verified</div>
                      <div className="text-xs text-gray-600 leading-relaxed">
                        The requester was authenticated and matched to the booking customer
                      </div>
                    </div>
                  </div>
                  <div className={`flex items-start gap-3 rounded-lg border-2 p-4 ${item.policyEligible ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}`}>
                    <div className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${item.policyEligible ? "bg-emerald-100" : "bg-red-100"}`}>
                      {item.policyEligible ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm mb-1">4. Policy {item.policyEligible ? "Verified" : "Not Eligible"}</div>
                      <div className="text-xs text-gray-600 leading-relaxed">
                        Stored policy decision: {item.policyRefundPercent ?? 0}% refund under {item.policyRule || "manual review"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Booking Details */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#02665e]"></div>
                  Booking Details
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Booking Information</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-medium text-gray-600">Booking ID:</span>
                        <span className="font-semibold text-gray-900">#{item.booking.id}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-medium text-gray-600">Booking Code:</span>
                        <span className="font-mono font-semibold text-gray-900">{item.bookingCode}</span>
                      </div>
                      {item.booking.code && (
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-600">Check-in Code:</span>
                          <span className="font-mono font-semibold text-gray-900">{item.booking.code.codeVisible || item.booking.code.code}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-medium text-gray-600">Status:</span>
                        <span className="font-semibold text-gray-900">{item.booking.status}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="font-medium text-gray-600">Created:</span>
                        <span className="text-gray-700 text-xs">{new Date(item.booking.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Calendar className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Dates & Amount</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-medium text-gray-600">Check-in:</span>
                        <span className="text-gray-900">{new Date(item.booking.checkIn).toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-medium text-gray-600">Check-out:</span>
                        <span className="text-gray-900">{new Date(item.booking.checkOut).toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 pt-2">
                        <span className="font-medium text-gray-600">Total Amount:</span>
                        <span className="font-bold text-lg text-[#02665e]">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'TZS' }).format(item.booking.totalAmount)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center">
                        <Building className="h-4 w-4 text-purple-600" />
                      </div>
                      <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Property</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="py-1">
                        <div className="font-medium text-gray-600 mb-1">Name</div>
                        <div className="font-semibold text-gray-900">{item.booking.property.title}</div>
                      </div>
                      <div className="py-1 border-t border-gray-100">
                        <div className="font-medium text-gray-600 mb-1">Type</div>
                        <div className="text-gray-700">{item.booking.property.type || "—"}</div>
                      </div>
                      <div className="py-1 border-t border-gray-100">
                        <div className="font-medium text-gray-600 mb-1 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          Location
                        </div>
                        <div className="text-gray-700 text-xs">
                          {[item.booking.property.regionName, item.booking.property.city, item.booking.property.district].filter(Boolean).join(", ") || "—"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                        <User className="h-4 w-4 text-indigo-600" />
                      </div>
                      <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Guest Information</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 py-1 border-b border-gray-100">
                        <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-600 text-xs">Name</div>
                          <div className="font-semibold text-gray-900">{item.booking.guestName || item.user?.name || "—"}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 py-1 border-b border-gray-100">
                        <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-600 text-xs">Phone</div>
                          <div className="text-gray-900">{item.booking.guestPhone || item.user?.phone || "—"}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 py-1">
                        <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-600 text-xs">Email</div>
                          <div className="text-gray-900">{item.user?.email || "—"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment & Transaction Information */}
              {paymentInfo ? (
                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#02665e]"></div>
                    Payment & Transaction Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center">
                          <CreditCard className="h-4 w-4 text-green-600" />
                        </div>
                        <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Invoice Information</div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-600">Invoice #:</span>
                          <span className="text-gray-900">{paymentInfo.invoice.invoiceNumber || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-600">Receipt #:</span>
                          <span className="text-gray-900">{paymentInfo.invoice.receiptNumber || "—"}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-600">Amount:</span>
                          <span className="font-bold text-[#02665e]">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'TZS' }).format(Number(paymentInfo.invoice.total))}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-600">Status:</span>
                          <span className="text-gray-900">{paymentInfo.invoice.status}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="font-medium text-gray-600">Method:</span>
                          <span className="text-gray-900">{paymentInfo.invoice.paymentMethod || "—"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-8 w-8 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                          <Shield className="h-4 w-4 text-[#02665e]" />
                        </div>
                        <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Transaction ID Verification</div>
                      </div>
                      <div className="space-y-2">
                        {paymentInfo.invoice.paymentRef ? (
                          <div className="p-3 rounded-lg bg-emerald-50 border-2 border-emerald-200 shadow-sm">
                            <div className="flex items-start gap-2">
                              <CheckCircle className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-emerald-900 mb-1">Transaction ID Found</div>
                                <div className="text-xs text-emerald-700 font-mono break-all bg-emerald-100 px-2 py-1 rounded">{paymentInfo.invoice.paymentRef}</div>
                              </div>
                            </div>
                          </div>
                        ) : paymentInfo.paymentEvents.length > 0 ? (
                          <div className="space-y-2">
                            {paymentInfo.paymentEvents.map((event) => (
                              <div key={event.id} className="p-3 rounded-lg bg-blue-50 border-2 border-blue-200 shadow-sm">
                                <div className="text-xs font-bold text-blue-900 mb-1">{event.provider}</div>
                                <div className="text-xs text-blue-700 font-mono break-all bg-blue-100 px-2 py-1 rounded mb-1">{event.eventId}</div>
                                <div className="text-xs text-blue-600">Status: <span className="font-semibold">{event.status}</span></div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3 rounded-lg bg-red-50 border-2 border-red-200 shadow-sm">
                            <div className="flex items-start gap-2">
                              <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <div className="text-xs font-bold text-red-900 mb-1">No Transaction ID Found</div>
                                <div className="text-xs text-red-700 leading-relaxed">⚠️ This is a security risk. Verify payment before processing refund.</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-amber-100/50 p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-amber-900 mb-1 text-sm">Payment Information Not Available</div>
                      <div className="text-sm text-amber-800 leading-relaxed">
                        Unable to retrieve payment information for this booking. Please verify the payment was made and request transaction details from the customer.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cancellation Reason */}
              {item.reason && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-orange-600" />
                    </div>
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">Cancellation Reason</div>
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{item.reason}</div>
                </div>
              )}
            </div>
          </div>

          {/* Messages Section */}
          <div className="max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Messages Header */}
            <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-4 sm:px-5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]">
                    <MessageSquare className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-slate-950 sm:text-lg">Messages</h2>
                    <p className="mt-0.5 truncate text-xs text-slate-500">Communicate with the customer about this claim</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => load()}
                  className="mr-0.5 inline-flex flex-shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#02665e] shadow-sm transition-colors hover:bg-[#02665e]/5"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="space-y-4 overflow-x-hidden px-4 py-4 sm:px-5">
              {/* Messages List */}
              <div className="max-h-[22rem] space-y-3 overflow-y-auto pr-1">
                {item.messages.length === 0 ? (
                  <div className="text-center py-8">
                    <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-500">No messages yet</p>
                    <p className="text-xs text-gray-400 mt-1">Start a conversation with the customer</p>
                  </div>
                ) : (
                  item.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`min-w-0 max-w-full overflow-hidden rounded-xl border p-3 shadow-sm ${
                        m.senderRole === "ADMIN"
                          ? "border-emerald-100 bg-emerald-50/70"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-6 w-6 rounded-full flex items-center justify-center ${
                            m.senderRole === "ADMIN" ? "bg-emerald-100" : "bg-gray-100"
                          }`}>
                            {m.senderRole === "ADMIN" ? (
                              <Shield className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-gray-600" />
                            )}
                          </div>
                          <span className={`text-xs font-bold ${
                            m.senderRole === "ADMIN" ? "text-emerald-900" : "text-gray-700"
                          }`}>
                            {m.senderRole === "ADMIN" ? "Admin" : "Customer"}
                          </span>
                        </div>
                        <div className="flex-shrink-0 text-xs text-slate-500">{fmt(m.createdAt)}</div>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{m.body}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Message Input */}
              <div className="border-t border-gray-200 pt-4">
                {item.status === "REFUNDED" || item.status === "REJECTED" ? (
                  // Locked state - final status reached
                  <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-lg border-2 border-gray-300 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center transition-all duration-300 animate-pulse">
                        <Lock className="h-4 w-4 text-gray-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Message (Locked)
                        </label>
                        <p className="text-xs text-gray-500 mt-0.5">
                          This claim has reached a final status ({item.status === "REFUNDED" ? "Refunded" : "Rejected"}). No further messages can be sent.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <textarea
                        value=""
                        rows={3}
                        disabled
                        className="flex-1 rounded-lg border-2 border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-400 cursor-not-allowed transition-all duration-200"
                        placeholder="Messaging is disabled - claim is finalized"
                      />
                      <button
                        type="button"
                        disabled
                        className="sm:w-auto sm:min-w-[120px] inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-gray-200 to-gray-300 border-2 border-gray-300 px-6 py-2.5 text-sm font-semibold text-gray-500 cursor-not-allowed shadow-inner transition-all duration-300 hover:from-gray-300 hover:to-gray-400 hover:shadow-md relative overflow-hidden group"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
                        <Lock className="h-4 w-4 relative z-10 transition-transform duration-300 group-hover:rotate-12" />
                        <span className="relative z-10">Locked</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  // Active state - messaging enabled
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                      Message
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={3}
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] outline-none transition-all resize-none"
                        placeholder="Write a message to the customer (request more info, etc.)"
                      />
                      <button
                        type="button"
                        onClick={send}
                        disabled={sending || !message.trim()}
                        className="sm:w-auto sm:min-w-[120px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#02665e] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#014d47] focus:outline-none focus:ring-2 focus:ring-[#02665e] focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


