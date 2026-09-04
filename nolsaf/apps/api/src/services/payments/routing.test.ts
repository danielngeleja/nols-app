import { describe, expect, it } from "vitest";

import { offerableChannels, resolveRoute, type RoutingCandidate, type RoutingContext } from "./routing.js";

const CAPABLE = {
  channels: ["MNO", "CARD"],
  currencies: ["TZS"],
};

function candidate(overrides: Partial<RoutingCandidate> = {}): RoutingCandidate {
  return {
    ruleId: 1,
    scopeType: "GLOBAL",
    scopeId: null,
    purpose: null,
    currency: null,
    channel: null,
    priority: 100,
    isActive: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    connection: {
      id: 10,
      provider: "FAKE",
      environment: "SANDBOX",
      isEnabled: true,
      capabilities: CAPABLE,
    },
    ...overrides,
  };
}

const context: RoutingContext = {
  merchantId: 7,
  propertyId: 55,
  outletId: 91,
  purpose: "ACCOMMODATION",
  currency: "TZS",
  channel: "MNO",
  at: new Date("2026-09-04T10:00:00Z"),
};

describe("routing fails closed", () => {
  it("refuses when no rule exists at all", () => {
    expect(resolveRoute([], context)).toMatchObject({ ok: false, code: "no_matching_rule" });
  });

  it("refuses rather than falling back when the only connection is disabled", () => {
    // The one outcome this design exists to prevent is owner money reaching a
    // NoLSAF-owned merchant account, so there is no fallback by construction.
    const rules = [
      candidate({ connection: { ...candidate().connection, isEnabled: false } }),
    ];
    expect(resolveRoute(rules, context)).toMatchObject({ ok: false, code: "provider_disabled" });
  });

  it("refuses when the matched connection cannot do the channel", () => {
    const rules = [
      candidate({
        connection: {
          ...candidate().connection,
          capabilities: { channels: ["CARD"], currencies: ["TZS"] },
        },
      }),
    ];
    expect(resolveRoute(rules, context)).toMatchObject({
      ok: false,
      code: "channel_not_supported",
    });
  });

  it("refuses a rule whose scope does not match the context", () => {
    const rules = [candidate({ scopeType: "PROPERTY", scopeId: 999 })];
    expect(resolveRoute(rules, context)).toMatchObject({ ok: false, code: "no_matching_rule" });
  });
});

describe("rule ranking", () => {
  it("prefers the narrower scope even when the broader rule has a lower priority number", () => {
    const rules = [
      candidate({ ruleId: 1, scopeType: "GLOBAL", priority: 1, connection: { ...candidate().connection, id: 10 } }),
      candidate({
        ruleId: 2,
        scopeType: "OUTLET",
        scopeId: 91,
        priority: 500,
        connection: { ...candidate().connection, id: 20 },
      }),
    ];
    const decision = resolveRoute(rules, context);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.connectionId).toBe(20);
  });

  it("orders OUTLET over PROPERTY over MERCHANT over GLOBAL", () => {
    const rules = [
      candidate({ ruleId: 1, scopeType: "GLOBAL", connection: { ...candidate().connection, id: 10 } }),
      candidate({ ruleId: 2, scopeType: "MERCHANT", scopeId: 7, connection: { ...candidate().connection, id: 20 } }),
      candidate({ ruleId: 3, scopeType: "PROPERTY", scopeId: 55, connection: { ...candidate().connection, id: 30 } }),
      candidate({ ruleId: 4, scopeType: "OUTLET", scopeId: 91, connection: { ...candidate().connection, id: 40 } }),
    ];
    const decision = resolveRoute(rules, context);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.connectionId).toBe(40);
  });

  it("breaks an exact tie by rule id so routing is never non-deterministic", () => {
    const rules = [
      candidate({ ruleId: 9, connection: { ...candidate().connection, id: 90 } }),
      candidate({ ruleId: 4, connection: { ...candidate().connection, id: 40 } }),
    ];
    const first = resolveRoute(rules, context);
    const second = resolveRoute([...rules].reverse(), context);
    expect(first).toEqual(second);
    if (first.ok) expect(first.connectionId).toBe(40);
  });

  it("skips a disabled higher-ranked rule and uses the next capable one", () => {
    const rules = [
      candidate({
        ruleId: 1,
        scopeType: "OUTLET",
        scopeId: 91,
        connection: { ...candidate().connection, id: 20, isEnabled: false },
      }),
      candidate({ ruleId: 2, scopeType: "GLOBAL", connection: { ...candidate().connection, id: 10 } }),
    ];
    const decision = resolveRoute(rules, context);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.connectionId).toBe(10);
  });
});

describe("effective dating", () => {
  it("ignores a rule that has not started", () => {
    const rules = [candidate({ effectiveFrom: new Date("2027-01-01T00:00:00Z") })];
    expect(resolveRoute(rules, context)).toMatchObject({ ok: false, code: "no_matching_rule" });
  });

  it("ignores a rule that has ended", () => {
    const rules = [candidate({ effectiveTo: new Date("2026-02-01T00:00:00Z") })];
    expect(resolveRoute(rules, context)).toMatchObject({ ok: false, code: "no_matching_rule" });
  });

  it("ignores an inactive rule", () => {
    expect(resolveRoute([candidate({ isActive: false })], context)).toMatchObject({
      ok: false,
      code: "no_matching_rule",
    });
  });
});

describe("attribute matching", () => {
  it("treats a null attribute as matching anything", () => {
    expect(resolveRoute([candidate({ purpose: null, channel: null })], context).ok).toBe(true);
  });

  it("respects a purpose-specific rule", () => {
    expect(resolveRoute([candidate({ purpose: "OUTLET_ORDER" })], context)).toMatchObject({
      ok: false,
      code: "no_matching_rule",
    });
    expect(resolveRoute([candidate({ purpose: "ACCOMMODATION" })], context).ok).toBe(true);
  });

  it("compares currency case-insensitively", () => {
    expect(resolveRoute([candidate({ currency: "tzs" })], context).ok).toBe(true);
  });
});

describe("routing snapshot", () => {
  it("records the decision so it can be frozen onto the intent", () => {
    const decision = resolveRoute([candidate({ ruleId: 3 })], context);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.snapshot).toMatchObject({
      ruleId: 3,
      scopeType: "GLOBAL",
      connectionId: 10,
      provider: "FAKE",
      environment: "SANDBOX",
      channel: "MNO",
      currency: "TZS",
      purpose: "ACCOMMODATION",
      decidedAt: "2026-09-04T10:00:00.000Z",
    });
  });
});

describe("offerable channels", () => {
  it("offers only the channels that would actually resolve", () => {
    const rules = [candidate()];
    const offered = offerableChannels(rules, context, ["MNO", "BANK", "CARD", "HOSTED_CHECKOUT"]);
    expect(offered).toEqual(["MNO", "CARD"]);
  });

  it("offers nothing when the property has no route", () => {
    expect(offerableChannels([], context, ["MNO", "CARD"])).toEqual([]);
  });
});
