"use client";

import Link from "@/components/PolicyLink";
import { TermsSection } from "./Terms";

export const CANCELLATION_POLICY_LAST_UPDATED = "11 July 2026";

export const CANCELLATION_POLICY_SECTIONS: TermsSection[] = [
  {
    title: "1. General Overview",
    content: (
      <div className="space-y-4">
        <p>
          The Cancellation Policy for NoLSAF varies based on the type of service booked. Users are encouraged to review the specific cancellation terms provided at the time of booking to ensure understanding of applicable conditions. This policy applies to all reservations made through the NoLSAF platform, including individual bookings and group stays.
        </p>
        <p>
          <strong>1.1 Special Considerations:</strong> Group stays (bookings for multiple guests, multiple rooms, or special arrangements) are subject to additional cancellation terms as outlined in section 4 (Group Stay Cancellations). Users booking group stays should carefully review section 4 in addition to the general cancellation policy.
        </p>
        <p>
          By making a reservation through NoLSAF, Users acknowledge that they have read, understood, and agree to be bound by this Cancellation Policy. It is the User&apos;s responsibility to familiarize themselves with the cancellation terms specific to their booking before confirming their reservation, including any special terms applicable to group stays or other special arrangements.
        </p>
      </div>
    ),
  },
  {
    title: "2. Before Check-In",
    content: (
      <div className="space-y-4">
        <p>
          <strong>2.1 Free Cancellation Period</strong><br />
          Users may cancel their bookings free of charge within 24 hours of making the reservation, provided the cancellation occurs at least 72 hours before the scheduled check-in time. This grace period allows Users to reconsider their booking without financial penalty, subject to the 72-hour advance notice requirement.
        </p>
        <p>
          <strong>2.2 Partial Refunds</strong><br />
          Cancellations made after the free cancellation period, but at least 4 days (96 hours) before the scheduled check-in time, may be eligible for a 50% refund of the total amount paid. The refund will be processed to the original payment method within 5-10 business days after the cancellation is confirmed.
        </p>
        <p>
          <strong>2.3 Non-Refundable Bookings</strong><br />
          Some promotional rates, special offers, last-minute bookings, or properties with specific terms may be designated as non-refundable. This designation will be clearly indicated at the time of booking, and Users will be required to acknowledge this condition before completing their reservation. Non-refundable bookings are not eligible for any refund, regardless of cancellation timing or circumstances.
        </p>
        <p>
          <strong>2.4 Cancellation Process</strong><br />
          Cancellations must be initiated through the NoLSAF platform using the &quot;Cancel Booking&quot; feature in the User&apos;s account dashboard, or via email to <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a> (using the address provided in the booking confirmation). Users will receive an email confirmation of their cancellation request, which will include details regarding any applicable refunds, cancellation fees, and the timeline for processing refunds.
        </p>
      </div>
    ),
  },
  {
    title: "3. After Check-In",
    content: (
      <div className="space-y-4">
        <p>
          <strong>3.1 General Policy</strong><br />
          Cancellations after check-in are generally not eligible for refunds. Once a User has checked in to their booked accommodation, the booking is considered active, and no refunds will be offered for unused nights or services after the booking has commenced. This policy applies regardless of the reason for early departure, unless exceptional circumstances apply as outlined below. Users should understand that early departure does not automatically qualify for any refund, and all requests will be subject to strict evaluation.
        </p>
        <p>
          <strong>3.2 Exceptional Circumstances</strong><br />
          Refunds or modifications after check-in are extremely rare and will only be considered in cases of genuine, verifiable emergencies that are completely beyond the User&apos;s control and prevent the User from continuing their stay. NoLSAF maintains strict criteria for exceptional circumstances, and the burden of proof rests entirely with the User. All requests must meet the specific requirements outlined in the subsections below, and even if all requirements are met, NoLSAF reserves the absolute right to deny any refund request.
        </p>
        <p>
          <strong>3.2.1 Medical Emergencies</strong><br />
          Medical emergencies are defined as sudden, severe, and life-threatening conditions that require immediate hospitalization or emergency medical treatment, preventing the User from continuing their stay. This does not include pre-existing conditions, minor illnesses, or non-emergency medical situations.
        </p>
        <p>
          <strong>3.2.1.1 Requirements for Medical Emergency Claims:</strong>
        </p>
        <p>
          <strong>3.2.1.1.1</strong> The medical emergency must have occurred after check-in and must be documented by a licensed medical professional or hospital.
        </p>
        <p>
          <strong>3.2.1.1.2</strong> Users must provide official medical documentation from a recognized hospital or medical facility, including admission records, diagnosis, and confirmation that the condition prevented travel.
        </p>
        <p>
          <strong>3.2.1.1.3</strong> The documentation must clearly state that the User was physically unable to continue their stay due to the medical condition.
        </p>
        <p>
          <strong>3.2.1.1.4</strong> Medical certificates from private clinics or general practitioners may not be sufficient; hospital admission records are strongly preferred.
        </p>
        <p>
          <strong>3.2.1.1.5</strong> The request must be submitted within 48 hours of the medical emergency occurring, along with all supporting documentation.
        </p>
        <p>
          <strong>3.2.1.1.6</strong> NoLSAF may require additional verification, including contacting the medical facility directly.
        </p>
        <p>
          <strong>3.2.1.1.7</strong> Refunds, if approved, will be prorated only for unused nights after the documented medical emergency date, and may be subject to administrative fees.
        </p>
        <p>
          <strong>3.2.2 Death in the Family</strong><br />
          Death in the family refers to the death of an immediate family member (spouse, parent, child, or sibling) that requires the User to immediately leave their accommodation to attend to funeral arrangements or family matters.
        </p>
        <p>
          <strong>3.2.2.1 Requirements for Death in Family Claims:</strong>
        </p>
        <p>
          <strong>3.2.2.1.1</strong> Users must provide an official death certificate or obituary notice from a recognized authority.
        </p>
        <p>
          <strong>3.2.2.1.2</strong> The death must be of an immediate family member (spouse, parent, child, or sibling only; extended family members do not qualify).
        </p>
        <p>
          <strong>3.2.2.1.3</strong> The death must have occurred after check-in, or if it occurred before check-in, the User must provide proof that they were unaware of the death at the time of check-in.
        </p>
        <p>
          <strong>3.2.2.1.4</strong> Users must provide documentation showing their relationship to the deceased (birth certificate, marriage certificate, or other official documentation).
        </p>
        <p>
          <strong>3.2.2.1.5</strong> The request must be submitted within 72 hours of the death occurring, along with all supporting documentation.
        </p>
        <p>
          <strong>3.2.2.1.6</strong> NoLSAF reserves the right to verify the authenticity of all documents and may contact relevant authorities.
        </p>
        <p>
          <strong>3.2.2.1.7</strong> Refunds, if approved, will be prorated only for unused nights after the documented date of death, and may be subject to administrative fees.
        </p>
        <p>
          <strong>3.2.3 Natural Disasters and Acts of God</strong><br />
          Natural disasters include earthquakes, floods, hurricanes, volcanic eruptions, tsunamis, or other severe weather events that make the accommodation unsafe or inaccessible, or that prevent the User from traveling to or remaining at the accommodation.
        </p>
        <p>
          <strong>3.2.3.1 Requirements for Natural Disaster Claims:</strong>
        </p>
        <p>
          <strong>3.2.3.1.1</strong> The natural disaster must be officially declared by government authorities or recognized disaster management agencies.
        </p>
        <p>
          <strong>3.2.3.1.2</strong> Users must provide official documentation from government agencies, meteorological services, or emergency management authorities confirming the disaster.
        </p>
        <p>
          <strong>3.2.3.1.3</strong> The disaster must have occurred after check-in or must have made the accommodation physically unsafe or inaccessible.
        </p>
        <p>
          <strong>3.2.3.1.4</strong> General weather warnings or forecasts do not qualify; the disaster must be an actual, declared emergency.
        </p>
        <p>
          <strong>3.2.3.1.5</strong> Users must demonstrate that the disaster directly prevented them from continuing their stay, including but not limited to evacuation orders, road closures, or property damage.
        </p>
        <p>
          <strong>3.2.3.1.6</strong> The request must be submitted within 7 days of the disaster occurring, along with all supporting documentation.
        </p>
        <p>
          <strong>3.2.3.1.7</strong> NoLSAF may verify claims with local authorities and property owners.
        </p>
        <p>
          <strong>3.2.3.1.8</strong> Refunds, if approved, will be prorated only for unused nights after the documented disaster date, and may be subject to administrative fees.
        </p>
        <p>
          <strong>3.2.4 Government-Imposed Restrictions</strong><br />
          Government-imposed restrictions include travel bans, lockdowns, mandatory quarantines, or other official government orders that prevent the User from continuing their stay or require immediate departure.
        </p>
        <p>
          <strong>3.2.4.1 Requirements for Government Restriction Claims:</strong>
        </p>
        <p>
          <strong>3.2.4.1.1</strong> Users must provide official government documentation, orders, or announcements from recognized government authorities.
        </p>
        <p>
          <strong>3.2.4.1.2</strong> The restriction must be a mandatory order, not a recommendation or advisory.
        </p>
        <p>
          <strong>3.2.4.1.3</strong> The restriction must have been imposed after check-in, or if imposed before check-in, the User must provide proof that they were unaware of the restriction at the time of check-in.
        </p>
        <p>
          <strong>3.2.4.1.4</strong> Users must demonstrate that the restriction directly prevented them from continuing their stay.
        </p>
        <p>
          <strong>3.2.4.1.5</strong> The request must be submitted within 7 days of the restriction being imposed, along with all supporting documentation.
        </p>
        <p>
          <strong>3.2.4.1.6</strong> NoLSAF may verify claims with government authorities.
        </p>
        <p>
          <strong>3.2.4.1.7</strong> Refunds, if approved, will be prorated only for unused nights after the documented restriction date, and may be subject to administrative fees.
        </p>
        <p>
          <strong>3.2.5 Property-Related Emergencies</strong><br />
          Property-related emergencies include situations where the accommodation becomes uninhabitable due to fire, structural damage, severe pest infestation, or other conditions that make the property unsafe, provided these conditions were not caused by the User and were not disclosed at the time of booking.
        </p>
        <p>
          <strong>3.2.5.1 Requirements for Property Emergency Claims:</strong>
        </p>
        <p>
          <strong>3.2.5.1.1</strong> Users must provide documentation from property owners, property management, or relevant authorities confirming the property is uninhabitable.
        </p>
        <p>
          <strong>3.2.5.1.2</strong> The condition must have occurred after check-in and must make the property genuinely unsafe or uninhabitable.
        </p>
        <p>
          <strong>3.2.5.1.3</strong> Minor inconveniences, maintenance issues, or cosmetic problems do not qualify.
        </p>
        <p>
          <strong>3.2.5.1.4</strong> Users must have reported the issue to the property owner and NoLSAF immediately upon discovery.
        </p>
        <p>
          <strong>3.2.5.1.5</strong> Users must allow NoLSAF and property owners reasonable opportunity to address the issue before requesting a refund.
        </p>
        <p>
          <strong>3.2.5.1.6</strong> The request must be submitted within 24 hours of discovering the issue, along with all supporting documentation.
        </p>
        <p>
          <strong>3.2.5.1.7</strong> NoLSAF will investigate all claims and may require property inspections.
        </p>
        <p>
          <strong>3.2.5.1.8</strong> If alternative accommodation is offered and refused by the User, refund eligibility may be affected.
        </p>
        <p>
          <strong>3.2.6 General Requirements for All Exceptional Circumstance Claims</strong><br />
          Regardless of the specific category of exceptional circumstance, all requests must meet the following general requirements:
        </p>
        <p>
          <strong>3.2.6.1 Timeliness:</strong> All requests must be submitted within the specified timeframe for each category (ranging from 24 hours to 7 days). Late submissions will not be considered under any circumstances.
        </p>
        <p>
          <strong>3.2.6.2 Documentation:</strong> All claims must be supported by official, verifiable documentation from recognized authorities. Self-declarations, personal statements, or unverified documents will not be accepted.
        </p>
        <p>
          <strong>3.2.6.3 Authenticity:</strong> All documentation must be authentic and verifiable. NoLSAF reserves the right to verify all documents and may contact issuing authorities directly. Submission of fraudulent documentation will result in immediate denial and may result in account suspension or legal action.
        </p>
        <p>
          <strong>3.2.6.4 Completeness:</strong> Incomplete requests or requests missing required documentation will be automatically denied. Users must provide all required documentation in a single submission.
        </p>
        <p>
          <strong>3.2.6.5 Evaluation Period:</strong> All requests will be evaluated within 14-21 business days. NoLSAF may request additional documentation or clarification during this period, and Users must respond within 7 days or the request will be denied.
        </p>
        <p>
          <strong>3.2.6.6 No Guarantee of Approval:</strong> Meeting all requirements does not guarantee approval. NoLSAF reserves the absolute right to deny any request, even if all requirements are met, based on the specific circumstances and evaluation of the claim.
        </p>
        <p>
          <strong>3.2.6.7 Partial Refunds Only:</strong> If approved, refunds will be prorated only for unused nights after the documented incident date. No refunds will be provided for nights already used, and administrative fees may apply.
        </p>
        <p>
          <strong>3.2.6.8 Alternative Remedies:</strong> NoLSAF may offer alternative remedies such as credits for future bookings instead of refunds, at NoLSAF&apos;s sole discretion.
        </p>
        <p>
          <strong>3.2.6.9 One-Time Consideration:</strong> Each exceptional circumstance claim will be evaluated only once. If denied, the decision is final, and no appeals will be considered unless new, previously unavailable documentation is provided.
        </p>
        <p>
          <strong>3.2.6.10 No Retroactive Claims:</strong> Claims for incidents that occurred more than 30 days prior to the request submission will not be considered under any circumstances.
        </p>
        <p>
          <strong>3.2.7 Non-Qualifying Circumstances</strong><br />
          The following circumstances do NOT qualify as exceptional circumstances and will not be considered for refunds after check-in:
        </p>
        <p>
          <strong>3.2.7.1</strong> Change of plans, personal preferences, or dissatisfaction with the accommodation (unless related to undisclosed property issues).
        </p>
        <p>
          <strong>3.2.7.2</strong> Work-related emergencies, business obligations, or job requirements.
        </p>
        <p>
          <strong>3.2.7.3</strong> Family emergencies involving extended family members (beyond immediate family as defined in section 3.2.2).
        </p>
        <p>
          <strong>3.2.7.4</strong> Financial difficulties or inability to pay.
        </p>
        <p>
          <strong>3.2.7.5</strong> Transportation delays or cancellations (unless due to natural disasters or government restrictions as defined in sections 3.2.3 and 3.2.4).
        </p>
        <p>
          <strong>3.2.7.6</strong> Personal disputes with property owners or other guests.
        </p>
        <p>
          <strong>3.2.7.7</strong> Minor illnesses, discomfort, or non-emergency medical situations.
        </p>
        <p>
          <strong>3.2.7.8</strong> Weather conditions that are inconvenient but not declared disasters.
        </p>
        <p>
          <strong>3.2.7.9</strong> Pre-existing medical conditions or known health issues.
        </p>
        <p>
          <strong>3.2.7.10</strong> Personal or family events including weddings, celebrations, reunions, or other social gatherings.
        </p>
        <p>
          <strong>3.2.7.11</strong> Travel insurance claims (Users should file claims with their insurance provider).
        </p>
        <p>
          <strong>3.2.7.12</strong> Any circumstances that were known or should have been known to the User before check-in.
        </p>
        <p>
          <strong>3.2.8 Appeal Process</strong><br />
          If a request is denied, Users may submit one appeal within 14 days of the denial, but only if they can provide new, previously unavailable documentation that directly addresses the reason for denial. Appeals must include a clear explanation of why the new documentation should change the decision. NoLSAF&apos;s decision on appeals is final and binding. Multiple appeals for the same incident will not be considered.
        </p>
        <p>
          <strong>3.2.9 Property Owner Consultation and Analysis</strong><br />
          In certain exceptional circumstance cases, NoLSAF may consult with the property owner to analyze the specific circumstances and discuss the possibility of alternative arrangements or partial accommodations. This consultation process is at NoLSAF&apos;s sole discretion and does not guarantee any specific outcome.
        </p>
        <p>
          <strong>3.2.9.1 Consultation Process:</strong> When NoLSAF determines that consultation with the property owner may be beneficial, NoLSAF will review the User&apos;s claim, documentation, and circumstances with the property owner to assess the situation comprehensively.
        </p>
        <p>
          <strong>3.2.9.2 Property Owner Discretion:</strong> Property owners maintain the right to accept or decline any proposed alternative arrangements or accommodations. Property owners are not obligated to agree to any modifications, refunds, or alternative solutions proposed during the consultation process.
        </p>
        <p>
          <strong>3.2.9.3 Possible Outcomes:</strong> The consultation may result in various outcomes, including but not limited to: alternative accommodation arrangements, partial refunds, future booking credits, or no change to the original booking terms. The specific outcome will depend on the circumstances, property owner agreement, and NoLSAF&apos;s assessment.
        </p>
        <p>
          <strong>3.2.9.4 No Guarantee:</strong> The consultation process does not guarantee that any alternative arrangements will be offered, that property owners will agree to any proposals, or that Users will receive any refunds or accommodations beyond what is required by this Cancellation Policy.
        </p>
        <p>
          <strong>3.2.9.5 Timeline:</strong> The consultation process may extend the evaluation period for exceptional circumstance claims. Users will be notified if their claim is being reviewed through the consultation process, but NoLSAF is not obligated to provide detailed updates on the consultation discussions.
        </p>
        <p>
          <strong>3.2.9.6 Final Decision:</strong> Regardless of the consultation outcome, NoLSAF retains the final authority to make decisions regarding exceptional circumstance claims. The consultation process is a collaborative effort to explore possibilities, but the final determination remains with NoLSAF in accordance with this Cancellation Policy.
        </p>
      </div>
    ),
  },
  {
    title: "4. Group Stay Cancellations",
    content: (
      <div className="space-y-4">
        <p>
          <strong>4.1 General Policy for Group Stays</strong><br />
          Group stays are defined as bookings made for multiple guests, typically involving multiple rooms or accommodations, and may include special arrangements, group rates, or customized services. Cancellation policies for group stays differ from individual bookings due to the complexity and scale of these reservations. This section applies specifically to group stay bookings and supplements the general cancellation policy outlined in sections 2 and 3 above.
        </p>
        <p>
          <strong>4.2 Group Stay Cancellation Terms</strong><br />
          Group stay cancellations are subject to stricter terms than individual bookings due to the impact on property owners and the difficulty of rebooking multiple accommodations. The specific cancellation terms for each group stay booking will be clearly communicated at the time of booking and may vary based on the property, group size, booking dates, and special arrangements.
        </p>
        <p>
          <strong>4.2.1 Free Cancellation Period for Group Stays:</strong> Group stays may have a reduced or eliminated free cancellation period compared to individual bookings. The free cancellation period, if applicable, will be specified in the booking confirmation and may require cancellation 14 days or more before the scheduled check-in date.
        </p>
        <p>
          <strong>4.2.2 Partial Cancellations:</strong> Partial cancellations (reducing the number of rooms or guests) are subject to availability and property owner approval. Partial cancellations may result in rate adjustments, loss of group discounts, or additional fees. Users must contact NoLSAF customer support at <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a> or through the <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">support page</Link> to request partial cancellations.
        </p>
        <p>
          <strong>4.2.3 Refund Eligibility for Group Stays:</strong> Refunds for group stay cancellations are calculated based on the cancellation timeline and the specific terms agreed upon at booking. Generally, cancellations made more than 30 days before check-in may be eligible for partial refunds, while cancellations made within 30 days of check-in may be non-refundable or subject to significant penalties.
        </p>
        <p>
          <strong>4.2.4 Non-Refundable Deposits:</strong> Group stays often require non-refundable deposits that are separate from the general cancellation policy. These deposits are typically required to secure the booking and will not be refunded regardless of cancellation timing, unless otherwise specified in the booking agreement.
        </p>
        <p>
          <strong>4.3 Group Stay Modifications</strong><br />
          Modifications to group stay bookings, including changes to dates, number of guests, or accommodations, require advance notice and are subject to availability and property owner approval. Significant modifications may be treated as cancellations and rebookings, subject to the cancellation terms outlined in section 4.2 above.
        </p>
        <p>
          <strong>4.3.1 Date Changes:</strong> Date changes for group stays may be permitted if requested at least 60 days before the original check-in date, subject to property availability and owner approval. Date changes may incur additional fees or rate adjustments.
        </p>
        <p>
          <strong>4.3.2 Guest Count Changes:</strong> Reducing the number of guests may result in loss of group discounts, rate adjustments, or cancellation of unused accommodations. Increasing the number of guests is subject to property capacity and availability, and may require additional payments.
        </p>
        <p>
          <strong>4.3.3 Accommodation Changes:</strong> Changing the type or number of accommodations in a group stay booking may be treated as a cancellation and rebooking, subject to applicable cancellation terms and new booking rates.
        </p>
        <p>
          <strong>4.4 Group Stay Cancellation After Check-In</strong><br />
          The policies outlined in section 3 (After Check-In) apply to group stays, with additional considerations:
        </p>
        <p>
          <strong>4.4.1 Early Departure:</strong> If some members of a group depart early, no refunds will be provided for unused accommodations or nights, unless the entire group departs and exceptional circumstances apply as defined in section 3.2.
        </p>
        <p>
          <strong>4.4.2 Partial Group Departure:</strong> Individual members of a group may depart early without affecting the booking for remaining group members. No refunds will be provided for departing members&apos; unused accommodations.
        </p>
        <p>
          <strong>4.4.3 Exceptional Circumstances:</strong> The exceptional circumstances outlined in section 3.2 apply to group stays, but the burden of proof and documentation requirements may be more stringent due to the impact on multiple accommodations and the property owner.
        </p>
        <p>
          <strong>4.5 Group Stay No-Show Policy</strong><br />
          The no-show policy outlined in section 5 below applies to group stays. If the entire group fails to check in, the full booking amount will be charged with no refunds. If only some group members fail to check in, charges will apply to the no-show members&rsquo; accommodations only, while the remaining group members&lsquo; booking will proceed as scheduled.
        </p>
        <p>
          <strong>4.6 Group Stay Communication Requirements</strong><br />
          Due to the complexity of group stays, all cancellation and modification requests must be submitted in writing through the NoLSAF platform or via email to <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a>. Verbal requests will not be accepted for group stay cancellations or modifications. Users should allow additional processing time for group stay cancellation requests, as these require coordination with property owners and may take 5-7 business days to process.
        </p>
        <p>
          <strong>4.7 Group Stay Special Arrangements</strong><br />
          Group stays may include special arrangements such as catering, event spaces, transportation, or other services. Cancellation of these special arrangements is subject to separate terms and may be non-refundable regardless of accommodation cancellation status. Users should review the terms for each special arrangement at the time of booking.
        </p>
        <p>
          <strong>4.8 Coordination with Property Owners</strong><br />
          Group stay cancellations and modifications require coordination with property owners, as outlined in section 3.2.9 (Property Owner Consultation and Analysis). Property owners have significant discretion regarding group stay cancellations due to the impact on their operations and the difficulty of rebooking multiple accommodations on short notice.
        </p>
        <p>
          <strong>4.9 Group Stay Refund Processing</strong><br />
          Refunds for group stays, when applicable, will be processed according to the timeline outlined in section 7 (Refund Processing). However, group stay refunds may require additional processing time (up to 14 business days) due to the complexity of calculating refunds for multiple accommodations and coordinating with property owners.
        </p>
        <p>
          <strong>4.10 Group Stay Dispute Resolution</strong><br />
          Disputes regarding group stay cancellations follow the dispute resolution process outlined in section 10 (Dispute Resolution). However, group stay disputes may require additional documentation and coordination time due to the complexity of these bookings.
        </p>
      </div>
    ),
  },
  {
    title: "4A. Tour Package Cancellations and Refunds",
    content: (
      <div className="space-y-4">
        <p><strong>4A.1 Scope and Tour Commencement</strong><br />This section applies specifically to paid tour packages booked with a NoLSAF tour operator. Tour refunds are calculated from the Tour Booking amount paid and not from an accommodation invoice. A tour is considered commenced at the first verified pickup or meetup, admission using the tour voucher, or completion of the first itinerary activity, whichever occurs first.</p>
        <p><strong>4A.2 System-Initiated Request</strong><br />The Traveler has the right to initiate a cancellation through the Tour Package section of their NoLSAF account. Submission creates a dated cancellation case and immediate provisional eligibility calculation. Submission does not itself cancel the booking: the booking remains active until NoLSAF approves the request and confirms the final refund or other remedy.</p>
        <p><strong>4A.3 Cooling-Off Refund</strong><br />A Traveler who requests cancellation within 24 hours after booking, and at least 72 hours before tour commencement, is provisionally eligible for a 100% refund. Any component clearly disclosed and accepted as non-refundable before payment remains subject to NoLSAF review, except where the operator or NoLSAF caused the cancellation.</p>
        <p><strong>4A.4 Advance Partial Refund</strong><br />After the 24-hour cooling-off period, a cancellation submitted at least 96 hours before tour commencement is provisionally eligible for a 50% refund of the amount paid. The final refund may be reduced only by non-refundable components that were disclosed before payment and supported by verifiable supplier receipts, permits, tickets, deposits, or equivalent records.</p>
        <p><strong>4A.5 Late Cancellation, No-Show and Commenced Tours</strong><br />Voluntary cancellation less than 96 hours before commencement, failure to attend the confirmed pickup without notice, or cancellation after commencement is normally non-refundable. A Traveler may still submit evidence of an exceptional circumstance. If approved after commencement, only the recoverable value of unconsumed services may be refunded; completed activities, used services and documented non-recoverable costs are excluded.</p>
        <p><strong>4A.6 Exceptional Circumstances</strong><br />Strict review may be available for a sudden serious medical emergency, death of the Traveler or immediate family member, declared natural disaster, government restriction, destination closure, or serious operator failure. Evidence must normally be submitted within 48 hours of the event. Ordinary weather, change of mind, personal scheduling conflicts, minor illness, expired travel documents, avoidable missed transport, or ordinary visa refusal do not automatically qualify.</p>
        <p><strong>4A.7 Operator Cancellation or Material Failure</strong><br />If the operator cancels, cannot lawfully or safely provide the principal package, fails the confirmed pickup, or materially fails to deliver the booked tour, NoLSAF will first attempt a comparable replacement at no additional cost. If no suitable replacement is available or accepted for reasonable grounds, the Traveler is eligible for a full refund of undelivered services. No platform fee or operator cost will be deducted from an operator-caused full cancellation.</p>
        <p><strong>4A.8 Refund Calculation and Evidence</strong><br />NoLSAF will show the amount paid, policy percentage, consumed services, documented non-recoverable components, adjustments and final refund. Operators must provide evidence for every proposed deduction. Undocumented preparation costs may not reduce the refund. The provisional amount displayed when the request is submitted is not the final approved refund.</p>
        <p><strong>4A.9 Alternatives, Review and Payment</strong><br />NoLSAF may offer rescheduling, a comparable replacement or future travel credit. Unreasonably refusing a safe and materially equivalent remedy may affect eligibility. Approved monetary refunds are returned to the original payment method and currency, subject to the processing timelines in section 8. Open cancellation, refund or serious issue cases place the operator&apos;s final payout on hold.</p>
        <p><strong>4A.10 Policy Version</strong><br />The tour cancellation terms and version in effect when the Traveler books are stored with the Tour Booking and govern that booking. Package-specific stricter conditions apply only when clearly disclosed and affirmatively accepted before payment. This section does not limit statutory consumer rights.</p>
      </div>
    ),
  },
  {
    title: "5. No-Show Policy",
    content: (
      <div className="space-y-4">
        <p>
          <strong>5.1 Definition</strong><br />
          A &quot;No-Show&quot; occurs when a User fails to arrive at the booked accommodation on the scheduled check-in date without prior notification or cancellation. This includes situations where the User does not check in by the property&apos;s specified check-in deadline and has not communicated their delay or cancellation to NoLSAF or the property owner.
        </p>
        <p>
          <strong>5.2 Consequences</strong><br />
          Users who do not cancel their reservation and fail to show up for their booking will be charged the full amount of their booking. No refunds will be provided for no-show bookings, regardless of the reason for the absence. The property owner reserves the right to release the accommodation for other bookings after the no-show period has elapsed.
        </p>
        <p>
          <strong>5.3 Late Arrivals</strong><br />
          If a User anticipates arriving late but still intends to check in, they must contact the property owner or NoLSAF customer support in advance to arrange for late check-in. Failure to communicate may result in the booking being treated as a no-show.
        </p>
      </div>
    ),
  },
  {
    title: "6. Modification of Bookings",
    content: (
      <div className="space-y-4">
        <p>
          <strong>6.1 Changes to Reservations</strong><br />
          Users wishing to modify their bookings, including changing dates, number of guests, or accommodation type, must contact NoLSAF customer support through the platform&apos;s messaging system, email at <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a>, or the <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">dedicated support page</Link>. All modification requests are subject to availability at the property and may incur additional fees, price differences, or administrative charges. NoLSAF and property owners reserve the right to approve or deny modification requests based on availability and property policies. For group stays, refer to section 4.3 (Group Stay Modifications) for specific modification terms.
        </p>
        <p>
          <strong>6.2 Cancellation Required for Rescheduling</strong><br />
          If the requested modification affects the original booking significantly (such as changing dates that fall outside the property&apos;s availability window, or changing to a different property), a cancellation of the original reservation may be required, subject to the same cancellation terms and refund policies outlined in section 2 (Before Check-In) of this policy. For group stays, refer to section 4.3 (Group Stay Modifications). In such cases, Users will need to make a new booking, and the original booking will be processed according to the applicable cancellation policy.
        </p>
        <p>
          <strong>6.3 Modification Fees</strong><br />
          Some modifications may be subject to administrative fees or price adjustments. Users will be informed of any additional charges before modifications are confirmed. If a modification results in a lower total price, the difference will be refunded according to the refund policy outlined in section 8 (Refund Processing). If the modification results in a higher total price, the User will be required to pay the difference before the modification is finalized.
        </p>
      </div>
    ),
  },
  {
    title: "7. Communication",
    content: (
      <div className="space-y-4">
        <p>
          <strong>7.1 Notification of Cancellations</strong><br />
          Users will receive an email confirmation upon successful cancellation of their booking. This confirmation will outline any relevant refund details, cancellation fees (if applicable), the expected timeline for refund processing, and a cancellation reference number for tracking purposes. Users should retain this confirmation for their records.
        </p>
        <p>
          <strong>7.2 Customer Support</strong><br />
          For any questions, clarifications, or assistance regarding cancellations, modifications, or refunds, Users can contact NoLSAF customer support through the <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">dedicated support page</Link> on the platform, via email at <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a>, or through the in-platform messaging system. Our support team aims to respond to all inquiries within 24 hours during business days.
        </p>
        <p>
          <strong>7.3 Property Owner Communication</strong><br />
          In some cases, Users may need to communicate directly with property owners regarding cancellations or modifications. NoLSAF facilitates this communication through the platform&apos;s messaging system. However, all cancellation requests should be processed through NoLSAF&apos;s official channels to ensure proper documentation and refund processing.
        </p>
      </div>
    ),
  },
  {
    title: "8. Refund Processing",
    content: (
      <div className="space-y-4">
        <p>
          <strong>8.1 Refund Timeline</strong><br />
          Eligible refunds will be processed to the original payment method within 5-10 business days after the cancellation is confirmed. The actual time for funds to appear in the User&apos;s account may vary depending on the payment provider, including M-Pesa, Airtel Money, Mixx by Yas, or credit card issuers. Users should contact their payment provider if refunds are not received within the expected timeframe. For group stays, refer to section 4.9 (Group Stay Refund Processing) for extended processing timelines.
        </p>
        <p>
          <strong>8.2 Refund Amount</strong><br />
          Refund amounts will be calculated based on the cancellation policy applicable to the booking, minus any applicable cancellation fees, service charges, or non-refundable components. The refund confirmation email will provide a detailed breakdown of the refund calculation.
        </p>
        <p>
          <strong>8.3 Currency and Exchange Rates</strong><br />
          Refunds will be processed in the same currency as the original payment. If currency conversion occurred during the original transaction, the refund amount may be subject to the exchange rate at the time of refund processing, which may differ from the original booking exchange rate.
        </p>
      </div>
    ),
  },
  {
    title: "9. Property Owner Cancellations",
    content: (
      <div className="space-y-4">
        <p>
          <strong>9.1 Owner-Initiated Cancellations</strong><br />
          In rare circumstances, property owners may need to cancel a confirmed booking due to unforeseen circumstances, including property damage, maintenance issues, or double bookings. In such cases, NoLSAF will notify the User immediately and work to find alternative accommodation of similar or better quality at no additional cost to the User. If no suitable alternative is available, Users will receive a full refund of all amounts paid. For group stays, this process may require additional coordination as outlined in section 4.8 (Coordination with Property Owners).
        </p>
        <p>
          <strong>9.2 Compensation</strong><br />
          If a property owner cancels a booking, NoLSAF may provide additional compensation or assistance to affected Users, such as priority booking assistance, discounts on future bookings, or other remedies as deemed appropriate by NoLSAF.
        </p>
      </div>
    ),
  },
  {
    title: "10. Amendments to Cancellation Policy",
    content: (
      <div className="space-y-4">
        <p>
          <strong>10.1 Policy Changes</strong><br />
          NoLSAF reserves the right to amend this Cancellation Policy at any time to reflect changes in business practices, legal requirements, or industry standards. Significant changes to the policy will be communicated to Users via email or through notifications on the platform at least 21 days prior to the changes taking effect, allowing Users sufficient time to review and understand the updated terms.
        </p>
        <p>
          <strong>10.2 Applicability</strong><br />
          The version of the Cancellation Policy in effect at the time a booking is made will apply to that booking, regardless of any subsequent policy changes. Users are encouraged to review the current Cancellation Policy before making each new booking to ensure they understand the terms that will apply, including any special terms for group stays as outlined in section 4.
        </p>
        <p>
          <strong>10.3 Acceptance</strong><br />
          By continuing to use the NoLSAF platform and making bookings after policy changes take effect, Users acknowledge and agree to be bound by the updated Cancellation Policy. If Users do not agree with the updated policy, they should discontinue using the platform for new bookings.
        </p>
      </div>
    ),
  },
  {
    title: "11. Dispute Resolution",
    content: (
      <div className="space-y-4">
        <p>
          <strong>11.1 Resolution Process</strong><br />
          If Users have concerns or disputes regarding cancellations, refunds, or the application of this Cancellation Policy, they should first contact NoLSAF customer support at <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a> or through the <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">support page</Link> to seek resolution. Our support team will review the matter and work with Users to reach a fair resolution in accordance with this policy and applicable laws. For group stays, refer to section 4.10 (Group Stay Dispute Resolution) for additional information.
        </p>
        <p>
          <strong>11.2 Documentation</strong><br />
          Users should maintain records of all booking confirmations, cancellation requests, email communications, and payment receipts to facilitate dispute resolution. NoLSAF will also maintain records of all transactions and communications for reference.
        </p>
        <p>
          <strong>11.3 Legal Rights</strong><br />
          This Cancellation Policy does not affect Users&apos; statutory rights under applicable consumer protection laws. Users may have additional rights under local consumer protection legislation that cannot be limited by this policy. For more information about your legal rights, please refer to our <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link> or consult with a legal advisor.
        </p>
      </div>
    ),
  },
  {
    title: "12. Contact Information",
    content: (
      <div className="space-y-4">
        <p>
          For questions, concerns, or assistance regarding this Cancellation Policy, please contact NoLSAF:
        </p>
        <p>
          <strong>Email:</strong> <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a><br />
          <strong>Support Page:</strong> <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">Help Center</Link><br />
          <strong>Platform:</strong> Access customer support through your NoLSAF account dashboard
        </p>
        <p>
          Our customer support team is available to assist with cancellation requests, answer questions about refund eligibility, and provide guidance on the cancellation process.
        </p>
      </div>
    ),
  },
  {
    title: "13. Acknowledgment and Acceptance",
    content: (
      <div className="space-y-4">
        <p>
          By implementing this detailed Cancellation Policy, NoLSAF aims to provide clarity and transparency for Users regarding their options and responsibilities related to cancellations. Users are encouraged to familiarize themselves with these terms to ensure a satisfactory experience.
        </p>
        <p>
          By making a reservation through the NoLSAF platform, Users acknowledge that they have read, understood, and agree to be bound by this Cancellation Policy. Users further acknowledge that they have reviewed the specific cancellation terms applicable to their booking and understand the refund eligibility, cancellation fees, and modification procedures outlined in this policy.
        </p>
        <p>
          If Users have any questions or require clarification about any aspect of this Cancellation Policy before making a booking, they should contact NoLSAF customer support for assistance. NoLSAF is committed to providing clear, fair, and transparent cancellation terms to ensure a positive experience for all Users.
        </p>
      </div>
    ),
  },
];
