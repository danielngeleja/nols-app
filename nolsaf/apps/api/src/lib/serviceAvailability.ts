import { prisma } from "@nolsaf/prisma";
import { BANK_PROVIDER_CATALOG } from "./azampay.helpers.js";

const DEFAULT_TRANSPORT_LOCKED_REASON =
  "We don't have drivers in this area yet. You can continue with the stay booking only.";

export type KnownPaymentProvider = {
  provider: string;
  label: string;
  defaultEnabled: boolean;
  defaultReason: string | null;
};

const NOT_CONFIGURED_REASON = "This payment method is not configured for checkout yet.";

export const KNOWN_PAYMENT_PROVIDERS: KnownPaymentProvider[] = [
  { provider: "Airtel", label: "Airtel Money", defaultEnabled: true, defaultReason: null },
  { provider: "Mpesa", label: "Mpesa", defaultEnabled: true, defaultReason: null },
  { provider: "Tigo", label: "Tigo Pesa", defaultEnabled: true, defaultReason: null },
  { provider: "Halopesa", label: "HaloPesa", defaultEnabled: true, defaultReason: null },
  { provider: "Azampesa", label: "AzamPesa", defaultEnabled: true, defaultReason: null },
  { provider: "CARD", label: "Debit / Credit Card", defaultEnabled: true, defaultReason: null },
  ...BANK_PROVIDER_CATALOG.map((bank) => ({
    provider: `BANK_${bank.code}`,
    label: bank.label,
    defaultEnabled: bank.checkoutEnabled,
    defaultReason: bank.checkoutEnabled ? null : NOT_CONFIGURED_REASON,
  })),
];

/**
 * True once the gate tables exist. Only the positive result is cached: a
 * negative must stay re-probeable so applying the migration takes effect
 * without restarting the API.
 */
let transportTableAvailable = false;
async function hasTransportTable(): Promise<boolean> {
  if (transportTableAvailable) return true;
  try {
    await prisma.transportAvailability.findFirst({ select: { id: true } });
    transportTableAvailable = true;
  } catch (err: any) {
    if (err?.code === "P2021" || String(err?.message || "").includes("does not exist")) return false;
    throw err;
  }
  return transportTableAvailable;
}

let paymentTableAvailable = false;
async function hasPaymentTable(): Promise<boolean> {
  if (paymentTableAvailable) return true;
  try {
    await prisma.paymentMethodAvailability.findFirst({ select: { id: true } });
    paymentTableAvailable = true;
  } catch (err: any) {
    if (err?.code === "P2021" || String(err?.message || "").includes("does not exist")) return false;
    throw err;
  }
  return paymentTableAvailable;
}

export type GateResult = { enabled: boolean; reason: string | null };

/**
 * Opt-in geographic lookup: ward -> district -> region. Once the gate table
 * exists, no matching row means locked, so a newly-listed property never
 * offers transport until an admin explicitly opens that area.
 */
export async function getTransportAvailability(location: {
  regionName?: string | null;
  district?: string | null;
  ward?: string | null;
}): Promise<GateResult> {
  // Until the gate table exists there is nothing to enforce against, so keep
  // the pre-gate behavior (transport offered everywhere). Failing closed here
  // would take transport down for the window between code deploy and migration.
  if (!(await hasTransportTable())) return { enabled: true, reason: null };

  const regionName = (location.regionName || "").trim();
  const district = (location.district || "").trim();
  const ward = (location.ward || "").trim();

  // A property with no region recorded can't be matched against any coverage
  // row, so it stays locked rather than silently inheriting someone else's.
  if (!regionName) return { enabled: false, reason: DEFAULT_TRANSPORT_LOCKED_REASON };

  // Most specific scope wins: ward, then district, then the whole region.
  // "" is the stored sentinel for "applies to the whole parent scope".
  const candidates: Array<{ regionName: string; district: string; ward: string }> = [];
  if (ward && district) candidates.push({ regionName, district, ward });
  if (district) candidates.push({ regionName, district, ward: "" });
  candidates.push({ regionName, district: "", ward: "" });

  for (const where of candidates) {
    const row = await prisma.transportAvailability.findUnique({
      where: { regionName_district_ward: where },
    });
    if (row) return { enabled: row.isEnabled, reason: row.isEnabled ? null : (row.reason || DEFAULT_TRANSPORT_LOCKED_REASON) };
  }

  return { enabled: false, reason: DEFAULT_TRANSPORT_LOCKED_REASON };
}

/**
 * Opt-out global lookup: no matching row (or table not migrated yet) means
 * enabled, matching today's always-on behavior for already-wired providers.
 */
export async function getPaymentMethodAvailability(provider: string): Promise<GateResult> {
  if (!provider || !(await hasPaymentTable())) return { enabled: true, reason: null };

  const row = await prisma.paymentMethodAvailability.findUnique({ where: { provider } });
  if (!row) {
    const known = KNOWN_PAYMENT_PROVIDERS.find((candidate) => candidate.provider === provider);
    return known
      ? { enabled: known.defaultEnabled, reason: known.defaultEnabled ? null : known.defaultReason }
      : { enabled: true, reason: null };
  }
  return { enabled: row.isEnabled, reason: row.isEnabled ? null : (row.reason || "This payment method is temporarily unavailable.") };
}

/** All known providers merged with their current gate state, for the guest picker and admin UI. */
export async function listPaymentMethodAvailability() {
  type PaymentRow = { provider: string; label: string; isEnabled: boolean; reason: string | null };
  const rows: PaymentRow[] = (await hasPaymentTable()) ? await prisma.paymentMethodAvailability.findMany() : [];
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return KNOWN_PAYMENT_PROVIDERS.map(({ provider, label, defaultEnabled, defaultReason }) => {
    const row = byProvider.get(provider);
    return {
      provider,
      label: row?.label || label,
      isEnabled: row ? row.isEnabled : defaultEnabled,
      reason: row
        ? (!row.isEnabled ? (row.reason || defaultReason) : null)
        : (!defaultEnabled ? defaultReason : null),
    };
  });
}

export async function listTransportAvailability() {
  if (!(await hasTransportTable())) return [];
  return prisma.transportAvailability.findMany({ orderBy: [{ regionName: "asc" }, { district: "asc" }, { ward: "asc" }] });
}
