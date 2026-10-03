"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, Settings2, Trash, Warehouse } from "lucide-react";
import apiClient from "@/lib/apiClient";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney } from "../../../_components/stockFormat";
import { Pill, SectionCard, cardClass, checkboxClass, fieldClass, labelClass, primaryButton, smallFieldClass } from "../../items/_components/ui";
import { type Receipt, ReceiptDetailModal } from "./DeliveriesTab";
import WriteOffsTab from "./WriteOffsTab";
import { formatWhen } from "./shared";

/** Everything waiting on a manager: deliveries above the limit and large write-offs. */
export function ApprovalsTab({ propertyId, overview, refreshKey, onChanged }: { propertyId: number; overview: StockOverview; refreshKey: number; onChanged: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ receipts: Receipt[] }>(`/api/nrms/stock/property/${propertyId}/goods-receipts`, { params: { status: "PENDING_APPROVAL" } });
      setReceipts(res.data.receipts);
    } catch (cause) {
      setError(apiError(cause, "Unable to load approvals"));
    }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard icon={ClipboardCheck} tone="amber" title="Deliveries waiting" subtitle={`Above ${formatMoney(overview.settings.directPurchaseLimit, overview.currency)} from someone without approval rights`} bodyClass="p-0">
        {error && <p className="m-0 px-4 py-3 text-sm text-red-700">{error}</p>}
        {!receipts ? (
          <div className="flex min-h-[12vh] items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : receipts.length === 0 ? (
          <p className="m-0 flex items-center justify-center gap-2 px-4 py-8 text-sm text-neutral-500"><CheckCircle2 className="h-4 w-4 text-brand" />Nothing waiting.</p>
        ) : receipts.map((row) => (
          <button key={row.id} type="button" onClick={() => setOpenId(row.id)} className="flex w-full items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 bg-white px-4 py-3 text-left [font-family:inherit] first:border-t-0 hover:bg-neutral-50">
            <span className="min-w-0">
              <span className="block text-[15px] font-bold text-neutral-900">{row.receiptNumber} · {row.supplierName ?? "Market purchase"}</span>
              <span className="mt-0.5 block text-[13px] text-neutral-500">{formatWhen(row.receivedAt)} · {row.receivedBy ?? "Unknown"} · {row.locationName}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {row.flaggedLines > 0 && <Pill tone="low">{row.flaggedLines} price {row.flaggedLines === 1 ? "jump" : "jumps"}</Pill>}
              <span className="text-sm font-bold tabular-nums">{formatMoney(row.totalCost, overview.currency)}</span>
            </span>
          </button>
        ))}
      </SectionCard>

      <SectionCard icon={Trash} tone="amber" title="Write-offs waiting" subtitle={`Worth more than ${formatMoney(overview.settings.writeOffLimit, overview.currency)}`} bodyClass="p-0">
        <WriteOffsTab propertyId={propertyId} overview={overview} refreshKey={refreshKey} onChanged={onChanged} onlyPending bare />
      </SectionCard>

      {openId != null && <ReceiptDetailModal receiptId={openId} currency={overview.currency} onClose={() => setOpenId(null)} onChanged={() => { void load(); onChanged(); }} />}
    </div>
  );
}

/** Owner-only limits and the main store switch. */
export function SettingsTab({ propertyId, overview, onChanged }: { propertyId: number; overview: StockOverview; onChanged: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [storeEnabled, setStoreEnabled] = useState(overview.settings.storeEnabled);
  const [storeName, setStoreName] = useState("Main store");
  const [purchaseLimit, setPurchaseLimit] = useState(String(overview.settings.directPurchaseLimit));
  const [writeOffLimit, setWriteOffLimit] = useState(String(overview.settings.writeOffLimit));
  const [alertPercent, setAlertPercent] = useState(String(overview.settings.priceAlertPercent));
  const [orderLimit, setOrderLimit] = useState(String(overview.settings.purchaseOrderLimit ?? 500000));
  const [overDelivery, setOverDelivery] = useState(String(overview.settings.overDeliveryPercent ?? 5));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ settings: StockOverview["settings"]; storeName: string; canEdit: boolean }>(`/api/nrms/stock/property/${propertyId}/settings`)
      .then((res) => {
        setCanEdit(res.data.canEdit);
        setStoreName(res.data.storeName);
        setStoreEnabled(res.data.settings.storeEnabled);
        setPurchaseLimit(String(res.data.settings.directPurchaseLimit));
        setWriteOffLimit(String(res.data.settings.writeOffLimit));
        setAlertPercent(String(res.data.settings.priceAlertPercent));
        setOrderLimit(String(res.data.settings.purchaseOrderLimit));
        setOverDelivery(String(res.data.settings.overDeliveryPercent));
      })
      .catch((cause) => setError(apiError(cause, "Unable to load settings")))
      .finally(() => setLoaded(true));
  }, [propertyId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.put(`/api/nrms/stock/property/${propertyId}/settings`, {
        storeEnabled,
        storeName: storeName.trim() || undefined,
        directPurchaseLimit: Number(purchaseLimit) || 0,
        writeOffLimit: Number(writeOffLimit) || 0,
        priceAlertPercent: Math.round(Number(alertPercent) || 0),
        purchaseOrderLimit: Number(orderLimit) || 0,
        overDeliveryPercent: Math.min(100, Math.round(Number(overDelivery) || 0)),
      });
      setMessage("Saved.");
      onChanged();
    } catch (cause) {
      setError(apiError(cause, "Could not save the settings"));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className={`${cardClass} flex min-h-[20vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <SectionCard icon={Warehouse} title="Main store" subtitle="A store room that holds stock before it goes to the bar or kitchen">
        <label className={`flex items-start gap-3 rounded-xl border border-solid p-3.5 transition ${canEdit ? "cursor-pointer" : ""} ${storeEnabled ? "border-brand bg-brand/[0.05]" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
          <input type="checkbox" checked={storeEnabled} disabled={!canEdit} onChange={(event) => setStoreEnabled(event.target.checked)} className={`${checkboxClass} mt-0.5`} />
          <span className="min-w-0">
            <span className={`block text-sm font-bold ${storeEnabled ? "text-brand" : "text-neutral-900"}`}>This property has a store room</span>
            <span className="mt-0.5 block text-[13px] text-neutral-500">Deliveries can go into the store, and goods move to outlets by transfer. Leave it off if the bar is the store.</span>
          </span>
        </label>
        {storeEnabled ? (
          <label className={`${labelClass} mt-4`}>
            Store name
            <input value={storeName} disabled={!canEdit} onChange={(event) => setStoreName(event.target.value.slice(0, 120))} className={fieldClass} />
          </label>
        ) : (
          <p className="m-0 mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Off: every delivery goes straight to the outlet that uses it.</p>
        )}
      </SectionCard>

      <SectionCard icon={Settings2} title="Approval limits" subtitle="What staff may do without asking a manager" bodyClass="p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 pl-4">Rule</th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">What it does</th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 w-[180px] pr-4 text-right">Limit</th>
            </tr>
          </thead>
          <tbody>
            {([
              ["Delivery limit", "A storekeeper's delivery above this waits for a manager.", purchaseLimit, setPurchaseLimit, overview.currency, true],
              ["Order approval limit", "A manager's purchase order above this waits for the owner.", orderLimit, setOrderLimit, overview.currency, true],
              ["Write-off limit", "Wastage worth more than this waits for a manager.", writeOffLimit, setWriteOffLimit, overview.currency, true],
              ["Price jump alert", "Flag a price this much above the agreed or last price.", alertPercent, setAlertPercent, "%", false],
              ["Over-delivery allowance", "Accept up to this much more than ordered. More waits for a manager.", overDelivery, setOverDelivery, "%", false],
            ] as const).map(([label, hint, value, setter, unit, money], index) => (
              <tr key={label} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                <td className="whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-3 py-3 pl-4 font-bold text-neutral-900">{label}</td>
                <td className="border-0 border-b border-solid border-neutral-200 px-3 py-3 text-[13px] text-neutral-500">{hint}</td>
                <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 pr-4">
                  <div className="relative">
                    <input inputMode="numeric" value={value} disabled={!canEdit} onChange={(event) => setter(event.target.value.replace(money ? /[^\d.]/g : /[^\d]/g, ""))} aria-label={label} className={`${smallFieldClass} w-full pr-12 text-right font-bold tabular-nums disabled:bg-neutral-50`} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{unit}</span>
                  </div>
                  {money && Number(value) > 0 && <p className="m-0 mt-1 text-right text-[11px] tabular-nums text-neutral-400">{Number(value).toLocaleString()} {unit}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <div className="xl:col-span-2">
        {!canEdit && <p className="m-0 flex items-center gap-2 text-sm text-neutral-600"><AlertTriangle className="h-4 w-4 text-amber-600" />Only the owner can change these, so nobody sets their own limits.</p>}
        {error && <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="m-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {canEdit && <div className="mt-3 flex justify-end"><button type="button" disabled={busy} onClick={() => void save()} className={`${primaryButton} !h-10 px-5`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save settings</button></div>}
      </div>
    </div>
  );
}
