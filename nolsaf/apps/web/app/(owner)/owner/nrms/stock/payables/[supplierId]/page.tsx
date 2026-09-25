"use client";

// One supplier's account: what is owed and how late, the statement with a
// running balance (page and PDF), their invoices and the payments made.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Download, FileText, Loader2, PackageCheck, PiggyBank, Receipt, RotateCcw, Truck, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../../../_components/NrmsProvider";
import { apiError, formatMoney } from "../../../_components/stockFormat";
import { Pill, SectionCard, outlineButton, primaryButton, quietButton } from "../../items/_components/ui";
import { PAYMENT_TERM_LABELS } from "../../operations/_components/shared";
import InvoiceModal from "../_components/InvoiceModal";
import { InvoiceTable, PaymentTable } from "../_components/PayablesTables";
import PaymentModal from "../_components/PaymentModal";
import StockPageHeader from "../../_components/StockPageHeader";
import { BUCKET_LABELS, type Statement, dateLabel } from "../_components/payablesShared";

const BUCKET_TONE: Record<string, "ok" | "low" | "out" | "info"> = { CURRENT: "info", DAYS_1_30: "low", DAYS_31_60: "out", DAYS_OVER_60: "out" };

/** How each statement line reads: what happened, and a tile colour that says which way the balance moved. */
const LINE_LOOK: Record<string, { title: string; icon: typeof Truck; tile: string }> = {
  DELIVERY_CREDIT: { title: "Goods on credit", icon: Truck, tile: "bg-amber-50 text-amber-700" },
  DELIVERY_PAID: { title: "Delivery paid on the spot", icon: PackageCheck, tile: "bg-neutral-100 text-neutral-500" },
  DELIVERY_VOIDED: { title: "Delivery voided", icon: RotateCcw, tile: "bg-neutral-100 text-neutral-600" },
  PAYMENT: { title: "Payment", icon: Banknote, tile: "bg-emerald-50 text-emerald-700" },
  PAYMENT_VOIDED: { title: "Payment voided", icon: RotateCcw, tile: "bg-red-50 text-red-700" },
  INVOICE: { title: "Invoice received", icon: FileText, tile: "bg-sky-50 text-sky-700" },
};

type RangeMode = "all" | "30" | "month" | "custom";

function eatDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

export default function SupplierStatementPage() {
  const params = useParams<{ supplierId: string }>();
  const supplierId = Number(params.supplierId);
  const { selectedPropertyId } = useNrms();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const chooseRange = (mode: RangeMode) => {
    setRangeMode(mode);
    if (mode === "all") { setFrom(""); setTo(""); }
    if (mode === "30") { setFrom(eatDay(-29)); setTo(eatDay()); }
    if (mode === "month") { setFrom(`${eatDay().slice(0, 7)}-01`); setTo(eatDay()); }
  };
  const [modal, setModal] = useState<"invoice" | "payment" | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(supplierId) || supplierId <= 0) { setError("This supplier does not exist"); return; }
    try {
      const res = await apiClient.get<Statement>(`/api/nrms/stock/suppliers/${supplierId}/statement`, { params: { from: from || undefined, to: to || undefined } });
      setStatement(res.data);
      setError(null);
    } catch (cause) {
      setError(apiError(cause, "Unable to open the statement"));
    }
  }, [supplierId, from, to]);
  useEffect(() => { void load(); }, [load]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const response = await apiClient.get<Blob>(`/api/nrms/stock/suppliers/${supplierId}/statement.pdf`, { params: { from: from || undefined, to: to || undefined }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `statement-${(statement?.supplier.name ?? "supplier").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(apiError(cause, "Could not build the PDF"));
    } finally {
      setDownloading(false);
    }
  };

  if (error && !statement) {
    return (
      <div className="space-y-3">
        <Link href="/owner/nrms/stock/payables" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand no-underline hover:underline"><ArrowLeft className="h-4 w-4" />Supplier payables</Link>
        <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!statement) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const currency = statement.currency;
  const { supplier, ageing, summary } = statement;
  const overdue = ageing.buckets.DAYS_1_30 + ageing.buckets.DAYS_31_60 + ageing.buckets.DAYS_OVER_60;

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <Link href="/owner/nrms/stock/payables" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand no-underline hover:underline"><ArrowLeft className="h-4 w-4" />Supplier payables</Link>

      <StockPageHeader
        icon={Wallet}
        title={supplier.name}
        subtitle={[PAYMENT_TERM_LABELS[supplier.paymentTerms] ?? supplier.paymentTerms, supplier.contactName, supplier.phone, supplier.tin ? `TIN ${supplier.tin}` : null].filter(Boolean).join(" · ")}
        actions={(
          <>
            <button type="button" onClick={() => setModal("invoice")} className={`${outlineButton} !h-10 px-4`}><FileText className="h-4 w-4" />Record invoice</button>
            <button type="button" onClick={() => setModal("payment")} className={`${primaryButton} !h-10 px-4`}><Banknote className="h-4 w-4" />Record payment</button>
          </>
        )}
        tiles={[
          { icon: Wallet, label: "Owed now", value: formatMoney(ageing.outstanding, currency), note: ageing.open.length ? `${ageing.open.length} ${ageing.open.length === 1 ? "delivery" : "deliveries"} not fully paid` : "Nothing owed", tone: ageing.outstanding > 0 ? "brand" : "calm" },
          { icon: AlertTriangle, label: "Past due", value: formatMoney(overdue, currency), note: overdue > 0 ? "Beyond the credit terms" : "Nothing late", tone: overdue > 0 ? "amber" : "calm" },
          { icon: PiggyBank, label: "Credit with them", value: formatMoney(ageing.credit, currency), note: ageing.credit > 0 ? "Paid ahead, used on the next delivery" : "No money held for you", tone: ageing.credit > 0 ? "brand" : "neutral" },
          { icon: FileText, label: "Invoices recorded", value: String(statement.invoices.filter((row) => !row.voidedAt).length), note: statement.uninvoiced.length ? `${statement.uninvoiced.length} ${statement.uninvoiced.length === 1 ? "delivery" : "deliveries"} not invoiced yet` : "Every delivery invoiced", tone: statement.uninvoiced.length ? "amber" : "calm" },
        ]}
      />
      {supplier.payChannels?.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-2.5 text-sm">
          <span className="text-xs font-bold uppercase tracking-wide text-neutral-500">Pay to</span>
          {supplier.payChannels.map((row) => <span key={`${row.label}-${row.value}`} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1"><span className="font-bold text-neutral-800">{row.label}</span><span className="tabular-nums text-neutral-600">{row.value}</span></span>)}
        </div>
      ) : null}

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-sm font-bold text-emerald-800 [font-family:inherit] hover:underline">Dismiss</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Stacked, not side by side: the statement needs the full width for its columns. */}
      <div className="grid gap-4">
        <SectionCard icon={Wallet} title="What is still owed" subtitle="Deliveries on credit not yet paid in full. Payments clear the oldest first." bodyClass="p-0">
          {ageing.open.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>
              <p className="m-0 text-sm text-neutral-600">Nothing owed to {supplier.name}.{ageing.credit > 0 ? ` You have ${formatMoney(ageing.credit, currency)} paid ahead with them.` : ""}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr>
                    {[["Delivery", "pl-4"], ["Due", ""], ["How late", ""], ["Delivered value", "text-right"], ["Still owed", "pr-4 text-right"]].map(([label, extra]) => (
                      <th key={label} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ageing.open.map((debt, index) => {
                    const bucket = BUCKET_LABELS.find(([key]) => key === debt.bucket)?.[1] ?? debt.bucket;
                    const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
                    return (
                      <tr key={debt.id} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                        <td className={`${cell} whitespace-nowrap pl-4 font-mono text-[13px] font-bold text-neutral-800`}>{debt.receiptNumber}</td>
                        <td className={`${cell} whitespace-nowrap`}>{dateLabel(debt.dueDate)}</td>
                        <td className={cell}><Pill tone={BUCKET_TONE[debt.bucket] ?? "info"}>{bucket}</Pill></td>
                        <td className={`${cell} whitespace-nowrap text-right tabular-nums text-neutral-600`}>{formatMoney(debt.amount, currency)}{debt.open < debt.amount ? <span className="block text-xs text-neutral-400">part paid</span> : null}</td>
                        <td className={`${cell} whitespace-nowrap pr-4 text-right font-bold tabular-nums text-neutral-950`}>{formatMoney(debt.open, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-100 font-bold">
                    <td colSpan={4} className="px-3 py-2.5 pl-4 text-right text-[11px] uppercase tracking-wide text-neutral-600">Total still owed</td>
                    <td className="whitespace-nowrap px-3 py-2.5 pr-4 text-right text-[15px] tabular-nums text-neutral-950">{formatMoney(ageing.outstanding, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Receipt}
          title="Statement"
          subtitle="Goods on credit add to the balance; payments take from it"
          bodyClass="p-0"
          action={<button type="button" disabled={downloading} onClick={() => void downloadPdf()} className={quietButton}>{downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}PDF</button>}
        >
          {/* Quick ranges first; exact dates only when asked for. */}
          <div className="flex flex-wrap items-center gap-1.5 border-0 border-b border-solid border-neutral-100 px-4 py-3">
            {([["all", "All activity"], ["30", "Last 30 days"], ["month", "This month"], ["custom", "Pick dates"]] as const).map(([key, label]) => {
              const active = rangeMode === key;
              return (
                <button key={key} type="button" onClick={() => chooseRange(key)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${active ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
              );
            })}
            {rangeMode === "custom" && (
              <div className="flex w-full flex-wrap items-center gap-2 pt-2">
                <div className="w-[140px]"><DatePickerField label="From" value={from} allowPast twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setFrom(next.slice(0, 10))} /></div>
                <span className="text-sm text-neutral-400">to</span>
                <div className="w-[140px]"><DatePickerField label="To" value={to} allowPast twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setTo(next.slice(0, 10))} /></div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-px bg-neutral-100 sm:grid-cols-4">
            {[
              ["Opening", summary.opening, "text-neutral-700"],
              ["Goods on credit", summary.goods, "text-neutral-900"],
              ["Paid", summary.paid, "text-emerald-700"],
              [summary.closing < 0 ? "Credit with them" : "Balance owed", Math.abs(summary.closing), summary.closing > 0 ? "text-neutral-950" : "text-emerald-700"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="bg-white px-4 py-2.5">
                <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
                <p className={`m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums ${tone}`}>{formatMoney(Number(value), currency)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr>
                  {[["Date", "pl-4"], ["Type", ""], ["Reference", ""], ["Detail", ""], ["Goods (+)", "text-right"], ["Paid (-)", "text-right"], ["Balance", "pr-4 text-right"]].map(([label, extra]) => (
                    <th key={label} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(from || summary.opening !== 0) && (
                  <tr className="bg-sky-50/50">
                    <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-3 py-2.5 pl-4 text-neutral-600">{from ? dateLabel(`${from}T00:00:00Z`) : "-"}</td>
                    <td colSpan={5} className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 font-bold text-neutral-700">Opening balance</td>
                    <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-3 py-2.5 pr-4 text-right font-bold tabular-nums">{formatMoney(summary.opening, currency)}</td>
                  </tr>
                )}
                {statement.lines.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">No activity in this period.</td></tr>
                ) : statement.lines.map((line, index) => {
                  const look = LINE_LOOK[line.kind] ?? LINE_LOOK.INVOICE;
                  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
                  return (
                    <tr key={`${line.kind}-${line.sourceId}-${index}`} className={`${index % 2 ? "bg-neutral-50/60" : "bg-white"} hover:bg-brand/[0.04]`}>
                      <td className={`${cell} whitespace-nowrap pl-4 font-bold text-neutral-800`}>{dateLabel(line.date)}</td>
                      <td className={cell}>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${look.tile}`}><look.icon className="h-3.5 w-3.5" /></span>
                          <span className="font-bold text-neutral-800">{look.title}</span>
                        </span>
                      </td>
                      <td className={`${cell} whitespace-nowrap font-mono text-[13px] text-neutral-500`}>{line.reference}</td>
                      <td className={`${cell} max-w-[260px] truncate text-[13px] text-neutral-600`} title={line.description}>{line.description}</td>
                      <td className={`${cell} whitespace-nowrap text-right tabular-nums text-neutral-900`}>{line.amount > 0 ? formatMoney(line.amount, currency) : <span className="text-neutral-300">-</span>}</td>
                      <td className={`${cell} whitespace-nowrap text-right tabular-nums text-emerald-700`}>{line.amount < 0 ? formatMoney(-line.amount, currency) : <span className="text-neutral-300">-</span>}</td>
                      <td className={`${cell} whitespace-nowrap pr-4 text-right font-bold tabular-nums ${line.balance < 0 ? "text-emerald-700" : "text-neutral-950"}`}>{line.balance < 0 ? `${formatMoney(-line.balance, currency)} credit` : formatMoney(line.balance, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-100">
                  <td colSpan={4} className="px-3 py-2.5 pl-4 text-right text-[11px] font-bold uppercase tracking-wide text-neutral-600">{summary.closing < 0 ? "Totals and credit with them" : "Totals and balance owed"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums">{formatMoney(summary.goods, currency)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-emerald-700">{formatMoney(summary.paid, currency)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 pr-4 text-right text-[15px] font-bold tabular-nums ${summary.closing < 0 ? "text-emerald-700" : "text-neutral-950"}`}>{summary.closing < 0 ? `${formatMoney(-summary.closing, currency)} credit` : formatMoney(summary.closing, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>
      </div>

      <SectionCard icon={FileText} title="Invoices" subtitle="Each one checked against the deliveries it bills" bodyClass="p-0">
        {statement.invoices.length === 0 ? <p className="m-0 px-4 py-5 text-center text-sm text-neutral-500">No invoices recorded yet.</p> : <InvoiceTable rows={statement.invoices} currency={currency} onChanged={() => void load()} />}
      </SectionCard>

      <SectionCard icon={Banknote} title="Payments" bodyClass="p-0">
        {statement.payments.length === 0 ? <p className="m-0 px-4 py-5 text-center text-sm text-neutral-500">No payments recorded yet.</p> : <PaymentTable rows={[...statement.payments].reverse()} currency={currency} onChanged={() => void load()} />}
      </SectionCard>

      {modal === "invoice" && selectedPropertyId && (
        <InvoiceModal propertyId={selectedPropertyId} currency={currency} suppliers={[{ id: supplier.id, name: supplier.name }]} supplierId={supplier.id} onClose={() => setModal(null)} onSaved={(result) => {
          setModal(null);
          setNotice(result.matchStatus === "BILLED_MORE" ? `Invoice saved and flagged: billed ${formatMoney(result.difference, currency)} more than was accepted.` : "Invoice saved.");
          void load();
        }} />
      )}
      {modal === "payment" && selectedPropertyId && (
        <PaymentModal propertyId={selectedPropertyId} currency={currency} suppliers={[{ id: supplier.id, name: supplier.name }]} supplierId={supplier.id} onClose={() => setModal(null)} onSaved={(result) => {
          setModal(null);
          setNotice(`Payment ${result.paymentNumber} recorded${result.overpaid > 0 ? `. ${formatMoney(result.overpaid, currency)} is more than was owed and stays as credit` : ""}.`);
          void load();
        }} />
      )}
    </div>
  );
}
