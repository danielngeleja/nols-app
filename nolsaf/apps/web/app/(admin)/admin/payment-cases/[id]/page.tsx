"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, BadgeCheck, CalendarDays, Check, CheckCircle2, CircleDashed, Clock, Copy, FileText,
  Loader2, Phone, Radio, RefreshCw, Send, ShieldAlert, ShieldQuestion, Undo2, UserRound, UserCog, Wrench, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import apiClient from "@/lib/apiClient";

type CaseDetail = {
  reference: string; status: string; resolution?: string | null; evidenceState: string; createdAt: string; updatedAt: string; customerReference?: string | null;
  booking: { adminReference: string; status: string; propertyTitle: string; guestName: string; guestPhoneMasked: string | null; checkIn: string; checkOut: string; amount: number; codeStatus: string | null; codeIssuedAt: string | null };
  invoices: Array<{ invoiceNumber: string; status: string; expectedAmount: number; paymentRef: string | null; receiptNumber: string | null; paidAt: string | null; createdAt: string; events: Array<{ eventId: string; provider: string; status: string; amount: number; currency: string; createdAt: string }> }>;
  timeline: Array<{ type: string; actorRole: string; note: string | null; metadata?: { channels?: string[]; destinationMasked?: string | null; paymentMethod?: string; approximatePaidAt?: string; payerPhoneLast4?: string; recordedAttempt?: boolean; statementProvider?: string; statementTransactionId?: string; releasedInvoices?: number } | null; createdAt: string }>;
};

type Source = "invoice" | "provider" | "traveller" | "staff" | "system";
type Tone = "emerald" | "amber" | "rose" | "sky" | "violet" | "slate";

const TZ = "Africa/Dar_es_Salaam";
const BUSY_STATUSES = ["REPAIRING", "SENDING_CODE"];
const SUCCESS_EVENTS = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID", "SETTLED"];
const FAILED_EVENTS = ["FAILED", "FAILURE", "CANCELLED", "CANCELED", "REJECTED", "EXPIRED", "DECLINED"];

const STATUS_TONE: Record<string, Tone> = {
  UNVERIFIED_REPORT: "violet", OPEN: "amber", AWAITING_PROVIDER: "sky", REPAIRING: "sky", SENDING_CODE: "sky",
  CODE_READY: "emerald", RESOLVED: "emerald", INVENTORY_CONFLICT: "rose", REFUND_REQUIRED: "rose",
};
const TONE_CHIP: Record<Tone, string> = {
  emerald: "bg-emerald-400/15 text-emerald-200", amber: "bg-amber-300/15 text-amber-200", rose: "bg-rose-400/15 text-rose-200",
  sky: "bg-sky-400/15 text-sky-200", violet: "bg-violet-400/15 text-violet-200", slate: "bg-white/10 text-white/70",
};
const TONE_TILE: Record<Tone, string> = {
  emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700",
  sky: "bg-sky-50 text-sky-700", violet: "bg-violet-50 text-violet-700", slate: "bg-slate-100 text-slate-600",
};
const SOURCE_META: Record<Source, { label: string; Icon: LucideIcon; dot: string; chip: string }> = {
  invoice: { label: "Invoice", Icon: FileText, dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700" },
  provider: { label: "Provider", Icon: Radio, dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800" },
  traveller: { label: "Traveller", Icon: UserRound, dot: "bg-violet-500", chip: "bg-violet-50 text-violet-800" },
  staff: { label: "Staff", Icon: UserCog, dot: "bg-[#02665e]", chip: "bg-[#02665e]/10 text-[#02665e]" },
  system: { label: "System", Icon: CircleDashed, dot: "bg-slate-300", chip: "bg-slate-100 text-slate-600" },
};

function errorText(cause: any) { return cause?.response?.data?.require2fa ? "Finance OTP verification is required. Unlock finance actions in the admin header, then retry." : cause?.response?.data?.error || "The action could not be completed."; }
function humanize(value?: string | null) { if (!value) return ""; const s = value.replace(/_/g, " ").toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
function eat(value?: string | null) {
  if (!value) return "Not recorded";
  return `${new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })} EAT`;
}
function eatDay(value: string) { return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }); }
function since(from: string, to: string | number = Date.now()) {
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}
function tsh(n: number) { return `TSh ${Number(n || 0).toLocaleString("en-US")}`; }

function CopyRef({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-solid border-white/15 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
      title={`Copy ${label}`}
    >
      <span className="text-white/45">{label}</span><span className="truncate">{value}</span>
      {done ? <Check className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden /> : <Copy className="h-3 w-3 shrink-0" aria-hidden />}
    </button>
  );
}

export default function PaymentCaseDetailPage() {
  const params = useParams();
  const reference = String(params.id || "");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<"all" | Source>("all");
  // Closing the case by hand: either no money arrived, or the provider's own
  // statement shows it did. Both need finance OTP and a written reason.
  const [closeMode, setCloseMode] = useState<"" | "not-paid" | "statement">("");
  const [closeNote, setCloseNote] = useState("");
  const [closeConfirmed, setCloseConfirmed] = useState(false);
  const [stmtProvider, setStmtProvider] = useState<"AZAMPAY" | "CORALCOMMERCE">("AZAMPAY");
  const [stmtTransaction, setStmtTransaction] = useState("");
  const [stmtAmount, setStmtAmount] = useState("");

  const load = useCallback(async () => {
    try { const { data } = await apiClient.get(`/api/admin/booking-payment-cases/${encodeURIComponent(reference)}`); setDetail(data.paymentCase); setError(""); }
    catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }, [reference]);
  useEffect(() => { if (reference) void load(); }, [reference, load]);

  const action = async (path: string, body?: object) => {
    if (!detail) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const { data } = await apiClient.post(`/api/admin/booking-payment-cases/${encodeURIComponent(detail.reference)}/${path}`, body || {});
      setSuccess(
        path === "check-payment" ? (data?.matched ? "A matching provider confirmation is recorded. Review the repair action." : "No matching provider confirmation is recorded. Follow up with the provider.")
        : path === "close-not-paid" ? `Case closed as not paid.${data?.releasedInvoices ? " The stuck invoice was released." : ""} The traveller was told no payment arrived.`
        : path === "confirm-statement" && data?.status === "REFUND_REQUIRED" ? "Payment recorded from the statement. The booking cannot be honoured, so the case moved to refund review."
        : data?.deliveredVia?.length ? `${path === "confirm-statement" ? "Payment recorded from the statement. " : ""}Confirmation sent via ${data.deliveredVia.join(" and ")}.`
        : path === "confirm-statement" ? "Payment recorded from the statement. The code is ready; resend it securely."
        : "Case updated.");
      setNote(""); setCloseMode(""); setCloseNote(""); setCloseConfirmed(false); setStmtTransaction(""); setStmtAmount("");
      await load();
    } catch (cause) { setError(errorText(cause)); await load(); }
    finally { setBusy(false); }
  };

  const evidence = useMemo(() => {
    if (!detail) return [];
    const rows: Array<{ key: string; at: string; source: Source; label: string; note: string; tone?: Tone }> = [];
    for (const invoice of detail.invoices) {
      rows.push({ key: `invoice-${invoice.invoiceNumber}`, at: invoice.createdAt, source: "invoice", label: `Invoice ${invoice.invoiceNumber} created`, note: `Expected ${tsh(invoice.expectedAmount)}. Current status ${humanize(invoice.status).toLowerCase()}.` });
      if (invoice.paidAt) rows.push({ key: `paid-${invoice.invoiceNumber}`, at: invoice.paidAt, source: "invoice", label: `Invoice ${invoice.invoiceNumber} settled`, note: `Receipt ${invoice.receiptNumber || "pending"}`, tone: "emerald" });
      for (const event of invoice.events) {
        const status = event.status.toUpperCase();
        const fromStatement = event.provider === "MANUAL_STATEMENT";
        rows.push({
          key: `provider-${event.eventId}`, at: event.createdAt, source: fromStatement ? "staff" : "provider",
          label: fromStatement
            ? (status === "SUCCESS" ? "Finance recorded money from the provider statement" : "Statement record voided, nothing settled")
            : `${event.provider} reported ${humanize(event.status).toLowerCase()}`,
          note: `${tsh(event.amount)} ${event.currency === "TZS" ? "" : event.currency}`.trim() + ` · event ${event.eventId}`,
          tone: SUCCESS_EVENTS.includes(status) ? "emerald" : FAILED_EVENTS.includes(status) ? "rose" : "amber",
        });
      }
    }
    if (detail.booking.codeIssuedAt) rows.push({ key: "code-issued", at: detail.booking.codeIssuedAt, source: "system", label: "Check-in code issued", note: `Status ${humanize(detail.booking.codeStatus || "unknown").toLowerCase()}. The code itself is hidden.`, tone: "emerald" });
    detail.timeline.forEach((event, index) => {
      const role = event.actorRole.toUpperCase();
      const source: Source = role === "CUSTOMER" ? "traveller" : role === "ADMIN" ? "staff" : "system";
      const extra = [
        event.note,
        event.metadata?.statementProvider ? `${event.metadata.statementProvider} transaction ${event.metadata.statementTransactionId || ""}`.trim() : null,
        event.metadata?.releasedInvoices ? "Stuck invoice released" : null,
        event.metadata?.channels?.length ? `Sent via ${event.metadata.channels.join(" and ")}` : null,
        event.metadata?.destinationMasked,
      ].filter(Boolean).join(" · ");
      rows.push({
        key: `case-${index}-${event.createdAt}`, at: event.createdAt, source,
        label: event.type === "CUSTOMER_REPORTED" ? "Traveller reported payment without a code"
          : event.type === "CLOSED_NOT_PAID" ? "Closed: payment did not go through"
          : event.type === "STATEMENT_CONFIRMED" ? "Money confirmed from the provider statement"
          : humanize(event.type),
        note: extra || (source === "traveller" ? "Opened from My bookings" : ""),
        tone: event.type === "CLOSED_NOT_PAID" ? "rose" : event.type === "STATEMENT_CONFIRMED" ? "emerald" : undefined,
      });
    });
    return rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [detail]);

  if (loading) {
    return <main className="grid min-h-60 w-full min-w-0 place-items-center text-sm text-slate-500"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading payment evidence</span></main>;
  }
  if (!detail) {
    return (
      <main className="w-full min-w-0 space-y-3">
        <Link href="/admin/payment-cases" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 no-underline hover:text-slate-900 hover:no-underline"><ArrowLeft className="h-4 w-4" /> Payment cases</Link>
        <p role="alert" className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error || "Case not found"}</p>
      </main>
    );
  }

  // Same rules as before: only an authenticated provider result can repair.
  const stayEnded = new Date(detail.booking.checkOut).getTime() + 24 * 60 * 60 * 1000 <= Date.now();
  const inFlight = BUSY_STATUSES.includes(detail.status);
  const canRepair = !stayEnded && ["PAID_NEEDS_REPAIR", "VERIFIED_EVENT"].includes(detail.evidenceState) && !["RESOLVED", "INVENTORY_CONFLICT", "REFUND_REQUIRED"].includes(detail.status);
  const canResend = !stayEnded && detail.evidenceState === "CODE_READY";
  const stalled = inFlight && Date.now() - new Date(detail.updatedAt).getTime() >= 10 * 60_000;
  const canRefund = ["PAID_NEEDS_REPAIR", "VERIFIED_EVENT"].includes(detail.evidenceState) || detail.status === "INVENTORY_CONFLICT";
  const report = detail.timeline.find((event) => event.type === "CUSTOMER_REPORTED");
  const statusTone = STATUS_TONE[detail.status] || "slate";

  // What the provider last said, across every invoice on the booking.
  const providerEvents = detail.invoices.flatMap((invoice) => invoice.events.map((event) => ({ ...event, invoice }))).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const lastProvider = providerEvents[providerEvents.length - 1] || null;
  const lastStatus = lastProvider?.status.toUpperCase() || "";
  const providerFailed = FAILED_EVENTS.includes(lastStatus);
  const providerPaid = SUCCESS_EVENTS.includes(lastStatus) || ["PAID_NEEDS_REPAIR", "VERIFIED_EVENT", "CODE_READY"].includes(detail.evidenceState);
  const invoiceStillProcessing = detail.invoices.some((invoice) => invoice.status === "PROCESSING");

  const closedNotPaid = detail.status === "RESOLVED" && detail.resolution === "NOT_PAID";
  const moneyRecorded = detail.invoices.some((invoice) => invoice.invoiceNumber.startsWith("INV-") && (["PAID", "CUSTOMER_PAID"].includes(invoice.status) || invoice.events.some((event) => event.status.toUpperCase() === "SUCCESS")));
  const settleInvoice = detail.invoices.find((invoice) => invoice.invoiceNumber.startsWith("INV-")) || null;
  const canClose = !["RESOLVED", "INVENTORY_CONFLICT", "REFUND_REQUIRED"].includes(detail.status) && !inFlight && !moneyRecorded;
  const canConfirmStatement = canClose && Boolean(settleInvoice) && !["CODE_READY", "PAID_NEEDS_REPAIR", "VERIFIED_EVENT"].includes(detail.evidenceState);
  const stmtAmountNumber = Number(stmtAmount.replace(/[^0-9]/g, ""));
  const stmtAmountMatches = settleInvoice ? stmtAmountNumber > 0 && Math.abs(stmtAmountNumber - settleInvoice.expectedAmount) <= 1 : false;
  const closeReady = closeNote.trim().length >= 10 && closeConfirmed && (closeMode === "not-paid" || (stmtTransaction.trim().length >= 6 && stmtAmountMatches));

  const verdict: { tone: Tone; Icon: LucideIcon; title: string; body: string } =
    closedNotPaid
      ? { tone: "rose", Icon: XCircle, title: "Closed: payment did not go through", body: "No money reached NoLSAF for this booking. Any stuck invoice was released, nothing was marked paid, and the traveller was told to pay again or contact support with their provider receipt." }
      : detail.status === "RESOLVED" && detail.resolution === "PROVIDER_STATEMENT"
        ? { tone: "emerald", Icon: BadgeCheck, title: "Resolved from the provider statement", body: "Finance confirmed the money in the provider's own records. The invoice settled through the normal path and the code was sent." }
      : detail.status === "RESOLVED"
      ? { tone: "emerald", Icon: BadgeCheck, title: "Case resolved", body: detail.resolution ? humanize(detail.resolution) : "The traveller has a working check-in code." }
      : detail.status === "INVENTORY_CONFLICT" || detail.status === "REFUND_REQUIRED"
        ? { tone: "rose", Icon: AlertTriangle, title: "Payment verified, original room unavailable", body: "Keep the payment protected. Arrange an available alternative with the traveller or use the approved refund process. No check-in code can be issued for an unavailable room." }
        : stayEnded
          ? { tone: "amber", Icon: CalendarDays, title: "The stay dates have passed", body: "Reconcile the payment, then arrange an alternative stay or approved refund. Do not issue a check-in code for the ended stay." }
          : detail.evidenceState === "CODE_READY"
            ? { tone: "emerald", Icon: CheckCircle2, title: "A check-in code already exists", body: "The booking is paid and the code is active. Securely resend it if the traveller cannot find it." }
            : providerPaid
              ? { tone: "emerald", Icon: ShieldAlert, title: "Provider confirmed the money", body: "The payment is authenticated but the booking was never repaired. Repair it and send the code." }
              : providerFailed
                ? { tone: "rose", Icon: XCircle, title: `${lastProvider!.provider} reported this payment failed`, body: `The last provider result (${eat(lastProvider!.createdAt)}) is a failure${invoiceStillProcessing ? ", while the invoice still says processing" : ""}. Do not repair from the traveller's word. Ask for their mobile money or bank receipt and confirm with the provider.` }
                : lastProvider
                  ? { tone: "amber", Icon: Clock, title: "Provider has not finished", body: `The last result from ${lastProvider.provider} is ${humanize(lastProvider.status).toLowerCase()}, ${since(lastProvider.createdAt)} ago. Recheck it, then follow up with the provider.` }
                  : { tone: "violet", Icon: ShieldQuestion, title: "No provider result on record", body: "Nothing from a payment provider has reached NoLSAF for this booking. Treat the traveller's details as clues and check with the provider." };

  // Lifecycle: where this case is.
  const codeSent = detail.status === "RESOLVED" || detail.timeline.some((event) => (event.metadata?.channels?.length ?? 0) > 0);
  const steps: Array<{ label: string; done: boolean; failed?: boolean }> = closedNotPaid ? [
    { label: "Reported", done: true },
    { label: "Provider checked", done: true, failed: true },
    { label: "Traveller told", done: true },
    { label: "Closed", done: true },
  ] : [
    { label: "Reported", done: true },
    { label: "Provider checked", done: providerPaid || providerFailed, failed: providerFailed && !providerPaid },
    { label: "Booking repaired", done: detail.booking.status !== "NEW" || detail.evidenceState === "CODE_READY" },
    { label: "Code delivered", done: codeSent },
    { label: "Resolved", done: detail.status === "RESOLVED" },
  ];
  const current = steps.findIndex((step) => !step.done);

  // Traveller's reference against what the provider and invoices recorded.
  const supplied = detail.customerReference?.trim().toLowerCase() || "";
  const knownRefs = detail.invoices.flatMap((invoice) => [invoice.paymentRef, invoice.receiptNumber, ...invoice.events.map((event) => event.eventId)]).filter(Boolean).map((value) => String(value).toLowerCase());
  const referenceMatch = supplied ? knownRefs.some((value) => value === supplied || value.includes(supplied)) : null;

  const counts = evidence.reduce<Record<string, number>>((acc, row) => { acc[row.source] = (acc[row.source] || 0) + 1; return acc; }, {});
  const shown = filter === "all" ? evidence : evidence.filter((row) => row.source === filter);
  const recommend = canRepair && !inFlight ? "repair" : canResend && !inFlight ? "resend" : stalled ? "recover" : "check";

  const primary = "inline-flex h-10 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-50";
  const secondary = "inline-flex h-10 items-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";

  return (
    <main className="w-full min-w-0 space-y-4">
      <Link href="/admin/payment-cases" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 no-underline hover:text-slate-900 hover:no-underline"><ArrowLeft className="h-4 w-4" /> Payment cases</Link>

      {/* Record header */}
      <header className="overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="flex flex-wrap items-start gap-4 px-5 pt-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-white/10"><ShieldAlert className="h-5 w-5 text-amber-200" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-xl font-bold">Payment without a code</h1>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONE_CHIP[statusTone]}`}>
                {inFlight ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}{humanize(detail.status)}
              </span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-white/75">Booking {humanize(detail.booking.status).toLowerCase()}</span>
              <span className="text-white/60">Opened {since(detail.createdAt)} ago</span>
            </p>
            <p className="m-0 mt-1.5 truncate text-[13px] text-white/70">{detail.booking.guestName} · {detail.booking.propertyTitle}</p>
          </div>
          <div className="text-right">
            <p className="m-0 text-[11px] text-white/50">Amount</p>
            <p className="m-0 text-2xl font-bold tabular-nums">{tsh(detail.booking.amount)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 px-5">
          <CopyRef label="Case" value={detail.reference} />
          <CopyRef label="Booking" value={detail.booking.adminReference} />
        </div>
        <dl className="m-0 mt-4 grid grid-cols-2 border-0 border-t border-solid border-white/10 sm:grid-cols-4">
          {[
            { k: "Payment evidence", v: humanize(detail.evidenceState) },
            { k: "Check-in code", v: detail.booking.codeStatus ? humanize(detail.booking.codeStatus) : "Not issued" },
            { k: "Stay", v: `${eatDay(detail.booking.checkIn)} to ${eatDay(detail.booking.checkOut)}` },
            { k: "Last update", v: `${since(detail.updatedAt)} ago` },
          ].map((cell, index) => (
            <div key={cell.k} className={`min-w-0 px-5 py-3 ${index > 0 ? "border-0 border-l border-solid border-white/10" : ""} ${index === 2 ? "max-sm:border-l-0" : ""} ${index >= 2 ? "max-sm:border-t max-sm:border-solid max-sm:border-white/10" : ""}`}>
              <dt className="text-[11px] text-white/50">{cell.k}</dt>
              <dd className="m-0 mt-0.5 truncate text-[13px] font-semibold">{cell.v}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* Lifecycle */}
      <ol className="m-0 grid list-none overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => {
          const isCurrent = index === current;
          return (
            <li key={step.label} className={`relative flex min-w-0 flex-col items-center gap-1 px-1 py-3 text-center ${index > 0 ? "border-0 border-l border-solid border-slate-100" : ""} ${isCurrent ? "bg-amber-50/60" : ""}`}>
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${step.failed ? "bg-rose-100 text-rose-700" : step.done ? "bg-[#02665e] text-white" : isCurrent ? "bg-amber-400 text-amber-950" : "bg-slate-100 text-slate-400"}`}>
                {step.failed ? <XCircle className="h-3.5 w-3.5" aria-hidden /> : step.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
              </span>
              <span className={`text-[11px] font-semibold leading-tight sm:text-[12px] ${step.done ? "text-slate-800" : isCurrent ? "text-amber-900" : "text-slate-400"}`}>{step.label}</span>
              {step.failed ? <span className="text-[10px] font-semibold text-rose-700">Failed</span> : isCurrent ? <span className="text-[10px] font-semibold text-amber-800">Now</span> : null}
            </li>
          );
        })}
      </ol>

      {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      {success ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{success}</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* Verdict + next action */}
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <div className="flex items-start gap-3 px-5 py-4">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${TONE_TILE[verdict.tone]}`}><verdict.Icon className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">{verdict.title}</h2>
                <p className="m-0 mt-1 text-[13px] leading-6 text-slate-600">{verdict.body}</p>
              </div>
            </div>
            <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-4">
              <p className="m-0 text-[12px] font-semibold text-slate-700">Next action</p>
              <p className="m-0 mt-0.5 text-[12px] text-slate-500">Only a matching authenticated provider result can repair this booking. The traveller&rsquo;s report alone cannot mark it paid.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canRepair && !inFlight ? <button type="button" disabled={busy} onClick={() => void action("repair")} className={primary}><Wrench className="h-4 w-4" aria-hidden /> Repair booking and send code</button> : null}
                {canResend && !inFlight ? <button type="button" disabled={busy} onClick={() => void action("resend")} className={recommend === "resend" ? primary : secondary}><Send className="h-4 w-4" aria-hidden /> Securely resend existing code</button> : null}
                {stalled ? <button type="button" disabled={busy} onClick={() => void action("recover")} className="inline-flex h-10 items-center gap-2 rounded-md border border-solid border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"><Undo2 className="h-4 w-4" aria-hidden /> Recover stalled action</button> : null}
                <button type="button" disabled={busy} onClick={() => void action("check-payment")} className={recommend === "check" ? primary : secondary}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Recheck provider result
                </button>
              </div>
              {inFlight && !stalled ? <p className="m-0 mt-3 inline-flex items-center gap-2 text-[12px] text-sky-800"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {humanize(detail.status)} started {since(detail.updatedAt)} ago. Recovery opens after 10 minutes.</p> : null}
            </div>
            {detail.status !== "RESOLVED" && !inFlight ? (
              <div className="border-0 border-t border-solid border-slate-100 px-5 py-4">
                <label className="block text-[12px] font-semibold text-slate-700" htmlFor="case-note">Staff note <span className="font-normal text-slate-500">(at least 10 characters, kept on the case)</span></label>
                <textarea id="case-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} className="mt-1.5 block w-full resize-y rounded-md border border-solid border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" placeholder="What the provider or traveller needs next" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy || note.trim().length < 10} onClick={() => void action("next-step", { status: "AWAITING_PROVIDER", note })} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Radio className="h-3.5 w-3.5" aria-hidden /> Record provider follow-up</button>
                  {canRefund ? <button type="button" disabled={busy || note.trim().length < 10} onClick={() => void action("next-step", { status: "REFUND_REQUIRED", note })} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-rose-300 bg-white px-3 text-[13px] font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"><Undo2 className="h-3.5 w-3.5" aria-hidden /> Send to refund review</button> : null}
                  <span className="ml-auto text-[11px] tabular-nums text-slate-400">{note.length}/500</span>
                </div>
              </div>
            ) : null}
            {canClose ? (
              <div className="border-0 border-t border-solid border-slate-100 px-5 py-4">
                <p className="m-0 text-[12px] font-semibold text-slate-700">Close the case by hand</p>
                <p className="m-0 mt-0.5 text-[12px] text-slate-500">Only after you have the provider&rsquo;s answer. Both need finance verification and are kept on the case and audit log.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How the case ends">
                  {([
                    { key: "not-paid", Icon: XCircle, title: "Payment did not go through", body: "The provider confirms no money arrived. Nothing is marked paid; the traveller is told.", on: "border-rose-300 bg-rose-50/60", icon: "text-rose-700", enabled: true },
                    { key: "statement", Icon: FileText, title: "Money is on the provider statement", body: "The provider's own records show it arrived, but no callback reached NoLSAF.", on: "border-emerald-300 bg-emerald-50/60", icon: "text-emerald-700", enabled: canConfirmStatement },
                  ] as const).map((option) => {
                    const on = closeMode === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!option.enabled || busy}
                        onClick={() => { setCloseMode(on ? "" : option.key); setCloseConfirmed(false); if (option.key === "statement" && settleInvoice && !stmtAmount) setStmtAmount(String(settleInvoice.expectedAmount)); }}
                        className={`flex items-start gap-3 rounded-md border border-solid p-3 text-left disabled:opacity-50 ${on ? option.on : "border-slate-200 bg-white hover:bg-slate-50"}`}
                      >
                        <option.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${option.icon}`} aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-slate-900">{option.title}</span>
                          <span className="mt-0.5 block text-[12px] leading-5 text-slate-600">{option.body}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {closeMode ? (
                  <div className="mt-3 space-y-3 rounded-md border border-solid border-slate-200 bg-slate-50/60 p-3">
                    {closeMode === "statement" && settleInvoice ? (
                      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_10rem]">
                        <label className="block text-[12px] font-semibold text-slate-700">Provider
                          <span className="mt-1 flex overflow-hidden rounded-md border border-solid border-slate-300 bg-white">
                            {(["AZAMPAY", "CORALCOMMERCE"] as const).map((value) => (
                              <button key={value} type="button" onClick={() => setStmtProvider(value)} className={`h-9 flex-1 border-0 px-2 text-[12px] font-semibold ${stmtProvider === value ? "bg-[#02665e] text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>
                                {value === "AZAMPAY" ? "AzamPay" : "Coral"}
                              </button>
                            ))}
                          </span>
                        </label>
                        <label className="block text-[12px] font-semibold text-slate-700">Provider transaction ID
                          <input value={stmtTransaction} onChange={(event) => setStmtTransaction(event.target.value.trim())} maxLength={80} placeholder="Exactly as the provider shows it" className="mt-1 block h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2.5 font-mono text-[13px] text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                        </label>
                        <label className="block text-[12px] font-semibold text-slate-700">Amount received (TSh)
                          <input value={stmtAmount} onChange={(event) => setStmtAmount(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={`mt-1 block h-9 w-full rounded-md border border-solid bg-white px-2.5 text-[13px] tabular-nums text-slate-900 outline-none focus:ring-2 focus:ring-[#02665e]/15 ${stmtAmount && !stmtAmountMatches ? "border-rose-400" : "border-slate-300 focus:border-[#02665e]"}`} />
                          <span className={`mt-1 block text-[11px] font-normal ${stmtAmount && !stmtAmountMatches ? "text-rose-700" : "text-slate-500"}`}>Invoice {settleInvoice.invoiceNumber} expects {tsh(settleInvoice.expectedAmount)}</span>
                        </label>
                      </div>
                    ) : null}
                    <label className="block text-[12px] font-semibold text-slate-700" htmlFor="close-note">
                      {closeMode === "not-paid" ? "What the provider confirmed" : "Where you checked it"} <span className="font-normal text-slate-500">(at least 10 characters)</span>
                    </label>
                    <textarea id="close-note" value={closeNote} onChange={(event) => setCloseNote(event.target.value)} maxLength={500} rows={2} className="block w-full resize-y rounded-md border border-solid border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" placeholder={closeMode === "not-paid" ? "For example: Coral confirmed the card was declined; no funds captured" : "For example: AzamPay merchant portal, settled 19 Oct 21:32"} />
                    <label className="flex cursor-pointer items-start gap-2 text-[12px] text-slate-700">
                      <input type="checkbox" checked={closeConfirmed} onChange={(event) => setCloseConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#02665e]" />
                      <span>{closeMode === "not-paid"
                        ? "I confirmed with the provider that no money from this traveller reached NoLSAF. The traveller is told no payment arrived."
                        : "I found this transaction in the provider's own statement or portal, for this amount, and it is not a screenshot from the traveller. The booking is confirmed and the code is sent."}</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !closeReady}
                        onClick={() => void action(closeMode === "not-paid" ? "close-not-paid" : "confirm-statement", closeMode === "not-paid"
                          ? { note: closeNote.trim(), confirmNoMoney: true }
                          : { provider: stmtProvider, transactionId: stmtTransaction.trim(), amount: stmtAmountNumber, note: closeNote.trim(), confirmStatement: true })}
                        className={closeMode === "not-paid"
                          ? "inline-flex h-10 items-center gap-2 rounded-md border-0 bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
                          : primary}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : closeMode === "not-paid" ? <XCircle className="h-4 w-4" aria-hidden /> : <BadgeCheck className="h-4 w-4" aria-hidden />}
                        {closeMode === "not-paid" ? "Close case: not paid" : "Record payment and send code"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setCloseMode(""); setCloseConfirmed(false); }} className="h-10 rounded-md border-0 bg-transparent px-3 text-sm font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Evidence timeline */}
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-4">
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Evidence timeline</h2>
                <p className="m-0 mt-0.5 text-[12px] text-slate-500">Provider callbacks and invoices are kept apart from the traveller&rsquo;s word. Times in EAT.</p>
              </div>
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-100 px-3" role="tablist" aria-label="Filter evidence">
              {(["all", "provider", "invoice", "traveller", "staff", "system"] as const).filter((key) => key === "all" || counts[key]).map((key) => {
                const on = filter === key;
                return (
                  <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(key)} className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 border-0 bg-transparent px-2.5 text-[12px] font-semibold ${on ? "text-slate-900" : "text-slate-500 hover:text-slate-800"}`}>
                    {key === "all" ? "All" : SOURCE_META[key].label}
                    <span className={`rounded px-1.5 text-[11px] tabular-nums ${on ? "bg-[#02665e]/10 text-[#02665e]" : "bg-slate-100 text-slate-500"}`}>{key === "all" ? evidence.length : counts[key]}</span>
                    {on ? <span className="absolute inset-x-1.5 bottom-0 h-0.5 bg-[#02665e]" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
            <ol className="m-0 list-none px-5 py-4">
              {shown.map((row, index) => {
                const meta = SOURCE_META[row.source];
                const gap = index > 0 ? since(shown[index - 1].at, row.at) : null;
                const longGap = index > 0 && new Date(row.at).getTime() - new Date(shown[index - 1].at).getTime() > 24 * 60 * 60 * 1000;
                return (
                  <li key={row.key} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < shown.length - 1 ? <span className="absolute bottom-0 left-[11px] top-6 w-px bg-slate-200" aria-hidden /> : null}
                    <span className={`relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-4 ring-white ${row.tone === "rose" ? "bg-rose-100 text-rose-700" : row.tone === "emerald" ? "bg-emerald-100 text-emerald-700" : row.tone === "amber" ? "bg-amber-100 text-amber-800" : TONE_TILE[row.source === "traveller" ? "violet" : row.source === "staff" ? "emerald" : row.source === "provider" ? "sky" : "slate"]}`}>
                      <meta.Icon className="h-3 w-3" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      {longGap ? <p className="m-0 mb-1 text-[11px] font-semibold text-amber-700">{gap} later</p> : null}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-semibold text-slate-900">{row.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
                        <span className="text-[11px] text-slate-500">{eat(row.at)}</span>
                      </div>
                      {row.note ? <p className="m-0 mt-0.5 break-all text-[12px] text-slate-600">{row.note}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        {/* Side: the traveller's claim */}
        <aside className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <p className="m-0 border-0 border-b border-solid border-slate-100 bg-slate-50 px-4 py-2 text-[12px] font-semibold text-slate-700">What the traveller told us</p>
            <dl className="m-0 px-4 text-[13px]">
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0">
                <dt className="text-slate-500">Reference</dt>
                <dd className="m-0 min-w-0 text-right">
                  {detail.customerReference ? <span className="break-all font-mono font-semibold text-slate-900">{detail.customerReference}</span> : <span className="text-slate-400">Not supplied</span>}
                  {referenceMatch === true ? <span className="mt-1 flex items-center justify-end gap-1 text-[11px] font-semibold text-emerald-700"><Check className="h-3 w-3" aria-hidden /> Matches a recorded reference</span> : null}
                  {referenceMatch === false ? <span className="mt-1 flex items-center justify-end gap-1 text-[11px] font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" aria-hidden /> Not in any provider record</span> : null}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0"><dt className="text-slate-500">Method</dt><dd className="m-0 text-right font-semibold text-slate-900">{report?.metadata?.paymentMethod ? humanize(report.metadata.paymentMethod) : "Not supplied"}</dd></div>
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0"><dt className="text-slate-500">Paid around</dt><dd className="m-0 text-right font-semibold text-slate-900">{report?.metadata?.approximatePaidAt ? eat(report.metadata.approximatePaidAt) : "Not supplied"}</dd></div>
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0"><dt className="text-slate-500">Payer phone ends</dt><dd className="m-0 text-right font-mono font-semibold text-slate-900">{report?.metadata?.payerPhoneLast4 || "Not supplied"}</dd></div>
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0"><dt className="text-slate-500">Reported</dt><dd className="m-0 text-right font-semibold text-slate-900">{report ? eat(report.createdAt) : eat(detail.createdAt)}</dd></div>
            </dl>
            {report?.metadata?.recordedAttempt === false ? (
              <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-violet-100 bg-violet-50 px-4 py-3 text-[12px] text-violet-900"><ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />No completed payment attempt was recorded when this case opened. These details are clues only.</p>
            ) : lastProvider && report ? (
              <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50 px-4 py-3 text-[12px] text-slate-600"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Reported {since(lastProvider.createdAt, report.createdAt)} after the last provider result.</p>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
            <p className="m-0 border-0 border-b border-solid border-slate-100 bg-slate-50 px-4 py-2 text-[12px] font-semibold text-slate-700">Provider at a glance</p>
            <dl className="m-0 px-4 text-[13px]">
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0"><dt className="text-slate-500">Callbacks</dt><dd className="m-0 font-semibold tabular-nums text-slate-900">{providerEvents.length}</dd></div>
              <div className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0">
                <dt className="text-slate-500">Last result</dt>
                <dd className={`m-0 text-right font-semibold ${providerFailed ? "text-rose-700" : providerPaid ? "text-emerald-700" : "text-slate-900"}`}>{lastProvider ? `${humanize(lastProvider.status)} · ${lastProvider.provider}` : "None"}</dd>
              </div>
              {detail.invoices.map((invoice) => (
                <div key={invoice.invoiceNumber} className="flex items-start justify-between gap-3 border-0 border-t border-solid border-slate-100 py-2.5 first:border-t-0">
                  <dt className="min-w-0 truncate font-mono text-[12px] text-slate-500">{invoice.invoiceNumber}</dt>
                  <dd className="m-0 text-right font-semibold text-slate-900">{humanize(invoice.status)}</dd>
                </div>
              ))}
            </dl>
            {providerFailed && invoiceStillProcessing ? <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-amber-100 bg-amber-50 px-4 py-3 text-[12px] text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Invoice still says processing although the provider reported a failure.</p> : null}
          </section>

          <section className="rounded-lg border border-solid border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-600">
            <p className="m-0 flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Guest phone <span className="ml-auto font-mono font-semibold text-slate-900">{detail.booking.guestPhoneMasked || "Not available"}</span></p>
            <p className="m-0 mt-2 text-[11px] text-slate-500">Codes go only to the booking contact and the verified account email.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
