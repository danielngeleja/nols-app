/** Event booking, deposit and settlement state machines. No user action marks
 * money collected or paid: those transitions belong to verified providers. */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { EventHireError, depositFor, sanitizeEventTerms } from "./eventHire.js";
import { effectiveEventStatus, eventActorScope, lockEventProperty, type EventActor } from "./eventHireShared.js";
import { agencyGateFailure, loadAgencyGateInput } from "./salesAgency.js";
import { recognizeRevenue } from "./revenueLedger.js";
export const EVENT_CLAIM_HOURS = 48;
const HOUR = 3600000;
export const eventPaymentsEnabled = () => process.env.EVENT_HIRE_REQUESTS_ENABLED === "true" && process.env.EVENT_HIRE_PAYMENTS_ENABLED === "true";
export function eventFailure(message: string, code = "CONFLICT", status = 409): never {
  throw new EventHireError(message, status, code);
}
export const opaque = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const bookingReference = (s: unknown) => typeof s === "string" && /^ebk_[A-Za-z0-9_-]{32}$/.test(s);
export const bookingInclude = {
  request: {
    include: {
      property: {
        select: {
          title: true,
          ownerId: true,
          status: true,
          rentalMode: true,
          eventHire: {
            select: {
              status: true,
              termsFingerprint: true,
              approvedFingerprint: true
            }
          }
        }
      }
    }
  },
  claims: true,
  transfers: true,
  evidence: true
};
export const eventTransaction = (db: any, fn: (tx: any) => Promise<any>) => db.$transaction(fn, {
  isolationLevel: "ReadCommitted",
  maxWait: 10000,
  timeout: 15000
});
export const bookingScope = (actor: EventActor) => actor.kind === "OWNER" ? {
  ownerId: actor.userId
} : {
  request: eventActorScope(actor)
};
export async function bookingFor(db: any, ref: string, actor: EventActor) {
  if (!bookingReference(ref)) eventFailure("Not found", "NOT_FOUND", 404);
  const row = await db.eventHireBooking.findFirst({
    where: {
      reference: ref,
      ...bookingScope(actor)
    },
    include: bookingInclude
  });
  if (!row) eventFailure("Not found", "NOT_FOUND", 404);
  return row;
}
export async function bookingEvent(tx: any, b: any, actor: EventActor | null, action: string, details: any = {}) {
  await tx.eventHireRequestEvent.create({
    data: {
      requestId: b.requestId ?? b.request.id,
      actorUserId: actor?.userId ?? null,
      action,
      details
    }
  });
}
export async function bookingNotice(tx: any, b: any, body: string) {
  for (const userId of new Set([b.ownerId, b.request.clientUserId])) await tx.notification.create({
    data: {
      userId,
      type: "booking",
      title: "Event hire",
      body,
      meta: {
        notificationKind: "event_hire_booking",
        reference: b.reference,
        href: userId === b.ownerId ? "/owner/properties/events?tab=bookings" : "/account/event-requests"
      }
    }
  });
}
async function journal(tx: any, bookingId: number, kind: string, amount: number, suffix = "") {
  await tx.eventHireLedgerEntry.create({
    data: {
      bookingId,
      key: `${bookingId}:${kind}:${suffix}`,
      kind,
      amount
    }
  });
}
export function frozenEventMoney(request: any) {
  const terms = sanitizeEventTerms(request.termsSnapshot);
  const price = request.package === "HALF_DAY" ? terms.halfDayPrice : request.package === "FULL_DAY" ? terms.fullDayPrice : terms.eveningPrice;
  if (!price) eventFailure("The approved package is unavailable.", "PRICE_INVALID");
  const money = request.quote,
    deposit = depositFor(terms, price),
    cleaningFee = terms.cleaningFee ?? 0;
  if (!money || !["ownerPrice", "ownerReceives", "ownerFee", "clientFee", "clientPays", "nolsafFee"].every(key => Number.isSafeInteger(money[key]) && money[key] >= 0) || money.ownerPrice !== price || money.ownerReceives + money.ownerFee !== price || money.clientPays !== price + money.clientFee || money.nolsafFee !== money.ownerFee + money.clientFee) eventFailure("The frozen quote is inconsistent. Request a new quote.", "PRICE_CHANGED");
  if (deposit === null) eventFailure("The deposit is not configured.", "PRICE_INVALID");
  const result = {
    total: money.clientPays + deposit + cleaningFee,
    ownerDue: money.ownerReceives + cleaningFee,
    deposit,
    fee: money.nolsafFee,
    cleaningFee
  };
  if (!Number.isSafeInteger(result.total) || result.total <= 0 || result.total > 2147483647 || result.total !== request.quote?.total) eventFailure("Request a fresh approved quote.", "PRICE_CHANGED");
  return result;
}
export async function assertEventInventory(tx: any, propertyId: number, startsAt: Date, endsAt: Date, now: Date, exceptRequestId?: number) {
  const window = {
    startsAt: {
      lt: endsAt
    },
    endsAt: {
      gt: startsAt
    }
  };
  const busy = await tx.eventHireBooking.findFirst({
    where: {
      request: {
        propertyId,
        ...window
      },
      ...(exceptRequestId ? {
        requestId: {
          not: exceptRequestId
        }
      } : {}),
      OR: [{
        status: {
          in: ["CONFIRMED", "COMPLETED"]
        }
      }, {
        status: {
          in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"]
        },
        checkoutExpiresAt: {
          gt: now
        }
      }]
    },
    select: {
      id: true
    }
  });
  if (busy) eventFailure("This venue is already reserved for that time.", "UNAVAILABLE");
}
export async function prepareEventCheckout(db: any, actor: EventActor, ref: string, now = new Date()) {
  if (!eventPaymentsEnabled()) eventFailure("Event payments are not open yet.", "PAYMENTS_DISABLED", 503);
  if (actor.kind !== "CLIENT") eventFailure("Client account required.", "FORBIDDEN", 403);
  return eventTransaction(db, async tx => {
    let request = await tx.eventHireRequest.findFirst({
      where: {
        reference: ref,
        clientUserId: actor.userId
      },
      include: {
        property: {
          include: {
            eventHire: true
          }
        }
      }
    });
    if (!request) eventFailure("Not found", "NOT_FOUND", 404);
    await lockEventProperty(tx, request.propertyId);
    request = await tx.eventHireRequest.findUnique({
      where: {
        id: request.id
      },
      include: {
        property: {
          include: {
            eventHire: true
          }
        }
      }
    });
    const existing = await tx.eventHireBooking.findUnique({
      where: {
        requestId: request.id
      },
      include: bookingInclude
    });
    if (existing) {
      if (existing.paidAt) eventFailure("This event is already paid. Open the booking.", "ALREADY_PAID");
      if (existing.checkoutUrl && existing.checkoutStatus === "PROCESSING" && new Date(existing.checkoutExpiresAt) > now && existing.status === "PAYMENT_PENDING") return {
        booking: existing,
        checkoutUrl: existing.checkoutUrl,
        token: null
      };
      eventFailure("Payment is being checked. Do not pay again; contact NoLSAF if it remains pending.", "PAYMENT_PENDING");
    }
    if (effectiveEventStatus(request, now) !== "READY_TO_PAY" || !request.ownerConfirmedAt || request.confirmedOwnerId !== request.property.ownerId || !["APP", "DESK_CALL"].includes(request.confirmationVia)) eventFailure("Availability must be confirmed first.", "CONFIRMATION_REQUIRED");
    if (request.assisted) {
      if (!request.partnerApprovedAt || !request.salesPartnerId || agencyGateFailure(await loadAgencyGateInput(tx, request.salesPartnerId, now), {
        at: now
      })) eventFailure("An active assigned sales partner must approve this request.", "PARTNER_REQUIRED");
    }
    const venue = request.property.eventHire;
    if (request.property.status !== "APPROVED" || request.property.rentalMode !== "NIGHTLY" || venue?.status !== "APPROVED" || venue.termsFingerprint !== request.termsFingerprint || venue.approvedFingerprint !== request.termsFingerprint) eventFailure("The approved venue terms have changed.", "VENUE_CHANGED");
    const phone = await tx.user.findUnique({
      where: {
        id: actor.userId
      },
      select: {
        phoneVerifiedAt: true, fullName:true,name:true
      }
    });
    if (!phone?.phoneVerifiedAt) eventFailure("Verify your phone before paying.", "PHONE_REQUIRED", 403);
    const expiresAt = new Date(Math.min(new Date(request.holdExpiresAt).getTime(), new Date(request.startsAt).getTime(), now.getTime() + 20 * 60000));
    if (expiresAt.getTime() - now.getTime() < 5 * 60000) eventFailure("This hold is too close to expiry. Ask NoLSAF to reconfirm the time.", "HOLD_EXPIRING");
    await assertEventInventory(tx, request.propertyId, request.startsAt, request.endsAt, now, request.id);
    const blocked = await tx.eventHireBlock.findFirst({
      where: {
        propertyId: request.propertyId,
        cancelledAt: null,
        startsAt: {
          lt: request.endsAt
        },
        endsAt: {
          gt: request.startsAt
        }
      }
    });
    if (blocked) eventFailure("This time is blocked. Ask NoLSAF for another time.", "UNAVAILABLE");
    const token = randomBytes(32).toString("base64url");
    const b = await tx.eventHireBooking.create({
      data: {
        reference: opaque("ebk"),
        requestId: request.id,
        ownerId: request.property.ownerId,
      clientName:String(phone.fullName||phone.name||"NoLSAF client").slice(0,160),
      venueTitle:request.property.title,
        ...frozenEventMoney(request),
        paymentRef: `EHV-${randomBytes(16).toString("hex")}`,
        callbackTokenHash: tokenHash(token),
        checkoutStatus: "INITIATING",
        status: "PAYMENT_PENDING",
        checkoutExpiresAt: expiresAt,
        claimDeadline: new Date(new Date(request.endsAt).getTime() + EVENT_CLAIM_HOURS * HOUR)
      },
      include: bookingInclude
    });
    await tx.eventHireRequest.update({
      where: {
        id: request.id
      },
      data: {
        status: "PAYMENT_PENDING",
        holdExpiresAt: expiresAt,
        version: {
          increment: 1
        }
      }
    });
    await bookingEvent(tx, b, actor, "CHECKOUT_STARTED", {
      total: b.total,
      currency: "TZS"
    });
    return {
      booking: b,
      token,
      checkoutUrl: null
    };
  });
}

/** Only called after validating the per-checkout callback capability AND the
 * encrypted provider's final success. Browser returns cannot call this. */
export async function settleEventCollection(db: any, input: {
  paymentRef: string;
  transactionId: string;
  amount: number;
  currency: string;
}, now = new Date()) {
  return eventTransaction(db, async tx => {
    let b = await tx.eventHireBooking.findUnique({
      where: {
        paymentRef: input.paymentRef
      },
      include: bookingInclude
    });
    if (!b) eventFailure("Unknown payment.", "NOT_FOUND", 404);
    await lockEventProperty(tx, b.request.propertyId);
    b = await tx.eventHireBooking.findUnique({
      where: {
        id: b.id
      },
      include: bookingInclude
    });
    if (input.currency !== "TZS" || input.amount !== b.total || !/^[A-Za-z0-9_-]{1,80}$/.test(input.transactionId)) eventFailure("Payment details do not match.", "PAYMENT_MISMATCH");
    if (b.paidAt && b.providerTransactionId === input.transactionId) return b;
    const recorded = await tx.paymentEvent.findUnique({
      where: {
        eventId: input.transactionId
      }
    });
    if (recorded) {
      if (recorded.provider !== "CORALCOMMERCE" || recorded.payload?.eventBookingRef !== b.reference || Number(recorded.amount) !== b.total) eventFailure("Provider transaction belongs to another payment.", "PROVIDER_REPLAY");
      return b;
    }
    // PaymentEvent's global provider transaction key prevents replay onto any
    // other accommodation, tour, event or NRMS payment.
    await tx.paymentEvent.create({
      data: {
        provider: "CORALCOMMERCE",
        eventId: input.transactionId,
        amount: b.total,
        currency: "TZS",
        status: "SUCCESS",
        paymentChannel: "CARD",
        payload: {
          eventBookingRef: b.reference,
          paymentRef: b.paymentRef
        }
      }
    });
    if (b.paidAt) {
      const kind = `EXTRA_REFUND_${tokenHash(input.transactionId).slice(0, 10)}`;
      await journal(tx, b.id, "EXTRA_COLLECTION", b.total, input.transactionId);
      await tx.eventHireTransfer.create({
        data: {
          reference: opaque("eft"),
          bookingId: b.id,
          kind,
          payeeUserId: b.request.clientUserId,
          amount: b.total,
          collectionReference: input.transactionId
        }
      });
      await bookingEvent(tx, b, null, "EXTRA_PAYMENT_REVIEW", {
        transactionId: input.transactionId,
        amount: b.total
      });
      await bookingNotice(tx, b, "An additional payment was received for this event. NoLSAF has recorded it for a full refund review; do not pay again.");
      return b;
    }
    const current = b.request.property;
    let valid = b.status === "PAYMENT_PENDING" && b.checkoutExpiresAt > now && b.request.startsAt > now && current.status === "APPROVED" && current.ownerId === b.ownerId && current.eventHire?.status === "APPROVED" && current.eventHire?.termsFingerprint === b.request.termsFingerprint && current.eventHire?.approvedFingerprint === b.request.termsFingerprint;
    if (valid) {
      try {
        await assertEventInventory(tx, b.request.propertyId, b.request.startsAt, b.request.endsAt, now, b.requestId);
      } catch (error) {
        if (!(error instanceof EventHireError)) throw error;
        valid = false;
      }
    }
    const updated = await tx.eventHireBooking.update({
      where: {
        id: b.id
      },
      data: {
        paidAt: now,
        providerTransactionId: input.transactionId,
        checkoutStatus: "SUCCEEDED",
        status: valid ? "CONFIRMED" : "PAYMENT_REVIEW",
        depositStatus: "HELD",
        payoutStatus: valid ? "HELD" : "REFUND_REVIEW",
        version: {
          increment: 1
        }
      },
      include: bookingInclude
    });
    await journal(tx, b.id, "COLLECTION", b.total);
    await journal(tx, b.id, "DEPOSIT_HELD", b.deposit);
    await tx.eventHireRequest.update({
      where: {
        id: b.requestId
      },
      data: {
        status: valid ? "BOOKED" : "PAYMENT_REVIEW",
        holdExpiresAt: null,
        version: {
          increment: 1
        }
      }
    });
    await bookingEvent(tx, updated, null, valid ? "BOOKING_CONFIRMED" : "LATE_PAYMENT_REVIEW", {
      transactionId: input.transactionId,
      amount: b.total
    });
    if (!valid) await makeTransfer(tx, updated, "CANCELLATION_REFUND", updated.request.clientUserId, b.total);
    await bookingNotice(tx, updated, valid ? "Your event booking is confirmed. View its payment and deposit details in Event hire." : "Payment arrived after availability changed. No booking was confirmed; NoLSAF is reviewing the full refund.");
    return updated;
  });
}
export async function recordEventDecline(db: any, id: number, now = new Date()) {
  return eventTransaction(db, async tx => {
    let b = await tx.eventHireBooking.findUnique({
      where: {
        id
      },
      include: bookingInclude
    });
    if (!b) return;
    await lockEventProperty(tx, b.request.propertyId);
    b = await tx.eventHireBooking.findUnique({
      where: {
        id
      },
      include: bookingInclude
    });
    if (b.paidAt || b.checkoutStatus === "FAILED") return;
    await tx.eventHireBooking.update({
      where: {
        id
      },
      data: {
        status: "EXPIRED",
        checkoutStatus: "FAILED",
        version: {
          increment: 1
        }
      }
    });
    await tx.eventHireRequest.update({
      where: {
        id: b.requestId
      },
      data: {
        status: "EXPIRED",
        holdExpiresAt: null,
        version: {
          increment: 1
        }
      }
    });
    await bookingEvent(tx, b, null, "PAYMENT_DECLINED", {
      receivedAt: now.toISOString()
    });
    await bookingNotice(tx, b, "The payment provider declined checkout. The slot hold was released. Request a fresh confirmation before paying again.");
  });
}
async function makeTransfer(tx: any, b: any, kind: string, payeeUserId: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) eventFailure("Invalid settlement amount.", "MONEY_INVALID");
  if (!amount) return;
  await tx.eventHireTransfer.upsert({
    where: {
      bookingId_kind: {
        bookingId: b.id,
        kind
      }
    },
    update: {},
    create: {
      reference: opaque("eft"),
      bookingId: b.id,
      kind,
      payeeUserId,
      amount
    }
  });
}
export async function prepareEventSettlement(tx: any, b: any, now: Date) {
  if (!b.paidAt || b.settlementPreparedAt || b.status !== "COMPLETED" || b.claimDeadline > now || b.cancellationRequestedAt || b.claims.some((c: any) => c.status !== "RESOLVED")) return false;
  const award = b.claims.reduce((sum: number, c: any) => sum + (c.award ?? 0), 0);
  if (award > b.deposit) eventFailure("The deposit allocation is invalid.", "MONEY_INVALID");
  await makeTransfer(tx, b, "OWNER_PAYOUT", b.ownerId, b.ownerDue);
  await makeTransfer(tx, b, "DAMAGE_AWARD", b.ownerId, award);
  await makeTransfer(tx, b, "DEPOSIT_REFUND", b.request.clientUserId, b.deposit - award);
  await recognizeRevenue(tx, {
    stream: "EVENT_HIRE",
    sourceType: "EVENT_BOOKING",
    sourceId: b.id,
    currency: "TZS",
    fxTzsPerUnit: 1,
    gross: b.total - b.deposit,
    commission: b.fee,
    partnerNet: b.ownerDue,
    recognizedAt: now
  });
  await tx.eventHireBooking.update({
    where: {
      id: b.id
    },
    data: {
      payoutStatus: "REVIEW",
      depositStatus: b.deposit ? "REVIEW" : "NONE",
      settlementPreparedAt: now
    }
  });
  return true;
}
const evidenceItem = z.object({
  reference: z.string().regex(/^eev_[A-Za-z0-9_-]{32}$/),
  kind: z.enum(["BEFORE", "AFTER", "RECEIPT", "OTHER"])
}).strict();
export const damageClaimBody = z.object({
  version: z.number().int().positive(),
  description: z.string().trim().min(30).max(2000),
  evidence: z.array(evidenceItem).min(2).max(24),
  items: z.array(z.object({
    description: z.string().trim().min(5).max(200),
    cost: z.number().int().min(1).max(500000000),
    depreciationPercent: z.number().int().min(0).max(100)
  }).strict()).min(1).max(20)
}).strict();
export function damageValue(items: Array<{
  cost: number;
  depreciationPercent: number;
}>, deposit: number) {
  return Math.min(deposit, items.reduce((sum, item) => sum + Math.round(item.cost * (100 - item.depreciationPercent) / 100), 0));
}
function validateEvidence(b: any, actor: EventActor, list: Array<{
  reference: string;
  kind: string;
}>, baseline = false) {
  if (new Set(list.map(e => e.reference)).size !== list.length || list.some(e => !b.evidence.some((stored: any) => stored.reference === e.reference && stored.uploadedById === actor.userId && stored.kind === e.kind))) eventFailure("Use evidence uploaded to this booking by your account.", "EVIDENCE_INVALID", 400);
  if (baseline && (!list.some(e => e.kind === "BEFORE") || !list.some(e => e.kind === "AFTER"))) eventFailure("Include the condition before and after the event.", "EVIDENCE_REQUIRED", 400);
}
export async function openDamageClaim(db: any, actor: EventActor, ref: string, raw: unknown, now = new Date()) {
  const parsed = damageClaimBody.safeParse(raw);
  if (!parsed.success) eventFailure("Check the damage items and evidence.", "INVALID_CLAIM", 400);
  if (actor.kind !== "OWNER") eventFailure("Owner action required.", "FORBIDDEN", 403);
  const input = parsed.data!;
  return eventTransaction(db, async tx => {
    let b = await bookingFor(tx, ref, actor);
    await lockEventProperty(tx, b.request.propertyId);
    b = await bookingFor(tx, ref, actor);
    validateEvidence(b, actor, input.evidence, true);
    if (b.version !== input.version) eventFailure("Refresh this booking before submitting.", "CHANGED");
    if (!b.paidAt || !["CONFIRMED", "COMPLETED"].includes(b.status) || b.request.endsAt > now || now >= b.claimDeadline || b.deposit <= 0 || b.claims.length || b.transfers.some((t: any) => !t.kind.startsWith("EXTRA_REFUND_"))) eventFailure("The damage claim window is closed or a case already exists.", "CLAIM_CLOSED");
    const amount = damageValue(input.items, b.deposit);
    if (amount <= 0) eventFailure("No compensable damage amount was entered.", "CLAIM_AMOUNT", 400);
    const claim = await tx.eventHireClaim.create({
      data: {
        reference: opaque("ecl"),
        bookingId: b.id,
        ownerUserId: actor.userId,
        description: input.description,
        items: input.items,
        evidence: input.evidence,
        requestedAmount: amount,
        responseDueAt: new Date(now.getTime() + 48 * HOUR)
      }
    });
    await tx.eventHireBooking.update({
      where: {
        id: b.id
      },
      data: {
        depositStatus: "DISPUTED",
        payoutStatus: "ON_HOLD",
        version: {
          increment: 1
        }
      }
    });
    await bookingEvent(tx, b, actor, "DAMAGE_CLAIMED", {
      claim: claim.reference,
      amount
    });
    await bookingNotice(tx, b, "A damage claim was submitted. The client can respond with evidence; no deduction has been awarded.");
    return claim;
  });
}
export async function respondToDamage(db: any, actor: EventActor, ref: string, raw: unknown, now = new Date()) {
  const parsed = z.object({
    version: z.number().int().positive(),
    response: z.string().trim().min(10).max(2000),
    evidence: z.array(evidenceItem).max(24).default([])
  }).strict().safeParse(raw);
  if (!parsed.success || actor.kind !== "CLIENT") eventFailure("Check your response.", "INVALID_RESPONSE", 400);
  const input = parsed.data!;
  return eventTransaction(db, async tx => {
    let b = await bookingFor(tx, ref, actor);
    await lockEventProperty(tx, b.request.propertyId);
    b = await bookingFor(tx, ref, actor);
    validateEvidence(b, actor, input.evidence);
    const claim = b.claims[0];
    if (!claim || claim.version !== input.version || claim.status === "RESOLVED") eventFailure("This claim changed or is closed.", "CHANGED");
    await tx.eventHireClaim.update({
      where: {
        id: claim.id
      },
      data: {
        status: "REVIEW",
        clientResponse: input.response,
        clientEvidence: input.evidence,
        respondedAt: now,
        version: {
          increment: 1
        }
      }
    });
    await bookingEvent(tx, b, actor, "CLAIM_RESPONDED");
    await bookingNotice(tx, b, "The client responded to the damage claim. NoLSAF will review both sides.");
  });
}
export const bookingActionBody = z.object({
  version: z.number().int().positive(),
  action: z.enum(["COMPLETE", "REQUEST_CANCEL", "CANCEL_AND_REFUND", "KEEP_BOOKING", "RESOLVE_CLAIM", "APPROVE_TRANSFER"]),
  note: z.string().trim().min(12).max(2000).optional(),
  award: z.number().int().min(0).max(500000000).optional(),
  claimVersion: z.number().int().positive().optional(),
  transferRef: z.string().max(40).optional(),
  attested: z.literal(true).optional(),
  clientNotified:z.literal(true).optional()
}).strict();
export async function actOnEventBooking(db: any, actor: EventActor, ref: string, raw: unknown, now = new Date()) {
  const parsed = bookingActionBody.safeParse(raw);
  if (!parsed.success) eventFailure("Check the booking decision.", "INVALID_DECISION", 400);
  const input = parsed.data!;
  return eventTransaction(db, async tx => {
    let b = await bookingFor(tx, ref, actor);
    await lockEventProperty(tx, b.request.propertyId);
    b = await bookingFor(tx, ref, actor);
    if (b.version !== input.version) eventFailure("This booking changed. Refresh before deciding.", "CHANGED");
    if (actor.kind === "PARTNER") eventFailure("Partners cannot decide booking funds or completion.", "FORBIDDEN", 403);
    const independentAdmin = actor.kind === "ADMIN" && ![b.ownerId, b.request.clientUserId].includes(actor.userId);
    if (input.action === "COMPLETE") {
      if (!b.paidAt || !["CONFIRMED", "COMPLETED"].includes(b.status) || b.request.endsAt > now) eventFailure("The paid event must have ended first.", "NOT_ENDED");
      if (actor.kind === "ADMIN" && (!independentAdmin || !input.note || !input.attested)) eventFailure("Record an independent completion review.", "REVIEW_REQUIRED", 403);
      const owner = actor.kind === "OWNER" || b.ownerCompletedAt,
        client = actor.kind === "CLIENT" || b.clientCompletedAt;
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          ...(actor.kind === "OWNER" ? {
            ownerCompletedAt: now
          } : {}),
          ...(actor.kind === "CLIENT" ? {
            clientCompletedAt: now
          } : {}),
          ...(independentAdmin || owner && client ? {
            status: "COMPLETED",
            completedAt: b.completedAt ?? now
          } : {}),
          version: {
            increment: 1
          }
        }
      });
    } else if (input.action === "REQUEST_CANCEL" && ["OWNER", "CLIENT"].includes(actor.kind)) {
      if (!input.note || !b.paidAt || !["CONFIRMED", "COMPLETED"].includes(b.status) || b.transfers.some((t: any) => !t.kind.startsWith("EXTRA_REFUND_")) || now > b.claimDeadline) eventFailure("Contact NoLSAF to review this cancellation.", "CANCELLATION_CLOSED");
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          cancellationRequestedAt: now,
          cancellationReason: input.note,
          payoutStatus: "ON_HOLD",
          version: {
            increment: 1
          }
        }
      });
    } else if (input.action === "CANCEL_AND_REFUND" && independentAdmin) {
      if (!input.note || !input.attested || !b.paidAt || !["CONFIRMED", "COMPLETED", "PAYMENT_REVIEW"].includes(b.status)) eventFailure("Review the paid booking and record the refund reason.", "REVIEW_REQUIRED");
      if (b.transfers.some((t: any) => t.kind !== "CANCELLATION_REFUND" && !t.kind.startsWith("EXTRA_REFUND_"))) eventFailure("Settlement has started. Resolve the existing transfers before cancellation.", "SETTLEMENT_STARTED");
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReason: input.note,
          payoutStatus: "CANCELLED",
          depositStatus: "REFUND_REVIEW",
          version: {
            increment: 1
          }
        }
      });
      await makeTransfer(tx, b, "CANCELLATION_REFUND", b.request.clientUserId, b.total);
    } else if (input.action === "KEEP_BOOKING" && independentAdmin) {
      if (!input.note || !input.attested || !b.cancellationRequestedAt || b.cancelledAt) eventFailure("A documented cancellation review is required.", "REVIEW_REQUIRED");
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          cancellationRequestedAt: null,
          payoutStatus: "HELD",
          version: {
            increment: 1
          }
        }
      });
    } else if (input.action === "RESOLVE_CLAIM" && independentAdmin) {
      const claim = b.claims[0];
      if (!claim || claim.version !== input.claimVersion || claim.status === "RESOLVED" || input.award === undefined || !input.note || !input.attested) eventFailure("Review both sides and record an award and reason.", "REVIEW_REQUIRED");
      if (!claim.respondedAt && claim.responseDueAt > now) eventFailure("The client still has time to respond.", "RESPONSE_WINDOW");
      if(!claim.respondedAt&&!input.clientNotified)eventFailure("Verify that the client received notice and had the response window before deciding an unanswered claim.","NOTICE_REVIEW_REQUIRED");
      if (input.award > damageValue(claim.items, b.deposit) || input.award > claim.requestedAmount) eventFailure("The award exceeds the documented depreciated loss or deposit.", "AWARD_TOO_HIGH", 400);
      await tx.eventHireClaim.update({
        where: {
          id: claim.id
        },
        data: {
          status: "RESOLVED",
          award: input.award,
          decisionReason: input.note,
          decidedAt: now,
          decidedById: actor.userId,
          version: {
            increment: 1
          }
        }
      });
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          depositStatus: "HELD",
          payoutStatus: "HELD",
          version: {
            increment: 1
          }
        }
      });
    } else if (input.action === "APPROVE_TRANSFER" && independentAdmin) {
      const transfer = b.transfers.find((t: any) => t.reference === input.transferRef);
      if (!transfer || transfer.status !== "REVIEW" || !input.attested || !input.note || transfer.payeeUserId === actor.userId) eventFailure("Independently review this transfer before approving.", "REVIEW_REQUIRED");
      if (transfer.kind !== "CANCELLATION_REFUND" && !transfer.kind.startsWith("EXTRA_REFUND_") && (b.status !== "COMPLETED" || b.claimDeadline > now || b.cancellationRequestedAt || b.claims.some((c: any) => c.status !== "RESOLVED"))) eventFailure("Settlement is not ready.", "SETTLEMENT_NOT_READY");
      await tx.eventHireTransfer.update({
        where: {
          id: transfer.id
        },
        data: {
          status: "APPROVED",
          approvedById: actor.userId,
          approvedAt: now
        }
      });
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          version: {
            increment: 1
          }
        }
      });
    } else eventFailure("This action is not permitted.", "FORBIDDEN", 403);
    await bookingEvent(tx, b, actor, input.action, {
      ...(input.note ? {
        note: input.note
      } : {}),
      ...(input.award !== undefined ? {
        award: input.award
      } : {}),
      ...(input.clientNotified?{clientNoticeVerified:true}:{}),
      ...(input.transferRef ? {
        transferRef: input.transferRef
      } : {})
    });
    b = await bookingFor(tx, ref, actor);
    await prepareEventSettlement(tx, b, now);
    await bookingNotice(tx, b, "The event booking was updated. Open it to see its current status and financial decisions.");
    return bookingFor(tx, ref, actor);
  });
}
export function eventBookingView(b: any, actor: EventActor) {
  return {
    reference: b.reference,
    version: b.version,
    status: b.status,
    propertyRef: undefined,
    propertyTitle: b.venueTitle || b.request.property.title,
    organizer:b.clientName || "NoLSAF client",
    startsAt: b.request.startsAt,
    endsAt: b.request.endsAt,
    people: b.request.people,
    eventType: b.request.eventType,
    total: b.total,
    ownerDue: ["OWNER","ADMIN"].includes(actor.kind) ? b.ownerDue : undefined,
    deposit: b.deposit,
    fee: ["OWNER","ADMIN"].includes(actor.kind) ? b.fee : undefined,
    paidAt: b.paidAt,
    checkoutStatus: b.checkoutStatus,
    ...(actor.kind==="ADMIN"?{paymentReference:b.paymentRef,providerTransactionId:b.providerTransactionId}:{}),
    checkoutExpiresAt: b.checkoutExpiresAt,
    completedAt: b.completedAt,
    ownerCompletedAt: b.ownerCompletedAt,
    clientCompletedAt: b.clientCompletedAt,
    cancellationRequestedAt: b.cancellationRequestedAt,
    cancellationReason: b.cancellationReason,
    claimDeadline: b.claimDeadline,
    depositStatus: b.depositStatus,
    payoutStatus: b.payoutStatus,
    evidence: actor.kind==="PARTNER"?[]:b.evidence.map((e: any) => ({
      reference: e.reference,
      kind: e.kind,
      createdAt: e.createdAt,
      own: e.uploadedById === actor.userId
    })),
    claims: actor.kind==="PARTNER"?[]:b.claims.map((c: any) => ({
      reference: c.reference,
      version: c.version,
      status: c.status,
      description: c.description,
      items: c.items,
      evidence: c.evidence,
      requestedAmount: c.requestedAmount,
      clientResponse: c.clientResponse,
      clientEvidence: c.clientEvidence,
      responseDueAt: c.responseDueAt,
      award: c.award,
      decisionReason: c.decisionReason
    })),
    transfers: b.transfers.filter((t: any) => actor.kind!=="PARTNER"&&(actor.kind !== "CLIENT" || t.payeeUserId === actor.userId)).map((t: any) => ({
      reference: t.reference,
      kind: t.kind,
      amount: t.amount,
      status: t.status,
      paidAt: t.paidAt,
      ...(actor.kind === "ADMIN" ? {
        sourceId: t.id,
        payeeUserId: t.payeeUserId
      } : {})
    }))
  };
}
export async function runEventBookingLifecycle(db: any, now = new Date()) {
  const candidates = await db.eventHireBooking.findMany({
    where: {
      OR: [{
        status: {
          in: ["CONFIRMED", "COMPLETED"]
        },
        claimDeadline: {
          lte: now
        },
        payoutStatus: {
          in: ["HELD", "ON_HOLD"]
        }
      }, {
        status: "PAYMENT_PENDING",
        checkoutExpiresAt: {
          lte: now
        }
      }]
    },
    select: {
      id: true,
      request: {
        select: {
          propertyId: true
        }
      }
    },
    take: 100
  });
  for (const candidate of candidates) await eventTransaction(db, async tx => {
    await lockEventProperty(tx, candidate.request.propertyId);
    let b = await tx.eventHireBooking.findUnique({
      where: {
        id: candidate.id
      },
      include: bookingInclude
    });
    if (!b) return;
    if (!b.paidAt && b.checkoutExpiresAt <= now && b.status === "PAYMENT_PENDING") {
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          status: "EXPIRED",
          version: {
            increment: 1
          }
        }
      });
      await tx.eventHireRequest.update({
        where: {
          id: b.requestId
        },
        data: {
          status: "EXPIRED",
          holdExpiresAt: null,
          version: {
            increment: 1
          }
        }
      });
      await bookingEvent(tx, b, null, "CHECKOUT_EXPIRED");
      return;
    }
    if (b.status === "CONFIRMED" && b.claimDeadline <= now && !b.cancellationRequestedAt && !b.claims.some((c: any) => c.status !== "RESOLVED")) {
      await tx.eventHireBooking.update({
        where: {
          id: b.id
        },
        data: {
          status: "COMPLETED",
          completedAt: now,
          version: {
            increment: 1
          }
        }
      });
      await bookingEvent(tx, b, null, "COMPLETION_WINDOW_ENDED");
      b = await tx.eventHireBooking.findUnique({
        where: {
          id: b.id
        },
        include: bookingInclude
      });
    }
    if (await prepareEventSettlement(tx, b, now)) {
      await bookingEvent(tx, b, null, "SETTLEMENT_REVIEW_READY");
      await bookingNotice(tx, b, "The event is ready for settlement review. Deposits and owner earnings remain separate until released.");
    }
  });
}
export async function eligibleEventTransfer(db: any, id: number, now = new Date()) {
  const t = await db.eventHireTransfer.findUnique({
    where: {
      id
    },
    include: {
      booking: {
        include: bookingInclude
      }
    }
  });
  if (!t || t.status !== "APPROVED" || !t.booking.paidAt || t.amount <= 0) return {
    ok: false as const,
    reason: "Transfer is not approved and funded."
  };
  const b = t.booking;
  const funding = await db.paymentEvent.findUnique({
    where: {
      eventId: t.collectionReference || b.providerTransactionId || "missing"
    }
  });
  if (!funding || funding.provider !== "CORALCOMMERCE" || funding.status !== "SUCCESS" || Number(funding.amount) !== b.total || funding.currency !== "TZS" || funding.payload?.eventBookingRef !== b.reference) return {
    ok: false as const,
    reason: "The collection is not verified."
  };
  const award = b.claims.reduce((sum: number, c: any) => sum + (c.award ?? 0), 0);
  const extra = t.kind.startsWith("EXTRA_REFUND_") && Boolean(t.collectionReference);
  const expected = t.kind === "OWNER_PAYOUT" ? {
    amount: b.ownerDue,
    payee: b.ownerId
  } : t.kind === "DAMAGE_AWARD" ? {
    amount: award,
    payee: b.ownerId
  } : t.kind === "DEPOSIT_REFUND" ? {
    amount: b.deposit - award,
    payee: b.request.clientUserId
  } : t.kind === "CANCELLATION_REFUND" || extra ? {
    amount: b.total,
    payee: b.request.clientUserId
  } : null;
  if (!expected || t.amount !== expected.amount || t.payeeUserId !== expected.payee || t.kind === "CANCELLATION_REFUND" && !["CANCELLED", "PAYMENT_REVIEW"].includes(b.status)) return {
    ok: false as const,
    reason: "Transfer differs from the booking's frozen settlement."
  };
  if (t.kind !== "CANCELLATION_REFUND" && !extra && (b.status !== "COMPLETED" || b.claimDeadline > now || b.cancellationRequestedAt || b.claims.some((c: any) => c.status !== "RESOLVED"))) return {
    ok: false as const,
    reason: "Booking settlement is on hold."
  };
  const approved = b.transfers.reduce((sum: number, x: any) => sum + x.amount, 0);
  const fundingTotal = await db.paymentEvent.aggregate({
    where: {
      provider: "CORALCOMMERCE",
      status: "SUCCESS",
      payload: {
        path: "$.eventBookingRef",
        equals: b.reference
      }
    },
    _sum: {
      amount: true
    }
  });
  if (approved > Number(fundingTotal._sum.amount ?? 0)) return {
    ok: false as const,
    reason: "The settlement exceeds collected funds."
  };
  return {
    ok: true as const,
    payeeUserId: t.payeeUserId,
    amount: t.amount,
    currency: "TZS"
  };
}
export async function markEventTransferPaid(tx: any, id: number, amount: number, providerReference: string, now = new Date()) {
  const t = await tx.eventHireTransfer.findUnique({
    where: {
      id
    }
  });
  if (!t || t.status === "PAID") return;
  if (t.status !== "APPROVED" || t.amount !== amount) eventFailure("Payout does not match its approved source.", "PAYOUT_MISMATCH");
  // Always lock the booking before any transfer row, so two callbacks for
  // its award/refund cannot deadlock by taking the transfer locks in reverse.
  await tx.$queryRaw`SELECT id FROM event_hire_booking WHERE id=${t.bookingId} FOR UPDATE`;
  const changed = await tx.eventHireTransfer.updateMany({
    where: {
      id,
      status: "APPROVED",
      amount
    },
    data: {
      status: "PAID",
      paidAt: now,
      providerReference
    }
  });
  if (!changed.count) return;
  await journal(tx, t.bookingId, t.kind, -amount, String(id));
  if (["DEPOSIT_REFUND", "DAMAGE_AWARD", "CANCELLATION_REFUND"].includes(t.kind)) {
    const b = await tx.eventHireBooking.findUnique({
      where: {
        id: t.bookingId
      },
      select: {
        deposit: true
      }
    });
    await journal(tx, t.bookingId, "DEPOSIT_RELEASED", -(t.kind === "CANCELLATION_REFUND" ? b.deposit : amount), String(id));
  }
  // Current locking read: different disbursements can settle the award and
  // refund concurrently under a repeatable-read caller transaction.
  const rest: any[] = await tx.$queryRaw`SELECT kind,status FROM event_hire_transfer WHERE bookingId=${t.bookingId} FOR UPDATE`;
  const depositTransfers = rest.filter((x: any) => ["DEPOSIT_REFUND", "DAMAGE_AWARD", "CANCELLATION_REFUND"].includes(x.kind));
  await tx.eventHireBooking.update({
    where: {
      id: t.bookingId
    },
    data: {
      ...(depositTransfers.length && depositTransfers.every((x: any) => x.status === "PAID") ? {
        depositStatus: "SETTLED"
      } : {}),
      ...(t.kind === "OWNER_PAYOUT" ? {
        payoutStatus: "SETTLED"
      } : {}),
      version: {
        increment: 1
      }
    }
  });
}
