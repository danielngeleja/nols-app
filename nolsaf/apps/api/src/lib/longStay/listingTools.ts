/**
 * The long-stay helpers a listing wizard calls while the terms are being
 * written (eligibility, fee quote, lease preview), as plain functions so the
 * owner routes and the Sales Partner's assisted-listing routes give the same
 * answers. Nothing here saves anything.
 */
import { z } from "zod";
import {
  computeLongStayQuote,
  LONG_STAY_CURRENCIES,
  LONG_STAY_MAX_TERM_MONTHS,
  LONG_STAY_PROPERTY_TYPES,
  LONG_STAY_TERM_MONTHS,
  LongStayQuoteError,
  longStayOpen,
} from "./fees.js";
import { applyDiscount, currentLongStayRates, parseLongStayTerms, todayInEat } from "./listing.js";
import { LEASE_VERSION } from "./lease.js";
import { sampleLeaseText } from "./leasePreview.js";

export function longStayEligibilityBody(input: { granted: boolean; paused: boolean; pauseReason: string | null; refusal: string | null }) {
  return {
    ...input,
    bookingsOpen: longStayOpen(),
    propertyTypes: LONG_STAY_PROPERTY_TYPES,
    termMonths: LONG_STAY_TERM_MONTHS,
    maxTermMonths: LONG_STAY_MAX_TERM_MONTHS,
    currencies: LONG_STAY_CURRENCIES,
  };
}

export const longStayQuoteSchema = z.object({
  monthlyRent: z.coerce.number(),
  termMonths: z.coerce.number().int(),
  upfrontMonths: z.coerce.number().int(),
  currency: z.string().trim().max(3),
  discountPercent: z.coerce.number().int().min(0).max(30).optional(),
}).strict();

export type ToolResult = { status: number; body: any };

export async function longStayQuoteFor(db: any, raw: unknown): Promise<ToolResult> {
  const parsed = longStayQuoteSchema.safeParse(raw ?? {});
  if (!parsed.success) return { status: 400, body: { error: "Send monthlyRent, termMonths, upfrontMonths and currency." } };
  try {
    const { discountPercent = 0, ...rest } = parsed.data;
    const quote = computeLongStayQuote({ ...rest, monthlyRent: applyDiscount(rest.monthlyRent, rest.currency, discountPercent), rates: await currentLongStayRates(db) });
    return { status: 200, body: { quote } };
  } catch (error) {
    if (error instanceof LongStayQuoteError) return { status: 400, body: { error: error.message } };
    throw error;
  }
}

export const longStayPreviewSchema = z.object({
  terms: z.unknown(),
  houseRules: z.unknown().optional(),
  homeTitle: z.string().trim().max(200).optional().nullable(),
  homeArea: z.string().trim().max(200).optional().nullable(),
}).strict();

export async function longStayLeasePreviewFor(db: any, raw: unknown, landlordName: string): Promise<ToolResult> {
  const body = longStayPreviewSchema.safeParse(raw ?? {});
  if (!body.success) return { status: 400, body: { error: "Send the terms to preview." } };
  const today = todayInEat();
  let terms;
  try {
    terms = parseLongStayTerms({ ...(body.data.terms as any), availableFrom: (body.data.terms as any)?.availableFrom || today }, today);
  } catch (error: any) {
    return { status: 400, body: { error: error?.message || "Finish the monthly terms first." } };
  }
  const { text, moveInDate, termMonths } = await sampleLeaseText(db, {
    terms,
    houseRules: body.data.houseRules,
    landlordName,
    homeTitle: body.data.homeTitle || "[This home]",
    homeArea: body.data.homeArea,
    today,
  });
  return { status: 200, body: { text, version: LEASE_VERSION, sample: { moveInDate, termMonths } } };
}
