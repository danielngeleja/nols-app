import type { ExpediaCredentials } from "./expediaClient.js";

export type ExpediaAriPolicy = {
  minimumStay?: number | null;
  maximumStay?: number | null;
  closedOnArrival?: boolean | null;
  closedOnDeparture?: boolean | null;
};

export type ExpediaAriDateOverride = ExpediaAriPolicy & {
  from: string;
  to: string;
  price?: number | null;
  closed?: boolean | null;
};

export type ExpediaRatePolicy = ExpediaAriPolicy & {
  pricingMode?: "BASE" | "FIXED" | "OFFSET" | "MULTIPLIER" | null;
  pricingValue?: number | null;
  dateOverrides?: ExpediaAriDateOverride[] | null;
};

export type ResolvedExpediaRate = {
  price: number | null;
  closed: boolean;
  policy: ExpediaAriPolicy;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Resolve one mapped rate plan for one calendar date. Date overrides are
 * deliberately exact/ranged values so the generated ARI payload is auditable. */
export function resolveExpediaRateForDate(baseRate: number | null, policy: ExpediaRatePolicy | null, date: string): ResolvedExpediaRate {
  const source = policy ?? {};
  const mode = source.pricingMode ?? "BASE";
  const value = finite(source.pricingValue);
  let price = finite(baseRate);
  if (mode === "FIXED") price = value;
  else if (mode === "OFFSET") price = price == null || value == null ? null : price + value;
  else if (mode === "MULTIPLIER") price = price == null || value == null ? null : price * value;

  const override = (source.dateOverrides ?? []).find((entry) => entry.from <= date && entry.to >= date);
  if (override && finite(override.price) != null) price = finite(override.price);
  if (price != null) price = Math.round(price * 100) / 100;
  if (price != null && price < 0) price = null;

  return {
    price,
    closed: override?.closed === true,
    policy: {
      minimumStay: override?.minimumStay ?? source.minimumStay ?? null,
      maximumStay: override?.maximumStay ?? source.maximumStay ?? null,
      closedOnArrival: override?.closedOnArrival ?? source.closedOnArrival ?? null,
      closedOnDeparture: override?.closedOnDeparture ?? source.closedOnDeparture ?? null,
    },
  };
}

export type ExpediaAriUpdate = {
  roomId: string;
  rateId: string;
  from: string;
  to: string;
  roomsToSell: number;
  currency: string;
  price: number;
  closed?: boolean;
  policy?: ExpediaAriPolicy | null;
};

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function integer(value: number | null | undefined, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function updateXml(update: ExpediaAriUpdate): string {
  const policy = update.policy ?? {};
  const minLos = integer(policy.minimumStay, 1, 365);
  const maxLos = integer(policy.maximumStay, 1, 365);
  const restrictionAttributes = [
    `closed="${update.closed ? "true" : "false"}"`,
    minLos == null ? "" : `minLOS="${minLos}"`,
    maxLos == null ? "" : `maxLOS="${maxLos}"`,
    policy.closedOnArrival == null ? "" : `closedToArrival="${policy.closedOnArrival ? "true" : "false"}"`,
    policy.closedOnDeparture == null ? "" : `closedToDeparture="${policy.closedOnDeparture ? "true" : "false"}"`,
  ].filter(Boolean).join(" ");
  return `<AvailRateUpdate><DateRange from="${xml(update.from)}" to="${xml(update.to)}"/><RoomType id="${xml(update.roomId)}"><Inventory totalInventoryAvailable="${integer(update.roomsToSell, 0, 999) ?? 0}"/><RatePlan id="${xml(update.rateId)}"><Rate currency="${xml(update.currency.toUpperCase())}"><PerDay rate="${update.price.toFixed(2)}"/></Rate><Restrictions ${restrictionAttributes}/></RatePlan></RoomType></AvailRateUpdate>`;
}

/**
 * Expedia EQC Availability and Rates message. Credentials are injected only
 * immediately before transport and must never be stored in an outbox payload.
 */
export function buildExpediaAvailabilityXml(input: {
  credentials: ExpediaCredentials;
  propertyId: string;
  updates: ExpediaAriUpdate[];
}): string {
  if (!input.credentials.username || !input.credentials.password) throw new Error("Expedia ARI credentials are required");
  if (!input.propertyId.trim()) throw new Error("Expedia property ID is required");
  if (!input.updates.length) throw new Error("Expedia availability payload has no updates");
  if (input.updates.length > 5_000) throw new Error("Expedia availability payload exceeds 5,000 updates");
  return `<?xml version="1.0" encoding="UTF-8"?><AvailRateUpdateRQ xmlns="http://www.expediaconnect.com/EQC/AR/2011/06"><Authentication username="${xml(input.credentials.username)}" password="${xml(input.credentials.password)}"/><Hotel id="${xml(input.propertyId)}"/>${input.updates.map(updateXml).join("")}</AvailRateUpdateRQ>`;
}
