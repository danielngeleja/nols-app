"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Check, ChevronRight, Clock, LayoutGrid, Loader2, RefreshCw, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type LiveOrder = {
  id: number; orderNumber: string; status: string; total: number; currency: string; createdAt: string; settlementMode: string;
  customerLabel?: string | null;
  outlet: { id: number; name: string; type: string };
  reservation: { id: number; guestProfile: { fullName: string } | null; allocations: Array<{ roomUnit: { code: string } | null; roomType: { name: string } | null }> } | null;
  orderPoint?: { id: number; type: string; label: string } | null;
  items: Array<{ id: number; nameSnapshot: string; quantity: number }>;
};

const OPEN_STATUSES = ["CONFIRMED", "PREPARING", "SERVING"];
const STATUS_STYLE: Record<string, string> = {
  PLACED: "bg-violet-50 text-violet-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  PREPARING: "bg-amber-50 text-amber-700",
  SERVING: "bg-cyan-50 text-cyan-700",
};

function money(value: number, currency: string) { return `${currency} ${Math.round(value).toLocaleString()}`; }
function tabLabel(order: LiveOrder) {
  if (order.reservation) return order.reservation.guestProfile?.fullName ?? "In-room guest";
  return order.customerLabel || "Walk-in";
}
function tabSub(order: LiveOrder) {
  if (order.reservation) return order.reservation.allocations.map((row) => row.roomUnit?.code ?? row.roomType?.name).filter(Boolean).join(", ") || "Room folio";
  return order.orderPoint ? order.orderPoint.label : "Walk-in";
}
function tabKey(order: LiveOrder) { return order.reservation ? `res:${order.reservation.id}` : `walk:${(order.customerLabel || "Walk-in").toLowerCase()}`; }
function elapsed(value: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function NrmsTablesPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [declining, setDeclining] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const currency = selectedProperty?.currency ?? "TZS";

  const load = useCallback(async (quiet?: boolean) => {
    if (!selectedPropertyId) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ orders: LiveOrder[] }>(`/api/nrms/operations/property/${selectedPropertyId}/orders?view=live&limit=150`);
      setOrders(res.data.orders);
    } catch (cause: any) {
      if (!quiet) setError(cause?.response?.data?.error || "Unable to load tables");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);
  // Keep the board fresh so new guest orders surface without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => void load(true), 20000);
    return () => clearInterval(id);
  }, [load]);

  const accept = async (order: LiveOrder) => {
    setBusyId(order.id); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${order.id}/advance`, {});
      await load(true);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not accept the order"); }
    finally { setBusyId(null); }
  };

  const decline = async (order: LiveOrder) => {
    if (reason.trim().length < 3) { setError("Enter a short reason to decline."); return; }
    setBusyId(order.id); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${order.id}/cancel`, { reason: reason.trim() });
      setDeclining(null); setReason("");
      await load(true);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not decline the order"); }
    finally { setBusyId(null); }
  };

  const placed = useMemo(() => orders.filter((order) => order.status === "PLACED"), [orders]);
  const tabs = useMemo(() => {
    const groups = new Map<string, { label: string; sub: string; outletName: string; orders: LiveOrder[]; total: number }>();
    for (const order of orders.filter((row) => OPEN_STATUSES.includes(row.status))) {
      const key = tabKey(order);
      const group = groups.get(key) ?? { label: tabLabel(order), sub: tabSub(order), outletName: order.outlet.name, orders: [], total: 0 };
      group.orders.push(order);
      group.total += order.total;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }, [orders]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Tables &amp; tabs</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Tables"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Open bills grouped by table or guest, and new guest orders waiting to be accepted.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/owner/nrms/orders" className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:no-underline">All orders<ChevronRight className="h-4 w-4" /></Link>
          <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && orders.length === 0 ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <section className={`overflow-hidden rounded-2xl border ${placed.length ? "border-violet-200" : "border-neutral-200"} bg-white`}>
            <div className={`flex items-center gap-2 border-b px-4 py-3 ${placed.length ? "border-violet-100 bg-violet-50/60" : "border-neutral-100"}`}>
              <Bell className={`h-4 w-4 ${placed.length ? "text-violet-700" : "text-neutral-400"}`} />
              <p className="m-0 text-[13px] font-bold text-neutral-900">New orders</p>
              {placed.length > 0 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{placed.length}</span>}
            </div>
            {placed.length === 0 ? (
              <p className="m-0 px-4 py-6 text-center text-xs text-neutral-400">No new orders waiting. Guest QR orders will appear here to accept.</p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {placed.map((order) => (
                  <div key={order.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-bold text-neutral-900">{tabLabel(order)} <span className="text-[10px] font-normal text-neutral-400">· {tabSub(order)} · {order.outlet.name}</span></p>
                        <p className="mb-0 mt-1 text-[11px] text-neutral-500">{order.items.map((item) => `${item.quantity}× ${item.nameSnapshot}`).join(", ")}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[13px] font-bold text-neutral-900">{money(order.total, order.currency)}</span>
                        {declining !== order.id && (
                          <>
                            <button type="button" disabled={busyId === order.id} onClick={() => { setDeclining(order.id); setReason(""); setError(null); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 disabled:opacity-50"><X className="h-3.5 w-3.5" />Decline</button>
                            <button type="button" disabled={busyId === order.id} onClick={() => void accept(order)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-800 px-3 text-xs font-bold text-white hover:bg-emerald-900 disabled:opacity-50">{busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Accept</button>
                          </>
                        )}
                      </div>
                    </div>
                    {declining === order.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="Reason to decline (e.g. item unavailable)" className="h-9 min-w-[200px] flex-1 rounded-lg border border-neutral-300 px-3 text-xs outline-none focus:border-red-400" />
                        <button type="button" onClick={() => { setDeclining(null); setReason(""); }} className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Keep</button>
                        <button type="button" disabled={busyId === order.id || reason.trim().length < 3} onClick={() => void decline(order)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-bold text-white disabled:bg-red-200 disabled:text-red-500">{busyId === order.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Decline order</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-emerald-700" />
              <p className="m-0 text-[13px] font-bold text-neutral-900">Open tabs</p>
              <span className="text-[11px] text-neutral-400">{tabs.length} open</span>
            </div>
            {tabs.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-10 text-center text-xs text-neutral-400">No open tabs. Accepted orders in progress will appear here.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tabs.map((tab) => (
                  <div key={`${tab.label}-${tab.sub}`} className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13px] font-bold text-neutral-900">{tab.label}</p>
                        <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{tab.sub} · {tab.outletName}</p>
                      </div>
                      <span className="shrink-0 text-[13px] font-bold text-neutral-900">{money(tab.total, currency)}</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {tab.orders.map((order) => (
                        <div key={order.id} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-2.5 py-1.5">
                          <span className="min-w-0 truncate text-[11px] text-neutral-600">{order.items.reduce((sum, item) => sum + item.quantity, 0)} items · {money(order.total, order.currency)}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[9px] text-neutral-400"><Clock className="h-3 w-3" />{elapsed(order.createdAt)}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${STATUS_STYLE[order.status] ?? "bg-neutral-100 text-neutral-500"}`}>{order.status.toLowerCase()}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <Link href="/owner/nrms/orders" className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:no-underline">Serve or settle<ChevronRight className="h-3.5 w-3.5" /></Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
