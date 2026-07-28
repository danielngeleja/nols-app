"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Coins, Gauge, History, Layers, Loader2, Save, Search, SlidersHorizontal } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { CountPill, EmptyState, SectionHeader, SummaryCard } from "../_components/CommercialUi";

type Policy = { id: number; version: string; effectiveFrom: string; effectiveTo: string | null; roomNightPrice: number; trialDays: number; reminderAmount: number; warningAmount: number; unpaidLimit: number; graceDays: number; accountCount: number };
type Account = { id: number; propertyId: number; propertyTitle: string; owner: { name: string }; status: string; trialEndsAt: string; unpaidBalance: number; unpaidLimit: number; policy: { id: number; version: string }; dunning: { stage: string; freezeAt: string | null } };

const initialPolicy = { roomNightPrice: "500", trialDays: "45", reminderAmount: "25000", warningAmount: "40000", unpaidLimit: "50000", graceDays: "3", effectiveFrom: "", reason: "" };

type PolicyFieldKey = "roomNightPrice" | "trialDays" | "reminderAmount" | "warningAmount" | "unpaidLimit" | "graceDays";
type FieldDef = { key: PolicyFieldKey; label: string; unit: string; hint: string };

const RATE_FIELDS: FieldDef[] = [
  { key: "roomNightPrice", label: "Room-night price", unit: "TZS", hint: "Charged per external room-night" },
  { key: "trialDays", label: "Trial period", unit: "days", hint: "Free usage for new properties" },
  { key: "graceDays", label: "Grace period", unit: "days", hint: "After the limit, before freeze" },
];

const DUNNING_FIELDS: FieldDef[] = [
  { key: "reminderAmount", label: "Reminder at", unit: "TZS", hint: "First gentle payment nudge" },
  { key: "warningAmount", label: "Warning at", unit: "TZS", hint: "Escalated payment warning" },
  { key: "unpaidLimit", label: "Unpaid limit", unit: "TZS", hint: "Balance that triggers the freeze" },
];

const STAGE_STYLE: Record<string, { accent: string; badge: string; bar: string }> = {
  CURRENT: { accent: "bg-emerald-500", badge: "border-emerald-100 bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  REMINDER: { accent: "bg-yellow-400", badge: "border-yellow-100 bg-yellow-50 text-yellow-700", bar: "bg-yellow-400" },
  WARNING: { accent: "bg-amber-500", badge: "border-amber-100 bg-amber-50 text-amber-700", bar: "bg-amber-500" },
  GRACE: { accent: "bg-orange-500", badge: "border-orange-100 bg-orange-50 text-orange-700", bar: "bg-orange-500" },
  PAYMENT_REQUIRED: { accent: "bg-red-500", badge: "border-red-100 bg-red-50 text-red-700", bar: "bg-red-500" },
};

const LEVER_LABELS: Record<string, string> = { trial: "New trial end", "unpaid-limit": "New unpaid limit (TZS)", credit: "Credit amount (TZS)", policy: "Target policy" };

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All stages" },
  { value: "CURRENT", label: "Current" },
  { value: "REMINDER", label: "Reminder" },
  { value: "WARNING", label: "Warning" },
  { value: "GRACE", label: "Grace" },
  { value: "PAYMENT_REQUIRED", label: "Payment required" },
];

const LEVER_PAGE_SIZE = 10;

const fieldInputClass = "block min-h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white pl-3 pr-14 text-sm font-bold tabular-nums text-neutral-900 shadow-[0_5px_16px_-14px_rgba(15,23,42,0.5)] outline-none transition placeholder:font-normal placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const plainInputClass = "block min-h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 shadow-[0_5px_16px_-14px_rgba(15,23,42,0.5)] outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const leverInputClass = "block min-h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const timeInputClass = "block min-h-10 w-[6.5rem] shrink-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs tabular-nums text-neutral-900 shadow-sm outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400";

function splitDateTime(value: string): { date: string; time: string } {
  return { date: value.slice(0, 10), time: value.length >= 16 ? value.slice(11, 16) : "00:00" };
}

function money(value: number | string): string {
  const parsed = Number(value);
  return `TZS ${(Number.isFinite(parsed) ? parsed : 0).toLocaleString()}`;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function clampPercent(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

export default function NrmsPricingPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState(initialPolicy);
  const [action, setAction] = useState<Record<number, { kind: string; value: string; reason: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [leverQuery, setLeverQuery] = useState("");
  const [leverStage, setLeverStage] = useState("");
  const [leverPage, setLeverPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [policyRes, accountRes] = await Promise.all([apiClient.get("/api/admin/nrms/commercial/policies"), apiClient.get("/api/admin/nrms/commercial/accounts")]);
      setPolicies(policyRes.data?.policies ?? []); setAccounts(accountRes.data?.accounts ?? []);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to load pricing controls"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handleGranted = () => { void load(); };
    window.addEventListener("finance-grant-granted", handleGranted);
    return () => window.removeEventListener("finance-grant-granted", handleGranted);
  }, [load]);

  const publish = async () => {
    setSaving(true); setError(null);
    try {
      await apiClient.post("/api/admin/nrms/commercial/policies", { ...form, roomNightPrice: Number(form.roomNightPrice), trialDays: Number(form.trialDays), reminderAmount: Number(form.reminderAmount), warningAmount: Number(form.warningAmount), unpaidLimit: Number(form.unpaidLimit), graceDays: Number(form.graceDays), effectiveFrom: new Date(form.effectiveFrom).toISOString() });
      setNotice("New pricing policy published. Existing charges were not changed."); setForm(initialPolicy); await load();
    } catch (cause: any) { setError(cause?.response?.data?.require2fa ? "Finance OTP verification is required, then retry." : cause?.response?.data?.error || "Policy publication failed"); }
    finally { setSaving(false); }
  };

  const runAction = async (account: Account) => {
    const row = action[account.id];
    if (!row || row.reason.trim().length < 5 || !row.value) return;
    setSaving(true); setActionErrors((old) => ({ ...old, [account.id]: "" }));
    try {
      const endpoint = `/api/admin/nrms/commercial/property/${account.propertyId}/${row.kind}`;
      const payload = row.kind === "trial" ? { trialEndsAt: new Date(row.value).toISOString(), reason: row.reason } : row.kind === "unpaid-limit" ? { unpaidLimit: Number(row.value), reason: row.reason } : row.kind === "credit" ? { amount: Number(row.value), reason: row.reason } : { policyId: Number(row.value), reason: row.reason };
      await apiClient.post(endpoint, payload);
      setNotice(`${account.propertyTitle} was updated and the owner was notified.`); setAction((old) => ({ ...old, [account.id]: { kind: "", value: "", reason: "" } })); await load();
    } catch (cause: any) {
      const message = cause?.response?.data?.require2fa ? "Finance OTP verification is required, then retry." : cause?.response?.data?.error || "Commercial action failed";
      setActionErrors((old) => ({ ...old, [account.id]: message }));
    }
    finally { setSaving(false); }
  };

  const livePolicy = useMemo(() => policies.find((p) => !p.effectiveTo) ?? policies[0] ?? null, [policies]);
  const watchedAccounts = useMemo(() => accounts.filter((a) => a.dunning.stage !== "CURRENT").length, [accounts]);

  const filteredAccounts = useMemo(() => {
    const query = leverQuery.trim().toLowerCase();
    return accounts.filter((a) => {
      if (leverStage && a.dunning.stage !== leverStage) return false;
      if (query && !`${a.propertyTitle} ${a.owner.name} ${a.policy.version}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [accounts, leverQuery, leverStage]);
  const leverPageCount = Math.max(1, Math.ceil(filteredAccounts.length / LEVER_PAGE_SIZE));
  const leverCurrentPage = Math.min(leverPage, leverPageCount);
  const pagedAccounts = filteredAccounts.slice((leverCurrentPage - 1) * LEVER_PAGE_SIZE, leverCurrentPage * LEVER_PAGE_SIZE);

  const effective = splitDateTime(form.effectiveFrom);
  const previewLimit = Number(form.unpaidLimit) || 0;
  const reminderPercent = clampPercent(Number(form.reminderAmount), previewLimit);
  const warningPercent = clampPercent(Number(form.warningAmount), previewLimit);

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const renderField = ({ key, label, unit, hint }: FieldDef) => (
    <label key={key} className="block min-w-0">
      <span className="text-[11px] font-bold text-neutral-700">{label}</span>
      <span className="relative mt-1.5 block">
        <input type="number" min={0} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={fieldInputClass} />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-bold uppercase tracking-wide text-neutral-400">{unit}</span>
      </span>
      <span className="mt-1 block text-[10px] leading-4 text-neutral-400">{hint}</span>
    </label>
  );

  return (
    <div id="nrms-pricing" className="mx-auto min-w-0 max-w-6xl space-y-5 px-4 py-6">
      {/* Preflight is disabled in this project; without border-box, w-full inputs overflow their grid columns */}
      <style>{`#nrms-pricing, #nrms-pricing * { box-sizing: border-box; }`}</style>
      <Link href="/admin/nrms/billing" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> PAYG billing board</Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">PRICING</div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Coins className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS commercial</p>
                <span className="inline-flex rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">Forward-only</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Pricing and levers</h1>
              <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">Publish forward-only pricing and manage reasoned property exceptions.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-100 bg-white/85 px-3.5 py-2.5 shadow-sm">
            <CircleDollarSign className="h-4 w-4 text-emerald-700" />
            <div>
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Live rate</p>
              <p className="m-0 text-sm font-bold text-neutral-900">{livePolicy ? money(livePolicy.roomNightPrice) : "No policy"} {livePolicy && <span className="font-medium text-neutral-400">/ room-night</span>}</p>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={CircleDollarSign} label="Live room-night rate" value={livePolicy ? money(livePolicy.roomNightPrice) : "n/a"} detail={livePolicy ? `Policy ${livePolicy.version}` : "Publish the first version"} tone="emerald" />
        <SummaryCard icon={Layers} label="Policy versions" value={String(policies.length)} detail={livePolicy ? `${livePolicy.accountCount} accounts on the live policy` : "No versions yet"} tone="blue" />
        <SummaryCard icon={Gauge} label="Accounts in dunning" value={String(watchedAccounts)} detail={`of ${accounts.length} PAYG accounts`} tone={watchedAccounts > 0 ? "amber" : "slate"} />
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Save} title="Publish policy version" subtitle="The prior version closes at the effective time. Finance OTP required." right={<span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">Historical usage unchanged</span>} />

        <div className="grid min-w-0 gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)] lg:gap-7">
          <div className="min-w-0 space-y-5">
            <div>
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Rates and periods</p>
              <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-3">{RATE_FIELDS.map(renderField)}</div>
            </div>
            <div className="border-t border-neutral-100 pt-5">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">Dunning thresholds</p>
              <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-3">{DUNNING_FIELDS.map(renderField)}</div>
            </div>
          </div>

          <aside className="min-w-0 rounded-xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f0faf6_100%)] p-4 shadow-[0_8px_24px_-24px_rgba(2,102,94,0.7)] sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Gauge className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="m-0 text-xs font-bold text-neutral-900">Owner-facing preview</p>
                <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">How this version reads on the usage meter</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="relative h-3 overflow-hidden rounded-full bg-neutral-100 ring-1 ring-inset ring-neutral-200/70">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#34d399_0%,#fbbf24_60%,#ef4444_100%)] opacity-80" style={{ width: "100%" }} />
                <span className="absolute inset-y-0 w-px bg-yellow-600/80" style={{ left: `${reminderPercent}%` }} aria-hidden="true" />
                <span className="absolute inset-y-0 w-px bg-amber-700/80" style={{ left: `${warningPercent}%` }} aria-hidden="true" />
              </div>
              <div className="mt-3 space-y-2 text-[11px]">
                <PreviewRow color="bg-yellow-400" label="Reminder" value={money(form.reminderAmount)} percent={reminderPercent} />
                <PreviewRow color="bg-amber-500" label="Warning" value={money(form.warningAmount)} percent={warningPercent} />
                <PreviewRow color="bg-red-500" label="Freeze" value={money(form.unpaidLimit)} percent={100} />
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-neutral-600 shadow-sm ring-1 ring-neutral-200/70">{money(form.roomNightPrice)} / room-night</span>
                <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-neutral-600 shadow-sm ring-1 ring-neutral-200/70">{Number(form.trialDays) || 0} trial days</span>
                <span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-neutral-600 shadow-sm ring-1 ring-neutral-200/70">{Number(form.graceDays) || 0} grace days</span>
              </div>
            </div>
          </aside>
        </div>

        <div className="border-t border-neutral-100 px-4 py-5 sm:px-5">
          <p className="m-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400"><CalendarClock className="h-3.5 w-3.5" /> Activation</p>
          <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-[minmax(230px,270px)_minmax(0,1fr)]">
            <div className="min-w-0">
              <span className="block text-[11px] font-bold text-neutral-700">Effective from</span>
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1"><DatePickerField label="Policy effective date" size="sm" widthClassName="!w-full !rounded-lg" twoMonths={false} value={effective.date} onChangeAction={(next) => setForm({ ...form, effectiveFrom: `${next.slice(0, 10)}T${effective.time}` })} /></div>
                <input type="time" value={effective.time} disabled={!effective.date} onChange={(e) => setForm({ ...form, effectiveFrom: `${effective.date}T${e.target.value || "00:00"}` })} className={timeInputClass} aria-label="Policy effective time" />
              </div>
            </div>
            <label className="block min-w-0"><span className="text-[11px] font-bold text-neutral-700">Reason</span><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={`${plainInputClass} mt-1.5`} placeholder="Business reason, at least 5 characters" /></label>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-neutral-100 bg-neutral-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="m-0 text-[10px] leading-4 text-neutral-500">Use a clear reason so Finance and property owners can trace this policy change.</p>
          <button type="button" disabled={saving || form.reason.trim().length < 5 || !form.effectiveFrom} onClick={() => void publish()} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-[0_10px_24px_-16px_rgba(4,120,87,0.8)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"><Save className="h-4 w-4" /> Publish version</button>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={History} title="Policy history" subtitle="Published versions and the accounts using each policy" right={<CountPill count={policies.length} singular="version" plural="versions" />} />
        <div className="p-4 sm:p-5">
          {policies.length === 0 && <EmptyState icon={History} title="No versions yet" text="Publish the first policy version to start PAYG billing." />}
          {policies.length > 0 && (
            <div className="relative space-y-3 pl-5">
              <div className="absolute bottom-2 left-[4.5px] top-2 w-px bg-neutral-200" aria-hidden="true" />
              {policies.map((p) => {
                const isLive = !p.effectiveTo;
                return isLive ? (
                  <div key={p.id} className="relative">
                    <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-600 ring-4 ring-emerald-100" aria-hidden="true" />
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs font-bold text-neutral-900" title={p.version}>{p.version}</span>
                          <span className="shrink-0 rounded-full bg-emerald-700 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
                        </div>
                        <span className="shrink-0 text-xs text-neutral-500">Since {shortDate(p.effectiveFrom)}</span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border border-emerald-100 bg-white p-3">
                          <p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Commercial</p>
                          <p className="mb-0 mt-1 text-sm font-bold tabular-nums text-neutral-900">{p.roomNightPrice.toLocaleString()} <span className="text-xs font-medium text-neutral-400">/ room-night</span></p>
                          <p className="mb-0 mt-0.5 text-xs tabular-nums text-neutral-500">{p.trialDays}d trial</p>
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-white p-3">
                          <p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Dunning ladder</p>
                          <div className="mt-1.5 flex items-center gap-1 text-xs tabular-nums text-neutral-500">
                            <span>{p.reminderAmount.toLocaleString()}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-neutral-300" aria-hidden="true" />
                            <span>{p.warningAmount.toLocaleString()}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-neutral-300" aria-hidden="true" />
                            <span className="font-bold text-red-600">{p.unpaidLimit.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-white p-3">
                          <p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Operational</p>
                          <p className="mb-0 mt-1 text-sm font-bold tabular-nums text-neutral-900">{p.graceDays}d <span className="text-xs font-medium text-neutral-400">grace</span></p>
                          <p className="mb-0 mt-0.5 text-xs tabular-nums text-neutral-400">{p.accountCount} accounts</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={p.id} className="relative">
                    <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-neutral-300 bg-white" aria-hidden="true" />
                    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs text-neutral-600" title={p.version}>{p.version}</span>
                        <span className="shrink-0 text-xs text-neutral-400">{shortDate(p.effectiveFrom)} to {shortDate(p.effectiveTo!)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 items-center gap-x-4 gap-y-1 text-xs tabular-nums text-neutral-400 sm:grid-cols-[minmax(0,7.5rem)_minmax(0,3.5rem)_minmax(0,11rem)_minmax(0,3.5rem)_minmax(0,6rem)]">
                        <span>{p.roomNightPrice.toLocaleString()} / room-night</span>
                        <span>{p.trialDays}d trial</span>
                        <span className="inline-flex items-center gap-1">
                          {p.reminderAmount.toLocaleString()}
                          <ArrowRight className="h-2.5 w-2.5 shrink-0 text-neutral-300" aria-hidden="true" />
                          {p.warningAmount.toLocaleString()}
                          <ArrowRight className="h-2.5 w-2.5 shrink-0 text-neutral-300" aria-hidden="true" />
                          {p.unpaidLimit.toLocaleString()}
                        </span>
                        <span>{p.graceDays}d grace</span>
                        {p.accountCount > 0
                          ? <span className="w-fit rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{p.accountCount} accounts</span>
                          : <span>{p.accountCount} accounts</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={SlidersHorizontal} title="Property levers" subtitle="One reasoned exception at a time. Owners are notified on success." right={<CountPill count={accounts.length} singular="account" plural="accounts" />} />
        <div className="flex flex-col gap-2.5 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={leverQuery} onChange={(e) => { setLeverQuery(e.target.value); setLeverPage(1); }} placeholder="Search property, owner or policy" className={`${leverInputClass} pl-9`} aria-label="Search PAYG accounts" />
          </div>
          <select value={leverStage} onChange={(e) => { setLeverStage(e.target.value); setLeverPage(1); }} className={`${leverInputClass} sm:w-44 sm:shrink-0`} aria-label="Filter by dunning stage">
            {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="bg-neutral-50/70 p-3 sm:p-4">
          {accounts.length === 0 && <EmptyState icon={Building2} title="No PAYG accounts" text="Accounts appear here once properties activate NRMS billing." />}
          {accounts.length > 0 && filteredAccounts.length === 0 && <EmptyState icon={Search} title="No matches" text="No accounts match the current search and stage filter." />}
          <div className="space-y-2.5">
            {pagedAccounts.map((a) => {
              const row = action[a.id] ?? { kind: "", value: "", reason: "" };
              const stage = STAGE_STYLE[a.dunning.stage] ?? STAGE_STYLE.CURRENT;
              const usedPercent = clampPercent(a.unpaidBalance, a.unpaidLimit);
              const trial = splitDateTime(row.value);
              const valueField = row.kind === "trial"
                ? <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1"><DatePickerField label={`Trial end date for ${a.propertyTitle}`} display="day-month" size="sm" widthClassName="!w-full !rounded-lg" twoMonths={false} value={trial.date} onChangeAction={(next) => setAction({ ...action, [a.id]: { ...row, value: `${next.slice(0, 10)}T${trial.time}` } })} /></div>
                    <input type="time" value={trial.time} disabled={!trial.date} onChange={(e) => setAction({ ...action, [a.id]: { ...row, value: `${trial.date}T${e.target.value || "00:00"}` } })} className={timeInputClass} aria-label={`Trial end time for ${a.propertyTitle}`} />
                  </div>
                : row.kind === "policy"
                  ? <select value={row.value} onChange={(e) => setAction({ ...action, [a.id]: { ...row, value: e.target.value } })} className={leverInputClass} aria-label={`Policy for ${a.propertyTitle}`}><option value="">Choose policy</option>{policies.filter((p) => p.id !== a.policy.id).map((p) => <option key={p.id} value={p.id}>{p.version}</option>)}</select>
                  : <input type="number" min={0} value={row.value} onChange={(e) => setAction({ ...action, [a.id]: { ...row, value: e.target.value } })} placeholder="Amount" className={`${leverInputClass} tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} aria-label={`Amount for ${a.propertyTitle}`} />;
              return (
                <details key={a.id} className="group relative min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_8px_24px_-24px_rgba(15,23,42,0.7)] transition hover:-translate-y-px hover:border-neutral-300 hover:shadow-[0_14px_30px_-24px_rgba(15,23,42,0.55)]">
                  <span className={`absolute inset-y-0 left-0 w-1 ${stage.accent}`} aria-hidden="true" />
                  <summary className="cursor-pointer list-none p-3 pl-4 marker:hidden sm:p-3.5 sm:pl-5">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={`/admin/nrms/${a.propertyId}`} className="truncate text-sm font-bold text-neutral-900 no-underline transition hover:text-emerald-700" title={a.propertyTitle}>{a.propertyTitle}</Link>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${stage.badge}`}>{a.dunning.stage.replaceAll("_", " ")}</span>
                        </div>
                        <p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">{a.owner.name} <span className="px-0.5">·</span> policy {a.policy.version}</p>
                      </div>
                      <div className="w-full shrink-0 sm:w-52">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Unpaid</span>
                          <span className="truncate text-xs font-bold tabular-nums text-neutral-800">{a.unpaidBalance.toLocaleString()} <span className="font-medium text-neutral-400">/ {a.unpaidLimit.toLocaleString()}</span></span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100 ring-1 ring-inset ring-neutral-200/70"><div className={`h-full rounded-full ${stage.bar}`} style={{ width: `${usedPercent}%` }} /></div>
                      </div>
                    </div>
                  </summary>
                  <div className="grid min-w-0 gap-3 border-t border-neutral-100 bg-neutral-50/70 p-3 pl-4 sm:p-4 sm:pl-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
                    <label className="block min-w-0"><span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Lever</span><select value={row.kind} onChange={(e) => setAction({ ...action, [a.id]: { ...row, kind: e.target.value, value: "" } })} className={`${leverInputClass} mt-1.5`} aria-label={`Lever for ${a.propertyTitle}`}><option value="">Choose lever</option><option value="trial">Change trial end</option><option value="unpaid-limit">Change unpaid limit</option><option value="credit">Grant credit</option><option value="policy">Move to newer policy</option></select></label>
                    <label className="block min-w-0"><span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{LEVER_LABELS[row.kind] ?? "Value"}</span><span className="mt-1.5 block">{valueField}</span></label>
                    <label className="block min-w-0"><span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Reason</span><input value={row.reason} onChange={(e) => setAction({ ...action, [a.id]: { ...row, reason: e.target.value } })} placeholder="Reason, at least 5 characters" className={`${leverInputClass} mt-1.5`} aria-label={`Reason for ${a.propertyTitle}`} /></label>
                    <button type="button" disabled={saving || !row.kind || !row.value || row.reason.trim().length < 5} onClick={() => void runAction(a)} className="min-h-10 rounded-lg border-0 bg-emerald-700 px-4 text-xs font-bold text-white shadow-[0_10px_24px_-16px_rgba(4,120,87,0.8)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">Apply and notify owner</button>
                  </div>
                  {actionErrors[a.id] && (
                    <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-700 sm:mx-4 sm:mb-4" role="alert">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{actionErrors[a.id]}</span>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        </div>
        {filteredAccounts.length > LEVER_PAGE_SIZE && (
          <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="m-0 text-[11px] text-neutral-500">Showing <b className="font-bold text-neutral-700">{(leverCurrentPage - 1) * LEVER_PAGE_SIZE + 1}-{Math.min(leverCurrentPage * LEVER_PAGE_SIZE, filteredAccounts.length)}</b> of {filteredAccounts.length} accounts</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={leverCurrentPage <= 1} onClick={() => setLeverPage(leverCurrentPage - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-[11px] font-bold tabular-nums text-neutral-700">Page {leverCurrentPage} of {leverPageCount}</span>
              <button type="button" disabled={leverCurrentPage >= leverPageCount} onClick={() => setLeverPage(leverCurrentPage + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PreviewRow({ color, label, value, percent }: { color: string; label: string; value: string; percent: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 text-neutral-500 shadow-sm ring-1 ring-neutral-200/60">
      <span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${color}`} /><strong className="truncate font-semibold text-neutral-700">{label}</strong></span>
      <span className="shrink-0 tabular-nums">{value} <span className="text-neutral-400">· {percent}%</span></span>
    </div>
  );
}
