"use client";

// One purchase order: its lines and what has arrived against each, the
// supplier's confirmation, the deliveries received on it, and the next step
// (approve, send, receive, close).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  RotateCcw,
  Send,
  ShieldAlert,
  Truck,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../../_components/NrmsProvider";
import { useStockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatStockQuantity, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import { Pill, SectionCard, cardClass, outlineButton, primaryButton, quietButton } from "../../items/_components/ui";
import GoodsReceiptModal, { type SupplierLite } from "../../operations/_components/GoodsReceiptModal";
import { PAYMENT_TERM_LABELS, RECEIPT_STATUS, formatWhen } from "../../operations/_components/shared";
import { ReceiptDetailModal } from "../../operations/_components/DeliveriesTab";
import OrderEditorModal from "../_components/OrderEditorModal";
import { ORDER_STATUS, type OrderDraft, SEND_CHANNEL_LABELS, formatDateOnly } from "../_components/purchasingShared";

type OrderLine = {
  id: number;
  stockItemId: number;
  stockItemName: string | null;
  baseUnit: string | null;
  countStyle: string;
  packUnitName: string | null;
  packCount: number | null;
  packUnitId: number | null;
  quantity: number;
  quantityLabel: string;
  unitCost: number;
  lineTotal: number;
  receivedQuantity: number;
  outstanding: number;
};

type OrderDetail = {
  id: number;
  orderNumber: string;
  status: string;
  supplierId: number;
  supplierName: string | null;
  locationId: number;
  locationName: string | null;
  expectedDate: string | null;
  totalCost: number;
  receivedShare: number;
  createdAt: string;
  sentAt: string | null;
  sentVia: string | null;
  supplierConfirmedAt: string | null;
  supplierDeliveryDate: string | null;
  supplierViewedAt: string | null;
  supplierNote: string | null;
  supplierLink: string | null;
  note: string | null;
  supplier: { id: number; name: string; phone: string | null; email: string | null; contactName: string | null; paymentTerms: string };
  createdBy: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  sentBy: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
  lines: OrderLine[];
  receipts: Array<{ id: number; receiptNumber: string; status: string; receivedAt: string; receivedBy: string | null; totalCost: number; flaggedLines: number; receivedByApprover: boolean }>;
  requisitions: Array<{ id: number; requisitionNumber: string }>;
};

type Detail = {
  order: OrderDetail;
  limits: { purchaseOrderLimit: number; overDeliveryPercent: number; priceAlertPercent: number };
  viewer: { isOwner: boolean };
  actions: { edit: boolean; submit: boolean; submitNeedsOwner: boolean; approve: boolean; send: boolean; receive: boolean; cancel: boolean; close: boolean; pdf: boolean };
};

type SendResult = { link: string; message: string; whatsappUrl: string; smsUrl: string | null; mailtoUrl: string | null; hasPhone: boolean; hasEmail: boolean };
type ReasonAction = "cancel" | "close" | "return";

const REASON_COPY: Record<ReasonAction, { title: string; placeholder: string; button: string }> = {
  cancel: { title: "Cancel this order", placeholder: "Why? e.g. supplier out of stock, bought elsewhere", button: "Cancel order" },
  close: { title: "Close short: the rest is not coming", placeholder: "Why? e.g. supplier has no more tilapia this week", button: "Close short" },
  return: { title: "Return to the manager", placeholder: "What needs to change?", button: "Return to draft" },
};

export default function PurchaseOrderPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = Number(params.orderId);
  const { selectedPropertyId } = useNrms();
  const { data: overview, load: loadOverview } = useStockOverview(selectedPropertyId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<SendResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrderDraft | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [receiving, setReceiving] = useState(false);
  const [openReceiptId, setOpenReceiptId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(orderId) || orderId <= 0) { setLoadError("This order does not exist"); return; }
    try {
      const res = await apiClient.get<Detail>(`/api/nrms/stock/purchase-orders/${orderId}`);
      setDetail(res.data);
      setLoadError(null);
    } catch (cause) {
      setLoadError(apiError(cause, "Unable to open the order"));
    }
  }, [orderId]);
  useEffect(() => { void load(); }, [load]);

  const order = detail?.order;
  const actions = detail?.actions;
  const currency = overview?.currency ?? "TZS";

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (cause) {
      setError(apiError(cause, "That did not work"));
    } finally {
      setBusy(null);
    }
  };

  const submit = () => run("submit", async () => {
    const res = await apiClient.post<{ status: string }>(`/api/nrms/stock/purchase-orders/${orderId}/submit`);
    setNotice(res.data.status === "PENDING_APPROVAL" ? "Sent to the owner for approval." : "Approved. Send it to the supplier next.");
  });
  const approve = () => run("approve", async () => {
    await apiClient.post(`/api/nrms/stock/purchase-orders/${orderId}/approve`, {});
    setNotice("Approved. It can go to the supplier now.");
  });
  const decide = () => run(reasonFor!, async () => {
    await apiClient.post(`/api/nrms/stock/purchase-orders/${orderId}/${reasonFor}`, { reason: reason.trim() });
    setNotice(reasonFor === "cancel" ? "Order cancelled. Any requests on it are open again." : reasonFor === "close" ? "Order closed short." : "Returned to draft with your note.");
    setReasonFor(null);
    setReason("");
  });

  /** Record the send and open the channel. The WhatsApp tab opens first so the browser does not block it. */
  const send = async (channel: "WHATSAPP" | "SMS" | "EMAIL" | "PDF") => {
    const tab = channel === "WHATSAPP" ? window.open("", "_blank") : null;
    setBusy(`send-${channel}`);
    setError(null);
    try {
      const res = await apiClient.post<SendResult>(`/api/nrms/stock/purchase-orders/${orderId}/send`, { channel });
      setSent(res.data);
      if (channel === "WHATSAPP") { if (tab) tab.location.href = res.data.whatsappUrl; else window.open(res.data.whatsappUrl, "_blank"); }
      if (channel === "SMS" && res.data.smsUrl) window.location.href = res.data.smsUrl;
      if (channel === "EMAIL" && res.data.mailtoUrl) window.location.href = res.data.mailtoUrl;
      if (channel === "PDF") await downloadPdf();
      await load();
    } catch (cause) {
      tab?.close();
      setError(apiError(cause, "Could not send the order"));
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = async () => {
    const response = await apiClient.get<Blob>(`/api/nrms/stock/purchase-orders/${orderId}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${order?.orderNumber ?? "purchase-order"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch { setError("Copy did not work here. Select the text and copy it."); }
  };

  const openEditor = async () => {
    if (!order || !selectedPropertyId) return;
    try {
      const res = await apiClient.get<{ suppliers: SupplierLite[] }>(`/api/nrms/stock/property/${selectedPropertyId}/suppliers`);
      setSuppliers(res.data.suppliers);
    } catch { setSuppliers([]); }
    setEditing({
      orderId: order.id,
      supplierId: order.supplierId,
      locationId: order.locationId,
      expectedDate: order.expectedDate ? order.expectedDate.slice(0, 10) : "",
      note: order.note ?? "",
      lines: order.lines.map((line) => ({ stockItemId: line.stockItemId, packUnitId: line.packUnitId, amount: line.packUnitId && line.packCount != null ? line.packCount : line.quantity, unitCost: line.unitCost })),
      requisitionLineIds: [],
    });
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <Link href="/owner/nrms/stock/purchasing?tab=orders" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand no-underline hover:underline"><ArrowLeft className="h-4 w-4" />Purchasing</Link>
        <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
      </div>
    );
  }
  if (!order || !actions || !detail) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const state = ORDER_STATUS[order.status] ?? { label: order.status, tone: "muted" as const };
  const received = order.lines.reduce((sum, line) => sum + Math.min(line.receivedQuantity, line.quantity) * line.unitCost, 0);
  const sameHands = order.receipts.filter((row) => row.receivedByApprover && row.status !== "VOIDED" && row.status !== "REJECTED");
  const receiveOrder = {
    id: order.id,
    orderNumber: order.orderNumber,
    supplierId: order.supplierId,
    supplierName: order.supplierName ?? order.supplier.name,
    paymentTerms: order.supplier.paymentTerms,
    locationId: order.locationId,
    overDeliveryPercent: detail.limits.overDeliveryPercent,
    lines: order.lines.map((line) => ({ id: line.id, stockItemId: line.stockItemId, packUnitId: line.packUnitId, quantity: line.quantity, receivedQuantity: line.receivedQuantity, outstanding: line.outstanding, unitCost: line.unitCost, countStyle: line.countStyle })),
  };

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <Link href="/owner/nrms/stock/purchasing?tab=orders" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand no-underline hover:underline"><ArrowLeft className="h-4 w-4" />Purchasing</Link>

      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><FileText className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="m-0 text-2xl font-bold tracking-tight text-neutral-950">{order.orderNumber}</h1>
                <Pill tone={state.tone}>{state.label}</Pill>
              </div>
              <p className="m-0 mt-1 text-sm text-neutral-600">
                <span className="font-bold text-neutral-900">{order.supplier.name}</span> · deliver to {order.locationName}
                {order.expectedDate ? ` · needed by ${formatDateOnly(order.expectedDate)}` : ""}
              </p>
              <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{PAYMENT_TERM_LABELS[order.supplier.paymentTerms] ?? order.supplier.paymentTerms}{order.supplier.phone ? ` · ${order.supplier.phone}` : ""}{order.supplier.email ? ` · ${order.supplier.email}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.edit && <button type="button" onClick={() => void openEditor()} className={outlineButton}><Pencil className="h-4 w-4" />Edit</button>}
            {actions.submit && <button type="button" disabled={busy != null} onClick={() => void submit()} className={primaryButton}>{busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{actions.submitNeedsOwner ? "Send to owner for approval" : "Approve order"}</button>}
            {actions.approve && <button type="button" onClick={() => { setReasonFor("return"); setReason(""); }} className={outlineButton}><RotateCcw className="h-4 w-4" />Return</button>}
            {actions.approve && <button type="button" disabled={busy != null} onClick={() => void approve()} className={primaryButton}>{busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve</button>}
            {actions.receive && overview && <button type="button" onClick={() => setReceiving(true)} className={primaryButton}><Truck className="h-4 w-4" />Receive delivery</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
          {[
            ["Order total", formatMoney(order.totalCost, currency)],
            ["Received so far", `${formatMoney(received, currency)} (${order.receivedShare}%)`],
            ["Goods", String(order.lines.length)],
            ["Supplier says", order.supplierDeliveryDate ? `Delivers ${formatDateOnly(order.supplierDeliveryDate)}` : order.sentAt ? (order.supplierViewedAt ? "Opened, not confirmed" : "Not opened yet") : "Not sent yet"],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-4 py-3.5 sm:px-6">
              <p className="m-0 truncate text-lg font-bold leading-tight tabular-nums text-neutral-950">{value}</p>
              <p className="m-0 truncate text-[13px] text-neutral-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-sm font-bold text-emerald-800 [font-family:inherit] hover:underline">Dismiss</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {order.status === "DRAFT" && order.closeReason && <div className="flex items-start gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />{order.closeReason}</div>}
      {order.status === "PENDING_APPROVAL" && !actions.approve && <div className="flex items-start gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Above {formatMoney(detail.limits.purchaseOrderLimit, currency)}, so the owner approves it before it goes to the supplier.</div>}
      {(order.status === "CANCELLED" || order.status === "CLOSED_SHORT") && order.closeReason && <div className="flex items-start gap-2 rounded-xl border border-solid border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{order.status === "CANCELLED" ? `Cancelled by ${order.cancelledBy ?? "someone"}` : `Closed short by ${order.closedBy ?? "someone"}`}: {order.closeReason}</div>}
      {sameHands.length > 0 && <div className="flex items-start gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{order.approvedBy ?? "The approver"} approved this order and also received {sameHands.length === 1 ? "a delivery" : `${sameHands.length} deliveries`} on it alone. Allowed, but a second person at the door is safer.</div>}

      {reasonFor && (
        <div className={`${cardClass} p-4 sm:p-5`}>
          <p className="m-0 text-[15px] font-bold text-neutral-900">{REASON_COPY[reasonFor].title}</p>
          <textarea value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} placeholder={REASON_COPY[reasonFor].placeholder} rows={2} className="mt-2 box-border w-full rounded-lg border border-solid border-neutral-300 px-3 py-2 text-sm [font-family:inherit] outline-none focus:border-brand" autoFocus />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setReasonFor(null)} className={quietButton}>Back</button>
            <button type="button" disabled={reason.trim().length < 3 || busy != null} onClick={() => void decide()} className={`${primaryButton} h-8`}>{busy === reasonFor && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{REASON_COPY[reasonFor].button}</button>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <SectionCard icon={FileText} title="Goods on this order" subtitle={`Prices are what ${order.supplier.name} is expected to charge`} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                    <th className="px-4 py-2.5">Good</th>
                    <th className="px-2 py-2.5 text-right">Ordered</th>
                    <th className="px-2 py-2.5 text-right">Price</th>
                    <th className="px-2 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5">Arrived</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => {
                    const share = line.quantity > 0 ? Math.min(100, Math.round((line.receivedQuantity / line.quantity) * 100)) : 0;
                    const unit = line.baseUnit ?? "PIECE";
                    return (
                      <tr key={line.id} className="border-0 border-t border-solid border-neutral-100">
                        <td className="px-4 py-3">
                          <p className="m-0 text-[15px] font-bold text-neutral-900">{line.stockItemName}</p>
                          {line.packUnitName && <p className="m-0 mt-0.5 text-xs text-neutral-500">{formatStockQuantity(line.quantity, unit)}</p>}
                        </td>
                        <td className="px-2 py-3 text-right text-sm tabular-nums text-neutral-800">{line.quantityLabel}</td>
                        <td className="px-2 py-3 text-right text-sm tabular-nums text-neutral-700">{formatUnitCost(line.unitCost, currency)} <span className="text-xs text-neutral-400">/ {unitShort(unit)}</span></td>
                        <td className="px-2 py-3 text-right text-sm font-bold tabular-nums text-neutral-900">{formatMoney(line.lineTotal, currency)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${share >= 100 ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${share}%` }} /></span>
                            <span className="text-xs tabular-nums text-neutral-600">{formatStockQuantity(line.receivedQuantity, unit)}</span>
                          </div>
                          {line.outstanding > 0 && line.receivedQuantity > 0 && <p className="m-0 mt-0.5 text-xs text-amber-700">{formatStockQuantity(line.outstanding, unit)} still to come</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-0 border-t border-solid border-neutral-200 bg-neutral-50/70">
                    <td colSpan={3} className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-neutral-500">Order total</td>
                    <td className="px-2 py-3 text-right text-sm font-bold tabular-nums text-neutral-950">{formatMoney(order.totalCost, currency)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {order.note && <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-sm text-neutral-600"><span className="font-bold text-neutral-800">Note to supplier: </span>{order.note}</p>}
          </SectionCard>

          <SectionCard icon={Truck} title="Deliveries on this order" subtitle={actions.receive ? "Receive each delivery as it arrives, even a partial one" : undefined} bodyClass="p-0">
            {order.receipts.length === 0 ? (
              <p className="m-0 px-4 py-6 text-center text-sm text-neutral-500">Nothing received yet.</p>
            ) : order.receipts.map((row) => {
              const receiptState = RECEIPT_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };
              return (
                <button key={row.id} type="button" onClick={() => setOpenReceiptId(row.id)} className="flex w-full items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 bg-white px-4 py-3 text-left [font-family:inherit] first:border-t-0 hover:bg-neutral-50">
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold text-neutral-900">{row.receiptNumber}</span>
                    <span className="mt-0.5 block text-[13px] text-neutral-500">{formatWhen(row.receivedAt)} · {row.receivedBy ?? "Unknown"}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {row.receivedByApprover && <Pill tone="low">Approver received</Pill>}
                    {row.flaggedLines > 0 && <Pill tone="low">{row.flaggedLines} price {row.flaggedLines === 1 ? "jump" : "jumps"}</Pill>}
                    <Pill tone={receiptState.tone}>{receiptState.label}</Pill>
                    <span className="text-sm font-bold tabular-nums">{formatMoney(row.totalCost, currency)}</span>
                  </span>
                </button>
              );
            })}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4">
          {(actions.send || order.sentAt) && (
            <SectionCard icon={Send} title="Send to the supplier" subtitle="A PDF and a link they open without logging in">
              {actions.send ? (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy != null} onClick={() => void send("WHATSAPP")} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border-0 bg-[#1f9d55] px-3 text-sm font-bold text-white [font-family:inherit] hover:brightness-95 disabled:opacity-60">{busy === "send-WHATSAPP" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}WhatsApp</button>
                  <button type="button" disabled={busy != null || !order.supplier.phone} onClick={() => void send("SMS")} className={`${outlineButton} !h-11`}>{busy === "send-SMS" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}SMS</button>
                  <button type="button" disabled={busy != null || !order.supplier.email} onClick={() => void send("EMAIL")} className={`${outlineButton} !h-11`}>{busy === "send-EMAIL" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Email</button>
                  <button type="button" disabled={busy != null} onClick={() => void send("PDF")} className={`${outlineButton} !h-11`}>{busy === "send-PDF" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</button>
                </div>
              ) : null}
              {actions.send && (!order.supplier.phone || !order.supplier.email) && <p className="m-0 mt-2 text-xs text-neutral-500">{!order.supplier.phone ? "No phone saved for this supplier: WhatsApp opens without a number. " : ""}{!order.supplier.email ? "No email saved." : ""}</p>}
              {sent && (
                <div className="mt-3 space-y-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 p-3">
                  <p className="m-0 whitespace-pre-line text-[13px] leading-relaxed text-neutral-700">{sent.message}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copy("message", sent.message)} className={quietButton}><Copy className="h-3.5 w-3.5" />{copied === "message" ? "Copied" : "Copy message"}</button>
                    <button type="button" onClick={() => void copy("link", sent.link)} className={quietButton}><Copy className="h-3.5 w-3.5" />{copied === "link" ? "Copied" : "Copy link"}</button>
                  </div>
                </div>
              )}
              {!sent && order.supplierLink && (
                <button type="button" onClick={() => void copy("link", order.supplierLink!)} className={`${quietButton} mt-3`}><Copy className="h-3.5 w-3.5" />{copied === "link" ? "Copied" : "Copy supplier link"}</button>
              )}
              <dl className="m-0 mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-neutral-500">Sent</dt><dd className="m-0 text-right font-bold text-neutral-800">{order.sentAt ? `${formatWhen(order.sentAt)}${order.sentVia ? ` by ${SEND_CHANNEL_LABELS[order.sentVia] ?? order.sentVia}` : ""}` : "Not yet"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-neutral-500">Opened by supplier</dt><dd className="m-0 flex items-center gap-1 text-right font-bold text-neutral-800">{order.supplierViewedAt ? <><Eye className="h-3.5 w-3.5 text-brand" />{formatWhen(order.supplierViewedAt)}</> : "Not yet"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-neutral-500">Confirmed</dt><dd className={`m-0 text-right font-bold ${order.supplierConfirmedAt ? "text-emerald-700" : "text-neutral-800"}`}>{order.supplierConfirmedAt ? `Yes, delivers ${formatDateOnly(order.supplierDeliveryDate)}` : "Not yet"}</dd></div>
              </dl>
              {order.supplierNote && <p className="m-0 mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">Supplier: {order.supplierNote}</p>}
            </SectionCard>
          )}

          <SectionCard icon={CheckCircle2} title="History">
            <ol className="m-0 list-none space-y-3 p-0 text-sm">
              <HistoryItem label="Created" who={order.createdBy} when={order.createdAt} />
              {order.submittedAt && <HistoryItem label={order.approvedAt && order.approvedBy === order.submittedBy ? "Submitted and approved" : "Submitted"} who={order.submittedBy} when={order.submittedAt} />}
              {order.approvedAt && order.approvedBy !== order.submittedBy && <HistoryItem label="Approved by the owner" who={order.approvedBy} when={order.approvedAt} note={order.approvalNote} />}
              {order.sentAt && <HistoryItem label="Sent to supplier" who={order.sentBy} when={order.sentAt} />}
              {order.supplierConfirmedAt && <HistoryItem label={`Supplier confirmed for ${formatDateOnly(order.supplierDeliveryDate)}`} who={order.supplier.name} when={order.supplierConfirmedAt} />}
              {order.cancelledAt && <HistoryItem label="Cancelled" who={order.cancelledBy} when={order.cancelledAt} />}
              {order.closedAt && <HistoryItem label="Closed short" who={order.closedBy} when={order.closedAt} />}
            </ol>
            {order.requisitions.length > 0 && <p className="m-0 mt-4 text-[13px] text-neutral-500">Answers {order.requisitions.map((row) => row.requisitionNumber).join(", ")}</p>}
            {(actions.cancel || actions.close) && (
              <div className="mt-4 flex flex-wrap gap-2 border-0 border-t border-solid border-neutral-100 pt-3">
                {actions.cancel && <button type="button" onClick={() => { setReasonFor("cancel"); setReason(""); }} className={quietButton}><XCircle className="h-3.5 w-3.5" />Cancel order</button>}
                {actions.close && <button type="button" onClick={() => { setReasonFor("close"); setReason(""); }} className={quietButton}><XCircle className="h-3.5 w-3.5" />Close short</button>}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {editing && overview && selectedPropertyId && (
        <OrderEditorModal
          propertyId={selectedPropertyId}
          overview={overview}
          suppliers={suppliers}
          initial={editing}
          orderLimit={detail.limits.purchaseOrderLimit}
          isOwner={detail.viewer.isOwner}
          onClose={() => setEditing(null)}
          onSaved={({ submitted, status }) => {
            setEditing(null);
            setNotice(!submitted ? "Draft saved." : status === "PENDING_APPROVAL" ? "Saved and sent to the owner for approval." : "Saved and approved. Send it to the supplier next.");
            void load();
          }}
        />
      )}
      {receiving && overview && selectedPropertyId && (
        <GoodsReceiptModal
          propertyId={selectedPropertyId}
          overview={overview}
          suppliers={[]}
          onSupplierAdded={() => undefined}
          purchaseOrder={receiveOrder}
          onClose={() => setReceiving(false)}
          onSaved={(result) => {
            setReceiving(false);
            setNotice(result.status === "PENDING_APPROVAL"
              ? `${result.receiptNumber} is waiting for a manager${result.overDelivered?.length ? ` because more ${result.overDelivered.join(", ")} arrived than ordered` : ""}.`
              : `${result.receiptNumber} received into stock${result.flaggedLines ? `, with ${result.flaggedLines} price ${result.flaggedLines === 1 ? "jump" : "jumps"} flagged` : ""}.`);
            void load();
            void loadOverview(true);
          }}
        />
      )}
      {openReceiptId != null && <ReceiptDetailModal receiptId={openReceiptId} currency={currency} onClose={() => setOpenReceiptId(null)} onChanged={() => { void load(); void loadOverview(true); }} />}
    </div>
  );
}

function HistoryItem({ label, who, when, note }: { label: string; who: string | null; when: string; note?: string | null }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
      <span className="min-w-0">
        <span className="block font-bold text-neutral-900">{label}</span>
        <span className="block text-[13px] text-neutral-500">{who ?? "Someone"} · {formatWhen(when)}</span>
        {note && <span className="mt-0.5 block text-[13px] text-neutral-600">{note}</span>}
      </span>
    </li>
  );
}
