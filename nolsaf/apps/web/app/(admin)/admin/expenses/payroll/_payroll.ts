/**
 * Client copy of the payslip arithmetic in apps/api/src/lib/payroll.ts, used
 * only to PREVIEW pay while an admin types. The server recalculates every
 * figure that is saved; keep the two in step when the rules change.
 */

export type PayeBand = { upTo: number | null; rate: number };
export type PayrollRates = {
  nssfEmployeePercent: number;
  nssfEmployerPercent: number;
  wcfPercent: number;
  sdlPercent: number;
  sdlMinEmployees: number;
  heslbPercent: number;
  payeBands: PayeBand[];
};

const whole = (n: number) => Math.round(Number.isFinite(n) ? n : 0);

export function payeFor(taxable: number, bands: PayeBand[]) {
  let tax = 0;
  let lower = 0;
  for (const band of bands) {
    const upper = band.upTo ?? Infinity;
    if (taxable <= lower) break;
    tax += (Math.min(taxable, upper) - lower) * (band.rate / 100);
    lower = upper;
  }
  return whole(tax);
}

export function previewPayslip(input: { basic: number; allowances: number; nssfEnrolled: boolean; payeExempt: boolean; sdlApplies: boolean; heslbDeduct?: boolean }, rates: PayrollRates) {
  const gross = whole(input.basic) + whole(input.allowances);
  const nssfEmployee = input.nssfEnrolled ? whole(gross * (rates.nssfEmployeePercent / 100)) : 0;
  const nssfEmployer = input.nssfEnrolled ? whole(gross * (rates.nssfEmployerPercent / 100)) : 0;
  const taxable = Math.max(0, gross - nssfEmployee);
  const paye = input.payeExempt ? 0 : payeFor(taxable, rates.payeBands);
  const heslb = input.heslbDeduct ? whole(gross * ((rates.heslbPercent ?? 15) / 100)) : 0;
  const net = gross - nssfEmployee - paye - heslb;
  const wcf = whole(gross * (rates.wcfPercent / 100));
  const sdl = input.sdlApplies ? whole(gross * (rates.sdlPercent / 100)) : 0;
  return { gross, nssfEmployee, taxable, paye, heslb, net, nssfEmployer, wcf, sdl, employerCost: gross + nssfEmployer + wcf + sdl };
}
