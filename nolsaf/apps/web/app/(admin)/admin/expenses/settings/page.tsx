"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Landmark, Loader2, Percent, Plus, RotateCcw, Scale, ShieldCheck, SlidersHorizontal, Trash2, UserRound, Users } from "lucide-react";
import { LockedCard, financeFetch, tzs, useFinanceData } from "../_shared";
import { previewPayslip, type PayrollRates } from "../payroll/_payroll";

/**
 * Rates the Expenses workspace calculates with: the gateway fee estimate for
 * the margin, and the statutory payroll rates. Payroll rates apply to pay
 * runs created or refreshed after saving; each run keeps the rates it used.
 */

type BandRow = { upTo: string; rate: string };

const input = "box-border h-11 w-full rounded-xl border border-solid border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-900 tabular-nums outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-[#02665e] focus:shadow-[0_0_0_4px_rgba(2,102,94,0.12)]";
const card = "min-w-0 overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm";
const darkPill = "inline-flex h-10 items-center gap-2 rounded-full border-0 bg-[#0b2420] px-4 text-xs font-bold text-white shadow-[0_10px_24px_-12px_rgba(11,36,32,0.8)] transition hover:bg-[#12342f] disabled:opacity-50";
const lightPill = "inline-flex h-10 items-center gap-2 rounded-full border border-solid border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-40";
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export default function ExpensesSettingsPage() {
  const payroll = useFinanceData<{ rates: PayrollRates; defaults: PayrollRates }>("/api/admin/finance/payroll/settings");
  const ledger = useFinanceData<{ gatewayFeeRates: FeeRates }>("/api/admin/finance/expenses?pageSize=1");

  if (payroll.locked || ledger.locked) return <LockedCard what="Rates and settings" />;

  const r = payroll.data?.rates;
  const gateway = ledger.data?.gatewayFeeRates ?? null;
  const topBand = r?.payeBands[r.payeBands.length - 1]?.rate;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className={card}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#02665e]"><SlidersHorizontal className="h-3.5 w-3.5" /> Setup</span>
            <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight text-neutral-900">Rates and settings</h1>
            <p className="m-0 mt-1 max-w-2xl text-sm text-neutral-500">What payroll and the margin are calculated with. Check the statutory rates with the accountant each July, when the Finance Act changes.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
            <ShieldCheck className="h-4 w-4" /> Each pay run keeps the rates it was built with
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4">
          {[
            { label: "NSSF", value: r ? `${r.nssfEmployeePercent}% + ${r.nssfEmployerPercent}%` : "...", detail: "employee + NoLSAF" },
            { label: "PAYE", value: r ? `${r.payeBands.length} bands` : "...", detail: topBand != null ? `top rate ${topBand}%` : "on taxable pay" },
            { label: "WCF, SDL and HESLB", value: r ? `${r.wcfPercent}%, ${r.sdlPercent}%, ${r.heslbPercent ?? 15}%` : "...", detail: r ? `SDL from ${r.sdlMinEmployees} staff` : "" },
            { label: "Gateway rates", value: gateway ? `${gateway.MNO}% · ${gateway.CARD}%` : "...", detail: gateway ? `${gateway.provider}: mobile money and bank, card` : "" },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3.5 sm:px-6">
              <dt className="text-[11px] font-semibold text-neutral-400">{f.label}</dt>
              <dd className="m-0 mt-1 truncate text-lg font-bold tabular-nums text-neutral-900">{f.value}</dd>
              <dd className="m-0 truncate text-[11px] text-neutral-500">{f.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {payroll.data ? (
        <PayrollRatesEditor
          rates={payroll.data.rates}
          defaults={payroll.data.defaults}
          onSaved={payroll.reload}
          aside={<GatewayCard value={gateway} onSaved={ledger.reload} />}
        />
      ) : (
        <section className={`${card} p-8 text-center text-sm text-neutral-500`}>{payroll.error ?? "Loading the rates..."}</section>
      )}
    </div>
  );
}

// ── Gateway ─────────────────────────────────────────────────────────────

type FeeRates = { provider: string; MNO: number; BANK: number; CARD: number };
const FEE_CHANNELS: Array<{ key: "MNO" | "BANK" | "CARD"; label: string; help: string }> = [
  { key: "MNO", label: "Mobile money", help: "M-Pesa, Mixx, Airtel Money, HaloPesa" },
  { key: "BANK", label: "Bank", help: "CRDB, NMB and other bank transfers" },
  { key: "CARD", label: "Card", help: "Visa and Mastercard" },
];
const DEFAULT_FEES: FeeRates = { provider: "AzamPay", MNO: 2.5, BANK: 2.5, CARD: 2.9 };

function GatewayCard({ value, onSaved }: { value: FeeRates | null; onSaved: () => void }) {
  const toForm = (r: FeeRates) => ({ MNO: String(r.MNO), BANK: String(r.BANK), CARD: String(r.CARD) });
  const [form, setForm] = useState(() => toForm(value ?? DEFAULT_FEES));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (value) setForm(toForm(value)); }, [value]);

  const dirty = value != null && (["MNO", "BANK", "CARD"] as const).some((k) => Number(form[k]) !== value[k]);
  const sample = 100_000;

  async function save() {
    const next = { MNO: Number(form.MNO), BANK: Number(form.BANK), CARD: Number(form.CARD) };
    if (Object.values(next).some((v) => !Number.isFinite(v) || v < 0 || v > 20)) { setMessage({ ok: false, text: "Each rate must be between 0 and 20%." }); return; }
    setBusy(true);
    setMessage(null);
    try {
      await financeFetch("/api/admin/finance/expenses/settings", { method: "PUT", body: JSON.stringify({ gatewayFeeRates: { provider: value?.provider ?? "AzamPay", ...next } }) });
      setMessage({ ok: true, text: "Saved. The margin estimates gateway fees with these rates until statements are recorded." });
      onSaved();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || "Not saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={card}>
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><Percent className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-sm font-bold text-neutral-900">Payment gateway fees</h2>
            <p className="m-0 text-[11px] text-neutral-500">{value?.provider ?? "AzamPay"}, per transaction</p>
          </div>
        </div>
        <p className="m-0 mt-3 text-xs leading-relaxed text-neutral-500">Deducted from each guest payment and carried by NoLSAF revenue. Change them here when {value?.provider ?? "AzamPay"} changes its pricing.</p>
        <div className="mt-4 space-y-2">
          {FEE_CHANNELS.map((c) => (
            <label key={c.key} className="flex items-center gap-3 rounded-xl border border-solid border-neutral-200 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-neutral-900">{c.label}</span>
                <span className="block truncate text-[11px] text-neutral-500">{c.help}</span>
              </span>
              <span className="relative w-24 shrink-0">
                <input value={form[c.key]} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value.replace(/[^\d.]/g, "") }))} inputMode="decimal" aria-label={`${c.label} fee percent`} className={`${input} h-10 pr-8 text-right`} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">%</span>
              </span>
            </label>
          ))}
        </div>
        <p className="m-0 mt-3 text-[11px] text-neutral-500">
          On a TZS {fmt(sample)} payment: mobile money TZS {fmt(sample * (Number(form.MNO) || 0) / 100)}, bank TZS {fmt(sample * (Number(form.BANK) || 0) / 100)}, card TZS {fmt(sample * (Number(form.CARD) || 0) / 100)}.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => setForm(toForm(DEFAULT_FEES))} className={`${lightPill} flex-1 justify-center`}>AzamPay defaults</button>
          <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${darkPill} flex-1 justify-center`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save rates</button>
        </div>
        {message && <p className={`m-0 mt-3 rounded-xl px-3 py-2 text-xs font-medium ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>}
      </div>
    </section>
  );
}

// ── Payroll rates ───────────────────────────────────────────────────────

function PayrollRatesEditor({ rates, defaults, onSaved, aside }: { rates: PayrollRates; defaults: PayrollRates; onSaved: () => void; aside: React.ReactNode }) {
  const toForm = (r: PayrollRates) => ({
    nssfEmployeePercent: String(r.nssfEmployeePercent),
    nssfEmployerPercent: String(r.nssfEmployerPercent),
    wcfPercent: String(r.wcfPercent),
    sdlPercent: String(r.sdlPercent),
    sdlMinEmployees: String(r.sdlMinEmployees),
    heslbPercent: String(r.heslbPercent ?? 15),
    bands: r.payeBands.map((b) => ({ upTo: b.upTo == null ? "" : Math.round(b.upTo).toLocaleString("en-US"), rate: String(b.rate) })) as BandRow[],
  });
  const [form, setForm] = useState(() => toForm(rates));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [sample, setSample] = useState("1,000,000");
  useEffect(() => setForm(toForm(rates)), [rates]);

  const parsed: PayrollRates = useMemo(() => ({
    nssfEmployeePercent: Number(form.nssfEmployeePercent) || 0,
    nssfEmployerPercent: Number(form.nssfEmployerPercent) || 0,
    wcfPercent: Number(form.wcfPercent) || 0,
    sdlPercent: Number(form.sdlPercent) || 0,
    sdlMinEmployees: Math.floor(Number(form.sdlMinEmployees) || 0),
    heslbPercent: Number(form.heslbPercent) || 0,
    payeBands: form.bands.map((b, i) => ({ upTo: i === form.bands.length - 1 || b.upTo.trim() === "" ? null : Number(b.upTo.replace(/,/g, "")) || 0, rate: Number(b.rate) || 0 })),
  }), [form]);

  const bandProblem = useMemo(() => {
    const limits = parsed.payeBands.slice(0, -1).map((b) => b.upTo ?? 0);
    for (let i = 1; i < limits.length; i++) if (limits[i] <= limits[i - 1]) return "Each band must end above the one before it.";
    return null;
  }, [parsed]);

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(rates));
  const isDefault = JSON.stringify(form) === JSON.stringify(toForm(defaults));
  const gross = Number(sample.replace(/,/g, "")) || 0;
  const example = previewPayslip({ basic: gross, allowances: 0, nssfEnrolled: true, payeExempt: false, sdlApplies: true }, parsed);
  const maxRate = Math.max(1, ...parsed.payeBands.map((b) => b.rate));

  async function save() {
    if (bandProblem) { setMessage({ ok: false, text: bandProblem }); return; }
    setBusy(true);
    setMessage(null);
    try {
      await financeFetch("/api/admin/finance/payroll/settings", { method: "PUT", body: JSON.stringify(parsed) });
      setMessage({ ok: true, text: "Saved. New and refreshed pay runs use these rates; earlier runs keep theirs." });
      onSaved();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || "Not saved." });
    } finally {
      setBusy(false);
    }
  }

  type TileKey = "nssfEmployeePercent" | "nssfEmployerPercent" | "wcfPercent" | "sdlPercent" | "heslbPercent" | "sdlMinEmployees";
  const PAYER = {
    employee: { label: "From the employee", icon: UserRound, chip: "bg-sky-50 text-sky-700" },
    nolsaf: { label: "Paid by NoLSAF", icon: Building2, chip: "bg-[#02665e]/10 text-[#02665e]" },
    rule: { label: "Rule", icon: Users, chip: "bg-neutral-100 text-neutral-600" },
  } as const;
  const rateTile = (key: TileKey, label: string, help: string, payer: keyof typeof PAYER, to: string, unit: "%" | "staff" = "%") => {
    const who = PAYER[payer];
    return (
      <label className="flex min-w-0 flex-col rounded-2xl border border-solid border-neutral-200 bg-white p-4 transition hover:border-neutral-300 focus-within:border-[#02665e]/50 focus-within:shadow-[0_0_0_4px_rgba(2,102,94,0.08)]">
        <span className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${who.chip}`}><who.icon className="h-3 w-3" />{who.label}</span>
          <span className="text-[10px] font-semibold text-neutral-400">{to}</span>
        </span>
        <span className="mt-3 block text-sm font-bold leading-snug text-neutral-900">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{help}</span>
        <span className="relative mt-auto block pt-3">
          <input
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(unit === "%" ? /[^\d.]/g : /[^\d]/g, "") }))}
            inputMode={unit === "%" ? "decimal" : "numeric"}
            aria-label={label}
            className={`${input} h-12 text-lg ${unit === "%" ? "pr-10" : "pr-16"}`}
          />
          <span className={`pointer-events-none absolute right-4 top-[calc(50%+6px)] -translate-y-1/2 font-bold text-neutral-400 ${unit === "%" ? "text-base" : "text-xs"}`}>{unit}</span>
        </span>
      </label>
    );
  };

  let lower = 0;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        {/* Contributions */}
        <section className={card}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#0b2420] text-emerald-300"><Landmark className="h-5 w-5" /></span>
            <div className="mr-auto min-w-0">
              <h2 className="m-0 text-base font-bold text-neutral-900">Contributions and levies</h2>
              <p className="m-0 text-xs text-neutral-500">Mainland Tanzania, a share of monthly gross pay</p>
            </div>
            <button type="button" onClick={() => setForm(toForm(defaults))} disabled={isDefault} className={lightPill}><RotateCcw className="h-3.5 w-3.5" /> Use the defaults</button>
          </div>
          <div className="grid auto-rows-fr gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-4 sm:grid-cols-2 sm:p-5 2xl:grid-cols-3">
            {rateTile("nssfEmployeePercent", "NSSF, employee share", "Taken from gross pay before PAYE", "employee", "to NSSF")}
            {rateTile("nssfEmployerPercent", "NSSF, employer share", "Added on top of gross pay", "nolsaf", "to NSSF")}
            {rateTile("heslbPercent", "HESLB loan repayment", "Of salary, only for staff with a HESLB loan", "employee", "to HESLB")}
            {rateTile("wcfPercent", "Workers Compensation Fund", "On gross pay", "nolsaf", "to WCF")}
            {rateTile("sdlPercent", "Skills Development Levy", "On gross pay, once the threshold is met", "nolsaf", "to TRA")}
            {rateTile("sdlMinEmployees", "SDL starts from", "Staff on the payroll that month. Below this, no SDL.", "rule", "SDL threshold", "staff")}
          </div>
        </section>

        {/* PAYE */}
        <section className={card}>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#0b2420] text-emerald-300"><Scale className="h-5 w-5" /></span>
            <div className="mr-auto min-w-0">
              <h2 className="m-0 text-base font-bold text-neutral-900">PAYE bands</h2>
              <p className="m-0 text-xs text-neutral-500">Monthly taxable pay, after the employee NSSF share. Each slice is taxed at its own rate.</p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, bands: [...f.bands.slice(0, -1), { upTo: "", rate: f.bands[f.bands.length - 1]?.rate ?? "0" }, f.bands[f.bands.length - 1]] }))}
              disabled={form.bands.length >= 12}
              className={lightPill}
            >
              <Plus className="h-3.5 w-3.5" /> Add a band
            </button>
          </div>
          <ol className="m-0 list-none space-y-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-4 sm:p-5">
            {form.bands.map((band, i) => {
              const from = lower;
              const last = i === form.bands.length - 1;
              lower = last ? lower : Number(band.upTo.replace(/,/g, "")) || lower;
              const rate = Number(band.rate) || 0;
              return (
                <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl border border-solid border-neutral-200 bg-white p-3 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_7rem_2.25rem]">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-neutral-100 text-xs font-bold text-neutral-600">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="m-0 text-[11px] font-semibold text-neutral-400">From</p>
                    <p className="m-0 mt-0.5 truncate text-sm font-bold tabular-nums text-neutral-800">TZS {fmt(from)}</p>
                  </div>
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="m-0 text-[11px] font-semibold text-neutral-400">Up to</p>
                    {last ? (
                      <p className="m-0 mt-0.5 text-sm font-bold text-neutral-800">and above</p>
                    ) : (
                      <span className="relative mt-1 block">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-neutral-400">TZS</span>
                        <input value={band.upTo} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ""); setForm((f) => ({ ...f, bands: f.bands.map((b, j) => (j === i ? { ...b, upTo: v ? Number(v).toLocaleString("en-US") : "" } : b)) })); }} inputMode="numeric" aria-label={`Band ${i + 1} upper limit`} className={`${input} h-10 pl-11`} />
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="m-0 text-[11px] font-semibold text-neutral-400">Rate</p>
                    <span className="relative mt-1 block">
                      <input value={band.rate} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setForm((f) => ({ ...f, bands: f.bands.map((b, j) => (j === i ? { ...b, rate: v } : b)) })); }} inputMode="decimal" aria-label={`Band ${i + 1} rate`} className={`${input} h-10 pr-8`} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">%</span>
                    </span>
                  </div>
                  <div className="hidden justify-end sm:flex">
                    {form.bands.length > 2 && !last ? (
                      <button type="button" onClick={() => setForm((f) => ({ ...f, bands: f.bands.filter((_, j) => j !== i) }))} aria-label={`Remove band ${i + 1}`} className="grid h-9 w-9 place-items-center rounded-xl border-0 bg-transparent text-neutral-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    ) : null}
                  </div>
                  <span className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-neutral-100 sm:col-span-5" aria-hidden>
                    <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${Math.max(rate > 0 ? 3 : 0, (rate / maxRate) * 100)}%`, opacity: 0.35 + 0.65 * (rate / maxRate) }} />
                  </span>
                </li>
              );
            })}
          </ol>
          {bandProblem ? <p className="m-0 border-0 border-t border-solid border-rose-100 bg-rose-50 px-5 py-2.5 text-xs font-semibold text-rose-700 sm:px-6">{bandProblem}</p> : null}
        </section>
      </div>

      {/* Right: live check, save, gateway */}
      <div className="min-w-0 space-y-5 xl:sticky xl:top-0">
        <section className={card}>
          <div className="px-5 py-5">
            <p className="m-0 text-xs font-semibold text-neutral-500">Live check</p>
            <p className="m-0 mt-0.5 text-sm font-bold text-neutral-900">What these rates do to one salary</p>
            <span className="relative mt-3 block">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">TZS</span>
              <input value={sample} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ""); setSample(v ? Number(v).toLocaleString("en-US") : ""); }} inputMode="numeric" aria-label="Monthly gross to check" className={`${input} h-12 pl-12 text-lg`} />
            </span>
            <p className="m-0 mt-1 text-[11px] text-neutral-400">Monthly gross pay</p>

            {gross > 0 ? (
              <>
                <span className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                  <span className="h-full bg-[#02665e]" style={{ width: `${(example.net / gross) * 100}%` }} />
                  <span className="h-full bg-sky-400" style={{ width: `${(example.nssfEmployee / gross) * 100}%` }} />
                  <span className="h-full bg-amber-400" style={{ width: `${(example.paye / gross) * 100}%` }} />
                </span>
                <ul className="m-0 mt-3 list-none space-y-2 p-0 text-xs">
                  {[
                    { dot: "bg-[#02665e]", label: "Take-home", value: example.net, strong: true },
                    { dot: "bg-sky-400", label: "NSSF, employee share", value: example.nssfEmployee },
                    { dot: "bg-amber-400", label: "PAYE", value: example.paye },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-neutral-600"><span className={`h-2 w-2 rounded-full ${row.dot}`} />{row.label}</span>
                      <span className={`tabular-nums ${row.strong ? "font-bold text-neutral-900" : "font-semibold text-neutral-700"}`}>{tzs(row.value)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-2xl bg-[#0b2420] px-4 py-3.5 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-white/60">Cost to NoLSAF</span>
                    <span className="text-lg font-bold tabular-nums">{tzs(example.employerCost)}</span>
                  </div>
                  <p className="m-0 mt-1 text-[11px] text-white/50">Gross plus employer NSSF {fmt(example.nssfEmployer)}, WCF {fmt(example.wcf)} and SDL {fmt(example.sdl)} (when SDL applies)</p>
                </div>
              </>
            ) : (
              <p className="m-0 mt-4 rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">Type a monthly gross to see the take-home and the cost to NoLSAF.</p>
            )}
          </div>

          <div className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-5 py-4">
            {message ? (
              <p className={`m-0 mb-3 rounded-xl px-3 py-2 text-xs font-medium ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
            ) : (
              <p className="m-0 mb-3 text-xs text-neutral-500">{dirty ? "You have unsaved changes to the payroll rates." : "The payroll rates are saved."}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setForm(toForm(rates)); setMessage(null); }} disabled={!dirty || busy} className={`${lightPill} flex-1 justify-center`}>Undo changes</button>
              <button type="button" onClick={() => void save()} disabled={!dirty || busy || Boolean(bandProblem)} className={`${darkPill} flex-1 justify-center`}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save rates
              </button>
            </div>
          </div>
        </section>

        {aside}
      </div>
    </div>
  );
}
