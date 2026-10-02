"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  HeartPulse,
  IdCard,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  ShieldCheck,
  Smartphone,
  UserX,
  X,
} from "lucide-react";
import DocumentViewer from "@/components/admin/DocumentViewer";
import { DateField, LockedCard, eatDate, eatTodayIso, financeFetch, monthLabel, primaryButton, secondaryButton, tzs, useFinanceData } from "../../_shared";
import { previewPayslip, type PayrollRates } from "../_payroll";
import { payslipsHtml, type PayslipLine } from "../runs/payslipDocument";

/**
 * One employee's record: who they are, what they cost, where their salary
 * goes, and every payslip. Sensitive numbers are masked until revealed.
 */

export type ProfileEmployee = {
  id: number;
  employeeNo: string;
  fullName: string;
  jobTitle: string;
  department: string | null;
  employmentType: string;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
  startDate: string;
  endDate: string | null;
  phone: string | null;
  email: string | null;
  basicSalary: number;
  allowances: number;
  currency: string;
  paymentMethod: string;
  missing: string[];
  nationalId: string | null;
  tin: string | null;
  nssfNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  nssfEnrolled: boolean;
  payeExempt: boolean;
  heslbDeduct?: boolean;
  heslbIndexNumber?: string | null;
  payDetailsPendingSince?: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  mobileMoneyProvider: string | null;
  mobileMoneyNumber: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
};
type ProfileResponse = {
  employee: ProfileEmployee;
  payslips: Array<{ id: number; runId: number; payslipNumber: string; periodMonth: string; runStatus: string; gross: number; net: number; paye: number }>;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Active", tone: "" },
  ON_LEAVE: { label: "On leave", tone: "" },
  TERMINATED: { label: "Former employee", tone: "" },
};
const TYPE_LABEL: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", CASUAL: "Casual", INTERN: "Intern" };

/** "LEONIDAS JAMES" -> "Leonidas James", for display only; the record keeps the name as entered. */
const displayName = (name: string) => (name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase()) : name);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
const mask = (value: string) => (value.length <= 4 ? value : `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`);

/** Whole months and years between two dates, e.g. "1 year 3 months". */
function span(fromIso: string, toIso: string) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y && !m) return "Less than a month";
  return [y ? `${y} year${y === 1 ? "" : "s"}` : "", m ? `${m} month${m === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ");
}

export default function EmployeeProfile({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (e: ProfileEmployee) => void; onChanged: () => void }) {
  const detail = useFinanceData<ProfileResponse>(`/api/admin/finance/payroll/employees/${id}`);
  const settings = useFinanceData<{ rates: PayrollRates }>("/api/admin/finance/payroll/settings");
  const [tab, setTab] = useState<"overview" | "pay" | "payslips">("overview");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [endDate, setEndDate] = useState(eatTodayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slip, setSlip] = useState<{ title: string; html: string; filename: string } | null>(null);
  const [slipLoading, setSlipLoading] = useState<number | null>(null);

  const e = detail.data?.employee;
  const gross = e ? e.basicSalary + e.allowances : 0;
  const pay = useMemo(
    () => (e && settings.data ? previewPayslip({ basic: e.basicSalary, allowances: e.allowances, nssfEnrolled: e.nssfEnrolled, payeExempt: e.payeExempt, heslbDeduct: e.heslbDeduct, sdlApplies: false }, settings.data.rates) : null),
    [e, settings.data],
  );

  async function confirmPayAccount() {
    setBusy(true);
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/employees/${id}/confirm-pay-details`, { method: "POST" });
      detail.reload();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "ACTIVE" | "ON_LEAVE" | "TERMINATED") {
    setBusy(true);
    setError(null);
    try {
      await financeFetch(`/api/admin/finance/payroll/employees/${id}`, { method: "PATCH", body: JSON.stringify({ status, endDate: status === "TERMINATED" ? endDate : null }) });
      setEnding(false);
      detail.reload();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function openPayslip(p: ProfileResponse["payslips"][number]) {
    setSlipLoading(p.id);
    try {
      const run = await financeFetch<{ run: { runNumber: string; periodMonth: string; status: string; payDate: string | null; paymentReference: string | null }; payslips: Array<PayslipLine & { id: number }> }>(`/api/admin/finance/payroll/runs/${p.runId}`);
      const line = run.payslips.find((l) => l.id === p.id);
      if (line) setSlip({ title: `Payslip, ${monthLabel(p.periodMonth)}`, html: payslipsHtml(run.run, [line]), filename: `${p.payslipNumber}.pdf` });
    } catch (err: any) {
      setError(err?.message || "Could not open the payslip.");
    } finally {
      setSlipLoading(null);
    }
  }

  const copy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => { setCopied(key); window.setTimeout(() => setCopied(null), 1400); });
  };

  /** An identity tile: masked by default, reveal and copy, or an "Add" prompt. */
  const idTile = (key: string, label: string, value: string | null, icon: typeof IdCard, sensitive = true, note?: string) => {
    const Icon = icon;
    if (!value) {
      return (
        <button type="button" onClick={() => e && onEdit(e)} className="flex min-w-0 items-start gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-3.5 text-left hover:bg-amber-50">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Icon className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-amber-800">{label}</span>
            <span className="block text-sm font-semibold text-amber-900">Add it</span>
            <span className="block text-[11px] text-amber-700">Needed for the returns</span>
          </span>
        </button>
      );
    }
    const shown = !sensitive || revealed[key];
    return (
      <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-neutral-500">{label}</span>
          <span className="block truncate font-mono text-sm font-semibold tracking-wide text-neutral-900">{shown ? value : mask(value)}</span>
          {note ? <span className="block text-[11px] text-neutral-500">{note}</span> : null}
        </span>
        <span className="flex shrink-0 gap-0.5">
          {sensitive ? (
            <button type="button" onClick={() => setRevealed((r) => ({ ...r, [key]: !r[key] }))} aria-label={shown ? `Hide ${label}` : `Show ${label}`} className="grid h-7 w-7 place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
              {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <button type="button" onClick={() => copy(key, value)} aria-label={`Copy ${label}`} className="grid h-7 w-7 place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            {copied === key ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </span>
      </div>
    );
  };

  const today = eatTodayIso();
  const whatsapp = e?.phone ? `https://wa.me/${e.phone.replace(/[^\d]/g, "")}` : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/40 p-3 backdrop-blur-[2px] sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Employee record">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[#f6f7f6] shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        {detail.locked ? <div className="p-6"><LockedCard what="This record" /></div> : !e ? (
          <div className="grid min-h-[320px] flex-1 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>
        ) : (
          <>
            {/* Title */}
            <div className="flex shrink-0 items-center gap-3 bg-white px-5 pb-1 pt-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-sm font-bold text-[#02665e]">{initials(e.fullName)}</span>
              <div className="min-w-0 flex-1">
                <p className="m-0 flex items-center gap-2 truncate text-base font-bold text-neutral-900" title={e.fullName}>
                  {displayName(e.fullName)}
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : e.status === "ON_LEAVE" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>{STATUS[e.status].label}</span>
                </p>
                <p className="m-0 truncate text-xs text-neutral-500">{e.employeeNo} · {e.jobTitle}{e.department ? ` · ${e.department}` : ""} · {TYPE_LABEL[e.employmentType] ?? e.employmentType}</p>
              </div>
              <button type="button" onClick={() => onEdit(e)} className={secondaryButton}><Pencil className="h-3.5 w-3.5" /> Edit</button>
              <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"><X className="h-4 w-4" /></button>
            </div>

            {/* Tabs */}
            <nav className="flex shrink-0 gap-6 border-0 border-b border-solid border-neutral-200 bg-white px-5" role="tablist">
              {([["overview", "Overview"], ["pay", "Pay"], ["payslips", `Payslips${detail.data?.payslips.length ? ` (${detail.data.payslips.length})` : ""}`]] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px border-0 border-b-2 border-solid bg-transparent px-0 py-3 text-sm font-semibold ${tab === key ? "border-[#02665e] text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {e.payDetailsPendingSince ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-bold text-rose-900">New pay account waiting for confirmation</p>
                    <p className="m-0 mt-0.5 text-xs text-rose-800">Changed {eatDate(e.payDetailsPendingSince)}. Their pay cannot be approved or paid until an admin other than the one who changed it checks the account with them and confirms it.</p>
                    {error ? <p className="m-0 mt-1.5 text-xs font-bold text-rose-700">{error}</p> : null}
                  </div>
                  <button type="button" onClick={() => void confirmPayAccount()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-full border-0 bg-rose-600 px-4 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} I checked it, confirm
                  </button>
                </div>
              ) : null}
              {tab === "overview" && (
                <>
                  {/* At a glance */}
                  <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
                    {[
                      { label: "Monthly gross", value: tzs(gross, e.currency) },
                      { label: "Take-home", value: pay ? tzs(pay.net) : "..." },
                      { label: e.status === "TERMINATED" ? "Served" : "With NoLSAF", value: span(e.startDate, e.endDate ?? `${today}T12:00:00+03:00`) },
                    ].map((f, i) => (
                      <div key={f.label} className={`min-w-0 px-4 py-3.5 ${i ? "border-0 border-l border-solid border-neutral-200" : ""}`}>
                        <p className="m-0 text-[11px] font-semibold text-neutral-500">{f.label}</p>
                        <p className="m-0 mt-1 truncate text-base font-bold tabular-nums text-neutral-900">{f.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Identity and tax */}
                  <section>
                    <h3 className="m-0 mb-2 text-sm font-bold text-neutral-900">Identity and tax</h3>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {idTile("nida", "NIDA number", e.nationalId, IdCard)}
                      {idTile("tin", "TRA TIN", e.tin, BadgeCheck)}
                      {e.nssfEnrolled ? idTile("nssf", "NSSF membership", e.nssfNumber, ShieldCheck) : (
                        <div className="flex items-start gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-3.5">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-500"><ShieldCheck className="h-4 w-4" /></span>
                          <span><span className="block text-[11px] font-semibold text-neutral-500">NSSF membership</span><span className="block text-sm font-semibold text-neutral-900">Not enrolled</span></span>
                        </div>
                      )}
                      <div className="flex items-start gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-3.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><Banknote className="h-4 w-4" /></span>
                        <span><span className="block text-[11px] font-semibold text-neutral-500">PAYE</span><span className="block text-sm font-semibold text-neutral-900">{e.payeExempt ? "Exempt" : "Deducted monthly"}</span></span>
                      </div>
                    </div>
                  </section>

                  {/* Employment */}
                  <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-4">
                    <h3 className="m-0 text-sm font-bold text-neutral-900">Employment</h3>
                    <ol className="m-0 mt-3 list-none space-y-3 p-0">
                      <li className="flex items-start gap-3">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#02665e]" />
                        <span><span className="block text-sm font-semibold text-neutral-900">Joined {eatDate(e.startDate)}</span><span className="block text-xs text-neutral-500">{TYPE_LABEL[e.employmentType] ?? e.employmentType}, {e.jobTitle}</span></span>
                      </li>
                      {e.status === "ON_LEAVE" ? (
                        <li className="flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" /><span className="text-sm font-semibold text-neutral-900">On leave now, still on the payroll</span></li>
                      ) : null}
                      {e.endDate ? (
                        <li className="flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-400" /><span className="text-sm font-semibold text-neutral-900">Left {eatDate(e.endDate)}</span></li>
                      ) : null}
                    </ol>

                    {e.status === "TERMINATED" ? (
                      <button type="button" onClick={() => void setStatus("ACTIVE")} disabled={busy} className={`${secondaryButton} mt-4`}><CheckCircle2 className="h-3.5 w-3.5" /> Rehire</button>
                    ) : ending ? (
                      <div className="mt-4 space-y-2 rounded-xl bg-rose-50/60 p-3">
                        <p className="m-0 text-xs font-semibold text-rose-900">Last working day</p>
                        <DateField value={endDate} onChange={(v) => setEndDate(v || today)} ariaLabel="Last working day" className="h-10 rounded-lg border border-solid border-neutral-300 bg-white" />
                        <p className="m-0 text-[11px] text-neutral-600">They are paid for that month, then drop off the payroll. Payslips stay on record.</p>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEnding(false)} disabled={busy} className={secondaryButton}>Keep employed</button>
                          <button type="button" onClick={() => void setStatus("TERMINATED")} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />} End employment</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void setStatus(e.status === "ACTIVE" ? "ON_LEAVE" : "ACTIVE")} disabled={busy} className={secondaryButton}>{e.status === "ACTIVE" ? "Mark on leave" : "Back from leave"}</button>
                        <button type="button" onClick={() => setEnding(true)} className={`${secondaryButton} text-rose-700`}><UserX className="h-3.5 w-3.5" /> End employment</button>
                      </div>
                    )}
                  </section>

                  {/* Personal */}
                  <section className="grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-2xl border border-solid border-neutral-200 bg-white p-4">
                      <h3 className="m-0 text-sm font-bold text-neutral-900">Personal</h3>
                      <ul className="m-0 mt-3 list-none space-y-2.5 p-0 text-sm">
                        <li className="flex items-center gap-2.5 text-neutral-700"><CalendarDays className="h-4 w-4 shrink-0 text-neutral-400" />{e.dateOfBirth ? `${eatDate(e.dateOfBirth)} · ${span(e.dateOfBirth, `${today}T12:00:00+03:00`).split(" ").slice(0, 2).join(" ")} old` : <span className="text-neutral-400">Date of birth not recorded</span>}</li>
                        <li className="flex items-center gap-2.5 text-neutral-700"><Phone className="h-4 w-4 shrink-0 text-neutral-400" />{e.phone || <span className="text-neutral-400">No phone</span>}</li>
                        <li className="flex items-center gap-2.5 text-neutral-700"><Mail className="h-4 w-4 shrink-0 text-neutral-400" /><span className="truncate">{e.email || <span className="text-neutral-400">No email</span>}</span></li>
                        <li className="flex items-start gap-2.5 text-neutral-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />{e.address || <span className="text-neutral-400">No address</span>}</li>
                      </ul>
                      {e.phone || e.email ? (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-0 border-t border-solid border-neutral-100 pt-3">
                          {e.phone ? <a href={`tel:${e.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#02665e]/10 px-2.5 text-xs font-semibold text-[#02665e] no-underline hover:bg-[#02665e]/15 hover:no-underline"><Phone className="h-3.5 w-3.5" /> Call</a> : null}
                          {whatsapp ? <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#02665e]/10 px-2.5 text-xs font-semibold text-[#02665e] no-underline hover:bg-[#02665e]/15 hover:no-underline"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a> : null}
                          {e.email ? <a href={`mailto:${e.email}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#02665e]/10 px-2.5 text-xs font-semibold text-[#02665e] no-underline hover:bg-[#02665e]/15 hover:no-underline"><Mail className="h-3.5 w-3.5" /> Email</a> : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-solid border-neutral-200 bg-white p-4">
                      <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><HeartPulse className="h-4 w-4 text-rose-500" /> In an emergency</h3>
                      {e.emergencyContactName || e.emergencyContactPhone ? (
                        <>
                          <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">{e.emergencyContactName || "Contact"}</p>
                          {e.emergencyContactPhone ? <a href={`tel:${e.emergencyContactPhone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-[#02665e] no-underline hover:underline"><Phone className="h-3.5 w-3.5" /> {e.emergencyContactPhone}</a> : null}
                        </>
                      ) : <button type="button" onClick={() => onEdit(e)} className="mt-3 border-0 bg-transparent p-0 text-sm font-semibold text-amber-700 hover:underline">Add an emergency contact</button>}
                      {e.notes ? <p className="m-0 mt-3 whitespace-pre-line border-0 border-t border-solid border-neutral-100 pt-3 text-xs text-neutral-600">{e.notes}</p> : null}
                    </div>
                  </section>
                </>
              )}

              {tab === "pay" && (
                <>
                  {/* Where the money goes */}
                  <div className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
                    <div className="grid grid-cols-2 gap-px bg-neutral-200">
                      <div className="bg-white px-4 py-4">
                        <p className="m-0 text-[11px] font-semibold text-neutral-500">Take-home each month</p>
                        <p className="m-0 mt-1 text-2xl font-bold tabular-nums text-[#02665e]">{pay ? tzs(pay.net) : "..."}</p>
                      </div>
                      <div className="bg-white px-4 py-4">
                        <p className="m-0 text-[11px] font-semibold text-neutral-500">Cost to NoLSAF</p>
                        <p className="m-0 mt-1 text-2xl font-bold tabular-nums text-neutral-900">{pay ? tzs(pay.employerCost) : "..."}</p>
                        <p className="m-0 text-[11px] text-neutral-500">before SDL, which depends on headcount</p>
                      </div>
                    </div>
                    {pay ? (
                      <div className="px-4 py-3.5">
                        <span className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
                          <span className="h-full bg-[#02665e]" style={{ width: `${(pay.net / pay.employerCost) * 100}%` }} title="Take-home" />
                          <span className="h-full bg-amber-400" style={{ width: `${(pay.paye / pay.employerCost) * 100}%` }} title="PAYE" />
                          <span className="h-full bg-sky-500" style={{ width: `${((pay.nssfEmployee + pay.nssfEmployer) / pay.employerCost) * 100}%` }} title="NSSF" />
                          <span className="h-full bg-neutral-400" style={{ width: `${(pay.wcf / pay.employerCost) * 100}%` }} title="WCF" />
                        </span>
                        <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-600">
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#02665e]" /> Take-home {tzs(pay.net)}</span>
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> PAYE {tzs(pay.paye)}</span>
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> NSSF {tzs(pay.nssfEmployee + pay.nssfEmployer)}</span>
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-neutral-400" /> WCF {tzs(pay.wcf)}</span>
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {/* Gross build-up */}
                  <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-4">
                    <h3 className="m-0 text-sm font-bold text-neutral-900">Monthly gross</h3>
                    <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
                      {[
                        ["Basic salary", e.basicSalary],
                        ["Housing allowance", e.housingAllowance],
                        ["Transport allowance", e.transportAllowance],
                        ["Other allowance", e.otherAllowance],
                      ].filter(([, v], i) => i === 0 || Number(v) > 0).map(([label, v]) => (
                        <li key={label as string}>
                          <div className="flex items-center justify-between text-sm"><span className="text-neutral-700">{label}</span><span className="font-semibold tabular-nums text-neutral-900">{tzs(Number(v))}</span></div>
                          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-neutral-100"><span className="block h-full rounded-full bg-[#02665e]/70" style={{ width: `${gross ? (Number(v) / gross) * 100 : 0}%` }} /></span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center justify-between border-0 border-t border-solid border-neutral-200 pt-3 text-sm font-bold text-neutral-900"><span>Gross</span><span className="tabular-nums">{tzs(gross, e.currency)}</span></div>
                  </section>

                  {/* Pay account */}
                  <section>
                    <h3 className="m-0 mb-2 text-sm font-bold text-neutral-900">Salary is paid to</h3>
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b2420] to-[#02665e] p-5 text-white shadow-lg">
                      <div className="flex items-start justify-between">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">{e.paymentMethod === "BANK" ? <Landmark className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}</span>
                        <button type="button" onClick={() => setRevealed((r) => ({ ...r, account: !r.account }))} className="inline-flex items-center gap-1 rounded-full border-0 bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/25">
                          {revealed.account ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {revealed.account ? "Hide" : "Show"}
                        </button>
                      </div>
                      {e.paymentMethod === "BANK" ? (
                        <>
                          <p className="m-0 mt-5 font-mono text-lg tracking-[0.15em]">{e.bankAccountNumber ? (revealed.account ? e.bankAccountNumber : mask(e.bankAccountNumber)) : "No account number"}</p>
                          <div className="mt-3 flex items-end justify-between gap-3 text-xs">
                            <span><span className="block text-white/55">Account name</span><span className="block font-semibold">{e.bankAccountName || displayName(e.fullName)}</span></span>
                            <span className="text-right"><span className="block font-semibold">{e.bankName || "Bank"}</span><span className="block text-white/55">{e.bankBranch || "Branch not recorded"}</span></span>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="m-0 mt-5 font-mono text-lg tracking-[0.15em]">{e.mobileMoneyNumber ? (revealed.account ? e.mobileMoneyNumber : mask(e.mobileMoneyNumber)) : "No number"}</p>
                          <p className="m-0 mt-3 text-xs font-semibold">{e.mobileMoneyProvider || "Mobile money"}</p>
                        </>
                      )}
                    </div>
                  </section>
                </>
              )}

              {tab === "payslips" && (
                detail.data?.payslips.length ? (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {detail.data.payslips.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => void openPayslip(p)} className="flex w-full items-center gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-3.5 text-left hover:border-neutral-300 hover:bg-neutral-50">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#02665e]/10 text-[#02665e]">{slipLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-neutral-900">{monthLabel(p.periodMonth)}</span>
                            <span className="block text-[11px] text-neutral-500">{p.payslipNumber} · {p.runStatus === "PAID" ? "paid" : p.runStatus.toLowerCase()}</span>
                          </span>
                          <span className="text-right">
                            <span className="block text-sm font-bold tabular-nums text-neutral-900">{tzs(p.net)}</span>
                            <span className="block text-[11px] tabular-nums text-neutral-500">gross {tzs(p.gross)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
                    <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-neutral-100 text-neutral-400"><FileText className="h-5 w-5" /></span>
                    <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">No payslips yet</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-500">They appear here once a pay run includes {displayName(e.fullName).split(" ")[0]}.</p>
                  </div>
                )
              )}

              {e.missing.length > 0 && e.status !== "TERMINATED" ? (
                <div className="flex items-center gap-3 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <p className="m-0 flex-1 text-xs text-amber-900">Missing for the returns: <span className="font-semibold">{e.missing.join(", ")}</span></p>
                  <button type="button" onClick={() => onEdit(e)} className={primaryButton}>Complete</button>
                </div>
              ) : null}
              {error && <p className="m-0 rounded-xl bg-rose-50 px-4 py-2.5 text-xs text-rose-800">{error}</p>}
            </div>
          </>
        )}
      </div>

      {slip && <DocumentViewer open title={slip.title} subtitle={e?.employeeNo} html={slip.html} filename={slip.filename} pdfFormat="a5" onClose={() => setSlip(null)} />}
    </div>
  );
}
