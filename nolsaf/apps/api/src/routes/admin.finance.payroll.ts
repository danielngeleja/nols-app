import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { auditOrThrow } from "../lib/audit.js";
import { DEFAULT_PAYROLL_RATES, computePayslip, daysPaidIn, normalizeRates, remittances, sumPayslips, type PayrollRates } from "../lib/payroll.js";
import { sendMail } from "../lib/mailer.js";
import { proEmail, proNoteCard } from "../lib/emailBase.js";
import { eligibleEmployeesWhere, monthBounds, monthCoverage, yearCoverage } from "../lib/payrollCoverage.js";
import { SALES_COMMISSION_COST_WHERE } from "../lib/platformMargin.js";
import { payslipVerificationToken } from "../lib/payslipSeal.js";
import { BASE_CURRENCY, getFxRates } from "../lib/fx.js";

/**
 * Payroll for NoLSAF's own staff, inside the Expenses workspace.
 *
 *   Employees  register, update, end employment (never deleted)
 *   Runs       one per month: DRAFT -> APPROVED -> PAID, or CANCELLED
 *   Payslips   one per employee per run, with an employee snapshot
 *
 * Personal and banking details live here, so everything sits behind the
 * admin finance grant; lists mask account and ID numbers. Writes are blocked
 * for impersonated sessions, rate limited and audited in their transaction.
 * Paying a run posts its full employer cost to platform_expense as STAFF,
 * keyed by the run number so it can never be posted twice.
 *
 * Controls:
 *   - the admin who approves a run cannot be the one who prepared it, and
 *     the one who pays it cannot be the approver (PAYROLL_ALLOW_SELF_APPROVAL=1
 *     lifts this outside production, for a single-admin dev setup)
 *   - a changed pay account waits for a second admin to confirm it; until
 *     then that run cannot be approved or paid
 *   - statutory payments are recorded as paid with their receipt number
 */
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler, requireAdminFinanceGrant as unknown as RequestHandler);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => (req?.user?.id ? `finance-payroll:${String(req.user.id)}` : req.ip || "unknown"),
  message: { error: "Too many changes. Please wait a minute and try again." },
});
const writeGuards = [writeLimiter, blockImpersonated] as RequestHandler[];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const eatDay = (day: string, end = false) => new Date(`${day}T${end ? "23:59:59.999" : "00:00:00.000"}+03:00`);
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const adminIdOf = (req: any) => {
  const id = Number(req?.user?.id);
  return Number.isInteger(id) ? id : null;
};
const mask = (value: string | null | undefined) => (value ? `${"•".repeat(Math.max(0, Math.min(4, value.length - 4)))}${value.slice(-4)}` : null);

/**
 * Employee numbers read NSE-<year joined>-<sequence>, for example
 * NSE-2026-0001: NoLSAF Staff Employee, beside the NSA- sales agent codes.
 * Assigned once and never changed, not even on a rehire. Staff registered
 * before this scheme keep their EMP- numbers.
 */
const joinYear = (startDate: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric" }).format(startDate);

/** PS-<run>-<employee no.>, for example PS-2026-10-NSE-2026-0001. */
const payslipNumberOf = (runNumber: string, employeeNo: string) => `${runNumber.replace(/^PR-/, "PS-")}-${employeeNo}`;

const selfApprovalAllowed = () => process.env.NODE_ENV !== "production" && process.env.PAYROLL_ALLOW_SELF_APPROVAL === "1";

/** The pay account fields; changing any of them needs a second admin's confirmation. */
const PAY_FIELDS = ["paymentMethod", "bankName", "bankBranch", "bankAccountName", "bankAccountNumber", "mobileMoneyProvider", "mobileMoneyNumber"] as const;

const payToOf = (e: any) =>
  e.paymentMethod === "MOBILE_MONEY"
    ? `${e.mobileMoneyProvider || "Mobile money"} ${mask(e.mobileMoneyNumber) ?? ""}`.trim()
    : `${e.bankName || "Bank"}${e.bankBranch ? `, ${e.bankBranch}` : ""} ${mask(e.bankAccountNumber) ?? ""}`.trim();

/** One employee's payslip input for a month, with part-month pay and HESLB. */
function payslipInputFor(e: any, periodMonth: string, extra: Record<string, unknown> = {}) {
  const days = daysPaidIn(periodMonth, e.startDate, e.endDate);
  return {
    input: {
      basicSalary: n(e.basicSalary),
      allowances: n(e.housingAllowance) + n(e.transportAllowance) + n(e.otherAllowance),
      nssfEnrolled: e.nssfEnrolled,
      payeExempt: e.payeExempt,
      heslbDeduct: e.heslbDeduct,
      daysPaid: days?.daysPaid ?? null,
      periodDays: days?.periodDays ?? null,
      ...extra,
    },
    days: { daysPaid: days?.daysPaid ?? null, periodDays: days?.periodDays ?? null },
  };
}

/**
 * People on a run whose pay cannot go out yet: a pay account change nobody
 * has confirmed, or one confirmed after the run was built (refresh first).
 */
async function payHolds(tx: any, runId: number) {
  const lines = await tx.payslip.findMany({ where: { runId }, select: { employeeSnapshot: true, employee: true } });
  const holds: Array<{ employeeId: number; name: string; reason: "UNCONFIRMED" | "STALE" }> = [];
  for (const l of lines) {
    const e = l.employee;
    if (e.payDetailsPendingSince) holds.push({ employeeId: e.id, name: e.fullName, reason: "UNCONFIRMED" });
    else if ((l.employeeSnapshot as any)?.payTo !== payToOf(e)) holds.push({ employeeId: e.id, name: e.fullName, reason: "STALE" });
  }
  return holds;
}

function holdMessage(holds: Awaited<ReturnType<typeof payHolds>>) {
  const unconfirmed = holds.filter((h) => h.reason === "UNCONFIRMED").map((h) => h.name);
  if (unconfirmed.length) return `A second admin must confirm the new pay account for ${unconfirmed.join(", ")} first.`;
  return `The pay account for ${holds.map((h) => h.name).join(", ")} changed after this run was built. Reopen and refresh the run first.`;
}

async function currentRates(): Promise<PayrollRates> {
  const row = await prisma.systemSetting.findUnique({ where: { id: 1 }, select: { payrollSettings: true } });
  return normalizeRates(row?.payrollSettings ?? DEFAULT_PAYROLL_RATES);
}

// ── Employees ────────────────────────────────────────────────────────────

function employeeListRow(e: any) {
  return {
    id: e.id,
    employeeNo: e.employeeNo,
    fullName: e.fullName,
    jobTitle: e.jobTitle,
    department: e.department,
    employmentType: e.employmentType,
    status: e.status,
    startDate: e.startDate,
    endDate: e.endDate,
    phone: e.phone,
    email: e.email,
    basicSalary: n(e.basicSalary),
    allowances: n(e.housingAllowance) + n(e.transportAllowance) + n(e.otherAllowance),
    currency: e.currency,
    paymentMethod: e.paymentMethod,
    payTo: e.paymentMethod === "MOBILE_MONEY" ? `${e.mobileMoneyProvider || "Mobile money"} ${mask(e.mobileMoneyNumber) ?? ""}`.trim() : `${e.bankName || "Bank"} ${mask(e.bankAccountNumber) ?? ""}`.trim(),
    heslbDeduct: e.heslbDeduct,
    payDetailsPending: Boolean(e.payDetailsPendingSince),
    missing: [
      !e.tin && "TIN",
      e.nssfEnrolled && !e.nssfNumber && "NSSF number",
      !e.nationalId && "NIDA number",
      e.paymentMethod === "BANK" ? !e.bankAccountNumber && "bank account" : !e.mobileMoneyNumber && "mobile money number",
    ].filter(Boolean),
  };
}

function employeeDetail(e: any) {
  return {
    ...employeeListRow(e),
    nationalId: e.nationalId,
    tin: e.tin,
    nssfNumber: e.nssfNumber,
    dateOfBirth: e.dateOfBirth,
    gender: e.gender,
    address: e.address,
    housingAllowance: n(e.housingAllowance),
    transportAllowance: n(e.transportAllowance),
    otherAllowance: n(e.otherAllowance),
    nssfEnrolled: e.nssfEnrolled,
    payeExempt: e.payeExempt,
    heslbIndexNumber: e.heslbIndexNumber,
    payDetailsPendingSince: e.payDetailsPendingSince,
    payDetailsChangedById: e.payDetailsChangedById,
    bankName: e.bankName,
    bankBranch: e.bankBranch,
    bankAccountName: e.bankAccountName,
    bankAccountNumber: e.bankAccountNumber,
    mobileMoneyProvider: e.mobileMoneyProvider,
    mobileMoneyNumber: e.mobileMoneyNumber,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const money = z.coerce.number().min(0).max(1_000_000_000);

const employeeSchema = z
  .object({
    fullName: z.string().trim().min(3, "Enter the full name").max(150),
    email: z.string().trim().email("Check the email address").max(150).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
    phone: optionalText(30),
    nationalId: optionalText(30),
    tin: optionalText(20),
    nssfNumber: optionalText(30),
    dateOfBirth: z.string().regex(DAY).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
    gender: z.enum(["FEMALE", "MALE", "OTHER"]).optional().nullable(),
    address: optionalText(255),
    jobTitle: z.string().trim().min(2, "Enter the job title").max(120),
    department: optionalText(80),
    employmentType: z.enum(["PERMANENT", "CONTRACT", "CASUAL", "INTERN"]).default("PERMANENT"),
    startDate: z.string().regex(DAY, "Pick the start date"),
    basicSalary: money.refine((v) => v > 0, "Enter the basic salary"),
    housingAllowance: money.default(0),
    transportAllowance: money.default(0),
    otherAllowance: money.default(0),
    nssfEnrolled: z.boolean().default(true),
    payeExempt: z.boolean().default(false),
    heslbDeduct: z.boolean().default(false),
    heslbIndexNumber: optionalText(40),
    paymentMethod: z.enum(["BANK", "MOBILE_MONEY"]).default("BANK"),
    bankName: optionalText(80),
    bankBranch: optionalText(80),
    bankAccountName: optionalText(150),
    bankAccountNumber: optionalText(40),
    mobileMoneyProvider: optionalText(40),
    mobileMoneyNumber: optionalText(30),
    emergencyContactName: optionalText(150),
    emergencyContactPhone: optionalText(30),
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMethod === "BANK" && !v.bankAccountNumber) ctx.addIssue({ code: "custom", message: "Enter the bank account number", path: ["bankAccountNumber"] });
    if (v.paymentMethod === "MOBILE_MONEY" && !v.mobileMoneyNumber) ctx.addIssue({ code: "custom", message: "Enter the mobile money number", path: ["mobileMoneyNumber"] });
  });

function employeeData(v: z.infer<typeof employeeSchema>) {
  return {
    ...v,
    dateOfBirth: v.dateOfBirth ? eatDay(v.dateOfBirth) : null,
    startDate: eatDay(v.startDate),
    basicSalary: v.basicSalary.toFixed(2) as any,
    housingAllowance: v.housingAllowance.toFixed(2) as any,
    transportAllowance: v.transportAllowance.toFixed(2) as any,
    otherAllowance: v.otherAllowance.toFixed(2) as any,
    gender: v.gender ?? null,
  };
}

router.get("/employees", async (req, res) => {
  try {
    const status = String(req.query.status ?? "");
    const q = String(req.query.q ?? "").trim();
    const where: any = {};
    if (["ACTIVE", "ON_LEAVE", "TERMINATED"].includes(status)) where.status = status;
    if (q) where.OR = [{ fullName: { contains: q } }, { employeeNo: { contains: q } }, { jobTitle: { contains: q } }, { department: { contains: q } }];
    const [rows, counts] = await Promise.all([
      prisma.employee.findMany({ where, orderBy: [{ status: "asc" }, { fullName: "asc" }], take: 500 }),
      prisma.employee.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const active = await prisma.employee.findMany({ where: { status: { not: "TERMINATED" } }, select: { basicSalary: true, housingAllowance: true, transportAllowance: true, otherAllowance: true } });
    res.json({
      items: rows.map(employeeListRow),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      monthlyGross: active.reduce((s, e) => s + n(e.basicSalary) + n(e.housingAllowance) + n(e.transportAllowance) + n(e.otherAllowance), 0),
    });
  } catch (err: any) {
    console.error("GET payroll/employees error:", err?.message || err);
    res.status(500).json({ error: "Could not load employees" });
  }
});

router.get("/employees/:id(\\d+)", async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: Number(req.params.id) },
      include: { payslips: { orderBy: { createdAt: "desc" }, take: 24, include: { run: { select: { runNumber: true, periodMonth: true, status: true } } } } },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    res.json({
      employee: employeeDetail(employee),
      payslips: employee.payslips
        .filter((p) => p.run.status !== "CANCELLED")
        .map((p) => ({ id: p.id, runId: p.runId, payslipNumber: p.payslipNumber, periodMonth: p.run.periodMonth, runStatus: p.run.status, gross: n(p.gross), net: n(p.net), paye: n(p.paye) })),
    });
  } catch (err: any) {
    console.error("GET payroll/employees/:id error:", err?.message || err);
    res.status(500).json({ error: "Could not load the employee" });
  }
});

router.post("/employees", ...writeGuards, async (req, res) => {
  const parsed = employeeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the employee details" });
  try {
    const data = employeeData(parsed.data);
    const prefix = `NSE-${joinYear(data.startDate)}-`;
    let created: any = null;
    // Two registrations at the same moment can pick the same number; the
    // unique index rejects the second, which then takes the next one.
    for (let attempt = 0; !created; attempt++) {
      try {
        created = await prisma.$transaction(async (tx) => {
          const last = await tx.employee.findFirst({ where: { employeeNo: { startsWith: prefix } }, orderBy: { employeeNo: "desc" }, select: { employeeNo: true } });
          const employeeNo = `${prefix}${String((Number(last?.employeeNo.slice(prefix.length)) || 0) + 1).padStart(4, "0")}`;
          const row = await tx.employee.create({ data: { ...data, employeeNo, status: "ACTIVE", createdById: adminIdOf(req) } });
          await auditOrThrow(tx as any, req, "EMPLOYEE_REGISTERED", `EMPLOYEE:${row.id}`, null, { employeeNo, fullName: row.fullName, jobTitle: row.jobTitle, basicSalary: n(row.basicSalary) }, row.id);
          return row;
        });
      } catch (err: any) {
        if (err?.code !== "P2002" || !String(err?.meta?.target ?? "employeeNo").includes("employeeNo") || attempt >= 4) throw err;
      }
    }
    res.status(201).json({ ok: true, employee: employeeDetail(created) });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Another employee was registered at the same moment. Please try again." });
    console.error("POST payroll/employees error:", err?.message || err);
    res.status(500).json({ error: "The employee was not registered. Please try again." });
  }
});

const updateSchema = z.object({
  details: employeeSchema.optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
  endDate: z.string().regex(DAY).optional().nullable(),
});

router.patch("/employees/:id(\\d+)", ...writeGuards, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the employee details" });
  const id = Number(req.params.id);
  const { details, status, endDate } = parsed.data;
  if (status === "TERMINATED" && !endDate) return res.status(400).json({ error: "Enter the last working day" });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.employee.findUnique({ where: { id } });
      if (!before) return null;
      const payChanged = Boolean(details) && PAY_FIELDS.some((k) => String((before as any)[k] ?? "") !== String((details as any)[k] ?? ""));
      const row = await tx.employee.update({
        where: { id },
        data: {
          ...(details ? employeeData(details) : {}),
          ...(payChanged ? { payDetailsPendingSince: new Date(), payDetailsChangedById: adminIdOf(req) } : {}),
          ...(status ? { status } : {}),
          ...(status === "TERMINATED" ? { endDate: eatDay(endDate!) } : status ? { endDate: null } : {}),
        },
      });
      await auditOrThrow(tx as any, req, "EMPLOYEE_UPDATED", `EMPLOYEE:${id}`, employeeDetail(before), employeeDetail(row), id);
      if (payChanged) await auditOrThrow(tx as any, req, "EMPLOYEE_PAY_ACCOUNT_CHANGED", `EMPLOYEE:${id}`, { payTo: payToOf(before) }, { payTo: payToOf(row), awaitingConfirmation: true }, id);
      return { row, payChanged, before };
    });
    if (!updated) return res.status(404).json({ error: "Employee not found" });
    if (updated.payChanged) void notifyPayAccountChanged(updated.row, payToOf(updated.before), payToOf(updated.row));
    res.json({ ok: true, employee: employeeDetail(updated.row) });
  } catch (err: any) {
    console.error("PATCH payroll/employees/:id error:", err?.message || err);
    res.status(500).json({ error: "The changes were not saved. Please try again." });
  }
});

/** Tells the employee their pay account changed, so a change they did not ask for is caught. */
async function notifyPayAccountChanged(e: any, from: string, to: string) {
  if (!e.email) return;
  try {
    const body = `
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">Hello ${String(e.fullName).split(/\s+/)[0]},</p>
      <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.7;">The account NoLSAF pays your salary into was changed in payroll.</p>
      ${proNoteCard("#02665e", "Pay account", `From: ${from}<br/>To: ${to}`)}
      <p style="margin:18px 0 0;font-size:14px;color:#6b7280;line-height:1.7;">If you asked for this, there is nothing to do. If you did not, contact NoLSAF finance straight away. Your pay will not go to the new account until a second person in finance confirms it.</p>`;
    await sendMail(e.email, "Your NoLSAF pay account was changed", proEmail("Your pay account was changed", body));
  } catch (err: any) {
    console.warn("[payroll] pay account change email failed:", err?.message || err);
  }
}

/** A second admin confirms a changed pay account. */
router.post("/employees/:id(\\d+)/confirm-pay-details", ...writeGuards, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const e = await tx.employee.findUnique({ where: { id } });
      if (!e) return { status: 404, error: "Employee not found" };
      if (!e.payDetailsPendingSince) return { status: 409, error: "There is no pay account change waiting for confirmation" };
      if (e.payDetailsChangedById === adminIdOf(req) && !selfApprovalAllowed()) return { status: 403, error: "Someone other than the admin who changed the pay account must confirm it" };
      const claimed = await tx.employee.updateMany({ where: { id, payDetailsPendingSince: e.payDetailsPendingSince }, data: { payDetailsPendingSince: null, payDetailsChangedById: null } });
      if (claimed.count !== 1) return { status: 409, error: "The pay account was changed again. Reload and check it." };
      await auditOrThrow(tx as any, req, "EMPLOYEE_PAY_ACCOUNT_CONFIRMED", `EMPLOYEE:${id}`, { changedById: e.payDetailsChangedById, since: e.payDetailsPendingSince }, { payTo: payToOf(e) }, id);
      return { status: 200, employee: await tx.employee.findUniqueOrThrow({ where: { id } }) };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, employee: employeeDetail(result.employee) });
  } catch (err: any) {
    console.error("POST payroll confirm-pay-details error:", err?.message || err);
    res.status(500).json({ error: "Nothing was confirmed. Please try again." });
  }
});

// ── Statutory settings ───────────────────────────────────────────────────

router.get("/settings", async (_req, res) => {
  try {
    res.json({ rates: await currentRates(), defaults: DEFAULT_PAYROLL_RATES });
  } catch (err: any) {
    console.error("GET payroll/settings error:", err?.message || err);
    res.status(500).json({ error: "Could not load payroll settings" });
  }
});

const ratesSchema = z.object({
  nssfEmployeePercent: z.coerce.number().min(0).max(100),
  nssfEmployerPercent: z.coerce.number().min(0).max(100),
  wcfPercent: z.coerce.number().min(0).max(100),
  sdlPercent: z.coerce.number().min(0).max(100),
  sdlMinEmployees: z.coerce.number().int().min(0).max(10_000),
  heslbPercent: z.coerce.number().min(0).max(100).default(DEFAULT_PAYROLL_RATES.heslbPercent),
  payeBands: z.array(z.object({ upTo: z.coerce.number().min(0).nullable(), rate: z.coerce.number().min(0).max(100) })).min(1).max(12),
});

router.put("/settings", ...writeGuards, async (req, res) => {
  const parsed = ratesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the rates" });
  const rates = normalizeRates(parsed.data);
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { id: 1 }, select: { payrollSettings: true } });
      await tx.systemSetting.upsert({ where: { id: 1 }, update: { payrollSettings: rates as any }, create: { id: 1, payrollSettings: rates as any } });
      await auditOrThrow(tx as any, req, "PAYROLL_RATES_CHANGED", "SYSTEM_SETTING:payrollSettings", before?.payrollSettings ?? null, rates);
    });
    res.json({ ok: true, rates });
  } catch (err: any) {
    console.error("PUT payroll/settings error:", err?.message || err);
    res.status(500).json({ error: "The rates were not saved. Please try again." });
  }
});

// ── Revenue coverage ─────────────────────────────────────────────────────

/**
 * GET /coverage?month=YYYY-MM  one month
 * GET /coverage?year=YYYY      every month of the year up to now
 * NoLSAF revenue for the month against payroll and every other cost: how
 * much is covered, and the shortfall or surplus (lib/payrollCoverage.ts).
 */
router.get("/coverage", async (req, res) => {
  try {
    const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    const month = String(req.query.month ?? "");
    if (MONTH.test(month)) {
      if (month > currentMonth) return res.status(400).json({ error: "That month has not started yet" });
      return res.json({ months: [await monthCoverage(month)] });
    }
    const year = Number(req.query.year ?? currentMonth.slice(0, 4));
    if (!Number.isInteger(year) || year < 2020 || year > Number(currentMonth.slice(0, 4))) return res.status(400).json({ error: "Pick a year" });
    res.json({ months: await yearCoverage(year, currentMonth) });
  } catch (err: any) {
    console.error("GET payroll/coverage error:", err?.message || err);
    res.status(500).json({ error: "Could not work out the revenue coverage" });
  }
});

// ── Sales partners ───────────────────────────────────────────────────────

/**
 * GET /partners?month=YYYY-MM
 * The commissioned sales team, read-only beside the salaried staff. They are
 * not on the payroll: they earn per revenue event (sales_commission) and are
 * paid through Sales payouts, never through a pay run. Earned uses the same
 * rule as the margin and the coverage, so these totals match them.
 */
router.get("/partners", async (req, res) => {
  try {
    const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    const month = MONTH.test(String(req.query.month ?? "")) ? String(req.query.month) : currentMonth;
    if (month > currentMonth) return res.status(400).json({ error: "That month has not started yet" });
    const { start, end } = monthBounds(month);
    const fx = await getFxRates();
    const toTzs = (amount: number, currency?: string | null) => {
      const cur = String(currency || BASE_CURRENCY).toUpperCase();
      if (cur === BASE_CURRENCY) return amount;
      const rate = fx.tzsPerUnit[cur];
      return Number.isFinite(rate) && rate > 0 ? amount * rate : amount;
    };

    const [partners, earned, owed, pending, paid] = await Promise.all([
      prisma.salesPartnerProfile.findMany({
        select: {
          id: true, agentCode: true, status: true, level: true, region: true, payoutMethod: true, payoutAccount: true, activatedAt: true, terminatedAt: true,
          user: { select: { name: true, fullName: true, email: true, phone: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.salesCommission.groupBy({
        by: ["salesPartnerId", "currency"],
        where: { ...SALES_COMMISSION_COST_WHERE, earnedAt: { gte: start, lte: end } },
        _sum: { commissionAmount: true },
        _count: { _all: true },
      }),
      // Approved for payout but not paid yet, whenever it was earned.
      prisma.salesCommission.groupBy({
        by: ["salesPartnerId", "currency"],
        where: { status: { in: ["ELIGIBLE", "APPROVED", "AVAILABLE"] } },
        _sum: { commissionAmount: true },
      }),
      // Still inside the validation window.
      prisma.salesCommission.groupBy({
        by: ["salesPartnerId", "currency"],
        where: { status: { in: ["PENDING", "VALIDATING"] } },
        _sum: { commissionAmount: true },
      }),
      prisma.salesPayoutRequest.groupBy({
        by: ["salesPartnerId", "currency"],
        where: { status: "PAID", paidAt: { gte: start, lte: end } },
        _sum: { netPaidAmount: true, withholdingTaxAmount: true },
        _count: { _all: true },
      }),
    ]);

    const byPartner = (rows: any[], field: string) => {
      const map = new Map<number, number>();
      for (const r of rows) map.set(r.salesPartnerId, (map.get(r.salesPartnerId) ?? 0) + toTzs(n(r._sum[field]), r.currency));
      return map;
    };
    const earnedMap = byPartner(earned, "commissionAmount");
    const owedMap = byPartner(owed, "commissionAmount");
    const pendingMap = byPartner(pending, "commissionAmount");
    const paidMap = byPartner(paid, "netPaidAmount");
    const whtMap = byPartner(paid, "withholdingTaxAmount");
    const r2 = (v: number) => Math.round(v * 100) / 100;

    const items = partners
      .map((p: any) => ({
        id: p.id,
        agentCode: p.agentCode,
        name: p.user?.fullName || p.user?.name || p.user?.email || p.agentCode,
        phone: p.user?.phone ?? null,
        status: p.status,
        level: p.level,
        region: p.region,
        payTo: p.payoutMethod ? `${p.payoutMethod.replace(/_/g, " ").toLowerCase()} ${mask(p.payoutAccount) ?? ""}`.trim() : null,
        activatedAt: p.activatedAt,
        earned: r2(earnedMap.get(p.id) ?? 0),
        paid: r2(paidMap.get(p.id) ?? 0),
        withheld: r2(whtMap.get(p.id) ?? 0),
        owed: r2(owedMap.get(p.id) ?? 0),
        pending: r2(pendingMap.get(p.id) ?? 0),
      }))
      // Former partners only matter while money still moves for them.
      .filter((p: any) => p.status !== "TERMINATED" || p.earned || p.paid || p.owed || p.pending);

    const sum = (key: "earned" | "paid" | "withheld" | "owed" | "pending") => r2(items.reduce((s: number, p: any) => s + p[key], 0));
    res.json({
      periodMonth: month,
      items,
      totals: { partners: items.length, active: items.filter((p: any) => p.status === "ACTIVE").length, earned: sum("earned"), paid: sum("paid"), withheld: sum("withheld"), owed: sum("owed"), pending: sum("pending") },
    });
  } catch (err: any) {
    console.error("GET payroll/partners error:", err?.message || err);
    res.status(500).json({ error: "Could not load the sales partners" });
  }
});

// ── Pay runs ─────────────────────────────────────────────────────────────

function runRow(r: any) {
  return {
    id: r.id,
    runNumber: r.runNumber,
    periodMonth: r.periodMonth,
    status: r.status,
    payDate: r.payDate,
    headcount: r.headcount,
    sdlApplies: r.sdlApplies,
    gross: n(r.gross),
    nssfEmployee: n(r.nssfEmployee),
    paye: n(r.paye),
    otherDeductions: n(r.otherDeductions),
    net: n(r.net),
    nssfEmployer: n(r.nssfEmployer),
    wcf: n(r.wcf),
    sdl: n(r.sdl),
    employerCost: n(r.employerCost),
    heslb: n(r.heslb),
    note: r.note,
    paymentReference: r.paymentReference,
    approvedAt: r.approvedAt,
    paidAt: r.paidAt,
    cancelledAt: r.cancelledAt,
    expenseId: r.expenseId,
    createdAt: r.createdAt,
  };
}

function payslipRow(p: any, runStatus?: string) {
  return {
    id: p.id,
    // Only issued (paid) payslips carry a verification link for their QR code.
    verifyToken: runStatus === "PAID" ? payslipVerificationToken(p.payslipNumber) : null,
    employeeId: p.employeeId,
    payslipNumber: p.payslipNumber,
    employee: p.employeeSnapshot,
    basicSalary: n(p.basicSalary),
    allowances: n(p.allowances),
    overtime: n(p.overtime),
    bonus: n(p.bonus),
    gross: n(p.gross),
    nssfEmployee: n(p.nssfEmployee),
    taxable: n(p.taxable),
    paye: n(p.paye),
    heslb: n(p.heslb),
    daysPaid: p.daysPaid ?? null,
    periodDays: p.periodDays ?? null,
    loanDeduction: n(p.loanDeduction),
    otherDeductions: n(p.otherDeductions),
    totalDeductions: n(p.totalDeductions),
    net: n(p.net),
    nssfEmployer: n(p.nssfEmployer),
    wcf: n(p.wcf),
    sdl: n(p.sdl),
    employerCost: n(p.employerCost),
    note: p.note,
  };
}

function snapshotOf(e: any) {
  return {
    employeeNo: e.employeeNo,
    fullName: e.fullName,
    jobTitle: e.jobTitle,
    department: e.department,
    employmentType: e.employmentType,
    tin: e.tin,
    nssfNumber: e.nssfNumber,
    startDate: e.startDate,
    paymentMethod: e.paymentMethod,
    heslbIndexNumber: e.heslbDeduct ? e.heslbIndexNumber : null,
    payTo: payToOf(e),
  };
}

const figureData = (f: ReturnType<typeof computePayslip>): any =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, (v as number).toFixed(2)])) as any;

/** Recompute run totals from its payslips. */
async function refreshRunTotals(tx: any, runId: number) {
  const lines = await tx.payslip.findMany({ where: { runId } });
  const totals = sumPayslips(lines.map((l: any) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, n(v)]))));
  return tx.payrollRun.update({
    where: { id: runId },
    data: {
      headcount: lines.length,
      gross: totals.gross.toFixed(2),
      nssfEmployee: totals.nssfEmployee.toFixed(2),
      paye: totals.paye.toFixed(2),
      otherDeductions: (totals.loanDeduction + totals.otherDeductions).toFixed(2),
      net: totals.net.toFixed(2),
      nssfEmployer: totals.nssfEmployer.toFixed(2),
      wcf: totals.wcf.toFixed(2),
      sdl: totals.sdl.toFixed(2),
      employerCost: totals.employerCost.toFixed(2),
      heslb: totals.heslb.toFixed(2),
    },
  });
}

router.get("/runs", async (_req, res) => {
  try {
    const runs = await prisma.payrollRun.findMany({ orderBy: [{ periodMonth: "desc" }, { id: "desc" }], take: 60 });
    res.json({ items: runs.map(runRow) });
  } catch (err: any) {
    console.error("GET payroll/runs error:", err?.message || err);
    res.status(500).json({ error: "Could not load pay runs" });
  }
});

router.get("/runs/:id(\\d+)", async (req, res) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: Number(req.params.id) }, include: { payslips: { orderBy: { payslipNumber: "asc" } }, remittances: true } });
    if (!run) return res.status(404).json({ error: "Pay run not found" });
    const totals = sumPayslips(run.payslips.map((l: any) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, n(v)]))));
    const me = adminIdOf(req);
    const holds = run.status === "DRAFT" || run.status === "APPROVED" ? await payHolds(prisma, run.id) : [];
    const recorded = new Map(run.remittances.map((r: any) => [r.key, r]));
    res.json({
      run: runRow(run),
      rates: normalizeRates(run.rates),
      payslips: run.payslips.map((p: any) => payslipRow(p, run.status)),
      remittances: remittances(totals, run.periodMonth).map((r) => {
        const paid: any = recorded.get(r.key);
        return { ...r, paid: paid ? { paidOn: paid.paidOn, reference: paid.reference, amount: n(paid.amount), note: paid.note } : null };
      }),
      holds,
      controls: {
        selfApprovalAllowed: selfApprovalAllowed(),
        preparedByMe: run.preparedById != null && run.preparedById === me,
        approvedByMe: run.approvedById != null && run.approvedById === me,
      },
    });
  } catch (err: any) {
    console.error("GET payroll/runs/:id error:", err?.message || err);
    res.status(500).json({ error: "Could not load the pay run" });
  }
});

router.post("/runs", ...writeGuards, async (req, res) => {
  const parsed = z.object({ periodMonth: z.string().regex(MONTH, "Pick the month") }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Pick the month" });
  const { periodMonth } = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollRun.findMany({ where: { periodMonth }, select: { status: true } });
      if (existing.some((r) => r.status !== "CANCELLED")) return { error: "This month already has a pay run. Open it, or cancel it first." };
      const employees = await tx.employee.findMany({ where: eligibleEmployeesWhere(periodMonth) as any, orderBy: { employeeNo: "asc" } });
      if (!employees.length) return { error: "No employees are on the payroll for this month. Register employees first." };

      const rates = await currentRates();
      const sdlApplies = employees.length >= rates.sdlMinEmployees;
      const runNumber = `PR-${periodMonth}${existing.length ? `-${existing.length + 1}` : ""}`;
      const run = await tx.payrollRun.create({ data: { runNumber, periodMonth, status: "DRAFT", rates: rates as any, sdlApplies, createdById: adminIdOf(req), preparedById: adminIdOf(req) } });

      for (const e of employees) {
        const { input, days } = payslipInputFor(e, periodMonth);
        const figures = computePayslip(input, rates, sdlApplies);
        await tx.payslip.create({
          data: { runId: run.id, employeeId: e.id, payslipNumber: payslipNumberOf(runNumber, e.employeeNo), employeeSnapshot: snapshotOf(e) as any, ...figureData(figures), ...days },
        });
      }
      const withTotals = await refreshRunTotals(tx, run.id);
      await auditOrThrow(tx as any, req, "PAYROLL_RUN_CREATED", `PAYROLL_RUN:${run.id}`, null, { runNumber, periodMonth, headcount: employees.length }, run.id);
      return { run: withTotals };
    }, { maxWait: 10_000, timeout: 30_000 });
    if ("error" in result) return res.status(409).json({ error: result.error });
    res.status(201).json({ ok: true, run: runRow(result.run) });
  } catch (err: any) {
    console.error("POST payroll/runs error:", err?.message || err);
    res.status(500).json({ error: "The pay run was not created. Please try again." });
  }
});

const lineSchema = z.object({
  overtime: money.default(0),
  bonus: money.default(0),
  loanDeduction: money.default(0),
  otherDeductions: money.default(0),
  note: optionalText(300),
});

router.patch("/runs/:id(\\d+)/payslips/:payslipId(\\d+)", ...writeGuards, async (req, res) => {
  const parsed = lineSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the amounts" });
  const runId = Number(req.params.id);
  const payslipId = Number(req.params.payslipId);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) return { status: 404, error: "Pay run not found" };
      if (run.status !== "DRAFT") return { status: 409, error: "Only a draft pay run can be changed" };
      const line = await tx.payslip.findFirst({ where: { id: payslipId, runId }, include: { employee: true } });
      if (!line) return { status: 404, error: "Payslip not found" };
      const e = line.employee;
      const { input, days } = payslipInputFor(e, run.periodMonth, parsed.data);
      const figures = computePayslip(input, normalizeRates(run.rates), run.sdlApplies);
      if (figures.net < 0) return { status: 400, error: "Deductions are larger than the pay for this month" };
      const updated = await tx.payslip.update({ where: { id: line.id }, data: { ...figureData(figures), ...days, note: parsed.data.note } });
      await refreshRunTotals(tx, runId);
      await tx.payrollRun.update({ where: { id: runId }, data: { preparedById: adminIdOf(req) } });
      await auditOrThrow(tx as any, req, "PAYSLIP_ADJUSTED", `PAYSLIP:${line.id}`, payslipRow(line), payslipRow(updated), line.id);
      return { status: 200, payslip: updated };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, payslip: payslipRow(result.payslip) });
  } catch (err: any) {
    console.error("PATCH payroll payslip error:", err?.message || err);
    res.status(500).json({ error: "The payslip was not updated. Please try again." });
  }
});

/** Rebuild a draft from the current employee records, keeping this month's one-off amounts. */
router.post("/runs/:id(\\d+)/refresh", ...writeGuards, async (req, res) => {
  const runId = Number(req.params.id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId }, include: { payslips: true } });
      if (!run) return { status: 404, error: "Pay run not found" };
      if (run.status !== "DRAFT") return { status: 409, error: "Only a draft pay run can be refreshed" };
      const employees = await tx.employee.findMany({ where: eligibleEmployeesWhere(run.periodMonth) as any, orderBy: { employeeNo: "asc" } });
      const rates = await currentRates();
      const sdlApplies = employees.length >= rates.sdlMinEmployees;
      type OneOff = { overtime: number; bonus: number; loanDeduction: number; otherDeductions: number; note: string | null };
      const oneOffs = new Map<number, OneOff>(run.payslips.map((p): [number, OneOff] => [p.employeeId, { overtime: n(p.overtime), bonus: n(p.bonus), loanDeduction: n(p.loanDeduction), otherDeductions: n(p.otherDeductions), note: p.note }]));
      await tx.payslip.deleteMany({ where: { runId } });
      for (const e of employees) {
        const extra: OneOff = oneOffs.get(e.id) ?? { overtime: 0, bonus: 0, loanDeduction: 0, otherDeductions: 0, note: null };
        const { input, days } = payslipInputFor(e, run.periodMonth, extra);
        const figures = computePayslip(input, rates, sdlApplies);
        await tx.payslip.create({
          data: { runId, employeeId: e.id, payslipNumber: payslipNumberOf(run.runNumber, e.employeeNo), employeeSnapshot: snapshotOf(e) as any, ...figureData(figures), ...days, note: extra.note },
        });
      }
      await tx.payrollRun.update({ where: { id: runId }, data: { rates: rates as any, sdlApplies, preparedById: adminIdOf(req) } });
      const updated = await refreshRunTotals(tx, runId);
      await auditOrThrow(tx as any, req, "PAYROLL_RUN_REFRESHED", `PAYROLL_RUN:${runId}`, null, { headcount: employees.length }, runId);
      return { status: 200, run: updated };
    }, { maxWait: 10_000, timeout: 30_000 });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, run: runRow(result.run) });
  } catch (err: any) {
    console.error("POST payroll refresh error:", err?.message || err);
    res.status(500).json({ error: "The pay run was not refreshed. Please try again." });
  }
});

/** Moves a run between states with an atomic claim on the expected status. */
async function transition(req: any, res: any, from: string[], to: string, extra: (run: any, tx: any) => Promise<Record<string, unknown> | { error: string }>, action: string) {
  const runId = Number(req.params.id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) return { status: 404, error: "Pay run not found" };
      if (!from.includes(run.status)) return { status: 409, error: `A ${run.status.toLowerCase()} pay run cannot be moved to ${to.toLowerCase()}` };
      const data = await extra(run, tx);
      if ("error" in data) return { status: 400, error: String(data.error) };
      const claimed = await tx.payrollRun.updateMany({ where: { id: runId, status: run.status }, data: { status: to, ...data } });
      if (claimed.count !== 1) return { status: 409, error: "The pay run was changed by someone else. Reload and try again." };
      const updated = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
      await auditOrThrow(tx, req, action, `PAYROLL_RUN:${runId}`, { status: run.status }, { status: to, ...data }, runId);
      return { status: 200, run: updated };
    }, { maxWait: 10_000, timeout: 30_000 });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, run: runRow(result.run) });
  } catch (err: any) {
    console.error(`payroll ${action} error:`, err?.message || err);
    res.status(500).json({ error: "Nothing was changed. Please try again." });
  }
}

router.post("/runs/:id(\\d+)/approve", ...writeGuards, (req, res) =>
  transition(req, res, ["DRAFT"], "APPROVED", async (run, tx) => {
    if (run.headcount <= 0) return { error: "The pay run has no payslips" };
    if (run.preparedById != null && run.preparedById === adminIdOf(req) && !selfApprovalAllowed()) return { error: "You prepared this pay run, so another admin must approve it." };
    const holds = await payHolds(tx, run.id);
    if (holds.length) return { error: holdMessage(holds) };
    return { approvedById: adminIdOf(req), approvedAt: new Date() };
  }, "PAYROLL_RUN_APPROVED"),
);

router.post("/runs/:id(\\d+)/reopen", ...writeGuards, (req, res) =>
  transition(req, res, ["APPROVED"], "DRAFT", async () => ({ approvedById: null, approvedAt: null }), "PAYROLL_RUN_REOPENED"),
);

router.post("/runs/:id(\\d+)/cancel", ...writeGuards, (req, res) =>
  transition(req, res, ["DRAFT", "APPROVED"], "CANCELLED", async () => ({ cancelledAt: new Date() }), "PAYROLL_RUN_CANCELLED"),
);

const paySchema = z.object({ payDate: z.string().regex(DAY, "Pick the pay date"), paymentReference: optionalText(120) });

/** Marks salaries as paid and posts the run's employer cost to the expense ledger. */
router.post("/runs/:id(\\d+)/pay", ...writeGuards, (req, res) => {
  const parsed = paySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Pick the pay date" });
  return transition(
    req,
    res,
    ["APPROVED"],
    "PAID",
    async (run, tx) => {
      if (run.approvedById != null && run.approvedById === adminIdOf(req) && !selfApprovalAllowed()) return { error: "You approved this pay run, so another admin must mark it as paid." };
      const holds = await payHolds(tx, run.id);
      if (holds.length) return { error: holdMessage(holds) };
      const { first, last } = monthBounds(run.periodMonth);
      const expense = await tx.platformExpense.create({
        data: {
          category: "STAFF",
          description: `Payroll ${run.runNumber}: salaries and employer contributions`,
          vendor: "Payroll",
          reference: run.runNumber,
          amount: n(run.employerCost).toFixed(2),
          currency: "TZS",
          // Booked to the month the pay is for, so it lands in that month's margin.
          incurredAt: eatDay(last, true),
          periodStart: eatDay(first),
          periodEnd: eatDay(last, true),
          origin: "SYSTEM",
          sourceKey: `PAYROLL:${run.runNumber}`,
          recordedById: adminIdOf(req),
          note: `${run.headcount} payslips. Gross ${n(run.gross).toLocaleString("en-US")}, employer NSSF ${n(run.nssfEmployer).toLocaleString("en-US")}, WCF ${n(run.wcf).toLocaleString("en-US")}, SDL ${n(run.sdl).toLocaleString("en-US")}.`.slice(0, 500),
        },
      });
      return { payDate: eatDay(parsed.data.payDate), paymentReference: parsed.data.paymentReference, paidById: adminIdOf(req), paidAt: new Date(), expenseId: expense.id };
    },
    "PAYROLL_RUN_PAID",
  );
});

// ── Statutory payments ───────────────────────────────────────────────────

const remittanceSchema = z.object({
  paidOn: z.string().regex(DAY, "Pick the date it was paid"),
  reference: z.string().trim().min(3, "Enter the receipt or control number").max(120),
  note: optionalText(300),
});
const REMITTANCE_KEYS = ["PAYE", "SDL", "NSSF", "WCF", "HESLB"];

/** Record one statutory payment of a paid run as settled. */
router.post("/runs/:id(\\d+)/remittances/:key", ...writeGuards, async (req, res) => {
  const key = String(req.params.key).toUpperCase();
  if (!REMITTANCE_KEYS.includes(key)) return res.status(404).json({ error: "Unknown statutory payment" });
  const parsed = remittanceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Check the payment details" });
  const runId = Number(req.params.id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId }, include: { payslips: true } });
      if (!run) return { status: 404, error: "Pay run not found" };
      if (run.status !== "PAID") return { status: 409, error: "Statutory payments are recorded once the salaries are paid" };
      const totals = sumPayslips(run.payslips.map((l: any) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, n(v)]))));
      const item = remittances(totals, run.periodMonth).find((r) => r.key === key);
      if (!item) return { status: 404, error: "This run has nothing to pay for that item" };
      const row = await tx.payrollRemittance.create({
        data: { runId, key, payee: item.payee, amount: item.amount.toFixed(2) as any, dueOn: eatDay(item.dueOn), paidOn: eatDay(parsed.data.paidOn), reference: parsed.data.reference, note: parsed.data.note, paidById: adminIdOf(req) },
      });
      await auditOrThrow(tx as any, req, "PAYROLL_REMITTANCE_PAID", `PAYROLL_RUN:${runId}`, null, { key, amount: item.amount, paidOn: parsed.data.paidOn, reference: parsed.data.reference }, runId);
      return { status: 201, row };
    });
    if (result.status !== 201) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ error: "This payment is already recorded" });
    console.error("POST payroll remittance error:", err?.message || err);
    res.status(500).json({ error: "The payment was not recorded. Please try again." });
  }
});

/** Undo a recorded statutory payment entered by mistake. */
router.delete("/runs/:id(\\d+)/remittances/:key", ...writeGuards, async (req, res) => {
  const key = String(req.params.key).toUpperCase();
  const runId = Number(req.params.id);
  try {
    const done = await prisma.$transaction(async (tx) => {
      const row = await tx.payrollRemittance.findUnique({ where: { runId_key: { runId, key } } });
      if (!row) return false;
      await tx.payrollRemittance.delete({ where: { id: row.id } });
      await auditOrThrow(tx as any, req, "PAYROLL_REMITTANCE_UNDONE", `PAYROLL_RUN:${runId}`, { key, amount: n(row.amount), paidOn: row.paidOn, reference: row.reference }, null, runId);
      return true;
    });
    if (!done) return res.status(404).json({ error: "That payment is not recorded" });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE payroll remittance error:", err?.message || err);
    res.status(500).json({ error: "Nothing was changed. Please try again." });
  }
});

/**
 * GET /remittances/open
 * Statutory payments still to make across paid runs of the last 18 months,
 * soonest first, with how many are overdue (for the sidebar and overview).
 */
router.get("/remittances/open", async (_req, res) => {
  try {
    const since = new Date(Date.now() - 548 * 86_400_000).toISOString().slice(0, 7);
    const runs = await prisma.payrollRun.findMany({ where: { status: "PAID", periodMonth: { gte: since } }, include: { payslips: true, remittances: { select: { key: true } } } });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const items = runs.flatMap((run: any) => {
      const done = new Set(run.remittances.map((r: any) => r.key));
      const totals = sumPayslips(run.payslips.map((l: any) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, n(v)]))));
      return remittances(totals, run.periodMonth)
        .filter((r) => !done.has(r.key))
        .map((r) => ({ ...r, runId: run.id, runNumber: run.runNumber, periodMonth: run.periodMonth, overdue: r.dueOn < today }));
    }).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    res.json({ items, overdue: items.filter((i) => i.overdue).length, total: items.reduce((s, i) => s + i.amount, 0) });
  } catch (err: any) {
    console.error("GET payroll remittances/open error:", err?.message || err);
    res.status(500).json({ error: "Could not load the statutory payments" });
  }
});

export default router;
