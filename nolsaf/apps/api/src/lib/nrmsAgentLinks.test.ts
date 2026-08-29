import { describe, expect, it, vi } from "vitest";
import { attachAgentToProperty, authorizeHeldAgentBookingApproval, countAgentSeats, lockAgentPartnership, lockAgentSeatAllocation, setAgentLinkStatus, setAgentRateAccess, updateAgentLinkTerms } from "./nrmsAgentLinks.js";

function makeDb(over: Record<string, any> = {}) {
  return {
    nrmsAgentPropertyLink: {
      count: vi.fn(async (_a: any) => 0),
      findFirst: vi.fn(async (_a: any) => null),
      findUnique: vi.fn(async (_a: any) => null),
      create: vi.fn(async (_a: any) => ({ id: 100 })),
      update: vi.fn(async (_a: any) => ({ id: 100 })),
      updateMany: vi.fn(async (_a: any) => ({ count: 1 })),
    },
    nrmsAgentAccount: { findUnique: vi.fn(async (_a: any) => ({ id: 1 })) },
    ownerPaygAccount: { findUnique: vi.fn(async (_a: any) => ({ status: "ACTIVE" })) },
    nrmsAgentRateAccess: { deleteMany: vi.fn(async (_a: any) => ({})), createMany: vi.fn(async (_a: any) => ({})) },
    ...over,
  };
}

describe("attachAgentToProperty", () => {
  it("creates an INVITED link with default terms when under cap", async () => {
    const db = makeDb();
    const res = await attachAgentToProperty(db, { agentAccountId: 1, propertyId: 2, maxAgents: 5 });
    expect(res).toEqual({ ok: true, linkId: 100 });
    expect(db.nrmsAgentPropertyLink.create.mock.calls[0]![0].data).toMatchObject({ agentAccountId: 1, propertyId: 2, status: "INVITED", paymentTerms: "PREPAID", bookingMode: "REQUEST" });
  });

  it("creates an operator-initiated REQUESTED link with only agent consent", async () => {
    const db = makeDb();
    const res = await attachAgentToProperty(db, { agentAccountId: 1, propertyId: 2, maxAgents: 5, initiatedBy: "AGENT", requestedByUserId: 81 });
    expect(res).toEqual({ ok: true, linkId: 100 });
    expect(db.nrmsAgentPropertyLink.create.mock.calls[0]![0].data).toMatchObject({
      status: "REQUESTED",
      initiatedBy: "AGENT",
      agentConsentStatus: "ACCEPTED",
      agentConsentedByUserId: 81,
      hotelConsentStatus: "PENDING",
    });
  });

  it("blocks with CAP_REACHED at the limit", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, count: vi.fn(async () => 5) } });
    const res = await attachAgentToProperty(db, { agentAccountId: 1, propertyId: 2, maxAgents: 5 });
    expect(res).toMatchObject({ ok: false, reason: "CAP_REACHED" });
    expect(db.nrmsAgentPropertyLink.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate live link", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "ACTIVE" })) } });
    expect(await attachAgentToProperty(db, { agentAccountId: 1, propertyId: 2, maxAgents: 5 })).toMatchObject({ ok: false, reason: "ALREADY_LINKED" });
  });

  it("re-invites over a previously REJECTED link", async () => {
    const link = { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "REJECTED" })), count: vi.fn(async () => 0), update: vi.fn(async () => ({ id: 100 })) };
    const db = makeDb({ nrmsAgentPropertyLink: link });
    const res = await attachAgentToProperty(db, { agentAccountId: 1, propertyId: 2, maxAgents: 5 });
    expect(res).toEqual({ ok: true, linkId: 100 });
    expect(link.update).toHaveBeenCalled();
    expect(link.create).not.toHaveBeenCalled();
  });

  it("fails when the agency does not exist", async () => {
    const db = makeDb({ nrmsAgentAccount: { findUnique: vi.fn(async () => null) } });
    expect(await attachAgentToProperty(db, { agentAccountId: 9, propertyId: 2, maxAgents: 5 })).toMatchObject({ ok: false, reason: "AGENCY_NOT_FOUND" });
  });
});

describe("setAgentLinkStatus", () => {
  it("activates a link only when the agency is VERIFIED", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "AGENT_ACCEPTED", initiatedBy: "HOTEL", hotelConsentStatus: "ACCEPTED", agentConsentStatus: "ACCEPTED", agentAccount: { status: "ACTIVE", verificationStatus: "VERIFIED" }, property: { status: "APPROVED", nrmsActivatedAt: new Date() } })) } });
    const res = await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "ACTIVE", decidedByUserId: 42 });
    expect(res).toEqual({ ok: true, status: "ACTIVE", changed: true });
  });

  it("lets the hotel explicitly accept and activate an operator-initiated request", async () => {
    const link = { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "REQUESTED", initiatedBy: "AGENT", hotelConsentStatus: "PENDING", agentConsentStatus: "ACCEPTED", agentAccount: { status: "ACTIVE", verificationStatus: "VERIFIED" }, property: { status: "APPROVED", nrmsActivatedAt: new Date() } })) };
    const db = makeDb({ nrmsAgentPropertyLink: link });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "ACTIVE", decidedByUserId: 42 })).toEqual({ ok: true, status: "ACTIVE", changed: true });
    expect(link.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "ACTIVE", hotelConsentStatus: "ACCEPTED", hotelConsentedByUserId: 42 });
  });

  it("refuses to activate an unverified agency", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "AGENT_ACCEPTED", initiatedBy: "HOTEL", hotelConsentStatus: "ACCEPTED", agentConsentStatus: "ACCEPTED", agentAccount: { status: "ACTIVE", verificationStatus: "PENDING" }, property: { status: "APPROVED", nrmsActivatedAt: new Date() } })) } });
    const res = await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "ACTIVE", decidedByUserId: 42 });
    expect(res).toMatchObject({ ok: false, reason: "AGENCY_NOT_VERIFIED" });
    expect(db.nrmsAgentPropertyLink.update).not.toHaveBeenCalled();
  });

  it("rejects a pending relationship without requiring verification", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "INVITED", agentAccount: { verificationStatus: "PENDING" } })) } });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "REJECTED", decidedByUserId: 42, reason: "no" })).toEqual({ ok: true, status: "REJECTED", changed: true });
  });

  it("requires termination rather than rejection for an active partnership", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "ACTIVE", agentAccount: { verificationStatus: "VERIFIED" } })) } });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "REJECTED", decidedByUserId: 42 })).toMatchObject({ ok: false, reason: "INVALID_TRANSITION" });
  });

  it("returns NOT_FOUND for a link on another property", async () => {
    const db = makeDb();
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 999, status: "SUSPENDED", decidedByUserId: 42 })).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });

  it("reports a repeated transition as unchanged without writing again", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "SUSPENDED" })) } });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "SUSPENDED", decidedByUserId: 42 })).toEqual({ ok: true, status: "SUSPENDED", changed: false });
    expect(db.nrmsAgentPropertyLink.updateMany).not.toHaveBeenCalled();
  });

  it("lets only one concurrent transition publish the lifecycle event", async () => {
    const links = {
      ...makeDb().nrmsAgentPropertyLink,
      findFirst: vi.fn(async () => ({ id: 100, status: "ACTIVE" })),
      updateMany: vi.fn(async (_args: any) => ({ count: 0 })),
    };
    const db = makeDb({ nrmsAgentPropertyLink: links });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "SUSPENDED", decidedByUserId: 42 })).toEqual({ ok: true, status: "SUSPENDED", changed: false });
    expect(links.updateMany.mock.calls[0]![0].where).toEqual({ id: 100, status: "ACTIVE" });
  });

  it("prevents a hotel from clearing a central compliance suspension", async () => {
    const links = {
      ...makeDb().nrmsAgentPropertyLink,
      findFirst: vi.fn(async () => ({
        id: 100, status: "SUSPENDED", suspensionAuthority: "ADMIN", initiatedBy: "HOTEL",
        hotelConsentStatus: "ACCEPTED", agentConsentStatus: "ACCEPTED",
        agentAccount: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        property: { status: "APPROVED", nrmsActivatedAt: new Date() },
      })),
    };
    const db = makeDb({ nrmsAgentPropertyLink: links });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "ACTIVE", decidedByUserId: 42 })).toMatchObject({ ok: false, reason: "ADMIN_SUSPENSION_ACTIVE" });
    expect(links.updateMany).not.toHaveBeenCalled();
  });

  it("allows only the guarded central workflow to resume and clears its authority", async () => {
    const links = {
      ...makeDb().nrmsAgentPropertyLink,
      findFirst: vi.fn(async () => ({
        id: 100, status: "SUSPENDED", suspensionAuthority: "ADMIN", initiatedBy: "HOTEL",
        hotelConsentStatus: "ACCEPTED", agentConsentStatus: "ACCEPTED",
        agentAccount: { status: "ACTIVE", verificationStatus: "VERIFIED" },
        property: { status: "APPROVED", nrmsActivatedAt: new Date() },
      })),
    };
    const db = makeDb({ nrmsAgentPropertyLink: links });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "ACTIVE", decidedByUserId: 7, allowAdminSuspensionOverride: true })).toEqual({ ok: true, status: "ACTIVE", changed: true });
    expect(links.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "ACTIVE", suspensionAuthority: null });
  });

  it("records who owns a suspension", async () => {
    const links = { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100, status: "ACTIVE" })) };
    const db = makeDb({ nrmsAgentPropertyLink: links });
    expect(await setAgentLinkStatus(db, { linkId: 100, propertyId: 2, status: "SUSPENDED", decidedByUserId: 7, suspensionAuthority: "ADMIN" })).toEqual({ ok: true, status: "SUSPENDED", changed: true });
    expect(links.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "SUSPENDED", suspensionAuthority: "ADMIN" });
  });
});

describe("agent partnership locks and held approval", () => {
  it("uses bound row locks for the seat account and partnership", async () => {
    const execute = vi.fn(async () => 1);
    const db = { $executeRawUnsafe: execute };
    await lockAgentSeatAllocation(db, 9);
    await lockAgentPartnership(db, 14);
    expect(execute).toHaveBeenNthCalledWith(1, expect.stringContaining("owner_payg_account"), 9);
    expect(execute).toHaveBeenNthCalledWith(2, expect.stringContaining("nrms_agent_property_link"), 14);
  });

  it("blocks approval after suspension and locks before reading policy state", async () => {
    const execute = vi.fn(async () => 1);
    const findLink = vi.fn(async () => ({
      status: "SUSPENDED", initiatedBy: "HOTEL", hotelConsentStatus: "ACCEPTED", agentConsentStatus: "ACCEPTED",
      agentAccount: { status: "ACTIVE", verificationStatus: "VERIFIED" }, property: { status: "APPROVED", nrmsActivatedAt: new Date() },
    }));
    const db = { $executeRawUnsafe: execute, nrmsAgentPropertyLink: { findUnique: findLink }, ownerPaygAccount: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) } };
    expect(await authorizeHeldAgentBookingApproval(db, { linkId: 14, propertyId: 9 })).toMatchObject({ ok: false, reason: "RELATIONSHIP_NOT_ACTIVE" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.invocationCallOrder[1]).toBeLessThan(findLink.mock.invocationCallOrder[0]);
  });

  it("blocks approval when billing became payment-required after the hold", async () => {
    const db = {
      $executeRawUnsafe: vi.fn(async () => 1),
      nrmsAgentPropertyLink: { findUnique: vi.fn(async () => ({ status: "ACTIVE", initiatedBy: "HOTEL", hotelConsentStatus: "ACCEPTED", agentConsentStatus: "ACCEPTED", agentAccount: { status: "ACTIVE", verificationStatus: "VERIFIED" }, property: { status: "APPROVED", nrmsActivatedAt: new Date() } })) },
      ownerPaygAccount: { findUnique: vi.fn(async () => ({ status: "PAYMENT_REQUIRED" })) },
    };
    expect(await authorizeHeldAgentBookingApproval(db, { linkId: 14, propertyId: 9 })).toMatchObject({ ok: false, reason: "PROPERTY_BILLING_BLOCKED" });
  });
});

describe("updateAgentLinkTerms", () => {
  it("scopes the update to the owning property", async () => {
    const db = makeDb();
    const res = await updateAgentLinkTerms(db, { linkId: 100, propertyId: 2, terms: { bookingMode: "INSTANT", creditLimit: 0 } });
    expect(res).toEqual({ ok: true });
    expect(db.nrmsAgentPropertyLink.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: 100, propertyId: 2 }, data: { bookingMode: "INSTANT", creditLimit: 0 } });
  });
});

describe("setAgentRateAccess", () => {
  it("replaces access rows, de-duplicating pairs", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, findFirst: vi.fn(async () => ({ id: 100 })) } });
    const res = await setAgentRateAccess(db, { linkId: 100, propertyId: 2, entries: [{ ratePlanId: 5, roomTypeId: null }, { ratePlanId: 5, roomTypeId: null }, { ratePlanId: 6, roomTypeId: 10 }] });
    expect(res).toEqual({ ok: true });
    expect(db.nrmsAgentRateAccess.deleteMany).toHaveBeenCalledWith({ where: { linkId: 100 } });
    expect(db.nrmsAgentRateAccess.createMany.mock.calls[0]![0].data).toHaveLength(2);
  });

  it("returns NOT_FOUND when the link is not on the property", async () => {
    const db = makeDb();
    expect(await setAgentRateAccess(db, { linkId: 100, propertyId: 2, entries: [] })).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("countAgentSeats", () => {
  it("counts invited, agent-accepted, active and suspended links", async () => {
    const db = makeDb({ nrmsAgentPropertyLink: { ...makeDb().nrmsAgentPropertyLink, count: vi.fn(async () => 3) } });
    expect(await countAgentSeats(db, 2)).toBe(3);
    expect(db.nrmsAgentPropertyLink.count.mock.calls[0]![0].where.status.in).toEqual(["INVITED", "REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"]);
  });
});
