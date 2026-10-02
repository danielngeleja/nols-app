"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ChevronDown, CreditCard, Globe, Landmark, Loader2, Lock, MapPin, Plus, Search, Smartphone, Trash2, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";

/**
 * Service availability: which areas get the transport add-on, and which
 * payment methods guests can pick at checkout. An area with no row is
 * locked; a disabled payment method stays visible at checkout, greyed out
 * with the reason given here.
 */

const api = apiClient;

type TransportGate = { id: number; regionName: string; district: string | null; ward: string | null; isEnabled: boolean; reason: string | null };
type PaymentGate = { provider: string; label: string; isEnabled: boolean; reason: string | null };

const normalizeName = (name: string) => name.toLowerCase().replace(/[''""]/g, "'").replace(/\s+/g, " ").trim();
const titleCase = (v: string) => v.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase());

/** Which kind of payment a provider key is, for grouping. */
function methodKind(provider: string): "MOBILE" | "BANK" | "CARD" | "OTHER" {
  const p = provider.toUpperCase();
  if (/CARD|VISA|MASTER/.test(p)) return "CARD";
  if (/BANK|CRDB|NMB|NBC|EXIM|STANBIC|ABSA|EQUITY|DTB|AZANIA|KCB/.test(p)) return "BANK";
  if (/AIRTEL|TIGO|MIXX|MPESA|M-PESA|HALO|AZAMPESA|AZAM|TTCL|EZY/.test(p)) return "MOBILE";
  return "OTHER";
}
const KIND_META = {
  MOBILE: { label: "Mobile money", icon: Smartphone },
  BANK: { label: "Banks", icon: Landmark },
  CARD: { label: "Cards", icon: CreditCard },
  OTHER: { label: "Other", icon: Wallet },
} as const;
const REASON_PRESETS = ["Temporarily unavailable, please use another method.", "Under maintenance by the provider.", "Coming soon."];

const card = "min-w-0 rounded-lg border border-solid border-slate-200 bg-white";
const label = "m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500";

function Switch({ on, onClick, disabled, title }: { on: boolean; onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={title} title={title} onClick={onClick} disabled={disabled} className={`relative h-6 w-11 shrink-0 rounded-full border-0 transition ${on ? "bg-[#02665e]" : "bg-slate-300"} disabled:opacity-50`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Select({ value, onChange, disabled, placeholder, options, ariaLabel }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder: string; options: string[]; ariaLabel: string }) {
  return (
    <div className="relative">
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-10 w-full cursor-pointer appearance-none rounded-md border border-solid border-slate-300 bg-white bg-none px-3 pr-9 text-sm text-slate-900 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export default function ServiceAvailabilityPage() {
  const [loading, setLoading] = useState(true);
  const [transport, setTransport] = useState<TransportGate[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentGate[]>([]);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [regionName, setRegionName] = useState("");
  const [district, setDistrict] = useState("");
  const [ward, setWard] = useState("");
  const [filter, setFilter] = useState("");

  const regionNames = useMemo(() => REGIONS_FULL_DATA.map((r) => r.name).sort((a, b) => a.localeCompare(b)), []);
  const districts = useMemo(() => (regionName ? (REGIONS_FULL_DATA.find((r) => r.name === regionName)?.districts ?? []).map((d) => d.name) : []), [regionName]);
  // Wards stay optional: a coverage row with no ward applies to the whole district.
  const wards = useMemo(() => {
    if (!regionName || !district) return [];
    const d = REGIONS_FULL_DATA.find((r) => r.name === regionName)?.districts?.find((x) => normalizeName(x.name) === normalizeName(district));
    return (d?.wards ?? []).map((w) => w.name);
  }, [regionName, district]);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/api/admin/service-availability");
      setTransport(r?.data?.transport ?? []);
      setPaymentMethods(r?.data?.paymentMethods ?? []);
    } catch {
      setToast({ ok: false, text: "Could not load service availability." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      setToast({ ok: true, text: ok });
      await load();
    } catch (err: any) {
      setToast({ ok: false, text: err?.response?.data?.error || "That did not save. Please try again." });
    } finally {
      setBusy(null);
    }
  };

  // ── Coverage by region ──
  const byRegion = useMemo(() => {
    const map = new Map<string, TransportGate[]>();
    for (const g of transport) {
      const key = normalizeName(g.regionName);
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return map;
  }, [transport]);
  const regionState = (name: string): "open" | "partial" | "locked" => {
    const rows = byRegion.get(normalizeName(name)) ?? [];
    if (rows.some((g) => g.isEnabled && !g.district)) return "open";
    if (rows.some((g) => g.isEnabled)) return "partial";
    return "locked";
  };
  const regionCounts = regionNames.reduce((acc, r) => { acc[regionState(r)] += 1; return acc; }, { open: 0, partial: 0, locked: 0 } as Record<"open" | "partial" | "locked", number>);

  const exists = transport.find((g) => normalizeName(g.regionName) === normalizeName(regionName) && normalizeName(g.district ?? "") === normalizeName(district) && normalizeName(g.ward ?? "") === normalizeName(ward));
  const scope = ward ? `${ward} ward, ${district}, ${regionName}` : district ? `${district} district, ${regionName}` : regionName ? `all of ${regionName}` : "";

  const openCoverage = () =>
    run("open", async () => {
      await api.put("/api/admin/service-availability/transport", { regionName, district: district || null, ward: ward || null, isEnabled: true, reason: null });
      setDistrict("");
      setWard("");
    }, `Transport opened in ${scope}`);

  const groups = useMemo(() => {
    const q = normalizeName(filter);
    const rows = transport.filter((g) => !q || [g.regionName, g.district, g.ward].some((v) => v && normalizeName(v).includes(q)));
    const map = new Map<string, TransportGate[]>();
    rows.forEach((g) => map.set(g.regionName, [...(map.get(g.regionName) ?? []), g]));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [transport, filter]);

  // ── Payments by kind ──
  const methodGroups = useMemo(() => {
    const order = ["MOBILE", "BANK", "CARD", "OTHER"] as const;
    return order.map((k) => ({ kind: k, items: paymentMethods.filter((p) => methodKind(p.provider) === k) })).filter((g) => g.items.length);
  }, [paymentMethods]);
  const activeMethods = paymentMethods.filter((p) => p.isEnabled).length;

  const setReason = (pm: PaymentGate, reason: string) => {
    const normalized = reason.trim();
    if (pm.isEnabled || normalized === (pm.reason ?? "")) return;
    void run(`reason:${pm.provider}`, () => api.put(`/api/admin/service-availability/payment-methods/${pm.provider}`, { isEnabled: false, reason: normalized || "This payment method is temporarily unavailable." }), "Guest message updated");
  };

  return (
    <div id="service-availability-page" className="w-full min-w-0 space-y-5">
      <style>{`#service-availability-page, #service-availability-page * { box-sizing: border-box; }`}</style>

      {toast && (
        <div className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-lg ${toast.ok ? "bg-[#0b2420]" : "bg-rose-600"}`} role="status">
          {toast.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}{toast.text}
        </div>
      )}

      {/* Header */}
      <header className={card}>
        <div className="flex flex-wrap items-start gap-4 px-5 py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Globe className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">Service availability</h1>
            <p className="m-0 mt-1 max-w-2xl text-sm text-slate-500">Decide where guests can add transport, and which payment methods they can choose, before the partners or configuration behind them are ready.</p>
          </div>
        </div>
        <div className="grid gap-px border-0 border-t border-solid border-slate-200 bg-slate-200 md:grid-cols-2">
          <div className="bg-white px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className={label}>Transport coverage</p>
              <p className="m-0 text-xs text-slate-500"><b className="text-slate-900">{loading ? "..." : regionCounts.open + regionCounts.partial}</b> of {regionNames.length} regions</p>
            </div>
            <span className="mt-3 flex h-2 gap-0.5">
              <span className="h-full bg-[#02665e]" style={{ width: `${(regionCounts.open / regionNames.length) * 100}%` }} />
              <span className="h-full bg-emerald-300" style={{ width: `${(regionCounts.partial / regionNames.length) * 100}%` }} />
              <span className="h-full flex-1 bg-slate-200" />
            </span>
            <p className="m-0 mt-2 flex flex-wrap gap-x-4 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-[#02665e]" /> Whole region {regionCounts.open}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-emerald-300" /> Part of region {regionCounts.partial}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-slate-300" /> Locked {regionCounts.locked}</span>
            </p>
          </div>
          <div className="bg-white px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className={label}>Payment methods</p>
              <p className="m-0 text-xs text-slate-500"><b className="text-slate-900">{loading ? "..." : activeMethods}</b> of {paymentMethods.length} live at checkout</p>
            </div>
            <span className="mt-3 flex h-2 gap-0.5">
              {paymentMethods.map((p) => <span key={p.provider} className={`h-full flex-1 ${p.isEnabled ? "bg-[#02665e]" : "bg-slate-200"}`} title={`${p.label}: ${p.isEnabled ? "active" : "disabled"}`} />)}
            </span>
            <p className="m-0 mt-2 flex flex-wrap gap-x-4 text-[11px] text-slate-500">
              {methodGroups.map((g) => <span key={g.kind}>{KIND_META[g.kind].label} <b className="text-slate-800">{g.items.filter((i) => i.isEnabled).length}/{g.items.length}</b></span>)}
            </p>
          </div>
        </div>
      </header>

      {loading ? (
        <div className={`${card} flex items-center gap-2 px-5 py-8 text-sm text-slate-500`}><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
      ) : (
        <>
          {/* Transport */}
          <section className={card}>
            <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4">
              <MapPin className="h-4 w-4 text-[#02665e]" />
              <div className="mr-auto min-w-0">
                <h2 className="m-0 text-sm font-bold text-slate-900">Transport add-on</h2>
                <p className="m-0 text-xs text-slate-500">Locked everywhere until an area is opened. Open a whole region, or narrow it to a district or ward.</p>
              </div>
            </div>

            {/* Region map: click a region to start opening it */}
            <div className="border-0 border-b border-solid border-slate-200 px-5 py-4">
              <p className={label}>Regions</p>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {regionNames.map((r) => {
                  const st = regionState(r);
                  const selected = r === regionName;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setRegionName(r); setDistrict(""); setWard(""); }}
                      title={st === "open" ? "Open across the region" : st === "partial" ? "Open in part of the region" : "Locked"}
                      className={`flex h-9 items-center gap-1.5 truncate rounded-md border border-solid px-2.5 text-left text-[11px] font-semibold transition ${selected ? "border-[#02665e] ring-2 ring-[#02665e]/20" : "border-transparent"} ${st === "open" ? "bg-[#02665e] text-white" : st === "partial" ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
                    >
                      {st === "locked" ? <Lock className="h-3 w-3 shrink-0 opacity-60" /> : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st === "open" ? "bg-emerald-300" : "bg-emerald-500"}`} />}
                      <span className="truncate">{titleCase(r)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-px bg-slate-200 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              {/* Builder */}
              <div className="bg-white px-5 py-5">
                <p className={label}>Open an area</p>
                <div className="mt-3 space-y-2.5">
                  <Select ariaLabel="Region" value={regionName} onChange={(v) => { setRegionName(v); setDistrict(""); setWard(""); }} placeholder="Choose a region" options={regionNames} />
                  <Select ariaLabel="District" value={district} onChange={(v) => { setDistrict(v); setWard(""); }} disabled={!regionName} placeholder="Whole region" options={districts} />
                  <Select ariaLabel="Ward" value={ward} onChange={setWard} disabled={!district || wards.length === 0} placeholder="Whole district" options={wards} />
                </div>
                <div className={`mt-4 rounded-md px-3.5 py-3 text-xs leading-relaxed ${!regionName ? "bg-slate-50 text-slate-500" : exists ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
                  {!regionName
                    ? "Pick a region, or click one above, to see what opening it does."
                    : exists
                      ? <>This area already has a row. It is <b>{exists.isEnabled ? "open" : "locked"}</b>; switch it in the list.</>
                      : <>Guests booking a stay in <b>{scope}</b> will be offered transport.</>}
                </div>
                <button type="button" onClick={() => void openCoverage()} disabled={!regionName || Boolean(exists) || busy === "open"} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] text-sm font-semibold text-white transition hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50">
                  {busy === "open" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Open transport here
                </button>
              </div>

              {/* Open areas */}
              <div className="min-w-0 bg-white">
                <div className="flex items-center gap-3 px-5 py-3">
                  <p className={`${label} mr-auto`}>Areas with a rule <span className="text-slate-400">{transport.length}</span></p>
                  <div className="relative w-56">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an area" aria-label="Find an area" className="h-8 w-full rounded-md border border-solid border-slate-300 bg-white pl-8 pr-2 text-xs outline-none focus:border-[#02665e]" />
                  </div>
                </div>
                {groups.length === 0 ? (
                  <div className="border-0 border-t border-solid border-slate-100 px-5 py-10 text-center">
                    <MapPin className="mx-auto h-5 w-5 text-slate-300" />
                    <p className="m-0 mt-2 text-sm font-semibold text-slate-900">{transport.length ? "No area matches" : "No coverage opened yet"}</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">{transport.length ? "Try another name." : "Transport stays locked everywhere until you open an area."}</p>
                  </div>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {groups.map(([region, rows]) => (
                      <li key={region} className="border-0 border-t border-solid border-slate-100 px-5 py-3">
                        <p className="m-0 flex items-center gap-2 text-sm font-bold text-slate-900"><Building2 className="h-3.5 w-3.5 text-slate-400" />{titleCase(region)}</p>
                        <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                          {rows.map((g) => (
                            <li key={g.id} className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold text-slate-800">{g.ward ? `${g.ward} ward` : g.district ? `${g.district} district` : "Whole region"}</span>
                                <span className="block truncate text-[11px] text-slate-500">{g.ward ? `${g.district}, ` : ""}{g.isEnabled ? "Guests see the transport add-on" : g.reason || "Locked"}</span>
                              </span>
                              <span className={`text-[11px] font-semibold ${g.isEnabled ? "text-[#02665e]" : "text-slate-400"}`}>{g.isEnabled ? "Open" : "Locked"}</span>
                              <Switch on={g.isEnabled} disabled={busy === `t:${g.id}`} title={g.isEnabled ? "Lock this area" : "Open this area"} onClick={() => void run(`t:${g.id}`, () => api.put("/api/admin/service-availability/transport", { regionName: g.regionName, district: g.district, ward: g.ward, isEnabled: !g.isEnabled, reason: g.isEnabled ? "No drivers available in this area yet." : null }), g.isEnabled ? "Area locked" : "Area opened")} />
                              <button type="button" onClick={() => void run(`d:${g.id}`, () => api.delete(`/api/admin/service-availability/transport/${g.id}`), "Rule removed, area locked")} disabled={busy === `d:${g.id}`} title="Remove this rule" aria-label="Remove this rule" className="grid h-8 w-8 place-items-center rounded-md border-0 bg-transparent text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* Payment methods */}
          <section className={card}>
            <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4">
              <CreditCard className="h-4 w-4 text-[#02665e]" />
              <div className="mr-auto min-w-0">
                <h2 className="m-0 text-sm font-bold text-slate-900">Payment methods at checkout</h2>
                <p className="m-0 text-xs text-slate-500">A disabled method stays visible, greyed out with your message, so guests pick another one instead of hitting an error.</p>
              </div>
            </div>
            <div className="grid gap-px bg-slate-200 md:grid-cols-2 xl:grid-cols-3">
              {methodGroups.map((g) => {
                const Icon = KIND_META[g.kind].icon;
                return (
                  <div key={g.kind} className="min-w-0 bg-white px-5 py-4">
                    <p className="m-0 flex items-center gap-2 text-xs font-bold text-slate-900"><Icon className="h-4 w-4 text-[#02665e]" />{KIND_META[g.kind].label}<span className="ml-auto text-[11px] font-semibold text-slate-400">{g.items.filter((i) => i.isEnabled).length} of {g.items.length} live</span></p>
                    <ul className="m-0 mt-3 list-none space-y-2 p-0">
                      {g.items.map((pm) => (
                        <li key={pm.provider} className={`rounded-md border border-solid px-3 py-2.5 ${pm.isEnabled ? "border-slate-200" : "border-amber-200 bg-amber-50/40"}`}>
                          <div className="flex items-center gap-3">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{pm.label}</span>
                            <span className={`text-[11px] font-semibold ${pm.isEnabled ? "text-[#02665e]" : "text-amber-700"}`}>{pm.isEnabled ? "Live" : "Disabled"}</span>
                            <Switch on={pm.isEnabled} disabled={busy === `p:${pm.provider}`} title={pm.isEnabled ? `Disable ${pm.label}` : `Enable ${pm.label}`} onClick={() => void run(`p:${pm.provider}`, () => api.put(`/api/admin/service-availability/payment-methods/${pm.provider}`, { isEnabled: !pm.isEnabled, reason: pm.isEnabled ? "This payment method is temporarily unavailable." : null }), pm.isEnabled ? `${pm.label} disabled` : `${pm.label} is live`)} />
                          </div>
                          {!pm.isEnabled ? (
                            <div className="mt-2">
                              <input
                                key={`${pm.provider}:${pm.reason ?? ""}`}
                                defaultValue={pm.reason ?? ""}
                                maxLength={300}
                                aria-label={`Message guests see when ${pm.label} is unavailable`}
                                placeholder="What guests see"
                                onBlur={(e) => setReason(pm, e.currentTarget.value)}
                                className="h-8 w-full rounded-md border border-solid border-slate-300 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-[#02665e]"
                              />
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {REASON_PRESETS.map((r) => (
                                  <button key={r} type="button" onClick={() => setReason(pm, r)} className={`rounded border border-solid px-1.5 py-0.5 text-[10px] font-medium transition ${pm.reason === r ? "border-[#02665e] bg-[#02665e]/10 text-[#02665e]" : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"}`}>{r.split(",")[0].replace(/\.$/, "")}</button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
