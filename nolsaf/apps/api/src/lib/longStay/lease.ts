/**
 * The NoLSAF standard lease (docs/LONG_STAY_RENTALS.md sections 3.3 step 4 and 6).
 *
 * Built only on the server, from the tenancy's frozen snapshot, so both sides
 * read the same words. Each side accepts the exact text by its SHA-256 hash:
 * if anything in the text changed, the old hash no longer matches and nobody
 * can accept a lease they did not see.
 *
 * LEGAL: this wording is a draft. A Tanzanian lawyer must review it before
 * long stays open (section 9). Bump LEASE_VERSION on every wording change.
 */
import { createHash } from "node:crypto";

export const LEASE_VERSION = "LS-2026.11c-draft";

export type LeaseInput = {
  tenancyRef: string;
  tenantName: string;
  landlordName: string;
  homeTitle: string;
  homeArea: string;
  moveInDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, the day the term ends
  termMonths: number;
  upfrontMonths: number;
  currency: string;
  monthlyRent: number;
  firstMonthViaNolsaf: number;
  tenantFee: number;
  balanceDue: number;
  securityDepositMonths: number;
  noticePeriodDays: number;
  furnished: string;
  utilities: Record<string, string>;
  balanceMethods: string[];
  petsAllowed: boolean | null;
  maxOccupants: number | null;
  /** Set only when the lease gets the listing's long-stay discount. */
  listedRent?: number;
  discountPercent?: number;
  /** The listing's own living rules, already in plain sentences (leaseRulesFrom). */
  houseRules?: string[];
};

/**
 * The listing's living rules as lease sentences. Only the common ones are
 * asked when listing (smoking, overnight visitors, quiet hours, anything
 * else); the standard rules of every NoLSAF lease are written in the lease.
 */
export function leaseRulesFrom(rules: any): string[] {
  if (!rules || typeof rules !== "object") return [];
  const out: string[] = [];
  const smoking = String(rules.smokingPolicy || "");
  if (smoking === "none") out.push("No smoking anywhere in the home or the compound.");
  else if (smoking === "outside") out.push("No smoking inside the home; smoking outside is allowed.");
  else if (smoking === "allowed") out.push("Smoking is allowed.");
  else if (rules.smoking === true) out.push("No smoking inside the home.");
  const guests = String(rules.overnightGuests || "");
  if (guests === "none") out.push("No overnight visitors.");
  else if (guests === "limited") out.push(`Overnight visitors up to ${Number(rules.overnightNights) || 7} nights a month in total, within the maximum number of occupants.`);
  else if (guests === "allowed") out.push("Overnight visitors are allowed, within the maximum number of occupants.");
  const quiet = String(rules.quietHours || "").trim();
  if (quiet) out.push(`Quiet hours: ${quiet.slice(0, 40)}.`);
  const other = String(rules.other || "").replace(/\s+/g, " ").trim();
  if (other) {
    const text = other.slice(0, 500);
    out.push(/[.!?]$/.test(text) ? text : `${text}.`);
  }
  return out;
}

const UTILITY: Record<string, string> = { water: "Water", electricity: "Electricity (LUKU)", internet: "Internet", security: "Security", serviceCharge: "Service charge" };
const FURNISHED: Record<string, string> = { FURNISHED: "furnished", SEMI: "semi-furnished", UNFURNISHED: "unfurnished" };

function money(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: currency === "TZS" ? 0 : 2, maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}

function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The company that operates NoLSAF, as published in the NoLSAF Terms and
 * Privacy Policy. Part of the lease text: bump LEASE_VERSION if it changes.
 */
export const LEASE_OPERATOR = {
  legalName: "NoLS Africa Company Limited",
  platform: "NoLSAF",
  website: "nolsaf.com",
  address: "Dar es Salaam, Tanzania",
  dataControllerRegistration: "0-000-011-671",
};

/**
 * Text layout read by the web lease document (lib/leaseDocument.ts):
 *   - the opening lines, up to the first blank line, are the title block;
 *   - a line in capitals is a part heading (PARTIES, AGREED TERMS...);
 *   - "1. Heading" is a clause, "1.1 Text" a sub-clause, "(a) Text" an item;
 *   - "(A) Text" is a recital; "Label<TAB>Value" is a row of the particulars.
 */
export function buildLease(input: LeaseInput): string {
  const m = (n: number) => money(n, input.currency);
  const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;
  const notice = `${input.noticePeriodDays} days`;
  const included = Object.entries(input.utilities).filter(([, v]) => v === "INCLUDED").map(([k]) => UTILITY[k] || k);
  const tenantPays = Object.entries(input.utilities).filter(([, v]) => v !== "INCLUDED").map(([k]) => UTILITY[k] || k);
  const methods = input.balanceMethods.map((x) => (x === "BANK" ? "bank transfer" : "mobile money")).join(" or ") || "bank transfer";
  const prepaidTotal = input.monthlyRent * input.upfrontMonths;
  const depositAmount = input.monthlyRent * input.securityDepositMonths;
  const home = `${input.homeTitle}${input.homeArea ? `, ${input.homeArea}` : ""}`;
  const rentLine = `${m(input.monthlyRent)} per month${input.discountPercent && input.listedRent ? ` (listed at ${m(input.listedRent)}, less ${input.discountPercent}% for a ${input.termMonths}-month term)` : ""}`;
  const op = LEASE_OPERATOR;

  const lines = [
    `THE UNITED REPUBLIC OF TANZANIA`,
    `RESIDENTIAL TENANCY AGREEMENT`,
    `NoLSAF Standard Lease for a Long Stay`,
    `Reference ${input.tenancyRef}. Version ${LEASE_VERSION}.`,
    ``,
    `THIS AGREEMENT is made on the date on which the second of the Parties accepts it electronically under clause 24 (the "Effective Date").`,
    ``,
    `PARTIES`,
    `(1) ${input.landlordName}, whose identity has been verified by ${op.platform} (the "Landlord"); and`,
    `(2) ${input.tenantName}, whose identity document has been verified by ${op.platform} (the "Tenant"),`,
    `each a "Party" and together the "Parties".`,
    ``,
    `BACKGROUND`,
    `(A) The Landlord is entitled to let the Premises described below and has listed them for a long stay on ${op.platform}, the online platform at ${op.website} operated by ${op.legalName}, a company incorporated in the United Republic of Tanzania with its office in ${op.address} ("${op.platform}").`,
    `(B) The Premises were inspected on site on behalf of ${op.platform} before they were offered to the Tenant.`,
    `(C) The Tenant reserved the Premises on ${op.platform} at the listed terms and the Landlord confirmed the reservation. The Parties now wish to record the terms on which the Landlord lets and the Tenant takes the Premises.`,
    ``,
    `PARTICULARS OF THE TENANCY`,
    `Premises\t${home}, let ${FURNISHED[input.furnished] || "as listed"}`,
    `Term\t${months(input.termMonths)}, from ${day(input.moveInDate)} to ${day(input.endDate)}`,
    `Rent\t${rentLine}`,
    `Prepaid rent\t${months(input.upfrontMonths)}, ${m(prepaidTotal)} in total`,
    `Paid through ${op.platform}\t${m(input.firstMonthViaNolsaf)} (first month) plus the ${op.platform} tenant service fee of ${m(input.tenantFee)}`,
    `Paid to the Landlord at move-in\t${input.upfrontMonths > 1 ? `${m(input.balanceDue)}, by ${methods}` : "Nothing further"}`,
    `Security deposit\t${input.securityDepositMonths ? `${months(input.securityDepositMonths)} of rent, ${m(depositAmount)}, held by the Landlord` : "None"}`,
    `Utilities included\t${included.length ? included.join(", ") : "None"}`,
    `Utilities paid by the Tenant\t${tenantPays.length ? tenantPays.join(", ") : "None"}`,
    `Maximum occupants\t${input.maxOccupants ? String(input.maxOccupants) : "As agreed between the Parties"}`,
    `Pets\t${input.petsAllowed == null ? "As agreed between the Parties" : input.petsAllowed ? "Allowed" : "Not allowed"}`,
    `Notice period\t${notice}`,
    ``,
    `AGREED TERMS`,
    ``,
    `1. Definitions and interpretation`,
    `1.1 In this Agreement: "App" means the ${op.platform} website and mobile applications; "Booking Payment" means the first month's rent and the tenant service fee paid through ${op.platform}; "Balance" means the prepaid rent payable to the Landlord at move-in; "Move-in Date" means ${day(input.moveInDate)}; "Premises" means the property described in the Particulars, with the fixtures, fittings and furniture listed or shown in the ${op.platform} listing on the Effective Date; "Term" means the period stated in the Particulars; "Business Day" means a day other than a Saturday, Sunday or public holiday in Tanzania.`,
    `1.2 The Particulars form part of this Agreement. If the Particulars and a clause differ, the clause prevails.`,
    `1.3 Headings are for convenience only. Words in the singular include the plural and the reverse. A reference to a law is to that law as amended or re-enacted from time to time.`,
    ``,
    `2. Grant of the tenancy`,
    `2.1 In consideration of the Rent and the Tenant's obligations in this Agreement, the Landlord lets the Premises to the Tenant for the Term, for use as a private residence only.`,
    `2.2 This Agreement creates the relationship of landlord and tenant between the Landlord and the Tenant only.`,
    ``,
    `3. The role of ${op.platform}`,
    `3.1 ${op.platform} is not a party to this Agreement and is not the agent of either Party. ${op.platform} provides the App, receives and holds the Booking Payment until move-in is confirmed under clause 7, pays the first month's rent to the Landlord less its commission, and keeps the records described in clause 15.`,
    `3.2 ${op.platform} does not receive, hold or guarantee the Balance or the security deposit, does not insure the tenancy, and does not carry out evictions.`,
    `3.3 The Landlord's commission and the Tenant's service fee are governed by the ${op.platform} Terms accepted by each Party, and are calculated on the whole Term.`,
    ``,
    `4. Term`,
    `4.1 The tenancy begins on ${day(input.moveInDate)} and ends on ${day(input.endDate)}, unless it is ended earlier or renewed under this Agreement.`,
    ``,
    `5. Rent and payment`,
    `5.1 The Rent is ${rentLine}.`,
    `5.2 The Tenant shall pay the Booking Payment of ${m(input.firstMonthViaNolsaf + input.tenantFee)} (being the first month's rent of ${m(input.firstMonthViaNolsaf)} and the service fee of ${m(input.tenantFee)}) through the App by card within 48 hours after both Parties have accepted this Agreement. If it is not paid in time, this Agreement lapses and neither Party has any further obligation under it.`,
    input.upfrontMonths > 1
      ? `5.3 On the Move-in Date, after the inspection in clause 7.1 and before the keys are handed over, the Tenant shall pay the Balance of ${m(input.balanceDue)} directly to the Landlord by ${methods}. Each Party shall record this payment in the App. The Tenant should not pay the Balance before inspecting the Premises.`
      : `5.3 No rent is payable at move-in in addition to the Booking Payment.`,
    input.termMonths > input.upfrontMonths
      ? `5.4 Rent for each month of the Term after the prepaid period shall be paid in advance on or before the first day of that month, by the method the Parties agree in writing, or through the App where ${op.platform} offers it.`
      : `5.4 The prepaid rent covers the whole Term.`,
    `5.5 ${op.platform} shall pay the first month's rent, less its commission, to the Landlord after move-in is confirmed under clause 7.3.`,
    ``,
    `6. Security deposit`,
    input.securityDepositMonths
      ? `6.1 The Tenant shall pay a security deposit of ${m(depositAmount)} to the Landlord on the Move-in Date. The deposit is held by the Landlord and never by ${op.platform}.`
      : `6.1 No security deposit is payable under this Agreement.`,
    input.securityDepositMonths
      ? `6.2 The Landlord shall return the deposit within 14 days after the Tenant gives up possession, less only the reasonable cost of repairing damage beyond fair wear and tear shown by the move-in and move-out condition records in the App. The Landlord shall give the Tenant a written account of every deduction.`
      : `6.2 Clause 6.1 does not limit the Tenant's liability for damage to the Premises.`,
    ``,
    `7. Move-in`,
    `7.1 On the Move-in Date the Parties shall walk through the Premises together and record their condition with photographs in the App.`,
    `7.2 The Landlord shall then receive the Balance under clause 5.3 and hand over all keys, access cards and codes.`,
    `7.3 Each Party shall confirm move-in in the App. If one Party confirms and the other neither confirms nor raises a dispute within 72 hours, move-in is treated as confirmed. A dispute raised in the App stops this period until it is resolved.`,
    `7.4 If the Premises are not available on the Move-in Date, are not the Premises listed, or do not match the listing in a material respect, the Tenant may refuse to take possession and is entitled to a full refund of the Booking Payment. If such a problem is found only after the Balance was paid and is reported in the App within 72 hours of move-in, ${op.platform} shall refund the Booking Payment and the Landlord shall repay the Balance to the Tenant within 14 days.`,
    ``,
    `8. Cancellation before move-in`,
    `8.1 If the Tenant cancels more than 14 days before the Move-in Date, the first month's rent is refunded to the Tenant and the service fee is not refunded.`,
    `8.2 If the Tenant cancels 14 days or less before the Move-in Date, or does not pay the Balance on the Move-in Date for a reason other than one in clause 7.4, the first month's rent, less 5% of that month, is paid to the Landlord, and the service fee is not refunded.`,
    `8.3 If the Landlord cancels, the Tenant is entitled to a full refund of the Booking Payment.`,
    ``,
    `9. The Landlord's obligations`,
    `9.1 The Landlord shall:`,
    `(a) give the Tenant vacant possession of the Premises on the Move-in Date, clean, safe and in the condition shown in the listing;`,
    `(b) allow the Tenant quiet enjoyment of the Premises for the Term without interruption by the Landlord or any person claiming through the Landlord;`,
    `(c) keep in repair the structure and exterior of the Premises, the roof, and the installations for water, drainage, electricity and gas, and repair or replace any item the Landlord supplied that fails through fair wear and tear;`,
    `(d) pay all land rent, property rates and taxes charged on the Premises, other than the utilities payable by the Tenant under the Particulars; and`,
    `(e) comply with every law that applies to the letting of the Premises.`,
    ``,
    `10. The Tenant's obligations`,
    `10.1 The Tenant shall:`,
    `(a) pay the Rent and the utilities stated in the Particulars as payable by the Tenant, on time;`,
    `(b) use the Premises as a private residence only, not exceed the maximum number of occupants, and keep pets only as the Particulars allow;`,
    `(c) keep the interior of the Premises clean and in good condition, carry out minor repairs (such as bulbs, taps and blocked drains) and report any other defect to the Landlord promptly;`,
    `(d) not cause a nuisance or annoyance to neighbours, and comply with the rules of any compound or building of which the Premises form part;`,
    `(e) not use the Premises for any illegal or immoral purpose; and`,
    `(f) at the end of the tenancy, return the Premises and all keys in the condition recorded at move-in, fair wear and tear excepted.`,
    `10.2 The Tenant shall not, without the Landlord's prior written consent:`,
    `(a) assign, sublet or part with possession of the Premises or any part of them, or let the Premises or any room by the night, on ${op.platform} or elsewhere;`,
    `(b) carry on a business at the Premises that brings customers or the public to them (working from home is allowed); or`,
    `(c) paint, drill, alter or add to the Premises or the Landlord's fixtures and furniture.`,
    ``,
    `11. Living rules`,
    `11.1 The Parties agree to the following rules for the Premises:`,
    ...(input.houseRules && input.houseRules.length
      ? input.houseRules.map((rule, i) => `(${String.fromCharCode(97 + i)}) ${rule}`)
      : [`(a) No rules in addition to this Agreement.`]),
    ``,
    `12. Access by the Landlord`,
    `12.1 The Landlord, or a person authorised by the Landlord, may enter the Premises at a reasonable time to inspect them or carry out repairs, after giving the Tenant at least 24 hours' notice, except in an emergency that threatens life or property.`,
    ``,
    `13. Ending the tenancy early`,
    `13.1 The Tenant may end the tenancy before the end of the Term by giving at least ${notice}' written notice in the App. The Landlord may keep rent up to the end of the notice period and shall refund any prepaid rent for the months after it within 14 days after the Tenant gives up possession.`,
    `13.2 The Landlord may end the tenancy before the end of the Term only on a ground permitted by law, by giving at least ${notice}' written notice in the App stating that ground, and shall refund all prepaid rent for the period after the Tenant gives up possession within 14 days.`,
    `13.3 If either Party commits a material breach of this Agreement and does not remedy it within 14 days after written notice from the other Party describing the breach, the other Party may end this Agreement by further written notice, subject to any notice or procedure the law requires.`,
    ``,
    `14. Renewal and holding over`,
    `14.1 The Tenant has the first right to renew the tenancy until ${notice} before the end of the prepaid period. A renewal is made through the App on the terms then listed or otherwise agreed.`,
    `14.2 If the Tenant remains in possession after the end of the Term without a renewal, that is a breach of this Agreement, and the Landlord's remedies under the law are reserved.`,
    ``,
    `15. Records and enforcement through ${op.platform}`,
    `15.1 This Agreement, the payment receipts, the move-in confirmations, notices, messages and condition photographs are kept by ${op.platform} and are available to both Parties as evidence.`,
    `15.2 The Landlord agrees that a refund the Landlord owes to the Tenant under this Agreement and confirmed by ${op.platform} may be deducted from any later payout ${op.platform} would otherwise make to the Landlord, and paid to the Tenant.`,
    `15.3 A Landlord who does not pay a confirmed refund within 14 days may be suspended from ${op.platform}. A Tenant who leaves without notice, holds over, or causes confirmed damage beyond the deposit may be barred from long stays on ${op.platform}.`,
    `15.4 Nothing in this clause limits either Party's rights against the other under this Agreement or the law.`,
    ``,
    `16. Personal data`,
    `16.1 ${op.legalName} is registered as a data controller with the Personal Data Protection Commission (Registration No. ${op.dataControllerRegistration}) and processes the Parties' personal data in accordance with the Personal Data Protection Act, 2022 and the ${op.platform} Privacy Policy.`,
    `16.2 Each Party's name and telephone number are shared with the other Party only after the Booking Payment is made. Each Party shall use the other's personal data only for this tenancy, keep it confidential, and not disclose it except as the law requires.`,
    ``,
    `17. Taxes, stamp duty and registration`,
    `17.1 The Landlord is responsible for any tax on the rental income from the Premises, including under the Income Tax Act.`,
    `17.2 Any stamp duty or registration fee payable on this Agreement shall be borne equally by the Parties unless the law provides otherwise. Either Party may present this Agreement for stamping or registration.`,
    ``,
    `18. Notices`,
    `18.1 A notice under this Agreement shall be in writing and given through the App. A notice is treated as received when it is recorded in the App, and the App's record of its time is conclusive unless shown to be wrong.`,
    ``,
    `19. Disputes`,
    `19.1 The Parties shall first try in good faith to settle any dispute arising out of this Agreement by negotiation, which may be done through the App.`,
    `19.2 Either Party may ask ${op.platform} to help the Parties reach a settlement. ${op.platform} acts only as a facilitator; its view does not bind either Party and does not affect its own decisions under clauses 7, 8 and 15.`,
    `19.3 A dispute not settled within 30 days may be referred by either Party to the District Land and Housing Tribunal or another court or tribunal of competent jurisdiction under the Land Disputes Courts Act.`,
    ``,
    `20. Governing law`,
    `20.1 This Agreement is governed by the laws of the United Republic of Tanzania, including the Land Act, the Law of Contract Act, the Electronic Transactions Act and the Personal Data Protection Act, 2022. The covenants implied into leases by the Land Act apply except where this Agreement lawfully provides otherwise.`,
    ``,
    `21. Entire agreement`,
    `21.1 This Agreement, with the listing and the ${op.platform} Terms it refers to, is the entire agreement between the Parties about the tenancy, and replaces any earlier understanding about it. A variation is valid only if it is in writing and accepted by both Parties, through the App or otherwise.`,
    ``,
    `22. Severability and waiver`,
    `22.1 If a provision of this Agreement is found invalid or unenforceable, the rest of this Agreement remains in force.`,
    `22.2 A delay or failure by a Party in exercising a right is not a waiver of that right.`,
    ``,
    `23. Costs`,
    `23.1 Each Party bears its own costs of preparing and accepting this Agreement, except as clause 17 provides.`,
    ``,
    `24. Electronic execution`,
    `24.1 Each Party signs this Agreement by accepting it in the App. The Parties agree that this acceptance is an electronic signature under the Electronic Transactions Act and binds them as a handwritten signature would.`,
    `24.2 ${op.platform} records who accepted this Agreement, when, and the SHA-256 fingerprint of this exact text. A copy whose fingerprint does not match is not this Agreement.`,
    ``,
    `EXECUTION`,
    `Signed electronically by the Landlord, ${input.landlordName}, and by the Tenant, ${input.tenantName}, by acceptance in the ${op.platform} App on the dates recorded against this reference.`,
  ];
  return lines.join("\n");
}

export function leaseHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Adds whole calendar months to a YYYY-MM-DD date (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(isoDay: string, months: number): string {
  const [y, mo, d] = isoDay.split("-").map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
