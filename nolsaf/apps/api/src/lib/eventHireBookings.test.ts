import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  gate: {
    failure: null as string | null
  },
  revenue: vi.fn(async () => ({
    status: "created"
  }))
}));
vi.mock("./salesAgency.js", () => ({
  agencyGateFailure: (g: any) => g.failure,
  loadAgencyGateInput: async () => h.gate
}));
vi.mock("./revenueLedger.js", () => ({
  recognizeRevenue: h.revenue
}));
import { actOnEventBooking, bookingFor, damageValue, eligibleEventTransfer, eventBookingView, frozenEventMoney, markEventTransferPaid, openDamageClaim, prepareEventCheckout, prepareEventSettlement, recordEventDecline, respondToDamage, runEventBookingLifecycle, settleEventCollection, tokenHash } from "./eventHireBookings.js";
import { createEventBlock } from "./eventHireRequests.js";
import { eventMoney } from "./eventHire.js";
const now = new Date("2026-11-27T10:00:00Z"),
  ref = `ebk_${"a".repeat(32)}`,
  requestRef = `er_${"r".repeat(32)}`;
const terms = {
  spaceType: "HALL",
  eventTypes: ["MEETING"],
  halfDayPrice: 100000,
  fullDayPrice: 200000,
  depositMode: "PERCENT",
  depositPercent: 25,
  cleaningFee: 10000
};
const fingerprint = "a".repeat(64);
const requestRow = () => ({
  id: 7,
  reference: requestRef,
  propertyId: 3,
  clientUserId: 10,
  salesPartnerId: 30,
  assisted: true,
  status: "READY_TO_PAY",
  version: 1,
  startsAt: new Date(now.getTime() + 48 * 3600000),
  endsAt: new Date(now.getTime() + 52 * 3600000),
  expiresAt: new Date(now.getTime() + 3600000),
  holdExpiresAt: new Date(now.getTime() + 3600000),
  package: "HALF_DAY",
  termsSnapshot: terms,
  termsFingerprint: fingerprint,
  quote: {
    ...eventMoney(100000),
    deposit: 25000,
    cleaningFee: 10000,
    total: 141000
  },
  ownerConfirmedAt: now,
  confirmedOwnerId: 20,
  confirmationVia: "APP",
  partnerApprovedAt: now,
  property: {
    id: 3,
    ownerId: 20,
    title: "Hotel hall",
    status: "APPROVED",
    rentalMode: "NIGHTLY",
    eventHire: {
      status: "APPROVED",
      termsFingerprint: fingerprint,
      approvedFingerprint: fingerprint
    }
  }
});
const booking = (changes: any = {}) => ({
  id: 1,
  reference: ref,
  requestId: 7,
  ownerId: 20,
  status: "PAYMENT_PENDING",
  version: 1,
  total: 141000,
  ownerDue: 100000,
  deposit: 25000,
  fee: 16000,
  cleaningFee: 10000,
  currency: "TZS",
  paymentRef: `EHV-${"a".repeat(32)}`,
  callbackTokenHash: tokenHash("x".repeat(43)),
  checkoutStatus: "PROCESSING",
  checkoutExpiresAt: new Date(now.getTime() + 20 * 60000),
  paidAt: null,
  providerTransactionId: null,
  claimDeadline: new Date(now.getTime() + 100 * 3600000),
  depositStatus: "UNPAID",
  payoutStatus: "UNPAID",
  claims: [],
  transfers: [],
  evidence: [],
  ...changes
});
function database(initial: any = booking()) {
  const state: any = {
    request: requestRow(),
    book: initial,
    events: [],
    entries: [],
    notifications: [],
    payments: [],
    transfers: [],
    claims: [],
    evidence: [],
    busy: false,
    blocked: false,
    failAudit: false,
    phoneVerified: true
  };
  if (initial) {
    state.transfers = initial.transfers || [];
    state.claims = initial.claims || [];
    state.evidence = initial.evidence || [];
  }
  const hydrate = () => state.book ? {
    ...state.book,
    request: state.request,
    transfers: state.transfers,
    claims: state.claims,
    evidence: state.evidence
  } : null;
  const apply = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? (row[k] || 0) + (v as any).increment : v;
    return row;
  };
  const db: any = {
    state,
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => strings.join("").includes("SELECT kind,status") ? state.transfers.map((t: any) => ({
      kind: t.kind,
      status: t.status
    })) : []),
    user: {
      findUnique: vi.fn(async () => ({
        phoneVerifiedAt: state.phoneVerified ? now : null
      })),
      findMany: vi.fn(async () => [{
        id: 40
      }])
    },
    property: {
      findFirst: vi.fn(async ({
        where
      }: any) => where.ownerId === 20 ? state.request.property : null),
      findUnique: vi.fn(async () => state.request.property)
    },
    eventHireRequest: {
      findFirst: vi.fn(async ({
        where
      }: any) => where.reference === requestRef && where.clientUserId === 10 ? state.request : null),
      findUnique: vi.fn(async () => state.request),
      update: vi.fn(async ({
        data
      }: any) => apply(state.request, data))
    },
    eventHireBlock: {
      findFirst: vi.fn(async () => state.blocked ? {
        id: 50
      } : null),
      create: vi.fn(async () => ({
        id: 51
      }))
    },
    eventHireBooking: {
      findUnique: vi.fn(async () => hydrate()),
      findFirst: vi.fn(async ({
        where
      }: any) => {
        if (where.reference) {
          if (where.reference !== state.book?.reference) return null;
          if (where.ownerId && where.ownerId !== state.book?.ownerId) return null;
          if (where.request?.clientUserId && where.request.clientUserId !== state.request.clientUserId) return null;
          if (where.request?.salesPartnerId && where.request.salesPartnerId !== state.request.salesPartnerId) return null;
          return hydrate();
        }
        return state.busy ? {
          id: 90
        } : null;
      }),
      create: vi.fn(async ({
        data
      }: any) => {
        state.book = {
          id: 1,
          version: 1,
          claims: [],
          transfers: [],
          evidence: [],
          ...data
        };
        return hydrate();
      }),
      update: vi.fn(async ({
        data
      }: any) => {
        apply(state.book, data);
        return hydrate();
      }),
      findMany: vi.fn(async () => state.book ? [{
        id: 1,
        request: {
          propertyId: 3
        }
      }] : [])
    },
    paymentEvent: {
      findUnique: vi.fn(async ({
        where
      }: any) => state.payments.find((p: any) => p.eventId === where.eventId) || null),
      create: vi.fn(async ({
        data
      }: any) => {
        if (state.payments.some((p: any) => p.eventId === data.eventId)) throw Object.assign(new Error("duplicate"), {
          code: "P2002"
        });
        state.payments.push(data);
        return data;
      }),
      aggregate: vi.fn(async () => ({
        _sum: {
          amount: state.payments.reduce((sum: number, p: any) => sum + p.amount, 0)
        }
      }))
    },
    eventHireRequestEvent: {
      create: vi.fn(async ({
        data
      }: any) => {
        if (state.failAudit) throw new Error("AUDIT_UNAVAILABLE");
        state.events.push(data);
        return data;
      })
    },
    notification: {
      create: vi.fn(async ({
        data
      }: any) => {
        state.notifications.push(data);
        return data;
      })
    },
    eventHireLedgerEntry: {
      create: vi.fn(async ({
        data
      }: any) => {
        if (state.entries.some((e: any) => e.key === data.key)) throw new Error("DUPLICATE_JOURNAL");
        state.entries.push(data);
        return data;
      })
    },
    eventHireTransfer: {
      upsert: vi.fn(async ({
        where,
        create
      }: any) => {
        const t = state.transfers.find((t: any) => t.bookingId === where.bookingId_kind.bookingId && t.kind === where.bookingId_kind.kind);
        if (t) return t;
        const row = {
          id: state.transfers.length + 1,
          status: "REVIEW",
          ...create
        };
        state.transfers.push(row);
        return row;
      }),
      create: vi.fn(async ({
        data
      }: any) => {
        const row = {
          id: state.transfers.length + 1,
          status: "REVIEW",
          ...data
        };
        state.transfers.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({
        where
      }: any) => {
        const t = state.transfers.find((t: any) => t.id === where.id);
        return t ? {
          ...t,
          booking: hydrate()
        } : null;
      }),
      update: vi.fn(async ({
        where,
        data
      }: any) => apply(state.transfers.find((t: any) => t.id === where.id), data)),
      updateMany: vi.fn(async ({
        where,
        data
      }: any) => {
        const t = state.transfers.find((t: any) => t.id === where.id && t.status === where.status && t.amount === where.amount);
        if (!t) return {
          count: 0
        };
        apply(t, data);
        return {
          count: 1
        };
      })
    },
    eventHireClaim: {
      create: vi.fn(async ({
        data
      }: any) => {
        const row = {
          id: 1,
          version: 1,
          status: "AWAITING_CLIENT",
          ...data
        };
        state.claims.push(row);
        return row;
      }),
      update: vi.fn(async ({
        where,
        data
      }: any) => apply(state.claims.find((c: any) => c.id === where.id), data))
    }
  };
  db.$transaction = vi.fn(async (fn: any) => {
    const snapshot = structuredClone(state);
    try {
      return await fn(db);
    } catch (e) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, snapshot);
      throw e;
    }
  });
  return db;
}
const client = {
    kind: "CLIENT" as const,
    userId: 10
  },
  owner = {
    kind: "OWNER" as const,
    userId: 20
  },
  admin = {
    kind: "ADMIN" as const,
    userId: 40
  };
function ended(db: any) {
  db.state.request.startsAt = new Date(now.getTime() - 6 * 3600000);
  db.state.request.endsAt = new Date(now.getTime() - 2 * 3600000);
  db.state.book.claimDeadline = new Date(now.getTime() + 46 * 3600000);
}
function funded(db: any) {
  db.state.book.paidAt = new Date(now.getTime() - 86400000);
  db.state.book.providerTransactionId = "12345";
  db.state.book.status = "CONFIRMED";
  db.state.book.depositStatus = "HELD";
  db.state.book.payoutStatus = "HELD";
  db.state.payments.push({
    eventId: "12345",
    provider: "CORALCOMMERCE",
    amount: 141000,
    currency: "TZS",
    status: "SUCCESS",
    payload: {
      eventBookingRef: ref
    }
  });
}
beforeEach(() => {
  process.env.EVENT_HIRE_REQUESTS_ENABLED = "true";
  process.env.EVENT_HIRE_PAYMENTS_ENABLED = "true";
  h.gate.failure = null;
  h.revenue.mockClear();
});
describe("frozen quotes and gated checkout", () => {
  it("uses the request's frozen fee split and keeps deposit outside earnings", () => expect(frozenEventMoney(requestRow())).toEqual({
    total: 141000,
    ownerDue: 100000,
    deposit: 25000,
    fee: 16000,
    cleaningFee: 10000
  }));
  it("cannot reprice an accepted quote or alter its arithmetic", () => {
    for (const change of [{
      total: 1
    }, {
      ownerPrice: 1
    }, {
      ownerReceives: 1
    }, {
      clientFee: 1
    }, {
      nolsafFee: 1
    }]) {
      const r = requestRow();
      Object.assign(r.quote, change);
      expect(() => frozenEventMoney(r)).toThrow();
    }
  });
  it("binds the payment before any provider call, with an expiring slot and opaque capability", async () => {
    const db = database(null);
    const result = await prepareEventCheckout(db, client, requestRef, now);
    expect(result.token).toHaveLength(43);
    expect(db.state.book).toMatchObject({
      status: "PAYMENT_PENDING",
      ownerId: 20,
      total: 141000
    });
    expect(db.state.book.callbackTokenHash).toBe(tokenHash(result.token));
    expect(db.state.request.status).toBe("PAYMENT_PENDING");
    expect(db.$queryRaw).toHaveBeenCalled();
  });
  it("is closed unless both rollout switches are enabled", async () => {
    delete process.env.EVENT_HIRE_PAYMENTS_ENABLED;
    await expect(prepareEventCheckout(database(null), client, requestRef, now)).rejects.toMatchObject({
      code: "PAYMENTS_DISABLED"
    });
  });
  it.each(["WAITING_OWNER", "OWNER_CONFIRMED", "EXPIRED"])("cannot charge a request in %s", async status => {
    const db = database(null);
    db.state.request.status = status;
    await expect(prepareEventCheckout(db, client, requestRef, now)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });
    expect(db.eventHireBooking.create).not.toHaveBeenCalled();
  });
  it("does not trust a partner's unacknowledged phone call", async () => {
    const db = database(null);
    db.state.request.confirmationVia = "PARTNER_CALL";
    await expect(prepareEventCheckout(db, client, requestRef, now)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED"
    });
  });
  it("rechecks assigned partner capability at checkout", async () => {
    const db = database(null);
    h.gate.failure = "SUSPENDED";
    await expect(prepareEventCheckout(db, client, requestRef, now)).rejects.toMatchObject({
      code: "PARTNER_REQUIRED"
    });
  });
  it("allows a confirmed direct request without a partner", async () => {
    const db = database(null);
    db.state.request.assisted = false;
    db.state.request.salesPartnerId = null;
    db.state.request.partnerApprovedAt = null;
    expect((await prepareEventCheckout(db, client, requestRef, now)).booking.total).toBe(141000);
  });
  it.each(["owner", "parent", "venue", "terms", "phone", "block", "conflict", "deadline"])("fails closed after %s changes", async condition => {
    const db = database(null);
    if (condition === "owner") db.state.request.property.ownerId = 99;
    if (condition === "parent") db.state.request.property.status = "SUSPENDED";
    if (condition === "venue") db.state.request.property.eventHire.status = "PAUSED";
    if (condition === "terms") db.state.request.property.eventHire.termsFingerprint = "b".repeat(64);
    if (condition === "phone") db.state.phoneVerified = false;
    if (condition === "block") db.state.blocked = true;
    if (condition === "conflict") db.state.busy = true;
    if (condition === "deadline") db.state.request.holdExpiresAt = new Date(now.getTime() + 60000);
    await expect(prepareEventCheckout(db, client, requestRef, now)).rejects.toBeInstanceOf(Error);
    expect(db.state.book).toBeNull();
  });
  it("does not let another client start checkout", async () => {
    const db = database(null);
    await expect(prepareEventCheckout(db, {
      kind: "CLIENT",
      userId: 999
    }, requestRef, now)).rejects.toMatchObject({
      status: 404
    });
  });
  it("reuses a pending checkout and never opens an ambiguous second attempt", async () => {
    const db = database(booking({
      checkoutUrl: "https://pay.example/checkout"
    }));
    expect((await prepareEventCheckout(db, client, requestRef, now)).checkoutUrl).toBe("https://pay.example/checkout");
    db.state.book.checkoutStatus = "STATUS_UNKNOWN";
    await expect(prepareEventCheckout(db, client, requestRef, now)).rejects.toMatchObject({
      code: "PAYMENT_PENDING"
    });
  });
});
describe("verified collections and availability", () => {
  const payment = {
    paymentRef: `EHV-${"a".repeat(32)}`,
    transactionId: "12345",
    amount: 141000,
    currency: "TZS"
  };
  it("confirms once, records separate deposit liability, and releases the temporary hold", async () => {
    const db = database();
    const b = await settleEventCollection(db, payment, now);
    expect(b.status).toBe("CONFIRMED");
    expect(db.state.request.status).toBe("BOOKED");
    expect(db.state.entries.map((e: any) => [e.kind, e.amount])).toEqual([["COLLECTION", 141000], ["DEPOSIT_HELD", 25000]]);
    await settleEventCollection(db, payment, now);
    expect(db.state.payments).toHaveLength(1);
    expect(db.state.entries).toHaveLength(2);
  });
  it.each([{
    amount: 1
  }, {
    currency: "USD"
  }, {
    transactionId: "<script>"
  }])("refuses mismatched verified-provider details %#", async change => {
    const db = database();
    await expect(settleEventCollection(db, {
      ...payment,
      ...change
    }, now)).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH"
    });
    expect(db.state.payments).toHaveLength(0);
  });
  it.each(["expired", "suspended", "reassigned", "conflict"])("late or invalid %s collections become a full refund review, not a reservation", async cause => {
    const db = database();
    if (cause === "expired") db.state.book.checkoutExpiresAt = now;
    if (cause === "suspended") db.state.request.property.status = "SUSPENDED";
    if (cause === "reassigned") db.state.request.property.ownerId = 99;
    if (cause === "conflict") db.state.busy = true;
    const b = await settleEventCollection(db, payment, now);
    expect(b.status).toBe("PAYMENT_REVIEW");
    expect(db.state.transfers).toMatchObject([{
      kind: "CANCELLATION_REFUND",
      amount: 141000,
      payeeUserId: 10,
      status: "REVIEW"
    }]);
  });
  it("records additional collections independently and schedules their full refund without rebooking", async () => {
    const db = database();
    await settleEventCollection(db, payment, now);
    await settleEventCollection(db, {
      ...payment,
      transactionId: "23456"
    }, now);
    await settleEventCollection(db, {
      ...payment,
      transactionId: "23456"
    }, now);
    expect(db.state.book.status).toBe("CONFIRMED");
    expect(db.state.transfers).toHaveLength(1);
    expect(db.state.transfers[0]).toMatchObject({
      amount: 141000,
      payeeUserId: 10,
      collectionReference: "23456"
    });
    expect(db.state.payments).toHaveLength(2);
  });
  it("refuses a provider transaction already allocated to another product", async () => {
    const db = database();
    db.state.payments.push({
      eventId: "12345",
      provider: "CORALCOMMERCE",
      amount: 141000,
      payload: {
        invoiceId: 99
      }
    });
    await expect(settleEventCollection(db, payment, now)).rejects.toMatchObject({
      code: "PROVIDER_REPLAY"
    });
    expect(db.state.book.paidAt).toBeNull();
  });
  it("rolls back money, booking and notifications together when audit persistence fails", async () => {
    const db = database();
    db.state.failAudit = true;
    await expect(settleEventCollection(db, payment, now)).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(db.state.book.status).toBe("PAYMENT_PENDING");
    expect(db.state.payments).toHaveLength(0);
    expect(db.state.entries).toHaveLength(0);
    expect(db.state.notifications).toHaveLength(0);
  });
  it("external blocks cannot overwrite a paid booking", async () => {
    const db = database();
    db.state.busy = true;
    await expect(createEventBlock(db, owner, 3, {
      startsAt: db.state.request.startsAt.toISOString(),
      endsAt: db.state.request.endsAt.toISOString(),
      reason: "EXTERNAL_BOOKING"
    }, now)).rejects.toMatchObject({
      code: "UNAVAILABLE"
    });
  });
  it("a final decline releases the slot and a later success is reviewed for refund", async () => {
    const db = database();
    await recordEventDecline(db, 1, now);
    expect(db.state.request.status).toBe("EXPIRED");
    expect(db.state.book.checkoutStatus).toBe("FAILED");
    await settleEventCollection(db, payment, now);
    expect(db.state.book.status).toBe("PAYMENT_REVIEW");
  });
});
describe("private damage cases and independent decisions", () => {
  const evidence = [{
    reference: `eev_${"b".repeat(32)}`,
    kind: "BEFORE"
  }, {
    reference: `eev_${"c".repeat(32)}`,
    kind: "AFTER"
  }];
  const claimBody = {
    version: 1,
    description: "The hired chairs were broken after the event and require repair.",
    items: [{
      description: "Damaged dining chair",
      cost: 30000,
      depreciationPercent: 20
    }],
    evidence
  };
  function claimDb() {
    const db = database();
    funded(db);
    ended(db);
    db.state.evidence = evidence.map(e => ({
      ...e,
      uploadedById: 20
    }));
    return db;
  }
  it("caps documented depreciated loss at the deposit", () => {
    expect(damageValue([{
      cost: 30000,
      depreciationPercent: 20
    }], 25000)).toBe(24000);
    expect(damageValue([{
      cost: 50000,
      depreciationPercent: 0
    }], 25000)).toBe(25000);
  });
  it("opens a claim with the client's response window and freezes settlement without awarding money", async () => {
    const db = claimDb();
    const c = await openDamageClaim(db, owner, ref, claimBody, now);
    expect(c.requestedAmount).toBe(24000);
    expect(c.responseDueAt.getTime() - now.getTime()).toBe(48 * 3600000);
    expect(db.state.book.depositStatus).toBe("DISPUTED");
    expect(db.state.transfers).toHaveLength(0);
  });
  it.each(["foreign", "wrong-kind", "duplicate", "missing-baseline"])("rejects %s evidence", async reason => {
    const db = claimDb();
    const input = structuredClone(claimBody);
    if (reason === "foreign") db.state.evidence[0].uploadedById = 999;
    if (reason === "wrong-kind") input.evidence[0].kind = "AFTER";
    if (reason === "duplicate") input.evidence[1] = input.evidence[0];
    if (reason === "missing-baseline") {
      input.evidence[0].kind = "OTHER";
      db.state.evidence[0].kind = "OTHER";
    }
    await expect(openDamageClaim(db, owner, ref, input, now)).rejects.toMatchObject({
      status: 400
    });
  });
  it("cannot claim before the event ends or after the claim deadline", async () => {
    const db = claimDb();
    db.state.request.endsAt = new Date(now.getTime() + 1);
    await expect(openDamageClaim(db, owner, ref, claimBody, now)).rejects.toMatchObject({
      code: "CLAIM_CLOSED"
    });
    db.state.request.endsAt = new Date(now.getTime() - 1);
    db.state.book.claimDeadline = now;
    await expect(openDamageClaim(db, owner, ref, claimBody, now)).rejects.toMatchObject({
      code: "CLAIM_CLOSED"
    });
  });
  it("a client can respond and the owner cannot impersonate that response", async () => {
    const db = claimDb();
    await openDamageClaim(db, owner, ref, claimBody, now);
    await respondToDamage(db, client, ref, {
      version: 1,
      response: "I dispute this. These chairs were already damaged.",
      evidence: []
    }, now);
    expect(db.state.claims[0].status).toBe("REVIEW");
    expect(db.state.claims[0].clientResponse).toContain("dispute");
    await expect(respondToDamage(db, owner, ref, {
      version: 2,
      response: "Fake client response",
      evidence: []
    }, now)).rejects.toThrow();
  });
  it("does not let an admin decide while an unanswered client response window is open", async () => {
    const db = claimDb();
    await openDamageClaim(db, owner, ref, claimBody, now);
    await expect(actOnEventBooking(db, admin, ref, {
      version: 2,
      action: "RESOLVE_CLAIM",
      claimVersion: 1,
      award: 24000,
      note: "Reviewed all supporting evidence.",
      attested: true
    }, now)).rejects.toMatchObject({
      code: "RESPONSE_WINDOW"
    });
  });
  it("requires verified notice before deciding an unanswered claim after its response window", async () => {
    const db = claimDb();
    await openDamageClaim(db, owner, ref, claimBody, now);
    const afterResponseWindow = new Date(now.getTime() + 49 * 60 * 60 * 1000);
    const decision = {
      version: 2,
      action: "RESOLVE_CLAIM",
      claimVersion: 1,
      award: 12000,
      note: "Reviewed supporting evidence and documented delivery of notice.",
      attested: true
    };
    await expect(actOnEventBooking(db, admin, ref, decision, afterResponseWindow)).rejects.toMatchObject({
      code: "NOTICE_REVIEW_REQUIRED"
    });
    expect(db.state.claims[0].status).not.toBe("RESOLVED");
    await actOnEventBooking(db, admin, ref, { ...decision, clientNotified: true }, afterResponseWindow);
    expect(db.state.claims[0]).toMatchObject({ status: "RESOLVED", award: 12000 });
  });
  it("does not let the owner, client, or an interested admin award damages", async () => {
    for (const actor of [owner, client, {
      kind: "ADMIN" as const,
      userId: 20
    }, {
      kind: "ADMIN" as const,
      userId: 10
    }]) {
      const db = claimDb();
      await openDamageClaim(db, owner, ref, claimBody, now);
      db.state.claims[0].respondedAt = now;
      await expect(actOnEventBooking(db, actor, ref, {
        version: 2,
        action: "RESOLVE_CLAIM",
        claimVersion: 1,
        award: 24000,
        note: "Reviewed all supporting evidence.",
        attested: true
      }, now)).rejects.toThrow();
    }
  });
  it("requires a reason, version, attestation and a capped award", async () => {
    const db = claimDb();
    await openDamageClaim(db, owner, ref, claimBody, now);
    db.state.claims[0].respondedAt = now;
    await expect(actOnEventBooking(db, admin, ref, {
      version: 2,
      action: "RESOLVE_CLAIM",
      claimVersion: 1,
      award: 25000,
      note: "Reviewed all supporting evidence.",
      attested: true
    }, now)).rejects.toMatchObject({
      code: "AWARD_TOO_HIGH"
    });
    expect(db.state.claims[0].status).not.toBe("RESOLVED");
  });
  it("records a reasoned partial award while leaving all funds held until the claim window closes", async () => {
    const db = claimDb();
    await openDamageClaim(db, owner, ref, claimBody, now);
    db.state.claims[0].respondedAt = now;
    await actOnEventBooking(db, admin, ref, {
      version: 2,
      action: "RESOLVE_CLAIM",
      claimVersion: 1,
      award: 12000,
      note: "Repair is sufficient; replacement cost is unsupported.",
      attested: true
    }, now);
    expect(db.state.claims[0]).toMatchObject({
      status: "RESOLVED",
      award: 12000,
      decidedById: 40
    });
    expect(db.state.transfers).toHaveLength(0);
  });
});
describe("completion, refunds and the shared payout boundary", () => {
  function ready() {
    const db = database();
    funded(db);
    ended(db);
    db.state.book.status = "COMPLETED";
    db.state.book.claimDeadline = new Date(now.getTime() - 1);
    return db;
  }
  it("does not settle after only the owner's completion confirmation", async () => {
    const db = database();
    funded(db);
    ended(db);
    await actOnEventBooking(db, owner, ref, {
      version: 1,
      action: "COMPLETE"
    }, now);
    expect(db.state.book.ownerCompletedAt).toEqual(now);
    expect(db.state.book.status).toBe("CONFIRMED");
    expect(db.state.transfers).toHaveLength(0);
  });
  it("prepares separate owner and client entitlements only after the window and resolved claims", async () => {
    const db = ready();
    db.state.claims.push({
      status: "RESOLVED",
      award: 10000
    });
    await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: db.state.claims
    }, now);
    expect(db.state.transfers.map((t: any) => [t.kind, t.payeeUserId, t.amount, t.status])).toEqual([["OWNER_PAYOUT", 20, 100000, "REVIEW"], ["DAMAGE_AWARD", 20, 10000, "REVIEW"], ["DEPOSIT_REFUND", 10, 15000, "REVIEW"]]);
    expect(h.revenue).toHaveBeenCalledWith(db, expect.objectContaining({
      gross: 116000,
      commission: 16000,
      partnerNet: 100000
    }));
  });
  it.each(["not-completed", "in-window", "unresolved", "cancellation"])("holds funds for %s", async reason => {
    const db = ready();
    if (reason === "not-completed") db.state.book.status = "CONFIRMED";
    if (reason === "in-window") db.state.book.claimDeadline = new Date(now.getTime() + 1);
    if (reason === "unresolved") db.state.claims.push({
      status: "REVIEW",
      award: null
    });
    if (reason === "cancellation") db.state.book.cancellationRequestedAt = now;
    expect(await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: db.state.claims
    }, now)).toBe(false);
    expect(db.state.transfers).toHaveLength(0);
  });
  it("a documented cancellation refunds the total to the client without releasing venue earnings", async () => {
    const db = database();
    funded(db);
    await actOnEventBooking(db, admin, ref, {
      version: 1,
      action: "CANCEL_AND_REFUND",
      note: "The owner cannot provide the venue for this event.",
      attested: true
    }, now);
    expect(db.state.book.status).toBe("CANCELLED");
    expect(db.state.transfers).toMatchObject([{
      kind: "CANCELLATION_REFUND",
      amount: 141000,
      payeeUserId: 10,
      status: "REVIEW"
    }]);
    expect(h.revenue).not.toHaveBeenCalled();
  });
  it("neither a payout request nor owner action marks money paid", async () => {
    const db = ready();
    await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: []
    }, now);
    const t = db.state.transfers[0];
    await expect(actOnEventBooking(db, owner, ref, {
      version: 1,
      action: "APPROVE_TRANSFER",
      transferRef: t.reference,
      note: "I approve my own money now.",
      attested: true
    }, now)).rejects.toMatchObject({
      status: 403
    });
    expect(t.status).toBe("REVIEW");
  });
  it("requires approved entitlement and the original verified collection for payout eligibility", async () => {
    const db = ready();
    await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: []
    }, now);
    expect((await eligibleEventTransfer(db, 1, now)).ok).toBe(false);
    db.state.transfers[0].status = "APPROVED";
    expect(await eligibleEventTransfer(db, 1, now)).toMatchObject({
      ok: true,
      payeeUserId: 20,
      amount: 100000
    });
    db.state.payments[0].amount = 1;
    expect((await eligibleEventTransfer(db, 1, now)).ok).toBe(false);
  });
  it("refuses destination or amount tampering before disbursement", async () => {
    const db = ready();
    await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: []
    }, now);
    db.state.transfers[0].status = "APPROVED";
    db.state.transfers[0].payeeUserId = 99;
    expect((await eligibleEventTransfer(db, 1, now)).ok).toBe(false);
    db.state.transfers[0].payeeUserId = 20;
    db.state.transfers[0].amount = 100001;
    expect((await eligibleEventTransfer(db, 1, now)).ok).toBe(false);
  });
  it("only provider-confirmed money-out records a paid transfer, idempotently", async () => {
    const db = ready();
    await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: []
    }, now);
    db.state.transfers[0].status = "APPROVED";
    await markEventTransferPaid(db, 1, 100000, "BANK-PROVIDER-REF", now);
    await markEventTransferPaid(db, 1, 100000, "BANK-PROVIDER-REF", now);
    expect(db.state.transfers[0].status).toBe("PAID");
    expect(db.state.book.payoutStatus).toBe("SETTLED");
    expect(db.state.entries.filter((e: any) => e.kind === "OWNER_PAYOUT")).toHaveLength(1);
  });
  it("releasing a refund does not mark unpaid owner earnings settled", async () => {
    const db = ready();
    await prepareEventSettlement(db, {
      ...db.state.book,
      request: db.state.request,
      claims: []
    }, now);
    db.state.transfers[1].status = "APPROVED";
    await markEventTransferPaid(db, 2, 25000, "REFUND-PROVIDER-REF", now);
    expect(db.state.book.depositStatus).toBe("SETTLED");
    expect(db.state.book.payoutStatus).toBe("REVIEW");
    expect(db.state.entries).toContainEqual(expect.objectContaining({
      kind: "DEPOSIT_RELEASED",
      amount: -25000
    }));
  });
  it("retains privacy in client financial projections", () => {
    const db = ready();
    const view = eventBookingView({
      ...db.state.book,
      request: db.state.request,
      evidence: [],
      claims: [],
      transfers: [{
        payeeUserId: 20,
        kind: "OWNER_PAYOUT"
      }, {
        payeeUserId: 10,
        kind: "DEPOSIT_REFUND"
      }]
    }, client);
    expect(view.ownerDue).toBeUndefined();
    expect(view.fee).toBeUndefined();
    expect(view.transfers).toHaveLength(1);
    expect(view).not.toHaveProperty("callbackTokenHash");
    expect(view).not.toHaveProperty("providerTransactionId");
  });
  it("worker expiry never confirms an unpaid booking", async () => {
    const db = database();
    db.state.book.checkoutExpiresAt = now;
    await runEventBookingLifecycle(db, now);
    expect(db.state.book.status).toBe("EXPIRED");
    expect(db.state.request.status).toBe("EXPIRED");
    expect(db.state.transfers).toHaveLength(0);
  });
  it("rejects stale decisions and foreign booking references", async () => {
    const db = ready();
    await expect(bookingFor(db, ref, {
      kind: "OWNER",
      userId: 999
    })).rejects.toMatchObject({
      status: 404
    });
    await expect(actOnEventBooking(db, owner, ref, {
      version: 99,
      action: "COMPLETE"
    }, now)).rejects.toMatchObject({
      code: "CHANGED"
    });
  });
});
