"use client";

// Purchase orders. Owner and manager see every order; a storekeeper or outlet
// receiver sees only the orders due at their shelves, to receive them.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, ShoppingCart } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { apiError, formatMoney } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass, primaryButton } from "../../items/_components/ui";
import { formatDay } from "../../operations/_components/shared";
import { ORDER_STATUS, type OrderSummary, type PurchasingSummary, formatDateOnly } from "./purchasingShared";

const MANAGER_FILTERS: Array<[string, string]> = [["open", "Open"], ["PENDING_APPROVAL", "Waiting owner"], ["DRAFT", "Drafts"], ["receivable", "Awaiting delivery"], ["RECEIVED", "Delivered"], ["all", "All"]];

export default function OrdersTab({ propertyId, currency, summary, refreshKey, initialFilter, onNew }: {
  propertyId: number;
  currency: string;
  summary: PurchasingSummary;
  refreshKey: number;
  initialFilter?: string | null;
  onNew: () => void;
}) {
  const [status, setStatus] = useState(initialFilter && MANAGER_FILTERS.some(([value]) => value === initialFilter) ? initialFilter : "open");
  const [rows, setRows] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ orders: OrderSummary[] }>(`/api/nrms/stock/property/${propertyId}/purchase-orders`, { params: { status: summary.canManage ? status : "receivable" } });
      setRows(res.data.orders);
    } catch (cause) {
      setError(apiError(cause, "Unable to load orders"));
    }
  }, [propertyId, status, summary.canManage]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="space-y-3">
      {summary.canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {MANAGER_FILTERS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setStatus(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${status === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={onNew} className={primaryButton}><ShoppingCart className="h-4 w-4" />New order</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className={`${cardClass} overflow-hidden`}>
        {!rows ? (
          <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : rows.length === 0 ? (
          summary.canManage
            ? <EmptyState icon={FileText} title="No orders here" body="Build orders from the reorder list or from a request, or start one yourself. Approved orders go to the supplier as a PDF with a link they can confirm." action={<button type="button" onClick={onNew} className={primaryButton}><ShoppingCart className="h-4 w-4" />New order</button>} />
            : <EmptyState icon={CheckCircle2} title="No deliveries due" body="Orders appear here once a manager has approved them, so you can receive the goods against the order when they arrive." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5">Order</th>
                  <th className="px-2 py-2.5">Supplier</th>
                  <th className="px-2 py-2.5">Deliver to</th>
                  <th className="px-2 py-2.5">Expected</th>
                  <th className="px-2 py-2.5 text-right">Total</th>
                  <th className="px-2 py-2.5">Delivered</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = ORDER_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };
                  const href = `/owner/nrms/stock/purchasing/${row.id}`;
                  return (
                    <tr key={row.id} className="border-0 border-t border-solid border-neutral-100 transition hover:bg-neutral-50/70">
                      <td className="px-4 py-3">
                        <Link href={href} className="text-[15px] font-bold text-neutral-900 no-underline hover:text-brand hover:underline">{row.orderNumber}</Link>
                        <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{formatDay(row.createdAt)} · {row.lineCount} {row.lineCount === 1 ? "good" : "goods"}</p>
                      </td>
                      <td className="px-2 py-3 text-sm text-neutral-700">{row.supplierName}</td>
                      <td className="px-2 py-3 text-sm text-neutral-700">{row.locationName}</td>
                      <td className="px-2 py-3 text-sm text-neutral-700">
                        {row.supplierDeliveryDate
                          ? <span><span className="font-bold text-emerald-700">{formatDateOnly(row.supplierDeliveryDate)}</span><span className="block text-xs text-neutral-500">confirmed by supplier</span></span>
                          : row.expectedDate ? formatDateOnly(row.expectedDate) : <span className="text-neutral-400">-</span>}
                      </td>
                      <td className="px-2 py-3 text-right text-sm font-bold tabular-nums text-neutral-900">{formatMoney(row.totalCost, currency)}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-100"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, row.receivedShare)}%` }} /></span>
                          <span className="text-xs tabular-nums text-neutral-500">{row.receivedShare}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Pill tone={state.tone}>{state.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
