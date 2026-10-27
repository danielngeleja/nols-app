"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";

type CaseDetail = {
  reference: string; status: string; resolution?: string | null; evidenceState: string; createdAt: string; updatedAt: string; customerReference?: string | null;
  booking: { adminReference: string; status: string; propertyTitle: string; guestName: string; guestPhoneMasked: string | null; checkIn: string; checkOut: string; amount: number; codeStatus: string | null; codeIssuedAt: string | null };
  invoices: Array<{ invoiceNumber: string; status: string; expectedAmount: number; paymentRef: string | null; receiptNumber: string | null; paidAt: string | null; createdAt: string; events: Array<{ eventId: string; provider: string; status: string; amount: number; currency: string; createdAt: string }> }>;
  timeline: Array<{ type: string; actorRole: string; note: string | null; metadata?: { channels?: string[]; destinationMasked?: string | null } | null; createdAt: string }>;
};

function errorText(cause: any) { return cause?.response?.data?.require2fa ? "Finance OTP verification is required. Unlock finance actions in the admin header, then retry." : cause?.response?.data?.error || "The action could not be completed."; }
function date(value?: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export default function PaymentCaseDetailPage() {
  const params = useParams();
  const reference = String(params.id || "");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [note, setNote] = useState("");
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
      setSuccess(path === "check-payment" ? (data?.matched ? "A matching provider confirmation is recorded. Review the repair action." : "No matching provider confirmation is recorded. Follow up with the provider.") : data?.deliveredVia?.length ? `Confirmation sent via ${data.deliveredVia.join(" and ")}.` : "Case updated.");
      setNote(""); await load();
    } catch (cause) { setError(errorText(cause)); await load(); }
    finally { setBusy(false); }
  };
  if (loading) return <main className="w-full min-w-0 text-sm text-slate-600">Loading payment evidence…</main>;
  if (!detail) return <main className="w-full min-w-0"><Link href="/admin/payment-cases">← Payment cases</Link><p role="alert" className="text-rose-700">{error || "Case not found"}</p></main>;
  const stayEnded = new Date(detail.booking.checkOut).getTime() + 24 * 60 * 60 * 1000 <= Date.now();
  const canRepair = !stayEnded && ["PAID_NEEDS_REPAIR", "VERIFIED_EVENT"].includes(detail.evidenceState) && detail.status !== "RESOLVED" && detail.status !== "INVENTORY_CONFLICT" && detail.status !== "REFUND_REQUIRED";
  const canResend = !stayEnded && detail.evidenceState === "CODE_READY";
  const stalled = ["REPAIRING", "SENDING_CODE"].includes(detail.status) && Date.now() - new Date(detail.updatedAt).getTime() >= 10 * 60_000;
  const evidence = detail.invoices.flatMap((invoice) => [
    { key: `invoice-${invoice.invoiceNumber}`, at: invoice.createdAt, label: `Invoice ${invoice.invoiceNumber} created`, note: `Expected TSh ${Number(invoice.expectedAmount).toLocaleString()}; current status ${invoice.status}` },
    ...(invoice.paidAt ? [{ key: `paid-${invoice.invoiceNumber}`, at: invoice.paidAt, label: `Invoice ${invoice.invoiceNumber} settled`, note: `Receipt ${invoice.receiptNumber || "pending"}` }] : []),
    ...invoice.events.map((event) => ({ key: `provider-${event.eventId}`, at: event.createdAt, label: `${event.provider} ${event.status} callback`, note: `TSh ${event.amount.toLocaleString()} ${event.currency}; event ${event.eventId}` })),
  ]).concat(detail.booking.codeIssuedAt ? [{ key: "code-issued", at: detail.booking.codeIssuedAt, label: "Check-in code issued", note: `Current status ${detail.booking.codeStatus || "unknown"}; value hidden` }] : [])
    .concat(detail.timeline.map((event, index) => ({ key: `case-${index}-${event.createdAt}`, at: event.createdAt, label: event.type.replace(/_/g, " "), note: [event.note, event.metadata?.channels?.length ? `Sent via ${event.metadata.channels.join(" and ")}` : null, event.metadata?.destinationMasked].filter(Boolean).join(" · ") || event.actorRole })))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <main className="w-full min-w-0 space-y-5">
      <Link href="/admin/payment-cases" className="text-sm font-semibold text-teal-800">← Payment cases</Link>
      <header className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="m-0 text-xs font-bold uppercase tracking-wider text-teal-700">Case {detail.reference} · {detail.booking.adminReference}</p><h1 className="m-0 mt-1 text-2xl font-bold text-slate-950">Payment without a code</h1><p className="m-0 mt-1 text-sm text-slate-600">{detail.booking.guestName} · {detail.booking.propertyTitle}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{detail.status.replace(/_/g, " ")}</span></div>
        <div className="mt-4 grid gap-3 border-0 border-t border-solid border-slate-100 pt-4 text-sm sm:grid-cols-4"><div><span className="block text-xs text-slate-500">Payment evidence</span><strong>{detail.evidenceState.replace(/_/g, " ")}</strong></div><div><span className="block text-xs text-slate-500">Booking</span><strong>{detail.booking.status}</strong></div><div><span className="block text-xs text-slate-500">Check-in code</span><strong>{detail.booking.codeStatus || "Not issued"}</strong></div><div><span className="block text-xs text-slate-500">Amount</span><strong>TSh {detail.booking.amount.toLocaleString()}</strong></div></div>
        {detail.customerReference ? <p className="m-0 mt-3 text-sm text-slate-600">Traveller supplied reference: <span className="font-mono font-semibold text-slate-900">{detail.customerReference}</span></p> : null}
      </header>
      {detail.status === "INVENTORY_CONFLICT" || detail.status === "REFUND_REQUIRED" ? <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><strong>Payment verified; original room unavailable.</strong> Keep the payment protected. Arrange an available alternative with the traveller or use the approved refund process. No check-in code can be issued for an unavailable room.</div> : null}
      {stayEnded && detail.status !== "RESOLVED" ? <div className="rounded-xl border border-solid border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The stay dates have passed. Reconcile the payment, then arrange an alternative stay or approved refund. Do not issue a check-in code for the ended stay.</div> : null}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}{success ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p> : null}
      <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5"><h2 className="m-0 text-lg font-bold">Next action</h2><p className="mt-1 text-sm text-slate-600">Only a matching authenticated provider result can repair this booking. The traveller’s report alone cannot mark it paid.</p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void action("check-payment")} className="rounded-lg border border-solid border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50">Recheck recorded provider result</button>{stalled ? <button type="button" disabled={busy} onClick={() => void action("recover")} className="rounded-lg border border-solid border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">Recover stalled action</button> : null}{canRepair && !["REPAIRING", "SENDING_CODE"].includes(detail.status) ? <button type="button" disabled={busy} onClick={() => void action("repair")} className="rounded-lg border-0 bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Repair booking and send code</button> : null}{canResend && !["REPAIRING", "SENDING_CODE"].includes(detail.status) ? <button type="button" disabled={busy} onClick={() => void action("resend")} className="rounded-lg border border-solid border-teal-700 bg-white px-4 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50">Securely resend existing code</button> : null}</div>
        {detail.status !== "RESOLVED" && !["REPAIRING", "SENDING_CODE"].includes(detail.status) ? <div className="mt-4 border-0 border-t border-solid border-slate-100 pt-4"><label className="block text-sm font-semibold text-slate-800">Staff note <span className="font-normal text-slate-500">(required for next step)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} className="mt-1 block w-full rounded-lg border border-solid border-slate-300 p-2 text-sm" placeholder="Record what the provider or traveller needs next" /></label><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 10} onClick={() => void action("next-step", { status: "AWAITING_PROVIDER", note })} className="rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Record provider follow-up</button>{(["PAID_NEEDS_REPAIR", "VERIFIED_EVENT"].includes(detail.evidenceState) || detail.status === "INVENTORY_CONFLICT") ? <button type="button" disabled={busy || note.trim().length < 10} onClick={() => void action("next-step", { status: "REFUND_REQUIRED", note })} className="rounded-lg border border-solid border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50">Send to refund review</button> : null}</div></div> : null}
      </section>
      <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5"><h2 className="m-0 text-lg font-bold">Evidence timeline</h2><p className="mt-1 text-sm text-slate-600">Authenticated provider callbacks and invoice records are shown separately from the traveller’s report. The code itself is hidden.</p><ol className="mt-4 space-y-3 pl-5">{evidence.map((item) => <li key={item.key} className="text-sm"><strong className="text-slate-900">{item.label}</strong><span className="ml-2 text-xs text-slate-500">{date(item.at)}</span>{item.note ? <div className="break-all text-slate-600">{item.note}</div> : null}</li>)}</ol>
      </section>
      <p className="text-xs text-slate-500">Guest phone: {detail.booking.guestPhoneMasked || "not available"}. Code delivery uses the booking contact and verified account email only.</p>
    </main>
  );
}
