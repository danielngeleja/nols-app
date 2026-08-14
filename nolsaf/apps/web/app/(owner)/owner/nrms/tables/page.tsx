"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, ChefHat, Check, ChevronRight, Clock, LayoutGrid, Loader2, MessageSquareText, Minus, Plus, QrCode, ReceiptText, RefreshCw, ShoppingBasket, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";
import OrderHistoryPanel from "../_components/OrderHistoryPanel";

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
type TablePoint = { id: number; type: "ROOM" | "TABLE"; label: string; active: boolean };
type MenuItem = { id: number; name: string; category: string | null; price: number; status: string; inStock?: boolean };
type Outlet = { id: number; name: string; type: string; currency: string; menuItems: MenuItem[] };

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
  if (status === "CONFIRMED") return { label: "Begin preparation", icon: ChefHat, needsTender: false };
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
  const [tablePoints, setTablePoints] = useState<TablePoint[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [role, setRole] = useState("OWNER");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [declining, setDeclining] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [tender, setTender] = useState<Record<number, string>>({});

  const [orderModal, setOrderModal] = useState(false);
  const [orderTableId, setOrderTableId] = useState<number | "">("");
  const [orderOutletId, setOrderOutletId] = useState<number | "">("");
  const [orderCart, setOrderCart] = useState<Record<number, number>>({});
  const [orderNote, setOrderNote] = useState("");
  const [creatingOrder, setCreatingOrder] = useState(false);

  const currency = selectedProperty?.currency ?? "TZS";

  const load = useCallback(async (quiet?: boolean) => {
    if (!selectedPropertyId) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [ordersRes, pointsRes, contextRes] = await Promise.all([
        apiClient.get<{ orders: LiveOrder[] }>(`/api/nrms/operations/property/${selectedPropertyId}/orders?view=live&scope=table&limit=150`),
        apiClient.get<{ orderPoints: TablePoint[] }>(`/api/nrms/operations/property/${selectedPropertyId}/order-points`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/context`),
      ]);
      setOrders(ordersRes.data.orders);
      setTablePoints((pointsRes.data.orderPoints ?? []).filter((point) => point.type === "TABLE" && point.active));
      setOutlets(contextRes.data?.outlets ?? []);
      setRole(contextRes.data?.access?.role ?? "OWNER");
      setTender((current) => {
        // Prefill each serving order's tender with the guest's stated choice.
        const next = { ...current };
        for (const order of ordersRes.data.orders) if (next[order.id] === undefined && order.status === "SERVING" && order.guestPaymentMethod) next[order.id] = order.guestPaymentMethod;
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

  const openOrderModal = (tableId?: number) => {
    setError(null);
    setOrderTableId(tableId ?? "");
    setOrderOutletId(outlets[0]?.id ?? "");
    setOrderCart({});
    setOrderNote("");
    setOrderModal(true);
  };

  const changeOrderQty = (itemId: number, delta: number) => setOrderCart((current) => {
    const quantity = Math.max(0, (current[itemId] ?? 0) + delta);
    const next = { ...current };
    if (quantity === 0) delete next[itemId]; else next[itemId] = quantity;
    return next;
  });

  const orderOutlet = outlets.find((item) => item.id === orderOutletId);
  const orderLines = useMemo(() => (orderOutlet?.menuItems ?? []).filter((item) => (orderCart[item.id] ?? 0) > 0).map((item) => ({ item, quantity: orderCart[item.id] })), [orderCart, orderOutlet]);
  const orderTotal = orderLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);

  const createTableOrder = async () => {
    if (!selectedPropertyId || !orderTableId || !orderOutletId || orderLines.length === 0) return;
    setCreatingOrder(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/orders`, {
        outletId: orderOutletId,
        orderPointId: orderTableId,
        note: orderNote.trim() || undefined,
        items: orderLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
      });
      setOrderModal(false);
      await load(true);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not create the order"); }
    finally { setCreatingOrder(false); }
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
  // Every table configured under QR order points, whether or not it currently
  // has an order, so a newly added table shows up here right away.
  const busyPointIds = useMemo(() => new Set(orders.filter((order) => OPEN_STATUSES.includes(order.status) && order.orderPoint).map((order) => order.orderPoint!.id)), [orders]);
  const canCreate = role !== "FRONT_DESK";

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Tables &amp; tabs</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Tables"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Table and walk-in orders only, from new order to paid. In-room and guest room orders stay in the Live order queue.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => document.getElementById("order-history")?.scrollIntoView({ behavior: "smooth" })} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50">Order history<ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && orders.length === 0 ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          {tablePoints.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-neutral-400" />
                  <p className="m-0 text-[13px] font-bold text-neutral-900">Tables</p>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500">{tablePoints.length}</span>
                </div>
                {canCreate && <button type="button" onClick={() => openOrderModal()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3 text-[11px] font-bold text-white hover:bg-emerald-800"><Plus className="h-3.5 w-3.5" />Take order</button>}
              </div>
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
                {tablePoints.map((point) => {
                  const busy = busyPointIds.has(point.id);
                  const orderCount = orders.filter((order) => OPEN_STATUSES.includes(order.status) && order.orderPoint?.id === point.id).length;
                  return (
                    <div key={point.id} className={`overflow-hidden rounded-xl border border-l-4 bg-white p-3.5 shadow-sm transition ${busy ? "border-neutral-200 border-l-cyan-500" : "border-neutral-200 border-l-emerald-500"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${busy ? "bg-cyan-50 text-cyan-700" : "bg-emerald-50 text-emerald-700"}`}><QrCode className="h-4 w-4" /></span>
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-bold tracking-tight text-neutral-950">{point.label}</p>
                            <p className="mb-0 mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Table</p>
                          </div>
                        </div>
                        {canCreate && <button type="button" onClick={() => openOrderModal(point.id)} aria-label={`Take an order for ${point.label}`} title="Take an order" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 hover:border-emerald-300 hover:text-emerald-700"><Plus className="h-3.5 w-3.5" /></button>}
                      </div>
                      <div className="mt-3 border-t border-dashed border-neutral-200 pt-2.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${busy ? "bg-cyan-50 text-cyan-700" : "bg-emerald-50 text-emerald-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-cyan-500" : "bg-emerald-500"}`} />{busy ? `${orderCount} order${orderCount === 1 ? "" : "s"} in progress` : "Idle · available"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

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
                                <button type="button" disabled={busyId === order.id || (step.needsTender && !tender[order.id])} onClick={() => void advance(order)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold shadow-sm transition disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400 ${order.status === "SERVING" ? "border-emerald-800 bg-emerald-800 text-white hover:bg-emerald-900" : order.status === "PREPARING" ? "border-cyan-700 bg-cyan-700 text-white hover:bg-cyan-800" : "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100"}`}>{busyId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <step.icon className="h-3.5 w-3.5" />}{step.label}</button>
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

          {selectedPropertyId && <OrderHistoryPanel propertyId={selectedPropertyId} scope="table" />}
        </div>
      )}

      {orderModal && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-neutral-950/50 p-3 sm:p-4">
          <section className="box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-[16px] bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5" aria-label="Take a table order">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"><ShoppingBasket className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">Staff order</p><h3 className="mb-0 mt-0.5 text-lg font-bold text-neutral-950">Take a table order</h3></div>
              </div>
              <button type="button" onClick={() => setOrderModal(false)} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Table<span className="text-red-500"> *</span>
                <select value={orderTableId} onChange={(event) => setOrderTableId(event.target.value ? Number(event.target.value) : "")} className="mt-1.5 box-border h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10">
                  <option value="">Select a table</option>
                  {tablePoints.map((point) => <option key={point.id} value={point.id}>{point.label}{busyPointIds.has(point.id) ? " · in progress" : ""}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Outlet<span className="text-red-500"> *</span>
                <select value={orderOutletId} onChange={(event) => { setOrderOutletId(event.target.value ? Number(event.target.value) : ""); setOrderCart({}); }} className="mt-1.5 box-border h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10">
                  <option value="">Select an outlet</option>
                  {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                </select>
              </label>
            </div>

            {orderOutlet && (
              <div className="mt-4 max-h-52 overflow-y-auto rounded-lg border border-neutral-200">
                {orderOutlet.menuItems.filter((item) => item.status === "ACTIVE").map((item) => {
                  const outOfStock = item.inStock === false;
                  const quantity = orderCart[item.id] ?? 0;
                  return (
                    <div key={item.id} className={`flex items-center gap-2 border-b border-neutral-100 px-3 py-2 last:border-b-0 ${outOfStock ? "opacity-50" : ""}`}>
                      <div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-bold text-neutral-800">{item.name}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{money(item.price, orderOutlet.currency)}{outOfStock ? " · out of stock" : ""}</p></div>
                      <div className="flex shrink-0 items-center gap-1"><button type="button" disabled={outOfStock || quantity === 0} onClick={() => changeOrderQty(item.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><Minus className="h-3 w-3" /></button><span className="w-5 text-center text-xs font-bold">{quantity}</span><button type="button" disabled={outOfStock} onClick={() => changeOrderQty(item.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><Plus className="h-3 w-3" /></button></div>
                    </div>
                  );
                })}
                {orderOutlet.menuItems.length === 0 && <p className="m-0 px-3 py-6 text-center text-xs text-neutral-400">No active items for this outlet.</p>}
              </div>
            )}

            <label className="mt-4 block min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Note (optional)
              <input value={orderNote} onChange={(event) => setOrderNote(event.target.value)} maxLength={300} placeholder="e.g. extra spicy, no ice" className="mt-1.5 box-border h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
            </label>

            {error && <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}

            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4"><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Total</p><p className="mb-0 mt-0.5 text-lg font-bold text-neutral-950">{money(orderTotal, orderOutlet?.currency ?? currency)}</p></div>
              <button type="button" onClick={() => void createTableOrder()} disabled={creatingOrder || !orderTableId || !orderOutletId || orderLines.length === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{creatingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirm order</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
