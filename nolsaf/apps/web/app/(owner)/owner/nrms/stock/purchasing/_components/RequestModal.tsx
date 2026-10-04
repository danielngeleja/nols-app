"use client";

// A shelf asking for goods: what and how much, by when. No supplier and no
// price; a manager decides how to buy it.

import { useMemo, useState } from "react";
import { ClipboardList, Loader2, Plus, Trash2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError } from "../../../_components/stockFormat";
import { fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { type AmountDraft, AmountInput, amountPayload, amountToBase, defaultAmount } from "../../operations/_components/shared";

type Line = { key: number; stockItemId: number | ""; amount: AmountDraft };
let lineKey = 0;
const nextKey = () => (lineKey += 1);

export type RequestPrefill = { locationId: number | null; lines: Array<{ stockItemId: number; packUnitId: number | null; amount: number }> };

export default function RequestModal({ propertyId, overview, prefill, onClose, onSaved }: {
  propertyId: number;
  overview: StockOverview;
  prefill?: RequestPrefill | null;
  onClose: () => void;
  onSaved: (requisitionNumber: string) => void;
}) {
  const goods = useMemo(() => overview.items.filter((item) => item.status === "ACTIVE"), [overview.items]);
  const goodById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  const [locationId, setLocationId] = useState<number | "">(prefill?.locationId ?? (overview.locations.length === 1 ? overview.locations[0].id : ""));
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(() => {
    const rows = (prefill?.lines ?? []).map((line) => ({ key: nextKey(), stockItemId: line.stockItemId, amount: { packUnitId: line.packUnitId ?? "units", amount: line.amount > 0 ? String(line.amount) : "" } as AmountDraft }));
    return rows.length ? rows : [{ key: nextKey(), stockItemId: "", amount: { packUnitId: "units", amount: "" } }];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<Line>) => setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const computed = lines.map((line) => {
    const good = line.stockItemId ? goodById.get(line.stockItemId) ?? null : null;
    return { line, good, base: amountToBase(good, line.amount) };
  });
  const ids = computed.map((row) => row.good?.id).filter(Boolean);
  const hasDuplicate = new Set(ids).size !== ids.length;
  const valid = Boolean(locationId) && !hasDuplicate && computed.every((row) => row.good && row.base > 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ requisitionNumber: string }>(`/api/nrms/stock/property/${propertyId}/requisitions`, {
        locationId,
        neededBy: neededBy || null,
        note: note.trim() || null,
        lines: computed.map((row) => ({ stockItemId: row.good!.id, ...amountPayload(row.good, row.line.amount) })),
      });
      onSaved(res.data.requisitionNumber);
    } catch (cause) {
      setError(apiError(cause, "Could not send the request"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Ask for goods"
      subtitle="Say what your shelf needs. A manager chooses the supplier and the price."
      icon={<ClipboardList className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
          <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send request</button>
        </div>
      )}
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-solid border-neutral-200 bg-neutral-50/70 p-4">
          <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-wide text-neutral-500">Request details</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClass}>
              For
              <select value={locationId} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
                <option value="">Choose the shelf</option>
                {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <div>
              <p className={`${labelClass} m-0`}>Needed by (optional)</p>
              <div className="mt-1.5"><DatePickerField label="Needed by" value={neededBy} min={new Date().toISOString().slice(0, 10)} twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setNeededBy(next.slice(0, 10))} /></div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-solid border-neutral-300">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {[["#", "w-10 pl-4 text-center"], ["What you need", ""], ["How much", ""], ["", "w-12 pr-4"]].map(([label, extra]) => (
                  <th key={label || "remove"} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computed.map(({ line, good }, index) => {
                const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-2.5 align-top";
                const twice = good && computed.filter((row) => row.good?.id === good.id).length > 1;
                return (
                  <tr key={line.key} className={twice ? "bg-amber-50/60" : index % 2 ? "bg-neutral-50/50" : "bg-white"}>
                    <td className={`${cell} pl-4 pt-4 text-center text-xs font-bold text-neutral-400`}>{index + 1}</td>
                    <td className={cell}>
                      <select value={line.stockItemId} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : ""; update(line.key, { stockItemId: id, amount: defaultAmount(id ? goodById.get(id) : null) }); }} className={`${smallFieldClass} w-full`} aria-label={`Good ${index + 1}`}>
                        <option value="">Choose goods</option>
                        {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                      {twice && <span className="mt-1 block text-xs font-bold text-amber-800">Already on the list. Use one line.</span>}
                    </td>
                    <td className={`${cell} w-[260px]`}><AmountInput good={good} value={line.amount} onChange={(next) => update(line.key, { amount: next })} ariaLabel="Quantity needed" /></td>
                    <td className={`${cell} pr-4 text-right`}>
                      <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:border-red-300 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-neutral-100">
                <td colSpan={4} className="px-3 py-2.5 pl-4">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setLines((rows) => [...rows, { key: nextKey(), stockItemId: "", amount: { packUnitId: "units", amount: "" } }])} className={`${quietButton} bg-white`}><Plus className="h-3.5 w-3.5" />Add another good</button>
                    <span className="text-xs text-neutral-500">{computed.filter((row) => row.good && row.base > 0).length} of {computed.length} ready</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <label className={labelClass}>
          Note (optional)
          <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="For the weekend function, guest asked for a brand" className={fieldClass} />
        </label>
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}
