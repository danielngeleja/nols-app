"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Landmark,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Undo2,
  UserMinus,
  UserPlus,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import DocumentViewer from "@/components/admin/DocumentViewer";
import {
  DateField,
  LockedCard,
  MonthField,
  compactTzs,
  eatDate,
  eatTodayIso,
  fieldClass,
  financeFetch,
  monthLabel,
  primaryButton,
  secondaryButton,
  sectionLabel,
  tzs,
  useConfirm,
  useFinanceData,
  type ConfirmOptions,
} from "../../_shared";
import { payslipsHtml, type PayslipLine } from "./payslipDocument";
import CoverageCard, { coverageTone, type MonthCoverage } from "../../_coverage";

/**
 * Monthly pay runs: build the month from the employee register, adjust
 * overtime, bonuses and deductions, approve, mark paid (which books the
 * employer cost to the expense ledger), then issue payslips, the bank payment
 * schedule and the statutory payments.
 */

type Run = {
  id: number;
  runNumber: string;
  periodMonth: string;
  status: "DRAFT" | "APPROVED" | "PAID" | "CANCELLED";
  payDate: string | null;
  headcount: number;
  sdlApplies: boolean;
  gross: number;
  nssfEmployee: number;
  paye: number;
  otherDeductions: number;
  net: number;
  nssfEmployer: number;
  wcf: number;
  sdl: number;
  employerCost: number;
  heslb: number;
  paymentReference: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  expenseId: number | null;
};
type Payslip = PayslipLine & { id: number; employeeId: number };
type Remittance = { key: string; payee: string; label: string; amount: number; dueOn: string; paid: { paidOn: string; reference: string; amount: number; note: string | null } | null };
type RunDetail = {
  run: Run;
  payslips: Payslip[];
  remittances: Remittance[];
  holds: Array<{ employeeId: number; name: string; reason: "UNCONFIRMED" | "STALE" }>;
  controls: { selfApprovalAllowed: boolean; preparedByMe: boolean; approvedByMe: boolean };
};
type Employee = { id: number; fullName: string; status: string; startDate: string; endDate: string | null; missing: string[] };

const STATUS: Record<Run["status"], { label: string; tone: string; tile: string; dot: string }> = {
  DRAFT: { label: "Draft", tone: "bg-amber-50 text-amber-700 ring-amber-200", tile: "border-amber-300 bg-amber-50", dot: "bg-amber-400" },
  APPROVED: { label: "Approved", tone: "bg-sky-50 text-sky-700 ring-sky-200", tile: "border-sky-300 bg-sky-50", dot: "bg-sky-500" },
  PAID: { label: "Paid", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", tile: "border-emerald-300 bg-emerald-50", dot: "bg-emerald-500" },
  CANCELLED: { label: "Cancelled", tone: "bg-neutral-100 text-neutral-500 ring-neutral-200", tile: "border-neutral-200 bg-white", dot: "bg-neutral-300" },
};
const STEPS: Array<Run["status"]> = ["DRAFT", "APPROVED", "PAID"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
const displayName = (name: string) => (name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase()) : name);

/** Plain names for the statutory payments, so nothing needs truncating. */
type StatutoryTone = { band: string; text: string; ring: string };
const TRA_TONE: StatutoryTone = { band: "bg-amber-50", text: "text-amber-800", ring: "#d97706" };
const STATUTORY: Record<string, { short: string; name: string; what: string; tone: StatutoryTone }> = {
  PAYE: { short: "PAYE", name: "PAYE income tax", what: "Withheld from salaries", tone: TRA_TONE },
  SDL: { short: "SDL", name: "Skills Development Levy", what: "Paid by NoLSAF on gross pay", tone: TRA_TONE },
  NSSF: { short: "NSSF", name: "NSSF pension", what: "Staff and NoLSAF shares", tone: { band: "bg-sky-50", text: "text-sky-800", ring: "#0284c7" } },
  WCF: { short: "WCF", name: "Workers Compensation", what: "Paid by NoLSAF on gross pay", tone: { band: "bg-violet-50", text: "text-violet-800", ring: "#7c3aed" } },
  HESLB: { short: "HESLB", name: "HESLB student loans", what: "Withheld from salaries", tone: { band: "bg-teal-50", text: "text-teal-800", ring: "#0d9488" } },
};

/** How one payslip's gross divides: take-home and each deduction. */
const SLIP_PARTS = [
  { key: "net", label: "Take-home", color: "bg-[#02665e]" },
  { key: "paye", label: "PAYE", color: "bg-amber-400" },
  { key: "nssf", label: "NSSF", color: "bg-sky-400" },
  { key: "heslb", label: "HESLB", color: "bg-teal-300" },
  { key: "other", label: "Loans and other", color: "bg-rose-400" },
] as const;
function slipParts(p: { net: number; paye: number; nssfEmployee: number; heslb?: number; loanDeduction: number; otherDeductions: number }) {
  const values: Record<(typeof SLIP_PARTS)[number]["key"], number> = { net: p.net, paye: p.paye, nssf: p.nssfEmployee, heslb: p.heslb ?? 0, other: p.loanDeduction + p.otherDeductions };
  return SLIP_PARTS.map((part) => ({ ...part, value: values[part.key] })).filter((part) => part.value > 0);
}

/** "due in 5 days", "due today", "3 days overdue". */
function dueIn(dueOn: string, today: string) {
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return { text: "due today", tone: "text-amber-700" };
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, tone: "text-rose-700" };
  return { text: `due in ${days} day${days === 1 ? "" : "s"}`, tone: days <= 7 ? "text-amber-700" : "text-neutral-500" };
}

export default function PayRunsPage() {
  const runs = useFinanceData<{ items: Run[] }>("/api/admin/finance/payroll/runs");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const today = eatTodayIso();
  const thisMonth = today.slice(0, 7);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const coverage = useFinanceData<{ months: MonthCoverage[] }>(`/api/admin/finance/payroll/coverage?year=${year}`);
  const coverageByMonth = useMemo(() => new Map((coverage.data?.months ?? []).map((c) => [c.periodMonth, c])), [coverage.data]);

  // Open the latest run by default.
  useEffect(() => {
    if (selectedId == null && runs.data?.items.length) setSelectedId(runs.data.items[0].id);
  }, [runs.data, selectedId]);

  const items = useMemo(() => runs.data?.items ?? [], [runs.data]);
  // The run that counts for each month: the newest one that was not cancelled.
  const byMonth = useMemo(() => {
    const map = new Map<string, Run>();
    [...items].reverse().forEach((r) => { if (r.status !== "CANCELLED" || !map.has(r.periodMonth)) map.set(r.periodMonth, r); });
    return map;
  }, [items]);

  if (runs.locked) return <LockedCard what="Payroll" />;

  const latestPaid = items.find((r) => r.status === "PAID");
  const open = items.find((r) => r.status === "DRAFT" || r.status === "APPROVED");
  const paidThisYear = items.filter((r) => r.status === "PAID" && r.periodMonth.startsWith(String(year)));
  const ytdCost = paidThisYear.reduce((s, r) => s + r.employerCost, 0);

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#02665e]"><CalendarCheck2 className="h-3.5 w-3.5" /> Payroll</span>
            <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight text-neutral-900">Pay runs and payslips</h1>
            <p className="m-0 mt-1 max-w-xl text-sm text-neutral-500">Build each month from the register, approve, pay, then hand out payslips and settle TRA, NSSF and WCF.</p>
          </div>
          <button type="button" onClick={() => setCreating(byMonth.has(thisMonth) ? "" : thisMonth)} className="inline-flex h-11 items-center gap-2 rounded-full border-0 bg-[#0b2420] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(11,36,32,0.8)] hover:bg-[#12342f]">
            <Plus className="h-4 w-4" /> New pay run
          </button>
        </div>

        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4">
          {[
            { label: "Open run", value: open ? monthLabel(open.periodMonth) : "None", detail: open ? `${STATUS[open.status].label}, net ${compactTzs(open.net)}` : "nothing waiting" },
            { label: "Last paid", value: latestPaid ? monthLabel(latestPaid.periodMonth) : "None yet", detail: latestPaid ? `net ${compactTzs(latestPaid.net)} to ${latestPaid.headcount}` : "no payroll paid yet" },
            { label: `Cost so far in ${year}`, value: compactTzs(ytdCost), detail: `${paidThisYear.length} paid month${paidThisYear.length === 1 ? "" : "s"}` },
            { label: "This month", value: byMonth.has(thisMonth) ? STATUS[byMonth.get(thisMonth)!.status].label : "Not started", detail: monthLabel(thisMonth) },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3.5 sm:px-6">
              <dt className="text-[11px] font-semibold text-neutral-400">{f.label}</dt>
              <dd className="m-0 mt-1 truncate text-lg font-bold text-neutral-900">{f.value}</dd>
              <dd className="m-0 truncate text-[11px] text-neutral-500">{f.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Year calendar */}
      {(() => {
        const months = MONTH_SHORT.map((m, i) => {
          const key = `${year}-${String(i + 1).padStart(2, "0")}`;
          const run = byMonth.get(key);
          const future = key > thisMonth;
          const missed = !run && !future && key < thisMonth && items.length > 0 && key >= (items[items.length - 1]?.periodMonth ?? key);
          return { m, key, run, future, missed, cover: coverageByMonth.get(key) };
        });
        const paidCount = months.filter((x) => x.run?.status === "PAID").length;
        const openCount = months.filter((x) => x.run && (x.run.status === "DRAFT" || x.run.status === "APPROVED")).length;
        const missedCount = months.filter((x) => x.missed).length;
        return (
          <section className="rounded-3xl border border-solid border-neutral-200 bg-white px-4 py-4 shadow-sm sm:px-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-bold text-neutral-900">Payroll year</p>
                <p className="m-0 mt-0.5 text-xs text-neutral-500">
                  <span className="font-semibold text-neutral-800">{paidCount}</span> paid
                  {openCount ? <>, <span className="font-semibold text-amber-700">{openCount}</span> open</> : null}
                  {missedCount ? <>, <span className="font-semibold text-rose-700">{missedCount}</span> without a run</> : null}
                </p>
              </div>
              <div className="hidden items-center gap-3 text-[11px] text-neutral-500 md:flex">
                {(["PAID", "APPROVED", "DRAFT"] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS[k].dot}`} />{STATUS[k].label}</span>
                ))}
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" />Missing</span>
              </div>
              <div className="inline-flex items-center rounded-full border border-solid border-neutral-200 bg-white p-0.5">
                <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="Previous year" className="grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent text-neutral-500 hover:bg-neutral-100"><ChevronLeft className="h-4 w-4" /></button>
                <span className="w-11 text-center text-xs font-bold tabular-nums text-neutral-900">{year}</span>
                <button type="button" onClick={() => setYear((y) => y + 1)} disabled={year >= Number(today.slice(0, 4))} aria-label="Next year" className="grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-6 gap-x-1 gap-y-3 xl:grid-cols-12">
              {months.map(({ m, key, run, future, missed, cover }) => {
                const selected = !!run && run.id === selectedId;
                const current = key === thisMonth;
                const coverTone = coverageTone(cover?.coveragePercent ?? null);
                const track = run ? STATUS[run.status].dot : missed ? "bg-rose-400" : future ? "bg-neutral-100" : "bg-neutral-200";
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={future}
                    onClick={() => (run ? setSelectedId(run.id) : setCreating(key))}
                    aria-label={run ? `${monthLabel(key)}, ${STATUS[run.status].label}` : `Start ${monthLabel(key)} payroll`}
                    className={`group flex min-w-0 flex-col rounded-2xl border-0 px-2 pb-2 pt-1.5 text-left transition ${selected ? "bg-[#02665e]/[0.07]" : future ? "bg-transparent" : "bg-transparent hover:bg-neutral-50"} ${future ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <span className="flex h-5 items-center justify-between gap-1">
                      <span className={`text-xs font-bold ${future ? "text-neutral-300" : selected ? "text-[#02665e]" : "text-neutral-800"}`}>{m}</span>
                      {current ? <span className="rounded-full bg-[#02665e] px-1.5 py-px text-[9px] font-bold text-white">Now</span> : null}
                    </span>
                    <span className={`mt-1.5 block h-1.5 rounded-full ${track} ${selected ? "ring-2 ring-[#02665e]/25" : ""}`} />
                    <span className={`mt-2 block truncate text-[11px] font-semibold ${run ? "text-neutral-900" : missed ? "text-rose-700" : "text-neutral-400"}`}>
                      {run ? STATUS[run.status].label : missed ? "Missing" : future ? "\u00a0" : "No run"}
                    </span>
                    <span className="block h-4 truncate text-[11px] tabular-nums text-neutral-500">
                      {run ? compactTzs(run.net) : future ? null : (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-[#02665e] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Plus className="h-3 w-3" />Start</span>
                      )}
                    </span>
                    <span className="mt-1 block h-3.5 truncate text-[10px] font-semibold tabular-nums" title={cover && cover.totalCosts > 0 ? `Revenue covers ${Math.round(cover.coveragePercent ?? 0)}% of the month's costs` : undefined}>
                      {cover && cover.totalCosts > 0 ? <span className={coverTone.text}>{Math.round(cover.coveragePercent ?? 0)}% covered</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })()}

      {selectedId != null ? (
        <RunWorkspace key={selectedId} runId={selectedId} onChanged={() => runs.reload()} />
      ) : (
        <section className="grid min-h-[260px] place-items-center rounded-3xl border border-dashed border-neutral-300 bg-white p-6 text-center">
          <div>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><CalendarCheck2 className="h-6 w-6" /></span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">{runs.loading ? "Loading..." : "No pay runs yet"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">Pick a month above to build its payroll from the employee register.</p>
          </div>
        </section>
      )}

      {creating != null && <NewRunDialog initialMonth={creating || thisMonth} onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); runs.reload(); setSelectedId(id); }} />}
    </div>
  );
}

// ── One run ────────────────────────────────────────────────────────────

function RunWorkspace({ runId, onChanged }: { runId: number; onChanged: () => void }) {
  const detail = useFinanceData<RunDetail>(`/api/admin/finance/payroll/runs/${runId}`);
  const runMonth = detail.data?.run.periodMonth ?? null;
  const coverage = useFinanceData<{ months: MonthCoverage[] }>(runMonth && runMonth <= eatTodayIso().slice(0, 7) ? `/api/admin/finance/payroll/coverage?month=${runMonth}` : null);
  const register = useFinanceData<{ items: Employee[] }>("/api/admin/finance/payroll/employees");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const [paying, setPaying] = useState(false);
  const [viewer, setViewer] = useState<{ title: string; lines: Payslip[] } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [recording, setRecording] = useState<Remittance | null>(null);
  const today = eatTodayIso();

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const run = detail.data?.run;
  const payslips = useMemo(() => detail.data?.payslips ?? [], [detail.data]);

  // Smart checks for a run that can still change.
  const checks = useMemo(() => {
    if (!run || !register.data) return [];
    const [y, m] = run.periodMonth.split("-").map(Number);
    const monthStart = `${run.periodMonth}-01`;
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" }) : null);
    const inRun = new Set(payslips.map((p) => p.employeeId));
    const eligible = register.data.items.filter((e) => {
      const start = day(e.startDate)!;
      const end = day(e.endDate);
      return start <= monthEnd && (!end || end >= monthStart) && !(e.status === "TERMINATED" && !end);
    });
    const out: Array<{ key: string; tone: "amber" | "sky" | "rose"; icon: typeof AlertTriangle; title: string; detail: string; action?: "refresh" }> = [];
    const notIn = eligible.filter((e) => !inRun.has(e.id));
    if (notIn.length) out.push({ key: "missing", tone: "rose", icon: UserPlus, title: `${notIn.length} on the payroll but not in this run`, detail: notIn.slice(0, 3).map((e) => displayName(e.fullName)).join(", ") + (notIn.length > 3 ? ` and ${notIn.length - 3} more` : ""), action: "refresh" });
    const joiners = eligible.filter((e) => (day(e.startDate) ?? "") > monthStart);
    if (joiners.length) out.push({ key: "joiners", tone: "sky", icon: UserPlus, title: `${joiners.length} joined during ${monthLabel(run.periodMonth)}`, detail: `${joiners.map((e) => `${displayName(e.fullName)} (from ${eatDate(e.startDate)})`).join(", ")}. Paid only for the days they were employed.` });
    const leavers = eligible.filter((e) => { const end = day(e.endDate); return end != null && end < monthEnd; });
    if (leavers.length) out.push({ key: "leavers", tone: "sky", icon: UserMinus, title: `${leavers.length} leaving during ${monthLabel(run.periodMonth)}`, detail: `${leavers.map((e) => `${displayName(e.fullName)} (last day ${eatDate(e.endDate)})`).join(", ")}. Paid up to their last day. Add notice or leave pay as a bonus line.` });
    for (const h of detail.data?.holds ?? []) {
      out.push(h.reason === "UNCONFIRMED"
        ? { key: `hold-${h.employeeId}`, tone: "rose", icon: ShieldAlert, title: `New pay account for ${displayName(h.name)} not confirmed`, detail: "Another admin must confirm it on their employee record before this run can be approved." }
        : { key: `hold-${h.employeeId}`, tone: "rose", icon: ShieldAlert, title: `Pay account for ${displayName(h.name)} changed`, detail: "Refresh the run so the payslip and payment schedule use the confirmed account.", action: "refresh" });
    }
    const incomplete = eligible.filter((e) => inRun.has(e.id) && e.missing.length);
    if (incomplete.length) out.push({ key: "records", tone: "amber", icon: AlertTriangle, title: `${incomplete.length} record${incomplete.length === 1 ? "" : "s"} missing details for the returns`, detail: incomplete.map((e) => `${displayName(e.fullName)}: ${e.missing.join(", ")}`).join("; ") });
    return out;
  }, [run, register.data, payslips, detail.data?.holds]);

  async function act(action: "approve" | "reopen" | "cancel" | "refresh", ask?: ConfirmOptions) {
    setMenuOpen(false);
    if (ask && !(await confirm(ask))) return;
    setBusy(action);
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/runs/${runId}/${action}`, { method: "POST", body: "{}" });
      detail.reload();
      coverage.reload();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function undoRemittance(r: Remittance) {
    if (!(await confirm({ title: `Undo the ${r.label} payment?`, message: "Only for a payment recorded by mistake. It goes back to waiting to be paid.", confirmLabel: "Undo payment", cancelLabel: "Keep it", danger: true }))) return;
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/runs/${runId}/remittances/${r.key}`, { method: "DELETE" });
      detail.reload();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Nothing was changed.");
    }
  }

  function downloadSchedule() {
    setMenuOpen(false);
    if (!run) return;
    const rows = [["Payslip", "Employee no.", "Name", "Paid to", "Net pay (TZS)"], ...payslips.map((p) => [p.payslipNumber, p.employee.employeeNo, p.employee.fullName, p.employee.payTo, String(Math.round(p.net))])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.runNumber}-payment-schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (detail.locked) return <LockedCard what="This pay run" />;
  if (!run) return <section className="grid min-h-[320px] place-items-center rounded-3xl border border-solid border-neutral-200 bg-white"><Loader2 className="h-5 w-5 animate-spin text-neutral-400" /></section>;

  const stepIndex = STEPS.indexOf(run.status);
  const cancelled = run.status === "CANCELLED";
  const flow = [
    { key: "net", label: "Net pay to staff", value: run.net, color: "bg-[#02665e]" },
    { key: "paye", label: "PAYE to TRA", value: run.paye, color: "bg-amber-400" },
    { key: "nssf", label: "NSSF", value: run.nssfEmployee + run.nssfEmployer, color: "bg-sky-500" },
    { key: "sdl", label: "SDL to TRA", value: run.sdl, color: "bg-violet-500" },
    { key: "wcf", label: "WCF", value: run.wcf, color: "bg-neutral-400" },
    { key: "heslb", label: "HESLB loan repayments", value: run.heslb, color: "bg-teal-400" },
    { key: "other", label: "Loans and other deductions", value: run.otherDeductions, color: "bg-rose-400" },
  ].filter((f) => f.value > 0);

  const holds = detail.data?.holds ?? [];
  const controls = detail.data?.controls;
  const blocked =
    run.status === "DRAFT" && controls?.preparedByMe && !controls.selfApprovalAllowed
      ? "You prepared this run, so another admin must approve it."
      : run.status === "APPROVED" && controls?.approvedByMe && !controls.selfApprovalAllowed
        ? "You approved this run, so another admin must mark it as paid."
        : (run.status === "DRAFT" || run.status === "APPROVED") && holds.length
          ? `Waiting on a confirmed pay account for ${holds.map((h) => displayName(h.name)).join(", ")}.`
          : null;

  // The single next step, so the page always says what to do now.
  const primary =
    run.status === "DRAFT"
      ? { label: "Approve payroll", icon: BadgeCheck, onClick: () => void act("approve", {
          title: `Approve ${monthLabel(run.periodMonth)} payroll?`,
          message: "This locks the figures. You can reopen it until it is marked as paid.",
          confirmLabel: "Approve payroll",
          facts: [
            { label: "Net pay to staff", value: tzs(run.net) },
            { label: "People paid", value: String(run.headcount) },
            { label: "Cost to NoLSAF", value: tzs(run.employerCost) },
            { label: "PAYE to TRA", value: tzs(run.paye) },
          ],
        }), busy: busy === "approve" }
      : run.status === "APPROVED"
        ? { label: "Mark as paid", icon: Wallet, onClick: () => setPaying(true), busy: false }
        : run.status === "PAID"
          ? { label: "Payslips", icon: FileText, onClick: () => setViewer({ title: `Payslips, ${monthLabel(run.periodMonth)}`, lines: payslips }), busy: false }
          : null;

  const menu: Array<{ label: string; icon: typeof RefreshCw; onClick: () => void; danger?: boolean }> = [
    ...(run.status === "DRAFT" ? [{ label: "Refresh from register", icon: RefreshCw, onClick: () => void act("refresh") }] : []),
    ...(run.status === "APPROVED" ? [{ label: "Reopen to edit", icon: Undo2, onClick: () => void act("reopen") }] : []),
    ...(!cancelled && payslips.length && run.status !== "PAID" ? [{ label: "Preview payslips", icon: FileText, onClick: () => { setMenuOpen(false); setViewer({ title: `Payslips, ${monthLabel(run.periodMonth)}`, lines: payslips }); } }] : []),
    ...(!cancelled && payslips.length ? [{ label: "Bank payment schedule (CSV)", icon: Download, onClick: downloadSchedule }] : []),
    ...(run.status === "DRAFT" || run.status === "APPROVED" ? [{ label: "Cancel this run", icon: XCircle, onClick: () => void act("cancel", { title: `Cancel ${monthLabel(run.periodMonth)} pay run?`, message: "It stays on record as cancelled, but no one is paid from it. You can build a new run for the month afterwards.", confirmLabel: "Cancel the run", cancelLabel: "Keep it", danger: true }), danger: true }] : []),
  ];

  return (
    <div className="min-w-0 space-y-4">
      {/* Run card */}
      <section className="rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start gap-4 px-5 pb-4 pt-5 sm:px-6">
          <div className="mr-auto min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-xl font-bold tracking-tight text-neutral-900">{monthLabel(run.periodMonth)}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS[run.status].tone}`}>{STATUS[run.status].label}</span>
            </div>
            <p className="m-0 mt-1 text-xs text-neutral-500">
              {run.runNumber} · {run.headcount} {run.headcount === 1 ? "payslip" : "payslips"}{run.sdlApplies ? " · SDL applies" : ""}
              {run.paidAt ? ` · paid ${eatDate(run.payDate)}${run.paymentReference ? `, ref ${run.paymentReference}` : ""}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {primary ? (
              <button type="button" onClick={primary.onClick} disabled={Boolean(busy) || (Boolean(blocked) && run.status !== "PAID")} title={blocked ?? undefined} className="inline-flex h-10 items-center gap-2 rounded-full border-0 bg-[#0b2420] px-4 text-sm font-semibold text-white hover:bg-[#12342f] disabled:opacity-50">
                {primary.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <primary.icon className="h-4 w-4" />} {primary.label}
              </button>
            ) : null}
            {menu.length ? (
              <div className="relative" ref={menuRef}>
                <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More actions" className="grid h-10 w-10 place-items-center rounded-full border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50">
                  {busy && busy !== "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-solid border-neutral-200 bg-white p-1.5 shadow-xl">
                    {menu.map((item) => (
                      <button key={item.label} type="button" role="menuitem" onClick={item.onClick} className={`flex w-full items-center gap-2.5 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm font-medium hover:bg-neutral-100 ${item.danger ? "text-rose-700" : "text-neutral-800"}`}>
                        <item.icon className="h-4 w-4 shrink-0 opacity-70" /> {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {blocked ? (
          <p className="m-0 mx-5 mb-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200 sm:mx-6">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {blocked}
          </p>
        ) : null}

        {/* Progress */}
        {!cancelled && (
          <div className="px-5 pb-5 sm:px-6">
            <ol className="m-0 flex list-none items-center p-0">
              {STEPS.map((step, i) => {
                const done = i < stepIndex || run.status === "PAID";
                const current = i === stepIndex && run.status !== "PAID";
                const caption = step === "DRAFT" ? "Adjust and check" : step === "APPROVED" ? (run.approvedAt ? eatDate(run.approvedAt) : "Locks the figures") : run.paidAt ? `Paid ${eatDate(run.payDate)}` : "Books the cost";
                return (
                  <li key={step} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
                    <span className="flex items-center gap-2.5">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-[#02665e] text-white" : current ? "bg-[#0b2420] text-emerald-300 ring-4 ring-[#0b2420]/10" : "bg-neutral-100 text-neutral-400"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}</span>
                      <span className="hidden min-w-0 sm:block">
                        <span className={`block text-xs font-bold ${done || current ? "text-neutral-900" : "text-neutral-400"}`}>{STATUS[step].label}</span>
                        <span className="block text-[11px] text-neutral-500">{caption}</span>
                      </span>
                    </span>
                    {i < STEPS.length - 1 ? <span className={`mx-3 h-0.5 flex-1 rounded-full ${i < stepIndex || run.status === "PAID" ? "bg-[#02665e]" : "bg-neutral-200"}`} /> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Money */}
        <div className="grid gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <dl className="m-0 grid grid-cols-2 gap-px bg-neutral-200">
            {[
              { label: "Net pay", value: tzs(run.net), tone: "text-[#02665e]" },
              { label: "Cost to NoLSAF", value: tzs(run.employerCost), tone: "text-neutral-900" },
              { label: "Gross pay", value: tzs(run.gross), tone: "text-neutral-900" },
              { label: "People paid", value: String(run.headcount), tone: "text-neutral-900" },
            ].map((f) => (
              <div key={f.label} className="bg-white px-5 py-3.5">
                <dt className="text-[11px] font-semibold text-neutral-400">{f.label}</dt>
                <dd className={`m-0 mt-0.5 truncate text-lg font-bold tabular-nums ${f.tone}`}>{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="bg-white px-5 py-4">
            <p className="m-0 text-[11px] font-semibold text-neutral-400">Where the {compactTzs(run.employerCost)} goes</p>
            <span className="mt-2.5 flex h-3 overflow-hidden rounded-full bg-neutral-100">
              {flow.map((f) => <span key={f.key} className={`h-full ${f.color}`} style={{ width: `${run.employerCost ? (f.value / run.employerCost) * 100 : 0}%` }} title={`${f.label}: ${tzs(f.value)}`} />)}
            </span>
            <ul className="m-0 mt-3 grid list-none gap-x-4 gap-y-1.5 p-0 sm:grid-cols-2">
              {flow.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-neutral-600"><span className={`h-2 w-2 shrink-0 rounded-full ${f.color}`} /><span className="truncate">{f.label}</span></span>
                  <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{tzs(f.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {error && <p className="m-0 rounded-b-3xl border-0 border-t border-solid border-rose-200 bg-rose-50/70 px-5 py-2.5 text-xs text-rose-800">{error}</p>}
      </section>

      {/* Does the month's revenue pay for it? */}
      {!cancelled && <CoverageCard coverage={coverage.data?.months[0] ?? null} loading={coverage.loading} title={`Is ${monthLabel(run.periodMonth)} covered by revenue?`} />}

      {/* Smart checks */}
      {run.status === "DRAFT" && (
        <section className="rounded-3xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><Sparkles className="h-4 w-4 text-[#02665e]" /> Before you approve</p>
          {!register.data ? (
            <p className="m-0 mt-2 text-xs text-neutral-500">Checking the register...</p>
          ) : checks.length ? (
            <ul className="m-0 mt-3 grid list-none gap-2 p-0 lg:grid-cols-2">
              {checks.map((c) => (
                <li key={c.key} className={`flex items-start gap-3 rounded-2xl px-3.5 py-3 ${c.tone === "rose" ? "bg-rose-50" : c.tone === "amber" ? "bg-amber-50" : "bg-sky-50"}`}>
                  <c.icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.tone === "rose" ? "text-rose-600" : c.tone === "amber" ? "text-amber-600" : "text-sky-600"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-neutral-900">{c.title}</span>
                    <span className="block text-xs text-neutral-600">{c.detail}</span>
                  </span>
                  {c.action === "refresh" ? <button type="button" onClick={() => void act("refresh")} disabled={Boolean(busy)} className="shrink-0 rounded-full border-0 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm hover:bg-neutral-50">Refresh</button> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Everyone on the payroll is in, records are complete and nobody joins or leaves mid-month.</p>
          )}
        </section>
      )}

      {/* Payslips */}
      <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
          <div className="mr-auto min-w-0">
            <h3 className="m-0 text-base font-bold text-neutral-900">Payslips <span className="font-semibold text-neutral-400">{payslips.length}</span></h3>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">{run.status === "DRAFT" ? "Tap someone to add overtime, a bonus or a deduction for this month." : cancelled ? "This run was cancelled." : "Locked. Reopen the run to change figures."}</p>
          </div>
          <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[11px] text-neutral-500">
            {SLIP_PARTS.map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${part.color}`} />{part.label}</li>
            ))}
          </ul>
        </div>

        <ul className="m-0 list-none border-0 border-t border-solid border-neutral-100 p-0">
          {payslips.map((p) => {
            const editable = run.status === "DRAFT";
            const extra = p.overtime + p.bonus;
            const adjusted = extra + p.loanDeduction + p.otherDeductions > 0;
            const parts = slipParts(p);
            return (
              <li key={p.id} className="border-0 border-b border-solid border-neutral-100 last:border-b-0">
                <div
                  role={editable ? "button" : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => editable && setAdjusting(p)}
                  onKeyDown={(ev) => { if (editable && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); setAdjusting(p); } }}
                  className={`group grid items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] ${editable ? "cursor-pointer transition hover:bg-neutral-50/80 focus-visible:bg-neutral-50 focus-visible:outline-none" : ""}`}
                >
                  {/* Who */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#02665e]/10 text-xs font-bold text-[#02665e]">{initials(p.employee.fullName)}</span>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-bold text-neutral-900" title={p.employee.fullName}>{displayName(p.employee.fullName)}</p>
                      <p className="m-0 truncate text-[11px] text-neutral-500">{p.employee.jobTitle}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.daysPaid != null && p.periodDays ? <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">{p.daysPaid} of {p.periodDays} days</span> : null}
                        {extra ? <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">+{compactTzs(extra).replace("TZS ", "")} extra</span> : null}
                        {adjusted && !extra ? <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">adjusted</span> : null}
                        {p.note ? <span className="max-w-[12rem] truncate rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600" title={p.note}>{p.note}</span> : null}
                      </div>
                    </div>
                  </div>

                  {/* Where the gross goes */}
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="text-neutral-500">Gross <b className="font-semibold tabular-nums text-neutral-800">{tzs(p.gross)}</b></span>
                      <span className="tabular-nums text-neutral-400">{p.gross ? Math.round((p.net / p.gross) * 100) : 0}% take-home</span>
                    </div>
                    <span className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                      {parts.map((part) => <span key={part.key} className={`h-full ${part.color}`} style={{ width: `${p.gross ? (part.value / p.gross) * 100 : 0}%` }} />)}
                    </span>
                    <dl className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                      {parts.filter((part) => part.key !== "net").map((part) => (
                        <div key={part.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={`h-1.5 w-1.5 rounded-full ${part.color}`} />
                          <dt className="text-neutral-500">{part.label}</dt>
                          <dd className="m-0 font-semibold tabular-nums text-neutral-800">{part.value.toLocaleString("en-US")}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {/* Net */}
                  <div className="flex items-center justify-between gap-4 lg:justify-end">
                    <div className="text-left lg:text-right">
                      <p className="m-0 text-[11px] font-semibold text-neutral-400">Net pay</p>
                      <p className="m-0 whitespace-nowrap text-lg font-bold tabular-nums text-[#02665e]">{tzs(p.net)}</p>
                    </div>
                    <button type="button" onClick={(ev) => { ev.stopPropagation(); setViewer({ title: `Payslip, ${displayName(p.employee.fullName)}`, lines: [p] }); }} aria-label={`Open ${displayName(p.employee.fullName)}'s payslip`} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-solid border-neutral-200 bg-white text-neutral-600 transition hover:border-[#02665e]/40 hover:bg-[#02665e]/[0.05] hover:text-[#02665e]">
                      <FileText className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {payslips.length > 1 && (
          <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-5">
            {[
              { label: `Gross, ${payslips.length} people`, value: run.gross, tone: "text-neutral-900" },
              { label: "PAYE", value: run.paye, tone: "text-neutral-900" },
              { label: "NSSF, employee share", value: run.nssfEmployee, tone: "text-neutral-900" },
              { label: run.heslb ? "HESLB and other" : "Other deductions", value: run.otherDeductions + run.heslb, tone: "text-neutral-900" },
              { label: "Net pay", value: run.net, tone: "text-[#02665e]" },
            ].map((f) => (
              <div key={f.label} className="min-w-0 bg-neutral-50 px-5 py-3 sm:px-6">
                <dt className="truncate text-[11px] font-semibold text-neutral-400">{f.label}</dt>
                <dd className={`m-0 mt-0.5 whitespace-nowrap text-base font-bold tabular-nums ${f.tone}`}>{tzs(f.value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* Statutory */}
      {!cancelled && detail.data!.remittances.length > 0 && (() => {
        const items = [...detail.data!.remittances].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
        const total = items.reduce((sum, r) => sum + r.amount, 0);
        const settled = items.filter((r) => r.paid);
        const settledAmount = settled.reduce((sum, r) => sum + r.amount, 0);
        const live = run.status === "PAID";
        const overdue = live ? items.filter((r) => !r.paid && r.dueOn < today) : [];
        const next = live ? items.find((r) => !r.paid) : null;
        return (
          <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
              <div className="mr-auto min-w-0">
                <h3 className="m-0 flex items-center gap-2 text-base font-bold text-neutral-900"><Landmark className="h-4 w-4 text-[#02665e]" /> Statutory payments</h3>
                <p className="m-0 mt-0.5 text-xs text-neutral-500">
                  {!live
                    ? "What this run will owe once salaries are paid."
                    : settled.length === items.length
                      ? "All paid. Keep the receipts with this run."
                      : overdue.length
                        ? `${overdue.length} past due. Pay and record ${overdue.length === 1 ? "it" : "them"} first to limit penalties.`
                        : next
                          ? `Next: ${STATUTORY[next.key]?.short ?? next.label} to ${next.payee}, ${dueIn(next.dueOn, today).text}.`
                          : ""}
                </p>
              </div>
              <div className="min-w-[13rem] text-right">
                <p className="m-0 text-[11px] font-semibold text-neutral-400">{live ? `${settled.length} of ${items.length} paid` : "Total to remit"}</p>
                <p className="m-0 whitespace-nowrap text-xl font-bold tabular-nums text-neutral-900">{tzs(total)}</p>
                {live ? (
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <span className="block h-full rounded-full bg-[#02665e] transition-[width]" style={{ width: `${total ? (settledAmount / total) * 100 : 0}%` }} />
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
              {items.map((r) => {
                const meta = STATUTORY[r.key] ?? { short: r.label, what: r.label, name: r.label, tone: STATUTORY.PAYE.tone };
                const due = dueIn(r.dueOn, today);
                const late = live && !r.paid && r.dueOn < today;
                const daysLeft = Math.round((Date.parse(`${r.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
                // The ring empties as the due date nears, counted from the end of the pay month.
                const [py, pm] = run.periodMonth.split("-").map(Number);
                const windowDays = Math.max(1, Math.round((Date.parse(`${r.dueOn}T00:00:00Z`) - Date.UTC(py, pm, 0)) / 86_400_000));
                const left = r.paid ? 1 : Math.max(0, Math.min(1, daysLeft / windowDays));
                const ring = r.paid ? "#059669" : late ? "#e11d48" : daysLeft <= 7 ? "#f59e0b" : meta.tone.ring;
                const detailLine = r.key === "NSSF" ? `${compactTzs(run.nssfEmployee)} staff + ${compactTzs(run.nssfEmployer)} NoLSAF` : meta.what;
                return (
                  <article key={r.key} className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid bg-white shadow-sm ${late ? "border-rose-300" : r.paid ? "border-emerald-200" : "border-neutral-200"}`}>
                    {/* Authority band */}
                    <div className={`flex items-center justify-between gap-2 px-4 py-2.5 ${meta.tone.band}`}>
                      <span className={`text-xs font-bold ${meta.tone.text}`}>{r.payee}</span>
                      {r.paid ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Paid</span>
                      ) : late ? (
                        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">Overdue</span>
                      ) : (
                        <span className={`text-[10px] font-semibold ${meta.tone.text} opacity-80`}>by {eatDate(`${r.dueOn}T00:00:00+03:00`)}</span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                      <p className="m-0 text-sm font-bold text-neutral-900">{meta.name}</p>
                      <p className="m-0 mt-0.5 text-[11px] leading-snug text-neutral-500">{detailLine}</p>
                      <p className="m-0 mt-3 whitespace-nowrap text-xl font-bold tabular-nums text-neutral-900">{tzs(r.amount)}</p>

                      <div className="mt-3 flex items-center gap-3">
                        <span className="relative grid h-11 w-11 shrink-0 place-items-center">
                          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
                            <circle cx="18" cy="18" r="15" fill="none" stroke="#eef0ef" strokeWidth="3.5" />
                            {left > 0 ? <circle cx="18" cy="18" r="15" fill="none" stroke={ring} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${left * 94.25} 94.25`} /> : null}
                          </svg>
                          {r.paid ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="text-[11px] font-bold tabular-nums" style={{ color: ring }}>{late ? `-${Math.abs(daysLeft)}` : daysLeft}</span>}
                        </span>
                        <span className="min-w-0 text-[11px] leading-snug">
                          {r.paid ? (
                            <>
                              <span className="block font-bold text-emerald-700">Paid {eatDate(r.paid.paidOn)}</span>
                              <span className="block truncate text-neutral-500" title={r.paid.reference}>Ref {r.paid.reference}</span>
                            </>
                          ) : (
                            <>
                              <span className={`block font-bold ${late ? "text-rose-700" : daysLeft <= 7 ? "text-amber-700" : "text-neutral-800"}`}>{late ? due.text : daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</span>
                              <span className="block text-neutral-500">{late ? "Penalties may apply" : `Due ${eatDate(`${r.dueOn}T00:00:00+03:00`)}`}</span>
                            </>
                          )}
                        </span>
                      </div>

                      <div className="mt-auto pt-4">
                        {r.paid ? (
                          <button type="button" onClick={() => void undoRemittance(r)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-solid border-neutral-200 bg-white text-xs font-semibold text-neutral-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                            <Undo2 className="h-3.5 w-3.5" /> Undo
                          </button>
                        ) : live ? (
                          <button type="button" onClick={() => setRecording(r)} className={`inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border-0 text-xs font-bold text-white transition ${late ? "bg-rose-600 hover:bg-rose-700" : "bg-[#0b2420] hover:bg-[#12342f]"}`}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Record payment
                          </button>
                        ) : (
                          <p className="m-0 rounded-full bg-neutral-100 py-2 text-center text-[11px] font-semibold text-neutral-500">After salaries are paid</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })()}

      {confirmDialog}
      {recording && <RemittanceDialog run={run} item={recording} onClose={() => setRecording(null)} onSaved={() => { setRecording(null); detail.reload(); onChanged(); }} />}
      {adjusting && <AdjustDialog runId={runId} payslip={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); detail.reload(); onChanged(); }} />}
      {paying && <PayDialog run={run} onClose={() => setPaying(false)} onPaid={() => { setPaying(false); detail.reload(); onChanged(); }} />}
      {viewer && (
        <DocumentViewer
          open
          title={viewer.title}
          subtitle={run.runNumber}
          html={payslipsHtml(run, viewer.lines)}
          filename={viewer.lines.length === 1 ? `${viewer.lines[0].payslipNumber}.pdf` : `${run.runNumber}-payslips.pdf`}
          pdfFormat="a5"
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

// ── Dialogs ────────────────────────────────────────────────────────────

function RemittanceDialog({ run, item, onClose, onSaved }: { run: Run; item: Remittance; onClose: () => void; onSaved: () => void }) {
  const [paidOn, setPaidOn] = useState(eatTodayIso());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = paidOn > item.dueOn;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/runs/${run.id}/remittances/${item.key}`, { method: "POST", body: JSON.stringify({ paidOn, reference: reference.trim(), note: note.trim() || null }) });
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Not recorded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell
      title={`${item.label} paid to ${item.payee}`}
      subtitle={`${monthLabel(run.periodMonth)} payroll, due by ${eatDate(`${item.dueOn}T00:00:00+03:00`)}`}
      busy={busy}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancel</button><button type="button" onClick={() => void save()} disabled={busy || reference.trim().length < 3} className={primaryButton}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Record payment</button></>}
    >
      <div className="rounded-xl bg-neutral-50 px-4 py-3">
        <p className="m-0 text-[11px] text-neutral-500">Amount</p>
        <p className="m-0 mt-0.5 text-2xl font-bold tabular-nums text-neutral-900">{tzs(item.amount)}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Paid on</span>
          <DateField value={paidOn} onChange={(v) => setPaidOn(v || eatTodayIso())} max={eatTodayIso()} ariaLabel="Paid on" className="mt-1 h-10 rounded-lg border border-solid border-neutral-300 bg-white" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Receipt or control number</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="e.g. 991234567890" className={`${fieldClass} mt-1`} autoFocus />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional" className={`${fieldClass} mt-1`} />
      </label>
      {late ? <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">This is after the due date, so {item.payee} may charge a penalty. Keep their penalty notice with the receipt.</p> : null}
      {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">{error}</p>}
    </Shell>
  );
}

const moneyText = (raw: string) => {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString("en-US") : "";
};
const moneyValue = (v: string) => Number(v.replace(/,/g, "")) || 0;

function Shell({ title, subtitle, busy, onClose, children, footer }: { title: string; subtitle: string; busy: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title} onClick={() => !busy && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><CalendarCheck2 className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-neutral-900">{title}</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-0 border-t border-solid border-neutral-200 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

function NewRunDialog({ initialMonth, onClose, onCreated }: { initialMonth: string; onClose: () => void; onCreated: (id: number) => void }) {
  const [month, setMonth] = useState(initialMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const json = await financeFetch<{ run: Run }>("/api/admin/finance/payroll/runs", { method: "POST", body: JSON.stringify({ periodMonth: month }) });
      onCreated(json.run.id);
    } catch (err: any) {
      setError(err?.message || "The pay run was not created.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell
      title="New pay run"
      subtitle="Everyone on the payroll that month is added with their current pay. You can adjust each payslip before approving."
      busy={busy}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancel</button><button type="button" onClick={() => void create()} disabled={busy || !month} className={primaryButton}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Build {month ? monthLabel(month) : "run"}</button></>}
    >
      <label className="block">
        <span className={sectionLabel}>Pay month</span>
        <MonthField value={month} onChange={setMonth} ariaLabel="Pay month" className="mt-2 h-10 rounded-lg border border-solid border-neutral-300 bg-white" />
      </label>
      {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">{error}</p>}
    </Shell>
  );
}

function AdjustDialog({ runId, payslip, onClose, onSaved }: { runId: number; payslip: Payslip; onClose: () => void; onSaved: () => void }) {
  const fmt = (v: number) => (v ? Math.round(v).toLocaleString("en-US") : "");
  const [form, setForm] = useState({ overtime: fmt(payslip.overtime), bonus: fmt(payslip.bonus), loanDeduction: fmt(payslip.loanDeduction), otherDeductions: fmt(payslip.otherDeductions), note: payslip.note ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/runs/${runId}/payslips/${payslip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ overtime: moneyValue(form.overtime), bonus: moneyValue(form.bonus), loanDeduction: moneyValue(form.loanDeduction), otherDeductions: moneyValue(form.otherDeductions), note: form.note.trim() || null }),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Not saved.");
    } finally {
      setBusy(false);
    }
  }
  const input = (key: "overtime" | "bonus" | "loanDeduction" | "otherDeductions", label: string) => (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">TZS</span>
        <input value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: moneyText(e.target.value) }))} inputMode="numeric" placeholder="0" className={`${fieldClass} pl-12 text-right tabular-nums`} />
      </div>
    </label>
  );
  return (
    <Shell
      title={`Adjust ${payslip.employee.fullName}`}
      subtitle="This month only. NSSF and PAYE are recalculated when you save."
      busy={busy}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancel</button><button type="button" onClick={() => void save()} disabled={busy} className={primaryButton}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Save and recalculate</button></>}
    >
      <div>
        <p className={sectionLabel}>Add to pay</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">{input("overtime", "Overtime")}{input("bonus", "Bonus")}</div>
      </div>
      <div>
        <p className={sectionLabel}>Deduct</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">{input("loanDeduction", "Loan or salary advance")}{input("otherDeductions", "Other, e.g. unpaid days")}</div>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Note on the payslip</span>
        <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={300} placeholder="e.g. 12 hours overtime, advance repayment 2 of 4" className={`${fieldClass} mt-1`} />
      </label>
      <p className="m-0 text-[11px] text-neutral-500">Currently: gross {tzs(payslip.gross)}, net {tzs(payslip.net)}.</p>
      {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">{error}</p>}
    </Shell>
  );
}

function PayDialog({ run, onClose, onPaid }: { run: Run; onClose: () => void; onPaid: () => void }) {
  const [payDate, setPayDate] = useState(eatTodayIso());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/runs/${run.id}/pay`, { method: "POST", body: JSON.stringify({ payDate, paymentReference: reference.trim() || null }) });
      onPaid();
    } catch (err: any) {
      setError(err?.message || "Not saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell
      title={`Mark ${monthLabel(run.periodMonth)} as paid`}
      subtitle="Record this after the salaries have left the bank. It cannot be undone."
      busy={busy}
      onClose={onClose}
      footer={<><button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancel</button><button type="button" onClick={() => void pay()} disabled={busy || !payDate} className={primaryButton}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />} Mark as paid</button></>}
    >
      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200">
        <div className="bg-white px-3 py-2.5"><dt className="text-[11px] text-neutral-500">Net pay to staff</dt><dd className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{tzs(run.net)}</dd></div>
        <div className="bg-white px-3 py-2.5"><dt className="text-[11px] text-neutral-500">Booked as staff cost</dt><dd className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{tzs(run.employerCost)}</dd></div>
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Pay date</span>
          <DateField value={payDate} onChange={(v) => setPayDate(v || eatTodayIso())} max={eatTodayIso()} ariaLabel="Pay date" className="mt-1 h-10 rounded-lg border border-solid border-neutral-300 bg-white" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Bank or batch reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Optional" className={`${fieldClass} mt-1`} />
        </label>
      </div>
      <p className="m-0 flex items-start gap-2 rounded-lg bg-[#02665e]/[0.06] px-3 py-2 text-xs text-neutral-700"><RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" /> The staff cost is booked to {monthLabel(run.periodMonth)} in the expense ledger, so that month&apos;s net margin includes it.</p>
      {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">{error}</p>}
    </Shell>
  );
}
