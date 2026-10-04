"use client";

// Supplier payables (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 5): what is
// owed to each supplier and how late it is, their invoices, and the payments
// made. Owner and manager only. NRMS records supplier money; it never moves it.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Banknote, CheckCircle2, ChevronRight, FileText, HandCoins, Loader2, Wallet, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../_components/NrmsProvider";
import { apiError, formatMoney } from "../../_components/stockFormat";
import { EmptyState, Pill, cardClass, outlineButton, primaryButton } from "../items/_components/ui";
import { PAYMENT_TERM_LABELS } from "../operations/_components/shared";
import { InvoiceTable, PaymentTable } from "./_components/PayablesTables";
import InvoiceModal from "./_components/InvoiceModal";
import PaymentModal from "./_components/PaymentModal";
import { type Invoice, type PayablesSummary, type Payment, dateLabel } from "./_components/payablesShared";

type Tab = "owed" | "invoices" | "payments";

export default function SupplierPayablesPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState<PayablesSummary | null>(null);
  const [suppliers, setSuppliers] = useState<Array<{ id: number; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState<"invoice" | "payment" | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    try {
      const [payables, list] = await Promise.all([
        apiClient.get<PayablesSummary>(`/api/nrms/stock/property/${selectedPropertyId}/payables`),
        apiClient.get<{ suppliers: Array<{ id: number; name: string; status: string }> }>(`/api/nrms/stock/property/${selectedPropertyId}/suppliers`),
      ]);
      setSummary(payables.data);
      setSuppliers(list.data.suppliers.filter((row) => row.status === "ACTIVE").map((row) => ({ id: row.id, name: row.name })));
      setError(null);
    } catch (cause) {
      setError(apiError(cause, "Unable to load supplier payables"));
    }
  }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const changed = () => setRefreshKey((value) => value + 1);
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = requested === "invoices" || requested === "payments" ? requested : "owed";
  const setTab = (next: Tab) => router.replace(`/owner/nrms/stock/payables?tab=${next}`);
  const currency = summary?.currency ?? "TZS";

  const overdue = summary?.totals.overdue ?? 0;
  const over60 = summary?.totals.buckets.DAYS_OVER_60 ?? 0;
  const flagged = summary?.flaggedInvoices ?? 0;
  const owing = summary?.suppliers.filter((row) => row.outstanding > 0).length ?? 0;
  const tiles = summary ? [
    { icon: Wallet, label: "You owe suppliers", value: formatMoney(summary.totals.outstanding, currency), note: owing ? `${owing} ${owing === 1 ? "supplier" : "suppliers"} waiting to be paid` : "Nothing owed right now", tone: summary.totals.outstanding > 0 ? "brand" : "calm" },
    { icon: AlertTriangle, label: "Past due", value: formatMoney(overdue, currency), note: overdue > 0 ? "Beyond the supplier's credit terms" : "Nothing late", tone: overdue > 0 ? "amber" : "calm" },
    { icon: XCircle, label: "Over 60 days late", value: formatMoney(over60, currency), note: over60 > 0 ? "Pay these first" : "Nothing this old", tone: over60 > 0 ? "red" : "calm" },
    { icon: FileText, label: "Invoices billing too much", value: String(flagged), note: flagged > 0 ? "Billed above what was accepted" : "Every invoice matches", tone: flagged > 0 ? "amber" : "calm" },
  ] : [];
  const TILE_TONE: Record<string, { chip: string; value: string; ring: string }> = {
    brand: { chip: "bg-brand/10 text-brand", value: "text-neutral-950", ring: "border-brand/25" },
    amber: { chip: "bg-amber-100 text-amber-700", value: "text-amber-800", ring: "border-amber-300" },
    red: { chip: "bg-red-100 text-red-700", value: "text-red-700", ring: "border-red-300" },
    calm: { chip: "bg-emerald-50 text-emerald-700", value: "text-neutral-950", ring: "border-neutral-200" },
  };

  const tabs: Array<[Tab, string, typeof Wallet, number]> = [
    ["owed", "What you owe", Wallet, owing],
    ["invoices", "Invoices", FileText, flagged],
    ["payments", "Payments", Banknote, 0],
  ];

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <section className={`${cardClass} overflow-hidden`}>
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-sm"><HandCoins className="h-6 w-6" /></span>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-2xl font-bold tracking-tight text-neutral-950">Supplier payables</h1>
              <p className="m-0 mt-0.5 text-sm text-neutral-500">Debts for goods taken on credit, counted from what was accepted at the door.</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setModal("invoice")} className={`${outlineButton} !h-10 px-4`}><FileText className="h-4 w-4" />Record invoice</button>
            <button type="button" onClick={() => setModal("payment")} className={`${primaryButton} !h-10 px-4`}><Banknote className="h-4 w-4" />Record payment</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          {(tiles.length ? tiles : Array.from({ length: 4 }, () => null)).map((tile, index) => {
            if (!tile) return <div key={index} className="h-[92px] animate-pulse rounded-xl border border-solid border-neutral-200 bg-white" />;
            const tone = TILE_TONE[tile.tone];
            return (
              <div key={tile.label} className={`flex items-start gap-3 rounded-xl border border-solid bg-white p-3.5 shadow-sm ${tone.ring}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}><tile.icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-neutral-500">{tile.label}</p>
                  <p className={`m-0 mt-0.5 truncate text-xl font-bold tabular-nums ${tone.value}`}>{tile.value}</p>
                  <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{tile.note}</p>
                </div>
              </div>
            );
          })}
        </div>

        <nav className="flex gap-1 overflow-x-auto border-0 border-t border-solid border-neutral-100 px-2 sm:px-4" role="tablist" aria-label="Supplier payables">
          {tabs.map(([key, label, Icon, count]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px inline-flex h-12 shrink-0 items-center gap-2 border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-bold [font-family:inherit] transition ${tab === key ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
              <Icon className="h-4 w-4" />{label}
              {count > 0 && <span className={`rounded-full px-1.5 text-xs ${key === "invoices" ? "bg-amber-100 text-amber-800" : "bg-brand/10 text-brand"}`}>{count}</span>}
            </button>
          ))}
        </nav>
      </section>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-sm font-bold text-emerald-800 [font-family:inherit] hover:underline">Dismiss</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!summary && !error ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : summary && selectedPropertyId ? (
        <>
          {tab === "owed" && <OwedTab summary={summary} />}
          {tab === "invoices" && <InvoicesTab propertyId={selectedPropertyId} currency={currency} refreshKey={refreshKey} onChanged={changed} />}
          {tab === "payments" && <PaymentsTab propertyId={selectedPropertyId} currency={currency} refreshKey={refreshKey} onChanged={changed} />}
        </>
      ) : null}

      {modal === "invoice" && selectedPropertyId && (
        <InvoiceModal propertyId={selectedPropertyId} currency={currency} suppliers={suppliers} onClose={() => setModal(null)} onSaved={(result) => {
          setModal(null);
          setNotice(result.matchStatus === "BILLED_MORE" ? `Invoice saved and flagged: billed ${formatMoney(result.difference, currency)} more than was accepted.` : "Invoice saved.");
          changed();
        }} />
      )}
      {modal === "payment" && selectedPropertyId && (
        <PaymentModal propertyId={selectedPropertyId} currency={currency} suppliers={suppliers} onClose={() => setModal(null)} onSaved={(result) => {
          setModal(null);
          setNotice(`Payment ${result.paymentNumber} recorded${result.overpaid > 0 ? `. ${formatMoney(result.overpaid, currency)} is more than was owed and stays as credit with the supplier` : ""}.`);
          changed();
        }} />
      )}
    </div>
  );
}

function OwedTab({ summary }: { summary: PayablesSummary }) {
  const currency = summary.currency;
  if (summary.suppliers.length === 0) {
    return <div className={cardClass}><EmptyState icon={CheckCircle2} title="Nothing owed" body="When goods are received on credit, the debt shows here with its due date from the supplier's terms. Paid-on-delivery goods never appear here." /></div>;
  }
  const head = "whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600";
  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
  const money = (value: number, tone: string) => (value > 0 ? <span className={`font-bold tabular-nums ${tone}`}>{formatMoney(value, currency)}</span> : <span className="text-neutral-300">-</span>);
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${head} pl-4`}>Supplier</th>
              <th className={head}>Terms</th>
              <th className={`${head} text-right`}>Owed now</th>
              <th className={`${head} text-right`}>Not due yet</th>
              <th className={`${head} text-right`}>1 to 30 days late</th>
              <th className={`${head} text-right`}>31 to 60 days late</th>
              <th className={`${head} text-right`}>60+ days late</th>
              <th className={`${head} text-right`}>Credit with them</th>
              <th className={head}>Last paid</th>
              <th className={`${head} pr-4 text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {summary.suppliers.map((row, index) => {
              const state = row.overdue > 0 ? { text: "Late", tone: "out" as const }
                : row.outstanding > 0 ? { text: "Open", tone: "info" as const }
                : { text: "Settled", tone: "ok" as const };
              return (
                <tr key={row.id} className={`${index % 2 ? "bg-neutral-50/60" : "bg-white"} hover:bg-brand/[0.04]`}>
                  <td className={`${cell} pl-4`}>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-xs font-bold text-brand">{row.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("")}</span>
                      <div className="min-w-0">
                        <Link href={`/owner/nrms/stock/payables/${row.id}`} className="block truncate font-bold text-neutral-900 no-underline hover:text-brand hover:underline">{row.name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Pill tone={state.tone}>{state.text}</Pill>
                          {row.uninvoiced > 0 && <span className="text-xs text-neutral-500">{row.uninvoiced} not invoiced</span>}
                          {row.flaggedInvoices > 0 && <Pill tone="low">{row.flaggedInvoices} billed more</Pill>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={`${cell} whitespace-nowrap text-[13px] text-neutral-600`}>{PAYMENT_TERM_LABELS[row.paymentTerms] ?? row.paymentTerms}</td>
                  <td className={`${cell} whitespace-nowrap text-right text-[15px] font-bold tabular-nums ${row.outstanding > 0 ? "text-neutral-950" : "text-neutral-400"}`}>{formatMoney(row.outstanding, currency)}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{money(row.buckets.CURRENT, "text-neutral-800")}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{money(row.buckets.DAYS_1_30, "text-amber-700")}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{money(row.buckets.DAYS_31_60, "text-orange-700")}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{money(row.buckets.DAYS_OVER_60, "text-red-700")}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{money(row.credit, "text-sky-700")}</td>
                  <td className={`${cell} whitespace-nowrap text-neutral-700`}>{row.lastPaidAt ? dateLabel(row.lastPaidAt) : <span className="text-neutral-400">Never</span>}</td>
                  <td className={`${cell} pr-4 text-right`}>
                    <Link href={`/owner/nrms/stock/payables/${row.id}`} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-solid border-neutral-300 bg-white px-2.5 text-xs font-bold text-neutral-700 no-underline hover:border-brand hover:text-brand">Statement<ChevronRight className="h-3.5 w-3.5" /></Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-100 font-bold">
              <td colSpan={2} className="px-3 py-2.5 pl-4 text-[11px] uppercase tracking-wide text-neutral-600">All suppliers</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-[15px] tabular-nums text-neutral-950">{formatMoney(summary.totals.outstanding, currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(summary.totals.buckets.CURRENT, currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-amber-700">{formatMoney(summary.totals.buckets.DAYS_1_30, currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-orange-700">{formatMoney(summary.totals.buckets.DAYS_31_60, currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-red-700">{formatMoney(summary.totals.buckets.DAYS_OVER_60, currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-sky-700">{formatMoney(summary.totals.credit, currency)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function InvoicesTab({ propertyId, currency, refreshKey, onChanged }: { propertyId: number; currency: string; refreshKey: number; onChanged: () => void }) {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ invoices: Invoice[] }>(`/api/nrms/stock/property/${propertyId}/supplier-invoices`, { params: { flag: flaggedOnly ? "flagged" : undefined } });
      setRows(res.data.invoices);
    } catch (cause) { setError(apiError(cause, "Unable to load invoices")); }
  }, [propertyId, flaggedOnly]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {([[false, "All invoices"], [true, "Billing more than received"]] as const).map(([value, label]) => (
          <button key={String(value)} type="button" onClick={() => setFlaggedOnly(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] ${flaggedOnly === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
        ))}
      </div>
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className={`${cardClass} overflow-hidden`}>
        {!rows ? <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : rows.length === 0 ? <EmptyState icon={FileText} title="No invoices here" body="Record each supplier invoice against the deliveries it bills, so a bill for goods that never arrived is caught." />
          : <InvoiceTable rows={rows} currency={currency} showSupplier onChanged={() => { void load(); onChanged(); }} />}
      </div>
    </div>
  );
}

function PaymentsTab({ propertyId, currency, refreshKey, onChanged }: { propertyId: number; currency: string; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ payments: Payment[] }>(`/api/nrms/stock/property/${propertyId}/supplier-payments`);
      setRows(res.data.payments);
    } catch (cause) { setError(apiError(cause, "Unable to load payments")); }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return (
    <div className="space-y-3">
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className={`${cardClass} overflow-hidden`}>
        {!rows ? <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : rows.length === 0 ? <EmptyState icon={Banknote} title="No payments recorded" body="Record each payment to a supplier with its M-Pesa code or bank reference. It posts to the books at Night Audit." />
          : <PaymentTable rows={rows} currency={currency} showSupplier onChanged={() => { void load(); onChanged(); }} />}
      </div>
    </div>
  );
}
