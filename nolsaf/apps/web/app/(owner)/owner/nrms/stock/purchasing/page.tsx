"use client";

// Purchasing (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 4): what needs
// buying, what the shelves have asked for, and the orders to suppliers.
// Market runs without an order stay on Store operations > New delivery.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, ClipboardList, FileText, Loader2, PackageSearch, ShoppingCart, Truck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../_components/NrmsProvider";
import { useStockOverview } from "../../_components/StockGoodsPanel";
import { apiError, formatMoney } from "../../_components/stockFormat";
import { outlineButton, primaryButton } from "../items/_components/ui";
import StockPageHeader, { type StockTile, type TileTone } from "../_components/StockPageHeader";
import type { SupplierLite } from "../operations/_components/GoodsReceiptModal";
import OrderEditorModal from "./_components/OrderEditorModal";
import OrdersTab from "./_components/OrdersTab";
import ReorderTab from "./_components/ReorderTab";
import RequestModal, { type RequestPrefill } from "./_components/RequestModal";
import RequestsTab from "./_components/RequestsTab";
import type { OrderDraft, PurchasingSummary } from "./_components/purchasingShared";

type Tab = "reorder" | "requests" | "orders";

export default function PurchasingPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: overview, loading, error: overviewError } = useStockOverview(selectedPropertyId);
  const [summary, setSummary] = useState<PurchasingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [asking, setAsking] = useState<RequestPrefill | null | false>(false);
  const [editing, setEditing] = useState<OrderDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ordersFilter, setOrdersFilter] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!selectedPropertyId) return;
    try {
      const res = await apiClient.get<PurchasingSummary>(`/api/nrms/stock/property/${selectedPropertyId}/purchasing`);
      setSummary(res.data);
      setSummaryError(null);
    } catch (cause) {
      setSummaryError(apiError(cause, "Unable to open purchasing"));
    }
  }, [selectedPropertyId]);
  useEffect(() => { void loadSummary(); }, [loadSummary, refreshKey]);

  useEffect(() => {
    if (!selectedPropertyId || !summary?.canManage) return;
    apiClient.get<{ suppliers: SupplierLite[] }>(`/api/nrms/stock/property/${selectedPropertyId}/suppliers`)
      .then((res) => setSuppliers(res.data.suppliers))
      .catch(() => setSuppliers([]));
  }, [selectedPropertyId, summary?.canManage, refreshKey]);

  const changed = () => setRefreshKey((value) => value + 1);

  const tabs: Array<{ key: Tab; label: string; icon: typeof Truck; count?: number; alert?: boolean; visible: boolean }> = summary ? [
    { key: "reorder", label: "Reorder list", icon: PackageSearch, count: summary.counts.reorder, alert: true, visible: summary.canManage || summary.canRequest },
    { key: "requests", label: "Requests", icon: ClipboardList, count: summary.counts.openRequisitions, alert: summary.canManage, visible: summary.canManage || summary.canRequest },
    { key: "orders", label: summary.canManage ? "Orders" : "Deliveries due", icon: FileText, count: summary.canManage ? summary.counts.pendingApproval : summary.counts.awaitingDelivery, alert: summary.canManage, visible: summary.canManage || summary.canReceive },
  ] : [];
  const visibleTabs = tabs.filter((row) => row.visible);
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = visibleTabs.some((row) => row.key === requested) ? requested! : visibleTabs[0]?.key ?? "orders";
  const setTab = (next: Tab) => router.replace(`/owner/nrms/stock/purchasing?tab=${next}`);

  const newOrder = () => setEditing({ supplierId: null, locationId: null, expectedDate: "", note: "", lines: [], requisitionLineIds: [] });

  const counts = summary?.counts;
  const tiles: StockTile[] | null = summary && counts ? [
    { icon: PackageSearch, label: "Low on the shelves", value: String(counts.reorder), note: counts.reorder ? "At or below the reorder point" : "Nothing needs buying", tone: counts.reorder ? "amber" : "calm" },
    { icon: ClipboardList, label: "Open requests", value: String(counts.openRequisitions), note: counts.openRequisitions ? (summary.canManage ? "Waiting to be ordered" : "Asked for, not yet ordered") : "No requests waiting", tone: counts.openRequisitions && summary.canManage ? "amber" : counts.openRequisitions ? "brand" : "calm" },
    ...(summary.canManage ? [{
      icon: ClipboardCheck,
      label: summary.canApproveOrders ? "Waiting your approval" : "Waiting the owner",
      value: String(counts.pendingApproval),
      note: `Orders above ${formatMoney(summary.purchaseOrderLimit, overview?.currency ?? "TZS")}`,
      tone: (counts.pendingApproval && summary.canApproveOrders ? "amber" : counts.pendingApproval ? "brand" : "calm") as TileTone,
    }] : []),
    { icon: Truck, label: "Deliveries due", value: String(counts.awaitingDelivery), note: counts.awaitingDelivery ? "Approved orders not yet received" : "Nothing on the way", tone: counts.awaitingDelivery ? "brand" : "calm" },
  ] : null;

  const error = overviewError || summaryError;

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <StockPageHeader
        icon={ShoppingCart}
        title="Purchasing"
        subtitle="What needs buying, what the shelves asked for, and the orders that go to suppliers."
        actions={summary && (
          <>
            {summary.canRequest && <button type="button" onClick={() => setAsking(null)} className={`${outlineButton} !h-10 px-4`}><ClipboardList className="h-4 w-4" />Ask for goods</button>}
            {summary.canManage && <button type="button" onClick={newOrder} className={`${primaryButton} !h-10 px-4`}><ShoppingCart className="h-4 w-4" />New order</button>}
          </>
        )}
        tiles={tiles}
        tabs={visibleTabs}
        activeTab={tab}
        onTab={setTab}
        ariaLabel="Purchasing"
      />

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-sm font-bold text-emerald-800 [font-family:inherit] hover:underline">Dismiss</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {(loading && !overview) || (!summary && !summaryError) ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : overview && summary && selectedPropertyId ? (
        <>
          {tab === "reorder" && (
            <ReorderTab
              propertyId={selectedPropertyId}
              overview={overview}
              summary={summary}
              suppliers={suppliers}
              refreshKey={refreshKey}
              onOrder={setEditing}
              onDraftsCreated={(count) => { setNotice(`${count} draft orders created, one per supplier. Open each to check prices and approve it.`); setOrdersFilter("DRAFT"); changed(); setTab("orders"); }}
              onAsk={(prefill) => setAsking(prefill)}
            />
          )}
          {tab === "requests" && <RequestsTab propertyId={selectedPropertyId} overview={overview} summary={summary} refreshKey={refreshKey} onAsk={() => setAsking(null)} onOrder={setEditing} onChanged={changed} />}
          {tab === "orders" && <OrdersTab key={ordersFilter ?? "default"} propertyId={selectedPropertyId} currency={overview.currency} summary={summary} refreshKey={refreshKey} initialFilter={ordersFilter} onNew={newOrder} />}
        </>
      ) : null}

      {asking !== false && overview && selectedPropertyId && (
        <RequestModal
          propertyId={selectedPropertyId}
          overview={overview}
          prefill={asking}
          onClose={() => setAsking(false)}
          onSaved={(number) => { setAsking(false); setNotice(`Request ${number} sent. A manager will order it.`); changed(); if (tab !== "requests") setTab("requests"); }}
        />
      )}
      {editing && overview && summary && selectedPropertyId && (
        <OrderEditorModal
          propertyId={selectedPropertyId}
          overview={overview}
          suppliers={suppliers}
          initial={editing}
          orderLimit={summary.purchaseOrderLimit}
          isOwner={summary.canApproveOrders}
          onClose={() => setEditing(null)}
          onSaved={({ orderId }) => { setEditing(null); changed(); router.push(`/owner/nrms/stock/purchasing/${orderId}`); }}
        />
      )}
    </div>
  );
}
