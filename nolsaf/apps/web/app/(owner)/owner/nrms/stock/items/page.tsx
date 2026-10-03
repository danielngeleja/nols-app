"use client";

// Stock control workspace (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 1).
// Owner and manager: the goods the property holds, how they are bought, what
// each menu item uses, and moving old menu counters across.

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, BookOpen, Boxes, LayoutDashboard, Library, Loader2, PackagePlus, Replace, Wallet, Warehouse } from "lucide-react";
import { useNrms } from "../../_components/NrmsProvider";
import { ReceiveModal, type StockGood } from "../../_components/StockGoodsPanel";
import { formatMoney } from "../../_components/stockFormat";
import ConvertTab from "./_components/ConvertTab";
import ItemModal from "./_components/ItemModal";
import ItemsTab from "./_components/ItemsTab";
import OverviewTab, { type WorkspaceTab } from "./_components/OverviewTab";
import RecipesTab from "./_components/RecipesTab";
import StarterCatalogueModal from "./_components/StarterCatalogueModal";
import { useStockWorkspace } from "./_components/useStockWorkspace";
import { cardClass, outlineButton, primaryButton } from "./_components/ui";
import StockPageHeader, { type StockTile } from "../_components/StockPageHeader";

const TABS: Array<[WorkspaceTab, string, typeof Boxes]> = [
  ["overview", "Overview", LayoutDashboard],
  ["items", "Stock items", Boxes],
  ["recipes", "Recipes", BookOpen],
  ["convert", "Move menu counters", Replace],
];

export default function NrmsStockItemsPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: WorkspaceTab = TABS.some(([key]) => key === tabParam) ? (tabParam as WorkspaceTab) : "overview";
  const workspace = useStockWorkspace(selectedPropertyId);
  const { overview } = workspace;

  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [editing, setEditing] = useState<StockGood | "new" | null>(null);
  const [receive, setReceive] = useState<{ stockItemId?: number; locationId?: number; opening?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setTab = (next: WorkspaceTab) => router.replace(next === "overview" ? "/owner/nrms/stock/items" : `/owner/nrms/stock/items?tab=${next}`);

  const goods = (overview?.items ?? []).filter((item) => item.status === "ACTIVE");
  const stockValue = goods.reduce((sum, good) => sum + (good.stockValue ?? 0), 0);
  const attention = goods.flatMap((good) => good.balances).filter((row) => row.quantity <= 0 || (row.reorderPoint != null && row.quantity <= row.reorderPoint)).length;
  const { linked, total } = workspace.coverage;
  const coveragePercent = total ? Math.round((linked / total) * 100) : 0;
  const currency = overview?.currency ?? selectedProperty?.currency ?? "TZS";

  const tiles: StockTile[] | null = overview ? [
    { icon: Wallet, label: "Stock value at cost", value: overview.showCost ? formatMoney(stockValue, currency) : "-", note: overview.showCost ? (stockValue > 0 ? "On every shelf, at average cost" : "Record opening counts to value stock") : "Owner and manager only", tone: stockValue > 0 ? "brand" : "neutral" },
    { icon: Boxes, label: "Goods tracked", value: String(goods.length), note: goods.length ? "Active stock items" : "Add goods or use the starter catalogue", tone: goods.length ? "calm" : "amber" },
    { icon: BookOpen, label: "Menu linked to stock", value: total ? `${coveragePercent}%` : "-", note: total ? `${linked} of ${total} menu items have a recipe` : "No menu yet", tone: !total ? "neutral" : coveragePercent >= 80 ? "calm" : "amber" },
    { icon: AlertTriangle, label: "Need attention", value: String(attention), note: attention ? "Out, below zero or at reorder point" : "Every shelf is stocked", tone: attention ? "amber" : "calm" },
  ] : null;

  const refreshWith = async (message?: string) => {
    await workspace.reload();
    if (message) setNotice(message);
  };

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <StockPageHeader
        icon={Warehouse}
        title="Stock items & recipes"
        subtitle="The goods you buy, what each menu item takes off the shelf, and where the money sits."
        actions={overview?.canManageCatalog ? (
          <>
            <button type="button" onClick={() => setCatalogueOpen(true)} className={`${outlineButton} !h-10 px-4`}><Library className="h-4 w-4" />Starter catalogue</button>
            {goods.length > 0 && <Link href="/owner/nrms/stock/operations?tab=deliveries" className={`${outlineButton} !h-10 px-4 no-underline hover:no-underline`}><ArrowDownToLine className="h-4 w-4" />New delivery</Link>}
            <button type="button" onClick={() => setEditing("new")} className={`${primaryButton} !h-10 px-4`}><PackagePlus className="h-4 w-4" />Add stock item</button>
          </>
        ) : undefined}
        tiles={tiles}
        tabs={TABS.map(([key, label, icon]) => ({ key, label, icon, count: key === "convert" ? overview?.legacy.length ?? 0 : 0, alert: true }))}
        activeTab={tab}
        onTab={setTab}
        ariaLabel="Stock items and recipes"
      />

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-sm font-bold text-emerald-800 hover:underline">Dismiss</button>
        </div>
      )}
      {workspace.error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-700">{workspace.error}</div>}

      {workspace.loading && !overview ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : overview && selectedPropertyId ? (
        !overview.canManageCatalog ? (
          <p className={`${cardClass} m-0 px-4 py-6 text-center text-sm text-neutral-500`}>Only the owner or a manager can set up stock items and recipes.</p>
        ) : tab === "overview" ? (
          <OverviewTab workspace={workspace} onTab={setTab} onCatalogue={() => setCatalogueOpen(true)} onAddItem={() => setEditing("new")} />
        ) : tab === "items" ? (
          <ItemsTab
            workspace={workspace}
            onAdd={() => setEditing("new")}
            onCatalogue={() => setCatalogueOpen(true)}
            onEdit={(good) => setEditing(good)}
            onReceive={(good, locationId) => setReceive({ stockItemId: good.id, locationId })}
            onOpening={(good, locationId) => setReceive({ stockItemId: good.id, locationId, opening: true })}
          />
        ) : tab === "recipes" ? (
          <RecipesTab workspace={workspace} onAddItem={() => setEditing("new")} onCatalogue={() => setCatalogueOpen(true)} />
        ) : (
          <ConvertTab workspace={workspace} propertyId={selectedPropertyId} />
        )
      ) : null}

      {catalogueOpen && selectedPropertyId && (
        <StarterCatalogueModal
          propertyId={selectedPropertyId}
          existingNames={new Set((overview?.items ?? []).map((item) => item.name.toLowerCase()))}
          onClose={() => setCatalogueOpen(false)}
          onAdded={(count) => { setCatalogueOpen(false); void refreshWith(`${count} goods added. Next: record today's count for each one.`); }}
        />
      )}
      {editing && overview && selectedPropertyId && (
        <ItemModal propertyId={selectedPropertyId} data={overview} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refreshWith(); }} />
      )}
      {receive && overview && selectedPropertyId && (
        <ReceiveModal propertyId={selectedPropertyId} data={overview} initial={receive} onClose={() => setReceive(null)} onSaved={() => { setReceive(null); void refreshWith(receive.opening ? "Opening count saved." : "Delivery recorded."); }} />
      )}
    </div>
  );
}
