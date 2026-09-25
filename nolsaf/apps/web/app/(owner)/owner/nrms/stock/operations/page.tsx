"use client";

// Store operations (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 2):
// deliveries from suppliers, transfers between shelves, write-offs, the
// supplier directory, approvals above the owner's limits, and the settings.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightLeft, CheckCircle2, ClipboardCheck, Coffee, Inbox, Loader2, Settings2, ShieldCheck, Trash, Truck, Users, Warehouse } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../_components/NrmsProvider";
import { useStockOverview } from "../../_components/StockGoodsPanel";
import { outlineButton, primaryButton } from "../items/_components/ui";
import StockPageHeader, { type StockTile } from "../_components/StockPageHeader";
import { ApprovalsTab, SettingsTab } from "./_components/ApprovalsAndSettings";
import BreakfastTab from "./_components/BreakfastTab";
import DeliveriesTab from "./_components/DeliveriesTab";
import GoodsReceiptModal, { type SupplierLite } from "./_components/GoodsReceiptModal";
import SuppliersTab from "./_components/SuppliersTab";
import TransfersTab from "./_components/TransfersTab";
import WriteOffsTab, { WriteOffModal } from "./_components/WriteOffsTab";

type Tab = "deliveries" | "transfers" | "write-offs" | "breakfast" | "suppliers" | "approvals" | "settings";
type Attention = { pendingReceipts: number; pendingWriteOffs: number; incomingTransfers: number; total: number };

export default function StoreOperationsPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: overview, loading, error, load } = useStockOverview(selectedPropertyId);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [receiving, setReceiving] = useState(false);
  const [writingOff, setWritingOff] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAttention = useCallback(async () => {
    if (!selectedPropertyId) return;
    try {
      const res = await apiClient.get<Attention>(`/api/nrms/stock/property/${selectedPropertyId}/attention`);
      setAttention(res.data);
    } catch { /* badges are a convenience; the tabs still load on their own */ }
  }, [selectedPropertyId]);
  useEffect(() => { void loadAttention(); }, [loadAttention, refreshKey]);

  const changed = () => {
    setRefreshKey((value) => value + 1);
    void load(true);
  };

  const openDelivery = async () => {
    if (!selectedPropertyId) return;
    try {
      const res = await apiClient.get<{ suppliers: SupplierLite[] }>(`/api/nrms/stock/property/${selectedPropertyId}/suppliers`);
      setSuppliers(res.data.suppliers);
    } catch { setSuppliers([]); }
    setReceiving(true);
  };

  const pendingApprovals = (attention?.pendingReceipts ?? 0) + (attention?.pendingWriteOffs ?? 0);
  const incoming = attention?.incomingTransfers ?? 0;
  const tabs: Array<{ key: Tab; label: string; icon: typeof Truck; count?: number; alert?: boolean; visible: boolean }> = overview ? [
    { key: "deliveries", label: "Deliveries", icon: Truck, visible: overview.canReceive || overview.canApprove },
    { key: "transfers", label: "Transfers", icon: ArrowRightLeft, count: incoming, visible: true },
    { key: "write-offs", label: "Write-offs", icon: Trash, visible: true },
    { key: "breakfast", label: "Breakfast", icon: Coffee, visible: overview.canWriteOff || overview.canManageCatalog },
    { key: "suppliers", label: "Suppliers", icon: Users, visible: overview.canReceive || overview.canManageSuppliers },
    { key: "approvals", label: "Approvals", icon: ClipboardCheck, count: pendingApprovals, alert: true, visible: overview.canApprove },
    { key: "settings", label: "Settings", icon: Settings2, visible: overview.canApprove },
  ] : [];
  const visibleTabs = tabs.filter((row) => row.visible);
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = visibleTabs.some((row) => row.key === requested) ? requested! : visibleTabs[0]?.key ?? "transfers";
  const setTab = (next: Tab) => router.replace(`/owner/nrms/stock/operations?tab=${next}`);

  const store = overview?.locations.find((row) => row.kind === "STORE");
  const tiles: StockTile[] | null = overview ? [
    overview.canApprove
      ? { icon: ClipboardCheck, label: "Waiting your approval", value: String(pendingApprovals), note: pendingApprovals ? "Deliveries or write-offs above the limit" : "Nothing waiting", tone: pendingApprovals ? "amber" : "calm" }
      : { icon: ClipboardCheck, label: "Approvals", value: "-", note: "Handled by owner or manager", tone: "neutral" },
    { icon: Inbox, label: "On the way to your shelves", value: String(incoming), note: incoming ? "Confirm what arrived under Transfers" : "No transfers in transit", tone: incoming ? "brand" : "calm" },
    { icon: Warehouse, label: "Main store", value: store ? store.name : "Not in use", note: store ? "Deliveries can go to the store first" : "Deliveries go straight to outlets", tone: "neutral" },
    { icon: ShieldCheck, label: "Delivery limit", value: `${Math.round(overview.settings.directPurchaseLimit).toLocaleString()} ${overview.currency}`, note: "Above this a manager approves", tone: "neutral" },
  ] : null;

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <StockPageHeader
        icon={Truck}
        title="Store operations"
        subtitle="What arrived and what it cost, what moved between shelves, and what left without a sale."
        actions={overview && (
          <>
            {overview.canWriteOff && <button type="button" onClick={() => setWritingOff(true)} className={`${outlineButton} !h-10 px-4`}><Trash className="h-4 w-4" />Write off</button>}
            {overview.canReceive && <button type="button" onClick={() => void openDelivery()} className={`${primaryButton} !h-10 px-4`}><Truck className="h-4 w-4" />New delivery</button>}
          </>
        )}
        tiles={tiles}
        tabs={visibleTabs}
        activeTab={tab}
        onTab={setTab}
        ariaLabel="Store operations"
      />

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-sm font-bold text-emerald-800 [font-family:inherit] hover:underline">Dismiss</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && !overview ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : overview && selectedPropertyId ? (
        <>
          {tab === "deliveries" && <DeliveriesTab propertyId={selectedPropertyId} overview={overview} onNew={() => void openDelivery()} refreshKey={refreshKey} onChanged={changed} />}
          {tab === "transfers" && <TransfersTab propertyId={selectedPropertyId} overview={overview} refreshKey={refreshKey} onChanged={changed} />}
          {tab === "write-offs" && <WriteOffsTab propertyId={selectedPropertyId} overview={overview} refreshKey={refreshKey} onChanged={changed} />}
          {tab === "breakfast" && <BreakfastTab propertyId={selectedPropertyId} overview={overview} onChanged={changed} />}
          {tab === "suppliers" && <SuppliersTab propertyId={selectedPropertyId} overview={overview} refreshKey={refreshKey} onChanged={changed} />}
          {tab === "approvals" && <ApprovalsTab propertyId={selectedPropertyId} overview={overview} refreshKey={refreshKey} onChanged={changed} />}
          {tab === "settings" && <SettingsTab propertyId={selectedPropertyId} overview={overview} onChanged={changed} />}
        </>
      ) : null}

      {receiving && overview && selectedPropertyId && (
        <GoodsReceiptModal
          propertyId={selectedPropertyId}
          overview={overview}
          suppliers={suppliers}
          onSupplierAdded={(supplier) => setSuppliers((rows) => [...rows, supplier])}
          onClose={() => setReceiving(false)}
          onSaved={(result) => {
            setReceiving(false);
            setNotice(result.status === "PENDING_APPROVAL"
              ? `${result.receiptNumber} is waiting for a manager's approval before it enters stock.`
              : `${result.receiptNumber} received into stock${result.flaggedLines ? `, with ${result.flaggedLines} price ${result.flaggedLines === 1 ? "jump" : "jumps"} flagged` : ""}.`);
            if (tab !== "deliveries") setTab("deliveries");
            changed();
          }}
        />
      )}
      {writingOff && overview && selectedPropertyId && (
        <WriteOffModal propertyId={selectedPropertyId} overview={overview} onClose={() => setWritingOff(false)} onSaved={() => { setWritingOff(false); setNotice("Write-off recorded."); changed(); }} />
      )}
    </div>
  );
}
