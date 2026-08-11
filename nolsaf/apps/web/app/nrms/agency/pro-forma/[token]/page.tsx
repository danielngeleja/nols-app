"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import apiClient from "@/lib/apiClient";
import { Banknote, Building2, CalendarDays, Download, FileText, Loader2, ShieldCheck } from "lucide-react";

type ProForma = {
  number: string;
  revision: number;
  status: string;
  paymentStatus: string;
  currency: string;
  issuedAt: string;
  dueAt: string;
  validUntil: string;
  billToName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  quotedTotal: number;
  paidNow: number;
  liveBalance: number;
  property: { name: string; location: string | null; tin: string | null; email: string | null; phone: string | null };
  group: { name: string; reference: string; checkIn: string; checkOut: string };
  items: Array<{ kind: string; description: string; detail: string | null; quantity: number; nights: number | null; unitRate: number; amount: number }>;
  currentPayments: Array<{ paidAt: string; method: string; reference: string | null; receiptNumber: string; amount: number }>;
  paymentAccount: { bankName: string; accountName: string; accountNumber: string; branch: string | null; source: string; currency: string | null; bankAddress: string | null; swiftCode: string | null; iban: string | null; routingCode: string | null; instructions: string | null; paymentReference: string };
};

const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function PublicAgencyProFormaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [record, setRecord] = useState<ProForma | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get(`/api/public/nrms/pro-formas/${encodeURIComponent(token)}`)
      .then((response) => { if (!cancelled) setRecord(response.data?.proForma ?? null); })
      .catch((cause) => { if (!cancelled) setError(cause?.response?.data?.error || "This Pro Forma could not be opened"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#f3f7f6]"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></main>;
  if (!record || error) return <main className="flex min-h-screen items-center justify-center bg-[#f3f7f6] p-5"><div className="max-w-md rounded-2xl border border-neutral-200 bg-white p-7 text-center shadow-sm"><FileText className="mx-auto h-8 w-8 text-neutral-300" /><h1 className="mt-4 text-lg font-bold text-neutral-900">Pro Forma unavailable</h1><p className="text-sm leading-6 text-neutral-500">{error || "Ask the property for a new copy."}</p></div></main>;

  const money = (value: number) => `${record.currency} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const expired = new Date(record.validUntil).getTime() < Date.now() && record.paymentStatus !== "PAID";
  const superseded = record.status === "SUPERSEDED";
  const status = superseded ? "SUPERSEDED" : expired ? "EXPIRED" : record.paymentStatus;

  return (
    <main className="min-h-screen bg-[#f4f7f6] px-3 py-5 text-neutral-900 sm:px-5 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
        <header className="overflow-hidden rounded-2xl bg-[#083f38] text-white shadow-[0_16px_40px_rgba(8,63,56,0.16)]">
          <div className="flex flex-wrap items-start justify-between gap-5 px-5 py-5 sm:px-7 sm:py-6">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200">Property payment request</p>
              <h1 className="mb-0 mt-2 text-2xl font-bold tracking-tight sm:text-[28px]">Pro Forma Invoice</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-emerald-100/85">
                <span className="font-mono font-semibold">{record.number}</span>
                <span className="h-1 w-1 rounded-full bg-emerald-300/70" />
                <span>Revision {record.revision}</span>
                <span className="h-1 w-1 rounded-full bg-emerald-300/70" />
                <span>{record.property.name}</span>
              </div>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${status === "PAID" ? "bg-emerald-200 text-emerald-950" : status === "UNPAID" || status === "PARTIALLY_PAID" ? "bg-amber-200 text-amber-950" : "bg-white/15 text-white"}`}>{status.replace(/_/g, " ")}</span>
          </div>
          <div className="grid border-0 border-t border-solid border-white/10 bg-white/[0.04] sm:grid-cols-3 sm:divide-x sm:divide-white/10">
            <Metric label="Pro Forma total" value={money(record.quotedTotal)} />
            <Metric label="Payments received" value={money(record.paidNow)} />
            <Metric label="Balance due" value={money(record.liveBalance)} emphasis />
          </div>
        </header>

        {(superseded || expired) && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">{superseded ? "This revision has been replaced. Ask the property for the latest Pro Forma." : "This Pro Forma has passed its validity date. Ask the property to issue a new revision."}</div>}

        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-0 border-b border-solid border-neutral-100 px-5 py-3.5"><h2 className="m-0 text-sm font-bold text-neutral-950">Document overview</h2></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-neutral-100">
            <OverviewItem icon={Building2} title="Issued by"><p className="m-0 text-sm font-bold text-neutral-950">{record.property.name}</p>{record.property.location && <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">{record.property.location}</p>}{record.property.tin && <p className="mb-0 mt-1 text-[10px] text-neutral-400">TIN {record.property.tin}</p>}</OverviewItem>
            <OverviewItem icon={FileText} title="Billed to"><p className="m-0 text-sm font-bold text-neutral-950">{record.billToName}</p><p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">{record.contactName}</p><p className="mb-0 mt-0.5 break-all text-[10px] text-neutral-400">{record.contactEmail}</p></OverviewItem>
            <OverviewItem icon={CalendarDays} title="Group stay"><p className="m-0 text-sm font-bold text-neutral-950">{record.group.name}</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">{date(record.group.checkIn)} — {date(record.group.checkOut)}</p><p className="mb-0 mt-1 font-mono text-[10px] text-neutral-400">{record.group.reference}</p></OverviewItem>
            <OverviewItem icon={ShieldCheck} title="Document dates"><div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]"><DateValue label="Issued" value={date(record.issuedAt)} /><DateValue label="Due" value={date(record.dueAt)} /><DateValue label="Valid until" value={date(record.validUntil)} wide /></div></OverviewItem>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4">
            <div><h2 className="m-0 text-sm font-bold text-neutral-950">Charges</h2><p className="mb-0 mt-1 text-[10px] text-neutral-400">{record.items.length} {record.items.length === 1 ? "line item" : "line items"}</p></div>
            <p className="m-0 text-sm font-bold tabular-nums text-neutral-950">{money(record.quotedTotal)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead><tr className="bg-neutral-50 text-left text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400"><th className="px-5 py-3">Description</th><th className="px-3 py-3 text-center">Quantity</th><th className="px-3 py-3 text-right">Rate</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
              <tbody>{record.items.map((item, index) => <tr key={`${item.kind}-${index}`} className="border-0 border-t border-solid border-neutral-100"><td className="px-5 py-3.5 font-semibold text-neutral-900">{item.description}<span className="mt-1 block text-[10px] font-normal text-neutral-400">{item.detail || (item.nights ? `${item.nights} nights` : item.kind)}</span></td><td className="px-3 py-3.5 text-center tabular-nums text-neutral-600">{item.quantity}</td><td className="px-3 py-3.5 text-right tabular-nums text-neutral-600">{money(item.unitRate)}</td><td className="px-5 py-3.5 text-right font-bold tabular-nums text-neutral-950">{money(item.amount)}</td></tr>)}</tbody>
              <tfoot><tr className="border-0 border-t border-solid border-neutral-200 bg-neutral-50"><td colSpan={3} className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wide text-neutral-500">Pro Forma total</td><td className="px-5 py-3 text-right text-sm font-bold tabular-nums text-neutral-950">{money(record.quotedTotal)}</td></tr></tfoot>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 bg-emerald-50 px-5 py-4 sm:px-6">
            <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm"><Banknote className="h-4 w-4" /></span><div><h2 className="m-0 text-sm font-bold text-emerald-950">Bank transfer instructions</h2><p className="mb-0 mt-1 text-[11px] text-emerald-800/75">Payment account provided by {record.property.name}</p></div></div>
            {record.paymentAccount.source === "MANUAL_UNVERIFIED" && <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-800">Property-provided account</span>}
          </div>
          <div className="p-5 sm:p-6">
            <div className="mb-4 grid gap-3 rounded-xl bg-[#083f38] p-4 text-white sm:grid-cols-2"><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-emerald-200">Amount to pay</p><p className="mb-0 mt-1 text-lg font-bold tabular-nums">{money(record.liveBalance)}</p></div><div className="sm:text-right"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-emerald-200">Payment reference</p><p className="mb-0 mt-1 break-all font-mono text-sm font-bold">{record.paymentAccount.paymentReference}</p></div></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><BankField label="Bank" value={record.paymentAccount.bankName} /><BankField label="Account name" value={record.paymentAccount.accountName} /><BankField label="Account number" value={record.paymentAccount.accountNumber} />{record.paymentAccount.currency && <BankField label="Account currency" value={record.paymentAccount.currency} />}{record.paymentAccount.branch && <BankField label="Branch" value={record.paymentAccount.branch} />}{record.paymentAccount.swiftCode && <BankField label="SWIFT / BIC" value={record.paymentAccount.swiftCode} />}{record.paymentAccount.iban && <BankField label="IBAN" value={record.paymentAccount.iban} />}{record.paymentAccount.routingCode && <BankField label="Routing / clearing code" value={record.paymentAccount.routingCode} />}{record.paymentAccount.bankAddress && <BankField label="Bank address" value={record.paymentAccount.bankAddress} />}</div>
            {record.paymentAccount.instructions && <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Transfer instructions</p><p className="mb-0 mt-1 text-xs leading-5 text-neutral-700">{record.paymentAccount.instructions}</p></div>}
          </div>
        </section>

        {record.currentPayments.length > 0 && <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4"><div><h2 className="m-0 text-sm font-bold text-neutral-950">Payments received</h2><p className="mb-0 mt-1 text-[10px] text-neutral-400">Recorded by the property</p></div><p className="m-0 text-sm font-bold tabular-nums text-emerald-700">{money(record.paidNow)}</p></div><div className="divide-y divide-neutral-100">{record.currentPayments.map((payment) => <div key={payment.receiptNumber} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"><div><p className="m-0 text-xs font-bold text-neutral-900">{payment.method.replace(/_/g, " ")} <span className="font-mono font-normal text-neutral-400">· {payment.receiptNumber}</span></p><p className="mb-0 mt-1 text-[10px] text-neutral-500">{dateTime(payment.paidAt)}{payment.reference ? ` · ${payment.reference}` : ""}</p></div><p className="m-0 text-sm font-bold tabular-nums text-neutral-950">{money(payment.amount)}</p></div>)}</div></section>}

        <footer className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:px-5"><div><p className="m-0 text-xs font-bold text-neutral-900">{record.number}</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">Issued {date(record.issuedAt)} · Revision {record.revision}</p></div><a href={`/api/public/nrms/pro-formas/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white no-underline shadow-sm transition-colors hover:bg-emerald-800"><Download className="h-4 w-4" />Download PDF</a></footer>
      </div>
    </main>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) { return <div className={`px-5 py-4 sm:px-6 ${emphasis ? "bg-white/[0.05]" : ""}`}><p className="m-0 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-200/80">{label}</p><p className="mb-0 mt-1 text-base font-bold tabular-nums sm:text-lg">{value}</p></div>; }
function OverviewItem({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: ReactNode }) { return <div className="border-0 border-b border-solid border-neutral-100 p-5 last:border-b-0 sm:odd:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"><div className="mb-3 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400"><Icon className="h-3.5 w-3.5 text-emerald-700" />{title}</div>{children}</div>; }
function DateValue({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={wide ? "col-span-2" : ""}><p className="m-0 text-[9px] uppercase tracking-wide text-neutral-400">{label}</p><p className="mb-0 mt-0.5 font-semibold text-neutral-800">{value}</p></div>; }
function BankField({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-4 py-3"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</p><p className="mb-0 mt-1 break-all text-xs font-bold text-neutral-900 sm:text-sm">{value}</p></div>; }
