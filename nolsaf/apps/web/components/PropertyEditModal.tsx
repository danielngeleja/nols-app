"use client";

// Admin pricing for one property: the NoLSAF commission guests pay on top of the owner's
// price, room prices, and long-stay discount rules. Saves to PATCH /api/admin/properties/:id.
//
// Facts this dialog states, checked against the API:
// - commissionPercent (services.commissionPercent) IS used at checkout (public.bookings.ts
//   getEffectiveCommissionPercent); null means the system default.
// - discountRules are stored with the listing and shown in previews (lib/priceUtils.ts), but
//   no booking or checkout code deducts them yet, so the dialog says so instead of implying it.

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, Trash2, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

interface PropertyEditModalProps {
  property: any;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface DiscountRule {
  minDays: number;
  discountPercent: number;
  enabled: boolean;
}

const SLIDER_MAX = 40;

function niceTitle(value: string) {
  const v = String(value || "").trim();
  if (!v || /[a-z]/.test(v)) return v;
  return v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

export default function PropertyEditModal({ property, isOpen, onClose, onSave }: PropertyEditModalProps) {
  const [systemCommission, setSystemCommission] = useState<number>(0);
  const [useSystemCommission, setUseSystemCommission] = useState<boolean>(true);
  const [customCommission, setCustomCommission] = useState<string>("");
  const [savedCommission, setSavedCommission] = useState<number | null>(null);
  const [roomPrices, setRoomPrices] = useState<Record<number, string>>({});
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !property) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get("/api/public/support/system-settings");
        const commission = Number(response.data?.commissionPercent);
        if (!cancelled) setSystemCommission(Number.isFinite(commission) ? commission : 0);
      } catch {
        // The system default stays at 0 in the preview; saving does not depend on it.
      }
    })();

    const services = property.services && typeof property.services === "object" && !Array.isArray(property.services) ? (property.services as any) : {};
    const rooms: Record<number, string> = {};
    (Array.isArray(property.rooms) ? property.rooms : []).forEach((room: any) => {
      if (room?.id) rooms[room.id] = String(room.pricePerNight ?? "");
    });
    setRoomPrices(rooms);
    // No invented defaults: a property without rules starts with none.
    setDiscountRules(Array.isArray(services.discountRules) ? services.discountRules.map((r: any) => ({ minDays: Number(r.minDays) || 1, discountPercent: Number(r.discountPercent) || 0, enabled: r.enabled !== false })) : []);
    const override = services.commissionPercent;
    const n = Number(override);
    if (override !== undefined && override !== null && override !== "" && Number.isFinite(n) && n >= 0 && n <= 100) {
      setUseSystemCommission(false);
      setCustomCommission(String(n));
      setSavedCommission(n);
    } else {
      setUseSystemCommission(true);
      setCustomCommission("");
      setSavedCommission(null);
    }
    setError(null);
    return () => { cancelled = true; };
  }, [isOpen, property]);

  const currency = property?.currency || "TZS";
  const fmt = useMemo(() => {
    try {
      const f = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
      return (n: number) => f.format(Math.round(Number(n) || 0));
    } catch {
      return (n: number) => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
    }
  }, [currency]);

  const customNumber = Number(customCommission);
  const customValid = customCommission.trim() !== "" && Number.isFinite(customNumber) && customNumber >= 0 && customNumber <= 100;
  const rate = useSystemCommission ? systemCommission : customValid ? customNumber : 0;
  const savedRate = savedCommission ?? systemCommission;
  const withCommission = (price: number) => price + (price * rate) / 100;

  const basePrice = Number(property?.basePrice) || 0;
  const rooms: any[] = Array.isArray(property?.rooms) ? property.rooms : [];
  const priceRows = [
    ...(basePrice > 0 ? [{ key: "base", label: "Base price", sub: "Set by the owner", price: basePrice, original: basePrice, editable: false as const, roomId: 0 }] : []),
    ...rooms.map((room) => {
      const original = Number(room.pricePerNight) || 0;
      const draft = Number(roomPrices[room.id]);
      return { key: `room-${room.id}`, label: room.name || `Room ${room.id}`, sub: "Per night", price: Number.isFinite(draft) ? draft : original, original, editable: true as const, roomId: Number(room.id) };
    }),
  ];

  // Validation that blocks saving, in plain words.
  const ruleProblems = discountRules.map((r) =>
    !Number.isInteger(r.minDays) || r.minDays < 1 ? "Nights must be a whole number of 1 or more."
      : !(r.discountPercent > 0 && r.discountPercent <= 90) ? "Discount must be between 0 and 90%."
        : discountRules.filter((x) => x.minDays === r.minDays).length > 1 ? "Two rules start at the same number of nights."
          : null
  );
  const blocking = (!useSystemCommission && !customValid)
    ? "Enter a commission between 0 and 100%."
    : ruleProblems.find(Boolean) || priceRows.find((r) => r.editable && !(r.price > 0)) ? (ruleProblems.find(Boolean) || "Room prices must be above zero.") : null;

  // What will change on save, for the footer.
  const changes: string[] = [];
  const nextSaved = useSystemCommission ? null : customValid ? customNumber : savedCommission;
  if (nextSaved !== savedCommission) changes.push(nextSaved === null ? `commission back to default (${systemCommission}%)` : `commission ${savedCommission === null ? `${systemCommission}% default` : `${savedCommission}%`} to ${nextSaved}%`);
  const roomChanges = priceRows.filter((r) => r.editable && r.price !== r.original).length;
  if (roomChanges) changes.push(`${roomChanges} room ${roomChanges === 1 ? "price" : "prices"}`);
  const originalRules = JSON.stringify((property?.services as any)?.discountRules ?? []);
  if (JSON.stringify(discountRules) !== originalRules && !(discountRules.length === 0 && originalRules === "[]")) changes.push("long-stay discounts");

  async function handleSave() {
    if (blocking || saving) return;
    try {
      setSaving(true);
      setError(null);
      const payload: any = {
        basePrice,
        commissionPercent: useSystemCommission ? null : customNumber,
        // Paused rules are kept (enabled: false), not silently deleted.
        discountRules: [...discountRules].sort((a, b) => a.minDays - b.minDays),
      };
      // Send every room when any changed: the API matches by room id and otherwise falls back
      // to list position, so a partial map could reprice the wrong room.
      const roomRows = priceRows.filter((r) => r.editable);
      if (roomRows.some((r) => r.price !== r.original)) {
        payload.roomPrices = Object.fromEntries(roomRows.map((r) => [r.roomId, r.price]));
      }
      await api.patch(`/api/admin/properties/${property.id}`, payload);
      onSave();
      onClose();
    } catch (err: any) {
      const data = err?.response?.data;
      const msg = data?.error ?? data?.message ?? err?.message ?? "Could not save the pricing.";
      setError(typeof msg === "string" ? msg : "Could not save the pricing.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen || !property) return null;

  const fill = (Math.min(SLIDER_MAX, Math.max(0, useSystemCommission ? systemCommission : customValid ? customNumber : 0)) / SLIDER_MAX) * 100;
  const defaultAt = (Math.min(SLIDER_MAX, systemCommission) / SLIDER_MAX) * 100;
  const setCustom = (v: number) => { setUseSystemCommission(false); setCustomCommission(String(Math.max(0, Math.min(100, Math.round(v * 10) / 10)))); };
  const exampleNights = Math.max(...discountRules.filter((r) => r.enabled).map((r) => r.minDays), 0);
  const bestDiscount = discountRules.filter((r) => r.enabled && exampleNights >= r.minDays).reduce((m, r) => Math.max(m, r.discountPercent), 0);
  const exampleNightly = withCommission(priceRows[0]?.price ?? 0);

  return (
    <div
      id="property-pricing-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="property-pricing-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <style>{`
        #property-pricing-modal, #property-pricing-modal * { box-sizing: border-box; }
        #property-pricing-modal .rate-range { -webkit-appearance: none; appearance: none; background: transparent; height: 20px; margin: 0; }
        #property-pricing-modal .rate-range::-webkit-slider-runnable-track { height: 6px; background: transparent; }
        #property-pricing-modal .rate-range::-moz-range-track { height: 6px; background: transparent; }
        #property-pricing-modal .rate-range::-webkit-slider-thumb { -webkit-appearance: none; height: 18px; width: 18px; margin-top: -6px; border-radius: 999px; background: #fff; border: 2px solid #02665e; box-shadow: 0 1px 4px rgba(15,23,42,.25); cursor: pointer; }
        #property-pricing-modal .rate-range::-moz-range-thumb { height: 14px; width: 14px; border-radius: 999px; background: #fff; border: 2px solid #02665e; cursor: pointer; }
        #property-pricing-modal .no-spin::-webkit-outer-spin-button, #property-pricing-modal .no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        #property-pricing-modal .no-spin { -moz-appearance: textfield; }
      `}</style>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_100px_-24px_rgba(0,0,0,.55)]">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Pricing</p>
            <h2 id="property-pricing-title" className="m-0 mt-0.5 truncate text-base font-bold text-neutral-950">{niceTitle(property.title) || "Property"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
            </div>
          ) : null}

          {/* 1. Commission */}
          <section className="border-0 border-b border-solid border-neutral-100 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">NoLSAF commission</p>
              <span className="text-[11px] text-neutral-500">Guests pay the owner&apos;s price plus <span className="font-bold tabular-nums text-neutral-900">{rate}%</span> at checkout</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setUseSystemCommission(true)} aria-pressed={useSystemCommission} className={`h-8 cursor-pointer rounded-lg border border-solid px-3 text-xs font-semibold transition ${useSystemCommission ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>
                System default · {systemCommission}%
              </button>
              <button type="button" onClick={() => { setUseSystemCommission(false); if (!customCommission) setCustomCommission(String(systemCommission)); }} aria-pressed={!useSystemCommission} className={`h-8 cursor-pointer rounded-lg border border-solid px-3 text-xs font-semibold transition ${!useSystemCommission ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>
                Custom for this property
              </button>
            </div>
            <div className={`mt-4 transition-opacity ${useSystemCommission ? "pointer-events-none opacity-40" : ""}`}>
              <div className="flex items-center gap-4">
                <div className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-200" aria-hidden />
                  <span className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#02665e]" style={{ width: `${fill}%` }} aria-hidden />
                  <span className="pointer-events-none absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-400" style={{ left: `${defaultAt}%` }} aria-hidden />
                  <input type="range" min={0} max={SLIDER_MAX} step={0.5} value={Math.min(SLIDER_MAX, customValid ? customNumber : systemCommission)} onChange={(e) => setCustom(Number(e.target.value))} aria-label="Commission rate" className="rate-range relative block w-full cursor-pointer" />
                </div>
                <div className={`flex shrink-0 items-center rounded-lg border border-solid bg-white focus-within:ring-2 focus-within:ring-emerald-100 ${!useSystemCommission && !customValid ? "border-rose-300" : "border-neutral-200 focus-within:border-emerald-400"}`}>
                  <button type="button" onClick={() => setCustom((customValid ? customNumber : systemCommission) - 0.5)} aria-label="Lower by half a percent" className="grid h-9 w-8 cursor-pointer place-items-center rounded-l-lg border-0 bg-transparent text-base font-semibold text-neutral-500 hover:bg-neutral-50">−</button>
                  <input type="number" min={0} max={100} step={0.1} value={useSystemCommission ? String(systemCommission) : customCommission} onChange={(e) => { setUseSystemCommission(false); setCustomCommission(e.target.value); }} aria-label="Commission percent" className="no-spin block h-9 w-14 border-0 bg-transparent p-0 text-center text-sm font-bold tabular-nums text-neutral-900 outline-none" />
                  <span className="pr-1 text-xs font-semibold text-neutral-400">%</span>
                  <button type="button" onClick={() => setCustom((customValid ? customNumber : systemCommission) + 0.5)} aria-label="Raise by half a percent" className="grid h-9 w-8 cursor-pointer place-items-center rounded-r-lg border-0 bg-transparent text-base font-semibold text-neutral-500 hover:bg-neutral-50">+</button>
                </div>
              </div>
              <div className="mt-1 flex gap-4 text-[10px] tabular-nums text-neutral-400" aria-hidden>
                <div className="relative h-4 min-w-0 flex-1">
                  <span className="absolute left-0">0%</span>
                  <span className="absolute -translate-x-1/2 whitespace-nowrap font-semibold text-neutral-500" style={{ left: `${defaultAt}%` }}>Default {systemCommission}%</span>
                  <span className="absolute right-0">{SLIDER_MAX}%</span>
                </div>
                <span className="w-[8.25rem] shrink-0" />
              </div>
            </div>
          </section>

          {/* 2. What guests pay */}
          <section className="border-0 border-b border-solid border-neutral-100">
            <p className="m-0 px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">What guests pay</p>
            {priceRows.length ? (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                    <th className="px-5 py-2">Price</th>
                    <th className="px-3 py-2 text-right">Owner gets</th>
                    <th className="px-3 py-2 text-right">Guest pays</th>
                    <th className="px-5 py-2 text-right">NoLSAF earns</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRows.map((row) => {
                    const guest = withCommission(row.price);
                    const before = row.original + (row.original * savedRate) / 100;
                    const delta = Math.round(guest - before);
                    return (
                      <tr key={row.key} className="border-0 border-t border-solid border-neutral-100">
                        <td className="max-w-[180px] px-5 py-2.5"><span className="block truncate font-semibold text-neutral-900">{row.label}</span><span className="text-[11px] text-neutral-400">{row.sub}</span></td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {row.editable ? (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white pl-2 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
                              <span className="text-[10px] text-neutral-400">{currency}</span>
                              <input type="number" min={0} value={roomPrices[row.roomId] ?? ""} onChange={(e) => setRoomPrices((prev) => ({ ...prev, [row.roomId]: e.target.value }))} aria-label={`Owner price for ${row.label}`} className="no-spin block h-8 w-24 border-0 bg-transparent px-1.5 text-right text-xs font-semibold tabular-nums text-neutral-900 outline-none" />
                            </span>
                          ) : (
                            <span className="tabular-nums text-neutral-600">{fmt(row.price)}</span>
                          )}
                          {row.editable && row.price !== row.original ? <span className="block text-[10px] text-amber-700">was {fmt(row.original)}</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          <span className="block font-bold tabular-nums text-neutral-950">{fmt(guest)}</span>
                          {delta !== 0 ? <span className={`block text-[10px] font-semibold tabular-nums ${delta > 0 ? "text-amber-700" : "text-emerald-700"}`}>{delta > 0 ? "+" : "-"}{fmt(Math.abs(delta))} vs saved</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold tabular-nums text-violet-700">{fmt(guest - row.price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="m-0 px-5 pb-4 text-xs text-neutral-500">This property has no base or room price yet.</p>
            )}
            <p className="m-0 px-5 pb-4 pt-2 text-[11px] text-neutral-400">Room prices are what the owner receives. Changing one overrides what the owner submitted.</p>
          </section>

          {/* 3. Long-stay discounts */}
          <section className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Long-stay discounts</p>
              <button
                type="button"
                onClick={() => setDiscountRules((rules) => [...rules, { minDays: Math.max(7, ...rules.map((r) => r.minDays + 7)), discountPercent: 5, enabled: true }])}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add a discount
              </button>
            </div>

            {discountRules.length === 0 ? (
              <p className="m-0 mt-3 rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-500">No long-stay discount on this property.</p>
            ) : (
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {discountRules.map((rule, i) => {
                  const problem = ruleProblems[i];
                  return (
                    <li key={i} className={`rounded-xl border border-solid px-3 py-2.5 ${problem ? "border-rose-200 bg-rose-50/40" : rule.enabled ? "border-neutral-200 bg-white" : "border-neutral-200 bg-neutral-50"}`}>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rule.enabled}
                          aria-label={rule.enabled ? "Pause this discount" : "Turn this discount on"}
                          onClick={() => setDiscountRules((rules) => rules.map((r, j) => (j === i ? { ...r, enabled: !r.enabled } : r)))}
                          className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full border-0 transition ${rule.enabled ? "bg-[#02665e]" : "bg-neutral-300"}`}
                        >
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${rule.enabled ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                        <span>Stays of</span>
                        <input type="number" min={1} value={rule.minDays} onChange={(e) => setDiscountRules((rules) => rules.map((r, j) => (j === i ? { ...r, minDays: Math.floor(Number(e.target.value) || 0) } : r)))} aria-label="Minimum nights" className="no-spin h-8 w-14 rounded-lg border border-solid border-neutral-200 bg-white text-center text-xs font-bold tabular-nums text-neutral-900 outline-none focus:border-emerald-400" />
                        <span>nights or more get</span>
                        <span className="inline-flex items-center rounded-lg border border-solid border-neutral-200 bg-white pr-2">
                          <input type="number" min={0} max={90} step={0.5} value={rule.discountPercent} onChange={(e) => setDiscountRules((rules) => rules.map((r, j) => (j === i ? { ...r, discountPercent: Number(e.target.value) || 0 } : r)))} aria-label="Discount percent" className="no-spin h-8 w-12 border-0 bg-transparent text-center text-xs font-bold tabular-nums text-neutral-900 outline-none" />
                          <span className="text-xs text-neutral-400">% off</span>
                        </span>
                        {!rule.enabled ? <span className="text-[11px] font-semibold text-neutral-400">Paused</span> : null}
                        <button type="button" onClick={() => setDiscountRules((rules) => rules.filter((_, j) => j !== i))} aria-label="Remove this discount" className="ml-auto grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      {problem ? <p className="m-0 mt-1.5 text-[11px] text-rose-700">{problem}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {exampleNights > 0 && exampleNightly > 0 && bestDiscount > 0 ? (
              <p className="m-0 mt-3 text-[11px] text-neutral-600">
                Example: a {exampleNights}-night stay at {fmt(exampleNightly)} a night goes from <span className="font-semibold tabular-nums">{fmt(exampleNightly * exampleNights)}</span> to <span className="font-semibold tabular-nums text-emerald-700">{fmt(exampleNightly * exampleNights * (1 - bestDiscount / 100))}</span>.
              </p>
            ) : null}
            <p className="m-0 mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Saved with the listing and shown in previews, but not yet taken off the price when a guest pays.</span>
            </p>
          </section>
        </div>

        {/* Footer: what will change, then save */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-5 py-3">
          <p className={`m-0 min-w-0 flex-1 text-[11px] ${blocking ? "text-rose-700" : "text-neutral-500"}`}>
            {blocking ? blocking : changes.length ? <>Will save: {changes.join(", ")}.</> : "No changes yet."}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} aria-disabled={saving} className="h-9 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-50">Cancel</button>
            <button
              type="button"
              onClick={() => void handleSave()}
              aria-disabled={saving || Boolean(blocking) || changes.length === 0}
              className="h-9 cursor-pointer rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white hover:bg-[#12342f] aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              {saving ? "Saving" : "Save pricing"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
