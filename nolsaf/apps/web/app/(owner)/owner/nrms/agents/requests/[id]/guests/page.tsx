"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { ArrowLeft, BadgeCheck, BedDouble, CalendarDays, CreditCard, Download, FilePlus2, FileSearch, FileText, Loader2, ReceiptText, RotateCcw, Send, ShieldCheck, Users, WalletCards } from "lucide-react";

type Guest = { id: number; roomNumber: number; guestType: string; isLead: boolean; fullName: string | null; phone: string | null; email: string | null; nationality: string | null; dateOfBirth: string | null; documentType: string | null; documentNumber: string | null; documentExpiry: string | null; documentUploaded: boolean; status: string; reviewNote: string | null };
type Data = {
  booking: { id: number; status: string; agency: { legalName: string; tradingName: string | null } | null; property: { title: string }; checkIn: string; checkOut: string; adults: number; children: number; rooms: number; receiptNumber: string | null; financials: { currency: string; total: number; amountPaid: number; balance: number; status: string; invoice: Invoice | null; payments: Array<{ id: number; amount: number; method: string; reference: string | null; receiptNumber: string; createdAt: string }> } };
  manifest: { status: string; incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST" | null; requiredGuests: number; guestsAdded: number; reviewNote: string | null };
  guests: Guest[];
};
type Invoice = { id: number; number: string; revision: number; status: string; currency: string; quotedTotal: number; paidNow: number; liveBalance: number; dueAt: string; sentAt: string | null; sentToEmail: string | null; payerMarkedPaidAt: string | null; payerPaymentReference: string | null; payerPaymentMethod: string | null; payerPaymentAccountName: string | null };

const fmt = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const stayNights = (checkIn: string, checkOut: string) => Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
const money = (value: number) => Math.round(value).toLocaleString();
const fieldLabel = "text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-500";
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

export default function HotelAgentManifestReviewPage() {
  const params = useParams<{ id: string }>();
  const requestId = Number(params.id);
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
  useEffect(() => { if (requestId > 0) void load(); }, [load, requestId]);

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
      await apiClient.post(`/api/owner/nrms/agents/requests/${requestId}/payments/confirm`, { amount: Number(paymentAmount), method: paymentMethod, reference: paymentReference.trim() || undefined, idempotencyKey: `agent-${requestId}-${Date.now()}` });
      setNotice("Payment receipt recorded. The voucher was released and traveller entry is now open."); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "The payment could not be confirmed"); }
    finally { setCommercialBusy(null); }
  };

  if (!data && !error) return <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading secure guest manifest…</div>;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  const reviewable = data.manifest.status === "SUBMITTED";
  const progress = data.manifest.requiredGuests > 0 ? Math.min(100, Math.round((data.manifest.guestsAdded / data.manifest.requiredGuests) * 100)) : 0;

  const paymentStatus = data.booking.financials.balance <= 0 && data.booking.financials.total > 0 ? "Paid in full" : data.booking.financials.invoice?.payerMarkedPaidAt ? "Agency says paid · verify account" : data.booking.financials.invoice?.sentAt ? "Invoice sent" : data.booking.financials.invoice ? "Invoice draft" : "Awaiting invoice";
  const invoice = data.booking.financials.invoice;
  const settled = data.booking.financials.status === "SETTLED";
  // Receipts are issued per payment; the newest one is the settling receipt.
  const latestPayment = data.booking.financials.payments.length > 0
    ? [...data.booking.financials.payments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;
  const dueInDays = invoice ? daysFromToday(invoice.dueAt) : 0;
  const dueLabel = dueInDays === 0 ? "Falls due today" : dueInDays > 0 ? `${dueInDays} day${dueInDays === 1 ? "" : "s"} from today` : `Overdue by ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? "" : "s"}`;

  return <div className="flex w-full min-w-0 flex-col gap-4 pb-8">
    <Link href="/owner/nrms/agents/requests" className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-neutral-500 no-underline hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Agent bookings</Link>
    <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
        <div className="flex min-w-0 items-start gap-3.5"><span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span><div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Secure identity review</p><h1 className="m-0 mt-1 truncate text-xl font-extrabold text-neutral-950 sm:text-2xl">{data.booking.agency?.tradingName || data.booking.agency?.legalName || "Travel agency"}</h1><p className="m-0 mt-1 text-[13px] text-neutral-500">Agent booking for <b className="font-semibold text-neutral-700">{data.booking.property.title}</b></p></div></div>
        <div className="rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-3.5"><div className="flex items-center justify-between gap-3"><div><span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">Traveller readiness</span><b className="mt-1 block text-sm text-neutral-900">{data.manifest.guestsAdded} of {data.manifest.requiredGuests} complete</b></div><span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${data.manifest.status === "VERIFIED" ? "bg-emerald-100 text-emerald-700" : data.manifest.status === "SUBMITTED" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{data.manifest.status.replace(/_/g, " ")}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200"><span className="block h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} /></div></div>
      </div>
      <div className="grid grid-cols-1 border-0 border-t border-solid border-neutral-200 bg-neutral-50/70 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCell tone="sky" icon={<CalendarDays className="h-4 w-4" />} label="Stay dates" value={`${fmt(data.booking.checkIn)} → ${fmt(data.booking.checkOut)}`} detail={`${stayNights(data.booking.checkIn, data.booking.checkOut)} night${stayNights(data.booking.checkIn, data.booking.checkOut) === 1 ? "" : "s"}`} />
        <SummaryCell tone="violet" icon={<BedDouble className="h-4 w-4" />} label="Rooms & reference" value={`${data.booking.rooms} room${data.booking.rooms === 1 ? "" : "s"}`} detail={data.booking.receiptNumber || `Request #${data.booking.id}`} />
        <SummaryCell tone="amber" icon={<Users className="h-4 w-4" />} label="Booked occupancy" value={`${data.booking.adults + data.booking.children} travellers`} detail={`${data.booking.adults} adult${data.booking.adults === 1 ? "" : "s"}${data.booking.children ? ` · ${data.booking.children} child${data.booking.children === 1 ? "" : "ren"}` : ""}`} />
        <SummaryCell tone="emerald" icon={<CreditCard className="h-4 w-4" />} label="Payment" value={`${data.booking.financials.currency} ${money(data.booking.financials.amountPaid)} received`} detail={`${paymentStatus} · ${data.booking.financials.currency} ${money(data.booking.financials.balance)} due`} />
        <SummaryCell tone="rose" icon={<WalletCards className="h-4 w-4" />} label="Food, drinks & extras" value={data.manifest.incidentalBilling === "AGENCY" ? "Agency covers charges" : "Guests settle individually"} detail="Declared billing responsibility" />
      </div>
    </section>
    {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div> : null}
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

    <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Commercial review</p><h2 className="m-0 mt-1 text-lg font-extrabold text-neutral-950">{settled ? "Settled and receipted" : "Invoice and property-direct settlement"}</h2>{settled ? null : <p className="m-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500">Approve the stay, decide any discount, and issue the property invoice. An agency payment declaration is an alert only. You must verify the receiving account before recording the receipt.</p>}</div>{data.booking.financials.invoice && !settled ? <a href={`/api/owner/nrms/agents/requests/${requestId}/invoices/${data.booking.financials.invoice.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-10 flex-none items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 px-3 text-xs font-bold text-neutral-700 no-underline"><Download className="h-4 w-4" /> {data.booking.financials.invoice.number}</a> : null}</div>
      {data.booking.status !== "CONFIRMED" ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><b>Owner review required.</b> Approve the booking request before issuing any invoice.</div> : settled ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.booking.financials.invoice ? <DocumentCard href={`/api/owner/nrms/agents/requests/${requestId}/invoices/${data.booking.financials.invoice.id}/pdf`} icon={<FileText className="h-4 w-4" />} kind="Invoice" number={data.booking.financials.invoice.number} detail={`${data.booking.financials.currency} ${money(data.booking.financials.invoice.quotedTotal)}`} /> : null}
        {latestPayment ? <DocumentCard href={`/api/owner/nrms/agents/requests/${requestId}/payments/${latestPayment.id}/receipt`} icon={<ReceiptText className="h-4 w-4" />} kind="Receipt" number={latestPayment.receiptNumber} detail={`${data.booking.financials.currency} ${money(latestPayment.amount)} on ${fmt(latestPayment.createdAt)}`} tone="emerald" /> : null}
      </div> : <>
        <div className="mt-4 flex flex-wrap items-end gap-2.5 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-3">
          <div className="w-full sm:w-28"><Control label="Discount %"><input type="number" min="0" max="100" step="0.5" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} className="tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /></Control></div>
          <div className="w-full min-w-0 flex-1 sm:min-w-[220px]"><Control label="Discount reason"><input disabled={discountPct <= 0} value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} placeholder={discountPct > 0 ? "Why this rate was reduced" : "No discount applied"} /></Control></div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-48"><span className={fieldLabel}>Total after discount</span><div className="box-border flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-3"><b className="truncate text-xs font-extrabold tabular-nums text-emerald-900">{data.booking.financials.currency} {money(finalTotal)}</b>{discountPct > 0 ? <span className="flex-none text-[10px] font-bold tabular-nums text-emerald-700">{money(discountValue)} off</span> : null}</div></div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-44"><span className={fieldLabel}>Pay by</span><DatePickerField label="Invoice due date" value={dueAt} onChangeAction={setDueAt} allowPast={false} min={new Date().toISOString().slice(0, 10)} twoMonths={false} size="sm" widthClassName="w-full box-border" /></div>
          <button disabled={commercialBusy !== null || finalTotal <= 0 || (discountPct > 0 && !discountReason.trim())} onClick={() => void generateInvoice()} className="box-border inline-flex h-10 w-full flex-none items-center justify-center gap-1.5 rounded-xl bg-neutral-950 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-neutral-800 disabled:opacity-50 sm:w-auto">{commercialBusy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} {data.booking.financials.invoice ? "Generate revision" : "Generate invoice"}</button>
        </div>
        {invoice ? <div className="mt-3 grid gap-4 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
          <div className="grid gap-4 sm:grid-cols-3">
            <InvoiceStat label="Final invoice" value={`${invoice.currency} ${money(invoice.quotedTotal)}`} detail={`Revision ${invoice.revision}`} />
            <InvoiceStat label="Due" value={fmt(invoice.dueAt)} detail={dueLabel} tone={dueInDays < 0 ? "danger" : dueInDays <= 3 ? "warn" : "muted"} />
            <InvoiceStat label="Delivery" value={invoice.sentAt ? fmtDateTime(invoice.sentAt) : "Draft"} detail={invoice.sentAt ? `Sent to ${invoice.sentToEmail || "the agency"}` : "Not sent to the agency yet"} tone={invoice.sentAt ? "ok" : "warn"} />
          </div>
          {!invoice.sentAt ? <button disabled={commercialBusy !== null} onClick={() => void sendInvoice()} className="box-border inline-flex h-10 w-full flex-none items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50 md:w-auto">{commercialBusy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to agency</button> : null}
        </div> : null}
        {data.booking.financials.invoice?.payerMarkedPaidAt ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="mb-3"><b className="text-sm text-amber-950">Agency declared this invoice paid</b><p className="m-0 mt-1 text-xs text-amber-800">Declared {fmt(data.booking.financials.invoice.payerMarkedPaidAt)}. This is the agency's claim only. Find the credit in the property account before recording the receipt.</p><dl className="m-0 mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-3"><Meta label="Agency says paid by" value={ownerMethodLabel(data.booking.financials.invoice.payerPaymentMethod)} />{data.booking.financials.invoice.payerPaymentAccountName ? <Meta label="From account" value={data.booking.financials.invoice.payerPaymentAccountName} /> : null}{data.booking.financials.invoice.payerPaymentReference ? <Meta label="Reference" value={data.booking.financials.invoice.payerPaymentReference} /> : null}</dl></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[180px_190px_minmax(180px,1fr)_auto] lg:items-end"><Control label="Amount received"><input type="number" min="0.01" max={data.booking.financials.balance} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></Control><Control label="Method"><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile money</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></Control><Control label="Property reference"><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Bank / receipt reference" /></Control><button disabled={commercialBusy !== null || Number(paymentAmount) <= 0} onClick={() => void confirmPayment()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white disabled:opacity-50">{commercialBusy === "payment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />} Confirm received</button></div></div> : null}
      </>}
    </section>

    {data.guests.length === 0 ? <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-solid border-neutral-300 bg-white p-5 sm:flex-row sm:items-center"><span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-neutral-100 text-neutral-500"><ReceiptText className="h-5 w-5" /></span><div><h2 className="m-0 text-base font-extrabold text-neutral-800">Traveller details have not been started</h2><p className="mb-0 mt-1 max-w-3xl text-[13px] leading-5 text-neutral-500">The booking is secured, but the agency has not submitted guest names or identity documents yet. This page will populate automatically as their manifest progresses.</p></div></section> : <div className="grid gap-3 lg:grid-cols-2">{data.guests.map((guest) => <section key={guest.id} className="rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100"><Users className="h-4 w-4 text-neutral-600" /></span><div><h2 className="m-0 text-sm font-extrabold text-neutral-900">{guest.fullName || "Traveller details in progress"}</h2><p className="m-0 mt-0.5 text-[10px] text-neutral-500">Room {guest.roomNumber} · {guest.guestType.toLowerCase()}{guest.isLead ? " · lead guest" : ""}</p></div></div>{guest.status === "ACCEPTED" ? <BadgeCheck className="h-5 w-5 text-emerald-600" /> : null}</div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-0 border-t border-solid border-neutral-100 pt-3"><Meta label="Nationality" value={guest.nationality || "Not provided"} /><Meta label="Date of birth" value={guest.dateOfBirth ? fmt(guest.dateOfBirth) : "Not provided"} /><Meta label="Document" value={guest.documentType && guest.documentNumber ? `${guest.documentType.replace(/_/g, " ")} · ${guest.documentNumber}` : "Not provided"} /><Meta label="Valid until" value={guest.documentExpiry ? fmt(guest.documentExpiry) : "Not provided"} /><Meta label="Phone" value={guest.phone || "Not provided"} /><Meta label="Email" value={guest.email || "Not provided"} /></dl>
      {guest.documentUploaded ? <a href={`/api/owner/nrms/agents/requests/${requestId}/guests/${guest.id}/document`} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 no-underline hover:border-neutral-400"><FileSearch className="h-4 w-4" /> Review protected document</a> : <span className="mt-3 inline-flex h-9 items-center rounded-lg bg-neutral-100 px-3 text-xs font-semibold text-neutral-500">Document not uploaded</span>}
      {reviewable ? <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Correction for this traveller (only if needed)<textarea value={issues[guest.id] || ""} onChange={(event) => setIssues((current) => ({ ...current, [guest.id]: event.target.value }))} placeholder="Example: passport image is unreadable" className="mt-1 min-h-16 w-full resize-y rounded-lg border border-solid border-neutral-200 p-2.5 text-xs font-normal normal-case tracking-normal text-neutral-800 outline-none focus:border-amber-400" /></label> : null}
    </section>)}</div>}

    {reviewable ? <section className="sticky bottom-3 z-10 rounded-2xl border border-solid border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional overall review note" className="min-h-16 w-full resize-y rounded-lg border border-solid border-neutral-200 p-2.5 text-xs outline-none focus:border-emerald-400" /><div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button disabled={busy} onClick={() => void decide("RETURN")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 text-xs font-bold text-amber-800"><RotateCcw className="h-4 w-4" /> Return for correction</button><button disabled={busy} onClick={() => void decide("VERIFY")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Verify all travellers</button></div></section> : null}
  </div>;
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
  return <div className="min-w-0">
    <span className={`block ${fieldLabel}`}>{label}</span>
    <b className="mt-1 block break-words text-sm font-extrabold leading-5 tracking-tight text-neutral-950">{value}</b>
    <span className={`mt-0.5 block break-words text-[11px] font-semibold leading-4 ${invoiceStatTones[tone]}`}>{detail}</span>
  </div>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</dt><dd className="m-0 mt-0.5 break-words text-[11px] font-semibold text-neutral-700">{value}</dd></div>; }

// Each summary cell carries its own hue so the five facts stay tellable apart
// at a glance. The colour marks the category, never the value's status.
const summaryTones = {
  sky: { chip: "bg-sky-50 text-sky-700 ring-sky-200", label: "text-sky-700" },
  violet: { chip: "bg-violet-50 text-violet-700 ring-violet-200", label: "text-violet-700" },
  amber: { chip: "bg-amber-50 text-amber-700 ring-amber-200", label: "text-amber-700" },
  emerald: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "text-emerald-700" },
  rose: { chip: "bg-rose-50 text-rose-700 ring-rose-200", label: "text-rose-700" },
} as const;

function SummaryCell({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: keyof typeof summaryTones }) {
  const palette = summaryTones[tone];
  return <div className="flex min-w-0 items-start gap-3 border-0 border-b border-solid border-neutral-200 p-4 last:border-b-0 md:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"><span className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg shadow-sm ring-1 ${palette.chip}`}>{icon}</span><div className="min-w-0"><span className={`block text-[9px] font-bold uppercase tracking-[0.08em] ${palette.label}`}>{label}</span><b className="mt-1 block break-words text-[12px] text-neutral-800">{value}</b><span className="mt-0.5 block break-words text-[10px] leading-4 text-neutral-500">{detail}</span></div></div>;
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-500">{label}<span className="[&>input]:box-border [&>input]:h-10 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:border-solid [&>input]:border-neutral-200 [&>input]:bg-white [&>input]:px-3 [&>input]:text-xs [&>input]:font-semibold [&>input]:normal-case [&>input]:tracking-normal [&>input]:text-neutral-900 [&>input]:shadow-sm [&>input]:outline-none [&>input]:transition [&>input::placeholder]:font-normal [&>input::placeholder]:text-neutral-400 [&>input:focus]:border-emerald-500 [&>input:focus]:ring-2 [&>input:focus]:ring-emerald-100 [&>input:disabled]:bg-neutral-100 [&>input:disabled]:text-neutral-400 [&>select]:box-border [&>select]:h-10 [&>select]:w-full [&>select]:rounded-xl [&>select]:border [&>select]:border-solid [&>select]:border-neutral-200 [&>select]:bg-white [&>select]:px-3 [&>select]:text-xs [&>select]:font-semibold [&>select]:normal-case [&>select]:tracking-normal [&>select]:text-neutral-900 [&>select]:shadow-sm [&>select]:outline-none [&>select:focus]:border-emerald-500 [&>select:focus]:ring-2 [&>select:focus]:ring-emerald-100">{children}</span></label>;
}
