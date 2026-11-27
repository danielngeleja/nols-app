/**
 * Who pays for electricity during a nightly stay (services.houseRules.electricity).
 * The web copy is apps/web/lib/electricityRule.ts. No rule means included.
 */
export type ElectricityMode = "INCLUDED" | "GUEST_PAYS" | "LIMITED";
export type ElectricityRule = { mode: ElectricityMode; perDayTzs: number | null; freeUnitsPerDay: number | null };

/**
 * Only known modes and sane numbers are kept: the estimate is TZS 1 to
 * 500,000 a day, free units 1 to 1,000 a day. LIMITED needs its unit count,
 * otherwise it is stored as GUEST_PAYS (the guest is never told less than the truth).
 * Returns null for INCLUDED so nothing is stored for the default.
 */
export function sanitizeElectricityRule(value: unknown): ElectricityRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.mode !== "GUEST_PAYS" && raw.mode !== "LIMITED") return null;
  const perDay = Math.round(Number(raw.perDayTzs));
  const units = Math.round(Number(raw.freeUnitsPerDay));
  const perDayTzs = Number.isFinite(perDay) && perDay >= 1 && perDay <= 500_000 ? perDay : null;
  const freeUnitsPerDay = Number.isFinite(units) && units >= 1 && units <= 1_000 ? units : null;
  if (raw.mode === "LIMITED" && !freeUnitsPerDay) return { mode: "GUEST_PAYS", perDayTzs, freeUnitsPerDay: null };
  return { mode: raw.mode, perDayTzs, freeUnitsPerDay: raw.mode === "LIMITED" ? freeUnitsPerDay : null };
}

/** House rules with the electricity rule cleaned (or dropped when included). */
export function withCleanElectricity(houseRules: unknown): unknown {
  if (!houseRules || typeof houseRules !== "object" || Array.isArray(houseRules)) return houseRules;
  const { electricity, ...rest } = houseRules as Record<string, unknown>;
  const clean = sanitizeElectricityRule(electricity);
  return clean ? { ...rest, electricity: clean } : rest;
}

/** The stored rule from a property's services JSON, or null when electricity is included. */
export function readElectricityRuleFromServices(services: unknown): ElectricityRule | null {
  let parsed: any = services;
  if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
  let rules: any = parsed?.houseRules;
  if (typeof rules === "string") { try { rules = JSON.parse(rules); } catch { rules = null; } }
  return sanitizeElectricityRule(rules?.electricity);
}

/** One line for confirmations: null when electricity is included. */
export function electricityNotice(services: unknown): string | null {
  let parsed: any = services;
  if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
  let rules: any = parsed?.houseRules;
  if (typeof rules === "string") { try { rules = JSON.parse(rules); } catch { rules = null; } }
  const rule = sanitizeElectricityRule(rules?.electricity);
  if (!rule) return null;
  const estimate = rule.perDayTzs ? ` (about TSh ${rule.perDayTzs.toLocaleString("en-US")} a day)` : "";
  return rule.mode === "LIMITED"
    ? `Electricity is included up to ${rule.freeUnitsPerDay} units a day; you buy LUKU tokens for anything more${estimate}.`
    : `Electricity is not included: you buy LUKU tokens for your stay${estimate}.`;
}
