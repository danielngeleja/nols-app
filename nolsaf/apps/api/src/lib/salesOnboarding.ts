// apps/api/src/lib/salesOnboarding.ts
// Where each attributed property stands between "converted" and "earning".
// Every stage is derived from records that already exist (property status,
// site verification, attribution, NRMS activation and billing, bookings and
// commissions), so the tracker needs no schema of its own and cannot drift.
import { REAL_BOOKING_STATUSES } from "./bookingStatus.js";

export type OnboardingStageKey =
  | "CONVERTED"
  | "LISTING_APPROVED"
  | "SITE_VERIFIED"
  | "EARNING_ACTIVE"
  | "NRMS_ACTIVATED"
  | "FIRST_NRMS_BILL_PAID"
  | "FIRST_BOOKING"
  | "FIRST_COMMISSION";

export type OnboardingStage = {
  key: OnboardingStageKey;
  label: string;
  state: "DONE" | "CURRENT" | "UPCOMING" | "BLOCKED";
  /** When the stage was reached, when the records carry a date. */
  at: string | null;
  /** What the partner can do to move it forward (only on the current or blocked stage). */
  hint: string | null;
};

export type Onboarding = {
  stages: OnboardingStage[];
  completed: number;
  total: number;
  /** The stage the partner should act on next, or null once fully onboarded. */
  current: OnboardingStageKey | null;
  blocked: boolean;
};

export type OnboardingInput = {
  propertyStatus: string;
  nrmsActivatedAt: Date | null;
  attributions: Array<{ productType: string; status: string; verifiedAt: Date | null; commissionStartsAt: Date | null }>;
  siteVerified: boolean;
  siteVerifiedAt: Date | null;
  firstNrmsBillPaidAt: Date | null;
  firstBookingAt: Date | null;
  firstCommissionAt: Date | null;
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const earliest = (dates: Array<Date | null>) =>
  dates.filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

const HINTS: Record<OnboardingStageKey, string> = {
  CONVERTED: "Waiting for NoLSAF to approve your conversion request.",
  LISTING_APPROVED: "NoLSAF is reviewing the listing. Help the owner finish photos, rooms and prices so it can be approved.",
  SITE_VERIFIED: "A NoLSAF site visit confirms the property. Make sure the owner is reachable to book the visit.",
  EARNING_ACTIVE: "NoLSAF activates your earning once the attribution is confirmed. No action needed from you.",
  NRMS_ACTIVATED: "Help the owner switch on NRMS from their dashboard so the hotel starts running on it.",
  FIRST_NRMS_BILL_PAID: "The first NRMS bill has not been paid yet. Remind the owner to settle it to keep NRMS active.",
  FIRST_BOOKING: "No guest has booked yet. Encourage the owner to share their NoLSAF page and keep availability open.",
  FIRST_COMMISSION: "Your first commission is recorded once revenue arrives inside your earning window.",
};

export function buildOnboarding(input: OnboardingInput): Onboarding {
  const products = new Set(input.attributions.map((a) => a.productType));
  const sellsNrms = products.has("NRMS");
  const sellsMarketplace = products.has("MARKETPLACE");
  const status = String(input.propertyStatus || "").toUpperCase();
  const listingBlocked = status === "REJECTED" || status === "SUSPENDED";

  const reached: Array<{ key: OnboardingStageKey; label: string; done: boolean; at: Date | null }> = [
    {
      key: "CONVERTED",
      label: "Conversion approved",
      done: input.attributions.some((a) => a.verifiedAt != null || a.status === "VERIFIED" || a.status === "ACTIVE"),
      at: earliest(input.attributions.map((a) => a.verifiedAt)),
    },
    { key: "LISTING_APPROVED", label: "Listing approved", done: status === "APPROVED", at: null },
    { key: "SITE_VERIFIED", label: "Verified on site", done: input.siteVerified, at: input.siteVerifiedAt },
    {
      key: "EARNING_ACTIVE",
      label: "Earning activated",
      done: input.attributions.some((a) => a.status === "ACTIVE"),
      at: earliest(input.attributions.filter((a) => a.status === "ACTIVE").map((a) => a.commissionStartsAt)),
    },
    ...(sellsNrms
      ? [
          { key: "NRMS_ACTIVATED" as const, label: "NRMS switched on", done: input.nrmsActivatedAt != null, at: input.nrmsActivatedAt },
          { key: "FIRST_NRMS_BILL_PAID" as const, label: "First NRMS bill paid", done: input.firstNrmsBillPaidAt != null, at: input.firstNrmsBillPaidAt },
        ]
      : []),
    ...(sellsMarketplace
      ? [{ key: "FIRST_BOOKING" as const, label: "First guest booking", done: input.firstBookingAt != null, at: input.firstBookingAt }]
      : []),
    { key: "FIRST_COMMISSION", label: "First commission earned", done: input.firstCommissionAt != null, at: input.firstCommissionAt },
  ];

  // The first stage not yet done is where attention goes; later ones wait.
  const currentIndex = reached.findIndex((s) => !s.done);
  const stages: OnboardingStage[] = reached.map((s, index) => {
    const isListingProblem = s.key === "LISTING_APPROVED" && listingBlocked;
    const state: OnboardingStage["state"] = s.done
      ? "DONE"
      : isListingProblem
        ? "BLOCKED"
        : index === currentIndex
          ? "CURRENT"
          : "UPCOMING";
    const hint =
      state === "BLOCKED"
        ? status === "SUSPENDED"
          ? "The listing is suspended. Contact NoLSAF support to find out what the owner needs to fix."
          : "The listing was rejected. Ask the owner to correct it and resubmit, or contact NoLSAF support."
        : state === "CURRENT"
          ? HINTS[s.key]
          : null;
    return { key: s.key, label: s.label, state, at: iso(s.at), hint };
  });

  const completed = stages.filter((s) => s.state === "DONE").length;
  return {
    stages,
    completed,
    total: stages.length,
    current: currentIndex === -1 ? null : reached[currentIndex].key,
    blocked: stages.some((s) => s.state === "BLOCKED"),
  };
}

type DbLike = any;

type PropertyForOnboarding = {
  id: number;
  status: string;
  nrmsActivatedAt: Date | null;
  salesAttributions: Array<{ productType: string; status: string; verifiedAt?: Date | null; commissionStartsAt: Date | null }>;
};

/** Batched: a fixed handful of queries however many properties are passed. */
export async function loadOnboarding(db: DbLike, partnerId: number, properties: PropertyForOnboarding[]): Promise<Map<number, Onboarding>> {
  const ids = properties.map((p) => p.id);
  const result = new Map<number, Onboarding>();
  if (!ids.length) return result;

  const [verifications, paygAccounts, bookings, commissions] = await Promise.all([
    db.propertyVerification.findMany({
      where: { propertyId: { in: ids }, status: "VERIFIED" },
      select: { propertyId: true, verifiedAt: true },
    }),
    db.ownerPaygAccount.findMany({ where: { propertyId: { in: ids } }, select: { id: true, propertyId: true } }),
    db.booking.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: ids }, status: { in: [...REAL_BOOKING_STATUSES] } },
      _min: { createdAt: true },
    }),
    db.salesCommission.groupBy({
      by: ["propertyId"],
      where: { salesPartnerId: partnerId, propertyId: { in: ids }, status: { notIn: ["CANCELLED", "REVERSED"] } },
      _min: { earnedAt: true },
    }),
  ]);

  const accountIds = paygAccounts.map((a: any) => a.id);
  const paidBills = accountIds.length
    ? await db.nrmsBillingStatement.groupBy({
        by: ["accountId"],
        where: { accountId: { in: accountIds }, status: "PAID", paidAt: { not: null } },
        _min: { paidAt: true },
      })
    : [];

  const verifiedAt = new Map<number, Date | null>(verifications.map((v: any) => [v.propertyId, v.verifiedAt ?? null]));
  const propertyByAccount = new Map<number, number>(paygAccounts.map((a: any) => [a.id, a.propertyId]));
  const firstBill = new Map<number, Date>();
  for (const row of paidBills) {
    const propertyId = propertyByAccount.get(row.accountId);
    if (propertyId && row._min?.paidAt) firstBill.set(propertyId, row._min.paidAt);
  }
  const firstBooking = new Map<number, Date>(bookings.filter((b: any) => b._min?.createdAt).map((b: any) => [b.propertyId, b._min.createdAt]));
  const firstCommission = new Map<number, Date>(commissions.filter((c: any) => c._min?.earnedAt).map((c: any) => [c.propertyId, c._min.earnedAt]));

  for (const property of properties) {
    result.set(
      property.id,
      buildOnboarding({
        propertyStatus: property.status,
        nrmsActivatedAt: property.nrmsActivatedAt,
        attributions: property.salesAttributions.map((a) => ({
          productType: a.productType,
          status: a.status,
          verifiedAt: a.verifiedAt ?? null,
          commissionStartsAt: a.commissionStartsAt,
        })),
        siteVerified: verifiedAt.has(property.id),
        siteVerifiedAt: verifiedAt.get(property.id) ?? null,
        firstNrmsBillPaidAt: firstBill.get(property.id) ?? null,
        firstBookingAt: firstBooking.get(property.id) ?? null,
        firstCommissionAt: firstCommission.get(property.id) ?? null,
      }),
    );
  }
  return result;
}
