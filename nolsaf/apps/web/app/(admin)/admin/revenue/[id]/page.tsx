"use client";
import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Building2, Calendar, CheckCircle2, Clock, Receipt, AlertCircle, ShieldCheck, Send, Mail, MessageSquare } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Inv = {
  id:number; invoiceReference:string; invoiceNumber:string|null; receiptNumber:string|null; status:string; bookingCode?: string | null;
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
  relatedInvoices?: Array<{ id: number; invoiceReference: string; invoiceNumber: string | null; status: string; revenueVisible: boolean; receiptNumber?: string | null; paymentRef?: string | null; paidAt?: string | null }>;
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

const invoiceLoadCache = new Map<string, { promise: Promise<Inv>; expiresAt: number }>();

function fetchInvoiceOnce(endpoint: string): Promise<Inv> {
  const now = Date.now();
  const cached = invoiceLoadCache.get(endpoint);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = api.get<Inv>(endpoint).then((response) => response.data);
  const entry = { promise, expiresAt: now + 1_000 };
  invoiceLoadCache.set(endpoint, entry);
  void promise.catch(() => {
    if (invoiceLoadCache.get(endpoint) === entry) invoiceLoadCache.delete(endpoint);
  });
  return promise;
}

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
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  const invoiceReference = String(Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id || "").trim();
  const isNumericReference = /^\d+$/.test(invoiceReference);
  const detailEndpoint = isNumericReference
    ? `/api/admin/revenue/invoices/${invoiceReference}`
    : `/api/admin/revenue/invoices/by-reference/${encodeURIComponent(invoiceReference)}`;
  const [inv, setInv] = useState<Inv| null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [overrideTax, setOverrideTax] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const [reminderLoading, setReminderLoading] = useState<"EMAIL" | "SMS" | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [openAction, setOpenAction] = useState<"verify" | "approve" | null>(null);
  
  const defaultVerificationMessage = "Invoice verified and approved for processing.";

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const data = fresh ? (await api.get<Inv>(detailEndpoint)).data : await fetchInvoiceOnce(detailEndpoint);
      setInv(data);
      if (isNumericReference && data.invoiceReference) {
        router.replace(`/admin/revenue/${encodeURIComponent(data.invoiceReference)}`, { scroll: false });
      }
      setActionMessage(null);
    } catch (err: any) {
      console.error("Failed to load invoice:", err);
    } finally {
      setLoading(false);
    }
  }, [detailEndpoint, isNumericReference, router]);

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
      await api.post(`/api/admin/revenue/invoices/${inv.id}/verify`, { notes: verificationNotes });
      await load(true);
      setNotes("");
      setOpenAction(null);
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
      await api.post(`/api/admin/revenue/invoices/${inv.id}/approve`, {
        taxPercent: overrideTax===""? undefined : Number(overrideTax),
      });
      await load(true);
      setOverrideTax("");
      setOpenAction(null);
      setActionMessage({ type: "success", text: "Invoice approved successfully." });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setActionMessage({ type: "error", text: detail || err?.response?.data?.error || "Failed to approve invoice" });
    } finally {
      setActionLoading(false);
    }
  }

  async function remindOwner(channel: "EMAIL" | "SMS") {
    if (!inv || reminderLoading) return;
    setReminderLoading(channel);
    setActionMessage(null);
    try {
      const response = await api.post<{ message?: string }>(`/api/admin/revenue/invoices/${inv.id}/remind-payout`, { channel });
      setActionMessage({ type: "success", text: response.data?.message || `${channel === "EMAIL" ? "Email" : "SMS"} reminder sent to the owner.` });
    } catch (err: any) {
      setActionMessage({ type: "error", text: err?.response?.data?.error || `Could not send ${channel === "EMAIL" ? "email" : "SMS"} reminder.` });
    } finally {
      setReminderLoading(null);
    }
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

  const longDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const timeOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  const validationRequired = inv.ownerValidation?.required !== false;
  const isPaidOut = isSuccessfulCompletion;

  const STATUS_LOOK: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    DRAFT: { label: "Draft", cls: "border-neutral-200 bg-neutral-50 text-neutral-700", Icon: FileText },
    REQUESTED: { label: "Requested", cls: "border-amber-200 bg-amber-50 text-amber-800", Icon: Clock },
    VERIFIED: { label: "Verified", cls: "border-sky-200 bg-sky-50 text-sky-800", Icon: ShieldCheck },
    APPROVED: { label: "Approved", cls: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 },
    PAID: { label: paidStatusLabel(inv), cls: "border-emerald-300 bg-emerald-100 text-emerald-900", Icon: CheckCircle2 },
    DISBURSED: { label: "Disbursed", cls: "border-emerald-300 bg-emerald-100 text-emerald-900", Icon: CheckCircle2 },
    REJECTED: { label: "Rejected", cls: "border-rose-200 bg-rose-50 text-rose-800", Icon: FileText },
  };
  const look = STATUS_LOOK[normalizedStatus] ?? {
    label: normalizedStatus ? normalizedStatus.charAt(0) + normalizedStatus.slice(1).toLowerCase().replace(/_/g, " ") : "Unknown",
    cls: "border-neutral-200 bg-neutral-50 text-neutral-700",
    Icon: FileText,
  };

  // Owner payout claims walk five stages; customer payment invoices only two
  const pipeline = isOwnerClaim
    ? [
        { key: "validated", label: "Owner validated", at: ownerValidatedAt, done: ownerValidated || !validationRequired },
        { key: "requested", label: "Requested", at: inv.issuedAt, done: true },
        { key: "verified", label: "Verified", at: inv.verifiedAt ?? null, done: Boolean(inv.verifiedAt) || ["VERIFIED", "APPROVED", "PAID", "DISBURSED"].includes(normalizedStatus) },
        { key: "approved", label: "Approved", at: inv.approvedAt ?? null, done: Boolean(inv.approvedAt) || ["APPROVED", "PAID", "DISBURSED"].includes(normalizedStatus) },
        { key: "paid", label: paidStatusLabel(inv), at: inv.paidAt ?? null, done: isPaidOut },
      ]
    : [
        { key: "issued", label: "Issued", at: inv.issuedAt, done: true },
        { key: "paid", label: "Paid", at: inv.paidAt ?? null, done: isPaidOut },
      ];
  const firstOpen = pipeline.findIndex((s) => !s.done);
  let leadingDone = 0;
  while (leadingDone < pipeline.length && pipeline[leadingDone].done) leadingDone += 1;

  const scrollToActions = (which: "verify" | "approve") => {
    setOpenAction(which);
    window.setTimeout(() => document.getElementById("invoice-actions")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const nextStep: { tone: "slate" | "amber" | "teal" | "green"; title: string; text: string; cta?: { label: string; run?: () => void; href?: string } } =
    isPaidOut
      ? { tone: "green", title: isOwnerClaim ? "Paid out to the owner" : "Paid by the customer", text: receiptDisplay ? `Receipt ${receiptDisplay}.` : "Nothing left to do." }
      : isOwnerClaim && validationRequired && !ownerValidated
        ? { tone: "amber", title: "Waiting for the owner", text: "The owner must validate the booking code before you can verify or approve this claim." }
        : normalizedStatus === "REQUESTED"
          ? { tone: "amber", title: "Verify this claim", text: "Owner validated. Check the booking and the amounts.", cta: { label: "Verify now", run: () => scrollToActions("verify") } }
          : normalizedStatus === "VERIFIED"
            ? { tone: "amber", title: "Approve the payout", text: "Verified and waiting for your approval.", cta: { label: "Approve now", run: () => scrollToActions("approve") } }
            : normalizedStatus === "APPROVED"
              ? { tone: "teal", title: "Send the payout", text: "Approved. Pay the owner through the AzamPay disbursement queue.", cta: { label: "Go to disbursements", href: `/admin/disbursements?sourceType=OWNER_INVOICE&sourceId=${inv.id}` } }
              : { tone: "slate", title: look.label, text: "No action is needed on this invoice right now." };
  const NEXT_TONES = {
    slate: { box: "border-neutral-200 bg-neutral-50", eyebrow: "text-neutral-500", title: "text-neutral-900", text: "text-neutral-600", button: "border-neutral-300 text-neutral-800 hover:bg-white" },
    amber: { box: "border-amber-200 bg-amber-50", eyebrow: "text-amber-700", title: "text-amber-950", text: "text-amber-800", button: "border-amber-300 text-amber-900 hover:bg-amber-100" },
    teal: { box: "border-emerald-200 bg-emerald-50", eyebrow: "text-emerald-700", title: "text-emerald-950", text: "text-emerald-800", button: "border-emerald-300 text-emerald-900 hover:bg-emerald-100" },
    green: { box: "border-emerald-200 bg-emerald-50", eyebrow: "text-emerald-700", title: "text-emerald-950", text: "text-emerald-800", button: "border-emerald-300 text-emerald-900 hover:bg-emerald-100" },
  } as const;
  const nextTone = NEXT_TONES[nextStep.tone];

  const ownerShare = grossTotal > 0 ? Math.min(100, Math.round((baseAmount / grossTotal) * 100)) : 0;
  const commissionShare = grossTotal > 0 ? Math.min(100 - ownerShare, Math.round((commissionAmount / grossTotal) * 100)) : 0;
  const canVerify = normalizedStatus === "REQUESTED";
  const canApprove = normalizedStatus === "VERIFIED" || normalizedStatus === "REQUESTED";
  const blocked = isOwnerClaim && validationRequired && !ownerValidated;
  const CARD = "min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]";
  const payout = inv.ownerPayout;
  const hasPayoutDetails = Boolean(payout?.payoutPreferred || payout?.bankAccountNumber || payout?.mobileMoneyNumber);
  const payoutReady = payout?.payoutPreferred === "BANK"
    ? Boolean(payout.bankName && payout.bankAccountNumber)
    : payout?.payoutPreferred === "MOBILE_MONEY"
      ? Boolean(payout.mobileMoneyProvider && payout.mobileMoneyNumber)
      : false;
  const needsPayoutReminder = isOwnerClaim && !isPaidOut && !payoutReady;
  const showDisbursementStamp = isOwnerClaim && isSuccessfulCompletion;
  const disbursementRecipient = payout?.bankAccountName || inv.booking.property.title;
  const recordedPaymentMethod = String(inv.paymentMethod || "").trim();
  const normalizedPaymentMethod = recordedPaymentMethod.toUpperCase().replace(/[\s-]+/g, "_");
  const recordedChannel = normalizedPaymentMethod === "BANK"
    ? "Bank transfer"
    : normalizedPaymentMethod === "MOBILE_MONEY"
      ? "Mobile money"
      : recordedPaymentMethod;
  // A completed payout must describe the transaction that actually happened.
  // Owner payout settings are a current preference and may have changed afterwards.
  const disbursementChannel = recordedChannel || (payout?.payoutPreferred === "MOBILE_MONEY"
    ? [payout.mobileMoneyProvider, "Mobile money preference"].filter(Boolean).join(" · ")
    : payout?.payoutPreferred === "BANK"
      ? [payout.bankName, "Bank preference"].filter(Boolean).join(" · ")
      : "Recorded payout");
  const disbursementDestination = inv.accountNumber
    ? maskAccountNumber(inv.accountNumber)
    : recordedPaymentMethod
      ? "Not recorded"
      : payout?.payoutPreferred === "MOBILE_MONEY"
        ? maskAccountNumber(payout.mobileMoneyNumber)
        : payout?.payoutPreferred === "BANK"
          ? maskAccountNumber(payout.bankAccountNumber)
          : "";

  const history: Array<{ key: string; title: string; at: string; Icon: typeof CheckCircle2; by?: string | null; lines?: string[] }> = [
    { key: "created", title: isOwnerClaim ? "Claim created" : "Invoice issued", at: inv.issuedAt, Icon: FileText },
    ...(ownerValidatedAt ? [{ key: "validated", title: "Owner validated the booking", at: ownerValidatedAt, Icon: ShieldCheck, lines: inv.ownerValidation?.code?.status ? [`Code status: ${inv.ownerValidation.code.status.toLowerCase()}`] : [] }] : []),
    ...(inv.verifiedAt ? [{ key: "verified", title: "Verified", at: inv.verifiedAt, Icon: CheckCircle2, by: inv.verifiedByUser ? inv.verifiedByUser.name || `User #${inv.verifiedByUser.id}` : null, lines: inv.notes ? [inv.notes] : [] }] : []),
    ...(inv.approvedAt ? [{ key: "approved", title: "Approved", at: inv.approvedAt, Icon: CheckCircle2, by: inv.approvedByUser ? inv.approvedByUser.name || `User #${inv.approvedByUser.id}` : null }] : []),
    ...(inv.paidAt
      ? [{
          key: "paid",
          title: paidStatusLabel(inv),
          at: inv.paidAt,
          Icon: Receipt,
          by: inv.paidByUser ? inv.paidByUser.name || `User #${inv.paidByUser.id}` : null,
          lines: [
            inv.paymentMethod ? `${completionLabel(inv)} method: ${inv.paymentMethod}` : "",
            inv.accountNumber ? `Account: ${maskAccountNumber(inv.accountNumber)}` : "",
            inv.paymentRef ? `Reference: ${inv.paymentRef}` : "",
            inv.receiptNumber ? `Receipt: ${inv.receiptNumber}` : "",
          ].filter(Boolean),
        }]
      : []),
  ];

  return (
    <div id="revenue-invoice" className="space-y-4 min-w-0 w-full">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#revenue-invoice, #revenue-invoice * { box-sizing: border-box; }`}</style>

      {/* Hero */}
      <section className={`${CARD} ${showDisbursementStamp ? "!overflow-visible" : ""}`}>
        <div className={`grid min-w-0 gap-5 p-4 sm:p-5 ${showDisbursementStamp ? "lg:grid-cols-[minmax(0,1fr)_236px] lg:items-center" : "lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center"}`}>
          <div className="min-w-0">
            <Link href="/admin/revenue" className="inline-flex items-center gap-1 text-[11px] font-bold text-neutral-400 no-underline transition hover:text-emerald-700">
              <ArrowLeft className="h-3 w-3" aria-hidden /> Revenue
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="m-0 break-all font-mono text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">{inv.invoiceNumber ?? `Invoice #${inv.id}`}</h1>
              {!showDisbursementStamp ? (
                <span className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-[11px] font-bold ${look.cls}`}>
                  <look.Icon className="h-3.5 w-3.5" aria-hidden /> {look.label}
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-1 text-sm text-neutral-600" title={invoiceTypeHint}>
              <span className="font-semibold text-neutral-800">{isOwnerClaim ? "Owner payout claim" : invoiceTypeLabel}</span>
              {" for "}
              <span className="font-semibold text-neutral-800">{inv.booking.property.title}</span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px]">
              {tourCode ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-2 py-1 font-mono font-bold text-neutral-800">
                  <Building2 className="h-3.5 w-3.5 text-neutral-400" aria-hidden /> {tourCode}
                </span>
              ) : null}
              {related?.revenueVisible ? (
                <Link
                  href={`/admin/revenue/${encodeURIComponent(related.invoiceReference)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-200 bg-emerald-50/60 px-2 py-1 font-semibold text-emerald-800 no-underline transition hover:bg-emerald-50"
                >
                  <Receipt className="h-3.5 w-3.5" aria-hidden />
                  {isOwnerClaim ? "Customer payment" : "Owner claim"} {related.invoiceNumber ?? `#${related.id}`}
                  <span className="text-emerald-700/70">· {String(related.status || "").toLowerCase() || "unknown"}</span>
                </Link>
              ) : related ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-2 py-1 font-semibold text-neutral-600"
                  title="This related customer record is not available in Revenue until it is paid"
                >
                  <Receipt className="h-3.5 w-3.5" aria-hidden />
                  {isOwnerClaim ? "Customer payment" : "Owner claim"} {related.invoiceNumber || "record"}
                  <span className="text-neutral-400">· {String(related.status || "").toLowerCase() || "not available"}</span>
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 text-neutral-500"><Calendar className="h-3.5 w-3.5" aria-hidden /> Issued {longDate(inv.issuedAt)}</span>
            </div>

            {/* Payout record: what the seal certifies, in readable print */}
            {showDisbursementStamp ? (
              <div className="mt-4 flex min-w-0 flex-col gap-3 rounded-xl border border-solid border-emerald-100 bg-emerald-50/40 p-3 sm:flex-row sm:items-center">
                {inv.receiptQrDataUrl ? (
                  <span className="shrink-0 self-start rounded-lg border border-solid border-emerald-200 bg-white p-1 sm:self-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inv.receiptQrDataUrl} alt="Receipt QR" className="h-[72px] w-[72px] object-contain [image-rendering:pixelated]" />
                  </span>
                ) : null}
                <dl className="m-0 grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 text-[12px] leading-snug xl:grid-cols-3">
                  <div className="min-w-0"><dt className="text-[11px] text-neutral-500">Paid out</dt><dd className="m-0 font-black tabular-nums text-emerald-700">{fmt(baseAmount)}</dd></div>
                  <div className="min-w-0"><dt className="text-[11px] text-neutral-500">Channel</dt><dd className="m-0 truncate font-semibold text-neutral-900">{disbursementChannel}</dd></div>
                  <div className="min-w-0"><dt className="text-[11px] text-neutral-500">Sent to</dt><dd className="m-0 truncate font-mono font-semibold text-neutral-900">{disbursementDestination || "Recorded"}</dd></div>
                  {inv.receiptNumber ? <div className="min-w-0"><dt className="text-[11px] text-neutral-500">Receipt</dt><dd className="m-0 truncate font-mono font-semibold text-neutral-900">{inv.receiptNumber}</dd></div> : null}
                  <div className="min-w-0"><dt className="text-[11px] text-neutral-500">Recorded</dt><dd className="m-0 truncate font-semibold text-neutral-900">{longDate(inv.paidAt)}, {timeOf(inv.paidAt)} · {inv.paidByUser?.name || "NoLSAF Finance"}</dd></div>
                  {inv.paymentRef ? <div className="min-w-0"><dt className="text-[11px] text-neutral-500">Reference</dt><dd className="m-0 break-all font-mono text-[11px] font-semibold text-neutral-900">{inv.paymentRef}</dd></div> : null}
                </dl>
              </div>
            ) : null}
          </div>

          {showDisbursementStamp ? (
            <div className="flex min-w-0 justify-center lg:justify-end">
              {/* The seal: a few bold facts only, drawn as one SVG so nothing collides */}
              <svg
                viewBox="0 0 320 320"
                role="img"
                aria-label={`Disbursed ${fmt(baseAmount)} to ${disbursementRecipient} on ${longDate(inv.paidAt)}`}
                className="h-auto w-full max-w-[224px] text-emerald-800 opacity-90 mix-blend-multiply lg:-my-3"
              >
                <defs>
                  {/* Worn ink: fractal noise punches small gaps into the print */}
                  <filter id={`seal-ink-${inv.id}`} x="-5%" y="-5%" width="110%" height="110%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="1" seed="11" result="noise" />
                    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -9 0 0 0 7.2" result="speckle" />
                    <feComposite in="SourceGraphic" in2="speckle" operator="in" />
                  </filter>
                  <path id={`seal-top-${inv.id}`} d="M 42 160 A 118 118 0 0 1 278 160" />
                  <path id={`seal-bottom-${inv.id}`} d="M 25 160 A 135 135 0 0 0 295 160" />
                </defs>
                <g transform="rotate(-6 160 160)" filter={`url(#seal-ink-${inv.id})`} fill="currentColor" stroke="currentColor">
                  {/* Rings */}
                  <circle cx="160" cy="160" r="152" fill="none" strokeWidth="5" />
                  <circle cx="160" cy="160" r="144" fill="none" strokeWidth="1.4" />
                  <circle cx="160" cy="160" r="108" fill="none" strokeWidth="1.8" />

                  {/* Ring text */}
                  <text stroke="none" fontSize="11.5" fontWeight="900" letterSpacing="1.5" fontFamily="inherit">
                    <textPath href={`#seal-top-${inv.id}`} startOffset="50%" textAnchor="middle">NOLSAF FINANCE • OFFICIAL PAYOUT</textPath>
                  </text>
                  <text stroke="none" fontSize="11" fontWeight="800" letterSpacing="2" fontFamily="inherit">
                    <textPath href={`#seal-bottom-${inv.id}`} startOffset="50%" textAnchor="middle">
                      {`TANZANIA • ${(longDate(inv.paidAt) || "").toUpperCase()}`}
                    </textPath>
                  </text>
                  <circle cx="34" cy="160" r="3.2" stroke="none" />
                  <circle cx="286" cy="160" r="3.2" stroke="none" />

                  {/* Seal mark */}
                  <circle cx="160" cy="82" r="12" fill="none" strokeWidth="2" />
                  <path d="M 154 82 L 158.5 86.5 L 166.5 77.5" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  <text x="160" y="113" stroke="none" fontSize="9" fontWeight="800" letterSpacing="3" textAnchor="middle" fontFamily="inherit">SEALED · RECORDED</text>

                  {/* Banner across the seal */}
                  <rect x="22" y="124" width="276" height="50" rx="3" fill="#ffffff" strokeWidth="3" />
                  <rect x="28" y="130" width="264" height="38" rx="2" fill="none" strokeWidth="1" />
                  <text x="160" y="160" stroke="none" fontSize="29" fontWeight="900" letterSpacing="5" textAnchor="middle" fontFamily="inherit">DISBURSED</text>

                  {/* Amount, claim and recipient */}
                  <text x="160" y="203" stroke="none" fontSize="21" fontWeight="900" textAnchor="middle" fontFamily="inherit">
                    {`TSh ${Math.round(baseAmount).toLocaleString("en-US")}`}
                  </text>
                  <text x="160" y="223" stroke="none" fontSize="9.5" fontWeight="700" letterSpacing="0.6" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
                    {inv.invoiceNumber || `CLAIM-${inv.id}`}
                  </text>
                  <text x="160" y="241" stroke="none" fontSize="9" fontWeight="800" letterSpacing="1.4" textAnchor="middle" fontFamily="inherit">
                    {(() => {
                      const who = String(disbursementRecipient || "").toUpperCase();
                      return `TO ${who.length > 24 ? `${who.slice(0, 23)}…` : who}`;
                    })()}
                  </text>
                </g>
              </svg>

            </div>
          ) : (
            <div className={`min-w-0 rounded-xl border border-solid p-3.5 ${nextTone.box}`}>
              <p className={`m-0 text-[10px] font-bold uppercase tracking-[0.12em] ${nextTone.eyebrow}`}>{nextStep.tone === "green" ? "Outcome" : "Next step"}</p>
              <p className={`m-0 mt-1 text-[14px] font-bold leading-snug ${nextTone.title}`}>{nextStep.title}</p>
              <p className={`m-0 mt-0.5 break-words text-[12px] leading-snug ${nextTone.text}`}>{nextStep.text}</p>
              {nextStep.cta?.href ? (
                <Link href={nextStep.cta.href} className={`mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-solid bg-white px-3 py-1.5 text-[12px] font-bold no-underline transition ${nextTone.button}`}>
                  {nextStep.cta.label} <Send className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ) : nextStep.cta?.run ? (
                <button type="button" onClick={nextStep.cta.run} className={`mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid bg-white px-3 py-1.5 text-[12px] font-bold transition ${nextTone.button}`}>
                  {nextStep.cta.label}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Pipeline */}
        <ol
          className="relative m-0 grid list-none border-0 border-t border-solid border-neutral-100 px-1 py-4 sm:px-5"
          style={{ gridTemplateColumns: `repeat(${pipeline.length}, minmax(0, 1fr))` }}
        >
          <span className="absolute top-[30px] h-0.5 rounded-full bg-neutral-200" style={{ left: `${50 / pipeline.length}%`, right: `${50 / pipeline.length}%` }} aria-hidden />
          <span
            className="absolute top-[30px] h-0.5 rounded-full bg-emerald-600 transition-all duration-500"
            style={{ left: `${50 / pipeline.length}%`, width: `${(Math.max(0, leadingDone - 1) / Math.max(1, pipeline.length - 1)) * (100 - 100 / pipeline.length)}%` }}
            aria-hidden
          />
          {pipeline.map((stage, i) => {
            const current = i === firstOpen;
            return (
              <li key={stage.key} className="relative flex min-w-0 flex-col items-center px-0.5 text-center">
                <span
                  className={[
                    "inline-flex h-7 w-7 items-center justify-center rounded-full",
                    stage.done ? "bg-emerald-600 text-white" : current ? "border-2 border-solid border-amber-400 bg-amber-50 text-amber-700" : "border-2 border-solid border-neutral-200 bg-white",
                  ].join(" ")}
                >
                  {stage.done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : current ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />}
                </span>
                <span className="mt-1.5 text-[12px] font-bold leading-tight text-neutral-800">{stage.label}</span>
                <span className={`text-[11px] leading-tight ${current ? "text-amber-700" : "text-neutral-400"}`}>{stage.at && stage.done ? longDate(stage.at) : current ? "Waiting" : ""}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* Money */}
          <section className={CARD}>
            <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Money</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">What the guest paid and how it splits</p>
            </div>
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="m-0 text-[11px] font-semibold text-neutral-500">{isOwnerClaim ? "Guest paid" : "Total paid"}</p>
                  <p className="m-0 mt-0.5 text-2xl font-black tabular-nums tracking-tight text-neutral-950">{fmt(grossTotal)}</p>
                </div>
                <div className="text-right">
                  <p className="m-0 text-[11px] font-semibold text-neutral-500">Owner payout</p>
                  <p className="m-0 mt-0.5 text-2xl font-black tabular-nums tracking-tight text-emerald-700">{fmt(baseAmount)}</p>
                </div>
              </div>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                <span className="bg-emerald-600" style={{ width: `${ownerShare}%` }} />
                <span className="bg-violet-500" style={{ width: `${commissionShare}%` }} />
              </div>
              <dl className="m-0 mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-neutral-50/80 px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden /> Owner</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black tabular-nums text-neutral-900">{fmt(baseAmount)}</dd>
                  <dd className="m-0 text-[11px] text-neutral-400">{ownerShare}% of what the guest paid</dd>
                </div>
                <div className="rounded-xl bg-neutral-50/80 px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden /> NoLSAF commission</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black tabular-nums text-neutral-900">{fmt(commissionAmount)}</dd>
                  <dd className="m-0 text-[11px] text-neutral-400">{commissionPercent}% rate</dd>
                </div>
                <div className="rounded-xl bg-neutral-50/80 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold text-neutral-500">Tax on commission</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black tabular-nums text-neutral-900">{fmt(taxAmount)}</dd>
                  <dd className="m-0 text-[11px] text-neutral-400">{taxPercent}% rate</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Receipt */}
          {isPaidOut && (inv.receiptNumber || inv.paymentRef || inv.paymentMethod) ? (
            <section className={CARD}>
              <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
                <h2 className="m-0 text-sm font-bold text-neutral-900">{completionLabel(inv)} receipt</h2>
                <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Proof of where the money went</p>
              </div>
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                {inv.receiptQrDataUrl ? (
                  <div className="inline-flex self-start rounded-xl border border-solid border-neutral-200 bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={inv.receiptQrDataUrl} alt="" className="h-[150px] w-[150px] object-contain [image-rendering:pixelated]" />
                  </div>
                ) : null}
                <dl className="m-0 min-w-0 space-y-2 text-[13px]">
                  <div><dt className="text-[11px] font-semibold text-neutral-500">Amount</dt><dd className="m-0 font-black text-emerald-700">{fmt(isOwnerClaim ? baseAmount : grossTotal)}</dd></div>
                  {inv.paymentMethod ? <div><dt className="text-[11px] font-semibold text-neutral-500">Method</dt><dd className="m-0 break-words font-semibold text-neutral-900">{inv.paymentMethod}{inv.accountNumber ? ` · ${maskAccountNumber(inv.accountNumber)}` : ""}</dd></div> : null}
                  {inv.paymentRef ? <div><dt className="text-[11px] font-semibold text-neutral-500">Reference</dt><dd className="m-0 break-all font-mono font-semibold text-neutral-900">{inv.paymentRef}</dd></div> : null}
                  {inv.receiptNumber ? <div><dt className="text-[11px] font-semibold text-neutral-500">Receipt</dt><dd className="m-0 break-all font-mono font-semibold text-neutral-900">{inv.receiptNumber}</dd></div> : null}
                  {inv.paidAt ? <div><dt className="text-[11px] font-semibold text-neutral-500">Date</dt><dd className="m-0 font-semibold text-neutral-900">{longDate(inv.paidAt)}, {timeOf(inv.paidAt)}</dd></div> : null}
                </dl>
              </div>
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {/* Actions */}
          {!isPaidOut && isOwnerClaim ? (
            <section id="invoice-actions" className={CARD}>
              <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Actions</h2>
                <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Only what this claim allows right now</p>
              </div>
              <div className="space-y-2.5 p-4 sm:p-5">
                {needsPayoutReminder ? (
                  <div className="space-y-2.5 rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-3 text-[12.5px] text-amber-950">
                    <p className="m-0 flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>Owner must choose a preferred payout method and complete the bank or mobile-money details before this claim can be approved.</span>
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => void remindOwner("EMAIL")} disabled={Boolean(reminderLoading) || actionLoading} className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-amber-300 bg-white px-2.5 text-[12px] font-bold text-amber-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
                        <Mail className="h-3.5 w-3.5" aria-hidden /> {reminderLoading === "EMAIL" ? "Sending…" : "Remind by email"}
                      </button>
                      <button type="button" onClick={() => void remindOwner("SMS")} disabled={Boolean(reminderLoading) || actionLoading} className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-amber-300 bg-white px-2.5 text-[12px] font-bold text-amber-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {reminderLoading === "SMS" ? "Sending…" : "Remind by SMS"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {blocked ? (
                  <p className="m-0 flex items-start gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>The owner hasn&apos;t validated the booking code yet. Verify and approve unlock once they do.</span>
                  </p>
                ) : null}

                {actionMessage ? (
                  <p role="status" className={`m-0 flex items-start gap-2 rounded-xl border border-solid px-3 py-2.5 text-[12.5px] ${actionMessage.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                    {actionMessage.type === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                    <span>{actionMessage.text}</span>
                  </p>
                ) : null}

                {(canVerify || canApprove) && !blocked ? (
                  <>
                    {!openAction ? (
                      <div className="grid gap-2">
                        {canVerify ? (
                          <button type="button" onClick={() => setOpenAction("verify")} className="flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-3.5 py-2 text-[13px] font-bold text-white transition hover:bg-[#014d47]">
                            <ShieldCheck className="h-4 w-4" aria-hidden /> Verify
                          </button>
                        ) : null}
                        {canApprove ? (
                          <button
                            type="button"
                            onClick={() => setOpenAction("approve")}
                            className={canVerify
                              ? "flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3.5 py-2 text-[13px] font-bold text-neutral-700 transition hover:bg-neutral-50"
                              : "flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-3.5 py-2 text-[13px] font-bold text-white transition hover:bg-[#014d47]"}
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden /> {canVerify ? "Approve without verifying" : "Approve"}
                          </button>
                        ) : null}
                      </div>
                    ) : openAction === "verify" ? (
                      <div className="space-y-2.5 rounded-xl border border-solid border-emerald-200 bg-emerald-50/50 p-3">
                        <label htmlFor="invoice-verify-note" className="block text-[12.5px] font-bold text-neutral-800">
                          Verification note <span className="font-normal text-neutral-500">(optional)</span>
                        </label>
                        <textarea
                          id="invoice-verify-note"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={defaultVerificationMessage}
                          className="block min-h-[90px] w-full resize-y rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setOpenAction(null)} disabled={actionLoading} className="inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[12.5px] font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
                          <button type="button" onClick={() => void verify()} disabled={actionLoading} suppressHydrationWarning className="inline-flex min-h-9 flex-[2] cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-[12.5px] font-bold text-white transition hover:bg-[#014d47] disabled:opacity-50">
                            {actionLoading ? "Verifying…" : "Confirm verify"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5 rounded-xl border border-solid border-emerald-200 bg-emerald-50/50 p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="m-0 text-[11px] font-semibold text-neutral-500">Commission</p>
                            <p className="m-0 mt-0.5 text-[13px] font-bold text-neutral-900">{commissionPercent}% <span className="font-normal text-neutral-400">property rate</span></p>
                          </div>
                          <div>
                            <label htmlFor="invoice-tax-override" className="block text-[11px] font-semibold text-neutral-500">Tax % override</label>
                            <input
                              id="invoice-tax-override"
                              type="number"
                              step="0.01"
                              value={overrideTax}
                              onChange={(e) => setOverrideTax(e.target.value)}
                              placeholder={`${taxPercent || 0}`}
                              className="mt-0.5 block h-9 w-full rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-[13px] text-neutral-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                            />
                          </div>
                        </div>
                        <p className="m-0 text-[11px] text-neutral-500">Leave tax empty to keep the current {taxPercent || 0}%.</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setOpenAction(null)} disabled={actionLoading} className="inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[12.5px] font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
                          <button type="button" onClick={() => void approve()} disabled={actionLoading} suppressHydrationWarning className="inline-flex min-h-9 flex-[2] cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-[12.5px] font-bold text-white transition hover:bg-[#014d47] disabled:opacity-50">
                            {actionLoading ? "Approving…" : "Confirm approve"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}

                {normalizedStatus === "APPROVED" ? (
                  <Link
                    href={`/admin/disbursements?sourceType=OWNER_INVOICE&sourceId=${inv.id}`}
                    className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-3.5 py-2 text-[13px] font-bold text-white no-underline transition hover:bg-[#014d47]"
                  >
                    <Send className="h-4 w-4" aria-hidden /> Continue to disbursements
                  </Link>
                ) : null}

                {!canVerify && !canApprove && normalizedStatus !== "APPROVED" && !blocked ? (
                  <p className="m-0 rounded-xl bg-neutral-50 px-3 py-2.5 text-[12.5px] text-neutral-600">No action is available at this stage.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Payout destination */}
          {hasPayoutDetails ? (
            <section className={CARD}>
              <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Payout destination</h2>
                <p className="m-0 mt-0.5 text-[12px] text-neutral-500">
                  Owner prefers {payout?.payoutPreferred === "MOBILE_MONEY" ? "mobile money" : payout?.payoutPreferred === "BANK" ? "bank transfer" : "no method yet"}
                </p>
              </div>
              <dl className="m-0 space-y-2 p-4 text-[13px] sm:p-5">
                {[
                  { key: "BANK", label: payout?.bankName ? `Bank · ${payout.bankName}` : "Bank", value: payout?.bankAccountNumber ? maskAccountNumber(payout.bankAccountNumber) : null },
                  { key: "MOBILE_MONEY", label: payout?.mobileMoneyProvider ? `Mobile money · ${payout.mobileMoneyProvider}` : "Mobile money", value: payout?.mobileMoneyNumber ? maskAccountNumber(payout.mobileMoneyNumber) : null },
                ].map((row) => {
                  const preferred = payout?.payoutPreferred === row.key;
                  return (
                    <div key={row.key} className={`flex min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${preferred ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-neutral-50/80"}`}>
                      <dt className="min-w-0 truncate text-[12px] text-neutral-600">
                        {row.label}
                        {preferred ? <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 py-px text-[10px] font-bold text-white">Preferred</span> : null}
                      </dt>
                      <dd className={`m-0 shrink-0 font-mono text-[12.5px] font-semibold ${row.value ? "text-neutral-900" : "text-neutral-400"}`}>{row.value || "Not provided"}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}

          {/* History */}
          <section className={CARD}>
            <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
              <h2 className="m-0 text-sm font-bold text-neutral-900">History</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Every step this invoice went through</p>
            </div>
            <ol className="m-0 list-none p-4 sm:p-5">
              {history.map((item, idx) => (
                <li key={item.key} className="relative pb-4 pl-8 last:pb-0">
                  {idx < history.length - 1 ? <span className="absolute bottom-0 left-[11px] top-7 w-px bg-neutral-200" aria-hidden /> : null}
                  <span className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-1 ring-neutral-200">
                    <item.Icon className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                  </span>
                  <p className="m-0 text-[13px] font-bold text-neutral-900">{item.title}</p>
                  <p className="m-0 mt-0.5 text-[11px] text-neutral-400">
                    {longDate(item.at)}, {timeOf(item.at)}{item.by ? ` · ${item.by}` : ""}
                  </p>
                  {item.lines?.length ? (
                    <div className="mt-1 space-y-0.5 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11.5px] text-neutral-600">
                      {item.lines.map((line) => <p key={line} className="m-0 break-words">{line}</p>)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
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
