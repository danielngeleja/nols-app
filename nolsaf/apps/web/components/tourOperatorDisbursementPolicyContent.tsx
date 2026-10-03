"use client";

// Public Tour Operator Disbursement Policy. The numbers here must stay in step
// with api/src/lib/tourPayoutPolicy.ts (TOUR_PAYOUT_POLICY_VERSION); change
// both together.
import Link from "@/components/PolicyLink";
import { TermsSection } from "./Terms";

export const TOUR_OPERATOR_DISBURSEMENT_POLICY_LAST_UPDATED = "26 September 2026";

export const TOUR_OPERATOR_DISBURSEMENT_POLICY_SECTIONS: TermsSection[] = [
  {
    title: "1. Scope and principles",
    content: (
      <div className="space-y-4">
        <p>
          This policy explains when and how NoLSAF pays tour operators for tour packages booked through the NoLSAF platform. It applies to every tour operator account that receives bookings on NoLSAF, and it works alongside our <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link> and the tour section of our <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>.
        </p>
        <p>
          <strong>1.1 Travellers pay NoLSAF first.</strong> Every traveller payment is received by NoLSAF and held until the rules in this policy release it to the operator. Operators are never asked to collect money from travellers directly.
        </p>
        <p>
          <strong>1.2 Two payments per trip.</strong> An operator is paid in two parts: an <strong>advance before the trip</strong>, so park fees, lodges, vehicles and fuel can be paid on time, and the <strong>balance after the trip</strong>, once delivery is confirmed.
        </p>
        <p>
          <strong>1.3 Protecting both sides.</strong> The advance is sized so the traveller's refund rights are always covered, and the balance waits a short dispute window so travellers can raise a problem before the money is released. Within those limits, NoLSAF releases operator money as early as it safely can.
        </p>
        <p>
          <strong>1.4 Your operator agreement.</strong> This policy sets out how the Economic Flow and Settlement terms (section 19) of your signed NoLSAF operator agreement apply to tour packages, including releasing a payout in two stages. Where this policy and your signed agreement differ, your signed agreement prevails.
        </p>
      </div>
    ),
  },
  {
    title: "2. The operator's share",
    content: (
      <div className="space-y-4">
        <p>
          <strong>2.1 Net share.</strong> The operator's share of a booking is the amount the traveller paid, less the NoLSAF commission shown on the booking. Every advance and balance in this policy is a portion of that net share.
        </p>
        <p>
          <strong>2.2 Payout currency.</strong> Payouts are made in TZS or USD as set out in your operator agreement, subject to what your verified payout destination supports and to applicable foreign exchange rules.
        </p>
      </div>
    ),
  },
  {
    title: "3. Advance before the trip",
    content: (
      <div className="space-y-4">
        <p>
          <strong>3.1 When it opens.</strong> An advance can be requested from <strong>7 days before the trip's start date</strong>. It never opens in the first <strong>24 hours after the traveller paid</strong>, while the traveller can still cancel for a full refund.
        </p>
        <p>
          <strong>3.2 How much, 7 days to 96 hours before departure.</strong> Up to <strong>30% of the net share</strong> with no paperwork. The operator may request up to <strong>70%</strong> by attaching supplier receipts (park or conservation fees, lodge or camp deposits, vehicle hire and similar costs for that trip) that cover the amount above 30%.
        </p>
        <p>
          <strong>3.3 How much, inside the last 96 hours.</strong> From 96 hours before departure the traveller can no longer receive a standard refund, so up to <strong>70% of the net share</strong> can be requested with no receipts.
        </p>
        <p>
          <strong>3.4 Good standing.</strong> Advances are available to operators who (a) have reached <strong>Silver tier</strong> or above in the NoLSAF operator levels, (b) have a <strong>verified payout destination</strong> on their account, and (c) have <strong>no unpaid recovery</strong> from an earlier cancelled trip.
        </p>
        <p>
          <strong>3.5 One request at a time.</strong> An operator may have one advance request in progress per trip. Several advances may be taken on one trip, but together they never exceed 70% of the net share.
        </p>
        <p>
          <strong>3.6 Receipts.</strong> Receipts must be genuine, must relate to the trip the advance is requested for, and must be supplied as a secure link NoLSAF can open. NoLSAF finance checks them before verifying the advance. Submitting a false or reused receipt is a serious breach of this policy (see section 7).
        </p>
      </div>
    ),
  },
  {
    title: "4. Balance after the trip",
    content: (
      <div className="space-y-4">
        <p>
          <strong>4.1 Amount.</strong> The balance is the net share less every advance already paid for the trip.
        </p>
        <p>
          <strong>4.2 When it can be claimed.</strong> The balance can be claimed once the trip is completed. A trip is completed when the traveller confirms completion, or automatically <strong>48 hours after the later of</strong> (a) the operator finishing the trip timetable and (b) the end of the trip's last day, provided no case is open. Finishing a timetable early does not shorten this window. This trip-end rule applies to trips finished from 26 October 2026, after the 30-day notice your operator agreement requires; until then the window is 48 hours after the timetable is finished.
        </p>
        <p>
          <strong>4.3 Advances first.</strong> If an advance for the same trip is still being processed, the balance can be claimed once that advance is paid or declined.
        </p>
      </div>
    ),
  },
  {
    title: "5. How payments are processed",
    content: (
      <div className="space-y-4">
        <p>
          <strong>5.1 Stages.</strong> Every advance and balance moves through the same stages: <strong>Claimed</strong> by the operator, <strong>Verified</strong> by NoLSAF finance, <strong>Approved</strong> for release, and <strong>Disbursed</strong> to the operator's verified payout destination. The operator can follow each stage on the revenues page.
        </p>
        <p>
          <strong>5.2 Settlement cycle.</strong> A claim is processed within the Settlement Cycle in your operator agreement: <strong>24 hours to 3 days</strong> from the claim, subject to verification, fraud review and the checks in this policy. A claim that needs clarification is paused until the missing information is provided; NoLSAF will say what is needed.
        </p>
        <p>
          <strong>5.3 Verified destination only.</strong> Money is only sent to a payout destination whose account holder name has been verified with the payout provider. Changing the destination after a claim is approved stops that payment until it is checked again.
        </p>
        <p>
          <strong>5.4 Mobile money and bank.</strong> Mobile money destinations are paid automatically. Bank destinations are verified by name and paid manually by NoLSAF finance, which can take longer.
        </p>
      </div>
    ),
  },
  {
    title: "6. Cancellations and recovery",
    content: (
      <div className="space-y-4">
        <p>
          <strong>6.1 Traveller refunds come first.</strong> If a trip is cancelled after an advance was paid, the traveller is refunded under the Cancellation Policy without waiting for the operator. The advance then becomes a recovery owed by the operator.
        </p>
        <p>
          <strong>6.2 Recovery amount.</strong> When the traveller cancels, the recovery is the smaller of the money already paid to the operator and the refund given to the traveller. When the operator is responsible for the cancellation, the full amount paid is recovered.
        </p>
        <p>
          <strong>6.3 Money already spent on suppliers.</strong> Documented, non-recoverable supplier costs accepted by NoLSAF reduce the traveller's refund, and so reduce the recovery. Keep supplier receipts for every trip.
        </p>
        <p>
          <strong>6.4 Settling a recovery.</strong> A recovery is settled by repayment or deducted from the operator's next payouts. While a recovery is open, new advances are paused (section 3.4).
        </p>
        <p>
          <strong>6.5 Unpaid advances.</strong> An advance that has not yet been paid when a trip is cancelled is declined and is not paid.
        </p>
      </div>
    ),
  },
  {
    title: "7. Holds and withdrawal of advances",
    content: (
      <div className="space-y-4">
        <p>
          <strong>7.1 Open cases.</strong> While a traveller case (a change, issue, cancellation or refund request) is open on a trip, no new advance or balance is paid for that trip.
        </p>
        <p>
          <strong>7.2 Misuse.</strong> NoLSAF may decline an advance and withdraw access to advances for an operator who submits false receipts, validates a pickup without meeting the traveller, repeatedly fails to deliver booked services, or otherwise misuses this policy. Serious misuse may also lead to account suspension under the Terms of Service.
        </p>
      </div>
    ),
  },
  {
    title: "8. Changes to this policy",
    content: (
      <div className="space-y-4">
        <p>
          <strong>8.1 Version.</strong> This is version 2026-09-26. A claim is handled under the version in force when it was made.
        </p>
        <p>
          <strong>8.2 Notice.</strong> As your operator agreement requires, NoLSAF gives at least <strong>30 days&apos; written notice</strong> before a change to payout rules takes effect, and you may object within that period.
        </p>
        <p>
          <strong>8.3 Questions and disputes.</strong> Questions about a payment can be raised from the trip in the operator workspace or through NoLSAF support.
        </p>
      </div>
    ),
  },
];
