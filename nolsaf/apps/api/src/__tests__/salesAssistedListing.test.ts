import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
vi.mock("../lib/sms.js", () => ({ sendSms: vi.fn(async () => ({ success: true })) }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: vi.fn(), notifyUser: vi.fn() }));
vi.mock("../lib/performance.js", () => ({ invalidateCache: vi.fn(), cacheKeys: { property: () => "p", adminSummary: () => "a" } }));

import {
  AssistedListingError,
  assistedGateOf,
  assistedGateRefusal,
  canonicalOwnerPhone,
  hashNoticeToken,
  isNoticeToken,
  liveSmsText,
  newNoticeToken,
  noticeSmsText,
  propertyTypeFromLead,
  releaseUnusedOwnerAccount,
  resolveOwnerAccount,
} from "../lib/salesAssistedListing.js";

const PARTNER_ID = 7;
const PARTNER_USER_ID = 70;

/** A transaction double holding one partner and a list of existing users. */
function fakeTx(users: Array<{ id: number; role: string; phone?: string | null; email?: string | null; suspendedAt?: Date | null; isDisabled?: boolean }>) {
  const created: any[] = [];
  return {
    created,
    salesPartnerProfile: {
      findUnique: async () => ({ userId: PARTNER_USER_ID, phone: "0755 000 111", payoutAccount: null, user: { email: "partner@example.com", phone: "+255755000111" } }),
    },
    user: {
      findFirst: async ({ where }: any) => {
        if (where.phone?.in) return users.find((u) => where.phone.in.includes(u.phone)) ?? null;
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        created.push(data);
        return { id: 500 };
      },
    },
  };
}

describe("assisted listing gate", () => {
  it("refuses until an admin grants the right, and while paused", () => {
    expect(assistedGateRefusal(assistedGateOf(null))).toMatch(/not switched on/);
    expect(assistedGateRefusal(assistedGateOf({ assistedListingEnabledAt: new Date() }))).toBeNull();
    expect(assistedGateRefusal(assistedGateOf({ assistedListingEnabledAt: new Date(), assistedListingPausedAt: new Date(), assistedListingPauseReason: "2 owners said no" })))
      .toMatch(/paused.*2 owners said no/);
  });
});

describe("owner phone", () => {
  it("stores Tanzanian mobiles in the sign-in form and rejects anything else", () => {
    expect(canonicalOwnerPhone("0712 345 678")).toBe("+255712345678");
    expect(canonicalOwnerPhone("+255 712 345 678")).toBe("+255712345678");
    expect(canonicalOwnerPhone("255712345678")).toBe("+255712345678");
    expect(canonicalOwnerPhone("0222 123 456")).toBeNull();
    expect(canonicalOwnerPhone("12345")).toBeNull();
  });
});

describe("resolveOwnerAccount", () => {
  it("creates a passwordless owner account from the phone the partner entered", async () => {
    const tx = fakeTx([]);
    const result = await resolveOwnerAccount(tx, PARTNER_ID, { name: "Asha Mussa", phone: "0712 345 678", email: "Asha@Example.com" });
    expect(result).toEqual({ ownerUserId: 500, outcome: "CREATED", phone: "+255712345678" });
    expect(tx.created[0]).toMatchObject({ role: "OWNER", phone: "+255712345678", email: null, passwordHash: null, registrationSource: "SALES_ASSISTED" });
  });

  it("never puts the partner-typed email on a new owner account (password reset goes to the account email)", async () => {
    // A partner could type an address they control next to the owner's real
    // phone, then reset the owner's password through it. The account keeps no
    // email until the owner adds their own, so reset can only reach the phone.
    const tx = fakeTx([]);
    await resolveOwnerAccount(tx, PARTNER_ID, { name: "Asha Mussa", phone: "0712 345 678", email: "someone-else@example.com" });
    expect(tx.created).toHaveLength(1);
    expect(tx.created[0].email).toBeNull();
    expect(JSON.stringify(tx.created[0])).not.toContain("someone-else@example.com");
  });

  it("attaches to an existing owner found under an older phone spelling", async () => {
    const tx = fakeTx([{ id: 31, role: "OWNER", phone: "0712345678" }]);
    const result = await resolveOwnerAccount(tx, PARTNER_ID, { name: "Asha Mussa", phone: "+255712345678" });
    expect(result.outcome).toBe("ATTACHED_EXISTING");
    expect(result.ownerUserId).toBe(31);
    expect(tx.created).toHaveLength(0);
  });

  it("never lets the partner be the owner", async () => {
    const tx = fakeTx([]);
    await expect(resolveOwnerAccount(tx, PARTNER_ID, { name: "Me Myself", phone: "0755 000 111" })).rejects.toThrow(/different person/);
    await expect(resolveOwnerAccount(tx, PARTNER_ID, { name: "Me Myself", phone: "0712 345 678", email: "partner@example.com" })).rejects.toThrow(/different person/);
  });

  it("never turns another kind of account into an owner", async () => {
    const tx = fakeTx([{ id: 9, role: "CUSTOMER", phone: "+255712345678" }]);
    const error = await resolveOwnerAccount(tx, PARTNER_ID, { name: "Asha Mussa", phone: "0712345678" }).catch((e) => e);
    expect(error).toBeInstanceOf(AssistedListingError);
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/another kind of NoLSAF account/);
  });

  it("refuses a suspended owner and an email that belongs to someone else", async () => {
    await expect(resolveOwnerAccount(fakeTx([{ id: 31, role: "OWNER", phone: "+255712345678", suspendedAt: new Date() }]), PARTNER_ID, { name: "Asha Mussa", phone: "0712345678" }))
      .rejects.toThrow(/cannot take new listings/);
    await expect(resolveOwnerAccount(fakeTx([{ id: 44, role: "OWNER", email: "taken@example.com" }]), PARTNER_ID, { name: "Asha Mussa", phone: "0712345678", email: "taken@example.com" }))
      .rejects.toThrow(/email already belongs/);
  });
});

describe("notice token and SMS", () => {
  it("issues random tokens and stores only their hash", () => {
    const a = newNoticeToken();
    const b = newNoticeToken();
    expect(a.raw).not.toBe(b.raw);
    expect(isNoticeToken(a.raw)).toBe(true);
    expect(a.hash).toBe(hashNoticeToken(a.raw));
    expect(a.hash).not.toContain(a.raw);
    expect(isNoticeToken("../../etc")).toBe(false);
  });

  it("writes the SMS without em-dashes and with the brand spelled NoLSAF", () => {
    const notice = noticeSmsText({ ownerName: "Asha Mussa", partnerName: "John Doe", propertyName: "Sea View Lodge", noticeLink: "https://www.nolsaf.com/listing-notice/x" });
    const live = liveSmsText({ propertyName: "Sea View Lodge", signInLink: "https://www.nolsaf.com/account/login", setupLink: null, noticeLink: "https://www.nolsaf.com/listing-notice/y" });
    for (const text of [notice, live]) {
      expect(text).not.toContain("—");
      expect(text).toContain("NoLSAF");
      expect(text).not.toContain("NOLSAF");
    }
    expect(notice).toMatch(/^Habari Asha\./);
    expect(notice).toContain("Not expecting this? https://www.nolsaf.com/listing-notice/x");
    expect(live).not.toContain("password");
  });
});

describe("propertyTypeFromLead", () => {
  it("maps known lead types and falls back to OTHER", () => {
    expect(propertyTypeFromLead("Guest house")).toBe("GUEST_HOUSE");
    expect(propertyTypeFromLead("hotel")).toBe("HOTEL");
    expect(propertyTypeFromLead("Treehouse")).toBe("OTHER");
    expect(propertyTypeFromLead(null)).toBe("OTHER");
  });
});
