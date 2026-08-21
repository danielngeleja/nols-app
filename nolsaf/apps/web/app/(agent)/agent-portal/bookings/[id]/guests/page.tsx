"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import PaymentDeclarationModal, { type PaymentDeclaration } from "../../../_components/PaymentDeclarationModal";
import { ArrowLeft, BadgeCheck, BedDouble, CalendarDays, Check, CheckCircle2, Clock3, Download, FileCheck2, FileText, Loader2, LockKeyhole, ReceiptText, Save, ShieldCheck, Upload, UserRound, Users } from "lucide-react";

type Guest = {
  clientKey: string; id?: number; roomNumber: number; guestType: "ADULT" | "CHILD"; isLead: boolean;
  fullName: string; phone: string; email: string; nationality: string; dateOfBirth: string;
  documentType: "PASSPORT" | "NATIONAL_ID" | "OTHER"; documentNumber: string; documentExpiry: string;
  documentKey: string; documentMimeType: string; documentResourceType: "image" | "raw";
  status?: string; reviewNote?: string | null;
};
type Invoice = { id: number; number: string; revision: number; status: string; paymentStatus: string; currency: string; quotedTotal: number; paidNow: number; liveBalance: number; dueAt: string; sentAt: string | null; payerMarkedPaidAt: string | null; payerPaymentReference: string | null; payerPaymentMethod: string | null; payerPaymentAccountName: string | null };
type Payload = {
  booking: { id: number; status: string; property: { title: string } | null; checkIn: string; checkOut: string; adults: number; children: number; rooms: number; receiptNumber: string | null; payment: null };
  commercial: { status: string; settled: boolean; received: number; invoice: Invoice | null; invoices: Invoice[]; payments: Array<{ id: number; amount: number; method: string; reference: string | null; receiptNumber: string; createdAt: string }> };
  manifest: { status: string; incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST"; requiredGuests: number; guestsAdded: number; documentsUploaded: number; reviewNote: string | null };
  guests: Array<Omit<Guest, "clientKey">>;
  editable: boolean;
};

const blankGuest = (index: number, adults: number, rooms: number): Guest => ({
  clientKey: `${Date.now()}-${index}`, roomNumber: index < adults ? (index % rooms) + 1 : ((index - adults) % rooms) + 1,
  guestType: index < adults ? "ADULT" : "CHILD", isLead: index === 0, fullName: "", phone: "", email: "", nationality: "", dateOfBirth: "",
  documentType: "PASSPORT", documentNumber: "", documentExpiry: "", documentKey: "", documentMimeType: "", documentResourceType: "image",
});
const complete = (guest: Guest) => Boolean(guest.fullName.trim() && guest.nationality.trim() && guest.dateOfBirth && guest.documentNumber.trim() && guest.documentKey);

const METHOD_LABELS: Record<string, string> = { BANK: "Bank transfer", CARD: "Card", MOBILE: "Mobile money", CASH: "Cash" };
const methodLabel = (value: string | null) => (value ? METHOD_LABELS[value] ?? value : "Not stated");
const fmt = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const money = (value: number) => Math.round(value).toLocaleString();
// dueAt is a date-only column, so compare the stored calendar date directly
// rather than building a Date that a timezone could shift a day either way.
const daysFromToday = (value: string) => {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return 0;
  const now = new Date();
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
};

export default function AgentGuestManifestPage() {
  const params = useParams<{ id: string }>();
  const bookingId = Number(params.id);
  const [data, setData] = useState<Payload | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [incidentalBilling, setIncidentalBilling] = useState<"AGENCY" | "INDIVIDUAL_GUEST">("INDIVIDUAL_GUEST");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [declaring, setDeclaring] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<Payload>(`/api/agent-portal/bookings/${bookingId}/manifest`);
      const next = response.data;
      setData(next); setIncidentalBilling(next.manifest.incidentalBilling || "INDIVIDUAL_GUEST");
      const loaded = next.guests.map((guest, index) => ({ ...guest, clientKey: `saved-${guest.id ?? index}`, fullName: guest.fullName ?? "", phone: guest.phone ?? "", email: guest.email ?? "", nationality: guest.nationality ?? "", dateOfBirth: guest.dateOfBirth ?? "", documentNumber: guest.documentNumber ?? "", documentKey: guest.documentKey ?? "", documentExpiry: guest.documentExpiry ?? "", documentMimeType: guest.documentMimeType ?? "" }));
      while (loaded.length < next.manifest.requiredGuests) loaded.push(blankGuest(loaded.length, next.booking.adults, next.booking.rooms));
      setGuests(loaded); setError(null);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Traveller details could not be loaded"); }
  }, [bookingId]);
  useEffect(() => { if (Number.isInteger(bookingId) && bookingId > 0) void load(); }, [bookingId, load]);

  const completedCount = useMemo(() => guests.filter(complete).length, [guests]);
  const update = (key: string, patch: Partial<Guest>) => setGuests((current) => current.map((guest) => guest.clientKey === key ? { ...guest, ...patch } : guest));

  const uploadDocument = async (guest: Guest, file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Identity documents must be 2 MB or smaller"); return; }
    setUploading(guest.clientKey); setError(null);
    try {
      const folder = `agent-traveller-documents/booking-${bookingId}`;
      const form = new FormData(); form.append("file", file); form.append("folder", folder);
      const response = await apiClient.post<any>(`/api/uploads/cloudinary/upload?folder=${encodeURIComponent(folder)}`, form);
      const mime = file.type || "application/pdf";
      update(guest.clientKey, { documentKey: response.data?.public_id, documentMimeType: mime, documentResourceType: response.data?.resource_type === "raw" ? "raw" : "image" });
      setNotice("Protected identity document uploaded. Save the draft to attach it to this traveller.");
    } catch (cause: any) { setError(cause?.response?.data?.message || cause?.response?.data?.error || "The identity document could not be uploaded"); }
    finally { setUploading(null); }
  };

  const save = async (submit: boolean) => {
    if (!data) return;
    if (submit && guests.filter(complete).length !== data.manifest.requiredGuests) { setError(`Complete all ${data.manifest.requiredGuests} traveller records before submitting.`); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await apiClient.put<any>(`/api/agent-portal/bookings/${bookingId}/manifest`, {
        incidentalBilling, submit,
        guests: guests.map(({ clientKey: _clientKey, id: _id, status: _status, reviewNote: _reviewNote, ...guest }) => ({ ...guest, fullName: guest.fullName || null, phone: guest.phone || null, email: guest.email || null, nationality: guest.nationality || null, dateOfBirth: guest.dateOfBirth || null, documentNumber: guest.documentNumber || null, documentKey: guest.documentKey || null, documentExpiry: guest.documentExpiry || null, documentMimeType: guest.documentMimeType || null })),
      });
      setNotice(response.data?.message || (submit ? "Sent to the hotel for verification." : "Traveller details saved.")); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Traveller details could not be saved"); }
    finally { setBusy(false); }
  };

  const markInvoicePaid = async (declaration: PaymentDeclaration) => {
    const invoice = data?.commercial.invoice; if (!invoice) return;
    setMarkingPaid(true); setError(null); setNotice(null);
    try {
      const response = await apiClient.post(`/api/agent-portal/bookings/${bookingId}/invoices/${invoice.id}/mark-paid`, {
        reference: declaration.reference,
        method: declaration.method,
        ...(declaration.method === "CASH" ? {} : { accountName: declaration.accountName }),
      });
      setNotice(response.data?.message || "Payment declared to the hotel.");
      setDeclaring(false);
      await load();
    }
    catch (cause: any) { setError(cause?.response?.data?.error || "The payment declaration could not be saved"); }
    finally { setMarkingPaid(false); }
  };

  if (!data && !error) return <div className="flex w-full items-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading booking workspace…</div>;
  if (!data) return <div className="w-full rounded-xl border border-solid border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  const locked = !data.editable;
  const invoice = data.commercial.invoice;
  const manifestTone = data.manifest.status === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : data.manifest.status === "CHANGES_REQUESTED" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600";
  const dueInDays = invoice ? daysFromToday(invoice.dueAt) : 0;
  const dueLabel = dueInDays === 0 ? "Falls due today" : dueInDays > 0 ? `${dueInDays} day${dueInDays === 1 ? "" : "s"} from today` : `Overdue by ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? "" : "s"}`;

  return <div className="flex w-full min-w-0 flex-col gap-3 pb-8">
    <Link href="/agent-portal/bookings" className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-neutral-500 no-underline hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> My bookings</Link>
    <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,.75fr)]">
      <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3"><span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Users className="h-5 w-5" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">Agent booking workspace</p><h1 className="m-0 mt-1 truncate text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl">{data.booking.property?.title ?? "Hotel booking"}</h1><p className="m-0 mt-1 text-xs text-neutral-500">Request #{data.booking.id}{data.booking.receiptNumber ? ` · ${data.booking.receiptNumber}` : ""}</p></div></div>
          <div className="flex flex-wrap gap-1.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${data.commercial.settled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{data.commercial.settled ? "PAYMENT CONFIRMED" : data.commercial.status.replace(/_/g, " ")}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${manifestTone}`}>{data.manifest.status.replace(/_/g, " ")}</span></div>
        </div>
        <div className="mt-auto grid grid-cols-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/70 sm:grid-cols-4">
          <BookingStat icon={<CalendarDays />} label="Stay" value={`${fmt(data.booking.checkIn)} to ${fmt(data.booking.checkOut)}`} />
          <BookingStat icon={<BedDouble />} label="Rooms" value={`${data.booking.rooms} room${data.booking.rooms === 1 ? "" : "s"}`} />
          <BookingStat icon={<UserRound />} label="Travellers" value={`${data.booking.adults} adult${data.booking.adults === 1 ? "" : "s"}${data.booking.children ? ` · ${data.booking.children} child${data.booking.children === 1 ? "" : "ren"}` : ""}`} />
          <BookingStat icon={<ReceiptText />} label="Hotel extras" value={data.manifest.incidentalBilling === "AGENCY" ? "Agency account" : "Guests settle"} />
        </div>
      </section>
      <section className="min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-neutral-100 text-neutral-700"><FileText className="h-5 w-5" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">Property invoice</p><h2 className="m-0 mt-1 truncate text-base font-extrabold text-neutral-950">{invoice?.number || (data.booking.status === "PENDING" ? "Hotel review pending" : "Invoice not issued yet")}</h2></div></div>{invoice ? <a href={`/api/agent-portal/bookings/${bookingId}/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer" aria-label="Open invoice PDF" className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-solid border-neutral-200 text-neutral-600 no-underline hover:bg-neutral-50"><Download className="h-4 w-4" /></a> : null}</div>
        {invoice ? <div className="mt-4 grid grid-cols-2 gap-2"><SmallMetric label="Invoice total" value={`${invoice.currency} ${money(invoice.quotedTotal)}`} /><SmallMetric label="Due" value={fmt(invoice.dueAt)} detail={dueLabel} tone={dueInDays < 0 ? "danger" : dueInDays <= 3 ? "warn" : "muted"} />{invoice.paidNow > 0 ? <><SmallMetric label="Paid so far" value={`${invoice.currency} ${money(invoice.paidNow)}`} tone="ok" /><SmallMetric label="Still owing" value={`${invoice.currency} ${money(invoice.liveBalance)}`} tone={invoice.liveBalance > 0 ? "warn" : "ok"} /></> : null}</div> : <p className="m-0 mt-4 text-xs leading-5 text-neutral-500">The hotel reviews the booking first, then issues the property-direct invoice here. No payment is collected by NoLSAF or AzamPay.</p>}
        {invoice?.status === "SENT" && !invoice.payerMarkedPaidAt && !data.commercial.settled ? <button onClick={() => setDeclaring(true)} className="box-border mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-neutral-950 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-neutral-800"><ReceiptText className="h-4 w-4" /> Paid by</button> : null}
        {invoice?.payerMarkedPaidAt && !data.commercial.settled ? <div className="mt-4 overflow-hidden rounded-xl border border-solid border-amber-200">
          <div className="flex items-start gap-2.5 bg-amber-50 p-3">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-amber-100 text-amber-700"><Clock3 className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="m-0 text-xs font-extrabold leading-4 text-amber-900">Waiting for the hotel to confirm</p>
              <p className="m-0 mt-1 text-[11px] leading-4 text-amber-800">Declared on {fmt(invoice.payerMarkedPaidAt)}. The hotel checks its own account first, so this is not a confirmation yet.</p>
            </div>
          </div>
          <dl className="m-0 grid grid-cols-1 gap-px border-0 border-t border-solid border-amber-200 bg-amber-200 sm:grid-cols-2">
            <Declared label="Paid by" value={methodLabel(invoice.payerPaymentMethod)} />
            {invoice.payerPaymentAccountName ? <Declared label="From account" value={invoice.payerPaymentAccountName} /> : null}
            {invoice.payerPaymentReference ? <Declared label="Reference" value={invoice.payerPaymentReference} mono /> : null}
          </dl>
        </div> : null}
        {data.commercial.settled ? <a href={`/api/agent-portal/bookings/${bookingId}/voucher`} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white no-underline"><Download className="h-4 w-4" /> Open booking voucher</a> : null}
      </section>
    </div>
    {declaring && invoice ? <PaymentDeclarationModal invoiceNumber={invoice.number} currency={invoice.currency} amount={money(invoice.liveBalance > 0 ? invoice.liveBalance : invoice.quotedTotal)} dueLabel={`Due ${fmt(invoice.dueAt)}`} busy={markingPaid} onClose={() => setDeclaring(false)} onSubmit={(declaration) => void markInvoicePaid(declaration)} /> : null}
    <WorkflowProgress bookingStatus={data.booking.status} invoice={invoice} settled={data.commercial.settled} manifestStatus={data.manifest.status} />
    {data.manifest.reviewNote ? <Alert tone="amber"><b>Hotel review:</b> {data.manifest.reviewNote}</Alert> : null}
    {notice ? <Alert tone="emerald">{notice}</Alert> : null}
    {error ? <Alert tone="red">{error}</Alert> : null}

    {!data.commercial.settled ? <section className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center sm:p-8"><div className="max-w-xl"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-neutral-100 text-neutral-500"><LockKeyhole className="h-5 w-5" /></span><h2 className="m-0 mt-3 text-base font-extrabold text-neutral-900">Traveller information is protected until payment is received</h2><p className="m-0 mt-1 text-xs leading-5 text-neutral-500">Your rooms and traveller quantities are already secured in this booking. Names, identity documents and room assignments open automatically after the property records the invoice payment.</p></div></section> : <>
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-700" /><div><h2 className="m-0 text-sm font-extrabold text-neutral-900">Food, drinks and hotel services</h2><p className="m-0 mt-0.5 text-[11px] text-neutral-500">Confirm who settles charges outside the room invoice.</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{([{"value":"INDIVIDUAL_GUEST","title":"Individual guests","copy":"Each traveller settles their own extras directly."},{"value":"AGENCY","title":"Agency account","copy":"Approved extras are charged to this agency booking."}] as const).map((choice) => <label key={choice.value} className={`cursor-pointer rounded-xl border border-solid p-3 transition ${incidentalBilling === choice.value ? "border-emerald-500 bg-emerald-50" : "border-neutral-200 hover:border-neutral-300"}`}><span className="flex items-center gap-2 text-xs font-bold text-neutral-900"><input disabled={locked} type="radio" checked={incidentalBilling === choice.value} onChange={() => setIncidentalBilling(choice.value)} className="accent-emerald-700" /> {choice.title}</span><span className="mt-1 block pl-5 text-[11px] text-neutral-500">{choice.copy}</span></label>)}</div></section>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2 2xl:grid-cols-3">{guests.map((guest, index) => <GuestCard key={guest.clientKey} guest={guest} index={index} locked={locked} rooms={data.booking.rooms} checkIn={data.booking.checkIn} checkOut={data.booking.checkOut} uploading={uploading} update={update} setGuests={setGuests} uploadDocument={uploadDocument} />)}</div>
      <div className="sticky bottom-3 z-10 mt-1 flex flex-col gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between"><p className="m-0 text-[11px] text-neutral-500"><b className="text-neutral-800">{completedCount} of {data.manifest.requiredGuests} complete.</b> The hotel verifies submitted identities before check-in.</p>{!locked ? <div className="flex gap-2"><button disabled={busy} onClick={() => void save(false)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 sm:flex-none"><Save className="h-4 w-4" /> Save draft</button><button disabled={busy || completedCount !== data.manifest.requiredGuests} onClick={() => void save(true)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-4 text-xs font-bold text-white disabled:bg-neutral-300 sm:flex-none">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Submit to hotel</button></div> : <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${data.manifest.status === "VERIFIED" ? "text-emerald-700" : data.manifest.status === "SUBMITTED" ? "text-blue-700" : "text-neutral-500"}`}><BadgeCheck className="h-4 w-4" /> {data.manifest.status === "VERIFIED" ? "Manifest verified and locked" : data.manifest.status === "SUBMITTED" ? "Submitted · awaiting hotel review" : "Traveller details are currently locked"}</span>}</div>
    </>}
  </div>;
}

function GuestCard({ guest, index, locked, rooms, checkIn, checkOut, uploading, update, setGuests, uploadDocument }: { guest: Guest; index: number; locked: boolean; rooms: number; checkIn: string; checkOut: string; uploading: string | null; update: (key: string, patch: Partial<Guest>) => void; setGuests: React.Dispatch<React.SetStateAction<Guest[]>>; uploadDocument: (guest: Guest, file: File | null) => Promise<void> }) {
  return <section className={`min-w-0 rounded-2xl border border-solid bg-white p-4 shadow-sm ${guest.reviewNote ? "border-amber-300" : "border-neutral-200"}`}>
    <div className="mb-4 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-neutral-100 text-xs font-extrabold text-neutral-700">{index + 1}</span><div className="min-w-0"><h2 className="m-0 truncate text-sm font-extrabold text-neutral-900">{guest.fullName || `${guest.guestType === "ADULT" ? "Adult" : "Child"} traveller`}</h2><span className="text-[10px] text-neutral-500">Room {guest.roomNumber}{guest.isLead ? " · Lead guest" : ""}</span></div></div>{complete(guest) ? <CheckCircle2 className="h-5 w-5 flex-none text-emerald-600" /> : <span className="text-[9px] font-extrabold text-amber-600">INCOMPLETE</span>}</div>
    {guest.reviewNote ? <div className="mb-3 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">Hotel correction: {guest.reviewNote}</div> : null}
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Field label="Full legal name"><input disabled={locked} value={guest.fullName} onChange={(event) => update(guest.clientKey, { fullName: event.target.value })} placeholder="As shown on identity document" /></Field>
      <Field label="Traveller type"><select disabled={locked} value={guest.guestType} onChange={(event) => update(guest.clientKey, { guestType: event.target.value as Guest["guestType"] })}><option value="ADULT">Adult</option><option value="CHILD">Child</option></select></Field>
      <Field label="Room assignment"><select disabled={locked} value={guest.roomNumber} onChange={(event) => update(guest.clientKey, { roomNumber: Number(event.target.value) })}>{Array.from({ length: rooms }, (_, room) => <option key={room} value={room + 1}>Room {room + 1}</option>)}</select></Field>
      <CleanDateField label="Date of birth" value={guest.dateOfBirth} disabled={locked} max={checkIn.slice(0, 10)} placeholder="Choose birth date" onChange={(value) => update(guest.clientKey, { dateOfBirth: value })} />
      <Field label="Nationality"><input disabled={locked} value={guest.nationality} onChange={(event) => update(guest.clientKey, { nationality: event.target.value })} placeholder="Country of nationality" /></Field>
      <Field label="Phone"><input disabled={locked} value={guest.phone} onChange={(event) => update(guest.clientKey, { phone: event.target.value })} placeholder="Recommended" /></Field>
      <Field label="Email"><input disabled={locked} type="email" value={guest.email} onChange={(event) => update(guest.clientKey, { email: event.target.value })} placeholder="Optional" /></Field>
      <Field label="Identity document"><select disabled={locked} value={guest.documentType} onChange={(event) => update(guest.clientKey, { documentType: event.target.value as Guest["documentType"] })}><option value="PASSPORT">Passport</option><option value="NATIONAL_ID">National ID</option><option value="OTHER">Other ID</option></select></Field>
      <Field label="Document number"><input disabled={locked} value={guest.documentNumber} onChange={(event) => update(guest.clientKey, { documentNumber: event.target.value })} placeholder="Document reference" /></Field>
      <CleanDateField label="Document valid until" value={guest.documentExpiry} disabled={locked} min={checkOut.slice(0, 10)} placeholder="Choose expiry date" onChange={(value) => update(guest.clientKey, { documentExpiry: value })} />
    </div>
    <label className={`mt-3 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed p-3 transition ${guest.documentKey ? "border-emerald-300 bg-emerald-50" : "border-neutral-300 bg-neutral-50 hover:border-neutral-400"}`}><span className="flex min-w-0 items-center gap-2">{guest.documentKey ? <FileCheck2 className="h-4 w-4 flex-none text-emerald-700" /> : <Upload className="h-4 w-4 flex-none text-neutral-500" />}<span className="truncate text-[11px] font-semibold text-neutral-700">{guest.documentKey ? "Protected identity document attached" : "Upload passport or ID · PDF/image · max 2 MB"}</span></span>{uploading === guest.clientKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}<input disabled={locked || uploading === guest.clientKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => void uploadDocument(guest, event.target.files?.[0] ?? null)} /></label>
    <label className="mt-3 inline-flex items-center gap-2 text-[11px] font-semibold text-neutral-700"><input disabled={locked || guest.guestType !== "ADULT"} type="radio" name="leadGuest" checked={guest.isLead} onChange={() => setGuests((current) => current.map((entry) => ({ ...entry, isLead: entry.clientKey === guest.clientKey })))} className="accent-emerald-700" /> Lead guest for this booking</label>
  </section>;
}

function WorkflowProgress({ bookingStatus, invoice, settled, manifestStatus }: { bookingStatus: string; invoice: Invoice | null; settled: boolean; manifestStatus: string }) {
  const stages = [
    { label: "Hotel review", done: bookingStatus === "CONFIRMED", active: bookingStatus === "PENDING" },
    { label: "Invoice issued", done: Boolean(invoice), active: bookingStatus === "CONFIRMED" && !invoice },
    // Declaring is not receiving. The label has to keep those apart or the
    // agent reads a pending claim as a settled payment.
    { label: settled ? "Payment received" : invoice?.payerMarkedPaidAt ? "Hotel verifying payment" : "Payment received", done: settled, active: Boolean(invoice) && !settled },
    { label: "Travellers", done: manifestStatus === "VERIFIED", active: settled && manifestStatus !== "VERIFIED" },
  ];
  return <section className="rounded-2xl border border-solid border-neutral-200 bg-white px-3 py-3 shadow-sm sm:px-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stages.map((stage, index) => <div key={stage.label} className={`flex items-center gap-2 rounded-xl px-2.5 py-2 ring-1 ring-inset ${stage.active ? "bg-neutral-900 text-white ring-neutral-900" : stage.done ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-neutral-50 text-neutral-400 ring-neutral-200"}`}><span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-[10px] font-extrabold ${stage.done ? "bg-emerald-600 text-white" : stage.active ? "bg-white text-neutral-950" : "bg-white text-neutral-400 ring-1 ring-neutral-200"}`}>{stage.done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className="truncate text-[10px] font-bold sm:text-[11px]">{stage.label}</span></div>)}</div></section>;
}

function CleanDateField({ label, value, onChange, disabled, min, max, placeholder }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; min?: string; max?: string; placeholder: string }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-neutral-500">{label}<span className={`relative flex h-10 items-center gap-2 rounded-lg border border-solid px-3 normal-case tracking-normal ${disabled ? "border-neutral-100 bg-neutral-50 text-neutral-400" : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400"}`}><CalendarDays className="h-4 w-4 flex-none text-neutral-400" /><span className={`truncate text-xs font-medium ${value ? "text-neutral-800" : "text-neutral-400"}`}>{value ? fmt(`${value}T00:00:00.000Z`) : placeholder}</span><input aria-label={label} disabled={disabled} type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" /></span></label>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex min-w-0 flex-col gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-neutral-500">{label}<span className="[&>input]:h-10 [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-solid [&>input]:border-neutral-200 [&>input]:bg-white [&>input]:px-3 [&>input]:text-xs [&>input]:font-medium [&>input]:normal-case [&>input]:tracking-normal [&>input]:text-neutral-800 [&>input]:outline-none [&>input]:placeholder:text-neutral-400 [&>input]:focus:border-neutral-500 [&>input:disabled]:border-neutral-100 [&>input:disabled]:bg-neutral-50 [&>select]:h-10 [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-solid [&>select]:border-neutral-200 [&>select]:bg-white [&>select]:px-3 [&>select]:text-xs [&>select]:font-medium [&>select]:normal-case [&>select]:tracking-normal [&>select]:text-neutral-800 [&>select]:outline-none [&>select]:focus:border-neutral-500 [&>select:disabled]:border-neutral-100 [&>select:disabled]:bg-neutral-50">{children}</span></label>; }
function BookingStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="flex min-w-0 items-start gap-2 border-0 border-b border-r border-solid border-neutral-200 p-3.5 even:border-r-0 sm:border-b-0 sm:even:border-r sm:last:border-r-0"><span className="mt-0.5 text-neutral-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span><div className="min-w-0"><span className="block text-[8px] font-extrabold uppercase tracking-[0.1em] text-neutral-400">{label}</span><b className="mt-1 block break-words text-[11px] text-neutral-800">{value}</b></div></div>; }
function Declared({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 bg-amber-50/60 px-3 py-2"><dt className="text-[8px] font-extrabold uppercase tracking-[0.1em] text-amber-700">{label}</dt><dd className={`m-0 mt-0.5 break-words text-[11px] font-bold text-amber-950 ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
}

const metricTones = { muted: "text-neutral-500", ok: "text-emerald-700", warn: "text-amber-700", danger: "text-rose-700" } as const;
function SmallMetric({ label, value, detail, tone = "muted" }: { label: string; value: string; detail?: string; tone?: keyof typeof metricTones }) { return <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-2.5"><span className="block text-[8px] font-extrabold uppercase tracking-[0.1em] text-neutral-400">{label}</span><b className="mt-1 block break-words text-xs font-extrabold tabular-nums text-neutral-900">{value}</b>{detail ? <span className={`mt-0.5 block text-[10px] font-semibold leading-4 ${metricTones[tone]}`}>{detail}</span> : null}</div>; }
function Alert({ tone, children }: { tone: "amber" | "emerald" | "red"; children: ReactNode }) { const styles = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"; return <div className={`rounded-xl border border-solid p-3 text-sm ${styles}`}>{children}</div>; }
