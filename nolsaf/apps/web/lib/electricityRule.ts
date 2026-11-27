/**
 * Who pays for electricity during a nightly stay. Stored on the listing as
 * services.houseRules.electricity; checked on the server by
 * apps/api/src/lib/electricityRule.ts (same shape). No rule means included.
 *
 *   INCLUDED    in the price (default)
 *   GUEST_PAYS  the guest buys LUKU tokens for the whole stay
 *   LIMITED     included up to freeUnitsPerDay units a day, then the guest tops up
 */
export type ElectricityMode = "INCLUDED" | "GUEST_PAYS" | "LIMITED";
export type ElectricityRule = { mode: ElectricityMode; perDayTzs?: number | null; freeUnitsPerDay?: number | null };

export function readElectricityRule(value: unknown): ElectricityRule {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const mode = raw?.mode === "GUEST_PAYS" || raw?.mode === "LIMITED" ? raw.mode : "INCLUDED";
  const perDay = Number(raw?.perDayTzs);
  const units = Number(raw?.freeUnitsPerDay);
  return {
    mode,
    perDayTzs: Number.isFinite(perDay) && perDay > 0 ? Math.round(perDay) : null,
    freeUnitsPerDay: Number.isFinite(units) && units > 0 ? Math.round(units) : null,
  };
}

/** True when the guest pays for some or all of the electricity. */
export function guestPaysElectricity(rule: ElectricityRule): boolean {
  return rule.mode !== "INCLUDED";
}

const tzs = (n: number) => `TSh ${Math.round(n).toLocaleString("en-US")}`;

/** One short line for the price area and the booking summary. */
export function electricityHeadline(rule: ElectricityRule): string {
  if (rule.mode === "GUEST_PAYS") return "Electricity not included: you buy LUKU tokens";
  if (rule.mode === "LIMITED") return `Electricity included up to ${rule.freeUnitsPerDay ?? "a set number of"} units a day, then you top up`;
  return "Electricity included";
}

/** The estimate, when the owner gave one: "About TSh 3,000 a day". */
export function electricityEstimate(rule: ElectricityRule): string | null {
  return rule.mode !== "INCLUDED" && rule.perDayTzs ? `About ${tzs(rule.perDayTzs)} a day` : null;
}

/** The sentence a guest ticks before paying. */
export function electricityConsent(rule: ElectricityRule): string {
  return rule.mode === "LIMITED"
    ? `I understand electricity is included only up to ${rule.freeUnitsPerDay ?? "a set number of"} units a day, and I pay for any extra LUKU tokens.`
    : "I understand electricity is not included and I pay for the LUKU tokens I use during my stay.";
}
