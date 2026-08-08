"use client";
import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, DollarSign, Building2, Calendar, CheckCircle2, Clock, Receipt, CreditCard, AlertCircle, ShieldCheck, Send } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Inv = {
  id:number; invoiceNumber:string|null; receiptNumber:string|null; status:string; bookingCode?: string | null;
  issuedAt:string; total:number; commissionPercent:number; commissionAmount:number; taxPercent:number; netPayable:number;
  booking: { id:number; property: { id:number; title:string } };
  ownerValidation?: {
    required: boolean;
    validated: boolean;
    validatedAt: string | null;
    code?: {
      id: number;
      status: string | null;
      usedByOwner: boolean | null;
      usedAt: string | null;
    } | null;
  } | null;
  relatedInvoices?: Array<{ id: number; invoiceNumber: string | null; status: string; receiptNumber?: string | null; paymentRef?: string | null; paidAt?: string | null }>;
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
  receiptQrDataUrl?: string | null;
  notes?:string|null; paidAt?:string|null; paymentMethod?:string|null; paymentRef?:string|null; accountNumber?:string|null;
  verifiedAt?:string|null; verifiedByUser?:{id:number;name:string|null}|null;
  approvedAt?:string|null; approvedByUser?:{id:number;name:string|null}|null;
  paidByUser?:{id:number;name:string|null}|null;
  ownerPayout?: {
    payoutPreferred: 'BANK' | 'MOBILE_MONEY' | null;
    bankAccountName: string | null;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankBranch: string | null;
    mobileMoneyProvider: string | null;
    mobileMoneyNumber: string | null;
  } | null;
};

function isOwnerClaimInvoice(inv?: Pick<Inv, "invoiceNumber"> | null) {
  const n = String(inv?.invoiceNumber ?? "");
  return n.toUpperCase().startsWith("OINV-");
}

function paidStatusLabel(inv?: Pick<Inv, "invoiceNumber"> | null) {
  return isOwnerClaimInvoice(inv) ? "Disbursed" : "Paid";
}

function completionLabel(inv?: Pick<Inv, "invoiceNumber"> | null) {
  return isOwnerClaimInvoice(inv) ? "Disbursement" : "Payment";
}

export default function Page(){
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const id = Number(idParam);
  const [inv, setInv] = useState<Inv| null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [overrideTax, setOverrideTax] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  
  const defaultVerificationMessage = "Invoice verified and approved for processing.";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Inv>(`/api/admin/revenue/invoices/${id}`);
      setInv(r.data);
      setActionMessage(null);
    } catch (err: any) {
      console.error("Failed to load invoice:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify(){
    if (!inv?.ownerValidation?.validated) {
      setActionMessage({ type: "error", text: "Owner validation is required before admin can verify this invoice." });
      return;
    }
    setActionLoading(true);
    try {
      const verificationNotes = notes.trim() || defaultVerificationMessage;
      await api.post(`/api/admin/revenue/invoices/${id}/verify`, { notes: verificationNotes });
      await load();
      setNotes("");
      setActionMessage({ type: "success", text: "Invoice verified successfully." });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setActionMessage({ type: "error", text: detail || err?.response?.data?.error || "Failed to verify invoice" });
    } finally {
      setActionLoading(false);
    }
  }
  async function approve(){
    if (!inv?.ownerValidation?.validated) {
      setActionMessage({ type: "error", text: "Owner validation is required before admin can approve this invoice." });
      return;
    }
    setActionLoading(true);
    try {
      await api.post(`/api/admin/revenue/invoices/${id}/approve`, {
        taxPercent: overrideTax===""? undefined : Number(overrideTax),
      });
      await load();
      setOverrideTax("");
      setActionMessage({ type: "success", text: "Invoice approved successfully." });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setActionMessage({ type: "error", text: detail || err?.response?.data?.error || "Failed to approve invoice" });
    } finally {
      setActionLoading(false);
    }
  }
  function getStatusBadge(status: string, invoice?: Inv | null) {
    const statusLower = status.toLowerCase();
    if (statusLower === 'paid') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-800 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          {paidStatusLabel(invoice)}
        </span>
      );
    }
    if (statusLower === 'approved') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          {status}
        </span>
      );
    }
    if (statusLower === 'verified') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-800 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          {status}
        </span>
      );
    }
    if (statusLower === 'requested') {
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">
          <Clock className="h-4 w-4" />
          {status}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 text-gray-800 text-sm font-medium">
        {status}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-emerald-600"></div>
        </div>
      </div>
    );
  }
  if (!inv) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">Invoice not found</p>
          <Link href="/admin/revenue" className="text-emerald-600 hover:text-emerald-700 underline">
            ← Back to revenue
          </Link>
        </div>
      </div>
    );
  }

  const fp = inv.financialPreview;
  const commissionPercent = Number(fp?.commissionPercent ?? inv.effectiveCommissionPercent ?? inv.commissionPercent ?? 0);
  const grossTotal = Number(fp?.grossTotal ?? inv.total ?? 0);
  const baseAmount = Number(fp?.netPayable ?? inv.netPayable ?? inv.total ?? 0);
  const commissionAmount = Number(fp?.commissionAmount ?? inv.commissionAmount ?? 0);
  const taxPercent = Number(fp?.taxPercent ?? (inv.taxPercent !== null && inv.taxPercent !== undefined ? inv.taxPercent : 0) ?? 0);
  const taxAmount = Number(fp?.taxAmount ?? 0);
  // UI conventions for Admin:
  // - "Gross Amount" is the owner payout base (base price × nights)
  // - "Total Paid" is the guest total (base + commission)

  const invNumUpper = String(inv.invoiceNumber ?? "").toUpperCase();
  const isOwnerClaim = invNumUpper.startsWith("OINV-");
  const invoiceTypeLabel = isOwnerClaim ? "Owner Disbursement" : (invNumUpper.startsWith("INV-") ? "Customer Payment" : "Invoice");
  const invoiceTypeHint = isOwnerClaim
    ? "This record tracks the owner's payout after the customer payment has been confirmed."
    : (invNumUpper.startsWith("INV-") ? "Customer payment record (booking paid)" : "");
  const related = (inv.relatedInvoices || []).find((r) => {
    const n = String(r.invoiceNumber ?? "").toUpperCase();
    if (!n) return false;
    return isOwnerClaim ? n.startsWith("INV-") : n.startsWith("OINV-");
  }) ?? (inv.relatedInvoices || [])[0] ?? null;
  const ownerValidated = !!inv.ownerValidation?.validated;
  const ownerValidatedAt = inv.ownerValidation?.validatedAt ?? null;
  const tourCode = String(
    inv.bookingCode ||
    (inv as any)?.booking?.code?.codeVisible ||
    (inv as any)?.booking?.code?.code ||
    (inv as any)?.booking?.code?.codeHash ||
    ""
  ).trim();
  const normalizedStatus = String(inv.status || "").toUpperCase();
  const isSuccessfulCompletion = normalizedStatus === "PAID" || normalizedStatus === "DISBURSED" || !!inv.paidAt;
  const linkedReceiptDisplay = String(related?.receiptNumber || related?.paymentRef || "").trim();
  const receiptDisplay = String(inv.receiptNumber || inv.paymentRef || linkedReceiptDisplay || "").trim();

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 min-w-0">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <Link
              href="/admin/revenue"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              title="Back to revenue"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-[#02665e]" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
                  {inv.invoiceNumber ?? `Invoice #${inv.id}`}
                </h1>
              </div>
              <div className="mt-2">
                {getStatusBadge(inv.status, inv)}
              </div>
              <div className="mt-2 text-xs sm:text-sm text-gray-600">
                Type: <span className="font-medium text-gray-800" title={invoiceTypeHint}>{invoiceTypeLabel}</span>
              </div>
              {tourCode && (
                <div className="mt-2 inline-flex min-w-0 flex-col rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className={`text-base sm:text-lg font-black tracking-wide break-words ${isSuccessfulCompletion ? "text-[#02665e]" : "text-gray-900"}`}>
                    {tourCode}
                  </span>
                  {receiptDisplay ? (
                    <span className="mt-0.5 text-sm font-semibold text-[#02665e] break-words">
                      Receipt: {receiptDisplay}
                    </span>
                  ) : null}
                </div>
              )}
              {related && (
                <div className="mt-2 text-xs sm:text-sm text-gray-600">
                  {isOwnerClaim ? "Customer payment invoice" : "Owner claim invoice"}:{" "}
                  <Link href={`/admin/revenue/${related.id}`} className="text-[#02665e] hover:underline">
                    {related.invoiceNumber ?? `Invoice #${related.id}`}
                  </Link>{" "}
                  <span className="text-gray-500">({String(related.status || "").toUpperCase() || "—"})</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Invoice Details */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Invoice Information Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-start gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Receipt className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Invoice Information</h2>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Property</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900 truncate">{inv.booking.property.title}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Issued Date</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="font-semibold text-sm text-gray-900">
                        {new Date(inv.issuedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 ml-6 mt-0.5">
                      {new Date(inv.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                  {tourCode ? (
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Tour Code</div>
                      <div className={`text-lg font-black tracking-wide break-words ${isSuccessfulCompletion ? "text-[#02665e]" : "text-gray-900"}`}>
                        {tourCode}
                      </div>
                      {receiptDisplay ? (
                        <div className="mt-1 text-sm font-semibold text-[#02665e] break-words">
                          Receipt: {receiptDisplay}
                        </div>
                      ) : null}
                    </div>
                  ) : receiptDisplay ? (
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Receipt Number</div>
                      <div className="flex items-center gap-2 min-w-0">
                        <Receipt className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-sm text-gray-900 truncate">{receiptDisplay}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0"></div>
                  )}
                  {inv.paidAt ? (
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{paidStatusLabel(inv)} Date</div>
                      <div className="flex items-center gap-2 min-w-0">
                        <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-sm text-gray-900">
                          {new Date(inv.paidAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6 mt-0.5">
                        {new Date(inv.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0"></div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Financial Details Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-start gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Financial Details</h2>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
                    <span className="text-xs sm:text-sm font-medium text-gray-700 truncate pr-2">Gross Amount</span>
                    <span className="text-base sm:text-lg font-bold text-gray-900 flex-shrink-0">{fmt(baseAmount)}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="p-3 sm:p-4 bg-blue-50 rounded-lg min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Commission</div>
                      <div className="text-xs sm:text-sm font-semibold text-blue-900">{commissionPercent}%</div>
                      <div className="text-base sm:text-lg font-bold text-blue-900 mt-1 break-words">{fmt(commissionAmount)}</div>
                    </div>
                    
                    <div className="p-3 sm:p-4 bg-purple-50 rounded-lg min-w-0">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Tax (on commission)</div>
                      <div className="text-xs sm:text-sm font-semibold text-purple-900">{taxPercent}%</div>
                      <div className="text-base sm:text-lg font-bold text-purple-900 mt-1 break-words">{fmt(taxAmount)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 sm:p-4 bg-emerald-50 rounded-lg border-2 border-emerald-200 min-w-0">
                    <span className="text-sm sm:text-base font-semibold text-emerald-900 truncate pr-2">
                      {isOwnerClaimInvoice(inv) ? "Customer Paid Total" : "Total Paid"}
                    </span>
                    <span className="text-xl sm:text-2xl font-bold text-emerald-900 flex-shrink-0 break-words">{fmt(grossTotal)}</span>
                  </div>

                  {(inv.paymentMethod || inv.receiptNumber) && (
                    <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-4">
                      {inv.paymentMethod && (
                        <div className="p-3 sm:p-4 bg-gray-50 rounded-lg min-w-0">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                            {completionLabel(inv)} Method
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <CreditCard className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <span className="font-semibold text-xs sm:text-sm text-gray-900 truncate">{inv.paymentMethod}</span>
                          </div>
                          {inv.accountNumber && (
                            <div className="mt-2 min-w-0">
                              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Account</div>
                              <span className="font-semibold text-xs sm:text-sm text-gray-900 font-mono break-words">
                                {maskAccountNumber(inv.accountNumber)}
                              </span>
                            </div>
                          )}
                          {inv.paymentRef && (
                            <div className="mt-2 min-w-0">
                              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                                {completionLabel(inv)} Reference
                              </div>
                              <span className="font-semibold text-xs sm:text-sm text-gray-900 break-words">{inv.paymentRef}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {inv.receiptNumber && (
                        <div className="p-3 sm:p-4 bg-gray-50 rounded-lg overflow-hidden">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Receipt QR</div>
                          <div className="flex items-center justify-center min-h-[160px] bg-white">
                            {inv.receiptQrDataUrl ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={inv.receiptQrDataUrl}
                                alt=""
                                className="w-full max-w-[160px] sm:max-w-[192px] aspect-square object-contain [image-rendering:pixelated]"
                              />
                            ) : (
                              <div className="text-center text-sm text-gray-500 px-4">
                                Receipt QR unavailable
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - Actions */}
        <div className="space-y-4 sm:space-y-6 min-w-0">
          <div className={`rounded-xl border p-4 sm:p-5 overflow-hidden ${ownerValidated ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/80'}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${ownerValidated ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                {ownerValidated ? <ShieldCheck className="h-5 w-5 text-emerald-700" /> : <AlertCircle className="h-5 w-5 text-amber-700" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900">Owner validation</h3>
                {ownerValidated ? (
                  <>
                    <p className="mt-1 text-sm text-emerald-900 font-medium">Validated</p>
                    {ownerValidatedAt && (
                      <p className="mt-1 text-xs text-emerald-800">
                        {new Date(ownerValidatedAt).toLocaleDateString()} at {new Date(ownerValidatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-amber-900 font-medium">Owner validation required</p>
                    <p className="mt-1 text-xs text-amber-800">Admin cannot verify or approve this invoice until the owner validates the booking code.</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {actionMessage && (
            <div className={`rounded-xl border p-4 overflow-hidden ${actionMessage.type === 'error' ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 ${actionMessage.type === 'error' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {actionMessage.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                </div>
                <p className={`text-sm ${actionMessage.type === 'error' ? 'text-rose-900' : 'text-emerald-900'}`}>{actionMessage.text}</p>
              </div>
            </div>
          )}

          {/* Saved payout details */}
          {(inv.ownerPayout?.payoutPreferred || inv.ownerPayout?.bankAccountNumber || inv.ownerPayout?.mobileMoneyNumber) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900">Saved payout details</h3>
                  {inv.ownerPayout?.payoutPreferred && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Preferred: {inv.ownerPayout.payoutPreferred === 'MOBILE_MONEY' ? 'Mobile Money' : 'Bank'}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Bank</div>
                  <div className="mt-0.5 font-semibold text-gray-900 break-words">{inv.ownerPayout?.bankName || 'Not provided'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Account number</div>
                  <div className="mt-0.5 font-mono font-semibold text-gray-900 break-all">{inv.ownerPayout?.bankAccountNumber ? maskAccountNumber(inv.ownerPayout.bankAccountNumber) : 'Not provided'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Mobile money{inv.ownerPayout?.mobileMoneyProvider ? ` (${inv.ownerPayout.mobileMoneyProvider})` : ''}
                  </div>
                  <div className="mt-0.5 font-mono font-semibold text-gray-900 break-all">{inv.ownerPayout?.mobileMoneyNumber ? maskAccountNumber(inv.ownerPayout.mobileMoneyNumber) : 'Not provided'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Verify Action */}
          {inv.status==="REQUESTED" && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">Verify</h3>
              </div>
              <div className="space-y-3 sm:space-y-4">
                <div className="min-w-0">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                    Verification Notes <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    className="w-full min-h-[100px] px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none text-sm sm:text-base box-border cursor-pointer"
                    placeholder="Click to auto-fill default verification message..."
                    value={notes}
                    onChange={e=>setNotes(e.target.value)}
                    onClick={() => {
                      if (!notes.trim()) {
                        setNotes(defaultVerificationMessage);
                      }
                    }}
                  />
                </div>
                <button
                  className="w-full px-4 py-2.5 sm:py-3 bg-blue-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  onClick={verify}
                  disabled={actionLoading || !ownerValidated}
                >
                  {actionLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Mark VERIFIED
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Approve Action */}
          {(inv.status==="VERIFIED" || inv.status==="REQUESTED") && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">
                  Approve
                  <span className="block text-xs font-normal text-gray-500 mt-0.5">Override rates optional</span>
                </h3>
              </div>
              <div className="space-y-3 sm:space-y-4">
                <div className="min-w-0">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                    Commission %
                    <span className="text-gray-400 font-normal ml-1 text-xs">(property rate: {commissionPercent}%)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm sm:text-base box-border cursor-not-allowed"
                    value={String(commissionPercent ?? 0)}
                    readOnly
                    disabled
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                    Tax %
                    <span className="text-gray-400 font-normal ml-1 text-xs">
                      (current: {taxPercent ? `${taxPercent}%` : '0%'})
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-sm sm:text-base box-border"
                    placeholder={taxPercent ? `${taxPercent}%` : '0%'}
                    value={overrideTax}
                    onChange={e=>setOverrideTax(e.target.value)}
                  />
                </div>
                <button
                  className="w-full px-4 py-2.5 sm:py-3 bg-emerald-600 text-white rounded-lg text-sm sm:text-base font-medium hover:bg-emerald-700 active:bg-emerald-800 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  onClick={approve}
                  disabled={actionLoading || !ownerValidated}
                >
                  {actionLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Approving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Mark Paid / Disbursed Action */}
          {inv.status==="APPROVED" && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Send className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900">Send payout</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Approved and ready to disburse through AzamPay.</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Payouts now go through the AzamPay disbursement queue, which verifies the payout account, requires finance OTP, and reconciles the transfer automatically. No manual reference is needed.
              </p>
              <Link
                href={`/admin/disbursements?sourceType=OWNER_INVOICE&sourceId=${inv.id}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 sm:py-3 text-sm sm:text-base font-medium text-white no-underline shadow-sm transition-all duration-200 hover:bg-emerald-700 active:bg-emerald-800"
              >
                <Send className="h-4 w-4" />
                Open in Disbursements
              </Link>
            </div>
          )}

          {/* Invoice History/Audit Trail */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <div className="flex items-center gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Clock className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Invoice History</h2>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">Audit trail of invoice status changes</p>
              </div>
            </div>
            <div className="space-y-3 sm:space-y-4">
              {/* Created */}
              <div className="flex items-start gap-3 p-3 sm:p-4 bg-gray-50 rounded-lg border-l-4 border-gray-400">
                <FileText className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">Invoice Created</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {new Date(inv.issuedAt).toLocaleDateString()} at {new Date(inv.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>
              </div>

              {/* Verified */}
              {ownerValidatedAt && (
                <div className="flex items-start gap-3 p-3 sm:p-4 bg-sky-50 rounded-lg border-l-4 border-sky-500">
                  <ShieldCheck className="h-4 w-4 text-sky-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">Owner Validated Booking</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {new Date(ownerValidatedAt).toLocaleDateString()} at {new Date(ownerValidatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {inv.ownerValidation?.code?.status && (
                      <div className="text-xs text-gray-500 mt-1">Code status: {inv.ownerValidation.code.status}</div>
                    )}
                  </div>
                </div>
              )}

              {inv.verifiedAt && (
                <div className="flex items-start gap-3 p-3 sm:p-4 bg-blue-50 rounded-lg border-l-4 border-blue-500">
                  <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">Verified</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {new Date(inv.verifiedAt).toLocaleDateString()} at {new Date(inv.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {inv.verifiedByUser && (
                      <div className="text-xs text-gray-500 mt-1">By: {inv.verifiedByUser.name || `User #${inv.verifiedByUser.id}`}</div>
                    )}
                    {inv.notes && (
                      <div className="text-xs text-gray-600 mt-2 p-2 bg-white rounded border border-gray-200">
                        <span className="font-medium">Notes:</span> {inv.notes}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Approved */}
              {inv.approvedAt && (
                <div className="flex items-start gap-3 p-3 sm:p-4 bg-emerald-50 rounded-lg border-l-4 border-emerald-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">Approved</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {new Date(inv.approvedAt).toLocaleDateString()} at {new Date(inv.approvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {inv.approvedByUser && (
                      <div className="text-xs text-gray-500 mt-1">By: {inv.approvedByUser.name || `User #${inv.approvedByUser.id}`}</div>
                    )}
                    {inv.invoiceNumber && (
                      <div className="text-xs text-gray-600 mt-2">
                        <span className="font-medium">Invoice #:</span> {inv.invoiceNumber}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Paid / Disbursed */}
              {inv.paidAt && (
                <div className="flex items-start gap-3 p-3 sm:p-4 bg-green-50 rounded-lg border-l-4 border-green-500">
                  <Receipt className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">{paidStatusLabel(inv)}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {new Date(inv.paidAt).toLocaleDateString()} at {new Date(inv.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {inv.paidByUser && (
                      <div className="text-xs text-gray-500 mt-1">By: {inv.paidByUser.name || `User #${inv.paidByUser.id}`}</div>
                    )}
                    {inv.paymentMethod && (
                      <div className="text-xs text-gray-600 mt-2">
                        <span className="font-medium">{completionLabel(inv)} Method:</span> {inv.paymentMethod}
                      </div>
                    )}
                    {inv.accountNumber && (
                      <div className="text-xs text-gray-600 mt-1">
                        <span className="font-medium">Account:</span> <span className="font-mono">{maskAccountNumber(inv.accountNumber)}</span>
                      </div>
                    )}
                    {inv.paymentRef && (
                      <div className="text-xs text-gray-600 mt-1">
                        <span className="font-medium">{completionLabel(inv)} Reference:</span> {inv.paymentRef}
                      </div>
                    )}
                    {inv.receiptNumber && (
                      <div className="text-xs text-gray-600 mt-1">
                        <span className="font-medium">Receipt #:</span> {inv.receiptNumber}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(n:any){ 
  return new Intl.NumberFormat(undefined,{style:"currency",currency:"TZS"}).format(Number(n||0)); 
}

function maskAccountNumber(account?: string | null): string | null {
  if (!account) return null;

  const cleaned = String(account).trim().replace(/[\s\-\(\)]/g, "");
  const digits = cleaned.replace(/\D/g, "");

  const maskMiddle = (value: string, startVisible: number, endVisible: number): string => {
    if (!value) return value;
    if (value.length <= startVisible + endVisible) return value;
    const start = value.slice(0, startVisible);
    const end = value.slice(-endVisible);
    const middleLen = value.length - startVisible - endVisible;
    return `${start}${"*".repeat(middleLen)}${end}`;
  };

  // Phone numbers: show first 3 + last 2, mask the middle.
  const looksLikePhonePrefix = /^(0|255|\+255|254|\+254)/.test(cleaned);
  const looksLikePhoneDigits = digits.length >= 9 && digits.length <= 12;
  const isPhoneNumber = looksLikePhonePrefix || looksLikePhoneDigits;

  if (isPhoneNumber) {
    let localNumber = digits;
    if (localNumber.startsWith("255") || localNumber.startsWith("254")) {
      localNumber = "0" + localNumber.slice(3);
    }
    if (!localNumber.startsWith("0") && localNumber.length >= 9) {
      localNumber = "0" + localNumber;
    }
    if (localNumber.length > 10 && localNumber.startsWith("0")) {
      localNumber = localNumber.slice(0, 10);
    }
    const basePhone = localNumber || digits || cleaned;
    return maskMiddle(basePhone, 3, 2);
  }

  // Bank account (or other account identifiers): show first 3 + last 3, mask the middle.
  const baseAccount = digits.length >= 6 ? digits : (cleaned || String(account).trim());
  return maskMiddle(baseAccount, 3, 3);
}
