"use client";

// The page a supplier opens from the WhatsApp, SMS or email link: the order,
// its PDF, and one step to confirm it with a delivery date. No login.

import { use, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { Building2, CalendarDays, CheckCircle2, Download, FileText, Loader2, Truck } from "lucide-react";

type SupplierOrder = {
  orderNumber: string;
  status: string;
  statusLabel: string;
  currency: string;
  issuedAt: string;
  expectedDate: string | null;
  deliverTo: string | null;
  paymentTerms: string;
  note: string | null;
  total: number;
  property: { name: string; location: string | null };
  supplier: { name: string };
  lines: Array<{ name: string; quantity: string; detail: string | null; amount: number }>;
  confirmable: boolean;
  confirmedAt: string | null;
  deliveryDate: string | null;
  supplierNote: string | null;
};

const dateOnly = (value: string) => new Date(value).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function SupplierOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [note, setNote] = useState("");
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ order: SupplierOrder }>(`/api/public/nrms/supplier-orders/${encodeURIComponent(token)}`)
      .then((response) => {
        if (cancelled) return;
        const next = response.data?.order ?? null;
        setOrder(next);
        setDeliveryDate(next?.deliveryDate?.slice(0, 10) ?? next?.expectedDate?.slice(0, 10) ?? "");
        setNote(next?.supplierNote ?? "");
      })
      .catch((cause) => { if (!cancelled) setError(cause?.response?.data?.error || "This order could not be opened"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const confirm = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await apiClient.post<{ order: SupplierOrder }>(`/api/public/nrms/supplier-orders/${encodeURIComponent(token)}/confirm`, { deliveryDate, note: note.trim() || null });
      setOrder(response.data.order);
      setChanging(false);
    } catch (cause: any) {
      setSaveError(cause?.response?.data?.error || "The confirmation could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#f3f7f6]"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></main>;
  if (!order || error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3f7f6] p-5">
        <div className="max-w-md rounded-2xl border border-solid border-neutral-200 bg-white p-7 text-center shadow-sm">
          <FileText className="mx-auto h-8 w-8 text-neutral-300" />
          <h1 className="mt-4 text-lg font-bold text-neutral-900">Order unavailable</h1>
          <p className="text-sm leading-6 text-neutral-500">{error || "Ask the property to send the order again."}</p>
        </div>
      </main>
    );
  }

  const money = (value: number) => `${order.currency} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const confirmed = Boolean(order.confirmedAt);
  const showForm = order.confirmable && (!confirmed || changing);

  return (
    <main className="min-h-screen bg-[#f4f7f6] px-3 py-5 text-neutral-900 sm:px-5 sm:py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="overflow-hidden rounded-2xl bg-[#083f38] text-white shadow-[0_16px_40px_rgba(8,63,56,0.16)]">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-7 sm:py-6">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">Purchase order for {order.supplier.name}</p>
              <h1 className="mb-0 mt-2 text-2xl font-bold tracking-tight sm:text-[28px]">{order.property.name}</h1>
              <p className="mb-0 mt-2 font-mono text-xs font-semibold text-emerald-100/90">{order.orderNumber}</p>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold">{confirmed && order.confirmable ? "Confirmed" : order.statusLabel}</span>
          </div>
          <div className="grid border-0 border-t border-solid border-white/10 bg-white/[0.04] sm:grid-cols-3 sm:divide-x sm:divide-white/10">
            <Metric label="Order total" value={money(order.total)} />
            <Metric label="Deliver to" value={order.deliverTo ?? "-"} />
            <Metric label="Needed by" value={order.expectedDate ? dateOnly(order.expectedDate) : "As agreed"} />
          </div>
        </header>

        {order.confirmable ? (
          <section className={`overflow-hidden rounded-2xl border border-solid bg-white shadow-sm ${confirmed && !changing ? "border-emerald-200" : "border-neutral-200"}`}>
            {confirmed && !changing ? (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 px-5 py-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="m-0 text-sm font-bold text-emerald-950">You confirmed this order</p>
                    <p className="mb-0 mt-1 text-[13px] text-emerald-800">Delivery on {order.deliveryDate ? dateOnly(order.deliveryDate) : "-"}{order.supplierNote ? `. ${order.supplierNote}` : ""}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setChanging(true)} className="h-9 rounded-lg border border-solid border-emerald-300 bg-white px-3 text-sm font-bold text-emerald-800 [font-family:inherit] hover:bg-emerald-50">Change date</button>
              </div>
            ) : null}
            {showForm && (
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Truck className="h-4 w-4" /></span>
                  <div>
                    <h2 className="m-0 text-[15px] font-bold text-neutral-950">{confirmed ? "Change the delivery date" : "Confirm this order"}</h2>
                    <p className="mb-0 mt-1 text-[13px] text-neutral-500">Tell {order.property.name} when the goods will arrive. Goods are counted and weighed at the door.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-neutral-500">Delivery date</p>
                    <div className="mt-1.5"><DatePickerField label="Delivery date" value={deliveryDate} min={new Date().toISOString().slice(0, 10)} twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setDeliveryDate(next.slice(0, 10))} /></div>
                  </div>
                  <label className="block text-xs font-bold uppercase tracking-[0.1em] text-neutral-500">
                    Note (optional)
                    <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Time, driver, anything short" className="mt-1.5 box-border h-10 w-full rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm font-normal normal-case tracking-normal text-neutral-800 outline-none [font-family:inherit] focus:border-emerald-600" />
                  </label>
                </div>
                {saveError && <p className="mb-0 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  {changing && <button type="button" onClick={() => setChanging(false)} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit]">Back</button>}
                  <button type="button" disabled={!deliveryDate || saving} onClick={() => void confirm()} className="inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-emerald-700 px-5 text-sm font-bold text-white [font-family:inherit] hover:bg-emerald-800 disabled:bg-neutral-200 disabled:text-neutral-400">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}{confirmed ? "Save new date" : "Confirm order"}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="rounded-xl border border-solid border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">This order is {order.statusLabel.toLowerCase()}. Nothing more is needed from you.</div>
        )}

        <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4">
            <h2 className="m-0 text-sm font-bold text-neutral-950">Goods ordered</h2>
            <p className="m-0 text-sm font-bold tabular-nums text-neutral-950">{money(order.total)}</p>
          </div>
          <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
            {order.lines.map((line, index) => (
              <li key={`${line.name}-${index}`} className="flex items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-neutral-900">{line.name}</p>
                  <p className="mb-0 mt-0.5 text-[13px] text-neutral-500">{line.quantity}{line.detail ? ` (${line.detail.replace(/^= /, "")})` : ""}</p>
                </div>
                <p className="m-0 shrink-0 text-sm font-bold tabular-nums text-neutral-900">{money(line.amount)}</p>
              </li>
            ))}
          </ul>
          {order.note && <p className="m-0 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-5 py-3 text-[13px] text-neutral-700"><span className="font-bold">Note: </span>{order.note}</p>}
        </section>

        <section className="grid gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          <Detail icon={Building2} label="Ordered by" value={order.property.name} sub={order.property.location} />
          <Detail icon={CalendarDays} label="Order date" value={dateOnly(order.issuedAt)} sub={`Payment: ${order.paymentTerms}`} />
        </section>

        <footer className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:px-5">
          <p className="m-0 text-xs text-neutral-500">Please quote {order.orderNumber} on your delivery note and invoice.</p>
          <a href={`/api/public/nrms/supplier-orders/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white no-underline shadow-sm hover:bg-emerald-800"><Download className="h-4 w-4" />Download PDF</a>
        </footer>
        <p className="m-0 text-center text-[11px] text-neutral-400">Sent through NoLSAF</p>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="px-5 py-4 sm:px-6"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-200/80">{label}</p><p className="mb-0 mt-1 truncate text-base font-bold tabular-nums">{value}</p></div>;
}

function Detail({ icon: Icon, label, value, sub }: { icon: typeof Building2; label: string; value: string; sub?: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">{label}</p>
        <p className="mb-0 mt-0.5 text-sm font-bold text-neutral-900">{value}</p>
        {sub && <p className="mb-0 mt-0.5 text-[13px] text-neutral-500">{sub}</p>}
      </div>
    </div>
  );
}
