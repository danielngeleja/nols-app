import { describe, expect, it } from "vitest";

import type { NormalizedProviderEvent } from "./adapter.js";
import { ingestProviderEvent, intentStatusForEvent } from "./inbox.js";

const OCCURRED = new Date("2026-09-04T10:00:00Z");

function event(overrides: Partial<NormalizedProviderEvent> = {}): NormalizedProviderEvent {
  return {
    provider: "FAKE",
    environment: "SANDBOX",
    providerEventId: "evt-1",
    eventType: "PAYMENT",
    providerOccurredAt: OCCURRED,
    receivedAt: OCCURRED,
    providerMerchantId: "PM-1",
    providerRef: "FAKE-abc",
    status: "SUCCEEDED",
    money: { amount: "180000.00", currency: "TZS" },
    signatureVerified: true,
    payloadDigest: "d".repeat(64),
    ...overrides,
  };
}

type DbOptions = {
  intentStatus?: string;
  intentAmount?: string;
  merchantId?: string | undefined;
  attempt?: { id: number; intentId: number } | null;
  existingInbox?: { id: number; processingState: string; matchedIntentId: number | null } | null;
};

function memoryDb(options: DbOptions = {}) {
  const inboxRows = new Map<number, any>();
  const intent = {
    id: 500,
    status: options.intentStatus ?? "PROCESSING",
    amount: options.intentAmount ?? "180000.00",
    currency: "TZS",
    routingSnapshot: { providerMerchantId: options.merchantId ?? "PM-1" },
    settledAt: null as Date | null,
  };
  const attempts = [{ id: 1, intentId: 500, providerRef: "FAKE-abc", normalizedStatus: "PROCESSING" }];
  const audits: any[] = [];
  let nextInboxId = 1;

  const db: any = {
    _inbox: inboxRows,
    _intent: () => intent,
    _attempts: attempts,
    _audits: audits,
    providerEventInbox: {
      create: async ({ data }: any) => {
        if (options.existingInbox) {
          const error: any = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const row = { id: nextInboxId++, ...data };
        inboxRows.set(row.id, row);
        return { id: row.id, processingState: row.processingState, matchedIntentId: null };
      },
      findUnique: async () => options.existingInbox ?? null,
      update: async ({ where, data }: any) => {
        const row = inboxRows.get(where.id) ?? { id: where.id };
        Object.assign(row, data);
        inboxRows.set(where.id, row);
        return row;
      },
    },
    paymentAttempt: {
      findUnique: async ({ where }: any) =>
        options.attempt === undefined
          ? attempts.find((a) => a.providerRef === where.providerRef) ?? null
          : options.attempt,
      update: async ({ where, data }: any) => {
        const row = attempts.find((a) => a.id === where.id);
        Object.assign(row!, data);
        return row;
      },
    },
    paymentIntent: {
      findUnique: async ({ where }: any) => (where.id === 500 ? intent : null),
      updateMany: async ({ where, data }: any) => {
        if (where.status && intent.status !== where.status) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      },
    },
    merchantAuditEvent: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return db;
}

describe("event meaning", () => {
  it("reads refunds and reversals from the event type, not the status", () => {
    // A provider reports a completed refund as a success; mapping that through
    // would re-settle a payment that was just returned.
    expect(
      intentStatusForEvent(event({ eventType: "REFUND_COMPLETED" }), { amount: "180000.00" })
    ).toBe("REFUNDED");
    expect(
      intentStatusForEvent(event({ eventType: "PAYMENT_REVERSAL" }), { amount: "180000.00" })
    ).toBe("REVERSED");
  });

  it("distinguishes a partial refund from a full one", () => {
    expect(
      intentStatusForEvent(
        event({ eventType: "REFUND", money: { amount: "50000.00", currency: "TZS" } }),
        { amount: "180000.00" }
      )
    ).toBe("PARTIALLY_REFUNDED");
  });

  it("maps an ordinary payment event through the attempt mapping", () => {
    expect(intentStatusForEvent(event({ status: "SUCCEEDED" }), { amount: "1" })).toBe("SUCCEEDED");
    expect(intentStatusForEvent(event({ status: "FAILED" }), { amount: "1" })).toBe("FAILED");
  });
});

describe("signature is the one hard rejection", () => {
  it("refuses an unverified event without recording it", async () => {
    const db = memoryDb();
    const result = await ingestProviderEvent(db, 10, event({ signatureVerified: false }));
    expect(result).toMatchObject({ ok: false, code: "signature_not_verified" });
    expect(db._inbox.size).toBe(0);
  });
});

describe("settlement", () => {
  it("settles the intent and stamps the provider's occurrence time", async () => {
    const db = memoryDb();
    const result = await ingestProviderEvent(db, 10, event());

    expect(result).toMatchObject({ ok: true, state: "PROCESSED", intentStatus: "SUCCEEDED", changed: true });
    expect(db._intent().status).toBe("SUCCEEDED");
    // The provider's clock, not ours: the sale happened when they say it did.
    expect(db._intent().settledAt).toEqual(OCCURRED);
  });

  it("brings the attempt into step with the event", async () => {
    const db = memoryDb();
    await ingestProviderEvent(db, 10, event());
    expect(db._attempts[0].normalizedStatus).toBe("SUCCEEDED");
  });

  it("marks the inbox row processed and linked to the intent", async () => {
    const db = memoryDb();
    const result = await ingestProviderEvent(db, 10, event());
    expect(result.ok).toBe(true);
    if (!result.ok || result.state !== "PROCESSED") return;
    expect(db._inbox.get(result.inboxId)).toMatchObject({
      processingState: "PROCESSED",
      matchedIntentId: 500,
    });
  });
});

describe("repeats are harmless", () => {
  it("recognises an already-processed event id as a duplicate", async () => {
    const db = memoryDb({
      existingInbox: { id: 77, processingState: "PROCESSED", matchedIntentId: 500 },
    });
    const result = await ingestProviderEvent(db, 10, event());
    expect(result).toMatchObject({ ok: true, state: "DUPLICATE", inboxId: 77, intentId: 500 });
  });

  it("resumes an event that was recorded but never finished processing", async () => {
    const db = memoryDb({
      existingInbox: { id: 78, processingState: "PENDING", matchedIntentId: null },
    });
    const result = await ingestProviderEvent(db, 10, event());
    expect(result).toMatchObject({ ok: true, state: "PROCESSED", intentId: 500 });
  });

  it("reports a repeat of a status the intent already holds as unchanged", async () => {
    const db = memoryDb({ intentStatus: "SUCCEEDED" });
    const result = await ingestProviderEvent(db, 10, event());
    expect(result).toMatchObject({ ok: true, state: "PROCESSED", changed: false });
  });
});

describe("events that must not be applied", () => {
  it("parks an event carrying no provider reference", async () => {
    const db = memoryDb();
    const result = await ingestProviderEvent(
      db,
      10,
      event({ providerRef: undefined, originalProviderRef: undefined })
    );
    expect(result).toMatchObject({ ok: true, state: "UNMATCHED" });
  });

  it("parks an event whose reference matches no attempt", async () => {
    const db = memoryDb({ attempt: null });
    const result = await ingestProviderEvent(db, 10, event());
    expect(result).toMatchObject({ ok: true, state: "UNMATCHED" });
    expect(db._intent().status).toBe("PROCESSING");
  });

  it("parks an event naming a different merchant than the intent", async () => {
    // Applying it would credit one property's payment to another.
    const db = memoryDb();
    const result = await ingestProviderEvent(db, 10, event({ providerMerchantId: "PM-OTHER" }));
    expect(result).toMatchObject({ ok: true, state: "WRONG_MERCHANT", intentId: 500 });
    expect(db._intent().status).toBe("PROCESSING");
  });

  it("parks a payment event whose amount disagrees with the intent", async () => {
    const db = memoryDb();
    const result = await ingestProviderEvent(
      db,
      10,
      event({ money: { amount: "5.00", currency: "TZS" } })
    );
    expect(result).toMatchObject({ ok: true, state: "REVIEW" });
    expect(db._intent().status).toBe("PROCESSING");
  });

  it("parks an event in a different currency", async () => {
    const db = memoryDb();
    const result = await ingestProviderEvent(
      db,
      10,
      event({ money: { amount: "180000.00", currency: "USD" } })
    );
    expect(result).toMatchObject({ ok: true, state: "REVIEW" });
  });

  it("allows a refund for less than the full amount", async () => {
    // A partial refund legitimately disagrees with the intent total, so the
    // amount check must not apply to it.
    const db = memoryDb({ intentStatus: "SUCCEEDED" });
    const result = await ingestProviderEvent(
      db,
      10,
      event({
        eventType: "REFUND",
        originalProviderRef: "FAKE-abc",
        money: { amount: "50000.00", currency: "TZS" },
      })
    );
    expect(result).toMatchObject({ ok: true, state: "PROCESSED", intentStatus: "PARTIALLY_REFUNDED" });
  });
});

describe("a late failure cannot unsettle a payment", () => {
  it("parks it for review instead of applying it", async () => {
    // The transition map has no SUCCEEDED to FAILED edge, so this lands in the
    // review queue rather than reversing a collected payment.
    const db = memoryDb({ intentStatus: "SUCCEEDED" });
    const result = await ingestProviderEvent(db, 10, event({ status: "FAILED", providerEventId: "evt-late" }));

    expect(result).toMatchObject({ ok: true, state: "REVIEW", intentId: 500 });
    expect(db._intent().status).toBe("SUCCEEDED");
    if (result.ok && result.state === "REVIEW") {
      expect(result.reason).toContain("illegal_transition");
    }
  });
});
