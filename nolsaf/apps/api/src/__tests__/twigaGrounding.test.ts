import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Grounding reads the caller's own records, so these tests care about two
 * things above all: that the answer is personalised when it should be, and
 * that every query carries an ownership scope so it can never reach anyone
 * else's data.
 */
const db = vi.hoisted(() => {
  const calls: Array<{ model: string; method: string; args: any }> = [];
  const record = (model: string, method: string) =>
    vi.fn(async (args: any) => {
      calls.push({ model, method, args });
      const key = `${model}.${method}`;
      const queued = (db.responses as any)[key];
      if (typeof queued === "function") return queued(args);
      return queued ?? null;
    });

  return {
    calls,
    responses: {} as Record<string, any>,
    prisma: {
      booking: { findMany: record("booking", "findMany"), count: record("booking", "count") },
      property: { findMany: record("property", "findMany"), count: record("property", "count") },
      invoice: { count: record("invoice", "count"), findFirst: record("invoice", "findFirst") },
    },
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: db.prisma }));

// Safe as a static import: vi.mock is hoisted above it, so grounding.ts binds
// to the mock when it loads.
import { ground, hasGrounder } from "../lib/twiga/grounding";

const customer = { userId: 7, role: "USER" };
const owner = { userId: 7, role: "OWNER" };

beforeEach(() => {
  db.calls.length = 0;
  db.responses = {};
});

/** Every `where` clause reachable from the recorded calls, flattened to JSON. */
const allWheres = () => db.calls.map((c) => JSON.stringify(c.args?.where ?? {}));

describe("access control", () => {
  it("does nothing without a signed-in user", async () => {
    expect(await ground("booking-status", null)).toBeNull();
    expect(await ground("booking-status", { userId: 0, role: "USER" })).toBeNull();
    expect(await ground("booking-status", { userId: -1, role: "USER" })).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("does not ground an intent that has no grounder", async () => {
    expect(await ground("payment-methods", customer)).toBeNull();
    expect(await ground(null, customer)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("refuses owner grounders for a non-owner, even on the owner intent", async () => {
    expect(await ground("owner-payouts", customer)).toBeNull();
    expect(await ground("owner-listing-approval", customer)).toBeNull();
    expect(await ground("owner-bookings-checkin", customer)).toBeNull();
    expect(db.calls, "a non-owner must not reach owner data at all").toHaveLength(0);
  });

  it("scopes every query to the caller's own id", async () => {
    db.responses = {
      "booking.findMany": [],
      "booking.count": 0,
      "property.findMany": [],
      "property.count": 0,
      "invoice.count": 0,
      "invoice.findFirst": null,
    };

    await ground("booking-status", customer);
    await ground("cancellation-refund", customer);
    await ground("owner-listing-approval", owner);
    await ground("owner-payouts", owner);
    await ground("owner-bookings-checkin", owner);

    expect(db.calls.length).toBeGreaterThan(0);
    for (const where of allWheres()) {
      // Customer reads pin userId; owner reads pin ownerId, directly or through
      // the property relation. An unscoped read would fail here.
      expect(where, `unscoped query: ${where}`).toMatch(/"(userId|ownerId)":\s*7/);
    }
  });

  it("uses only read methods", async () => {
    db.responses = { "booking.findMany": [], "booking.count": 0 };
    await ground("booking-status", customer);
    await ground("cancellation-refund", customer);
    for (const call of db.calls) {
      expect(["findMany", "findFirst", "count"]).toContain(call.method);
    }
  });
});

describe("customer grounding", () => {
  it("names the caller's active bookings and their state", async () => {
    db.responses["booking.findMany"] = [
      {
        id: 1,
        status: "CONFIRMED",
        checkIn: new Date("2026-10-02"),
        checkOut: new Date("2026-10-05"),
        property: { title: "Kendwa Beach Lodge" },
      },
    ];

    const text = await ground("booking-status", customer);
    expect(text).toContain("Kendwa Beach Lodge");
    expect(text).toContain("confirmed");
    expect(text).toContain("1 active booking");
  });

  it("calls out an unpaid draft, because it will not be held", async () => {
    db.responses["booking.findMany"] = [
      {
        id: 2,
        status: "NEW",
        checkIn: new Date("2026-11-01"),
        checkOut: new Date("2026-11-03"),
        property: { title: "Stone Town House" },
      },
    ];

    const text = await ground("booking-status", customer);
    expect(text).toContain("not paid for yet");
    expect(text).toContain("complete the payment");
  });

  it("stays silent when there is nothing to report, so the static answer stands", async () => {
    db.responses["booking.findMany"] = [];
    expect(await ground("booking-status", customer)).toBeNull();
  });

  it("tells the caller plainly when nothing is cancellable", async () => {
    db.responses["booking.count"] = 0;
    const text = await ground("cancellation-refund", customer);
    expect(text).toContain("do not have any upcoming bookings");
  });
});

describe("owner grounding", () => {
  it("separates drafts from listings actually awaiting review", async () => {
    db.responses["property.findMany"] = [
      { title: "Serengeti Camp", status: "DRAFT" },
      { title: "Arusha Lodge", status: "PENDING" },
    ];
    db.responses["property.count"] = 3;

    const text = await ground("owner-listing-approval", owner);
    // The common owner confusion is "why has nothing happened", when the
    // listing was never submitted. That distinction has to be explicit.
    expect(text).toContain("still a draft");
    expect(text).toContain("Serengeti Camp");
    expect(text).toContain("Awaiting review: Arusha Lodge");
  });

  it("reports payout counts and how long the oldest has waited", async () => {
    db.responses["invoice.count"] = 2;
    db.responses["invoice.findFirst"] = { issuedAt: new Date("2026-09-01") };

    const text = await ground("owner-payouts", owner);
    expect(text).toContain("in progress");
    expect(text).toContain("1 Sep 2026");
    expect(text).toContain("rejected");
  });

  it("summarises the day across the owner's properties", async () => {
    db.responses["booking.count"] = 4;
    const text = await ground("owner-bookings-checkin", owner);
    expect(text).toContain("4 arrivals");
    expect(text).toContain("4 departures");
    expect(text).toContain("in house");
  });

  it("scopes today's numbers through the property relation, not a bare count", async () => {
    db.responses["booking.count"] = 1;
    await ground("owner-bookings-checkin", owner);
    for (const call of db.calls) {
      expect(JSON.stringify(call.args.where)).toContain('"property":{"ownerId":7}');
    }
  });
});

describe("failure handling", () => {
  it("returns null instead of throwing when a lookup fails", async () => {
    db.responses["booking.findMany"] = () => {
      throw new Error("database is down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The visitor must still get their static answer.
    expect(await ground("booking-status", customer)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("registry wiring", () => {
  it("knows which intents it can personalise", () => {
    expect(hasGrounder("booking-status")).toBe(true);
    expect(hasGrounder("owner-payouts")).toBe(true);
    expect(hasGrounder("payment-methods")).toBe(false);
    expect(hasGrounder(null)).toBe(false);
  });
});
