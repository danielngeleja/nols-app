import { describe, expect, it } from "vitest";
import { generateOwnerPayoutRecordPdf, ownerPayoutRecordReference, type OwnerPayoutRecordData } from "./ownerPayoutRecordPdf.js";

const base: OwnerPayoutRecordData = {
  reference: "EXP-7K2Q9M4D",
  purpose: "AUDIT",
  note: "2026 year-end audit, sample item 17",
  exportedBy: "Admin Daniel",
  exportedAt: new Date("2026-11-25T09:00:00Z"),
  ownerName: "Asha Mtumwa",
  money: { readyToWithdraw: 300_000, paidLast30Days: 900_000, paidCount: 3, recoveryDue: 0,
    waitingApproval: { count: 1, total: 1_700_000, oldestAt: new Date("2026-11-25T03:00:00Z") }, unlockingCount: 0, onHoldCount: 0 },
  nextRoute: { lane: "MANUAL", reason: "First payout to this owner is checked by our team", amount: 300_000 },
  wallet: { provider: "vodacom", ending: "2370", nameMatchesOwner: true },
  walletWaitUntil: null, contactWaitUntil: null, codeLocked: false, wrongCodes: 0, failedLast14Days: 0,
  behaviour: { score: 88, band: "WATCH", days: 30, signals: [{ label: "Passkey or authenticator", value: "Missing", severity: "WATCH" }] },
  controls: { hold: null, alwaysReview: null },
  withdrawals: [{ reference: "OWN-AAA", amount: 1_700_000, status: "REQUESTED", route: "MANUAL", createdAt: new Date("2026-11-25T03:00:00Z"), paidAt: null }],
  events: [],
};

describe("owner payout record PDF", () => {
  it("builds a real PDF", async () => {
    const pdf = await generateOwnerPayoutRecordPdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("flows onto more pages for a long history without failing", async () => {
    const events = Array.from({ length: 120 }, (_, i) => ({
      createdAt: new Date(Date.UTC(2026, 10, 1, i)).toISOString(), label: "Wrong withdrawal code entered", actor: "Owner", detail: `${(i % 3) + 1} of 3 wrong codes`,
    }));
    const short = await generateOwnerPayoutRecordPdf(base);
    const long = await generateOwnerPayoutRecordPdf({ ...base, events });
    const pages = (buf: Buffer) => (buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages(long)).toBeGreaterThan(pages(short));
  });

  it("makes unguessable, readable references", () => {
    const refs = new Set(Array.from({ length: 200 }, () => ownerPayoutRecordReference()));
    expect(refs.size).toBe(200);
    for (const ref of refs) expect(ref).toMatch(/^EXP-[A-HJ-NP-Z2-9]{8}$/);
  });
});
