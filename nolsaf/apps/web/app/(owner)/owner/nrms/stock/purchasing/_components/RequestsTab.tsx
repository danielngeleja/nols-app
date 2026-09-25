"use client";

// Requests from the shelves. Staff see their own shelves' requests; owner and
// manager see all of them, turn them into orders or close them with a note
// ("sent from the store", "not needed").

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, ShoppingCart, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatStockQuantity } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { formatWhen } from "../../operations/_components/shared";
import { type OrderDraft, type PurchasingSummary, REQUISITION_STATUS, type Requisition, formatDateOnly } from "./purchasingShared";

const FILTERS: Array<[string, string]> = [["open", "Open"], ["ORDERED", "Ordered"], ["CLOSED", "Closed"], ["all", "All"]];

export default function RequestsTab({ propertyId, overview, summary, refreshKey, onAsk, onOrder, onChanged }: {
  propertyId: number;
  overview: StockOverview;
  summary: PurchasingSummary;
  refreshKey: number;
  onAsk: () => void;
  onOrder: (draft: OrderDraft) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<Requisition[] | null>(null);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ requisitions: Requisition[]; myUserId: number }>(`/api/nrms/stock/property/${propertyId}/requisitions`, { params: { status } });
      setRows(res.data.requisitions);
      setMyUserId(res.data.myUserId);
    } catch (cause) {
      setError(apiError(cause, "Unable to load requests"));
    }
  }, [propertyId, status]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const act = async (id: number, path: "cancel" | "close", body?: object) => {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/requisitions/${id}/${path}`, body ?? {});
      setClosing(null);
      setCloseNote("");
      onChanged();
      await load();
    } catch (cause) {
      setError(apiError(cause, "Could not update the request"));
    } finally {
      setBusyId(null);
    }
  };

  /** The unordered lines of a request, as an order the manager completes. */
  const orderFrom = (row: Requisition) => {
    const lines = row.lines.filter((line) => !line.purchaseOrderId);
    onOrder({
      supplierId: null,
      locationId: row.locationId,
      expectedDate: row.neededBy ? row.neededBy.slice(0, 10) : "",
      note: "",
      lines: lines.map((line) => {
        const good = overview.items.find((item) => item.id === line.stockItemId);
        const pack = line.packUnitName ? good?.packUnits.find((unit) => unit.name === line.packUnitName) : undefined;
        return { stockItemId: line.stockItemId, packUnitId: pack?.id ?? null, amount: pack && line.packCount != null ? line.packCount : line.quantity, unitCost: good?.averageCost || null };
      }),
      requisitionLineIds: lines.map((line) => line.id),
    });
  };

  const head = "whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600";
  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-top";

  return (
    <div className="space-y-3">
      <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setStatus(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${status === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
          ))}
        </div>
        {summary.canRequest && <button type="button" onClick={onAsk} className={primaryButton}><ClipboardList className="h-4 w-4" />Ask for goods</button>}
      </div>
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!rows ? (
        <div className={`${cardClass} flex min-h-[20vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className={cardClass}>
          <EmptyState icon={ClipboardList} title={status === "open" ? "No open requests" : "No requests here"} body="When the bar, kitchen or store needs goods, they ask here with the quantity and the day they need it. A manager decides how to buy it." action={summary.canRequest ? <button type="button" onClick={onAsk} className={primaryButton}><ClipboardList className="h-4 w-4" />Ask for goods</button> : undefined} />
        </div>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${head} pl-4`}>Request</th>
                  <th className={head}>For</th>
                  <th className={head}>Asked by</th>
                  <th className={head}>Needed by</th>
                  <th className={head}>Goods asked for</th>
                  <th className={head}>Status</th>
                  <th className={`${head} pr-4 text-right`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const state = REQUISITION_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };
                  const open = row.status === "OPEN" || row.status === "PARTLY_ORDERED";
                  const unordered = row.lines.filter((line) => !line.purchaseOrderId).length;
                  const mine = row.requestedById === myUserId;
                  const canAct = open && (summary.canManage || (mine && row.status === "OPEN"));
                  const late = row.neededBy && open && new Date(row.neededBy).getTime() < Date.now() - 86_400_000;
                  return (
                    <Fragment key={row.id}>
                      <tr className={`${index % 2 ? "bg-neutral-50/60" : "bg-white"} hover:bg-brand/[0.04]`}>
                        <td className={`${cell} whitespace-nowrap pl-4 font-mono text-[13px] font-bold text-neutral-700`}>{row.requisitionNumber}</td>
                        <td className={`${cell} whitespace-nowrap font-bold text-neutral-900`}>{row.locationName}</td>
                        <td className={`${cell} whitespace-nowrap`}>
                          <span className="block text-neutral-800">{row.requestedBy ?? "Someone"}</span>
                          <span className="block text-xs text-neutral-500">{formatWhen(row.requestedAt)}</span>
                        </td>
                        <td className={`${cell} whitespace-nowrap ${late ? "font-bold text-red-700" : "text-neutral-700"}`}>{row.neededBy ? formatDateOnly(row.neededBy) : <span className="text-neutral-300">-</span>}{late ? <span className="block text-xs">Past due</span> : null}</td>
                        <td className={cell}>
                          <ul className="m-0 list-none space-y-1 p-0">
                            {row.lines.map((line) => (
                              <li key={line.id} className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-bold text-neutral-900">{line.stockItemName}</span>
                                <span className="tabular-nums text-neutral-600">{line.packUnitName && line.packCount != null ? `${line.packCount} ${line.packUnitName}` : formatStockQuantity(line.quantity, line.baseUnit ?? "PIECE")}</span>
                                {line.purchaseOrderId && (summary.canManage
                                  ? <Link href={`/owner/nrms/stock/purchasing/${line.purchaseOrderId}`} className="text-xs font-bold text-brand no-underline hover:underline">on {line.orderNumber}</Link>
                                  : <span className="text-xs font-bold text-emerald-700">Ordered</span>)}
                              </li>
                            ))}
                          </ul>
                          {row.note && <p className="m-0 mt-1 text-xs text-neutral-500">Note: {row.note}</p>}
                        </td>
                        <td className={`${cell} whitespace-nowrap`}><Pill tone={state.tone}>{state.label}</Pill></td>
                        <td className={`${cell} w-px whitespace-nowrap pr-4`}>
                          {canAct && closing !== row.id ? (
                            <div className="flex flex-nowrap items-center justify-end gap-1.5">
                              {summary.canManage && unordered > 0 && <button type="button" onClick={() => orderFrom(row)} className={`${primaryButton} !h-8 whitespace-nowrap px-3 text-[13px]`}><ShoppingCart className="h-3.5 w-3.5" />Order {unordered === row.lines.length ? "these" : `the other ${unordered}`}</button>}
                              {summary.canManage && <button type="button" onClick={() => { setClosing(row.id); setCloseNote(""); }} className={`${quietButton} whitespace-nowrap`}>Close</button>}
                              {mine && row.status === "OPEN" && <button type="button" disabled={busyId === row.id} onClick={() => void act(row.id, "cancel")} className={`${quietButton} whitespace-nowrap hover:border-red-300 hover:text-red-700`}>Cancel</button>}
                            </div>
                          ) : !canAct ? <span className="block text-right text-neutral-300">-</span> : null}
                        </td>
                      </tr>
                      {(closing === row.id || row.closeNote) && (
                        <tr className="bg-neutral-50/60">
                          <td colSpan={7} className={`${cell} py-2 pl-4`}>
                            {closing === row.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <input value={closeNote} onChange={(event) => setCloseNote(event.target.value.slice(0, 300))} placeholder="How was it answered? e.g. sent from the store" className={`${smallFieldClass} min-w-[260px] flex-1`} autoFocus />
                                <button type="button" onClick={() => setClosing(null)} className={quietButton}><X className="h-3.5 w-3.5" />Back</button>
                                <button type="button" disabled={closeNote.trim().length < 3 || busyId === row.id} onClick={() => void act(row.id, "close", { reason: closeNote.trim() })} className={`${primaryButton} h-8`}>{busyId === row.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Close request</button>
                              </div>
                            ) : (
                              <p className="m-0 text-xs text-neutral-500">{row.status === "CANCELLED" ? "Cancelled" : "Closed"}{row.closedBy ? ` by ${row.closedBy}` : ""}: {row.closeNote}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
