/**
 * The lease a tenant would sign for a long-stay listing, with sample names and
 * dates. One builder for the landlord writing the listing and the admin
 * reviewing it, so both read the same words the real lease will carry.
 * Nothing is saved.
 */
import { computeLongStayQuote } from "./fees.js";
import { currentLongStayRates, discountForTerm, rentForTerm } from "./listing.js";
import { addMonths, buildLease, leaseRulesFrom } from "./lease.js";

export const SAMPLE_TENANT_NAME = "[The tenant's name, from their verified ID]";

export async function sampleLeaseText(
  db: any,
  input: { terms: any; houseRules: unknown; landlordName: string; homeTitle: string; homeArea?: string | null; today: string },
): Promise<{ text: string; moveInDate: string; termMonths: number }> {
  const terms = input.terms;
  const termMonths = terms.minTermMonths;
  const upfront = Math.min(terms.upfrontMonths, termMonths);
  const quote = computeLongStayQuote({ monthlyRent: rentForTerm(terms, termMonths), termMonths, upfrontMonths: upfront, currency: terms.currency, rates: await currentLongStayRates(db) });
  const moveIn = terms.availableFrom > input.today ? terms.availableFrom : input.today;
  const rules = leaseRulesFrom(input.houseRules);
  const discount = discountForTerm(terms, termMonths);
  const text = buildLease({
    tenancyRef: "SAMPLE",
    tenantName: SAMPLE_TENANT_NAME,
    landlordName: input.landlordName,
    homeTitle: input.homeTitle,
    homeArea: input.homeArea || "",
    moveInDate: moveIn,
    endDate: addMonths(moveIn, termMonths),
    termMonths,
    upfrontMonths: upfront,
    currency: quote.currency,
    monthlyRent: quote.monthlyRent,
    firstMonthViaNolsaf: quote.monthlyRent,
    tenantFee: quote.tenantFee,
    balanceDue: quote.balanceDue,
    securityDepositMonths: terms.securityDepositMonths,
    noticePeriodDays: terms.noticePeriodDays,
    furnished: terms.furnished,
    utilities: terms.utilities,
    balanceMethods: terms.balanceMethods,
    petsAllowed: terms.residencyRules?.petsAllowed ?? null,
    maxOccupants: terms.residencyRules?.maxOccupants ?? null,
    ...(discount ? { listedRent: terms.monthlyRent, discountPercent: discount } : {}),
    ...(rules.length ? { houseRules: rules } : {}),
  });
  return { text, moveInDate: moveIn, termMonths };
}
