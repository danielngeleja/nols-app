import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referralCandidates, referralCodeFor, storedReferralCodesFor } from "../lib/referralCode.js";

describe("referral codes", () => {
  const previous = process.env.REFERRAL_CODE_SECRET;
  beforeEach(() => { process.env.REFERRAL_CODE_SECRET = "test-referral-secret"; });
  afterEach(() => {
    if (previous == null) delete process.env.REFERRAL_CODE_SECRET;
    else process.env.REFERRAL_CODE_SECRET = previous;
  });

  it("never contains the database id and has a fixed readable shape", () => {
    for (const id of [1, 2, 12, 999, 123456]) {
      const code = referralCodeFor("CUSTOMER", id);
      expect(code).toMatch(/^C[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{3}$/);
      expect(code).not.toContain(String(id));
    }
    expect(referralCodeFor("DRIVER", 7)).toMatch(/^D/);
  });

  it("round-trips every id, and neighbouring ids give unrelated codes", () => {
    const codes = new Set<string>();
    for (let id = 1; id <= 2000; id++) {
      const code = referralCodeFor("CUSTOMER", id);
      codes.add(code);
      expect(referralCandidates(code)[0]).toEqual({ kind: "CUSTOMER", id, legacy: false });
    }
    expect(codes.size).toBe(2000);
    expect(referralCodeFor("CUSTOMER", 2).slice(0, 4)).not.toBe(referralCodeFor("CUSTOMER", 3).slice(0, 4));
    expect(referralCandidates(referralCodeFor("DRIVER", MAX_SAFE()))[0].id).toBe(MAX_SAFE());
  });

  it("accepts what people actually type", () => {
    const code = referralCodeFor("CUSTOMER", 42);
    const sloppy = code.toLowerCase().replace("-", " ");
    expect(referralCandidates(sloppy)[0]?.id).toBe(42);
  });

  it("still credits legacy links already shared", () => {
    expect(referralCandidates("CUSTOMER-2")).toEqual([{ kind: "CUSTOMER", id: 2, legacy: true }]);
    expect(referralCandidates("driver-15")).toEqual([{ kind: "DRIVER", id: 15, legacy: true }]);
  });

  it("rejects junk", () => {
    for (const bad of ["", "X1234-567", "C12", "CUSTOMER-", "C!!!!-???", "CUSTOMER-abc"]) {
      expect(referralCandidates(bad)).toEqual([]);
    }
  });

  it("keeps old codes working during a secret rotation", () => {
    process.env.REFERRAL_CODE_SECRET = "old-secret";
    const oldCode = referralCodeFor("CUSTOMER", 77);
    process.env.REFERRAL_CODE_SECRET = "new-secret,old-secret";
    expect(referralCandidates(oldCode).map((c) => c.id)).toContain(77);
    expect(referralCodeFor("CUSTOMER", 77)).not.toBe(oldCode);
  });

  it("lists both stored forms for referral counting", () => {
    expect(storedReferralCodesFor("DRIVER", 5)).toEqual([referralCodeFor("DRIVER", 5), "DRIVER-5"]);
  });
});

function MAX_SAFE() { return 0xffffffff; }
