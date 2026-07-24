"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, ChefHat, Check, ChevronRight, Clock, LayoutGrid, Loader2, MessageSquareText, ReceiptText, RefreshCw, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type LiveOrder = {
  id: number; orderNumber: string; status: string; total: number; currency: string; createdAt: string; settlementMode: string;
  customerLabel?: string | null;
  note?: string | null;
  guestPaymentMethod?: string | null;
  outlet: { id: number; name: string; type: string };
  reservation: { id: number; guestProfile: { fullName: string } | null; allocations: Array<{ roomUnit: { code: string } | null; roomType: { name: string } | null }> } | null;
  orderPoint?: { id: number; type: string; label: string } | null;
  items: Array<{ id: number; nameSnapshot: string; quantity: number; lineTotal: number }>;
};

const OPEN_STATUSES = ["CONFIRMED", "PREPARING", "SERVING"];
const STATUS_STYLE: Record<string, string> = {
  PLACED: "bg-violet-50 text-violet-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  PREPARING: "bg-amber-50 text-amber-700",
  SERVING: "bg-cyan-50 text-cyan-700",
};
const TENDER_LABELS: Record<string, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", CARD: "Card", BANK: "Bank transfer", OTHER: "Other" };
const tenderLabel = (value?: string | null) => (value ? TENDER_LABELS[value] ?? value : "Not stated");

function nextStep(status: string): { label: string; icon: typeof ChefHat; needsTender: boolean } | null {
  if (status === "CONFIRMED") return { label: "Start preparing", icon: ChefHat, needsTender: false };
  if (status === "PREPARING") return { label: "Take to guest", icon: ArrowRight, needsTender: false };
  if (status === "SERVING") return { label: "Serve & settle", icon: ReceiptText, needsTender: true };
  return null;
}

function money(value: number, currency: string) { return `${currency} ${Math.round(value).toLocaleString()}`; }
function tableLabel(order: LiveOrder) { return order.customerLabel || (order.orderPoint ? `Table ${order.orderPoint.label}` : "Walk-in"); }
function tableSub(order: LiveOrder) { return order.orderPoint ? "Table QR order" : "Walk-in"; }
function tabKey(order: LiveOrder) { return order.orderPoint ? `point:${order.orderPoint.id}` : `walk:${(order.customerLabel || "Walk-in").toLowerCase()}`; }
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
  const [tender, setTender] = useState<Record<number, string>>({});

  const currency = selectedProperty?.currency ?? "TZS";

  const load = useCallback(async (quiet?: boolean) => {
    if (!selectedPropertyId) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ orders: LiveOrder[] }>(`/api/nrms/operations/property/${selectedPropertyId}/orders?view=live&scope=table&limit=150`);
      setOrders(res.data.orders);
      setTender((current) => {
        // Prefill each serving order's tender with the guest's stated choice.
        const next = { ...current };
        for (const order of res.data.orders) if (next[order.id] === undefined && order.status === "SERVING" && order.guestPaymentMethod) next[order.id] = order.guestPaymentMethod;
        return next;
      });
    } catch (cause: any) {
      if (!quiet) setError(cause?.response?.data?.error || "Unable to load tables");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);
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

  const advance = async (order: LiveOrder) => {
    const step = nextStep(order.status);
    if (!step) return;
    if (step.needsTender && !tender[order.id]) { setError("Select how the guest paid before settling."); return; }
    setBusyId(order.id); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${order.id}/advance`, step.needsTender ? { settlementMethod: tender[order.id] } : {});
      await load(true);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not update the order"); }
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
      const group = groups.get(key) ?? { label: tableLabel(order), sub: tableSub(order), outletName: order.outlet.name, orders: [], total: 0 };
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
          <p className="mb-0 mt-1 text-xs text-neutral-500">Table and walk-in orders only, from new order to paid. In-room and guest room orders stay in the Live order queue.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/owner/nrms/orders" className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:no-underline">Order history<ChevronRight className="h-4 w-4" /></Link>
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
              <p className="m-0 px-4 py-6 text-center text-xs text-neutral-400">No new table orders waiting. Table QR and walk-in orders appear here to accept.</p>
            ) : (
              <div className="grid gap-3 p-3 lg:grid-cols-2">
                {placed.map((order) => (
                  <article key={order.id} className="min-w-0 rounded-xl border border-neutral-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-xs font-bold text-neutral-900">{order.orderNumber} · {order.outlet.name}</p>
                        <p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">{tableLabel(order)} · {tableSub(order)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-violet-50 px-2 py-1 text-[9px] font-bold text-violet-700">{order.orderPoint ? "NEW · QR" : "NEW"}</span>
                    </div>

                    <div className="mt-3 space-y-1">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between gap-3 text-[11px] text-neutral-600">
                          <span className="truncate">{item.quantity}× {item.nameSnapshot}</span>
                          <span className="shrink-0 tabular-nums">{money(item.lineTotal, order.currency)}</span>
                        </div>
                      ))}
                    </div>

                    {order.note && (
                      <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-900">
                        <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span><strong className="font-bold">Guest note:</strong> {order.note}</span>
                      </div>
                    )}

                    {order.settlementMode === "OUTLET_PAYMENT" && order.guestPaymentMethod && (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-[10px] text-blue-800">
                        <span><strong>Guest selected:</strong> {tenderLabel(order.guestPaymentMethod)}</span>
                        <span className="shrink-0 font-semibold text-blue-600">Not yet confirmed</span>
                      </div>
                    )}

                    {declining === order.id ? (
                      <div className="mt-3 border-t border-neutral-100 pt-3">
                        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="Reason to decline (e.g. item unavailable)" className="box-border h-9 w-full rounded-lg border border-neutral-300 px-3 text-xs outline-none focus:border-red-400" />
                        <div className="mt-2 flex justify-end gap-1.5">
                          <button type="button" onClick={() => { setDeclining(null); setReason(""); }} className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Keep</button>
                          <button type="button" disabled={busyId === order.id || reason.trim().length < 3} onClick={() => void decline(order)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-bold text-white disabled:bg-red-200 disabled:text-red-500">{busyId === order.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Decline order</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                        <strong className="text-sm tabular-nums">{money(order.total, order.currency)}</strong>
                        <div className="flex gap-1.5">
                          <button type="button" disabled={busyId === order.id} onClick={() => { setDeclining(order.id); setReason(""); setError(null); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 text-[10px] font-bold text-red-600 disabled:opacity-50"><X className="h-3.5 w-3.5" />Decline</button>
                          <button type="button" disabled={busyId === order.id} onClick={() => void accept(order)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-violet-700 px-3 text-[10px] font-bold text-white hover:bg-violet-800 disabled:bg-neutral-200 disabled:text-neutral-400">{busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Accept</button>
                        </div>
                      </div>
                    )}
                  </article>
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
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-10 text-center text-xs text-neutral-400">No open tabs. Accepted table orders in progress will appear here.</div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {tabs.map((tab) => (
                  <div key={`${tab.label}-${tab.sub}`} className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2 border-b border-neutral-100 pb-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13px] font-bold text-neutral-900">{tab.label}</p>
                        <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{tab.sub} · {tab.outletName}</p>
                      </div>
                      <span className="shrink-0 text-[13px] font-bold text-neutral-900">{money(tab.total, currency)}</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {tab.orders.map((order) => {
                        const step = nextStep(order.status);
                        return (
                          <div key={order.id} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-[10px] text-neutral-500"><Clock className="h-3 w-3" />{elapsed(order.createdAt)}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${STATUS_STYLE[order.status] ?? "bg-neutral-100 text-neutral-500"}`}>{order.status.toLowerCase()}</span>
                            </div>
                            <div className="mt-1.5 space-y-0.5">
                              {order.items.map((item) => <p key={item.id} className="m-0 truncate text-[11px] text-neutral-700">{item.quantity}× {item.nameSnapshot}</p>)}
                            </div>
                            {order.note && <p className="mb-0 mt-1.5 flex gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-900"><MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" /><span><strong>Note:</strong> {order.note}</span></p>}
                            {step && (
                              <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                                {step.needsTender && (
                                  <select value={tender[order.id] ?? ""} onChange={(event) => setTender((current) => ({ ...current, [order.id]: event.target.value }))} className="box-border h-8 rounded-lg border border-neutral-200 bg-white px-2 text-[10px] font-bold text-neutral-700 outline-none focus:border-emerald-500">
                                    <option value="">Paid by…</option>
                                    <option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option>
                                  </select>
                                )}
                                <button type="button" disabled={busyId === order.id || (step.needsTender && !tender[order.id])} onClick={() => void advance(order)} className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[10px] font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400 ${order.status === "SERVING" ? "bg-emerald-800 hover:bg-emerald-900" : order.status === "PREPARING" ? "bg-cyan-700 hover:bg-cyan-800" : "bg-neutral-900 hover:bg-neutral-800"}`}>{busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <step.icon className="h-3.5 w-3.5" />}{step.label}</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
