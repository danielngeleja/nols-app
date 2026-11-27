import { beforeEach, describe, expect, it } from "vitest";
import {
  AccessRequestError,
  decideLongStayAccess,
  isAccessRequestRef,
  requestLongStayAccess,
  revokeLongStayFromCancelledListing,
  settleRequestsAlreadySwitchedOn,
  settleRequestsForSwitchedOnOwner,
} from "./accessRequest.js";

/** An in-memory store shaped like the Prisma calls the service makes. */
function fakeDb(opts: { listingStatus?: string; propertyType?: string; grant?: any; owner?: any; otherLongStayHomes?: number } = {}) {
  const state: any = {
    requests: [] as any[],
    grant: opts.grant ?? null,
    assisted: { id: 40, status: opts.listingStatus ?? "DRAFTING", salesPartnerId: 5, propertyId: 30, ownerUserId: 900, property: { type: opts.propertyType ?? "APARTMENT", title: "Sea View" } },
  };
  const db: any = {
    state,
    salesAssistedListing: { findUnique: async () => state.assisted },
    user: { findUnique: async () => opts.owner ?? { role: "OWNER", suspendedAt: null, deletedAt: null } },
    property: { count: async () => opts.otherLongStayHomes ?? 0 },
    longStayLandlordGrant: {
      findUnique: async () => state.grant,
      upsert: async ({ create, update }: any) => { state.grant = state.grant ? { ...state.grant, ...update } : { ...create }; return state.grant; },
      delete: async () => { state.grant = null; },
    },
    longStayAccessRequest: {
      findFirst: async ({ where }: any) => state.requests.find((r: any) => r.assistedListingId === where.assistedListingId && (!where.status || r.status === where.status)) ?? null,
      findUnique: async ({ where }: any) => {
        const row = state.requests.find((r: any) => r.publicRef === where.publicRef);
        return row ? { ...row } : null;
      },
      create: async ({ data }: any) => { const row = { id: state.requests.length + 1, ...data }; state.requests.push(row); return row; },
      updateMany: async ({ where, data }: any) => {
        const rows = state.requests.filter((r: any) => (where.id == null || r.id === where.id) && (where.assistedListingId == null || r.assistedListingId === where.assistedListingId) && r.status === where.status);
        rows.forEach((r: any) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
  };
  return db;
}

const ASK = { assistedId: 40, salesPartnerId: 5, reason: "Owner wants 12-month tenants for the flat" };

describe("partner asks for long stay", () => {
  let db: any;
  beforeEach(() => { db = fakeDb(); });

  it("opens one waiting request with an opaque reference, and never a second", async () => {
    const first = await requestLongStayAccess(db, ASK);
    expect(first.created).toBe(true);
    expect(isAccessRequestRef(first.request.publicRef)).toBe(true);
    expect(first.request).toMatchObject({ status: "PENDING", ownerUserId: 900, propertyId: 30, salesPartnerId: 5 });
    const again = await requestLongStayAccess(db, ASK);
    expect(again.created).toBe(false);
    expect(db.state.requests).toHaveLength(1);
  });

  it("only the partner of that listing, while it is still being prepared, for a home type", async () => {
    await expect(requestLongStayAccess(db, { ...ASK, salesPartnerId: 6 })).rejects.toMatchObject({ status: 404 });
    await expect(requestLongStayAccess(fakeDb({ listingStatus: "SUBMITTED" }), ASK)).rejects.toMatchObject({ status: 409 });
    await expect(requestLongStayAccess(fakeDb({ propertyType: "HOTEL" }), ASK)).rejects.toThrow(/houses, apartments/);
    await expect(requestLongStayAccess(db, { ...ASK, reason: "pls" })).rejects.toBeInstanceOf(AccessRequestError);
  });

  it("needs no request once the owner is on, and refuses while the owner is paused", async () => {
    expect(await requestLongStayAccess(fakeDb({ grant: { pausedAt: null } }), ASK)).toMatchObject({ alreadyGranted: true, created: false });
    await expect(requestLongStayAccess(fakeDb({ grant: { pausedAt: new Date(), pauseReason: "claim" } }), ASK)).rejects.toThrow(/paused/);
  });
});

describe("admin decides", () => {
  it("approval switches long stay on for the owner, recorded against the request, once", async () => {
    const db = fakeDb();
    const { request } = await requestLongStayAccess(db, ASK);
    await decideLongStayAccess(db, { ref: request.publicRef, adminId: 1, decision: "APPROVED", note: null });
    expect(db.state.requests[0].status).toBe("APPROVED");
    expect(db.state.grant).toMatchObject({ userId: 900, enabledById: 1 });
    expect(db.state.grant.note).toContain(request.publicRef);
    await expect(decideLongStayAccess(db, { ref: request.publicRef, adminId: 1, decision: "APPROVED", note: null })).rejects.toMatchObject({ status: 409 });
  });

  it("a decline needs a reason and switches nothing on", async () => {
    const db = fakeDb();
    const { request } = await requestLongStayAccess(db, ASK);
    await expect(decideLongStayAccess(db, { ref: request.publicRef, adminId: 1, decision: "DECLINED", note: "no" })).rejects.toThrow(/reason/);
    await decideLongStayAccess(db, { ref: request.publicRef, adminId: 1, decision: "DECLINED", note: "The owner did not confirm on the phone." });
    expect(db.state.requests[0]).toMatchObject({ status: "DECLINED", decisionNote: "The owner did not confirm on the phone." });
    expect(db.state.grant).toBeNull();
  });

  it("never switches on for a paused listing or a suspended owner", async () => {
    const paused = fakeDb();
    const { request } = await requestLongStayAccess(paused, ASK);
    paused.state.assisted.status = "PAUSED_OBJECTION";
    await expect(decideLongStayAccess(paused, { ref: request.publicRef, adminId: 1, decision: "APPROVED", note: null })).rejects.toMatchObject({ status: 409 });
    expect(paused.state.grant).toBeNull();

    const suspended = fakeDb({ owner: { role: "OWNER", suspendedAt: new Date(), deletedAt: null } });
    const second = await requestLongStayAccess(suspended, ASK);
    await expect(decideLongStayAccess(suspended, { ref: second.request.publicRef, adminId: 1, decision: "APPROVED", note: null })).rejects.toThrow(/suspended/);
  });
});

describe("owner objects and the listing is cancelled", () => {
  async function approved(opts: Parameters<typeof fakeDb>[0] = {}) {
    const db = fakeDb(opts);
    const { request } = await requestLongStayAccess(db, ASK);
    await decideLongStayAccess(db, { ref: request.publicRef, adminId: 1, decision: "APPROVED", note: null });
    return db;
  }

  it("takes back a switch that came only from this listing's request", async () => {
    const db = await approved();
    expect(await revokeLongStayFromCancelledListing(db, 40, 900, 30)).toEqual({ revoked: true });
    expect(db.state.grant).toBeNull();
  });

  it("keeps the switch when the owner has another long-stay home, or an admin gave it another way", async () => {
    const other = await approved({ otherLongStayHomes: 1 });
    expect(await revokeLongStayFromCancelledListing(other, 40, 900, 30)).toEqual({ revoked: false });
    const manual = await approved();
    manual.state.grant.note = "Switched on from the owner page";
    expect(await revokeLongStayFromCancelledListing(manual, 40, 900, 30)).toEqual({ revoked: false });
    expect(manual.state.grant).not.toBeNull();
  });

  it("withdraws a request still waiting", async () => {
    const db = fakeDb();
    await requestLongStayAccess(db, ASK);
    await revokeLongStayFromCancelledListing(db, 40, 900, 30);
    expect(db.state.requests[0].status).toBe("WITHDRAWN");
  });
});

describe("one switch for all the owner's homes", () => {
  function switchDb(requests: any[], grants: any[] = []) {
    return {
      requests,
      longStayAccessRequest: {
        findMany: async ({ where }: any) => requests.filter((r) => r.status === where.status && (where.ownerUserId == null || r.ownerUserId === where.ownerUserId)),
        updateMany: async ({ where, data }: any) => {
          const rows = requests.filter((r) => where.id.in.includes(r.id) && r.status === where.status);
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      },
      longStayLandlordGrant: { findMany: async ({ where }: any) => grants.filter((g) => where.userId.in.includes(g.userId) && g.pausedAt === null) },
    };
  }
  const waiting = (id: number, ownerUserId: number) => ({ id, publicRef: `lr_${id}`, ownerUserId, salesPartnerId: 5, propertyId: id, assistedListingId: id, status: "PENDING" });

  it("approving for an owner settles that owner's other waiting requests, and only theirs", async () => {
    const db = switchDb([waiting(1, 900), waiting(2, 900), waiting(3, 901)]);
    const settled = await settleRequestsForSwitchedOnOwner(db, { ownerUserId: 900, adminId: 7, note: "Approved together" });
    expect(settled.map((r) => r.publicRef)).toEqual(["lr_1", "lr_2"]);
    expect(db.requests.map((r: any) => r.status)).toEqual(["APPROVED", "APPROVED", "PENDING"]);
    expect(db.requests[0].decidedById).toBe(7);
  });

  it("closes waiting requests for owners already switched on, not paused ones", async () => {
    const db = switchDb([waiting(1, 900), waiting(2, 901)], [{ userId: 900, pausedAt: null }, { userId: 901, pausedAt: new Date() }]);
    const settled = await settleRequestsAlreadySwitchedOn(db);
    expect(settled.map((r) => r.publicRef)).toEqual(["lr_1"]);
    expect(db.requests.map((r: any) => r.status)).toEqual(["APPROVED", "PENDING"]);
  });
});
