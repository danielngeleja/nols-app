/**
 * Mainland Tanzania payroll arithmetic for NoLSAF staff.
 *
 * Statutory items per employee per month:
 *   NSSF   employee share (deducted) and employer share (cost), % of gross
 *   PAYE   income tax on gross less the employee's pension contribution,
 *          in monthly bands
 *   WCF    Workers Compensation Fund, employer cost, % of gross
 *   SDL    Skills Development Levy, employer cost, % of gross, only when the
 *          employer has at least `sdlMinEmployees` staff
 *   HESLB  student loan repayment for staff who hold a HESLB loan, % of the
 *          monthly salary (basic plus recurring allowances), deducted after
 *          PAYE and remitted to HESLB
 *
 * Joiners and leavers are paid for the calendar days they were employed in
 * the month (daysPaidIn); salary and allowances are scaled, one-off overtime
 * and bonuses are not.
 *
 * The rates are configurable (systemsetting.payrollSettings) because the
 * Finance Act changes them; DEFAULT_PAYROLL_RATES reflects the bands NoLSAF
 * started with and must be confirmed with the accountant each July. Every pay
 * run stores the rates it used, so a later change never rewrites old payslips.
 * All money is whole TZS.
 */

export type PayeBand = { upTo: number | null; rate: number };

export type PayrollRates = {
  nssfEmployeePercent: number;
  nssfEmployerPercent: number;
  wcfPercent: number;
  sdlPercent: number;
  sdlMinEmployees: number;
  heslbPercent: number;
  /** Monthly bands on taxable pay, lowest first; the last has upTo null. */
  payeBands: PayeBand[];
};

export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  nssfEmployeePercent: 10,
  nssfEmployerPercent: 10,
  wcfPercent: 0.5,
  sdlPercent: 3.5,
  sdlMinEmployees: 10,
  heslbPercent: 15,
  payeBands: [
    { upTo: 270_000, rate: 0 },
    { upTo: 520_000, rate: 8 },
    { upTo: 760_000, rate: 20 },
    { upTo: 1_000_000, rate: 25 },
    { upTo: null, rate: 30 },
  ],
};

const whole = (n: number) => Math.round(Number.isFinite(n) ? n : 0);
const nonNegative = (n: unknown) => Math.max(0, Number(n) || 0);

/** Validates and fills a stored rates object, falling back to the defaults field by field. */
export function normalizeRates(input: unknown): PayrollRates {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<PayrollRates>;
  const pct = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
  };
  const bands = Array.isArray(raw.payeBands) && raw.payeBands.length ? raw.payeBands : DEFAULT_PAYROLL_RATES.payeBands;
  const cleanBands = bands
    .map((b) => ({ upTo: b?.upTo == null ? null : nonNegative(b.upTo), rate: pct(b?.rate, 0) }))
    .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  if (cleanBands[cleanBands.length - 1].upTo != null) cleanBands.push({ upTo: null, rate: cleanBands[cleanBands.length - 1].rate });
  return {
    nssfEmployeePercent: pct(raw.nssfEmployeePercent, DEFAULT_PAYROLL_RATES.nssfEmployeePercent),
    nssfEmployerPercent: pct(raw.nssfEmployerPercent, DEFAULT_PAYROLL_RATES.nssfEmployerPercent),
    wcfPercent: pct(raw.wcfPercent, DEFAULT_PAYROLL_RATES.wcfPercent),
    sdlPercent: pct(raw.sdlPercent, DEFAULT_PAYROLL_RATES.sdlPercent),
    sdlMinEmployees: Math.max(0, Math.floor(Number(raw.sdlMinEmployees ?? DEFAULT_PAYROLL_RATES.sdlMinEmployees) || 0)),
    heslbPercent: pct(raw.heslbPercent, DEFAULT_PAYROLL_RATES.heslbPercent),
    payeBands: cleanBands,
  };
}

/** PAYE on monthly taxable pay, band by band. */
export function payeFor(taxable: number, bands: PayeBand[]): number {
  let tax = 0;
  let lower = 0;
  const income = nonNegative(taxable);
  for (const band of bands) {
    const upper = band.upTo ?? Infinity;
    if (income <= lower) break;
    const slice = Math.min(income, upper) - lower;
    tax += slice * (band.rate / 100);
    lower = upper;
  }
  return whole(tax);
}

export type PayslipInput = {
  basicSalary: number;
  /** Recurring monthly allowances from the employee record. */
  allowances: number;
  /** This month only. */
  overtime?: number;
  bonus?: number;
  /** Loans, salary advances and other agreed deductions, this month only. */
  loanDeduction?: number;
  otherDeductions?: number;
  nssfEnrolled: boolean;
  payeExempt?: boolean;
  heslbDeduct?: boolean;
  /** Part-month pay; leave out for a full month. */
  daysPaid?: number | null;
  periodDays?: number | null;
};

export type PayslipFigures = {
  basicSalary: number;
  allowances: number;
  overtime: number;
  bonus: number;
  gross: number;
  nssfEmployee: number;
  taxable: number;
  paye: number;
  heslb: number;
  loanDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  nssfEmployer: number;
  wcf: number;
  sdl: number;
  employerCost: number;
};

/** One employee's month. `sdlApplies` is decided once per run from the headcount. */
export function computePayslip(input: PayslipInput, rates: PayrollRates, sdlApplies: boolean): PayslipFigures {
  const share = input.daysPaid != null && input.periodDays ? Math.min(1, Math.max(0, input.daysPaid / input.periodDays)) : 1;
  const basicSalary = whole(nonNegative(input.basicSalary) * share);
  const allowances = whole(nonNegative(input.allowances) * share);
  const overtime = whole(nonNegative(input.overtime));
  const bonus = whole(nonNegative(input.bonus));
  const gross = basicSalary + allowances + overtime + bonus;

  const nssfEmployee = input.nssfEnrolled ? whole(gross * (rates.nssfEmployeePercent / 100)) : 0;
  const nssfEmployer = input.nssfEnrolled ? whole(gross * (rates.nssfEmployerPercent / 100)) : 0;
  // The employee's pension contribution is deducted before PAYE.
  const taxable = Math.max(0, gross - nssfEmployee);
  const paye = input.payeExempt ? 0 : payeFor(taxable, rates.payeBands);

  // HESLB is taken from the salary, not from one-off overtime or bonuses.
  const heslb = input.heslbDeduct ? whole((basicSalary + allowances) * (rates.heslbPercent / 100)) : 0;
  const loanDeduction = whole(nonNegative(input.loanDeduction));
  const otherDeductions = whole(nonNegative(input.otherDeductions));
  const totalDeductions = nssfEmployee + paye + heslb + loanDeduction + otherDeductions;
  const net = gross - totalDeductions;

  const wcf = whole(gross * (rates.wcfPercent / 100));
  const sdl = sdlApplies ? whole(gross * (rates.sdlPercent / 100)) : 0;
  const employerCost = gross + nssfEmployer + wcf + sdl;

  return { basicSalary, allowances, overtime, bonus, gross, nssfEmployee, taxable, paye, heslb, loanDeduction, otherDeductions, totalDeductions, net, nssfEmployer, wcf, sdl, employerCost };
}

export const PAYSLIP_TOTAL_FIELDS = ["gross", "nssfEmployee", "paye", "heslb", "loanDeduction", "otherDeductions", "totalDeductions", "net", "nssfEmployer", "wcf", "sdl", "employerCost"] as const;

export function sumPayslips(lines: Array<Partial<Record<(typeof PAYSLIP_TOTAL_FIELDS)[number], unknown>>>) {
  const totals = Object.fromEntries(PAYSLIP_TOTAL_FIELDS.map((k) => [k, 0])) as Record<(typeof PAYSLIP_TOTAL_FIELDS)[number], number>;
  for (const line of lines) for (const key of PAYSLIP_TOTAL_FIELDS) totals[key] += Number(line[key] ?? 0) || 0;
  return totals;
}

/**
 * Who gets paid what, and when it is due, for one month's run. Due dates
 * follow the usual Tanzanian practice: PAYE and SDL to TRA by the 7th of the
 * next month; HESLB by the 15th; NSSF and WCF by the end of the next month.
 */
export function remittances(totals: ReturnType<typeof sumPayslips>, periodMonth: string) {
  const [y, m] = periodMonth.split("-").map(Number);
  const seventh = new Date(Date.UTC(y, m, 7));
  const fifteenth = new Date(Date.UTC(y, m, 15));
  const monthEnd = new Date(Date.UTC(y, m + 1, 0));
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return [
    { key: "PAYE", payee: "TRA", label: "PAYE", amount: totals.paye, dueOn: day(seventh) },
    { key: "SDL", payee: "TRA", label: "Skills Development Levy", amount: totals.sdl, dueOn: day(seventh) },
    { key: "NSSF", payee: "NSSF", label: "NSSF (employee and employer)", amount: totals.nssfEmployee + totals.nssfEmployer, dueOn: day(monthEnd) },
    { key: "WCF", payee: "WCF", label: "Workers Compensation Fund", amount: totals.wcf, dueOn: day(monthEnd) },
    { key: "HESLB", payee: "HESLB", label: "HESLB loan repayments", amount: totals.heslb, dueOn: day(fifteenth) },
  ].filter((r) => r.amount > 0);
}

const EAT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Calendar days someone was employed in a month, counting their first and
 * last day. Null when they were employed the whole month.
 */
export function daysPaidIn(periodMonth: string, startDate: Date | null | undefined, endDate: Date | null | undefined): { daysPaid: number; periodDays: number } | null {
  const [y, m] = periodMonth.split("-").map(Number);
  const periodDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${periodMonth}-01`;
  const last = `${periodMonth}-${String(periodDays).padStart(2, "0")}`;
  const from = startDate ? EAT_DAY.format(startDate) : first;
  const to = endDate ? EAT_DAY.format(endDate) : last;
  const lo = from > first ? from : first;
  const hi = to < last ? to : last;
  if (lo === first && hi === last) return null;
  const daysPaid = hi < lo ? 0 : Math.round((Date.parse(`${hi}T00:00:00Z`) - Date.parse(`${lo}T00:00:00Z`)) / 86_400_000) + 1;
  return { daysPaid, periodDays };
}
