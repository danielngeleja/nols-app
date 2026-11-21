/**
 * Ask NoLSAF (docs/LONG_STAY_RENTALS.md section 13): a tenant's question about
 * a long-stay home, or a request to visit it with a NoLSAF Sales Partner.
 *
 * It goes to NoLSAF, never to the landlord: NoLSAF answers, asking the
 * landlord itself when needed, so the bridge stays in the middle and no deal
 * is taken offline before payment. Contact details typed by the tenant are
 * hidden for the same reason.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isLongStayPropertyType, longStayOpen } from "./fees.js";
import { maskContacts } from "./tenancyService.js";

export class EnquiryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "EnquiryError";
  }
}

export const ENQUIRY_REF = /^le_[A-Za-z0-9_-]{22}$/;
export const isEnquiryRef = (v: unknown): v is string => typeof v === "string" && ENQUIRY_REF.test(v);
/** Open enquiries one tenant may hold, across all homes. */
export const MAX_OPEN_ENQUIRIES = 5;

export const enquirySchema = z.object({
  property: z.string().trim().min(8).max(200),
  kind: z.enum(["QUESTION", "VISIT"]),
  text: z.string().trim().min(5).max(1000),
  /** VISIT only: up to 3 times that suit the tenant. */
  slots: z.array(z.string().datetime({ offset: true })).max(3).optional().nullable(),
}).strict();

export const answerSchema = z.object({
  answer: z.string().trim().min(5).max(1000),
  /** VISIT: the agreed time and the partner who goes (agent code). */
  visitAt: z.string().datetime({ offset: true }).optional().nullable(),
  partnerCode: z.string().trim().max(30).optional().nullable(),
}).strict();

/** A visit slot must be at least 4 hours out and within 30 days. */
export function checkVisitSlot(iso: string, now = new Date()): Date {
  const at = new Date(iso);
  const ms = at.getTime() - now.getTime();
  if (!Number.isFinite(at.getTime()) || ms < 4 * 3_600_000) throw new EnquiryError("Choose visit times at least 4 hours from now.");
  if (ms > 30 * 86_400_000) throw new EnquiryError("Choose visit times within the next 30 days.");
  return at;
}

export async function createEnquiry(db: any, input: { userId: number; propertyKey: string; kind: "QUESTION" | "VISIT"; text: string; slots?: string[] | null }, now = new Date()) {
  if (!longStayOpen()) throw new EnquiryError("Long stays are not open yet.", 403);
  const property = await db.property.findFirst({
    where: { nrmsBookingKey: input.propertyKey, status: "APPROVED", rentalMode: "LONG_STAY" },
    select: { id: true, ownerId: true, type: true, title: true },
  });
  if (!property || !isLongStayPropertyType(property.type)) throw new EnquiryError("This home is not available for long stays.", 404);
  if (property.ownerId === input.userId) throw new EnquiryError("This is your own home.", 403);

  let slots: string[] | null = null;
  if (input.kind === "VISIT") {
    const unique = Array.from(new Set(input.slots ?? []));
    if (!unique.length) throw new EnquiryError("Choose up to 3 times that suit you for the visit.");
    slots = unique.map((iso) => checkVisitSlot(iso, now).toISOString()).sort();
  }
  const open = await db.longStayEnquiry.count({ where: { userId: input.userId, status: "OPEN" } });
  if (open >= MAX_OPEN_ENQUIRIES) throw new EnquiryError(`You have ${MAX_OPEN_ENQUIRIES} questions waiting for NoLSAF. We will answer them soon.`, 429);

  const text = maskContacts(input.text).text;
  const enquiry = await db.longStayEnquiry.create({
    data: { publicRef: `le_${randomBytes(16).toString("base64url")}`, propertyId: property.id, userId: input.userId, kind: input.kind, text, slots },
  });
  return { enquiry, property };
}

/** What the tenant sees of their own enquiries. */
export function enquiryView(row: any, home?: { title: string | null; key: string | null } | null) {
  return {
    ref: row.publicRef,
    kind: row.kind,
    text: row.text,
    slots: Array.isArray(row.slots) ? row.slots : [],
    status: row.status,
    answer: row.answer ?? null,
    answeredAt: row.answeredAt ?? null,
    visitAt: row.visitAt ?? null,
    createdAt: row.createdAt,
    home: home ?? null,
  };
}
