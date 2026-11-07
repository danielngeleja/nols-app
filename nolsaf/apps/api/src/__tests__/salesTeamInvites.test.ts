import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_OPEN_INVITES,
  MAX_TEAM_SIZE,
  acceptTeamInvite,
  approveInviteInPromotion,
  createTeamInvite,
  hashInviteToken,
  inviteStatus,
  joinTeamOnActivation,
  normalizeTzPhone,
  previewTeamInvite,
} from "../lib/salesTeamInvites.js";

const NOW = new Date("2026-11-08T09:00:00Z");
const LATER = new Date(NOW.getTime() + 7 * 86400000);
const fn = () => vi.fn();

function makeDb() {
  const db: any = {
    salesPartnerProfile: { findUnique: fn() },
    salesTeamMember: { count: fn(), findUnique: fn(), create: fn() },
    salesTeamInvite: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), updateMany: fn(), update: fn(), count: fn() },
    salesTeam: { findUnique: fn() },
    user: { findUnique: fn() },
    payoutAccount: { findMany: fn() },
  };
  db.salesPartnerProfile.findUnique.mockResolvedValue({ status: "ACTIVE", payoutHoldAt: null, phone: "0754000111", user: { phone: "+255754000111" } });
  db.salesTeamMember.count.mockResolvedValue(2);
  db.salesTeamInvite.findMany.mockResolvedValue([]);
  db.salesTeamInvite.findFirst.mockResolvedValue(null);
  db.salesTeamInvite.create.mockImplementation(({ data }: any) => Promise.resolve(data));
  db.salesTeamInvite.updateMany.mockResolvedValue({ count: 1 });
  db.salesTeamInvite.count.mockResolvedValue(0);
  db.salesTeam.findUnique.mockResolvedValue({ id: 3, name: "Arusha North", region: "Arusha", status: "ACTIVE", lead: { id: 11, userId: 21, user: { name: "Amina Mushi" } } });
  db.payoutAccount.findMany.mockResolvedValue([]);
  return db;
}

const team = { id: 3, leadPartnerId: 11 };

describe("normalizeTzPhone and status", () => {
  it("accepts local and international forms and rejects others", () => {
    expect(normalizeTzPhone("0754 123 456")).toBe("255754123456");
    expect(normalizeTzPhone("+255 654 123 456")).toBe("255654123456");
    expect(normalizeTzPhone("12345")).toBeNull();
  });
  it("shows an unaccepted invite past its date as expired", () => {
    expect(inviteStatus({ status: "SENT", expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("EXPIRED");
    expect(inviteStatus({ status: "ACCEPTED", expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("ACCEPTED");
  });
});

describe("createTeamInvite", () => {
  let db: any;
  beforeEach(() => { db = makeDb(); });

  it("creates a 14-day invite, stores only the token hash and returns the link once", async () => {
    const out = await createTeamInvite(db, { team, name: "Juma Kassim", phone: "0712 345 678", now: NOW });
    const saved = db.salesTeamInvite.create.mock.calls[0][0].data;
    const token = new URL(out.link).searchParams.get("t")!;
    expect(out.link).toContain("/join-team?t=");
    expect(saved.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(saved.reference).toMatch(/^ti_/);
    expect(saved.expiresAt.getTime() - NOW.getTime()).toBe(14 * 86400000);
  });

  it("refuses the lead's own number, a paused lead, and too many open invites", async () => {
    await expect(createTeamInvite(db, { team, name: "Juma Kassim", phone: "0754 000 111", now: NOW })).rejects.toThrow(/own number/);
    db.salesTeamInvite.findMany.mockResolvedValue(Array.from({ length: MAX_OPEN_INVITES }, () => ({ status: "SENT", expiresAt: LATER })));
    await expect(createTeamInvite(db, { team, name: "Juma Kassim", phone: "0712 345 678", now: NOW })).rejects.toThrow(/open invites/);
    db.salesTeamInvite.findMany.mockResolvedValue([]);
    db.salesPartnerProfile.findUnique.mockResolvedValue({ status: "ACTIVE", payoutHoldAt: NOW, phone: null, user: {} });
    await expect(createTeamInvite(db, { team, name: "Juma Kassim", phone: "0712 345 678", now: NOW })).rejects.toThrow(/paused/);
  });

  it("keeps the team at its size limit, counting open invites", async () => {
    db.salesTeamMember.count.mockResolvedValue(MAX_TEAM_SIZE - 1);
    db.salesTeamInvite.findMany.mockResolvedValue([{ status: "ACCEPTED", expiresAt: LATER }]);
    await expect(createTeamInvite(db, { team, name: "Juma Kassim", phone: "0712 345 678", now: NOW })).rejects.toThrow(/up to/);
  });
});

describe("previewTeamInvite", () => {
  it("shows only who invited and the team, and nothing for a bad or expired link", async () => {
    const db = makeDb();
    db.salesTeamInvite.findUnique.mockResolvedValueOnce({ status: "SENT", expiresAt: LATER, inviteeName: "Juma Kassim", teamId: 3 });
    expect(await previewTeamInvite(db, "x".repeat(40), NOW)).toEqual({
      inviteeFirstName: "Juma", leadFirstName: "Amina", teamName: "Arusha North", region: "Arusha", expiresAt: LATER,
    });
    db.salesTeamInvite.findUnique.mockResolvedValueOnce({ status: "SENT", expiresAt: new Date(NOW.getTime() - 1), inviteeName: "J", teamId: 3 });
    expect(await previewTeamInvite(db, "x".repeat(40), NOW)).toBeNull();
    db.salesTeamInvite.findUnique.mockResolvedValueOnce(null);
    expect(await previewTeamInvite(db, "x".repeat(40), NOW)).toBeNull();
  });
});

describe("acceptTeamInvite", () => {
  let db: any;
  const recruit = {
    id: 40, name: "Juma Kassim", fullName: "Juma Kassim", email: "juma@example.com", emailVerifiedAt: NOW,
    phone: "+255712345678", phoneVerifiedAt: NOW, address: "Arusha", nin: "19900101-12345-00001-21", suspendedAt: null, isDisabled: false,
  };
  const leadUser = { email: "amina@example.com", phone: "+255754000111", nin: "19850101-11111-00001-11" };
  beforeEach(() => {
    db = makeDb();
    db.salesTeamInvite.findUnique.mockResolvedValue({ id: 9, reference: "ti_abcdefghijkl", status: "SENT", expiresAt: LATER, teamId: 3, leadPartnerId: 11, inviteeName: "Juma Kassim", inviteePhone: "255712345678" });
    db.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 40 ? recruit : leadUser));
    db.salesPartnerProfile.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.userId ? null : { phone: "0754000111" }));
  });

  it("accepts a clean recruit with no warnings", async () => {
    const out = await acceptTeamInvite(db, { token: "t".repeat(40), userId: 40, now: NOW });
    expect(out.flags).toEqual([]);
    expect(db.salesTeamInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACCEPTED", acceptedUserId: 40 }) }));
  });

  it("flags a recruit who shares the lead's phone, ID or payout account", async () => {
    db.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 40 ? { ...recruit, phone: "+255754000111", nin: leadUser.nin } : leadUser));
    db.payoutAccount.findMany.mockResolvedValue([{ accountNumber: "255700999888" }]);
    const out = await acceptTeamInvite(db, { token: "t".repeat(40), userId: 40, now: NOW });
    const codes = out.flags.filter((f) => f.severity === "SUSPICIOUS").map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["SAME_PHONE_AS_LEAD", "SAME_ID_AS_LEAD", "SAME_PAYOUT_ACCOUNT_AS_LEAD"]));
  });

  it("notes a forwarded link and an incomplete profile for the admin", async () => {
    db.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === 40 ? { ...recruit, phone: "+255688000222", nin: null } : leadUser));
    const out = await acceptTeamInvite(db, { token: "t".repeat(40), userId: 40, now: NOW });
    expect(out.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["PHONE_NOT_INVITED_NUMBER", "PROFILE_INCOMPLETE"]));
    expect(out.missing).toContain("National ID number");
  });

  it("refuses the lead, an existing partner, and a second open invite", async () => {
    await expect(acceptTeamInvite(db, { token: "t".repeat(40), userId: 21, now: NOW })).rejects.toThrow(/own invite/);
    db.salesPartnerProfile.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.userId ? { id: 99 } : { phone: null }));
    await expect(acceptTeamInvite(db, { token: "t".repeat(40), userId: 40, now: NOW })).rejects.toThrow(/already a NoLSAF sales partner/);
    db.salesPartnerProfile.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.userId ? null : { phone: null }));
    db.salesTeamInvite.findFirst.mockResolvedValue({ id: 5 });
    await expect(acceptTeamInvite(db, { token: "t".repeat(40), userId: 40, now: NOW })).rejects.toThrow(/another team invite/);
  });
});

describe("approval and joining", () => {
  it("approves only the account that accepted, while it still waits", async () => {
    const tx = makeDb();
    tx.salesTeamInvite.findUnique.mockResolvedValue({ id: 9, status: "ACCEPTED", acceptedUserId: 40, teamId: 3, team: { status: "ACTIVE" } });
    await approveInviteInPromotion(tx, { reference: "ti_abcdefghijkl", userId: 40, partnerId: 77, adminId: 1, now: NOW });
    expect(tx.salesTeamInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", partnerId: 77 }) }));
    await expect(approveInviteInPromotion(tx, { reference: "ti_abcdefghijkl", userId: 41, partnerId: 77, adminId: 1, now: NOW })).rejects.toThrow(/no longer waiting/);
  });

  it("adds the recruit to the team at activation, or records why not", async () => {
    const tx = makeDb();
    tx.salesTeamInvite.findFirst.mockResolvedValue({ id: 9, teamId: 3, team: { name: "Arusha North", status: "ACTIVE", lead: { userId: 21 } } });
    tx.salesTeamMember.findUnique.mockResolvedValue(null);
    tx.salesTeam.findUnique.mockResolvedValue(null);
    expect(await joinTeamOnActivation(tx, { partnerId: 77, adminId: 1, now: NOW })).toEqual({ teamName: "Arusha North", leadUserId: 21 });
    expect(tx.salesTeamMember.create).toHaveBeenCalledWith({ data: expect.objectContaining({ teamId: 3, salesPartnerId: 77, activeKey: 77 }) });

    tx.salesTeamMember.create.mockClear();
    tx.salesTeamMember.count.mockResolvedValue(MAX_TEAM_SIZE);
    expect(await joinTeamOnActivation(tx, { partnerId: 77, adminId: 1, now: NOW })).toBeNull();
    expect(tx.salesTeamMember.create).not.toHaveBeenCalled();
    expect(tx.salesTeamInvite.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) }));
  });
});
