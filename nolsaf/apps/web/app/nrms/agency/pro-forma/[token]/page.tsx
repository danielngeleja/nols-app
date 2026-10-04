"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Check, CheckCircle2, Copy, Download, FileText, Loader2, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";

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

type OnlinePayment = { available: boolean; reason: string | null; message: string | null; channels?: Array<"MNO" | "BANK">; amount?: number };

const date = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });
const titleCase = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** A calendar date counts until the end of that day. */
function endOfDay(value: string): number {
  const day = new Date(value);
  day.setUTCHours(23, 59, 59, 999);
  return day.getTime();
}

export default function PublicAgencyProFormaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [record, setRecord] = useState<ProForma | null>(null);
  const [online, setOnline] = useState<OnlinePayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Which document is on the sheet. Null means "the natural one": the receipt
  // once the Pro Forma is paid in full, otherwise the invoice.
  const [chosenView, setChosenView] = useState<"invoice" | "receipt" | null>(null);

  // The agency starts its own three-hour checkout; the server decides the
  // amount from the live account and reuses a link that is still valid.
  const payOnline = async () => {
    setStarting(true);
    setPayError(null);
    try {
      const response = await apiClient.post(`/api/public/nrms/pro-formas/${encodeURIComponent(token)}/pay-online`);
      const url = response.data?.paymentLink?.url;
      if (!url) throw new Error("missing url");
      window.location.assign(url);
    } catch (cause: any) {
      setPayError(cause?.response?.data?.error || "The payment could not be started. No charge was made.");
      setStarting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    apiClient.get(`/api/public/nrms/pro-formas/${encodeURIComponent(token)}`)
      .then((response) => { if (!cancelled) { setRecord(response.data?.proForma ?? null); setOnline(response.data?.onlinePayment ?? null); } })
      .catch((cause) => { if (!cancelled) setError(cause?.response?.data?.error || "This Pro Forma could not be opened"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#eef1f0]"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></main>;
  if (!record || error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#eef1f0] p-5">
        <div className="max-w-md rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto h-9 w-9 text-neutral-300" />
          <h1 className="m-0 mt-4 text-lg font-bold text-neutral-900">Pro Forma unavailable</h1>
          <p className="m-0 mt-2 text-sm leading-6 text-neutral-500">{error || "Ask the property for a new copy."}</p>
        </div>
      </main>
    );
  }

  const money = (value: number) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const paid = record.paymentStatus === "PAID";
  const superseded = record.status === "SUPERSEDED";
  const expired = !paid && endOfDay(record.validUntil) < Date.now();
  const payable = !paid && !superseded && !expired;
  const nights = Math.max(1, Math.round((new Date(record.group.checkOut).getTime() - new Date(record.group.checkIn).getTime()) / 86_400_000));
  const overdue = payable && endOfDay(record.dueAt) < Date.now();
  const hasReceipt = record.paidNow > 0.005;
  const view = hasReceipt ? (chosenView ?? (paid ? "receipt" : "invoice")) : "invoice";
  const receiptNumber = record.number.replace(/^PF-/, "RCT-");
  const receivedPayments = record.currentPayments.filter((payment) => payment.amount > 0);
  const lastPaidAt = receivedPayments.at(-1)?.paidAt ?? null;
  const stamp = superseded
    ? { label: "Replaced", cls: "border-neutral-400 text-neutral-500" }
    : paid
      ? { label: "Paid", cls: "border-emerald-600 text-emerald-700" }
      : expired
        ? { label: "Expired", cls: "border-neutral-400 text-neutral-500" }
        : overdue
          ? { label: "Overdue", cls: "border-red-500 text-red-600" }
          : record.paymentStatus === "PARTIALLY_PAID"
            ? { label: "Part paid", cls: "border-amber-500 text-amber-700" }
            : { label: "Unpaid", cls: "border-amber-500 text-amber-700" };

  return (
    <main id="nrms-pro-forma" className="min-h-screen bg-[#eef1f0] px-3 py-6 text-neutral-900 sm:px-6 sm:py-10">
      {/* Preflight is off app-wide; without this, full-width padded controls overflow their boxes. */}
      <style>{`#nrms-pro-forma, #nrms-pro-forma * { box-sizing: border-box; }`}</style>
      <div className="mx-auto max-w-[880px]">
        {/* Toolbar above the sheet */}
        {/* One row at every width: on a phone the tabs share the space and the
            download collapses to a square icon button beside them. */}
        <div className="mb-4 flex items-center gap-2 sm:justify-between sm:gap-3">
          {hasReceipt ? (
            <div role="tablist" aria-label="Document" className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-white p-1 shadow-sm ring-1 ring-neutral-200 sm:inline-grid sm:flex-none">
              {([["receipt", "Receipt", "Receipt"], ["invoice", "Pro Forma", "Pro Forma invoice"]] as const).map(([value, shortLabel, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => setChosenView(value)}
                  className={`inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 px-2.5 text-sm font-semibold transition-colors sm:px-3.5 ${view === value ? "bg-[#02665e] text-white" : "bg-transparent text-neutral-600 hover:text-neutral-900"}`}
                >
                  {value === "receipt" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
                  <span className="truncate sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-neutral-600 sm:flex-none">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" /> <span className="truncate">Verified document issued through NRMS</span>
            </span>
          )}
          <a
            href={`/api/public/nrms/pro-formas/${encodeURIComponent(token)}/${view === "receipt" ? "receipt.pdf" : "pdf"}`}
            target="_blank"
            rel="noreferrer"
            aria-label={view === "receipt" ? "Download receipt" : "Download Pro Forma"}
            title={view === "receipt" ? "Download receipt" : "Download Pro Forma"}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-300 bg-white text-sm font-semibold text-neutral-800 no-underline shadow-sm transition-colors hover:bg-neutral-50 sm:h-10 sm:w-auto sm:px-4"
          >
            <Download className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{view === "receipt" ? "Download receipt" : "Download Pro Forma"}</span>
          </a>
        </div>

        {(superseded || expired) && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-solid border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="m-0 text-sm leading-6 text-amber-900">
              {superseded ? "A newer revision replaced this Pro Forma. Ask the property for the latest copy before paying." : "This Pro Forma has passed its validity date. Ask the property to issue a new revision before paying."}
            </p>
          </div>
        )}

        {/* The sheet */}
        <article className="rounded-md bg-white px-6 py-8 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_12px_40px_-12px_rgba(15,23,42,0.18)] sm:px-12 sm:py-12">
          {/* Letterhead */}
          <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">{record.property.name}</p>
              <div className="mt-2 space-y-0.5 text-sm leading-6 text-neutral-600">
                {record.property.location && <p className="m-0">{record.property.location}</p>}
                {record.property.tin && <p className="m-0">TIN {record.property.tin}</p>}
                {record.property.phone && <p className="m-0">{record.property.phone}</p>}
                {record.property.email && <p className="m-0 break-all">{record.property.email}</p>}
              </div>
            </div>
            <div className="shrink-0 sm:text-right">
              {view === "receipt" ? (
                <>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.22em] text-[#02665e]">Payment Receipt</p>
                  <p className="m-0 mt-2 font-mono text-lg font-bold tracking-tight text-neutral-950">{receiptNumber}</p>
                  <p className="m-0 mt-0.5 text-sm text-neutral-500">{lastPaidAt ? `Paid ${date(lastPaidAt)}` : `For ${record.number}`}</p>
                  <span className={`mt-3 inline-block -rotate-3 rounded-md border-2 border-solid px-3 py-1 text-sm font-black uppercase tracking-[0.18em] ${paid ? "border-emerald-600 text-emerald-700" : "border-amber-500 text-amber-700"}`}>{paid ? "Paid in full" : "Part payment"}</span>
                </>
              ) : (
                <>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.22em] text-[#02665e]">Pro Forma Invoice</p>
                  <p className="m-0 mt-2 font-mono text-lg font-bold tracking-tight text-neutral-950">{record.number}</p>
                  <p className="m-0 mt-0.5 text-sm text-neutral-500">Revision {record.revision}</p>
                  <span className={`mt-3 inline-block -rotate-3 rounded-md border-2 border-solid px-3 py-1 text-sm font-black uppercase tracking-[0.18em] ${stamp.cls}`}>{stamp.label}</span>
                </>
              )}
            </div>
          </header>

          <div className="my-8 h-px bg-neutral-200" />

          {view === "receipt" ? (
            <ReceiptBody
              record={record}
              paid={paid}
              nights={nights}
              receivedPayments={receivedPayments}
              money={money}
              onShowInvoice={() => setChosenView("invoice")}
            />
          ) : (
          <>
          {/* Parties and dates */}
          <section className="grid gap-6 sm:grid-cols-3">
            <Block label="Bill to">
              <p className="m-0 font-bold text-neutral-950">{record.billToName}</p>
              <p className="m-0 mt-1">{record.contactName}</p>
              <p className="m-0 break-all">{record.contactEmail}</p>
              {record.contactPhone && <p className="m-0">{record.contactPhone}</p>}
            </Block>
            <Block label="Group stay">
              <p className="m-0 font-bold text-neutral-950">{record.group.name}</p>
              <p className="m-0 mt-1">{date(record.group.checkIn)} to {date(record.group.checkOut)}</p>
              <p className="m-0">{nights} {nights === 1 ? "night" : "nights"}</p>
              <p className="m-0 font-mono text-xs text-neutral-500">{record.group.reference}</p>
            </Block>
            <Block label="Dates">
              <DateLine label="Issued" value={date(record.issuedAt)} />
              <DateLine label="Payment due" value={date(record.dueAt)} strong={!paid} />
              <DateLine label="Valid until" value={date(record.validUntil)} />
            </Block>
          </section>

          {/* Charges */}
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-[0.08em] text-neutral-500">
                  <th className="border-0 border-b-2 border-solid border-neutral-900 pb-3 pr-3">Description</th>
                  <th className="border-0 border-b-2 border-solid border-neutral-900 px-3 pb-3 text-right">Qty</th>
                  <th className="border-0 border-b-2 border-solid border-neutral-900 px-3 pb-3 text-right">Nights</th>
                  <th className="border-0 border-b-2 border-solid border-neutral-900 px-3 pb-3 text-right">Rate</th>
                  <th className="border-0 border-b-2 border-solid border-neutral-900 pb-3 pl-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {record.items.map((item, index) => (
                  <tr key={`${item.kind}-${index}`}>
                    <td className="border-0 border-b border-solid border-neutral-200 py-4 pr-3 align-top">
                      <span className="block font-semibold text-neutral-950">{item.description}</span>
                      {item.detail && <span className="mt-0.5 block text-xs text-neutral-500">{item.detail}</span>}
                    </td>
                    <td className="border-0 border-b border-solid border-neutral-200 px-3 py-4 text-right align-top tabular-nums">{item.quantity}</td>
                    <td className="border-0 border-b border-solid border-neutral-200 px-3 py-4 text-right align-top tabular-nums">{item.nights ?? "-"}</td>
                    <td className="border-0 border-b border-solid border-neutral-200 px-3 py-4 text-right align-top tabular-nums">{money(item.unitRate)}</td>
                    <td className="border-0 border-b border-solid border-neutral-200 py-4 pl-3 text-right align-top font-semibold tabular-nums text-neutral-950">{money(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-6 flex justify-end">
            <dl className="m-0 w-full max-w-[320px] text-sm">
              <TotalRow label="Pro Forma total" value={`${record.currency} ${money(record.quotedTotal)}`} />
              <TotalRow label="Payments received" value={record.paidNow > 0 ? `- ${record.currency} ${money(record.paidNow)}` : `${record.currency} ${money(0)}`} />
              <div className={`mt-2 flex items-baseline justify-between gap-4 rounded-md px-3 py-3 ${paid ? "bg-emerald-50" : "bg-neutral-900 text-white"}`}>
                <dt className={`text-sm font-bold ${paid ? "text-emerald-800" : "text-white"}`}>Balance due</dt>
                <dd className={`m-0 text-lg font-bold tabular-nums ${paid ? "text-emerald-800" : "text-white"}`}>{record.currency} {money(record.liveBalance)}</dd>
              </div>
            </dl>
          </div>

          {/* Payment history */}
          {record.currentPayments.length > 0 && (
            <section className="mt-10">
              <SectionTitle>Payments received</SectionTitle>
              <table className="mt-3 w-full border-collapse text-sm">
                <tbody>
                  {record.currentPayments.map((payment) => (
                    <tr key={payment.receiptNumber}>
                      <td className="border-0 border-b border-solid border-neutral-200 py-3 pr-3">
                        <span className="block font-semibold text-neutral-900">{titleCase(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}</span>
                        <span className="block text-xs text-neutral-500">{dateTime(payment.paidAt)} EAT · Receipt <span className="font-mono">{payment.receiptNumber}</span></span>
                      </td>
                      <td className={`border-0 border-b border-solid border-neutral-200 py-3 pl-3 text-right font-semibold tabular-nums ${payment.amount < 0 ? "text-neutral-500" : "text-emerald-700"}`}>{record.currency} {money(payment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* How to pay */}
          <section className="mt-10">
            <SectionTitle>{paid ? "Payment status" : "How to pay"}</SectionTitle>
            {paid ? (
              <div className="mt-3 flex items-start gap-3 rounded-md border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <p className="m-0 text-sm leading-6 text-emerald-900">
                  This Pro Forma is <strong>paid in full</strong>. {record.property.name} has received {record.currency} {money(record.paidNow)}. Nothing more is due.
                </p>
              </div>
            ) : !payable ? (
              <p className="m-0 mt-3 text-sm leading-6 text-neutral-600">Payment is closed on this copy. Ask {record.property.name} for the latest Pro Forma.</p>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {online?.available && (
                  <div className="flex flex-col rounded-md border border-solid border-neutral-200 p-4">
                    <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-950"><Smartphone className="h-4 w-4 text-[#02665e]" /> Pay online</p>
                    <p className="m-0 mt-1 text-sm leading-6 text-neutral-600">
                      {online.channels?.includes("MNO") && online.channels?.includes("BANK") ? "Mobile money or bank" : online.channels?.includes("BANK") ? "Bank" : "Mobile money"} through AzamPay. You approve it on your own phone.
                    </p>
                    <button
                      type="button"
                      onClick={() => void payOnline()}
                      disabled={starting}
                      className="mt-auto inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-bold text-white transition-colors hover:bg-[#014e47] disabled:cursor-wait disabled:opacity-70"
                      style={{ marginTop: "1rem" }}
                    >
                      {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                      {starting ? "Opening secure checkout..." : `Pay ${record.currency} ${money(online.amount ?? record.liveBalance)}`}
                    </button>
                    {payError && <p role="alert" className="m-0 mt-2 text-xs font-semibold text-red-700">{payError}</p>}
                  </div>
                )}
                <div className={`rounded-md border border-solid border-neutral-200 p-4 ${online?.available ? "" : "sm:col-span-2"}`}>
                  <p className="m-0 text-sm font-bold text-neutral-950">Bank transfer</p>
                  <dl className="m-0 mt-2 text-sm">
                    <BankRow label="Bank" value={record.paymentAccount.bankName} />
                    <BankRow label="Account name" value={record.paymentAccount.accountName} />
                    <BankRow label="Account no." value={record.paymentAccount.accountNumber} copy mono />
                    {record.paymentAccount.branch && <BankRow label="Branch" value={record.paymentAccount.branch} />}
                    {record.paymentAccount.currency && <BankRow label="Currency" value={record.paymentAccount.currency} />}
                    {record.paymentAccount.swiftCode && <BankRow label="SWIFT / BIC" value={record.paymentAccount.swiftCode} copy mono />}
                    {record.paymentAccount.iban && <BankRow label="IBAN" value={record.paymentAccount.iban} copy mono />}
                    {record.paymentAccount.routingCode && <BankRow label="Routing code" value={record.paymentAccount.routingCode} copy mono />}
                    {record.paymentAccount.bankAddress && <BankRow label="Bank address" value={record.paymentAccount.bankAddress} />}
                    <BankRow label="Reference" value={record.paymentAccount.paymentReference} copy mono strong />
                  </dl>
                  <p className="m-0 mt-2 text-xs leading-5 text-neutral-500">
                    Quote the reference so the property can match your transfer.
                    {record.paymentAccount.source === "MANUAL_UNVERIFIED" ? " Account details are provided by the property." : ""}
                  </p>
                  {record.paymentAccount.instructions && <p className="m-0 mt-2 text-xs leading-5 text-neutral-700">{record.paymentAccount.instructions}</p>}
                </div>
              </div>
            )}
          </section>

          </>
          )}

          {/* Sheet footer */}
          <footer className="mt-12 border-0 border-t border-solid border-neutral-200 pt-5 text-xs leading-5 text-neutral-500">
            <p className="m-0">
              {view === "receipt"
                ? `This receipt confirms payments ${record.property.name} has recorded against Pro Forma ${record.number}. It is not a fiscal (EFD) tax receipt.`
                : `This Pro Forma was issued by ${record.property.name} through NRMS and is not a tax invoice. A receipt is issued once payment is received.`}
            </p>
            <p className="m-0 mt-1">NoLSAF never asks for your mobile-money PIN or bank password.</p>
          </footer>
        </article>
      </div>
    </main>
  );
}

/** The receipt side of the sheet: who paid, for what, how, and what is left. */
function ReceiptBody({
  record,
  paid,
  nights,
  receivedPayments,
  money,
  onShowInvoice,
}: {
  record: ProForma;
  paid: boolean;
  nights: number;
  receivedPayments: ProForma["currentPayments"];
  money: (value: number) => string;
  onShowInvoice: () => void;
}) {
  const methods = [...new Set(receivedPayments.map((payment) => titleCase(payment.method)))].join(", ");
  return (
    <>
      <section className="grid gap-6 sm:grid-cols-3">
        <Block label="Received from">
          <p className="m-0 font-bold text-neutral-950">{record.billToName}</p>
          <p className="m-0 mt-1">{record.contactName}</p>
          <p className="m-0 break-all">{record.contactEmail}</p>
        </Block>
        <Block label="Stay covered">
          <p className="m-0 font-bold text-neutral-950">{record.group.name}</p>
          <p className="m-0 mt-1">{date(record.group.checkIn)} to {date(record.group.checkOut)}</p>
          <p className="m-0">{nights} {nights === 1 ? "night" : "nights"}</p>
          <p className="m-0 font-mono text-xs text-neutral-500">{record.group.reference}</p>
        </Block>
        <Block label="Receipt details">
          <DateLine label="Against" value={record.number} />
          <DateLine label="Paid by" value={methods || "Not stated"} />
          <DateLine label="Payments" value={String(receivedPayments.length)} />
        </Block>
      </section>

      {/* The one figure a receipt exists for */}
      <div className={`mt-10 flex flex-wrap items-center justify-between gap-4 rounded-md px-5 py-5 ${paid ? "bg-emerald-50" : "bg-amber-50"}`}>
        <div>
          <p className={`m-0 text-xs font-bold uppercase tracking-[0.12em] ${paid ? "text-emerald-800" : "text-amber-800"}`}>Amount received</p>
          <p className={`m-0 mt-1 text-3xl font-bold tracking-tight tabular-nums ${paid ? "text-emerald-900" : "text-amber-900"}`}>{record.currency} {money(record.paidNow)}</p>
        </div>
        <p className={`m-0 max-w-xs text-sm leading-6 ${paid ? "text-emerald-900" : "text-amber-900"}`}>
          {paid ? "Paid in full. Nothing more is due on this Pro Forma." : `Part payment. ${record.currency} ${money(record.liveBalance)} is still due.`}
        </p>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-[0.08em] text-neutral-500">
              <th className="border-0 border-b-2 border-solid border-neutral-900 pb-3 pr-3">Date (EAT)</th>
              <th className="border-0 border-b-2 border-solid border-neutral-900 px-3 pb-3">Method</th>
              <th className="border-0 border-b-2 border-solid border-neutral-900 px-3 pb-3">Receipt no.</th>
              <th className="border-0 border-b-2 border-solid border-neutral-900 pb-3 pl-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {record.currentPayments.map((payment) => (
              <tr key={payment.receiptNumber}>
                <td className="border-0 border-b border-solid border-neutral-200 py-3.5 pr-3 tabular-nums">{dateTime(payment.paidAt)}</td>
                <td className="border-0 border-b border-solid border-neutral-200 px-3 py-3.5">
                  <span className="block font-semibold text-neutral-900">{titleCase(payment.method)}</span>
                  {payment.reference && <span className="block text-xs text-neutral-500">{payment.reference}</span>}
                </td>
                <td className="border-0 border-b border-solid border-neutral-200 px-3 py-3.5 font-mono text-xs text-neutral-600">{payment.receiptNumber}</td>
                <td className={`border-0 border-b border-solid border-neutral-200 py-3.5 pl-3 text-right font-semibold tabular-nums ${payment.amount < 0 ? "text-neutral-500" : "text-neutral-950"}`}>{money(payment.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-end">
        <dl className="m-0 w-full max-w-[320px] text-sm">
          <TotalRow label="Pro Forma total" value={`${record.currency} ${money(record.quotedTotal)}`} />
          <TotalRow label="Amount received" value={`${record.currency} ${money(record.paidNow)}`} />
          <div className={`mt-2 flex items-baseline justify-between gap-4 rounded-md px-3 py-3 ${paid ? "bg-emerald-50" : "bg-neutral-900"}`}>
            <dt className={`text-sm font-bold ${paid ? "text-emerald-800" : "text-white"}`}>Balance remaining</dt>
            <dd className={`m-0 text-lg font-bold tabular-nums ${paid ? "text-emerald-800" : "text-white"}`}>{record.currency} {money(record.liveBalance)}</dd>
          </div>
        </dl>
      </div>

      <p className="m-0 mt-8 text-sm text-neutral-600">
        This receipt settles Pro Forma <strong className="font-mono">{record.number}</strong>.{" "}
        <button type="button" onClick={onShowInvoice} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-[#02665e] underline underline-offset-2 hover:text-[#014e47]">View the Pro Forma invoice</button>
      </p>
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{children}</h2>;
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <SectionTitle>{label}</SectionTitle>
      <div className="mt-2 text-sm leading-6 text-neutral-700">{children}</div>
    </div>
  );
}

function DateLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="m-0 flex justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className={strong ? "font-bold text-neutral-950" : "font-semibold text-neutral-800"}>{value}</span>
    </p>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-1.5">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}

function BankRow({ label, value, copy = false, mono = false, strong = false }: { label: string; value: string; copy?: boolean; mono?: boolean; strong?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 border-0 border-b border-dashed border-neutral-200 py-2 last:border-b-0">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="m-0 flex min-w-0 items-center gap-2">
        <span className={`break-all text-right ${mono ? "font-mono tracking-tight" : ""} ${strong ? "font-bold text-[#02665e]" : "font-semibold text-neutral-900"}`}>{value}</span>
        {copy && (
          <button
            type="button"
            aria-label={`Copy ${label.toLowerCase()}`}
            title={copied ? "Copied" : "Copy"}
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              }).catch(() => undefined);
            }}
            className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-solid p-0 transition ${copied ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800"}`}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </dd>
    </div>
  );
}
