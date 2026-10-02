"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, BriefcaseBusiness, CheckCircle2, ChevronDown, IdCard, Landmark, Loader2, Plus, Search, Smartphone, UserRound, Users, X } from "lucide-react";
import {
  DateField,
  LockedCard,
  cardClass,
  compactTzs,
  eatDate,
  eatTodayIso,
  fieldClass,
  financeFetch,
  primaryButton,
  secondaryButton,
  tzs,
  useFinanceData,
} from "../../_shared";
import { previewPayslip, type PayrollRates } from "../_payroll";
import EmployeeProfile from "./EmployeeProfile";

/**
 * The staff register for payroll: everyone NoLSAF pays, with the identity,
 * tax, NSSF and pay-account details a payslip and the statutory returns need.
 * Employees are never deleted; ending employment keeps their payslips.
 */

type EmployeeRow = {
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
  payTo: string;
  missing: string[];
  heslbDeduct?: boolean;
  payDetailsPending?: boolean;
};
type EmployeeDetail = EmployeeRow & {
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
  heslbIndexNumber: string | null;
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
type ListResponse = { items: EmployeeRow[]; counts: Record<string, number>; monthlyGross: number };

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "", label: "Everyone" },
  { key: "ACTIVE", label: "Active" },
  { key: "ON_LEAVE", label: "On leave" },
  { key: "TERMINATED", label: "Former" },
];
const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ON_LEAVE: "bg-amber-50 text-amber-700 ring-amber-200",
  TERMINATED: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", ON_LEAVE: "On leave", TERMINATED: "Former" };
const TYPE_LABEL: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", CASUAL: "Casual", INTERN: "Intern" };
const BANKS = ["CRDB Bank", "NMB Bank", "NBC Bank", "Stanbic Bank", "Exim Bank", "Absa Bank", "Equity Bank", "DTB", "Azania Bank", "KCB Bank"];
const WALLETS = ["M-Pesa", "Mixx by Yas", "Airtel Money", "HaloPesa"];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

export default function EmployeesPage() {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EmployeeDetail | "new" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (search) params.set("q", search);
  const list = useFinanceData<ListResponse>(`/api/admin/finance/payroll/employees?${params.toString()}`);
  const settings = useFinanceData<{ rates: PayrollRates }>("/api/admin/finance/payroll/settings");
  const board = useFinanceData<ListResponse>("/api/admin/finance/payroll/employees");

  const team = useMemo(() => (board.data?.items ?? []).filter((e) => e.status !== "TERMINATED"), [board.data]);
  const departments = useMemo(() => {
    const map = new Map<string, number>();
    team.forEach((e) => { const d = e.department || "No department"; map.set(d, (map.get(d) ?? 0) + 1); });
    return [...map.entries()].sort((x, y) => y[1] - x[1]);
  }, [team]);
  const basicTotal = team.reduce((sum, e) => sum + e.basicSalary, 0);
  const allowanceTotal = team.reduce((sum, e) => sum + e.allowances, 0);
  const grossTotal = basicTotal + allowanceTotal;

  if (list.locked) return <LockedCard what="Payroll" />;

  const counts = board.data?.counts ?? {};
  const onPayroll = (counts.ACTIVE ?? 0) + (counts.ON_LEAVE ?? 0);
  const incomplete = team.filter((e) => e.missing.length).length;
  const completePct = team.length ? Math.round(((team.length - incomplete) / team.length) * 100) : 100;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Team board */}
      <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#02665e]"><Users className="h-3.5 w-3.5" /> Payroll</span>
            <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight text-neutral-900">Employees</h1>
            <p className="m-0 mt-1 max-w-xl text-sm text-neutral-500">The people NoLSAF pays, with everything their payslips and the statutory returns need.</p>
          </div>
          <button type="button" onClick={() => setEditing("new")} className="inline-flex h-11 items-center gap-2 rounded-full border-0 bg-[#0b2420] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(11,36,32,0.8)] hover:bg-[#12342f]">
            <Plus className="h-4 w-4" /> Register employee
          </button>
        </div>

        <div className="grid gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 md:grid-cols-3">
          {/* The team */}
          <div className="bg-white px-5 py-4 sm:px-6">
            <p className="m-0 text-[11px] font-semibold text-neutral-400">The team</p>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex -space-x-2.5">
                {team.slice(0, 5).map((e) => (
                  <span key={e.id} title={e.fullName} className="grid h-9 w-9 place-items-center rounded-full bg-[#02665e]/10 text-[11px] font-bold text-[#02665e] ring-2 ring-white">{initials(e.fullName)}</span>
                ))}
                {team.length > 5 ? <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-600 ring-2 ring-white">+{team.length - 5}</span> : null}
                {!team.length ? <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-dashed border-neutral-300 text-neutral-300"><Plus className="h-4 w-4" /></span> : null}
              </div>
              <div>
                <p className="m-0 text-2xl font-bold tabular-nums leading-none text-neutral-900">{board.data ? onPayroll : "..."}</p>
                <p className="m-0 mt-1 text-[11px] text-neutral-500">on the payroll{counts.ON_LEAVE ? ` · ${counts.ON_LEAVE} on leave` : ""}{counts.TERMINATED ? ` · ${counts.TERMINATED} former` : ""}</p>
              </div>
            </div>
            {departments.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {departments.slice(0, 4).map(([d, n]) => <span key={d} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{d} <span className="tabular-nums text-neutral-400">{n}</span></span>)}
              </div>
            ) : null}
          </div>

          {/* Pay mix */}
          <div className="bg-white px-5 py-4 sm:px-6">
            <p className="m-0 text-[11px] font-semibold text-neutral-400">Monthly gross</p>
            <p className="m-0 mt-2.5 text-2xl font-bold tabular-nums leading-none text-neutral-900">{board.data ? tzs(board.data.monthlyGross) : "..."}</p>
            <span className="mt-3 flex h-2 overflow-hidden rounded-full bg-neutral-100">
              <span className="h-full bg-[#02665e]" style={{ width: `${grossTotal ? (basicTotal / grossTotal) * 100 : 0}%` }} />
              <span className="h-full bg-emerald-300" style={{ width: `${grossTotal ? (allowanceTotal / grossTotal) * 100 : 0}%` }} />
            </span>
            <p className="m-0 mt-2 flex flex-wrap gap-x-3 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#02665e]" /> Basic {compactTzs(basicTotal)}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-300" /> Allowances {compactTzs(allowanceTotal)}</span>
            </p>
          </div>

          {/* Records */}
          <div className="flex items-center gap-4 bg-white px-5 py-4 sm:px-6">
            <svg viewBox="0 0 36 36" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f0f0f0" strokeWidth="4" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={incomplete ? "#f59e0b" : "#02665e"} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(completePct / 100) * 97.4} 97.4`} />
            </svg>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold text-neutral-400">Records ready for returns</p>
              <p className="m-0 mt-1 text-2xl font-bold tabular-nums leading-none text-neutral-900">{board.data ? `${completePct}%` : "..."}</p>
              <p className={`m-0 mt-1 text-[11px] ${incomplete ? "font-semibold text-amber-700" : "text-neutral-500"}`}>{incomplete ? `${incomplete} missing a TIN, NSSF, NIDA or pay account` : "Every current record is complete"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="flex gap-5" role="tablist">
            {STATUS_TABS.map((t) => (
              <button key={t.key || "all"} type="button" role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={`-mb-3 border-0 border-b-2 border-solid bg-transparent px-0 pb-2.5 text-sm font-semibold ${status === t.key ? "border-[#02665e] text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, number, title or department" aria-label="Search employees" className={`${fieldClass} h-9 pl-9`} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] text-neutral-400">
                <th className="px-4 py-2.5 font-semibold sm:pl-5">Employee</th>
                <th className="px-3 py-2.5 font-semibold">Role</th>
                <th className="px-3 py-2.5 font-semibold">Since</th>
                <th className="px-3 py-2.5 text-right font-semibold">Monthly pay</th>
                <th className="px-3 py-2.5 font-semibold">Paid to</th>
                <th className="px-4 py-2.5 font-semibold sm:pr-5">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && !list.data ? (
                Array.from({ length: 4 }).map((_, i) => <tr key={i} className="border-0 border-t border-solid border-neutral-200"><td colSpan={6} className="px-5 py-4"><div className="h-3 w-3/4 animate-pulse rounded-full bg-neutral-200/80" /></td></tr>)
              ) : !list.data?.items.length ? (
                <tr className="border-0 border-t border-solid border-neutral-200">
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Users className="h-5 w-5" /></span>
                    <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">{search || status ? "No one matches" : "No employees yet"}</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-500">Register staff to run payroll and issue payslips.</p>
                  </td>
                </tr>
              ) : (
                list.data.items.map((e) => (
                  <tr key={e.id} onClick={() => setOpenId(e.id)} className="cursor-pointer border-0 border-t border-solid border-neutral-200 align-top transition-colors hover:bg-neutral-50/80">
                    <td className="px-4 py-3 sm:pl-5">
                      <span className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-xs font-bold text-[#02665e]">{initials(e.fullName)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-neutral-900">{e.fullName}</span>
                          <span className="block text-[11px] text-neutral-400">{e.employeeNo}{e.phone ? ` · ${e.phone}` : ""}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-neutral-800">{e.jobTitle}</span>
                      <span className="block text-[11px] text-neutral-400">{[e.department, TYPE_LABEL[e.employmentType]].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-neutral-600">{eatDate(e.startDate)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className="block font-semibold tabular-nums text-neutral-900">{tzs(e.basicSalary + e.allowances, e.currency)}</span>
                      {e.allowances > 0 ? <span className="block text-[11px] tabular-nums text-neutral-400">{tzs(e.allowances)} allowances</span> : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-neutral-600">{e.payTo}</td>
                    <td className="px-4 py-3 sm:pr-5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_TONE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                      {e.payDetailsPending ? (
                        <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" /> New pay account to confirm</span>
                      ) : null}
                      {e.status !== "TERMINATED" && e.missing.length ? (
                        <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" /> No {e.missing.join(", ")}</span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <EmployeeDialog
          employee={editing === "new" ? null : editing}
          rates={settings.data?.rates ?? null}
          headcount={onPayroll}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); list.reload(); board.reload(); setOpenId(id); }}
        />
      )}
      {openId != null && !editing && (
        <EmployeeProfile
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(e) => setEditing(e as EmployeeDetail)}
          onChanged={() => { list.reload(); board.reload(); }}
        />
      )}
    </div>
  );
}

// ── Register / edit dialog ─────────────────────────────────────────────

type Form = Record<
  | "fullName" | "email" | "phone" | "nationalId" | "tin" | "nssfNumber" | "dateOfBirth" | "gender" | "address"
  | "jobTitle" | "department" | "employmentType" | "startDate"
  | "basicSalary" | "housingAllowance" | "transportAllowance" | "otherAllowance"
  | "paymentMethod" | "bankName" | "bankBranch" | "bankAccountName" | "bankAccountNumber" | "mobileMoneyProvider" | "mobileMoneyNumber"
  | "emergencyContactName" | "emergencyContactPhone" | "notes" | "heslbIndexNumber",
  string
> & { nssfEnrolled: boolean; payeExempt: boolean; heslbDeduct: boolean };

const STEPS = [
  { key: "personal", label: "Personal", hint: "Who they are", icon: UserRound },
  { key: "identity", label: "Identity and tax", hint: "NIDA, TIN, NSSF", icon: IdCard },
  { key: "job", label: "Job", hint: "Role and start", icon: BriefcaseBusiness },
  { key: "pay", label: "Pay", hint: "Salary and allowances", icon: Banknote },
  { key: "payment", label: "Payment", hint: "Where salary goes", icon: Smartphone },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const DEPARTMENTS = ["Operations", "Customer support", "Finance", "Sales and partnerships", "Marketing", "Technology", "Administration"];

const money = (v: string) => Number(String(v).replace(/,/g, "")) || 0;
const moneyInput = (raw: string) => {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString("en-US") : "";
};
/** "0712 345 678" -> "+255712345678". Leaves anything else as typed. */
const tzPhone = (raw: string) => {
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^0[67]\d{8}$/.test(digits)) return `+255${digits.slice(1)}`;
  if (/^255[67]\d{8}$/.test(digits)) return `+${digits}`;
  return raw.trim();
};
/** A NIDA number starts with the holder's date of birth, YYYYMMDD. */
const birthFromNida = (nida: string) => {
  const d = nida.replace(/[^\d]/g, "");
  if (d.length < 8) return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  const year = Number(d.slice(0, 4));
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso && year > 1900 && year < new Date().getUTCFullYear() - 13 ? iso : null;
};

function EmployeeDialog({ employee, rates, headcount, onClose, onSaved }: { employee: EmployeeDetail | null; rates: PayrollRates | null; headcount: number; onClose: () => void; onSaved: (id: number) => void }) {
  const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" }) : "");
  const amount = (v: number | undefined) => (v ? v.toLocaleString("en-US") : "");
  const [form, setForm] = useState<Form>(() => ({
    fullName: employee?.fullName ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    nationalId: employee?.nationalId ?? "",
    tin: employee?.tin ?? "",
    nssfNumber: employee?.nssfNumber ?? "",
    dateOfBirth: day(employee?.dateOfBirth),
    gender: employee?.gender ?? "",
    address: employee?.address ?? "",
    jobTitle: employee?.jobTitle ?? "",
    department: employee?.department ?? "",
    employmentType: employee?.employmentType ?? "PERMANENT",
    startDate: day(employee?.startDate) || eatTodayIso(),
    basicSalary: amount(employee?.basicSalary),
    housingAllowance: amount(employee?.housingAllowance),
    transportAllowance: amount(employee?.transportAllowance),
    otherAllowance: amount(employee?.otherAllowance),
    paymentMethod: employee?.paymentMethod ?? "BANK",
    bankName: employee?.bankName ?? "",
    bankBranch: employee?.bankBranch ?? "",
    bankAccountName: employee?.bankAccountName ?? "",
    bankAccountNumber: employee?.bankAccountNumber ?? "",
    mobileMoneyProvider: employee?.mobileMoneyProvider ?? "",
    mobileMoneyNumber: employee?.mobileMoneyNumber ?? "",
    emergencyContactName: employee?.emergencyContactName ?? "",
    emergencyContactPhone: employee?.emergencyContactPhone ?? "",
    notes: employee?.notes ?? "",
    nssfEnrolled: employee?.nssfEnrolled ?? true,
    payeExempt: employee?.payeExempt ?? false,
    heslbDeduct: employee?.heslbDeduct ?? false,
    heslbIndexNumber: employee?.heslbIndexNumber ?? "",
  }));
  const [step, setStep] = useState<StepKey>("personal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankOther, setBankOther] = useState(() => Boolean(employee?.bankName && !BANKS.includes(employee.bankName)));
  const [deptOther, setDeptOther] = useState(() => Boolean(employee?.department && !DEPARTMENTS.includes(employee.department)));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  // NIDA carries the date of birth: fill it in when it is still empty.
  useEffect(() => {
    if (form.dateOfBirth) return;
    const dob = birthFromNida(form.nationalId);
    if (dob) setForm((f) => ({ ...f, dateOfBirth: dob }));
  }, [form.nationalId, form.dateOfBirth]);

  const gaps: Record<StepKey, string[]> = {
    personal: form.fullName.trim().length < 3 ? ["full name"] : [],
    identity: [],
    job: [...(form.jobTitle.trim().length < 2 ? ["job title"] : []), ...(!form.startDate ? ["start date"] : [])],
    pay: money(form.basicSalary) > 0 ? [] : ["basic salary"],
    payment: form.paymentMethod === "BANK" ? (form.bankAccountNumber.trim() ? [] : ["bank account number"]) : form.mobileMoneyNumber.trim() ? [] : ["mobile money number"],
  };
  const blocking = Object.values(gaps).flat();
  const advisories = [!form.tin.trim() && "TIN", form.nssfEnrolled && !form.nssfNumber.trim() && "NSSF number", !form.nationalId.trim() && "NIDA number"].filter(Boolean) as string[];

  // Completeness of the record, required and recommended fields together.
  const checks = [
    form.fullName.trim().length >= 3, Boolean(form.phone.trim()), Boolean(form.dateOfBirth), Boolean(form.nationalId.trim()), Boolean(form.tin.trim()),
    !form.nssfEnrolled || Boolean(form.nssfNumber.trim()), form.jobTitle.trim().length >= 2, Boolean(form.department.trim()), money(form.basicSalary) > 0,
    form.paymentMethod === "BANK" ? Boolean(form.bankAccountNumber.trim() && form.bankName.trim()) : Boolean(form.mobileMoneyNumber.trim() && form.mobileMoneyProvider.trim()),
    Boolean(form.emergencyContactPhone.trim()),
  ];
  const completeness = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const allowances = money(form.housingAllowance) + money(form.transportAllowance) + money(form.otherAllowance);
  const preview = useMemo(
    () => (rates ? previewPayslip({ basic: money(form.basicSalary), allowances, nssfEnrolled: form.nssfEnrolled, payeExempt: form.payeExempt, heslbDeduct: form.heslbDeduct, sdlApplies: (headcount + (employee ? 0 : 1)) >= rates.sdlMinEmployees }, rates) : null),
    [rates, form.basicSalary, allowances, form.nssfEnrolled, form.payeExempt, form.heslbDeduct, headcount, employee],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const isLast = stepIndex === STEPS.length - 1;

  async function save() {
    if (blocking.length) {
      const first = STEPS.find((s) => gaps[s.key].length);
      if (first) setStep(first.key);
      setError(`Still needed: ${blocking.join(", ")}.`);
      return;
    }
    setSaving(true);
    setError(null);
    const details = {
      ...form,
      phone: tzPhone(form.phone),
      emergencyContactPhone: tzPhone(form.emergencyContactPhone),
      mobileMoneyNumber: tzPhone(form.mobileMoneyNumber),
      bankAccountName: form.paymentMethod === "BANK" ? form.bankAccountName.trim() || form.fullName.trim() : form.bankAccountName,
      gender: form.gender || null,
      basicSalary: money(form.basicSalary),
      housingAllowance: money(form.housingAllowance),
      transportAllowance: money(form.transportAllowance),
      otherAllowance: money(form.otherAllowance),
    };
    try {
      const json = employee
        ? await financeFetch<{ employee: EmployeeDetail }>(`/api/admin/finance/payroll/employees/${employee.id}`, { method: "PATCH", body: JSON.stringify({ details }) })
        : await financeFetch<{ employee: EmployeeDetail }>("/api/admin/finance/payroll/employees", { method: "POST", body: JSON.stringify(details) });
      onSaved(json.employee.id);
    } catch (err: any) {
      setError(err?.message || "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  // ── field builders ──
  const labelText = "text-[12px] font-semibold text-neutral-700";
  const control = "box-border h-11 w-full min-w-0 rounded-xl border border-solid border-neutral-300 bg-white px-3.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10";
  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string } = {}) => {
    const { hint, ...rest } = props;
    return (
      <label className="block min-w-0">
        <span className={labelText}>{label}</span>
        <input value={form[key] as string} onChange={(ev) => set(key, ev.target.value as never)} className={`${control} mt-1.5`} {...rest} />
        {hint ? <span className="mt-1 block text-[11px] text-neutral-400">{hint}</span> : null}
      </label>
    );
  };
  const dateField = (key: "dateOfBirth" | "startDate", label: string, opts: { max?: string; initialView?: string; hint?: string; clearable?: boolean } = {}) => (
    <div className="block min-w-0">
      <span className={labelText}>{label}</span>
      <DateField
        value={form[key]}
        onChange={(v) => set(key, v)}
        max={opts.max}
        initialView={opts.initialView}
        clearable={opts.clearable ?? key === "dateOfBirth"}
        ariaLabel={label}
        className="mt-1.5 h-11 rounded-xl border border-solid border-neutral-300 bg-white transition hover:border-neutral-400"
      />
      {opts.hint ? <span className="mt-1 block text-[11px] text-neutral-400">{opts.hint}</span> : null}
    </div>
  );
  const select = (key: keyof Form, label: string, options: Array<[string, string]>, placeholder: string, onPick?: (v: string) => void) => (
    <label className="block min-w-0">
      <span className={labelText}>{label}</span>
      <div className="relative mt-1.5">
        <select value={form[key] as string} onChange={(ev) => (onPick ? onPick(ev.target.value) : set(key, ev.target.value as never))} className={`${control} cursor-pointer appearance-none bg-none pr-10`}>
          <option value="">{placeholder}</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
      </div>
    </label>
  );
  const moneyField = (key: keyof Form, label: string, big = false) => (
    <label className="block min-w-0">
      <span className={labelText}>{label}</span>
      <div className={`mt-1.5 flex items-center overflow-hidden rounded-xl border border-solid border-neutral-300 bg-white transition hover:border-neutral-400 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-500/10 ${big ? "h-14" : "h-11"}`}>
        <span className="flex h-full items-center border-0 border-r border-solid border-neutral-300 bg-neutral-50 px-3 text-[11px] font-bold text-neutral-500">TZS</span>
        <input value={form[key] as string} onChange={(ev) => set(key, moneyInput(ev.target.value) as never)} inputMode="numeric" placeholder="0" className={`h-full min-w-0 flex-1 border-0 bg-transparent px-3.5 text-right tabular-nums outline-none ${big ? "text-2xl font-bold text-neutral-900" : "text-sm text-neutral-900"}`} />
      </div>
    </label>
  );
  const switchRow = (key: "nssfEnrolled" | "payeExempt" | "heslbDeduct", label: string, help: string) => (
    <button type="button" onClick={() => set(key, !form[key])} aria-pressed={form[key]} className="flex w-full items-center gap-3 rounded-xl border border-solid border-neutral-300 bg-white px-3.5 py-3 text-left hover:border-neutral-400 hover:bg-neutral-50">
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-900">{label}</span><span className="block text-[11px] text-neutral-500">{help}</span></span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${form[key] ? "bg-[#02665e]" : "bg-neutral-300"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form[key] ? "left-[22px]" : "left-0.5"}`} /></span>
    </button>
  );
  const group = (title: string, children: React.ReactNode) => (
    <div className="space-y-3.5">
      <p className="m-0 text-[11px] font-semibold text-neutral-400">{title}</p>
      {children}
    </div>
  );

  const payTo = form.paymentMethod === "BANK"
    ? [form.bankName, form.bankAccountNumber ? `•••${form.bankAccountNumber.slice(-4)}` : ""].filter(Boolean).join(" ")
    : [form.mobileMoneyProvider, form.mobileMoneyNumber ? `•••${form.mobileMoneyNumber.slice(-4)}` : ""].filter(Boolean).join(" ");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/50 p-3 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-label={employee ? "Edit employee" : "Register employee"} onClick={() => !saving && onClose()}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-[0_40px_90px_-30px_rgba(11,36,32,0.6)]" onClick={(ev) => ev.stopPropagation()}>
        {/* Header with step progress */}
        <div className="shrink-0 border-0 border-b border-solid border-neutral-200 px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-lg font-bold tracking-tight text-neutral-900">{employee ? employee.fullName : "New employee"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{employee ? `${employee.employeeNo} · changes apply to pay runs built or refreshed after saving` : "An employee number is assigned when you save"}</p>
            </div>
            <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-0 bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 disabled:opacity-40"><X className="h-4 w-4" /></button>
          </div>
          <ol className="m-0 mt-4 grid list-none grid-cols-5 gap-2 p-0">
            {STEPS.map((s, i) => {
              const on = s.key === step;
              const done = gaps[s.key].length === 0 && i < stepIndex;
              const todo = gaps[s.key].length > 0;
              return (
                <li key={s.key}>
                  <button type="button" onClick={() => setStep(s.key)} aria-current={on ? "step" : undefined} className="group w-full border-0 bg-transparent p-0 text-left">
                    <span className={`block h-1.5 rounded-full transition ${on ? "bg-[#02665e]" : done ? "bg-emerald-300" : "bg-neutral-200 group-hover:bg-neutral-300"}`} />
                    <span className="mt-2 flex items-center gap-1.5">
                      <s.icon className={`h-3.5 w-3.5 shrink-0 ${on ? "text-[#02665e]" : "text-neutral-400"}`} />
                      <span className={`truncate text-xs font-semibold ${on ? "text-neutral-900" : "text-neutral-500"}`}>{s.label}</span>
                      {todo && !on ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="needs details" /> : null}
                    </span>
                    <span className="hidden truncate text-[10px] text-neutral-400 sm:block">{s.hint}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Form */}
          <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
            {step === "personal" && (
              <>
                {group("Name and contact", (
                  <>
                    {field("fullName", "Full name", { maxLength: 150, autoFocus: true, placeholder: "As on the NIDA card" })}
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {field("phone", "Phone", { maxLength: 30, inputMode: "tel", placeholder: "0712 345 678", onBlur: () => set("phone", tzPhone(form.phone)) })}
                      {field("email", "Email", { maxLength: 150, type: "email", placeholder: "name@example.com" })}
                    </div>
                  </>
                ))}
                {group("About", (
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {dateField("dateOfBirth", "Date of birth", { max: eatTodayIso(), initialView: "1995-01-01", hint: form.dateOfBirth && birthFromNida(form.nationalId) === form.dateOfBirth ? "Read from the NIDA number" : undefined })}
                    {select("gender", "Gender", [["FEMALE", "Female"], ["MALE", "Male"], ["OTHER", "Other"]], "Prefer not to say")}
                  </div>
                ))}
                {group("Home and emergency", (
                  <>
                    {field("address", "Home address", { maxLength: 255, placeholder: "Street, area, city" })}
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {field("emergencyContactName", "Emergency contact", { maxLength: 150, placeholder: "Name and relationship" })}
                      {field("emergencyContactPhone", "Their phone", { maxLength: 30, inputMode: "tel", onBlur: () => set("emergencyContactPhone", tzPhone(form.emergencyContactPhone)) })}
                    </div>
                  </>
                ))}
              </>
            )}

            {step === "identity" && (
              <>
                {group("Documents", (
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {field("nationalId", "NIDA number", { maxLength: 30, inputMode: "numeric", placeholder: "20 digits", hint: "Fills in the date of birth" })}
                    {field("tin", "TRA TIN", { maxLength: 20, inputMode: "numeric", placeholder: "9 digits", hint: "Needed for the PAYE return" })}
                  </div>
                ))}
                {group("Statutory deductions", (
                  <>
                    {switchRow("nssfEnrolled", "Member of NSSF", "Deducts the employee share and adds NoLSAF's share each month")}
                    {form.nssfEnrolled && field("nssfNumber", "NSSF membership number", { maxLength: 30, hint: "Needed for the NSSF contribution schedule" })}
                    {switchRow("payeExempt", "Exempt from PAYE", "Only where TRA has confirmed an exemption in writing")}
                    {switchRow("heslbDeduct", "Repays a HESLB student loan", `Deducts ${rates?.heslbPercent ?? 15}% of salary each month and remits it to HESLB`)}
                    {form.heslbDeduct && field("heslbIndexNumber", "HESLB loan index number", { maxLength: 40, placeholder: "e.g. S0123/0045/2015", hint: "The Form IV index number HESLB files the loan under" })}
                  </>
                ))}
              </>
            )}

            {step === "job" && (
              <>
                {group("Role", (
                  <>
                    {field("jobTitle", "Job title", { maxLength: 120, placeholder: "e.g. Customer support lead" })}
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {deptOther
                        ? field("department", "Department", { maxLength: 80, placeholder: "Department name" })
                        : select("department", "Department", [...DEPARTMENTS.map((d): [string, string] => [d, d]), ["__other", "Another department..."]], "Choose a department", (v) => { if (v === "__other") { setDeptOther(true); set("department", ""); } else set("department", v); })}
                      {select("employmentType", "Employment type", Object.entries(TYPE_LABEL), "Choose a type")}
                    </div>
                  </>
                ))}
                {group("Dates and notes", (
                  <>
                    <div className="grid gap-3.5 sm:grid-cols-2">{dateField("startDate", "Start date", { clearable: false })}</div>
                    <label className="block">
                      <span className={labelText}>Notes</span>
                      <textarea value={form.notes} onChange={(ev) => set("notes", ev.target.value)} maxLength={1000} rows={3} placeholder="Contract terms, probation, anything payroll should know" className={`${control} mt-1.5 h-auto resize-y py-2.5`} />
                    </label>
                  </>
                ))}
              </>
            )}

            {step === "pay" && (
              <>
                {group("Monthly salary", moneyField("basicSalary", "Basic salary", true))}
                {group("Regular allowances, every month", (
                  <div className="grid gap-3.5 sm:grid-cols-3">
                    {moneyField("housingAllowance", "Housing")}
                    {moneyField("transportAllowance", "Transport")}
                    {moneyField("otherAllowance", "Other")}
                  </div>
                ))}
                <p className="m-0 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-[11px] text-neutral-500">Overtime, bonuses and loan repayments are added each month inside the pay run, not here.</p>
              </>
            )}

            {step === "payment" && (
              <>
                {employee ? (
                  <p className="m-0 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    Changing where salary goes holds this person&apos;s pay until another admin confirms the new account, and {employee.email ? "emails them about the change" : "they are not emailed because no email is recorded"}.
                  </p>
                ) : null}
                {group("Salary goes to", (
                  <div className="grid grid-cols-2 gap-2">
                    {[["BANK", "Bank account", Landmark], ["MOBILE_MONEY", "Mobile money", Smartphone]].map(([v, l, Icon]) => {
                      const on = form.paymentMethod === v;
                      const I = Icon as typeof Landmark;
                      return (
                        <button key={v as string} type="button" onClick={() => set("paymentMethod", v as string)} className={`flex items-center gap-3 rounded-xl border border-solid px-3.5 py-3 text-left transition ${on ? "border-[#02665e] bg-[#02665e]/[0.05] ring-4 ring-[#02665e]/10" : "border-neutral-300 bg-white hover:border-neutral-400 hover:bg-neutral-50"}`}>
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-[#02665e] text-white" : "bg-neutral-100 text-neutral-500"}`}><I className="h-4 w-4" /></span>
                          <span className="text-sm font-semibold text-neutral-900">{l as string}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {form.paymentMethod === "BANK" ? group("Bank details", (
                  <>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {bankOther
                        ? field("bankName", "Bank", { maxLength: 80, placeholder: "Bank name" })
                        : select("bankName", "Bank", [...BANKS.map((b): [string, string] => [b, b]), ["__other", "Another bank..."]], "Choose a bank", (v) => { if (v === "__other") { setBankOther(true); set("bankName", ""); } else set("bankName", v); })}
                      {field("bankBranch", "Branch", { maxLength: 80, placeholder: "e.g. Samora Avenue" })}
                    </div>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {field("bankAccountNumber", "Account number", { maxLength: 40, inputMode: "numeric" })}
                      {field("bankAccountName", "Account name", { maxLength: 150, placeholder: form.fullName || "As the bank has it", hint: "Leave empty to use the employee's name" })}
                    </div>
                  </>
                )) : group("Mobile money details", (
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {select("mobileMoneyProvider", "Network", WALLETS.map((w): [string, string] => [w, w]), "Choose a network")}
                    {field("mobileMoneyNumber", "Number", { maxLength: 30, inputMode: "tel", placeholder: "0712 345 678", onBlur: () => set("mobileMoneyNumber", tzPhone(form.mobileMoneyNumber)) })}
                  </div>
                ))}
              </>
            )}

            {error && <p className="m-0 rounded-xl border border-solid border-rose-200 bg-rose-50/70 px-3.5 py-2.5 text-xs text-rose-800">{error}</p>}
          </div>

          {/* Live profile */}
          <aside className="hidden min-h-0 overflow-y-auto border-0 border-l border-solid border-neutral-200 bg-neutral-50/70 p-5 lg:block">
            <div className="overflow-hidden rounded-2xl bg-[#0b2420] text-white shadow-lg">
              <div className="relative px-4 pb-4 pt-5">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(16,185,129,0.28)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
                <div className="relative flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-300 text-base font-bold text-[#0b2420]">{initials(form.fullName) || <UserRound className="h-5 w-5" />}</span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-bold">{form.fullName || "Full name"}</p>
                    <p className="m-0 truncate text-[11px] text-white/60">{form.jobTitle || "Job title"}{form.department ? ` · ${form.department}` : ""}</p>
                  </div>
                </div>
                <div className="relative mt-4 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="rounded-full bg-white/10 px-2 py-0.5">{TYPE_LABEL[form.employmentType] ?? "Permanent"}</span>
                  {form.startDate ? <span className="rounded-full bg-white/10 px-2 py-0.5">From {eatDate(`${form.startDate}T00:00:00+03:00`)}</span> : null}
                  {payTo ? <span className="rounded-full bg-white/10 px-2 py-0.5">{payTo}</span> : null}
                </div>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-px bg-white/10">
                {[
                  { label: "Take-home", value: preview ? tzs(preview.net) : "..." },
                  { label: "Cost to NoLSAF", value: preview ? tzs(preview.employerCost) : "..." },
                  { label: "PAYE", value: preview ? tzs(preview.paye) : "..." },
                  { label: "NSSF", value: preview ? tzs(preview.nssfEmployee) : "..." },
                ].map((f) => (
                  <div key={f.label} className="bg-[#0b2420] px-3.5 py-2.5">
                    <dt className="text-[10px] text-white/45">{f.label}</dt>
                    <dd className="m-0 mt-0.5 truncate text-xs font-semibold tabular-nums">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="mt-4 rounded-2xl border border-solid border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="m-0 text-xs font-semibold text-neutral-900">Record complete</p>
                <p className="m-0 text-sm font-bold tabular-nums text-[#02665e]">{completeness}%</p>
              </div>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-neutral-100"><span className="block h-full rounded-full bg-[#02665e] transition-all" style={{ width: `${completeness}%` }} /></span>
              {blocking.length ? (
                <p className="m-0 mt-3 text-[11px] text-neutral-600"><span className="font-semibold text-rose-700">Needed to save:</span> {blocking.join(", ")}</p>
              ) : <p className="m-0 mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Ready to save</p>}
              {advisories.length ? <p className="m-0 mt-1.5 text-[11px] text-neutral-600"><span className="font-semibold text-amber-700">For the returns:</span> {advisories.join(", ")}</p> : null}
            </div>
          </aside>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-6 py-3.5">
          <button type="button" onClick={() => (stepIndex > 0 ? setStep(STEPS[stepIndex - 1].key) : onClose())} disabled={saving} className={secondaryButton}>
            {stepIndex > 0 ? "Back" : "Cancel"}
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-neutral-400 sm:inline">Step {stepIndex + 1} of {STEPS.length}</span>
            {!isLast && (
              <button type="button" onClick={() => setStep(STEPS[stepIndex + 1].key)} className={secondaryButton}>Next: {STEPS[stepIndex + 1].label}</button>
            )}
            <button type="button" onClick={() => void save()} disabled={saving} className={primaryButton}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {employee ? "Save changes" : "Register employee"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
