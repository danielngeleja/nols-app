/**
 * Guards around the Tour Operator Disbursement Policy that are about process,
 * not arithmetic:
 *
 *  1. Notice. A change that is worse for operators must take effect at least
 *     TOUR_PAYOUT_NOTICE_DAYS after it was announced (operator agreement), and
 *     published versions are append-only.
 *  2. Drift. The public policy page must state the same numbers the server
 *     enforces, for the latest published version.
 *
 * If this file fails after you changed a policy number: add a new entry to
 * TOUR_PAYOUT_POLICY_HISTORY with honest announcedAt / effectiveFrom dates and
 * update the public page in the same change.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LATEST_TOUR_PAYOUT_POLICY,
  TOUR_PAYOUT_NOTICE_DAYS,
  TOUR_PAYOUT_POLICY_HISTORY,
  tierRank,
  tourPayoutPolicyAt,
  type TourPayoutTerms,
} from "../lib/tourPayoutPolicy";

const DAY = 24 * 60 * 60 * 1000;

/** For each term: true when the new value is worse for the operator than the old one. */
const WORSE_FOR_OPERATOR: { [K in keyof TourPayoutTerms]: (oldV: TourPayoutTerms[K], newV: TourPayoutTerms[K]) => boolean } = {
  advanceOpensDaysBefore: (o, n) => n < o, // opens later
  advanceFullWindowHours: (o, n) => n < o, // no-paperwork 70% starts later
  advanceBasePercent: (o, n) => n < o,
  advanceMaxPercent: (o, n) => n < o,
  advanceCoolingOffHours: (o, n) => n > o, // waits longer after payment
  advanceMinTier: (o, n) => tierRank(n) > tierRank(o), // fewer operators qualify
  balanceDisputeWindowHours: (o, n) => n > o, // balance paid later
  openAdvanceLimit: (o, n) => !o && n, // a new reason to refuse an advance
};

describe("notice before a worse payout change", () => {
  it("keeps versions in order, with unique names", () => {
    const names = TOUR_PAYOUT_POLICY_HISTORY.map((v) => v.version);
    expect(new Set(names).size).toBe(names.length);
    for (let i = 1; i < TOUR_PAYOUT_POLICY_HISTORY.length; i++) {
      const prev = new Date(TOUR_PAYOUT_POLICY_HISTORY[i - 1].effectiveFrom).getTime();
      const cur = new Date(TOUR_PAYOUT_POLICY_HISTORY[i].effectiveFrom).getTime();
      expect(cur, `${names[i]} must take effect after ${names[i - 1]}`).toBeGreaterThan(prev);
    }
  });

  it("never takes effect before it was announced", () => {
    for (const v of TOUR_PAYOUT_POLICY_HISTORY) {
      expect(new Date(v.effectiveFrom).getTime(), v.version).toBeGreaterThanOrEqual(new Date(v.announcedAt).getTime());
    }
  });

  it(`gives at least ${TOUR_PAYOUT_NOTICE_DAYS} days' notice for any change that is worse for operators`, () => {
    for (let i = 1; i < TOUR_PAYOUT_POLICY_HISTORY.length; i++) {
      const prev = TOUR_PAYOUT_POLICY_HISTORY[i - 1];
      const cur = TOUR_PAYOUT_POLICY_HISTORY[i];
      const worse = (Object.keys(WORSE_FOR_OPERATOR) as Array<keyof TourPayoutTerms>).filter((k) =>
        (WORSE_FOR_OPERATOR[k] as (a: unknown, b: unknown) => boolean)(prev.terms[k], cur.terms[k])
      );
      if (!worse.length) continue;
      const noticeDays = (new Date(cur.effectiveFrom).getTime() - new Date(cur.announcedAt).getTime()) / DAY;
      expect(noticeDays, `${cur.version} makes ${worse.join(", ")} worse for operators`).toBeGreaterThanOrEqual(TOUR_PAYOUT_NOTICE_DAYS);
    }
  });

  it("does not change the first published version (append a new one instead)", () => {
    expect(TOUR_PAYOUT_POLICY_HISTORY[0]).toEqual({
      version: "2026-09-26",
      announcedAt: "2026-09-26T00:00:00+03:00",
      effectiveFrom: "2026-09-26T00:00:00+03:00",
      terms: {
        advanceOpensDaysBefore: 7,
        advanceFullWindowHours: 96,
        advanceBasePercent: 30,
        advanceMaxPercent: 70,
        advanceCoolingOffHours: 24,
        advanceMinTier: "SILVER",
        balanceDisputeWindowHours: 48,
        openAdvanceLimit: false,
      },
    });
  });

  it("applies the version in force on the date, not the newest one", () => {
    expect(tourPayoutPolicyAt(new Date("2026-10-01T00:00:00Z")).version).toBe("2026-09-26");
    // 2026-12-19 is published but waits out the notice period.
    expect(tourPayoutPolicyAt(new Date("2026-12-18T20:59:59Z")).version).toBe("2026-09-26");
    expect(tourPayoutPolicyAt(new Date("2026-12-18T21:00:00Z")).version).toBe("2026-12-19");
    expect(tourPayoutPolicyAt(new Date("2020-01-01T00:00:00Z")).version).toBe(TOUR_PAYOUT_POLICY_HISTORY[0].version);
  });
});

describe("public policy page matches the server", () => {
  // Tests run from apps/api, like the other source-reading tests.
  const page = readFileSync(resolve(process.cwd(), "../web/components/tourOperatorDisbursementPolicyContent.tsx"), "utf8")
    // Compare the words, not the markup around them.
    .replace(/<\/?strong>/g, "")
    .replace(/\s+/g, " ");
  const t = LATEST_TOUR_PAYOUT_POLICY.terms;
  const tierName = t.advanceMinTier.charAt(0) + t.advanceMinTier.slice(1).toLowerCase();

  it.each([
    ["version", `This is version ${LATEST_TOUR_PAYOUT_POLICY.version}`],
    ["opening day", `from ${t.advanceOpensDaysBefore} days before the trip's start date`],
    ["cooling-off", `in the first ${t.advanceCoolingOffHours} hours after the traveller paid`],
    ["base share", `Up to ${t.advanceBasePercent}% of the net share with no paperwork`],
    ["receipts share", `may request up to ${t.advanceMaxPercent}% by attaching supplier receipts`],
    ["no-paperwork window", `inside the last ${t.advanceFullWindowHours} hours`],
    ["no-paperwork share", `up to ${t.advanceMaxPercent}% of the net share can be requested with no receipts`],
    ["minimum tier", `reached ${tierName} tier or above`],
    ["dispute window", `${t.balanceDisputeWindowHours} hours`],
  ])("states the %s", (_label, phrase) => {
    expect(page).toContain(phrase);
  });

  it("states when the open advance limit starts, if the latest version has one", () => {
    const first = TOUR_PAYOUT_POLICY_HISTORY.find((v) => v.terms.openAdvanceLimit);
    if (!first) return;
    const day = new Date(first.effectiveFrom).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
    expect(page).toContain("3.7 Open advance limit.");
    expect(page).toContain(`From ${day}, each operator level has a limit`);
  });
});
