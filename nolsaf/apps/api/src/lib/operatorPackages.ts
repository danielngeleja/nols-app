/**
 * Tour operator packages: what is actually live, read the way the public site
 * reads it (routes/public.tourBookings.ts approvedProfile + the package status
 * check), plus a reconciler that keeps the TourPackage catalogue copy equal to
 * that truth.
 *
 * Where packages live:
 *  - Agent.operatorProfile.packageItems: the operator's working copy.
 *  - operatorProfile.approvedSnapshot.packageItems: what an admin approved.
 *    The public site sells only these, and only while the profile review
 *    status is APPROVED.
 *  - operatorProfile.removedPackages: packages the operator took down.
 *  - TourPackage rows: a structured copy for reporting. It must never be read
 *    as the source of truth; reconcileTourPackages keeps it in step.
 *
 * Package key: item.id, or its position when it has no id (same as the public
 * booking lookup and the old sync).
 */
import { prisma } from "@nolsaf/prisma";
import { readRemovedPackages } from "./operatorPackageRemoval.js";

export type PackageState = "LIVE" | "LIVE_WITH_CHANGES" | "NOT_APPROVED" | "PAUSED" | "REMOVED";

/**
 * THE rule for what travellers see of an operator. Every public surface
 * (listing, profile page, booking, verification certificate, Agency Desk) and
 * every report that claims "public" must use this, never its own copy.
 *
 *  - Review APPROVED: the approved snapshot (or the profile itself if an old
 *    approval has no snapshot).
 *  - Review PENDING with an approved snapshot: the operator has submitted
 *    changes; the approved version stays on sale until an admin decides
 *    (decided by Daniel 2026-11-18). Before this, every edit took the
 *    operator off sale for the length of the review.
 *  - Anything else (never approved, or changes rejected): nothing is public.
 *
 * The account itself must also be ACTIVE; callers check that on the Agent row.
 */
export function publicOperatorProfile(operatorProfile: unknown): Record<string, any> | null {
  if (!operatorProfile || typeof operatorProfile !== "object" || Array.isArray(operatorProfile)) return null;
  const profile = operatorProfile as Record<string, any>;
  const status = String(profile.reviewStatus || profile.review?.status || "").toUpperCase();
  const snapshot = profile.approvedSnapshot && typeof profile.approvedSnapshot === "object" && !Array.isArray(profile.approvedSnapshot)
    ? (profile.approvedSnapshot as Record<string, any>)
    : null;
  if (status === "APPROVED") return snapshot ?? profile;
  if (status === "PENDING" && snapshot) return snapshot;
  return null;
}

/** Package statuses the public booking route accepts (absent means approved). */
const SELLABLE = new Set(["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"]);

export type RegisterPackage = {
  key: string;
  name: string | null;
  destination: string | null;
  category: string | null;
  currency: string;
  pricePerPerson: number;
  state: PackageState;
  /** Missing basics a traveller would notice. */
  problems: string[];
  removedAt: string | null;
  /** The item travellers see when live, else the working copy. */
  item: Record<string, any>;
};

export type PackageRegister = {
  /** Travellers can see this operator's approved version right now. */
  profileApproved: boolean;
  /** Changes are waiting for review; the approved version stays on sale. */
  underReview: boolean;
  approvedAt: string | null;
  packages: RegisterPackage[];
};

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const keyOf = (item: unknown, index: number) => String(obj(item).id || index).slice(0, 120);
const text = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s || null;
};
const price = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** Stable comparison that ignores key order. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort().reduce((acc: Record<string, unknown>, k) => { acc[k] = (value as any)[k]; return acc; }, {})
    : value);

function describe(item: Record<string, any>, key: string, state: PackageState, removedAt: string | null): RegisterPackage {
  const name = text(item.name ?? item.title);
  const destination = text(item.destination);
  const pricePerPerson = price(item.pricePerPerson);
  const problems = [
    !name ? "No name" : null,
    !pricePerPerson ? "No price" : null,
    !destination ? "No destination" : null,
  ].filter((p): p is string => Boolean(p));
  return {
    key, name, destination, category: text(item.category),
    currency: String(item.currency || "TZS").toUpperCase().slice(0, 3),
    pricePerPerson, state, problems, removedAt, item,
  };
}

/** Pure: every package the operator has, with its real public state. */
export function operatorPackageRegister(operatorProfile: unknown): PackageRegister {
  const profile = obj(operatorProfile);
  const reviewStatus = String(profile.reviewStatus || profile.review?.status || "").toUpperCase();
  const publicProfile = publicOperatorProfile(profile);
  const profileApproved = publicProfile !== null;
  const approved = obj(publicProfile);

  const liveByKey = new Map<string, Record<string, any>>();
  list(approved.packageItems).forEach((item, index) => liveByKey.set(keyOf(item, index), obj(item)));

  const out: RegisterPackage[] = [];
  const seen = new Set<string>();

  list(profile.packageItems).forEach((raw, index) => {
    const item = obj(raw);
    const key = keyOf(item, index);
    seen.add(key);
    const live = liveByKey.get(key);
    if (live) {
      const sellable = SELLABLE.has(String(live.status || "APPROVED").toUpperCase());
      if (!sellable) out.push(describe(live, key, "PAUSED", null));
      else out.push(describe(live, key, canon(live) === canon(item) ? "LIVE" : "LIVE_WITH_CHANGES", null));
    } else {
      out.push(describe(item, key, "NOT_APPROVED", null));
    }
  });

  // Still in the approved copy but no longer in the working copy and not
  // removed: the public site keeps selling it, so it is live.
  const removed = readRemovedPackages(profile);
  const removedKeys = new Set(removed.map((r) => String(r.item?.id || "")).filter(Boolean));
  liveByKey.forEach((live, key) => {
    if (seen.has(key) || removedKeys.has(key)) return;
    const sellable = SELLABLE.has(String(live.status || "APPROVED").toUpperCase());
    out.push(describe(live, key, sellable ? "LIVE" : "PAUSED", null));
    seen.add(key);
  });

  for (const r of removed) {
    const key = String(r.item?.id || "").slice(0, 120);
    if (!key || seen.has(key)) continue;
    out.push(describe(obj(r.item), key, "REMOVED", r.removedAt));
    seen.add(key);
  }

  return { profileApproved, underReview: profileApproved && reviewStatus === "PENDING", approvedAt: text(profile.approvedAt), packages: out };
}

const CATALOGUE_STATUS: Record<PackageState, "PUBLISHED" | "DRAFT" | "ARCHIVED"> = {
  LIVE: "PUBLISHED",
  LIVE_WITH_CHANGES: "PUBLISHED", // travellers still see the approved version
  PAUSED: "DRAFT",
  NOT_APPROVED: "DRAFT",
  REMOVED: "ARCHIVED",
};

const asInt = (v: unknown) => {
  const n = Math.trunc(price(v));
  return n > 0 ? n : null;
};

/**
 * Make the TourPackage copy equal to what travellers see. Called after every
 * profile save, approval, package removal and restore. Never throws into the
 * caller's request: a stale reporting copy must not fail a real write.
 *
 * Content changes to a published package start a new version and archive the
 * old one, so earlier bookings keep pointing at what was actually sold.
 */
export async function reconcileTourPackages(operatorAgentId: number, operatorProfile: unknown): Promise<void> {
  try {
    const register = operatorPackageRegister(operatorProfile);
    const now = new Date();
    for (const pkg of register.packages) {
      const status = CATALOGUE_STATUS[pkg.state];
      const latest = await prisma.tourPackage.findFirst({
        where: { operatorAgentId, legacyPackageId: pkg.key },
        orderBy: { version: "desc" },
      });

      if (status === "ARCHIVED") {
        await prisma.tourPackage.updateMany({
          where: { operatorAgentId, legacyPackageId: pkg.key, status: { not: "ARCHIVED" } },
          data: { status: "ARCHIVED", archivedAt: pkg.removedAt ? new Date(pkg.removedAt) : now },
        });
        continue;
      }

      const content = pkg.item as any;
      const fields = {
        name: (pkg.name || "Untitled package").slice(0, 200),
        destination: pkg.destination?.slice(0, 200) ?? null,
        category: pkg.category?.slice(0, 100) ?? null,
        currency: pkg.currency,
        pricePerPerson: pkg.pricePerPerson,
        minPax: asInt(pkg.item.minPax),
        maxPax: asInt(pkg.item.maxPax),
        content,
      };
      const publishedAt = status === "PUBLISHED"
        ? (latest?.status === "PUBLISHED" && latest.publishedAt ? latest.publishedAt : register.approvedAt ? new Date(register.approvedAt) : now)
        : null;

      if (!latest) {
        await prisma.tourPackage.create({ data: { operatorAgentId, legacyPackageId: pkg.key, version: 1, status, publishedAt, archivedAt: null, ...fields } });
        continue;
      }
      const sameContent = canon(latest.content) === canon(content);
      if (!sameContent && latest.status === "ARCHIVED") {
        // A removed package came back changed: keep the archived version as it was.
        await prisma.tourPackage.create({
          data: {
            operatorAgentId, legacyPackageId: pkg.key, version: latest.version + 1, status,
            publishedAt: status === "PUBLISHED" ? now : null, archivedAt: null, ...fields,
          },
        });
        continue;
      }
      if (!sameContent && latest.status === "PUBLISHED") {
        // What was sold stays on record as its own version.
        await prisma.$transaction([
          prisma.tourPackage.update({ where: { id: latest.id }, data: { status: "ARCHIVED", archivedAt: now } }),
          prisma.tourPackage.create({
            data: {
              operatorAgentId, legacyPackageId: pkg.key, version: latest.version + 1, status,
              publishedAt: status === "PUBLISHED" ? (register.approvedAt ? new Date(register.approvedAt) : now) : null,
              archivedAt: null, ...fields,
            },
          }),
        ]);
        continue;
      }
      if (sameContent && latest.status === status && (status !== "PUBLISHED" || latest.publishedAt)) continue;
      await prisma.tourPackage.update({ where: { id: latest.id }, data: { status, publishedAt, archivedAt: null, ...fields } });
    }
  } catch (err: any) {
    console.error("[tourPackages] catalogue reconcile failed", operatorAgentId, err?.message || err);
  }
}
