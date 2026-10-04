// Access boundaries for the Sales Executive workspace.
//
// The bar and restaurant roles run on /api/nrms/operations, which was built
// staff-aware and is covered by nrms.operations.access.test.ts. The sales role
// runs on the /api/owner/nrms routers, which were owner-only and were opened
// per endpoint. This file gives that the same regression net.
//
// It deliberately tests the REFUSALS as hard as the permissions, because every
// one of them is a judgement call that could silently invert:
//
//   - rooms and reservations exempt reads from the owner gate with a regex on
//     method AND path. A regex is exactly the thing that quietly stops matching.
//   - group blocks share one guard between listing blocks and operating on a
//     block's master folio. Sales may list; it must never take a payment or
//     issue a refund, holding no finance capability.
//   - agents split the agency relationship and request decision from the
//     owner-only invoice and payment flow.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const role = { value: "SALES_EXECUTIVE" as string };
  const fns = {
    propertyFindUnique: vi.fn(),
    propertyFindFirst: vi.fn(),
    membershipFindFirst: vi.fn(),
    accountFindUnique: vi.fn(),
    accountUpdate: vi.fn(),
    getNrmsEnrollment: vi.fn(),
    isNrmsEntitled: vi.fn(),
    anyFindMany: vi.fn(),
    anyFindUnique: vi.fn(),
    anyFindFirst: vi.fn(),
    anyCount: vi.fn(),
    // Its own mock rather than the catch-all: the staff rate floor reads room
    // types, and a test that proves a below-floor rate is refused must be able
    // to price the room type without also changing every other lookup.
    roomTypeFindMany: vi.fn(),
  };

  // A permissive Prisma stand-in. These tests assert what the guards decide,
  // not what the handlers return, so any model a handler reaches past the guard
  // answers with something harmless rather than throwing. Built inside the
  // hoisted block because vi.mock factories run before module scope exists.
  const model = () => ({
    findMany: fns.anyFindMany,
    findUnique: fns.anyFindUnique,
    findFirst: fns.anyFindFirst,
    count: fns.anyCount,
    groupBy: fns.anyFindMany,
    aggregate: fns.anyFindUnique,
  });

  const prismaStub: any = new Proxy(
    {
      property: { findUnique: fns.propertyFindUnique, findFirst: fns.propertyFindFirst, findMany: fns.anyFindMany },
      nrmsStaffMembership: { findFirst: fns.membershipFindFirst, findMany: fns.anyFindMany },
      ownerPaygAccount: { findUnique: fns.accountFindUnique, update: fns.accountUpdate },
      roomType: { findMany: fns.roomTypeFindMany, findUnique: fns.anyFindUnique, findFirst: fns.anyFindFirst },
    },
    {
      get(target: any, key: string) {
        if (key in target) return target[key];
        if (key === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(prismaStub) : []);
        return model();
      },
    },
  );

  return { ...fns, role, prismaStub };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: mocks.prismaStub, typedPrisma: mocks.prismaStub }));

// The real requireNrms and loadOwnedProperty are kept: a route that still gates
// on ownership must keep refusing, and that is half of what this file proves.
vi.mock("../lib/nrms.js", async () => {
  const actual = await vi.importActual<any>("../lib/nrms.js");
  return {
    ...actual,
    getNrmsEnrollment: mocks.getNrmsEnrollment,
    isNrmsEntitled: mocks.isNrmsEntitled,
  };
});

// A staff member is a CUSTOMER account holding an NRMS membership, which is the
// whole reason requireRole("OWNER") used to shut them out.
vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: () => void) => {
      req.user = { id: 23, role: "USER" };
      next();
    },
  };
});

import { router as agentsRouter } from "./owner.nrms.agents.js";
import { router as calendarRouter } from "./owner.nrms.calendar.js";
import { router as groupBlocksRouter } from "./owner.nrms.groupBlocks.js";
import { router as guestsRouter } from "./owner.nrms.guests.js";
import { router as reservationsRouter } from "./owner.nrms.reservations.js";
import { router as roomsRouter } from "./owner.nrms.rooms.js";
import { router as salesPerformanceRouter } from "./owner.nrms.salesPerformance.js";

const app = express();
app.use(express.json());
app.use("/api/owner/nrms/agents", agentsRouter);
app.use("/api/owner/nrms/calendar", calendarRouter);
app.use("/api/owner/nrms/group-blocks", groupBlocksRouter);
app.use("/api/owner/nrms/guests", guestsRouter);
app.use("/api/owner/nrms/reservations", reservationsRouter);
app.use("/api/owner/nrms/rooms", roomsRouter);
app.use("/api/owner/nrms/sales-performance", salesPerformanceRouter);

const PROPERTY_ID = 91;
const OWNER_ID = 12;

/** Refused before reaching the handler, whichever shape the refusal takes. */
function expectRefused(status: number) {
  // 403 is a role or capability refusal. 404 is an ownership lookup that found
  // nothing for this caller. Both mean "not allowed"; neither is a 2xx.
  expect([401, 403, 404]).toContain(status);
}

/** Passed the guard. The handler may then fail on stubbed data, which is not
 *  what this file is about, so anything that is not a refusal counts. */
function expectAllowed(status: number) {
  expect([401, 403, 404]).not.toContain(status);
}

describe("Sales Executive access to the owner NRMS routers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role.value = "SALES_EXECUTIVE";
    mocks.propertyFindUnique.mockResolvedValue({
      id: PROPERTY_ID,
      ownerId: OWNER_ID,
      title: "Sheraton Hotel",
      status: "APPROVED",
      currency: "TZS",
      nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      nrmsMenuPublic: true,
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: "09:00",
    });
    mocks.membershipFindFirst.mockImplementation(async () => ({
      id: 7,
      role: mocks.role.value,
      outletId: null,
      inviteVersion: 3,
      status: "ACTIVE",
      confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
    }));
    mocks.accountFindUnique.mockResolvedValue({
      id: 44, status: "ACTIVE", maxAgents: 5, maxStaff: 100, maxOutlets: 50, maxRooms: 500,
      trialEndsAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    mocks.getNrmsEnrollment.mockResolvedValue({ status: "ACTIVE" });
    mocks.isNrmsEntitled.mockReturnValue(true);
    mocks.anyFindMany.mockResolvedValue([]);
    mocks.anyFindUnique.mockResolvedValue(null);
    mocks.anyFindFirst.mockResolvedValue(null);
    // Priced at 100,000 with no floor configured, so the floor is the standard
    // rate: this is the state every property starts in.
    mocks.roomTypeFindMany.mockResolvedValue([
      { id: 3, name: "Deluxe double", baseRate: 100_000, staffRateFloor: null, currency: "TZS" },
    ]);
    // Ownership is enforced through `where: { ownerId }`, so the stub honours
    // it. A route that resolves the property by the PROPERTY's owner (the
    // migrated ones) finds it; a route still resolving by the CALLER's id (the
    // owner-only ones) finds nothing, exactly as in production.
    mocks.propertyFindFirst.mockImplementation(async (args: any) => {
      const scopedTo = args?.where?.ownerId;
      if (scopedTo !== undefined && scopedTo !== OWNER_ID) return null;
      return {
        id: PROPERTY_ID,
        ownerId: OWNER_ID,
        title: "Sheraton Hotel",
        status: "APPROVED",
        roomsSpec: null,
        nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      };
    });
    mocks.anyCount.mockResolvedValue(0);
  });

  describe("rooms: reads are open, inventory changes are not", () => {
    it("admits the three reads", async () => {
      for (const path of [
        `/api/owner/nrms/rooms/${PROPERTY_ID}`,
        `/api/owner/nrms/rooms/${PROPERTY_ID}/availability`,
        `/api/owner/nrms/rooms/${PROPERTY_ID}/reconciliation`,
      ]) {
        const res = await request(app).get(path);
        expectAllowed(res.status);
      }
    });

    it("refuses every inventory mutation", async () => {
      // A sales executive holds rates.read and rates.change_request: request a
      // change, never apply one. If the read exemption regex ever widened to
      // match these, this is what would catch it.
      expectRefused((await request(app).post(`/api/owner/nrms/rooms/${PROPERTY_ID}/import`).send({})).status);
      expectRefused((await request(app).post(`/api/owner/nrms/rooms/${PROPERTY_ID}/types`).send({})).status);
      expectRefused((await request(app).post(`/api/owner/nrms/rooms/${PROPERTY_ID}/units`).send({})).status);
      expectRefused((await request(app).patch("/api/owner/nrms/rooms/types/5").send({})).status);
      expectRefused((await request(app).delete("/api/owner/nrms/rooms/types/5")).status);
      expectRefused((await request(app).patch("/api/owner/nrms/rooms/units/9").send({})).status);
      expectRefused((await request(app).delete("/api/owner/nrms/rooms/units/9")).status);
    });
  });

  describe("reservations: the book may be read, not written", () => {
    function stubReservationGroup() {
      mocks.anyFindUnique.mockResolvedValue({
        id: 6,
        propertyId: PROPERTY_ID,
        ownerId: OWNER_ID,
        reference: "GRP-READONLY",
        name: "Kilimanjaro Tour",
        notes: null,
        status: "CHECKED_IN",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        updatedAt: new Date("2026-10-02T00:00:00.000Z"),
        block: null,
        reservations: [],
        _count: { reservations: 0 },
      });
    }

    it("admits reading the reservation book and the group list", async () => {
      expectAllowed((await request(app).get(`/api/owner/nrms/reservations/property/${PROPERTY_ID}`)).status);
      expectAllowed((await request(app).get(`/api/owner/nrms/reservations/property/${PROPERTY_ID}/groups`)).status);
    });

    it("admits a read-only reservation detail without returning transaction registers", async () => {
      mocks.anyFindUnique.mockResolvedValue({
        id: 17, propertyId: PROPERTY_ID, ownerId: OWNER_ID, bookingId: null, source: "PHONE", status: "CONFIRMED",
        checkIn: new Date("2026-11-02T00:00:00.000Z"), checkOut: new Date("2026-11-04T00:00:00.000Z"),
        adults: 2, children: 0, currency: "TZS", totalAmount: 200_000, amountPaid: 0, chargesTotal: 0,
        guestProfile: { id: 88, fullName: "Guest", phone: "+255700000001", email: "guest@example.com", nationality: "TZ" },
        group: null, allocations: [], payments: [{ id: 1, amount: 50_000 }], charges: [{ id: 2, amount: 10_000 }],
        outletOrders: [{ id: 3 }], events: [{ id: 4 }], masterFolioItems: [], agentBookingGuests: [],
      });
      const response = await request(app).get("/api/owner/nrms/reservations/17");
      expectAllowed(response.status);
      expect(response.body.reservation).toMatchObject({ id: 17, status: "CONFIRMED", payments: [], charges: [], outletOrders: [], events: [] });
    });

    it("admits group detail but refuses every operational group action", async () => {
      stubReservationGroup();
      const detail = await request(app).get("/api/owner/nrms/reservations/groups/6");
      expectAllowed(detail.status);
      expect(detail.body).toMatchObject({ group: { id: 6, name: "Kilimanjaro Tour" }, accessRole: "SALES_EXECUTIVE" });

      for (const response of [
        await request(app).patch("/api/owner/nrms/reservations/groups/6").send({ name: "Changed group" }),
        await request(app).post("/api/owner/nrms/reservations/groups/6/members").send({ reservationIds: [17] }),
        await request(app).delete("/api/owner/nrms/reservations/groups/6/members/17"),
        await request(app).delete("/api/owner/nrms/reservations/groups/6"),
        await request(app).post("/api/owner/nrms/reservations/groups/6/cancel").send({ reason: "Agency cancelled" }),
        await request(app).post("/api/owner/nrms/reservations/groups/6/no-show").send({ reason: "Party did not arrive" }),
        await request(app).post("/api/owner/nrms/reservations/groups/6/preview").send({ action: "CHECK_OUT" }),
        await request(app).post("/api/owner/nrms/reservations/groups/6/check-in").send({}),
        await request(app).post("/api/owner/nrms/reservations/groups/6/check-out").send({}),
        await request(app).get("/api/owner/nrms/reservations/groups/6/rooms"),
        await request(app).post("/api/owner/nrms/reservations/groups/6/rooms").send({ autoAssignRemaining: true }),
      ]) {
        expectRefused(response.status);
      }
    });

    it("refuses creating a reservation on the same path", async () => {
      // GET and POST share /property/:id. The exemption matches on method as
      // well as path precisely so this stays closed.
      expectRefused((await request(app).post(`/api/owner/nrms/reservations/property/${PROPERTY_ID}`).send({})).status);
    });

    it("keeps arrival anomaly resolution with Front Desk and management", async () => {
      mocks.anyFindUnique.mockResolvedValue({ propertyId: PROPERTY_ID });
      const body = { resolution: "APPROVE_EARLY_CHECKIN", reason: "Guest arrival verified at reception" };

      expectRefused((await request(app).post("/api/owner/nrms/reservations/17/early-check-in-resolution").send(body)).status);

      for (const role of ["FRONT_DESK", "MANAGER"]) {
        mocks.role.value = role;
        expectAllowed((await request(app).post("/api/owner/nrms/reservations/17/early-check-in-resolution").send(body)).status);
      }
    });
  });

  describe("group blocks: listing is sales work, the master folio is not", () => {
    // Every body below is schema-valid on purpose. createBlockSchema and
    // editBlockSchema are parsed BEFORE the access loader runs, so an empty
    // body returns 400 without ever reaching the guard, and 400 is not a
    // refusal. A test sending {} would pass whether the guard admitted sales
    // or not.
    const standardBlock = {
      name: "Kilimanjaro Expedition Group",
      agencyName: "Summit Travel",
      contactName: "Neema Kimaro",
      contactPhone: "+255700000001",
      contactEmail: "neema@summittravel.co.tz",
      checkIn: "2026-11-02",
      checkOut: "2026-11-06",
      cutOffAt: "2026-10-19",
      billingMode: "INDIVIDUAL" as const,
      rooms: [{ roomTypeId: 3, quantity: 6, nightlyRate: 120_000 }],
    };

    /** A live block for the handlers that load one by id. */
    function stubBlock(overrides: Record<string, unknown> = {}) {
      mocks.anyFindUnique.mockResolvedValue({
        id: 5,
        propertyId: PROPERTY_ID,
        ownerId: OWNER_ID,
        reference: "BLK-TEST",
        name: "Kilimanjaro Expedition Group",
        agencyName: "Summit Travel",
        contactName: "Neema Kimaro",
        contactPhone: "+255700000001",
        contactEmail: "neema@summittravel.co.tz",
        checkIn: new Date("2026-11-02T00:00:00.000Z"),
        checkOut: new Date("2026-11-06T00:00:00.000Z"),
        cutOffAt: new Date("2026-10-19T00:00:00.000Z"),
        status: "HELD",
        currency: "TZS",
        billingMode: "INDIVIDUAL",
        rooms: [{ id: 31, roomTypeId: 3, quantity: 6, pickedUp: 0, nightlyRate: 120_000 }],
        masterFolio: null,
        ...overrides,
      });
    }

    it("admits listing blocks", async () => {
      expectAllowed((await request(app).get(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`)).status);
    });

    it("admits the commercial block detail but omits its financial registers", async () => {
      stubBlock({
        masterFolio: { id: 99, items: [], payments: [{ id: 1, amount: 50_000 }], refunds: [], proFormas: [] },
      });
      const response = await request(app).get("/api/owner/nrms/group-blocks/blocks/5");
      expectAllowed(response.status);
      expect(response.body).toMatchObject({ block: { id: 5, name: "Kilimanjaro Expedition Group", masterFolio: null, chargeRegister: [] }, accessRole: "SALES_EXECUTIVE" });
    });

    it("admits shaping the block: agree, amend, release, cancel", async () => {
      // Agreeing group business with agencies is the sales role's own work.
      // These four ran through an owner-only loader, so a role holding
      // sales.group.manage could read the list and change nothing on it.
      stubBlock();
      expectAllowed((await request(app).post(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`).send(standardBlock)).status);
      expectAllowed((await request(app).patch("/api/owner/nrms/group-blocks/blocks/5").send({ notes: "Flight moved by one day" })).status);
      expectAllowed((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/release")).status);
      expectAllowed((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/cancel")).status);
    });

    it("checks NRMS billing before committing a new group hold", async () => {
      mocks.accountFindUnique.mockResolvedValue({
        id: 44,
        status: "PAYMENT_REQUIRED",
        unpaidBalance: 129_000,
        unpaidLimit: 50_000,
        policyId: null,
        maxAgents: 5,
        maxStaff: 100,
        maxOutlets: 50,
        maxRooms: 500,
        trialEndsAt: new Date("2030-01-01T00:00:00.000Z"),
      });

      const response = await request(app)
        .post(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`)
        .send(standardBlock);

      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({
        code: "NRMS_PAYMENT_REQUIRED",
        billing: {
          status: "PAYMENT_REQUIRED",
          action: "PAY",
          outstanding: 129_000,
          limit: 50_000,
          currency: "TZS",
        },
      });
    });

    it("refuses approving a party below the group minimum", async () => {
      // The small group exception is the owner's own policy waiver. If sales
      // could write the reason themselves, the minimum would not be a policy.
      const response = await request(app)
        .post(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`)
        .send({
          ...standardBlock,
          rooms: [{ roomTypeId: 3, quantity: 2, nightlyRate: 120_000 }],
          smallGroupApprovalReason: "Contracted corporate party of two rooms",
        });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("SMALL_GROUP_APPROVAL_NOT_PERMITTED");
    });

    it("refuses a rate below what staff may agree", async () => {
      // The rate typed on a block line becomes the guest's rate on pickup, so
      // an unbounded number here is an unbounded discount authority. Opening
      // the block lifecycle to staff without this would have handed a sales
      // executive the ability to agree twenty rooms at any price, free
      // included.
      const response = await request(app)
        .post(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`)
        .send({ ...standardBlock, rooms: [{ roomTypeId: 3, quantity: 6, nightlyRate: 40_000 }] });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("RATE_BELOW_STAFF_FLOOR");
      // The refusal names the number that would have worked, so the person
      // knows what to ask the owner for.
      expect(response.body.error).toContain("100,000");
    });

    it("refuses amending a rate below the floor, not only agreeing one", async () => {
      stubBlock();
      const response = await request(app)
        .patch("/api/owner/nrms/group-blocks/blocks/5")
        .send({ rooms: [{ id: 31, quantity: 6, nightlyRate: 40_000 }] });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("RATE_BELOW_STAFF_FLOOR");
    });

    // The owner's exemption from the floor is not tested here: this file signs
    // in as a staff account throughout, and bending that for one case would
    // weaken every other test in it. nrmsRateFloor.test.ts covers the exemption
    // directly, and asserts the room type is never even looked up.

    it("refuses master folio money operations", async () => {
      // These share a guard with the block list until it was split. Sales holds
      // no finance capability, so taking a payment or issuing a refund here
      // must stay refused.
      const payment = { amount: 50_000, method: "CASH", idempotencyKey: "idem-key-0001" };
      const refund = { amount: 50_000, method: "CASH", reason: "Overpaid" };
      expectRefused((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/master-folio/payments").send(payment)).status);
      expectRefused((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/master-folio/refunds").send(refund)).status);
    });

    it("keeps front desk out of shaping a block", async () => {
      // Front desk picks guests up from a block, which is guarded separately.
      // They do not agree its commercial terms, so widening the lifecycle for
      // sales must not have widened it for everyone with a membership.
      mocks.role.value = "FRONT_DESK";
      stubBlock();
      expectRefused((await request(app).post(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`).send(standardBlock)).status);
      expectRefused((await request(app).patch("/api/owner/nrms/group-blocks/blocks/5").send({ notes: "No" })).status);
      expectRefused((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/release")).status);
      expectRefused((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/cancel")).status);
    });

    it("keeps outlet staff out of shaping a block", async () => {
      mocks.role.value = "BAR";
      stubBlock();
      expectRefused((await request(app).post(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`).send(standardBlock)).status);
      expectRefused((await request(app).post("/api/owner/nrms/group-blocks/blocks/5/cancel")).status);
    });
  });

  describe("sales performance: own numbers, and only own numbers", () => {
    const url = `/api/owner/nrms/sales-performance/property/${PROPERTY_ID}`;

    it("admits the sales executive to their own production", async () => {
      const response = await request(app).get(url);
      expectAllowed(response.status);
      expect(response.body.scope).toBe("OWN");
      // One person in the report, and it is the caller. A sales executive
      // reading the roster would turn their own report into a league table.
      expect(response.body.people).toHaveLength(1);
      expect(response.body.people[0].userId).toBe(23);
    });

    it("widens to the roster for a manager", async () => {
      mocks.role.value = "MANAGER";
      const response = await request(app).get(url);
      expectAllowed(response.status);
      expect(response.body.scope).toBe("PROPERTY");
    });

    it("refuses roles that hold no sales analytics capability", async () => {
      // This endpoint is guarded by the capability rather than a role list, so
      // it is the one place where sales.analytics.read decides anything. Front
      // desk reads inquiries but does not hold it; outlet staff hold nothing
      // sales at all.
      for (const role of ["FRONT_DESK", "BAR", "RESTAURANT", "OUTLET_SUPERVISOR"]) {
        mocks.role.value = role;
        expectRefused((await request(app).get(url)).status);
      }
    });

    it("refuses a period that runs backwards or too long", async () => {
      expect((await request(app).get(`${url}?from=2026-09-01&to=2026-08-01`)).status).toBe(400);
      expect((await request(app).get(`${url}?from=2020-01-01&to=2026-08-01`)).status).toBe(400);
    });
  });

  describe("agents: commercial decisions, not booking money", () => {
    it("admits the relationship endpoints", async () => {
      expectAllowed((await request(app).get(`/api/owner/nrms/agents/property/${PROPERTY_ID}`)).status);
      expectAllowed((await request(app).get(`/api/owner/nrms/agents/property/${PROPERTY_ID}/rate-plans`)).status);
    });

    it("admits the booking request queue and its inventory decisions", async () => {
      expectAllowed((await request(app).get(`/api/owner/nrms/agents/property/${PROPERTY_ID}/requests`)).status);

      mocks.anyFindUnique.mockResolvedValue({
        id: 77,
        status: "PENDING",
        propertyId: PROPERTY_ID,
        checkIn: new Date("2026-11-02T00:00:00.000Z"),
        checkOut: new Date("2026-11-04T00:00:00.000Z"),
        currency: "TZS",
        quotedTotal: 200_000,
        reservationId: 17,
        link: { id: 8, agentAccount: { primaryUserId: null, legalName: "Summit Travel", primaryUser: { email: null } } },
      });
      expectAllowed((await request(app).post("/api/owner/nrms/agents/requests/77/approve").send({})).status);
      expectAllowed((await request(app).post("/api/owner/nrms/agents/requests/77/reject").send({ reason: "Dates unavailable" })).status);
    });

    it("keeps invoices and received-payment confirmation owner-only", async () => {
      mocks.anyFindUnique.mockResolvedValue({ id: 77, propertyId: PROPERTY_ID });
      expectRefused((await request(app).post("/api/owner/nrms/agents/requests/77/invoices").send({ discountAmount: 0 })).status);
      expectRefused((await request(app).post("/api/owner/nrms/agents/requests/77/payments/confirm").send({
        amount: 100_000,
        method: "BANK_TRANSFER",
        idempotencyKey: "sales-money-refusal-77",
      })).status);
    });
  });

  describe("calendar and guests", () => {
    it("admits availability and the guest book", async () => {
      expectAllowed((await request(app).get(`/api/owner/nrms/calendar/${PROPERTY_ID}`)).status);
      expectAllowed((await request(app).get(`/api/owner/nrms/guests/${PROPERTY_ID}`)).status);
    });
  });

  describe("a role with no membership on the property", () => {
    it("is refused everywhere the sales role is admitted", async () => {
      // The guards must refuse on the role, not merely on the route. Proving the
      // allow cases without this would only prove the routes are reachable.
      mocks.membershipFindFirst.mockResolvedValue(null);
      expectRefused((await request(app).get(`/api/owner/nrms/rooms/${PROPERTY_ID}`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/reservations/property/${PROPERTY_ID}`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/agents/property/${PROPERTY_ID}`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/calendar/${PROPERTY_ID}`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/guests/${PROPERTY_ID}`)).status);
    });
  });

  describe("an outlet role is not a sales role", () => {
    it("refuses a bar attendant on the sales surfaces", async () => {
      // BAR is admitted on /api/nrms/operations, never on these routers.
      mocks.role.value = "BAR";
      expectRefused((await request(app).get(`/api/owner/nrms/reservations/property/${PROPERTY_ID}`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/agents/property/${PROPERTY_ID}`)).status);
      expectRefused((await request(app).get(`/api/owner/nrms/group-blocks/property/${PROPERTY_ID}/blocks`)).status);
    });
  });
});
