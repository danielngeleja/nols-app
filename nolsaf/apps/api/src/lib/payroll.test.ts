import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_RATES, computePayslip, daysPaidIn, normalizeRates, payeFor, remittances, sumPayslips } from "./payroll.js";

const bands = DEFAULT_PAYROLL_RATES.payeBands;

describe("payeFor", () => {
  it("is zero up to the tax-free band", () => {
    expect(payeFor(270_000, bands)).toBe(0);
    expect(payeFor(100_000, bands)).toBe(0);
  });

  it("taxes each band at its own rate", () => {
    expect(payeFor(450_000, bands)).toBe(14_400); // 8% of 180,000
    expect(payeFor(520_000, bands)).toBe(20_000);
    expect(payeFor(760_000, bands)).toBe(68_000); // 20,000 + 20% of 240,000
    expect(payeFor(1_000_000, bands)).toBe(128_000); // 68,000 + 25% of 240,000
    expect(payeFor(1_350_000, bands)).toBe(233_000); // 128,000 + 30% of 350,000
  });
});

describe("computePayslip", () => {
  it("deducts NSSF before PAYE and adds employer costs on top", () => {
    const p = computePayslip({ basicSalary: 1_200_000, allowances: 300_000, nssfEnrolled: true }, DEFAULT_PAYROLL_RATES, true);
    expect(p.gross).toBe(1_500_000);
    expect(p.nssfEmployee).toBe(150_000);
    expect(p.taxable).toBe(1_350_000);
    expect(p.paye).toBe(233_000);
    expect(p.net).toBe(1_500_000 - 150_000 - 233_000);
    expect(p.nssfEmployer).toBe(150_000);
    expect(p.wcf).toBe(7_500);
    expect(p.sdl).toBe(52_500);
    expect(p.employerCost).toBe(1_500_000 + 150_000 + 7_500 + 52_500);
  });

  it("leaves out SDL below the headcount and NSSF when not enrolled", () => {
    const p = computePayslip({ basicSalary: 500_000, allowances: 0, nssfEnrolled: false }, DEFAULT_PAYROLL_RATES, false);
    expect(p.nssfEmployee).toBe(0);
    expect(p.nssfEmployer).toBe(0);
    expect(p.sdl).toBe(0);
    expect(p.taxable).toBe(500_000);
    expect(p.paye).toBe(18_400); // 8% of 230,000
  });

  it("includes one-off pay and deductions for the month", () => {
    const p = computePayslip({ basicSalary: 400_000, allowances: 0, overtime: 50_000, bonus: 50_000, loanDeduction: 20_000, otherDeductions: 5_000, nssfEnrolled: true }, DEFAULT_PAYROLL_RATES, false);
    expect(p.gross).toBe(500_000);
    expect(p.totalDeductions).toBe(50_000 + p.paye + 25_000);
    expect(p.net).toBe(500_000 - p.totalDeductions);
  });
});

describe("normalizeRates", () => {
  it("falls back field by field and always ends with an open band", () => {
    const r = normalizeRates({ sdlPercent: 4, payeBands: [{ upTo: 300_000, rate: 0 }, { upTo: 600_000, rate: 10 }] });
    expect(r.sdlPercent).toBe(4);
    expect(r.nssfEmployeePercent).toBe(10);
    expect(r.payeBands[r.payeBands.length - 1].upTo).toBeNull();
  });
});

describe("remittances", () => {
  it("dates TRA items on the 7th and NSSF/WCF at the end of the next month", () => {
    const totals = sumPayslips([{ paye: 100, sdl: 10, nssfEmployee: 50, nssfEmployer: 50, wcf: 5 }]);
    const r = remittances(totals, "2026-10");
    expect(r.find((x) => x.key === "PAYE")?.dueOn).toBe("2026-11-07");
    expect(r.find((x) => x.key === "NSSF")?.dueOn).toBe("2026-11-30");
    expect(r.find((x) => x.key === "NSSF")?.amount).toBe(100);
  });
});

describe("HESLB and part-month pay", () => {
  it("takes HESLB from salary after PAYE, not from one-off pay", () => {
    const p = computePayslip({ basicSalary: 800_000, allowances: 200_000, bonus: 100_000, nssfEnrolled: true, heslbDeduct: true }, DEFAULT_PAYROLL_RATES, false);
    expect(p.heslb).toBe(150_000); // 15% of 1,000,000
    expect(p.totalDeductions).toBe(p.nssfEmployee + p.paye + 150_000);
    expect(p.net).toBe(p.gross - p.totalDeductions);
    expect(p.employerCost).toBe(p.gross + p.nssfEmployer + p.wcf);
  });

  it("pays joiners and leavers for their calendar days", () => {
    expect(daysPaidIn("2026-10", new Date("2026-10-20T00:00:00+03:00"), null)).toEqual({ daysPaid: 12, periodDays: 31 });
    expect(daysPaidIn("2026-10", new Date("2025-01-01T00:00:00+03:00"), new Date("2026-10-05T00:00:00+03:00"))).toEqual({ daysPaid: 5, periodDays: 31 });
    expect(daysPaidIn("2026-10", new Date("2025-01-01T00:00:00+03:00"), null)).toBeNull();
    const p = computePayslip({ basicSalary: 3_100_000, allowances: 0, overtime: 50_000, nssfEnrolled: false, daysPaid: 12, periodDays: 31 }, DEFAULT_PAYROLL_RATES, false);
    expect(p.basicSalary).toBe(1_200_000);
    expect(p.gross).toBe(1_250_000);
  });

  it("dates HESLB on the 15th of the next month", () => {
    const r = remittances(sumPayslips([{ heslb: 150_000 }]), "2026-10");
    expect(r.find((x) => x.key === "HESLB")?.dueOn).toBe("2026-11-15");
  });
});
