import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./salesAgency.js", () => ({ agencyGateFailure: (g: any) => g.failure, loadAgencyGateInput: vi.fn(async () => ({ failure: null })) }));
import { loadAgencyGateInput } from "./salesAgency.js";
import { addEventOperatingMinutes, blockBody, createEventBlock, createEventRequest, decideEventRequest, effectiveEventStatus, eventActorScope, eventRequestView, quoteEventRequest, requestBody, runEventRequestLifecycle } from "./eventHireRequests.js";

const now = new Date("2026-11-27T07:00:00Z"); // 10:00 EAT
const version = "a".repeat(64);
const ref = `er_${"a".repeat(32)}`;
const input = { propertyId: 7, startsAt: "2026-12-02T10:00:00+03:00", endsAt: "2026-12-02T14:00:00+03:00", eventType: "MEETING" as const, people: 50, seating: "SEATED" as const, package: "HALF_DAY" as const, assisted: true };
const terms = { spaceType: "HALL", eventTypes: ["MEETING"], capacitySeated: 60, capacityStanding: 100, earliestStart: "08:00", latestEnd: "23:00", halfDayPrice: 100000, fullDayPrice: 200000, eveningPrice: 150000, depositMode: "PERCENT", depositPercent: 25, cleaningFee: 10000 };
const property = () => ({ id: 7, ownerId: 20, title: "Hotel hall", status: "APPROVED", rentalMode: "NIGHTLY", eventHire: { status: "APPROVED", terms, termsFingerprint: version, approvedFingerprint: version } });
const record = (overrides: any = {}) => ({ id: 1, reference: ref, propertyId: 7, clientUserId: 10, assisted: true, status: "WAITING_OWNER", version: 1, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), expiresAt: new Date("2026-11-28T07:00:00Z"), termsFingerprint: version, holdExpiresAt: null, salesPartnerId: 30, quote: { total: 141000 }, reminderAt: now, escalateAt: now, ...overrides });
function database(row = record()) {
  const db: any = {
    $queryRaw: vi.fn(async () => []),
    user: { findUnique: vi.fn(async () => ({ phoneVerifiedAt: now })), findMany: vi.fn(async () => [{ id: 40 }]) },
    property: { findUnique: vi.fn(async () => property()), findFirst: vi.fn(async () => property()) },
    salesPartnerProfile: { findUnique: vi.fn(async () => ({ userId: 31 })) },
    eventHireRequest: { count: vi.fn(async () => 0), findFirst: vi.fn(async (args: any) => args.where.reference ? row : null),
      findUnique: vi.fn(async () => row), findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: 2, version: 1, status: "WAITING_OWNER", ...data })),
      update: vi.fn(async ({ data }: any) => ({ ...row, ...data, version: row.version + 1 })) },
    eventHireBlock: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => data) },
    eventHireBooking: { findFirst: vi.fn(async () => null) },
    eventHireRequestEvent: { create: vi.fn(async () => ({})) }, notification: { create: vi.fn(async () => ({})) },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return db;
}
beforeEach(() => vi.mocked(loadAgencyGateInput).mockResolvedValue({ failure: null } as any));

describe("event request validation and pricing", () => {
  it("rejects extra identities, prices and arbitrary fields", () => {
    expect(requestBody.safeParse({ ...input, clientUserId: 99 }).success).toBe(false);
    expect(requestBody.safeParse({ ...input, total: 1 }).success).toBe(false);
    expect(blockBody.safeParse({ startsAt: input.startsAt, endsAt: input.endsAt, reason: "UNAVAILABLE", propertyId: 8 }).success).toBe(false);
  });
  it("calculates the approved rate, split fees, deposit and cleaning on the server", () => {
    expect(quoteEventRequest({ terms }, input, now)).toMatchObject({ ownerPrice: 100000, ownerReceives: 90000, clientFee: 6000, deposit: 25000, cleaningFee: 10000, total: 141000 });
  });
  it.each([
    { people: 61 }, { eventType: "WEDDING" }, { endsAt: "2026-12-02T16:00:00+03:00" },
    { startsAt: "2026-12-02T07:00:00+03:00" }, { startsAt: "2026-12-02T22:00:00+03:00", endsAt: "2026-12-03T01:00:00+03:00" },
    { startsAt: "2026-12-02T10:00:01+03:00" }, { startsAt: "2026-11-01T10:00:00+03:00" },
  ])("rejects invalid capacity, type, hours and package %#", (change) => {
    expect(() => quoteEventRequest({ terms }, { ...input, ...change } as any, now)).toThrow();
  });
  it("supports an event window crossing midnight", () => {
    expect(quoteEventRequest({ terms: { ...terms, earliestStart: "18:00", latestEnd: "02:00" } }, { ...input, startsAt: "2026-12-02T23:00:00+03:00", endsAt: "2026-12-03T01:00:00+03:00" }, now).total).toBe(141000);
  });
  it("fails closed for whole-house accommodation inventory", () => {
    expect(() => quoteEventRequest({ terms: { ...terms, spaceType: "WHOLE_HOUSE" } }, input, now)).toThrow(/assistance/);
  });
  it("counts operating minutes across the evening", () => {
    expect(addEventOperatingMinutes(new Date("2026-11-27T14:45:00Z"), 30).toISOString()).toBe("2026-11-28T06:15:00.000Z");
  });
  it("expires a hold without relying on the worker", () => {
    expect(effectiveEventStatus(record({ status: "READY_TO_PAY", holdExpiresAt: now }), now)).toBe("EXPIRED");
    expect(eventRequestView(record({ status: "READY_TO_PAY" }), now).canPay).toBe(false);
  });
});

describe("private creation and atomic availability", () => {
  it("locks account and venue, writes notification and history, and leaves the parent untouched", async () => {
    const db = database();
    const row = await createEventRequest(db, { kind: "CLIENT", userId: 10 }, input, now);
    expect(row.reference).toMatch(/^er_[A-Za-z0-9_-]{32}$/);
    expect(db.$queryRaw.mock.calls.map((call: any) => call.slice(1))).toEqual([[10], [7]]);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
    expect(db.eventHireRequestEvent.create).toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalled();
    expect(db.property.update).toBeUndefined();
  });
  it("requires a verified phone", async () => {
    const db = database(); db.user.findUnique.mockResolvedValue({ phoneVerifiedAt: null });
    await expect(createEventRequest(db, { kind: "CLIENT", userId: 10 }, input, now)).rejects.toMatchObject({ status: 403 });
    expect(db.eventHireRequest.create).not.toHaveBeenCalled();
  });
  it("caps open requests even across authenticated submissions", async () => {
    const db = database(); db.eventHireRequest.count.mockResolvedValue(5);
    await expect(createEventRequest(db, { kind: "CLIENT", userId: 10 }, input, now)).rejects.toMatchObject({ status: 429 });
  });
  it.each(["parent", "offering", "fingerprint"])("rejects unavailable %s", async (condition) => {
    const db = database(); const p = property();
    if (condition === "parent") p.status = "SUSPENDED";
    if (condition === "offering") p.eventHire.status = "PAUSED";
    if (condition === "fingerprint") p.eventHire.approvedFingerprint = "b".repeat(64);
    db.property.findUnique.mockResolvedValue(p);
    await expect(createEventRequest(db, { kind: "CLIENT", userId: 10 }, input, now)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects a conflicting hold using strict half-open interval predicates", async () => {
    const db = database(); db.eventHireRequest.findFirst.mockResolvedValue({ id: 88 });
    await expect(createEventRequest(db, { kind: "CLIENT", userId: 10 }, input, now)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(db.eventHireRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ startsAt: { lt: new Date(input.endsAt) }, endsAt: { gt: new Date(input.startsAt) } }) }));
  });
  it("prevents an owner block overwriting a confirmed hold", async () => {
    const db = database(); db.eventHireRequest.findFirst.mockResolvedValue({ id: 88 });
    await expect(createEventBlock(db, { kind: "OWNER", userId: 20 }, 7, { startsAt: input.startsAt, endsAt: input.endsAt, reason: "EXTERNAL_BOOKING" }, now)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("decisions and authorisation", () => {
  it.each([
    [{ kind: "CLIENT", userId: 10 }, { clientUserId: 10 }],
    [{ kind: "OWNER", userId: 20 }, { property: { ownerId: 20 } }],
    [{ kind: "PARTNER", userId: 31, partnerId: 30 }, { salesPartnerId: 30 }],
  ])("scopes every actor %#", (actor, scope) => expect(eventActorScope(actor as any)).toEqual(scope));
  it("hides another owner's record", async () => {
    const db = database(); db.eventHireRequest.findFirst.mockResolvedValue(null);
    await expect(decideEventRequest(db, { kind: "OWNER", userId: 999 }, ref, { action: "CONFIRM", version: 1 }, now)).rejects.toMatchObject({ status: 404 });
  });
  it("checks version again after acquiring the venue lock", async () => {
    const db = database(); db.eventHireRequest.findFirst.mockResolvedValueOnce(record()).mockResolvedValueOnce(record({ version: 2 }));
    await expect(decideEventRequest(db, { kind: "OWNER", userId: 20 }, ref, { action: "CONFIRM", version: 1 }, now)).rejects.toMatchObject({ code: "CHANGED" });
    expect(db.eventHireRequest.update).not.toHaveBeenCalled();
  });
  it("does not allow expired confirmation or silent auto-approval", async () => {
    const db = database(record({ expiresAt: now }));
    await expect(decideEventRequest(db, { kind: "OWNER", userId: 20 }, ref, { action: "CONFIRM", version: 1 }, now)).rejects.toMatchObject({ code: "CLOSED" });
  });
  it("holds assisted requests for owner and partner checks", async () => {
    const db = database();
    const row = await decideEventRequest(db, { kind: "OWNER", userId: 20 }, ref, { action: "CONFIRM", version: 1 }, now);
    expect(row).toMatchObject({ status: "OWNER_CONFIRMED", confirmationVia: "APP", confirmedOwnerId: 20 });
    expect(row.holdExpiresAt.getTime() - now.getTime()).toBe(3600000);
  });
  it("allows a direct request without forcing an Agency Desk partner", async () => {
    const db = database(record({ assisted: false, salesPartnerId: null }));
    expect((await decideEventRequest(db, { kind: "OWNER", userId: 20 }, ref, { action: "CONFIRM", version: 1 }, now)).status).toBe("READY_TO_PAY");
  });
  it("a client cannot confirm owner availability", async () => {
    await expect(decideEventRequest(database(), { kind: "CLIENT", userId: 10 }, ref, { action: "CONFIRM", version: 1 }, now)).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks revoked agency capability inside the transaction", async () => {
    vi.mocked(loadAgencyGateInput).mockResolvedValue({ failure: "SUSPENDED" } as any);
    const db = database();
    await expect(decideEventRequest(db, { kind: "PARTNER", userId: 31, partnerId: 30 }, ref, { action: "APPROVE", version: 1, attested: true }, now)).rejects.toMatchObject({ status: 404 });
    expect(db.eventHireRequest.update).not.toHaveBeenCalled();
  });
  it("a recorded call cannot be approved by the same partner without owner acknowledgement", async () => {
    const db = database(record({ status: "OWNER_CONFIRMED", confirmationVia: "PARTNER_CALL", holdExpiresAt: new Date(now.getTime() + 3600000) }));
    await expect(decideEventRequest(db, { kind: "PARTNER", userId: 31, partnerId: 30 }, ref, { action: "APPROVE", version: 1, attested: true }, now)).rejects.toMatchObject({ code: "OWNER_ACK_REQUIRED" });
  });
  it("owner acknowledgement preserves the original hold deadline", async () => {
    const hold = new Date(now.getTime() + 600000);
    const db = database(record({ status: "OWNER_CONFIRMED", confirmationVia: "PARTNER_CALL", holdExpiresAt: hold }));
    const row = await decideEventRequest(db, { kind: "OWNER", userId: 20 }, ref, { action: "CONFIRM", version: 1 }, now);
    expect(row.confirmationVia).toBe("APP"); expect(row.holdExpiresAt).toEqual(hold);
  });
  it("fails the transaction if its audit record cannot be written", async () => {
    const db = database(); db.eventHireRequestEvent.create.mockRejectedValue(new Error("disk unavailable"));
    await expect(decideEventRequest(db, { kind: "OWNER", userId: 20 }, ref, { action: "CONFIRM", version: 1 }, now)).rejects.toThrow("disk unavailable");
    expect(db.notification.create).not.toHaveBeenCalled();
  });
  it("does not expose actor identities or call notes in the request projection", () => {
    const view = eventRequestView(record({ clientUserId: 99, confirmedOwnerId: 20, ownerContact: "secret", events: [{ details: "secret" }] }), now);
    expect(view).not.toHaveProperty("clientUserId"); expect(view).not.toHaveProperty("confirmedOwnerId"); expect(view).not.toHaveProperty("events");
  });
  it("requires an independent reviewer for a partner's phone confirmation", async () => {
    const row = record({ status: "OWNER_CONFIRMED", confirmationVia: "PARTNER_CALL", confirmedOwnerId: 20, holdExpiresAt: new Date(now.getTime() + 3600000) });
    await expect(decideEventRequest(database(row), { kind: "ADMIN", userId: 31 }, ref, { action: "VERIFY_CALL", version: 1, attested: true, note: "I called the owner back." }, now)).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    const result = await decideEventRequest(database(row), { kind: "ADMIN", userId: 40 }, ref, { action: "VERIFY_CALL", version: 1, attested: true, note: "I called the owner back." }, now);
    expect(result.confirmationVia).toBe("DESK_CALL"); expect(result.status).toBe("OWNER_CONFIRMED");
  });
  it("partner approval preserves the shorter hold deadline", async () => {
    const expires = new Date(now.getTime() + 10 * 60000);
    const db = database(record({ status: "OWNER_CONFIRMED", confirmationVia: "APP", confirmedOwnerId: 20, holdExpiresAt: expires }));
    const result = await decideEventRequest(db, { kind: "PARTNER", userId: 31, partnerId: 30 }, ref, { action: "APPROVE", version: 1, attested: true }, now);
    expect(result.status).toBe("READY_TO_PAY"); expect(result.holdExpiresAt).toEqual(expires);
  });
  it("escalates overdue owner requests without confirming them", async () => {
    const db = database(); db.eventHireRequest.findMany.mockResolvedValue([{ id: 1, propertyId: 7 }]);
    await runEventRequestLifecycle(db, now);
    expect(db.eventHireRequestEvent.create.mock.calls.map((c: any) => c[0].data.action)).toEqual(["OWNER_REMINDER", "ESCALATED"]);
    expect(db.eventHireRequest.update.mock.calls.every((c: any) => c[0].data.status === undefined)).toBe(true);
  });
});
