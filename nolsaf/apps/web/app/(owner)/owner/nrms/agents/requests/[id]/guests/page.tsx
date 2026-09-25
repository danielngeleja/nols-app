"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { ArrowLeft, ArrowRight, BadgeCheck, BedDouble, CalendarDays, CreditCard, Download, FilePlus2, FileSearch, FileText, Loader2, ReceiptText, RotateCcw, Send, ShieldCheck, Users, WalletCards } from "lucide-react";

type Guest = { id: number; reservationId: number | null; roomNumber: number; guestType: string; isLead: boolean; fullName: string | null; phone: string | null; email: string | null; nationality: string | null; dateOfBirth: string | null; documentType: string | null; documentNumber: string | null; documentExpiry: string | null; documentUploaded: boolean; status: string; reviewNote: string | null };
type Data = {
  booking: { id: number; status: string; agency: { legalName: string; tradingName: string | null } | null; property: { title: string }; checkIn: string; checkOut: string; adults: number; children: number; rooms: number; receiptNumber: string | null; financials: { currency: string; total: number; amountPaid: number; balance: number; status: string; invoice: Invoice | null; payments: Array<{ id: number; amount: number; method: string; reference: string | null; receiptNumber: string; createdAt: string }> } };
  rooms: {
    blockId: number; blockReference: string; blockStatus: string; groupId: number | null; groupReference: string | null;
    stays: Array<{ reservationId: number; reference: string | null; status: string; guestName: string | null; roomCode: string | null; roomTypeName: string | null }>;
  } | null;
  manifest: { status: string; incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST" | null; incidentalCover: IncidentalCover; requiredGuests: number; guestsAdded: number; reviewNote: string | null };
  guests: Guest[];
};
type IncidentalCover = { billing: string | null; scope: string | null; categories: string[]; capAmount: number | null; capBasis: string | null; headline: string; detail: string };
type Invoice = { id: number; number: string; revision: number; status: string; currency: string; quotedTotal: number; paidNow: number; liveBalance: number; dueAt: string; sentAt: string | null; sentToEmail: string | null; payerMarkedPaidAt: string | null; payerPaymentReference: string | null; payerPaymentMethod: string | null; payerPaymentAccountName: string | null };

const fmt = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const stayNights = (checkIn: string, checkOut: string) => Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
const money = (value: number) => Math.round(value).toLocaleString();
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500";
const primaryBtn = "box-border inline-flex h-10 flex-none cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-4 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn = "box-border inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3.5 text-sm font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";
const OWNER_METHOD_LABELS: Record<string, string> = { BANK: "Bank transfer", CARD: "Card", MOBILE: "Mobile money", CASH: "Cash" };
const ownerMethodLabel = (value: string | null) => (value ? OWNER_METHOD_LABELS[value] ?? value : "Not stated");
// sentAt is a real timestamp, so it can carry a clock time. dueAt cannot: it is
// a date-only column, and rendering its midnight as a time would be invented.
const fmtDateTime = (value: string) => new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
// Compare the stored calendar date directly so no timezone shifts the day.
const daysFromToday = (value: string) => {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return 0;
  const now = new Date();
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
};
const paymentMutationId = (requestId: string) => `agent-payment-${requestId}-${crypto.randomUUID()}`;

export default function HotelAgentManifestReviewPage() {
  const params = useParams<{ id: string }>();
  // The URL segment is the opaque ar_ reference; the API resolves it on every
  // /requests/:requestId route, so the row id never appears in page or PDF URLs.
  const requestId = encodeURIComponent(String(params.id ?? ""));
  const [data, setData] = useState<Data | null>(null);
  const [issues, setIssues] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commercialBusy, setCommercialBusy] = useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [paymentReference, setPaymentReference] = useState("");
  // Retained after a lost/failed response; only a confirmed response rotates
  // the key for a genuinely new payment.
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => paymentMutationId(requestId));

  // The owner types a percentage, but the invoice API takes the absolute money
  // amount and validates it against the same quoted total shown here.
  const grossTotal = data?.booking.financials.total ?? 0;
  const discountPct = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const discountValue = Number(((grossTotal * discountPct) / 100).toFixed(2));
  const finalTotal = Number((grossTotal - discountValue).toFixed(2));

  const load = useCallback(async () => {
    try { const response = await apiClient.get<Data>(`/api/owner/nrms/agents/requests/${requestId}/manifest`); setData(response.data); setPaymentAmount(String(response.data.booking.financials.balance || "")); }
    catch (cause: any) { setError(cause?.response?.data?.error || "The manifest could not be loaded"); }
  }, [requestId]);
  useEffect(() => { if (requestId) void load(); }, [load, requestId]);

  // Verification splits the booking by itself. This is for a manifest verified
  // before that shipped, so the desk can still move it into the workspace.
  const splitIntoRooms = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/agents/requests/${requestId}/rooms`, {});
      const unnamed = Number(response.data?.unnamed ?? 0);
      setNotice(response.data?.repaired
        ? `Agency bill re-checked across ${response.data?.reservations ?? 0} room stays. The folio now reads ${String(response.data?.folioStatus || "").toLowerCase() || "updated"}.`
        : `${response.data?.created ?? 0} traveller stays created.${unnamed > 0 ? ` ${unnamed} room${unnamed === 1 ? "" : "s"} still need a name.` : ""}`);
      await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "The booking could not be split into rooms"); }
    finally { setBusy(false); }
  };

  const decide = async (action: "VERIFY" | "RETURN") => {
    if (action === "RETURN" && !note.trim() && !Object.values(issues).some((value) => value.trim())) { setError("Add an overall note or mark the traveller details that need correction."); return; }
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/owner/nrms/agents/requests/${requestId}/manifest/review`, { action, note: note.trim() || undefined, guestIssues: Object.entries(issues).filter(([, value]) => value.trim()).map(([guestId, value]) => ({ guestId: Number(guestId), note: value.trim() })) });
      setNotice(action === "VERIFY" ? "Manifest verified. The booking is ready for room assignment and check-in." : "Corrections returned securely to the agency.");
      setIssues({}); setNote(""); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "The review decision could not be saved"); }
    finally { setBusy(false); }
  };

  const generateInvoice = async () => {
    setCommercialBusy("generate"); setError(null); setNotice(null);
    try {
      await apiClient.post(`/api/owner/nrms/agents/requests/${requestId}/invoices`, { discountAmount: discountValue, discountReason: discountPct > 0 ? discountReason.trim() : undefined, dueAt: dueAt || undefined });
      setNotice("Invoice revision generated. Review it, then send it to the agency."); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "The invoice could not be generated"); }
    finally { setCommercialBusy(null); }
  };
  const sendInvoice = async () => {
    const invoice = data?.booking.financials.invoice; if (!invoice) return;
    setCommercialBusy("send"); setError(null); setNotice(null);
    try { await apiClient.post(`/api/owner/nrms/agents/requests/${requestId}/invoices/${invoice.id}/send`, {}); setNotice("Invoice sent securely to the agency."); await load(); }
    catch (cause: any) { setError(cause?.response?.data?.error || "The invoice could not be sent"); }
    finally { setCommercialBusy(null); }
  };
  const confirmPayment = async () => {
    setCommercialBusy("payment"); setError(null); setNotice(null);
    try {
      await apiClient.post(`/api/owner/nrms/agents/requests/${requestId}/payments/confirm`, { amount: Number(paymentAmount), method: paymentMethod, reference: paymentReference.trim() || undefined, idempotencyKey: paymentIdempotencyKey });
      setPaymentIdempotencyKey(paymentMutationId(requestId));
      setNotice("Payment receipt recorded. The voucher was released and traveller entry is now open."); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "The payment could not be confirmed"); }
    finally { setCommercialBusy(null); }
  };

  if (!data && !error) return <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading secure guest manifest…</div>;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  const reviewable = data.manifest.status === "SUBMITTED";
  // Cards exist to be reviewed one at a time. Once the identities are verified
  // the desk is reading a list, not judging it, so it reads as a list.
  const verified = data.manifest.status === "VERIFIED";

  const paymentStatus = data.booking.financials.balance <= 0 && data.booking.financials.total > 0 ? "Paid in full" : data.booking.financials.invoice?.payerMarkedPaidAt ? "Agency says paid · verify account" : data.booking.financials.invoice?.sentAt ? "Invoice sent" : data.booking.financials.invoice ? "Invoice draft" : "Awaiting invoice";
  const invoice = data.booking.financials.invoice;
  const settled = data.booking.financials.status === "SETTLED";
  // Receipts are issued per payment; the newest one is the settling receipt.
  const latestPayment = data.booking.financials.payments.length > 0
    ? [...data.booking.financials.payments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;
  const dueInDays = invoice ? daysFromToday(invoice.dueAt) : 0;
  const dueLabel = dueInDays === 0 ? "Falls due today" : dueInDays > 0 ? `${dueInDays} day${dueInDays === 1 ? "" : "s"} from today` : `Overdue by ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? "" : "s"}`;

  const currency = data.booking.financials.currency;
  const nights = stayNights(data.booking.checkIn, data.booking.checkOut);
  const agencyName = data.booking.agency?.tradingName || data.booking.agency?.legalName || "Travel agency";
  const approved = data.booking.status === "CONFIRMED" || settled;
  const partPaid = data.booking.financials.amountPaid > 0 && !settled;
  const manifestStatus = data.manifest.status;
  const travellersSubmitted = ["SUBMITTED", "VERIFIED"].includes(manifestStatus);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Where the booking stands, in the order the desk works it.
  const steps: Array<{ key: string; label: string; state: "done" | "current" | "waiting"; detail: string }> = [
    { key: "approve", label: "Approved", state: approved ? "done" : "current", detail: approved ? "Booking confirmed" : "Owner review needed" },
    { key: "invoice", label: "Invoiced", state: invoice?.sentAt ? "done" : approved ? "current" : "waiting", detail: invoice?.sentAt ? `Sent ${fmt(invoice.sentAt)}` : invoice ? "Draft, not sent" : "Not issued" },
    { key: "paid", label: "Paid", state: settled ? "done" : invoice?.sentAt ? "current" : "waiting", detail: settled ? "Paid in full" : partPaid ? `${currency} ${money(data.booking.financials.balance)} due` : invoice?.payerMarkedPaidAt ? "Agency says paid" : invoice ? (dueInDays < 0 ? `Overdue ${Math.abs(dueInDays)}d` : `Due ${fmt(invoice.dueAt)}`) : "Awaiting invoice" },
    { key: "travellers", label: "Travellers", state: travellersSubmitted ? "done" : data.manifest.guestsAdded > 0 ? "current" : "waiting", detail: `${data.manifest.guestsAdded} of ${data.manifest.requiredGuests} added` },
    { key: "verified", label: "Verified", state: verified ? "done" : manifestStatus === "SUBMITTED" ? "current" : "waiting", detail: verified ? "Identities checked" : manifestStatus === "SUBMITTED" ? "Ready to review" : manifestStatus === "RETURNED" ? "Sent back to agency" : "Not submitted" },
    { key: "rooms", label: "Rooms", state: data.rooms?.groupId ? "done" : verified ? "current" : "waiting", detail: data.rooms?.groupId ? `${data.rooms.stays.filter((stay) => stay.roomCode).length} of ${data.rooms.stays.length} assigned` : "Not split" },
  ];

  // The one thing to do now, with its action attached.
  const nextStep: { tone: "action" | "wait" | "alert" | "done"; title: string; detail: string; action?: ReactNode } = !approved
    ? { tone: "action", title: "Approve the booking request", detail: "The stay has to be confirmed before an invoice can be issued.", action: <Link href="/owner/nrms/agents/requests" className={primaryBtn}>Open requests <ArrowRight className="h-4 w-4" /></Link> }
    : !invoice
      ? { tone: "action", title: "Issue the invoice", detail: `Set any discount and the pay-by date, then generate the invoice for ${currency} ${money(finalTotal)}.`, action: <button type="button" onClick={() => scrollTo("commercial")} className={primaryBtn}><FilePlus2 className="h-4 w-4" /> Go to invoice</button> }
      : !invoice.sentAt
        ? { tone: "action", title: "Send the invoice to the agency", detail: `${invoice.number} is ready as a draft. The agency cannot pay until it is sent.`, action: <button type="button" disabled={commercialBusy !== null} onClick={() => void sendInvoice()} className={primaryBtn}>{commercialBusy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to agency</button> }
        : invoice.payerMarkedPaidAt && !settled
          ? { tone: "alert", title: "The agency says it has paid", detail: "Find the money in the property account, then record the receipt. Their declaration alone is not proof.", action: <button type="button" onClick={() => scrollTo("commercial")} className={primaryBtn}><ReceiptText className="h-4 w-4" /> Verify and record</button> }
          : !settled && dueInDays < 0
            ? { tone: "alert", title: `Payment is ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? "" : "s"} overdue`, detail: `${currency} ${money(data.booking.financials.balance)} was due on ${fmt(invoice.dueAt)}. Follow up with ${agencyName}.` }
            : manifestStatus === "SUBMITTED"
              ? { tone: "action", title: "Review the traveller identities", detail: `${data.guests.length} travellers are waiting. Verify them all, or return the ones that need correcting.`, action: <button type="button" onClick={() => scrollTo("travellers")} className={primaryBtn}><BadgeCheck className="h-4 w-4" /> Review travellers</button> }
              : verified && !data.rooms?.groupId
                ? { tone: "action", title: "Split the booking into rooms", detail: "Give each traveller their own room, folio, check-in and check-out.", action: <button type="button" disabled={busy} onClick={() => void splitIntoRooms()} className={primaryBtn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BedDouble className="h-4 w-4" />} Split into rooms</button> }
                : data.rooms?.groupId
                  ? { tone: "done", title: "Assign rooms and run the stay", detail: "Room assignment, check-in and check-out happen in the group workspace.", action: <Link href={data.rooms.groupReference ? `/owner/nrms/groups?group=${encodeURIComponent(data.rooms.groupReference)}` : "/owner/nrms/groups"} className={primaryBtn}>Open group workspace <ArrowRight className="h-4 w-4" /></Link> }
                  : !settled
                    ? { tone: "wait", title: "Waiting for the agency's payment", detail: `${currency} ${money(data.booking.financials.balance)} due by ${fmt(invoice.dueAt)} (${dueLabel.toLowerCase()}).` }
                    : { tone: "wait", title: "Waiting for traveller details", detail: "The agency has not submitted names and identity documents yet. This page updates as they do." };
  const nextTone = {
    action: "border-emerald-200 bg-emerald-50/60",
    alert: "border-amber-300 bg-amber-50",
    wait: "border-neutral-200 bg-neutral-50",
    done: "border-emerald-200 bg-emerald-50/60",
  }[nextStep.tone];

  return <div className="flex w-full min-w-0 flex-col gap-5 pb-8">
    <Link href="/owner/nrms/agents/requests" className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-neutral-500 no-underline hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Agent bookings</Link>

    {/* Header, progress and next step: where this booking stands at a glance */}
    <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 px-5 pb-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><ShieldCheck className="h-6 w-6" /></span>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">Agent booking</p>
            <h1 className="m-0 mt-0.5 truncate text-2xl font-extrabold tracking-tight text-neutral-950">{agencyName}</h1>
            <p className="m-0 mt-1 text-sm text-neutral-500">
              {data.booking.property.title} · {fmt(data.booking.checkIn)} to {fmt(data.booking.checkOut)} · {nights} nights · {data.booking.rooms} room{data.booking.rooms === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          <StatusPill tone={settled ? "ok" : invoice?.payerMarkedPaidAt ? "warn" : dueInDays < 0 && invoice?.sentAt ? "danger" : "muted"}>{paymentStatus}</StatusPill>
          <StatusPill tone={verified ? "ok" : manifestStatus === "SUBMITTED" ? "info" : "muted"}>Manifest {manifestStatus.replace(/_/g, " ").toLowerCase()}</StatusPill>
        </div>
      </div>

      <ol className="m-0 grid list-none grid-cols-2 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 p-0 sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((step, index) => (
          <li key={step.key} className={`flex min-w-0 items-start gap-2.5 px-4 py-3.5 ${step.state === "current" ? "bg-emerald-50/50" : "bg-white"}`}>
            <span className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-bold ${step.state === "done" ? "bg-emerald-600 text-white" : step.state === "current" ? "bg-white text-emerald-700 ring-2 ring-emerald-500" : "bg-neutral-100 text-neutral-400"}`}>
              {step.state === "done" ? <BadgeCheck className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-bold ${step.state === "waiting" ? "text-neutral-400" : "text-neutral-900"}`}>{step.label}</span>
              <span className={`mt-0.5 block truncate text-xs ${step.state === "current" ? "font-semibold text-emerald-700" : "text-neutral-500"}`}>{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className={`m-4 flex flex-col gap-3 rounded-xl border border-solid p-4 sm:m-5 sm:flex-row sm:items-center sm:justify-between ${nextTone}`}>
        <div className="min-w-0">
          <p className={`m-0 text-[11px] font-bold uppercase tracking-[0.1em] ${nextStep.tone === "alert" ? "text-amber-800" : nextStep.tone === "wait" ? "text-neutral-500" : "text-emerald-700"}`}>{nextStep.tone === "wait" ? "Nothing to do right now" : "Next step"}</p>
          <p className="m-0 mt-1 text-base font-bold text-neutral-950">{nextStep.title}</p>
          <p className="m-0 mt-0.5 max-w-2xl text-sm leading-6 text-neutral-600">{nextStep.detail}</p>
        </div>
        {nextStep.action ? <div className="flex flex-none">{nextStep.action}</div> : null}
      </div>
    </section>

    {notice ? <div role="status" className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div> : null}
    {error ? <div role="alert" className="rounded-xl border border-solid border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Invoice and payment */}
        <section id="commercial" className="scroll-mt-4 rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="m-0 text-lg font-extrabold text-neutral-950">{settled ? "Invoice settled" : "Invoice and payment"}</h2>
              {settled ? null : <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-neutral-500">The agency pays the property directly. A payment the agency declares is only an alert: find the money in the property account before recording the receipt.</p>}
            </div>
          </div>

          {!approved ? <div className="mt-4 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-900"><b>Owner review required.</b> Approve the booking request before issuing any invoice.</div> : settled ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {invoice ? <DocumentCard href={`/api/owner/nrms/agents/requests/${requestId}/invoices/${invoice.id}/pdf`} icon={<FileText className="h-4 w-4" />} kind="Invoice" number={invoice.number} detail={`${currency} ${money(invoice.quotedTotal)}`} /> : null}
            {latestPayment ? <DocumentCard href={`/api/owner/nrms/agents/requests/${requestId}/payments/${latestPayment.id}/receipt`} icon={<ReceiptText className="h-4 w-4" />} kind="Receipt" number={latestPayment.receiptNumber} detail={`${currency} ${money(latestPayment.amount)} on ${fmt(latestPayment.createdAt)}`} tone="emerald" /> : null}
          </div> : <>
            {invoice ? <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
              <InvoiceStat label="Invoice" value={invoice.number} detail={`Revision ${invoice.revision}`} />
              <InvoiceStat label="Amount" value={`${invoice.currency} ${money(invoice.quotedTotal)}`} detail={data.booking.financials.amountPaid > 0 ? `${currency} ${money(data.booking.financials.amountPaid)} received` : "Nothing received yet"} tone={data.booking.financials.amountPaid > 0 ? "ok" : "muted"} />
              <InvoiceStat label="Due" value={fmt(invoice.dueAt)} detail={dueLabel} tone={dueInDays < 0 ? "danger" : dueInDays <= 3 ? "warn" : "muted"} />
              <InvoiceStat label="Delivery" value={invoice.sentAt ? fmtDateTime(invoice.sentAt) : "Draft"} detail={invoice.sentAt ? `Sent to ${invoice.sentToEmail || "the agency"}` : "Not sent yet"} tone={invoice.sentAt ? "ok" : "warn"} />
            </div> : null}
            {invoice ? <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href={`/api/owner/nrms/agents/requests/${requestId}/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer" className={secondaryBtn}><Download className="h-4 w-4" /> Download {invoice.number}</a>
              {!invoice.sentAt ? <button type="button" disabled={commercialBusy !== null} onClick={() => void sendInvoice()} className={primaryBtn}>{commercialBusy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to agency</button> : null}
            </div> : null}

            {invoice?.payerMarkedPaidAt ? <div className="mt-5 rounded-xl border border-solid border-amber-300 bg-amber-50 p-4">
              <p className="m-0 text-sm font-bold text-amber-950">The agency declared this invoice paid</p>
              <p className="m-0 mt-1 text-sm leading-6 text-amber-900">Declared {fmt(invoice.payerMarkedPaidAt)}. Confirm the credit in the property account, then record it here.</p>
              <dl className="m-0 mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3"><Meta label="Paid by" value={ownerMethodLabel(invoice.payerPaymentMethod)} />{invoice.payerPaymentAccountName ? <Meta label="From account" value={invoice.payerPaymentAccountName} /> : null}{invoice.payerPaymentReference ? <Meta label="Their reference" value={invoice.payerPaymentReference} /> : null}</dl>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_190px_minmax(180px,1fr)_auto] lg:items-end">
                <Control label="Amount received"><input type="number" min="0.01" max={data.booking.financials.balance} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></Control>
                <Control label="Method"><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile money</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></Control>
                <Control label="Property reference"><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Bank or receipt reference" /></Control>
                <button type="button" disabled={commercialBusy !== null || Number(paymentAmount) <= 0} onClick={() => void confirmPayment()} className={primaryBtn}>{commercialBusy === "payment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />} Confirm received</button>
              </div>
            </div> : null}

            <details className="group mt-5 overflow-hidden rounded-xl border border-solid border-sky-200 bg-white transition-colors open:border-sky-300" open={!invoice}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-sky-50/70 px-4 py-3 transition-colors hover:bg-sky-100/70 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-sky-600 text-white shadow-sm"><FilePlus2 className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-sky-950">{invoice ? "Issue a revised invoice" : "Issue the invoice"}</span>
                    <span className="block text-xs text-sky-800/80">{invoice ? "Change the discount or pay-by date and replace the current invoice" : "Set any discount and the pay-by date"}</span>
                  </span>
                </span>
                <span className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-solid border-sky-300 bg-white px-3 py-1.5 text-xs font-bold text-sky-800">
                  <span className="group-open:hidden">Open</span><span className="hidden group-open:inline">Close</span>
                  <ArrowRight className="h-3.5 w-3.5 transition group-open:rotate-90" />
                </span>
              </summary>
              <div className="space-y-4 border-0 border-t border-solid border-sky-100 p-4 sm:p-5">
                {/* Row 1: what the desk decides */}
                <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_11rem]">
                  <Control label="Discount %"><input type="number" min="0" max="100" step="0.5" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} className="tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /></Control>
                  <Control label={discountPct > 0 ? "Discount reason (required)" : "Discount reason"}><input disabled={discountPct <= 0} value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} placeholder={discountPct > 0 ? "Why this rate was reduced, for example: repeat agency rate" : "No discount applied"} /></Control>
                  <div className="flex min-w-0 flex-col gap-1"><span className={fieldLabel}>Pay by</span><DatePickerField label="Invoice due date" value={dueAt} onChangeAction={setDueAt} allowPast={false} min={new Date().toISOString().slice(0, 10)} twoMonths={false} size="sm" widthClassName="w-full box-border" /></div>
                </div>

                {/* Row 2: the arithmetic in full, then the action */}
                <div className="flex flex-col gap-4 rounded-xl border border-solid border-neutral-200 bg-neutral-50/70 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <dl className="m-0 flex flex-wrap items-end gap-x-5 gap-y-3">
                    <div>
                      <dt className={fieldLabel}>Current total</dt>
                      <dd className="m-0 mt-1 text-base font-bold tabular-nums text-neutral-800">{currency} {money(grossTotal)}</dd>
                    </div>
                    <span className="pb-0.5 text-lg font-bold text-neutral-300" aria-hidden>−</span>
                    <div>
                      <dt className={fieldLabel}>Discount {discountPct > 0 ? `${discountPct}%` : ""}</dt>
                      <dd className={`m-0 mt-1 text-base font-bold tabular-nums ${discountPct > 0 ? "text-amber-700" : "text-neutral-400"}`}>{currency} {money(discountValue)}</dd>
                    </div>
                    <span className="pb-0.5 text-lg font-bold text-neutral-300" aria-hidden>=</span>
                    <div>
                      <dt className={`${fieldLabel} text-emerald-700`}>New invoice total</dt>
                      <dd className="m-0 mt-1 text-2xl font-extrabold tracking-tight tabular-nums text-emerald-800">{currency} {money(finalTotal)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-col items-stretch gap-1.5 lg:items-end">
                    <button type="button" disabled={commercialBusy !== null || finalTotal <= 0 || (discountPct > 0 && !discountReason.trim())} onClick={() => void generateInvoice()} className="box-border inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-sky-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {commercialBusy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} {invoice ? "Generate revision" : "Generate invoice"}
                    </button>
                    {discountPct > 0 && !discountReason.trim()
                      ? <span className="text-xs font-semibold text-amber-700">Add a reason for the discount first.</span>
                      : invoice
                        ? <span className="text-xs text-neutral-500">Replaces {invoice.number}. Send the new revision afterwards.</span>
                        : null}
                  </div>
                </div>
              </div>
            </details>
          </>}
        </section>

        {/* Travellers */}
        <div id="travellers" className="scroll-mt-4">
          {data.guests.length === 0 ? <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-neutral-300 bg-white p-6 sm:flex-row sm:items-center">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-neutral-100 text-neutral-500"><Users className="h-5 w-5" /></span>
            <div><h2 className="m-0 text-base font-extrabold text-neutral-800">No travellers yet</h2><p className="mb-0 mt-1 max-w-3xl text-sm leading-6 text-neutral-500">The agency has not submitted guest names or identity documents. This section fills in automatically as they do.</p></div>
          </section> : verified ? <VerifiedTravellerTable guests={data.guests} requestId={requestId} stays={data.rooms?.stays ?? []} /> : <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 px-1"><h2 className="m-0 text-base font-extrabold text-neutral-900">Travellers to review</h2><span className="text-xs font-semibold text-neutral-500">{data.guests.length} submitted</span></div>
            <div className="grid gap-3 lg:grid-cols-2">{data.guests.map((guest) => <section key={guest.id} className="rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-lg bg-neutral-100"><Users className="h-4 w-4 text-neutral-600" /></span><div><h3 className="m-0 text-sm font-extrabold text-neutral-900">{guest.fullName || "Traveller details in progress"}</h3><p className="m-0 mt-0.5 text-xs text-neutral-500">Room {guest.roomNumber} · {guest.guestType.toLowerCase()}{guest.isLead ? " · lead guest" : ""}</p></div></div>{guest.status === "ACCEPTED" ? <BadgeCheck className="h-5 w-5 text-emerald-600" /> : null}</div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-0 border-t border-solid border-neutral-100 pt-3"><Meta label="Nationality" value={guest.nationality || "Not provided"} /><Meta label="Date of birth" value={guest.dateOfBirth ? fmt(guest.dateOfBirth) : "Not provided"} /><Meta label="Document" value={guest.documentType && guest.documentNumber ? `${guest.documentType.replace(/_/g, " ")} · ${guest.documentNumber}` : "Not provided"} /><Meta label="Valid until" value={guest.documentExpiry ? fmt(guest.documentExpiry) : "Not provided"} /><Meta label="Phone" value={guest.phone || "Not provided"} /><Meta label="Email" value={guest.email || "Not provided"} /></dl>
              {guest.documentUploaded ? <a href={`/api/owner/nrms/agents/requests/${requestId}/guests/${guest.id}/document`} target="_blank" rel="noreferrer" className={`${secondaryBtn} mt-3`}><FileSearch className="h-4 w-4" /> Review protected document</a> : <span className="mt-3 inline-flex h-9 items-center rounded-lg bg-neutral-100 px-3 text-xs font-semibold text-neutral-500">Document not uploaded</span>}
              {reviewable ? <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-neutral-500">Correction for this traveller (only if needed)<textarea value={issues[guest.id] || ""} onChange={(event) => setIssues((current) => ({ ...current, [guest.id]: event.target.value }))} placeholder="Example: passport image is unreadable" className="mt-1 box-border min-h-16 w-full resize-y rounded-lg border border-solid border-neutral-200 p-2.5 text-sm font-normal normal-case tracking-normal text-neutral-800 outline-none focus:border-amber-400" /></label> : null}
            </section>)}</div>
          </div>}
        </div>

        {reviewable ? <section className="sticky bottom-3 z-10 rounded-2xl border border-solid border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional overall review note" className="box-border min-h-16 w-full resize-y rounded-lg border border-solid border-neutral-200 p-2.5 text-sm outline-none focus:border-emerald-400" /><div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={busy} onClick={() => void decide("RETURN")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-solid border-amber-300 bg-amber-50 px-4 text-xs font-bold text-amber-800"><RotateCcw className="h-4 w-4" /> Return for correction</button><button type="button" disabled={busy} onClick={() => void decide("VERIFY")} className={primaryBtn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Verify all travellers</button></div></section> : null}
      </div>

      {/* Sidebar: the facts, documents and rooms, read rather than worked */}
      <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
        <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="m-0 text-sm font-extrabold text-neutral-900">Booking details</h2>
          <dl className="m-0 mt-3 divide-y divide-neutral-100">
            <FactRow icon={<CalendarDays className="h-4 w-4" />} label="Stay" value={`${fmt(data.booking.checkIn)} to ${fmt(data.booking.checkOut)}`} detail={`${nights} night${nights === 1 ? "" : "s"}`} />
            <FactRow icon={<BedDouble className="h-4 w-4" />} label="Rooms" value={`${data.booking.rooms} room${data.booking.rooms === 1 ? "" : "s"}`} detail={data.booking.receiptNumber || "No voucher reference yet"} />
            <FactRow icon={<Users className="h-4 w-4" />} label="Travellers" value={`${data.booking.adults + data.booking.children} booked`} detail={`${data.booking.adults} adult${data.booking.adults === 1 ? "" : "s"}${data.booking.children ? ` · ${data.booking.children} child${data.booking.children === 1 ? "" : "ren"}` : ""}`} />
            <FactRow icon={<CreditCard className="h-4 w-4" />} label="Payment" value={`${currency} ${money(data.booking.financials.amountPaid)} received`} detail={settled ? "Paid in full" : `${currency} ${money(data.booking.financials.balance)} due`} />
          </dl>
        </section>

        <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="m-0 flex items-center gap-2 text-sm font-extrabold text-neutral-900"><WalletCards className="h-4 w-4 text-neutral-500" /> Food, drinks and extras</h2>
          <p className="m-0 mt-2 text-sm font-semibold text-neutral-800">{data.manifest.incidentalCover?.headline ?? "Not declared"}</p>
          <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">{data.manifest.incidentalCover?.detail ?? "The agency has not declared who pays for extras."}</p>
        </section>

        {data.rooms?.groupId ? <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="m-0 flex items-center gap-2 text-sm font-extrabold text-neutral-900"><BedDouble className="h-4 w-4 text-neutral-500" /> Rooms</h2>
          <p className="m-0 mt-2 text-xs leading-5 text-neutral-500">Split into individual stays under block <span className="font-mono">{data.rooms.blockReference}</span>.</p>
          <div className="mt-3 flex flex-col gap-2">
            <Link href={data.rooms.groupReference ? `/owner/nrms/groups?group=${encodeURIComponent(data.rooms.groupReference)}` : "/owner/nrms/groups"} className={`${secondaryBtn} justify-center`}>Open group workspace <ArrowRight className="h-4 w-4" /></Link>
            {/* A booking split before the double-charge was found still carries
                the duplicate room lines that reopened its bill. */}
            {!settled ? <button type="button" disabled={busy} onClick={() => void splitIntoRooms()} className={`${secondaryBtn} justify-center`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Re-check agency bill</button> : null}
          </div>
        </section> : null}
      </aside>
    </div>
  </div>;
}

/** The verified manifest as a register: one row per traveller, scannable down
 * a column, which is how a front desk actually reads a party of twelve. */
// One tint per sharing party, so a twelve-row register reads as the six parties
// it actually is. Solo travellers stay on white rather than being given a
// colour that would imply they are grouped with somebody.
const PARTY_TINTS = [
  { row: "bg-emerald-50/60", accent: "bg-emerald-500" },
  { row: "bg-sky-50/60", accent: "bg-sky-500" },
  { row: "bg-violet-50/60", accent: "bg-violet-500" },
  { row: "bg-amber-50/60", accent: "bg-amber-500" },
  { row: "bg-rose-50/60", accent: "bg-rose-500" },
  { row: "bg-teal-50/60", accent: "bg-teal-500" },
];

function VerifiedTravellerTable({ guests, requestId, stays }: { guests: Guest[]; requestId: string; stays: Data["rooms"] extends null ? never : NonNullable<Data["rooms"]>["stays"] }) {
  // No room column: a room number is assigned at the front desk, in the group
  // workspace. What the agency declared is only which travellers share, and
  // that is worth saying in names rather than in a party number nobody can
  // interpret at a glance.
  const columns = ["Traveller", "Type", "Sharing with", "Room", "Nationality", "Date of birth", "Identity document", "Valid until", "Phone", "Document"];
  const sharingWith = (guest: Guest) => guests
    .filter((other) => other.id !== guest.id && other.roomNumber === guest.roomNumber && other.fullName)
    .map((other) => other.fullName as string);

  // Parties in the order they appear, so the colours stay stable between loads.
  const partyOrder = [...new Set(guests.map((guest) => guest.roomNumber))];
  const partySize = new Map<number, number>();
  for (const guest of guests) partySize.set(guest.roomNumber, (partySize.get(guest.roomNumber) ?? 0) + 1);

  // Stable relational identity: every occupant carries the exact stay id.
  // Duplicate legal names can therefore never display another party's room.
  const stayFor = (guest: Guest) => guest.reservationId == null
    ? null
    : stays.find((stay) => stay.reservationId === guest.reservationId) ?? null;
  const assigned = stays.filter((stay) => stay.roomCode).length;
  return <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-200 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <BadgeCheck className="h-4 w-4 flex-none text-emerald-600" />
        <h2 className="m-0 text-sm font-extrabold text-neutral-900">Verified travellers</h2>
      </div>
      <span className="text-right text-[11px] font-bold text-neutral-500">{guests.length} on the manifest</span>
    </div>
    <p className="m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2 text-[11px] leading-4 text-neutral-500">
      Travellers sharing a room carry the same colour. {stays.length === 0
        ? "Room numbers appear here once the booking is split into individual stays."
        : `Rooms are chosen in the group workspace and appear here: ${assigned} of ${stays.length} assigned.`}
    </p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50 text-[9px] font-extrabold uppercase tracking-[0.1em] text-neutral-500">
            {columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-2.5 font-extrabold">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => {
            const sharers = sharingWith(guest);
            const shares = (partySize.get(guest.roomNumber) ?? 1) > 1;
            const tint = shares ? PARTY_TINTS[partyOrder.indexOf(guest.roomNumber) % PARTY_TINTS.length] : null;
            const stay = stayFor(guest);
            return <tr key={guest.id} className={`border-0 border-b border-solid border-neutral-100 last:border-b-0 ${tint?.row ?? ""}`}>
            <td className="relative whitespace-nowrap px-4 py-2.5">
              {tint ? <span className={`absolute inset-y-0 left-0 w-1 ${tint.accent}`} aria-hidden /> : null}
              <span className="block font-bold text-neutral-900">{guest.fullName || "Not provided"}</span>
              {guest.isLead ? <span className="mt-0.5 block text-[10px] font-bold text-emerald-700">Lead guest</span> : null}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${guest.guestType === "CHILD" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>{guest.guestType === "CHILD" ? "Child" : "Adult"}</span>
            </td>
            <td className="px-4 py-2.5 text-neutral-700" title={sharers.join(", ")}>
              {sharers.length === 0
                ? <span className="text-neutral-400">Room to themselves</span>
                : sharers.length === 1
                  ? sharers[0]
                  : <>{sharers[0]} <span className="text-neutral-400">and {sharers.length - 1} more</span></>}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              {/* Fills in by itself: the room is chosen in the group workspace,
                  and this reads the stay that party was split into. */}
              {stay?.roomCode
                ? <span className="box-border inline-flex items-center gap-1 rounded-md border border-solid border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-bold text-neutral-800"><BedDouble className="h-3 w-3 text-neutral-400" />{stay.roomCode}</span>
                : stay
                  ? <span className="text-[11px] font-semibold text-amber-700">Not assigned</span>
                  : <span className="text-[11px] font-semibold text-neutral-400">Not split yet</span>}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">{guest.nationality || "Not provided"}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">{guest.dateOfBirth ? fmt(guest.dateOfBirth) : "Not provided"}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">{guest.documentType && guest.documentNumber ? `${guest.documentType.replace(/_/g, " ")} · ${guest.documentNumber}` : "Not provided"}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">{guest.documentExpiry ? fmt(guest.documentExpiry) : "Not provided"}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">{guest.phone || "Not provided"}</td>
            <td className="whitespace-nowrap px-4 py-2.5">
              {guest.documentUploaded
                ? <a href={`/api/owner/nrms/agents/requests/${requestId}/guests/${guest.id}/document`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 no-underline hover:underline"><FileSearch className="h-3.5 w-3.5" /> Open</a>
                : <span className="text-[11px] font-semibold text-neutral-400">Not uploaded</span>}
            </td>
          </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}

function DocumentCard({ href, icon, kind, number, detail, tone = "neutral" }: { href: string; icon: ReactNode; kind: string; number: string; detail: string; tone?: "neutral" | "emerald" }) {
  const accent = tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-900 text-white";
  return <a href={href} target="_blank" rel="noreferrer" className="group flex min-w-0 items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-3 no-underline transition hover:border-neutral-400 hover:shadow-sm">
    <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${accent}`}>{icon}</span>
    <span className="min-w-0 flex-1">
      <span className={`block ${fieldLabel}`}>{kind}</span>
      <b className="mt-0.5 block truncate text-[13px] font-extrabold text-neutral-950">{number}</b>
      <span className="mt-0.5 block truncate text-[11px] font-semibold text-neutral-500">{detail}</span>
    </span>
    <Download className="h-4 w-4 flex-none text-neutral-400 transition group-hover:text-neutral-900" />
  </a>;
}

const invoiceStatTones = { muted: "text-neutral-500", ok: "text-emerald-700", warn: "text-amber-700", danger: "text-rose-700" } as const;

function InvoiceStat({ label, value, detail, tone = "muted" }: { label: string; value: string; detail: string; tone?: keyof typeof invoiceStatTones }) {
  return <div className="min-w-0 bg-white px-4 py-3.5">
    <span className={`block ${fieldLabel}`}>{label}</span>
    <b className="mt-1 block break-words text-sm font-extrabold leading-5 tracking-tight text-neutral-950">{value}</b>
    <span className={`mt-0.5 block break-words text-xs font-semibold leading-4 ${invoiceStatTones[tone]}`}>{detail}</span>
  </div>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</dt><dd className="m-0 mt-0.5 break-words text-[13px] font-semibold text-neutral-700">{value}</dd></div>; }

const pillTones = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  muted: "bg-neutral-100 text-neutral-600 ring-neutral-200",
} as const;

function StatusPill({ tone, children }: { tone: keyof typeof pillTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ${pillTones[tone]}`}>{children}</span>;
}

/** One quiet line in the sidebar: an icon, what it is, and the value. */
function FactRow({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <div className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
    <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-neutral-100 text-neutral-500">{icon}</span>
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</dt>
      <dd className="m-0 mt-0.5 break-words text-sm font-semibold text-neutral-900">{value}</dd>
      <dd className="m-0 mt-0.5 break-words text-xs text-neutral-500">{detail}</dd>
    </div>
  </div>;
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-500">{label}<span className="[&>input]:box-border [&>input]:h-10 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:border-solid [&>input]:border-neutral-200 [&>input]:bg-white [&>input]:px-3 [&>input]:text-xs [&>input]:font-semibold [&>input]:normal-case [&>input]:tracking-normal [&>input]:text-neutral-900 [&>input]:shadow-sm [&>input]:outline-none [&>input]:transition [&>input::placeholder]:font-normal [&>input::placeholder]:text-neutral-400 [&>input:focus]:border-emerald-500 [&>input:focus]:ring-2 [&>input:focus]:ring-emerald-100 [&>input:disabled]:bg-neutral-100 [&>input:disabled]:text-neutral-400 [&>select]:box-border [&>select]:h-10 [&>select]:w-full [&>select]:rounded-xl [&>select]:border [&>select]:border-solid [&>select]:border-neutral-200 [&>select]:bg-white [&>select]:px-3 [&>select]:text-xs [&>select]:font-semibold [&>select]:normal-case [&>select]:tracking-normal [&>select]:text-neutral-900 [&>select]:shadow-sm [&>select]:outline-none [&>select:focus]:border-emerald-500 [&>select:focus]:ring-2 [&>select:focus]:ring-emerald-100">{children}</span></label>;
}
