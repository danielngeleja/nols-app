"use client";

import { AlertTriangle, BookOpen, Boxes, CheckCircle2, ClipboardCheck, Library, PieChart, Replace, Store } from "lucide-react";
import type { StockBalance } from "../../../_components/StockGoodsPanel";
import { STOCK_CATEGORY_LABELS, categoryTone, formatMoney, formatStockQuantity } from "../../../_components/stockFormat";
import type { StockWorkspace } from "./useStockWorkspace";
import { EmptyState, Pill, SectionCard, outlineButton, primaryButton } from "./ui";

export type WorkspaceTab = "overview" | "items" | "recipes" | "convert";

function tone(balance: StockBalance): "ok" | "low" | "out" | "negative" {
  if (balance.quantity < 0) return "negative";
  if (balance.quantity === 0) return "out";
  if (balance.reorderPoint != null && balance.quantity <= balance.reorderPoint) return "low";
  return "ok";
}

export default function OverviewTab({ workspace, onTab, onCatalogue, onAddItem }: {
  workspace: StockWorkspace;
  onTab: (tab: WorkspaceTab) => void;
  onCatalogue: () => void;
  onAddItem: () => void;
}) {
  const overview = workspace.overview!;
  const currency = overview.currency;
  const goods = overview.items.filter((item) => item.status === "ACTIVE");
  const counted = goods.filter((good) => good.balances.length > 0);
  const { linked, total } = workspace.coverage;

  const steps = [
    { done: goods.length > 0, title: "Add the goods you buy", body: goods.length ? `${goods.length} goods added` : "Start from the starter catalogue: beer, spirits, water, meat, fish.", action: goods.length ? null : <button type="button" onClick={onCatalogue} className={primaryButton}><Library className="h-4 w-4" />Open catalogue</button> },
    { done: goods.length > 0 && counted.length === goods.length, title: "Record today's count", body: goods.length ? `${counted.length} of ${goods.length} goods have an opening count` : "Count what is on each shelf once, as the starting point.", action: goods.length && counted.length < goods.length ? <button type="button" onClick={() => onTab("items")} className={outlineButton}>Record counts</button> : null },
    { done: total > 0 && linked === total, title: "Link the menu to the goods", body: total ? `${linked} of ${total} menu items linked` : "Every menu item says what it takes off the shelf.", action: total && linked < total ? <button type="button" onClick={() => onTab("recipes")} className={outlineButton}>Link recipes</button> : null },
    { done: overview.legacy.length === 0, title: "Retire the old menu counters", body: overview.legacy.length ? `${overview.legacy.length} menu items still keep their own count` : "No menu item keeps its own count.", action: overview.legacy.length ? <button type="button" onClick={() => onTab("convert")} className={outlineButton}>Move counters</button> : null },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  const attention = goods
    .flatMap((good) => good.balances.map((balance) => ({ good, balance, outlet: overview.locations.find((row) => row.id === balance.locationId) })))
    .filter((row) => tone(row.balance) !== "ok")
    .sort((a, b) => {
      const rank = { negative: 0, out: 1, low: 2, ok: 3 };
      return rank[tone(a.balance)] - rank[tone(b.balance)];
    });

  const byCategory = new Map<string, { value: number; count: number }>();
  for (const good of goods) {
    const row = byCategory.get(good.category) ?? { value: 0, count: 0 };
    row.value += good.stockValue ?? 0;
    row.count += 1;
    byCategory.set(good.category, row);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].value - a[1].value || b[1].count - a[1].count);
  const maxValue = Math.max(1, ...categories.map(([, row]) => row.value));

  const head = "whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600";
  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
  const stepProgress = [
    goods.length ? 1 : 0,
    goods.length ? counted.length / goods.length : 0,
    total ? linked / total : 0,
    overview.legacy.length === 0 ? 1 : 0,
  ];
  const totalValue = categories.reduce((sum, [, row]) => sum + row.value, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <SectionCard icon={ClipboardCheck} title="Setup" subtitle={`${doneCount} of ${steps.length} steps done`} bodyClass="p-0" action={<span className={`rounded-full px-2.5 py-1 text-xs font-bold ${doneCount === steps.length ? "bg-emerald-50 text-emerald-700" : "bg-brand/10 text-brand"}`}>{Math.round((doneCount / steps.length) * 100)}% ready</span>}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${head} w-12 pl-4 text-center`}>Step</th>
                <th className={head}>What to do</th>
                <th className={`${head} w-[150px]`}>Progress</th>
                <th className={`${head} w-px pr-4 text-right`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => {
                const share = Math.max(0, Math.min(1, stepProgress[index] ?? 0));
                return (
                  <tr key={step.title} className={step.done ? "bg-emerald-50/30" : index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                    <td className={`${cell} pl-4 text-center`}>
                      {step.done
                        ? <CheckCircle2 className="mx-auto h-6 w-6 text-brand" />
                        : <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full border-2 border-solid border-neutral-300 text-xs font-bold text-neutral-500">{index + 1}</span>}
                    </td>
                    <td className={cell}>
                      <p className={`m-0 font-bold ${step.done ? "text-neutral-500" : "text-neutral-900"}`}>{step.title}</p>
                      <p className="m-0 mt-0.5 text-xs text-neutral-500">{step.body}</p>
                    </td>
                    <td className={cell}>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${step.done ? "bg-brand" : "bg-amber-500"}`} style={{ width: `${share * 100}%` }} /></span>
                        <span className="w-9 text-right text-xs tabular-nums text-neutral-500">{Math.round(share * 100)}%</span>
                      </div>
                    </td>
                    <td className={`${cell} whitespace-nowrap pr-4 text-right`}>{step.done ? <Pill tone="ok">Done</Pill> : step.action ?? <span className="text-neutral-300">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard icon={AlertTriangle} tone="amber" title="Needs attention" subtitle="Out, below zero, or at the reorder point" bodyClass="p-0">
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>
              <p className="m-0 text-sm text-neutral-600">{goods.length ? "Every shelf is above its reorder point." : "Nothing to watch yet. Add goods and record their counts first."}</p>
            </div>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead className="sticky top-0">
                  <tr>
                    <th className={`${head} pl-4`}>Good</th>
                    <th className={head}>Where</th>
                    <th className={`${head} text-right`}>On hand</th>
                    <th className={`${head} text-right`}>Reorder at</th>
                    <th className={`${head} pr-4 text-right`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.slice(0, 40).map(({ good, balance, outlet }, index) => (
                    <tr key={`${good.id}-${balance.locationId}`} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                      <td className={`${cell} pl-4 font-bold text-neutral-900`}>{good.name}</td>
                      <td className={`${cell} whitespace-nowrap text-neutral-600`}>{outlet?.name ?? "Outlet"}</td>
                      <td className={`${cell} whitespace-nowrap text-right font-bold tabular-nums ${balance.quantity < 0 ? "text-red-700" : "text-neutral-900"}`}>{formatStockQuantity(balance.quantity, good.baseUnit)}</td>
                      <td className={`${cell} whitespace-nowrap text-right tabular-nums text-neutral-500`}>{balance.reorderPoint != null ? formatStockQuantity(balance.reorderPoint, good.baseUnit) : "-"}</td>
                      <td className={`${cell} whitespace-nowrap pr-4 text-right`}><Pill tone={tone(balance)}>{{ negative: "Below zero", out: "Out", low: "Reorder", ok: "In stock" }[tone(balance)]}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="space-y-4">
        <SectionCard icon={PieChart} tone="sky" title="Stock by category" subtitle={overview.showCost ? "Value at average cost" : "Goods per category"} bodyClass="p-0">
          {categories.length === 0 ? (
            <EmptyState icon={Boxes} title="No goods yet" body="Add goods to see where the money sits on the shelves." action={<><button type="button" onClick={onCatalogue} className={primaryButton}><Library className="h-4 w-4" />Starter catalogue</button><button type="button" onClick={onAddItem} className={outlineButton}>Add one item</button></>} />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${head} pl-4`}>Category</th>
                  <th className={`${head} text-right`}>Goods</th>
                  {overview.showCost && <th className={`${head} text-right`}>Value</th>}
                  {overview.showCost && <th className={`${head} w-[90px] pr-4`}>Share</th>}
                </tr>
              </thead>
              <tbody>
                {categories.map(([category, row], index) => {
                  const share = totalValue > 0 ? row.value / totalValue : 0;
                  return (
                    <tr key={category} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                      <td className={`${cell} pl-4`}><span className="inline-flex items-center gap-2 font-bold text-neutral-800"><span className={`h-2.5 w-2.5 rounded-full ${categoryTone(category).dot}`} />{STOCK_CATEGORY_LABELS[category] ?? category}</span></td>
                      <td className={`${cell} text-right tabular-nums text-neutral-700`}>{row.count}</td>
                      {overview.showCost && <td className={`${cell} whitespace-nowrap text-right font-bold tabular-nums ${row.value > 0 ? "text-neutral-900" : "text-neutral-300"}`}>{row.value > 0 ? formatMoney(row.value, currency) : "-"}</td>}
                      {overview.showCost && (
                        <td className={`${cell} pr-4`}>
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><span className="block h-full rounded-full bg-brand/70" style={{ width: `${(row.value / maxValue) * 100}%` }} /></span>
                            <span className="w-8 text-right text-xs tabular-nums text-neutral-500">{Math.round(share * 100)}%</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {overview.showCost && (
                <tfoot>
                  <tr className="bg-neutral-100 font-bold">
                    <td className="px-3 py-2.5 pl-4 text-[11px] uppercase tracking-wide text-neutral-600">All goods</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{goods.length}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(totalValue, currency)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
          {overview.showCost && totalValue === 0 && goods.length > 0 && <p className="m-0 px-4 py-3 text-xs text-neutral-500">Values show once goods have an opening count or a delivery with a price.</p>}
        </SectionCard>

        <SectionCard icon={Store} title="Menu linked to stock" subtitle="Items whose sales take goods off the shelf" bodyClass="p-0" action={<button type="button" onClick={() => onTab("recipes")} className={outlineButton}><BookOpen className="h-4 w-4" />Recipes</button>}>
          {(workspace.recipes ?? []).length === 0 ? (
            <p className="m-0 px-4 py-5 text-center text-sm text-neutral-400">No outlets with a menu yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${head} pl-4`}>Outlet</th>
                  <th className={`${head} text-right`}>Linked</th>
                  <th className={`${head} text-right`}>Not yet</th>
                  <th className={`${head} w-[110px] pr-4`}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {(workspace.recipes ?? []).map((outlet, index) => {
                  const outletTotal = outlet.menuItems.length;
                  const outletLinked = outlet.menuItems.filter((item) => item.lines.length > 0).length;
                  const share = outletTotal ? outletLinked / outletTotal : 0;
                  return (
                    <tr key={outlet.id} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                      <td className={`${cell} pl-4 font-bold text-neutral-800`}>{outlet.name}</td>
                      <td className={`${cell} text-right tabular-nums text-neutral-800`}>{outletLinked}</td>
                      <td className={`${cell} text-right tabular-nums ${outletTotal - outletLinked ? "font-bold text-amber-700" : "text-neutral-300"}`}>{outletTotal - outletLinked || "-"}</td>
                      <td className={`${cell} pr-4`}>
                        <div className="flex items-center gap-1.5">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${share === 1 ? "bg-brand" : "bg-amber-500"}`} style={{ width: `${share * 100}%` }} /></span>
                          <span className="w-9 text-right text-xs tabular-nums text-neutral-500">{Math.round(share * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SectionCard>

        {overview.legacy.length > 0 && (
          <SectionCard icon={Replace} tone="amber" title="Old menu counters" subtitle={`${overview.legacy.length} items still count on the menu`}>
            <p className="m-0 text-sm text-neutral-600">Those counts change without a trace. Move them to stock items to keep today&apos;s number as the opening count.</p>
            <button type="button" onClick={() => onTab("convert")} className={`${outlineButton} mt-3`}>Review and move</button>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
