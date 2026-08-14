"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, CreditCard, Plus, Trash2, Loader2, Globe } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";

const api = apiClient;

type TransportGate = {
  id: number;
  regionName: string;
  district: string | null;
  ward: string | null;
  isEnabled: boolean;
  reason: string | null;
};

type PaymentGate = {
  provider: string;
  label: string;
  isEnabled: boolean;
  reason: string | null;
};

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[''""]/g, "'").replace(/\s+/g, " ").trim();

/** Summary pill in the page header. Mirrors the one on /admin/management/pickup-points. */
function StatChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "emerald" | "amber" | "slate";
}) {
  const toneCls = {
    default: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${toneCls}`}>
      <span className="text-sm font-bold">{value}</span> {label}
    </span>
  );
}

export default function ServiceAvailabilityPage() {
  // Tailwind preflight is disabled in this app, so `border-solid` is required
  // for any border to render at all, and box-sizing must be scoped per page or
  // padded full-width controls overflow their grid column.
  const inputClass =
    "w-full rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-inset focus:ring-[#02665e]/18 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
  const toggleTrackClass =
    "relative h-6 w-11 shrink-0 rounded-full bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#02665e]/15 peer-checked:bg-[#02665e] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-solid after:border-slate-200 after:bg-white after:transition-all peer-checked:after:translate-x-full";
  const btnPrimary =
    "inline-flex items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 disabled:cursor-not-allowed disabled:opacity-60";
  const cardClass = "rounded-xl border border-solid border-slate-200 bg-white shadow-sm";

  const [loading, setLoading] = useState(true);
  const [transport, setTransport] = useState<TransportGate[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentGate[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [regionName, setRegionName] = useState("");
  const [district, setDistrict] = useState("");
  const [ward, setWard] = useState("");
  const [saving, setSaving] = useState(false);

  const regionNames = useMemo(
    () => REGIONS_FULL_DATA.map((r) => r.name).sort((a, b) => a.localeCompare(b)),
    []
  );

  const districts = useMemo(() => {
    if (!regionName) return [];
    const regionData = REGIONS_FULL_DATA.find((r) => r.name === regionName);
    return (regionData?.districts ?? []).map((d) => d.name);
  }, [regionName]);

  // Wards stay optional: a coverage row with no ward applies to the whole district.
  const wards = useMemo(() => {
    if (!regionName || !district) return [];
    const regionData = REGIONS_FULL_DATA.find((r) => r.name === regionName);
    const districtData = regionData?.districts?.find(
      (d) => normalizeName(d.name) === normalizeName(district)
    );
    return (districtData?.wards ?? []).map((w) => w.name);
  }, [regionName, district]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get("/api/admin/service-availability");
      setTransport(r?.data?.transport ?? []);
      setPaymentMethods(r?.data?.paymentMethods ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const openCoverage = async () => {
    if (!regionName) return;
    setSaving(true);
    try {
      await api.put("/api/admin/service-availability/transport", {
        regionName,
        district: district || null,
        ward: ward || null,
        isEnabled: true,
        reason: null,
      });
      setDistrict("");
      setWard("");
      setToast("Coverage opened");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleTransportGate = async (gate: TransportGate) => {
    await api.put("/api/admin/service-availability/transport", {
      regionName: gate.regionName,
      district: gate.district,
      ward: gate.ward,
      isEnabled: !gate.isEnabled,
      reason: gate.isEnabled ? "No drivers available in this area yet." : null,
    });
    await load();
  };

  const removeTransportGate = async (gate: TransportGate) => {
    await api.delete(`/api/admin/service-availability/transport/${gate.id}`);
    await load();
  };

  const togglePaymentMethod = async (pm: PaymentGate) => {
    await api.put(`/api/admin/service-availability/payment-methods/${pm.provider}`, {
      isEnabled: !pm.isEnabled,
      reason: pm.isEnabled ? "This payment method is temporarily unavailable." : null,
    });
    await load();
  };

  const updatePaymentReason = async (pm: PaymentGate, reason: string) => {
    const normalized = reason.trim();
    if (pm.isEnabled || normalized === (pm.reason ?? "")) return;
    await api.put(`/api/admin/service-availability/payment-methods/${pm.provider}`, {
      isEnabled: false,
      reason: normalized || "This payment method is temporarily unavailable.",
    });
    setToast("Guest message updated");
    await load();
  };

  const openAreas = transport.filter((g) => g.isEnabled).length;
  const lockedAreas = transport.length - openAreas;
  const activeMethods = paymentMethods.filter((p) => p.isEnabled).length;
  const disabledMethods = paymentMethods.length - activeMethods;

  return (
    <div id="service-availability-page" className="mx-auto w-full max-w-6xl px-4 py-6">
      <style>{`#service-availability-page, #service-availability-page * { box-sizing: border-box; }`}</style>

      {/* Header card, matching the other admin management pages */}
      <header className={`${cardClass} mb-6 p-5`}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
            <Globe className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Service availability</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">
              Control which services guests can actually use, by region and by payment provider, before the
              partners or configuration behind them are ready.
            </p>
          </div>
        </div>

        {!loading && (
          <div className="mt-4 flex flex-wrap gap-2">
            <StatChip label="Areas open" value={openAreas} tone="emerald" />
            <StatChip label="Areas locked" value={lockedAreas} tone="slate" />
            <StatChip label="Methods active" value={activeMethods} tone="emerald" />
            <StatChip label="Methods disabled" value={disabledMethods} tone="amber" />
          </div>
        )}
      </header>

      {toast && (
        <div className="fixed right-6 top-6 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : (
        <div className="space-y-10">
          {/* Transport coverage */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[#02665e]" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Transport coverage</h2>
            </div>
            <p className="mb-4 max-w-2xl text-xs leading-5 text-slate-500">
              An area with no row below is locked by default, so guests booking a stay there will not see the
              transport add on. Open a whole region, or narrow it to one district or ward.
            </p>

            <div className={`${cardClass} mb-4 p-4`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Region</label>
                  <select
                    className={inputClass}
                    value={regionName}
                    onChange={(e) => {
                      setRegionName(e.target.value);
                      setDistrict("");
                      setWard("");
                    }}
                  >
                    <option value="">Select region</option>
                    {regionNames.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">
                    District <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <select
                    className={inputClass}
                    value={district}
                    onChange={(e) => {
                      setDistrict(e.target.value);
                      setWard("");
                    }}
                    disabled={!regionName}
                  >
                    <option value="">All districts</option>
                    {districts.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">
                    Ward <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <select
                    className={inputClass}
                    value={ward}
                    onChange={(e) => setWard(e.target.value)}
                    disabled={!district || wards.length === 0}
                  >
                    <option value="">All wards</option>
                    {wards.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button type="button" className={btnPrimary} disabled={!regionName || saving} onClick={openCoverage}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Open coverage
                </button>
              </div>
            </div>

            <div className={`${cardClass} overflow-hidden`}>
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed border-collapse">
                  <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[24%]" />
                    <col className="w-[24%]" />
                    <col className="w-[20%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Region</th>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">District</th>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Ward</th>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-wide text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {transport.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center">
                          <div className="mx-auto max-w-sm">
                            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-solid border-slate-200 bg-slate-50">
                              <MapPin className="h-5 w-5 text-slate-500" />
                            </div>
                            <div className="text-sm font-bold text-slate-900">No coverage opened yet</div>
                            <div className="mt-1 text-xs text-slate-600">
                              Transport stays locked everywhere until you open an area above.
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      transport.map((g) => (
                        <tr key={g.id} className="transition-colors hover:bg-slate-50">
                          <td className="truncate px-4 py-3 text-sm font-semibold text-slate-900">{g.regionName}</td>
                          <td className="truncate px-4 py-3 text-sm text-slate-700">
                            {g.district || <span className="text-slate-400">All districts</span>}
                          </td>
                          <td className="truncate px-4 py-3 text-sm text-slate-700">
                            {g.ward || <span className="text-slate-400">All wards</span>}
                          </td>
                          <td className="px-4 py-3">
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={g.isEnabled}
                                onChange={() => toggleTransportGate(g)}
                              />
                              <div className={toggleTrackClass} />
                              <span
                                className={`text-xs font-semibold ${g.isEnabled ? "text-[#02665e]" : "text-slate-400"}`}
                              >
                                {g.isEnabled ? "Open" : "Locked"}
                              </span>
                            </label>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeTransportGate(g)}
                              title="Remove this row"
                              className="rounded-lg border-0 bg-transparent p-2 text-slate-400 transition-colors hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Payment methods */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[#02665e]" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Payment methods</h2>
            </div>
            <p className="mb-4 max-w-2xl text-xs leading-5 text-slate-500">
              Turning a method off does not remove it from checkout. Guests still see it, greyed out with a
              reason, so they pick an active method instead of hitting an error.
            </p>

            <div className={`${cardClass} overflow-hidden`}>
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[640px] table-fixed border-collapse">
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[20%]" />
                    <col className="w-[50%]" />
                  </colgroup>
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Method</th>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Reason shown to guest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {paymentMethods.map((pm) => (
                      <tr key={pm.provider} className="transition-colors hover:bg-slate-50">
                        <td className="truncate px-4 py-3 text-sm font-semibold text-slate-900">{pm.label}</td>
                        <td className="px-4 py-3">
                          <label className="inline-flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={pm.isEnabled}
                              onChange={() => togglePaymentMethod(pm)}
                            />
                            <div className={toggleTrackClass} />
                            <span
                              className={`text-xs font-semibold ${pm.isEnabled ? "text-[#02665e]" : "text-slate-400"}`}
                            >
                              {pm.isEnabled ? "Active" : "Disabled"}
                            </span>
                          </label>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {pm.isEnabled ? (
                            <span className="text-slate-300">Not shown while active</span>
                          ) : (
                            <input
                              key={`${pm.provider}:${pm.reason ?? ""}`}
                              className={inputClass}
                              defaultValue={pm.reason ?? ""}
                              maxLength={300}
                              aria-label={`Reason shown when ${pm.label} is unavailable`}
                              placeholder="Explain why this method is unavailable"
                              onBlur={(event) => updatePaymentReason(pm, event.currentTarget.value)}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
