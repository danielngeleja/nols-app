"use client";

import Link from "@/components/PolicyLink";
import { TermsSection } from "./Terms";

export const PROPERTY_OWNER_DISBURSEMENT_POLICY_LAST_UPDATED = "7 October 2026";

export const PROPERTY_OWNER_DISBURSEMENT_POLICY_SECTIONS: TermsSection[] = [
  {
    title: "1. General Overview",
    content: (
      <div className="space-y-4">
        <p>
          This Disbursement Policy governs how NoLSAF processes and disburses payments to Property Owners for accommodation services rendered through the NoLSAF platform. This policy applies exclusively to Property Owners who are registered and active on the platform. All disbursements are processed digitally in accordance with NoLSAF's cashless payment principle, as outlined in section 1.3.4 of our <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>.
        </p>
        <p>
          <strong>1.1 Applicability</strong><br />
          This policy applies to all Property Owners who receive earnings, commissions, or payouts through the NoLSAF platform. By registering as a Property Owner and accepting payments through NoLSAF, you acknowledge that you have read, understood, and agree to be bound by this Disbursement Policy.
        </p>
        <p>
          <strong>1.2 Cashless Payment Principle</strong><br />
          NoLSAF operates on a cashless payment system. All payments from Users are processed digitally through NoLSAF's secure payment system, and all disbursements to Property Owners are made through digital payment methods only. Cash payments are not accepted for disbursements.
        </p>
        <p>
          <strong>1.3 Payment Flow</strong><br />
          As outlined in section 1.3.3 of our <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>, all payments made by Users are directed to NoLSAF accounts first. Subsequently, NoLSAF disburses the appropriate amounts to Property Owners in accordance with established agreements and payout schedules defined in this Disbursement Policy.
        </p>
        <p>
          <strong>1.4 Changes Effective 28 October 2026</strong><br />
          This version introduces the payout unlock time, withdrawal confirmed by a one-time code, automatic sending of eligible payouts, and automatic sending of unclaimed payouts after 14 days with a prior reminder (section 5), together with the related verification and hold rules in sections 3, 4 and 5.7. In line with section 12.1, these changes take effect on 28 October 2026, at least 21 days after Property Owners are notified. Until then, the previous payout claim process continues to apply.
        </p>
      </div>
    ),
  },
  {
    title: "2. Rights of Property Owners",
    content: (
      <div className="space-y-4">
        <p>
          <strong>2.1 Right to Timely Disbursement</strong><br />
          Property Owners and Drivers have the right to receive disbursements in accordance with the payout schedules outlined in this policy. NoLSAF is committed to processing disbursements within the specified timeframes, subject to the conditions and requirements set forth in this policy.
        </p>
        <p>
          <strong>2.2 Right to Transparent Accounting</strong><br />
          Property Owners and Drivers have the right to access detailed records of all transactions, earnings, deductions, and disbursements through their respective dashboards on the NoLSAF platform. This includes the right to view transaction history, pending payments, and payment schedules.
        </p>
        <p>
          <strong>2.3 Right to Dispute Resolution</strong><br />
          Property Owners and Drivers have the right to dispute any discrepancies in their earnings, deductions, or disbursements. Disputes must be submitted through the appropriate channels as outlined in section 11 (Dispute Resolution) of this policy.
        </p>
        <p>
          <strong>2.4 Right to Payment Method Selection</strong><br />
          Property Owners and Drivers have the right to select their preferred digital payment method for receiving disbursements, subject to availability and the payment methods supported by NoLSAF as outlined in section 4 (Payment Methods) of this policy.
        </p>
        <p>
          <strong>2.5 Right to Information</strong><br />
          Property Owners and Drivers have the right to receive clear information about payment schedules, fees, deductions, and any changes to the disbursement policy. NoLSAF will provide advance notice of any significant changes as outlined in section 12 (Amendments to Disbursement Policy).
        </p>
      </div>
    ),
  },
  {
    title: "3. Responsibilities of Property Owners",
    content: (
      <div className="space-y-4">
        <p>
          <strong>3.1 Account Information Accuracy</strong><br />
          Property Owners are responsible for maintaining accurate and up-to-date payment account information in their NoLSAF dashboard. This includes bank account details, mobile money numbers, or other payment method information required for disbursements.
        </p>
        <p>
          <strong>3.1.1 Verification Requirements:</strong> All payment account information must be verified before disbursements can be processed. Property Owners must provide valid, active payment accounts that match their registered identity on the platform.
        </p>
        <p>
          <strong>3.1.2 Update Obligations:</strong> Property Owners must promptly update their payment information if their account details change, are closed, or become invalid. Failure to maintain accurate payment information may result in delayed or failed disbursements.
        </p>
        <p>
          <strong>3.2 Tax and Legal Compliance</strong><br />
          Property Owners are solely responsible for complying with all applicable tax laws, regulations, and reporting requirements in their jurisdiction. NoLSAF may provide transaction records to assist with tax reporting, but Property Owners are responsible for calculating, reporting, and paying all applicable taxes on their earnings.
        </p>
        <p>
          <strong>3.2.1 Tax Documentation:</strong> Property Owners must provide accurate tax identification information when required by law or requested by NoLSAF. Failure to provide required tax information may result in withholding of disbursements until compliance is achieved.
        </p>
        <p>
          <strong>3.2.2 Record Keeping:</strong> Property Owners are responsible for maintaining their own records of earnings and disbursements for tax and accounting purposes. NoLSAF provides transaction history through the platform, but Property Owners should maintain independent records.
        </p>
        <p>
          <strong>3.3 Service Delivery Obligations</strong><br />
          Property Owners must fulfill their service delivery obligations as outlined in the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link> to be eligible for disbursements. A stay counts as delivered for payout purposes when the guest's booking code has been validated at check-in and the payout unlock time in section 5.1.2 has passed without a hold under section 5.7. Day-to-day matters between a guest and a Property Owner are settled between them; NoLSAF intervenes only through the formal cancellation, refund and dispute processes.
        </p>
        <p>
          <strong>3.3.1 Property Owner Responsibilities:</strong> Property Owners must provide accommodations as described in their listings, maintain property standards, and comply with all booking terms. Disbursements may be delayed or withheld if services are not delivered as agreed or if there are unresolved disputes with Users.
        </p>
        <p>
          <strong>3.4 Communication Responsibilities</strong><br />
          Property Owners are responsible for responding promptly to communications from NoLSAF regarding disbursements, account verification, or payment-related matters. Failure to respond may result in delayed disbursements.
        </p>
        <p>
          <strong>3.5 Platform Compliance</strong><br />
          Property Owners must comply with all NoLSAF platform policies, terms of service, and community guidelines to remain eligible for disbursements. Violations of platform policies may result in suspension of disbursements or account termination.
        </p>
      </div>
    ),
  },
  {
    title: "4. Payment Methods",
    content: (
      <div className="space-y-4">
        <p>
          <strong>4.1 Registration and Onboarding Requirements</strong><br />
          Property Owners are strongly advised and encouraged to provide all payment method information and complete verification during the initial registration and onboarding process when joining the NoLSAF platform. Completing payment method setup and verification during registration ensures timely disbursements once services begin and earnings are generated.
        </p>
        <p>
          <strong>4.1.1 Registration Payment Setup:</strong> During the registration process, Property Owners should provide their preferred payment method information, including all required account details, and initiate the verification process immediately upon account creation.
        </p>
        <p>
          <strong>4.1.2 Early Verification Benefits:</strong> Completing payment method verification during registration allows Property Owners to receive disbursements immediately upon earning their first payments, without delays associated with post-registration verification processes.
        </p>
        <p>
          <strong>4.1.3 Multiple Payment Methods:</strong> Property Owners may provide multiple payment method options during registration, though only one primary payment method will be active for disbursements at any given time. Having multiple verified payment methods provides flexibility and backup options.
        </p>
        <p>
          <strong>4.1.4 Registration Verification Process:</strong> The verification process during registration follows the same requirements outlined in section 4.4.1 (Verification Process), including OTP verification from NoLSAF and any additional verification steps required.
        </p>
        <p>
          <strong>4.1.5 Incomplete Registration Payment Setup:</strong> If payment method information is not provided or verified during registration, Property Owners must complete this process before they can receive any disbursements. Earnings will accumulate in their account until payment method verification is completed.
        </p>
        <p>
          <strong>4.2 Digital Payment Methods</strong><br />
          All disbursements to Property Owners are processed exclusively through digital payment methods. NoLSAF supports the following digital payment methods for disbursements:
        </p>
        <p>
          <strong>4.2.1 Mobile Money Services:</strong> M-Pesa, Airtel Money, Mixx by Yas, HaloPesa, and other supported mobile money platforms. Property Owners must provide valid, active mobile money numbers registered in their name.
        </p>
        <p>
          <strong>4.2.2 Bank Transfers:</strong> Direct bank transfers to verified bank accounts. Property Owners must provide accurate bank account details including account number, bank name, branch, and account holder name matching their registered identity.
        </p>
        <p>
          <strong>4.2.3 Other Methods:</strong> Other digital payout methods may be added in future. NoLSAF will announce them through the dashboard before they can be selected. Until then, only the methods listed in sections 4.2.1 and 4.2.2 that NoLSAF has enabled can receive disbursements.
        </p>
        <p>
          <strong>4.3 Payment Method Selection</strong><br />
          Property Owners must select and configure their preferred payment method through their NoLSAF dashboard. Only one primary payment method can be active at a time, though Property Owners may update their payment method as needed. Property Owners who completed payment method setup during registration can activate their verified payment method immediately.
        </p>
        <p>
          <strong>4.4 Verification Process:</strong> All payment methods must undergo verification before disbursements can be processed. Verification is mandatory and includes multiple security steps to ensure the security and accuracy of payment information. Property Owners who complete verification during registration will have their payment methods ready for immediate use once they begin earning.
        </p>
        <p>
          <strong>4.4.1 One-Time Password (OTP) Verification:</strong> NoLSAF requires OTP verification as part of the payment method verification process. Property Owners will receive a one-time password from NoLSAF via SMS or email to the registered contact information. This OTP must be entered within the specified time limit to complete the verification process. OTP verification is required both during registration and for any subsequent payment method changes.
        </p>
        <p>
          <strong>4.4.2 Additional Verification Methods:</strong> In addition to OTP verification, NoLSAF may require additional verification steps, including but not limited to:
        </p>
        <p>
          <strong>4.4.2.1</strong> Providing additional documentation such as bank statements, mobile money account statements, or proof of account ownership.
        </p>
        <p>
          <strong>4.4.2.2</strong> Completing identity verification to confirm that the payment account matches the registered Property Owner identity on the platform.
        </p>
        <p>
          <strong>4.4.2.3</strong> Verifying account details through test transactions or micro-deposits, where applicable and supported by the payment provider.
        </p>
        <p>
          <strong>4.4.2.4</strong> Providing additional contact information or emergency contact details for account recovery purposes.
        </p>
        <p>
          <strong>4.4.3 Verification Timeline:</strong> Verification processes may take 1-5 business days to complete, depending on the payment method selected and the completeness of documentation provided. Property Owners will be notified of verification status through their dashboard and via email. Verification completed during registration may be processed more quickly as part of the onboarding workflow.
        </p>
        <p>
          <strong>4.4.4 Verification Failure:</strong> If verification fails due to incorrect information, expired OTP, or incomplete documentation, Property Owners must restart the verification process. Multiple failed verification attempts may result in temporary restrictions on payment method changes or account activation.
        </p>
        <p>
          <strong>4.4.5 Verification Requirements:</strong> All verification requirements must be completed before any disbursements can be processed to the payment method. Unverified payment methods will not receive disbursements, and earnings will remain in the Property Owner's account until verification is completed. Property Owners are strongly advised to complete verification during registration to avoid delays in receiving their first disbursements.
        </p>
        <p>
          <strong>4.5 Payment Method Changes:</strong> Property Owners may change their payment method through their dashboard, but all changes must undergo the same verification process outlined in section 4.4 above, including OTP verification from NoLSAF.
        </p>
        <p>
          <strong>4.5.1 Change Verification Requirements:</strong> When changing a payment method, Property Owners must complete the full verification process, including OTP verification, before the new payment method can be activated for disbursements.
        </p>
        <p>
          <strong>4.5.2 Timing of Changes:</strong> Changes made during an active payout period may delay disbursements until verification is completed. Property Owners are advised to update payment methods well in advance of expected payout dates to avoid delays.
        </p>
        <p>
          <strong>4.5.3 Previous Payment Method:</strong> The previous payment method will remain active for pending disbursements until the new payment method is fully verified and activated. Once the new payment method is verified, all future disbursements will be processed to the new method.
        </p>
        <p>
          <strong>4.5.4 Security Measures:</strong> Payment method changes are subject to additional security measures, including OTP verification, to prevent unauthorized changes and protect Property Owner accounts.
        </p>
        <p>
          <strong>4.5.5 Account Holder Check:</strong> Every payout account is checked with the payment provider, which confirms the registered account holder name before the account can receive disbursements. The check is repeated before each payout is sent.
        </p>
        <p>
          <strong>4.5.6 New or Changed Accounts:</strong> For 72 hours after a payout account is added or changed, payouts to it wait until that period has passed. This protects Property Owners if someone else gains access to their account.
        </p>
        <p>
          <strong>4.5.7 Contact Changes:</strong> Withdrawals are paused for 72 hours after the phone number or email address on the Property Owner account is changed, because withdrawal codes are sent to those contacts.
        </p>
        <p>
          <strong>4.6 Payment Method Limitations</strong><br />
          Some payment methods may have limitations, including minimum disbursement amounts, maximum transaction limits, or geographic restrictions. Property Owners will be informed of any applicable limitations when selecting their payment method during registration or when updating payment methods.
        </p>
        <p>
          <strong>4.7 Failed Disbursements</strong><br />
          If a disbursement fails due to incorrect payment information, closed accounts, or other payment method issues, NoLSAF will attempt to notify the Property Owner. The Property Owner must update their payment information promptly and complete verification. Failed disbursements may incur additional processing fees as outlined in section 6 (Fees and Deductions).
        </p>
      </div>
    ),
  },
  {
    title: "5. Payout Schedules and Claims",
    content: (
      <div className="space-y-4">
        <p>
          <strong>5.1 On-Demand Payouts</strong><br />
          NoLSAF operates an on-demand payout system. Each stay's payout becomes ready to withdraw at a set unlock time, and the Property Owner withdraws it from My Payouts whenever they choose, subject to the rules in this section.
        </p>
        <p>
          <strong>5.1.1 Payout Eligibility:</strong> A payout becomes eligible once the guest's booking code has been validated at check-in. NoLSAF then creates the payout claim for the stay automatically; the Property Owner does not need to submit an invoice.
        </p>
        <p>
          <strong>5.1.1.1 Guest Confirmation:</strong> When a booking code is validated, NoLSAF sends the guest a message confirming the check-in, the property and the time, with NoLSAF's contact details. A guest who did not check in can contact NoLSAF before any payout is made.
        </p>
        <p>
          <strong>5.1.2 Payout Unlock Time:</strong> A payout becomes ready to withdraw:
        </p>
        <p>
          <strong>5.1.2.1</strong> where the guest paid by mobile money or bank transfer, 24 hours after the booking code is validated, and never earlier than 24 hours after the start of the booked check-in day (East Africa Time); or
        </p>
        <p>
          <strong>5.1.2.2</strong> where any part of the booking was paid by card, or the payment method was not recorded, 24 hours after the booked checkout time, because card payments can be disputed with the cardholder's bank after the stay.
        </p>
        <p>
          <strong>5.1.2.3</strong> The unlock time of each stay is shown in My Payouts. A payout also waits, without being on hold, until the guest's payment is confirmed by the payment provider and the Property Owner has a verified payout account (section 4).
        </p>
        <p>
          <strong>5.1.3 Withdrawal Confirmed by One-Time Code:</strong> To withdraw, the Property Owner selects Withdraw in My Payouts. NoLSAF then sends a one-time code by SMS to the verified phone number on the account, or to the verified email address if the SMS cannot be delivered. The message states the amount and the masked payout account. The code is valid for 5 minutes, can be used once, and works only for that withdrawal: if the payout account or any included payout changes before the code is entered, the code stops working and the Property Owner starts again. NoLSAF staff will never ask for this code.
        </p>
        <p>
          <strong>5.1.4 Automatic Sending:</strong> After a withdrawal is confirmed, eligible payouts are sent automatically to the verified payout account, normally within minutes. A payout is instead reviewed by NoLSAF before it is sent, normally within 24 hours, when it is the Property Owner's first payout, when NoLSAF's security checks flag it, or when it exceeds the limits NoLSAF sets for automatic payouts. Payouts beyond the daily limit for automatic payouts are sent on a following day.
        </p>
        <p>
          <strong>5.2 Unclaimed Payouts</strong><br />
          To prevent earnings from accumulating unpaid, NoLSAF sends payouts that are not withdrawn within a set period.
        </p>
        <p>
          <strong>5.2.1 Maximum Unclaimed Period:</strong> A payout that has been ready to withdraw for 14 days without being withdrawn is sent automatically to the Property Owner's verified payout account, unless the account was added or changed within the previous 72 hours.
        </p>
        <p>
          <strong>5.2.2 Reminder Before Automatic Sending:</strong> At least 48 hours before an unclaimed payout is sent, NoLSAF notifies the Property Owner in the dashboard and by SMS, stating the amount, the masked payout account and the date it will be sent. No unclaimed payout is sent without this reminder. The reminder never contains a code.
        </p>
        <p>
          <strong>5.2.3 Notification of Ready Payouts:</strong> NoLSAF shows each payout's status in My Payouts (unlocking, ready, on hold, sent) and notifies Property Owners as described in sections 5.2.2 and 5.4.5.
        </p>
        <p>
          <strong>5.3 Payout Agreements</strong><br />
          Property Owners may enter into specific payout agreements with NoLSAF that establish customized payout schedules, subject to the limitations outlined in this section.
        </p>
        <p>
          <strong>5.3.1 Daily Payout Agreements:</strong> Property Owners may request daily payout agreements, where eligible earnings are automatically disbursed on a daily basis. Daily payout agreements are subject to minimum threshold requirements and payment method limitations.
        </p>
        <p>
          <strong>5.3.2 Weekly Payout Agreements:</strong> Property Owners may request weekly payout agreements, where eligible earnings are automatically disbursed on a weekly basis. Weekly is the longest interval allowed: no payout agreement may leave eligible earnings unpaid for more than a week.
        </p>
        <p>
          <strong>5.3.3 Agreement Requirements:</strong> Payout agreements must be established in writing through the NoLSAF platform and are subject to approval by NoLSAF. Agreements may include specific terms regarding payout frequency, minimum thresholds, and processing times.
        </p>
        <p>
          <strong>5.3.4 Agreement Modifications:</strong> Property Owners may request modifications to their payout agreements, but changes are subject to approval and may require a verification period before taking effect. No payout agreement may set an interval longer than one week. Payout agreements never shorten the unlock time in section 5.1.2.
        </p>
        <p>
          <strong>5.4 Disbursement Processing Time</strong><br />
          Once a payout claim is initiated or an automatic disbursement is triggered, NoLSAF processes disbursements within specified timeframes.
        </p>
        <p>
          <strong>5.4.1 Standard Processing Time:</strong> Payouts sent automatically under section 5.1.4 are normally processed within minutes of the confirmed withdrawal. Payouts reviewed by NoLSAF are normally processed within 24 hours. The exact time depends on the payment method, verification status, the payment provider and system availability.
        </p>
        <p>
          <strong>5.4.2 Processing Time Factors:</strong> Processing times may vary based on: payment method selected (mobile money may be faster than bank transfers), account verification status, system maintenance, payment provider processing times, and business days versus weekends or holidays.
        </p>
        <p>
          <strong>5.4.3 Delayed Disbursements:</strong> If a disbursement is delayed beyond 24 hours after claim initiation or automatic trigger, Property Owners should contact NoLSAF support immediately. NoLSAF will investigate the delay and provide updates on the disbursement status.
        </p>
        <p>
          <strong>5.4.4 Support Contact for Delays:</strong> Property Owners experiencing disbursement delays beyond 24 hours should contact NoLSAF support at <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a> or through the <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">Help Center</Link>. Support team will investigate and resolve delays promptly.
        </p>
        <p>
          <strong>5.4.5 NoLSAF Notifications:</strong> NoLSAF will provide notifications to Property Owners in case of disbursement delays, system issues, or other circumstances that may affect payout processing. Notifications will be sent through the dashboard and via email.
        </p>
        <p>
          <strong>5.5 Minimum Payout Threshold</strong><br />
          NoLSAF may establish minimum payout thresholds to ensure efficient processing and reduce transaction costs. Earnings below the minimum threshold will accumulate in the Property Owner's account until the threshold is reached or until a payout claim is made, whichever comes first.
        </p>
        <p>
          <strong>5.5.1 Threshold Amounts:</strong> Minimum payout thresholds may vary by payment method and will be clearly communicated to Property Owners through their dashboard. Thresholds may be adjusted with advance notice as outlined in section 12 (Amendments to Disbursement Policy).
        </p>
        <p>
          <strong>5.5.2 Threshold Exceptions:</strong> Property Owners may be able to claim payouts below the minimum threshold in certain circumstances, such as account closure, termination of services, or special agreements with NoLSAF. Such exceptions are subject to approval and may incur additional processing fees.
        </p>
        <p>
          <strong>5.6 Payout Processing Time by Payment Method</strong><br />
          Once a disbursement is initiated, the time for funds to appear in the Property Owner's account depends on the payment method selected. Processing times may vary:
        </p>
        <p>
          <strong>5.6.1 Mobile Money:</strong> Typically 30 minutes to 3 business days after payout initiation, with most transactions processed within 24 hours.
        </p>
        <p>
          <strong>5.6.2 Bank Transfers:</strong> Typically 1-5 business days after payout initiation, depending on the bank and country.
        </p>
        <p>
          <strong>5.6.3 Other Methods:</strong> Processing times for methods added under section 4.2.3 will be announced when they are enabled.
        </p>
        <p>
          <strong>5.7 Payout Holds</strong><br />
          A payout is put on hold, and no money is sent while it is on hold, when:
        </p>
        <p>
          <strong>5.7.1</strong> a cancellation, refund or exceptional-circumstance request under the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link> is open, being processed or has been granted for the booking;
        </p>
        <p>
          <strong>5.7.2</strong> the guest appears to be the Property Owner (for example the same account, phone number or email address, or a guest phone number matching the payout account);
        </p>
        <p>
          <strong>5.7.3</strong> the booking is no longer in a checked-in or checked-out state, or the guest's payment currency does not match the payout currency.
        </p>
        <p>
          <strong>5.7.4</strong> The reason for a hold is shown in My Payouts. NoLSAF reviews held payouts and either releases them or applies the outcome of the relevant process, including the deductions in section 6.3. A cancelled booking or rejected claim cancels the payout.
        </p>
      </div>
    ),
  },
  {
    title: "6. Fees and Deductions",
    content: (
      <div className="space-y-4">
        <p>
          <strong>6.1 Commission and Service Fees</strong><br />
          NoLSAF charges commissions and service fees on bookings, which are deducted from gross earnings before disbursement. The commission structure and rates are established in the agreement between NoLSAF and each Property Owner during the registration process.
        </p>
        <p>
          <strong>6.1.1 Commission Agreement During Registration:</strong> During the registration process, NoLSAF and Property Owners will agree on the commission rates that will be added to the base price submitted by the Property Owner. This agreement establishes the pricing structure for listings, where the commission rate is incorporated into the final booking price paid by Users. Property Owners will receive disbursement of their base price under the circumstances and terms established in this agreement.
        </p>
        <p>
          <strong>6.1.2 Base Price Disbursement:</strong> Property Owners will receive disbursement of their agreed base price for completed bookings, subject to the terms and conditions outlined in this Disbursement Policy. The base price represents the amount agreed upon between NoLSAF and the Property Owner during registration, before the addition of commission rates. Disbursement of the base price is subject to: successful completion of the booking, verification of service delivery, resolution of any disputes, and compliance with all applicable policies.
        </p>
        <p>
          <strong>6.1.3 Commission Rates:</strong> Commission rates may vary based on property type, service category, volume, or special agreements established during registration. Property Owners can view their applicable commission rates through their dashboard. The commission rate agreed upon during registration will be applied consistently unless modified through mutual agreement or as outlined in section 12 (Amendments to Disbursement Policy).
        </p>
        <p>
          <strong>6.1.4 Transparent Deductions:</strong> All commission and service fee deductions are clearly itemized in transaction records and payout statements. Property Owners can view detailed breakdowns of all deductions, including base price disbursements and commission calculations, through their dashboard.
        </p>
        <p>
          <strong>6.2 Transaction and Processing Fees</strong><br />
          Property Owners may be subject to transaction fees or processing fees associated with disbursements, depending on the payment method selected. These fees are deducted from the disbursement amount.
        </p>
        <p>
          <strong>6.2.1 Payment Method Fees:</strong> Different payment methods may have different fee structures. Property Owners will be informed of applicable fees when selecting their payment method.
        </p>
        <p>
          <strong>6.2.2 Failed Transaction Fees:</strong> If a disbursement fails due to incorrect payment information provided by the Property Owner, additional fees may apply for reprocessing. Property Owners are responsible for ensuring accurate payment information.
        </p>
        <p>
          <strong>6.3 Refunds and Chargebacks</strong><br />
          This section applies exclusively to Property Owners. If a booking is cancelled, refunded, or subject to a chargeback in accordance with the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, the corresponding amount will be deducted from the Property Owner's earnings. The specific refund eligibility and deduction amounts are determined by the cancellation circumstances as outlined in the Cancellation Policy.
        </p>
        <p>
          <strong>6.3.1 Refund Eligibility Based on Cancellation Policy:</strong> The amount deducted from Property Owner earnings depends on the cancellation circumstances and timing, as defined in the Cancellation Policy:
        </p>
        <p>
          <strong>6.3.1.1 Free Cancellation Period Refunds:</strong> If a booking is cancelled within the free cancellation period as outlined in section 2.1 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link> (within 24 hours of booking and at least 72 hours before check-in), Property Owners will have the full booking amount deducted from their earnings, and no earnings will be retained for that booking.
        </p>
        <p>
          <strong>6.3.1.2 Partial Refund Deductions:</strong> If a booking is cancelled after the free cancellation period but at least 4 days before check-in, as outlined in section 2.2 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, Property Owners will have 50% of the booking amount deducted from their earnings, and 50% will be retained as earnings.
        </p>
        <p>
          <strong>6.3.1.3 Non-Refundable Bookings:</strong> If a booking is designated as non-refundable as outlined in section 2.3 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, and the booking is cancelled, Property Owners will retain the full earnings from that booking, and no refund will be processed to the User.
        </p>
        <p>
          <strong>6.3.1.4 Cancellations After Check-In:</strong> If a booking is cancelled after check-in, as outlined in section 3 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, Property Owners will generally retain their earnings, except in cases of exceptional circumstances as defined in section 3.2 of the Cancellation Policy, where refunds may be considered on a case-by-case basis.
        </p>
        <p>
          <strong>6.3.1.5 Exceptional Circumstance Refunds:</strong> If a refund is approved under exceptional circumstances as outlined in section 3.2 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, the refund amount will be deducted from Property Owner earnings. The specific amount deducted will be prorated based on unused nights after the documented incident date, as specified in the Cancellation Policy.
        </p>
        <p>
          <strong>6.3.1.6 No-Show Bookings:</strong> If a User fails to show up for their booking as outlined in section 5 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, Property Owners will retain the full earnings from that booking, and no refund will be processed.
        </p>
        <p>
          <strong>6.3.1.7 Group Stay Cancellations:</strong> For group stay cancellations, refund deductions will follow the terms outlined in section 4 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>. Property Owners should refer to section 4.2.3 (Refund Eligibility for Group Stays) for specific deduction amounts based on cancellation timing and group stay terms.
        </p>
        <p>
          <strong>6.3.1.8 Property Owner-Initiated Cancellations:</strong> If a Property Owner cancels a booking as outlined in section 9 of the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, the Property Owner will not receive earnings for that booking, and Users will receive a full refund. NoLSAF may provide alternative accommodations or compensation to affected Users at the Property Owner's expense.
        </p>
        <p>
          <strong>6.3.2 Deduction from Earnings:</strong> Refund amounts will be deducted from Property Owner earnings according to the refund eligibility determined by the Cancellation Policy. Deductions will be calculated based on the gross booking amount before commission deductions.
        </p>
        <p>
          <strong>6.3.2.1 Pending Earnings Deduction:</strong> If the refund amount exceeds pending (undisbursed) earnings, the deduction will be applied to pending earnings first, and any remaining amount will be deducted from future earnings or the Property Owner may be required to return funds as outlined in section 6.3.3 below.
        </p>
        <p>
          <strong>6.3.2.2 Commission Adjustments:</strong> When refunds are processed, NoLSAF will adjust commission calculations accordingly. Property Owners will receive detailed statements showing refund deductions and adjusted commission calculations.
        </p>
        <p>
          <strong>6.3.3 Already Disbursed Earnings:</strong> If earnings have already been disbursed to the Property Owner before a refund is processed, the refund amount may be handled as follows:
        </p>
        <p>
          <strong>6.3.3.1 Deduction from Future Earnings:</strong> The refund amount will be deducted from future earnings before disbursement. Property Owners will be notified of the deduction and can view the adjustment in their earnings statements.
        </p>
        <p>
          <strong>6.3.3.2 Return of Funds Requirement:</strong> If the refund amount is significant or if future earnings are insufficient to cover the refund, NoLSAF may require the Property Owner to return the funds. Property Owners will be notified of the requirement and provided with instructions for returning the funds.
        </p>
        <p>
          <strong>6.3.3.3 Payment Deadline:</strong> Property Owners required to return funds must do so within 7 business days of notification. Failure to return funds within the deadline may result in account suspension, withholding of future disbursements, or other actions as outlined in section 10.2 (Right to Withhold Disbursements).
        </p>
        <p>
          <strong>6.3.4 Chargebacks:</strong> If a booking is subject to a chargeback initiated by a User through their payment provider, the chargeback amount will be deducted from Property Owner earnings following the same principles as refund deductions. Property Owners will be notified of chargebacks and may be required to provide documentation to dispute the chargeback.
        </p>
        <p>
          <strong>6.3.4.1 Chargeback Dispute Process:</strong> Property Owners have the right to dispute chargebacks by providing evidence that services were delivered as agreed. NoLSAF will assist in the chargeback dispute process, but Property Owners are responsible for providing necessary documentation.
        </p>
        <p>
          <strong>6.3.4.2 Chargeback Fees:</strong> Chargeback fees imposed by payment providers may be deducted from Property Owner earnings in addition to the chargeback amount. Property Owners will be informed of any applicable chargeback fees.
        </p>
        <p>
          <strong>6.3.5 Refund and Chargeback Notifications:</strong> Property Owners will receive notifications through their dashboard and via email when refunds or chargebacks are processed, showing the deducted amounts and adjusted earnings. Property Owners should review these notifications promptly and contact support if they have questions or disputes.
        </p>
        <p>
          <strong>6.3.6 Disputing Refund Deductions:</strong> Property Owners who believe a refund deduction is incorrect may dispute the deduction through the dispute resolution process outlined in section 11 (Dispute Resolution) of this policy. Property Owners must provide evidence that the refund was processed incorrectly or that the cancellation circumstances do not warrant the refund amount deducted.
        </p>
        <p>
          <strong>6.4 Penalties and Fines</strong><br />
          Property Owners may be subject to penalties or fines for violations of platform policies, terms of service, or failure to deliver services as agreed. These penalties will be deducted from earnings before disbursement.
        </p>
        <p>
          <strong>6.5 Tax Withholding</strong><br />
          NoLSAF may be required by law to withhold taxes from disbursements in certain jurisdictions. If tax withholding is required, the withheld amount will be deducted from the disbursement, and Property Owners will receive appropriate tax documentation.
        </p>
      </div>
    ),
  },
  {
    title: "7. Bonuses and Discounts",
    content: (
      <div className="space-y-4">
        <p>
          <strong>7.1 General Overview</strong><br />
          NoLSAF may provide bonuses and discounts to Users and Property Owners through established programs and agreements. This section outlines how bonuses and discounts are issued, managed, and their impact on Property Owner earnings and disbursements.
        </p>
        <p>
          <strong>7.2 User Bonuses and Discounts</strong><br />
          NoLSAF may offer bonuses and discounts to Users to enhance their booking experience and promote platform engagement. These bonuses and discounts are provided in accordance with established promotional programs and terms.
        </p>
        <p>
          <strong>7.2.1 Established Bonus and Discount Programs:</strong> Users may receive bonuses and discounts through various established programs, including but not limited to: promotional campaigns, loyalty programs, referral bonuses, seasonal discounts, first-time booking discounts, and special event promotions. All bonus and discount programs are subject to specific terms and conditions that will be clearly communicated to Users.
        </p>
        <p>
          <strong>7.2.2 Application of User Bonuses and Discounts:</strong> When Users receive bonuses or discounts, these benefits are applied to the booking price at the time of payment. The discount or bonus amount reduces the total amount paid by the User, but does not affect the Property Owner's base price disbursement as agreed during registration, unless otherwise specified in the listing agreement.
        </p>
        <p>
          <strong>7.2.3 User Bonus and Discount Terms:</strong> All User bonuses and discounts are subject to terms and conditions, including expiration dates, usage limitations, eligibility requirements, and booking restrictions. Users must comply with these terms to receive and use bonuses or discounts.
        </p>
        <p>
          <strong>7.3 Property Owner Base Price Agreements</strong><br />
          During the listing process, NoLSAF will communicate with Property Owners to establish agreements regarding base prices and pricing structures that favor promotional opportunities and market competitiveness.
        </p>
        <p>
          <strong>7.3.1 Listing Price Agreement:</strong> At the time of listing a property, NoLSAF will communicate with the Property Owner to establish a certain agreement that favors the adjustment of the base price submitted by the Property Owner. This agreement allows NoLSAF to modify the base price to accommodate bonuses, discounts, promotional campaigns, and market conditions while ensuring Property Owners receive their agreed base price disbursement.
        </p>
        <p>
          <strong>7.3.2 Base Price Adjustments:</strong> The agreement established during listing may allow NoLSAF to adjust the displayed booking price (which includes the base price plus commission) to incorporate User bonuses and discounts. These adjustments are made to enhance booking attractiveness and market competitiveness while maintaining the Property Owner's base price disbursement rights.
        </p>
        <p>
          <strong>7.3.3 Agreement Terms:</strong> The specific terms of the base price agreement, including how bonuses and discounts affect pricing, will be clearly documented and agreed upon during the listing process. Property Owners will receive written confirmation of these terms and can access them through their dashboard.
        </p>
        <p>
          <strong>7.3.4 Property Owner Consent:</strong> Property Owners must provide explicit consent to the base price agreement and pricing adjustment terms during the listing process. By listing a property, Property Owners acknowledge and agree to the terms established in the listing agreement regarding base price adjustments for bonuses and discounts.
        </p>
        <p>
          <strong>7.4 Property Owner Bonuses</strong><br />
          NoLSAF reserves the right and maintains the discretion to provide bonuses to Property Owners based on certain established rules that are custom-based and not bound by legal requirements.
        </p>
        <p>
          <strong>7.4.1 NoLSAF's Discretionary Right:</strong> NoLSAF holds the right and favor to provide bonuses to Property Owners at its sole discretion. These bonuses are not guaranteed, are not legally required, and are provided based on custom-based rules and criteria established by NoLSAF.
        </p>
        <p>
          <strong>7.4.2 Custom-Based Bonus Rules:</strong> Property Owner bonuses are awarded based on custom-based rules and criteria established by NoLSAF, which may include but are not limited to: performance metrics, booking volume, customer satisfaction ratings, platform engagement, promotional participation, seasonal performance, and other factors determined by NoLSAF. These rules are not bound by legal requirements and may be modified at NoLSAF's discretion.
        </p>
        <p>
          <strong>7.4.3 Bonus Eligibility:</strong> Property Owner bonuses are not guaranteed and eligibility is determined solely by NoLSAF based on the custom-based rules in effect at the time. Property Owners do not have a legal right to receive bonuses, and NoLSAF may modify, suspend, or discontinue bonus programs at any time without notice.
        </p>
        <p>
          <strong>7.4.4 Bonus Types:</strong> Property Owner bonuses may take various forms, including but not limited to: performance bonuses, volume bonuses, quality bonuses, promotional bonuses, referral bonuses, and special achievement bonuses. The specific types and amounts of bonuses available will be determined by NoLSAF based on custom-based rules.
        </p>
        <p>
          <strong>7.4.5 Bonus Disbursement:</strong> Property Owner bonuses, when awarded, will be disbursed according to the payout schedules outlined in section 5 (Payout Schedules and Claims) of this policy. Bonuses are subject to the same verification, processing time, and disbursement terms as regular earnings, unless otherwise specified in the bonus program terms.
        </p>
        <p>
          <strong>7.4.6 Bonus Terms and Conditions:</strong> All Property Owner bonuses are subject to specific terms and conditions that will be communicated when bonuses are awarded. Property Owners must comply with these terms to receive and retain bonus payments. NoLSAF reserves the right to revoke or adjust bonuses if Property Owners fail to comply with bonus terms or platform policies.
        </p>
        <p>
          <strong>7.5 Impact on Earnings and Disbursements</strong><br />
          Bonuses and discounts may affect the calculation and disbursement of Property Owner earnings in specific ways.
        </p>
        <p>
          <strong>7.5.1 Base Price Protection:</strong> Property Owners will receive disbursement of their agreed base price for completed bookings, regardless of User bonuses or discounts applied to the booking. The base price disbursement is protected under the listing agreement established during registration, subject to the terms and conditions outlined in section 6.1.2 (Base Price Disbursement).
        </p>
        <p>
          <strong>7.5.2 Commission Calculation:</strong> Commission calculations are based on the gross booking amount (before User bonuses or discounts are applied) or as otherwise specified in the listing agreement. Commission rates agreed upon during registration are applied consistently, unless modified through mutual agreement.
        </p>
        <p>
          <strong>7.5.3 Bonus Earnings:</strong> Property Owner bonuses, when awarded, are separate from base price disbursements and commission earnings. Bonuses are added to Property Owner earnings and disbursed according to the payout schedules and terms outlined in this policy.
        </p>
        <p>
          <strong>7.5.4 Discount Absorption:</strong> When User discounts are applied to bookings, the discount amount is typically absorbed by NoLSAF and does not reduce the Property Owner's base price disbursement. However, specific terms may vary based on the listing agreement and promotional program terms.
        </p>
        <p>
          <strong>7.6 Modification and Termination of Bonus Programs</strong><br />
          NoLSAF reserves the right to modify, suspend, or terminate bonus and discount programs at any time.
        </p>
        <p>
          <strong>7.6.1 Program Modifications:</strong> NoLSAF may modify the terms, rules, eligibility criteria, or availability of bonus and discount programs at any time without prior notice. Property Owners and Users are encouraged to review program terms regularly through their dashboard or platform communications.
        </p>
        <p>
          <strong>7.6.2 Program Suspension or Termination:</strong> NoLSAF may suspend or terminate bonus and discount programs at any time for any reason, including but not limited to: business decisions, market conditions, policy changes, or operational requirements. Property Owners and Users have no legal right to continued participation in these programs.
        </p>
        <p>
          <strong>7.6.3 Grandfathered Terms:</strong> Property Owners who have existing listing agreements with specific bonus or discount terms may continue to benefit from those terms until the agreement expires or is modified through mutual consent, unless otherwise specified in the agreement.
        </p>
        <p>
          <strong>7.7 Communication and Transparency</strong><br />
          NoLSAF will communicate bonus and discount programs, terms, and changes to Property Owners and Users through established channels.
        </p>
        <p>
          <strong>7.7.1 Program Communication:</strong> Property Owners will be informed of available bonus programs, eligibility criteria, and program terms through their dashboard, email notifications, or other communication channels. Users will be informed of available discounts and bonuses through the platform interface, promotional communications, or booking confirmations.
        </p>
        <p>
          <strong>7.7.2 Earnings Statements:</strong> Property Owner earnings statements will clearly show base price disbursements, commission calculations, bonus earnings (when applicable), and any adjustments related to bonuses or discounts. Property Owners can access detailed breakdowns through their dashboard.
        </p>
        <p>
          <strong>7.7.3 Dispute Resolution:</strong> Disputes related to bonuses, discounts, or base price agreements should be submitted through the dispute resolution process outlined in section 11 (Dispute Resolution) of this policy. Property Owners must provide documentation of the listing agreement and any relevant bonus or discount terms when submitting disputes.
        </p>
      </div>
    ),
  },
  {
    title: "8. Earnings Calculation",
    content: (
      <div className="space-y-4">
        <p>
          <strong>8.1 Gross Earnings</strong><br />
          Gross earnings for Property Owners are calculated based on completed bookings rendered through the NoLSAF platform. Property Owner gross earnings are calculated as the total booking amount paid by Users, excluding any taxes, service charges, or fees that are separately collected or managed by the Property Owner outside the platform.
        </p>
        <p>
          <strong>8.2 Net Earnings</strong><br />
          Net earnings are calculated by subtracting all applicable deductions from gross earnings, including but not limited to: commissions, service fees, transaction fees, refunds, chargebacks, penalties, and tax withholdings.
        </p>
        <p>
          <strong>8.3 Earnings Statements</strong><br />
          Property Owners can access detailed earnings statements through their NoLSAF dashboard, showing gross earnings, all deductions, and net earnings for each transaction and payout period.
        </p>
        <p>
          <strong>8.4 Currency</strong><br />
          Earnings are calculated and disbursed in the local currency as specified in section 1.5 of the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>. Currency conversion, if applicable, will be processed at the exchange rate in effect at the time of disbursement.
        </p>
      </div>
    ),
  },
  {
    title: "9. Duties of Property Owners",
    content: (
      <div className="space-y-4">
        <p>
          <strong>9.1 Duty to Maintain Accurate Information</strong><br />
          Property Owners have a duty to maintain accurate, current, and complete information in their NoLSAF accounts, including payment information, contact details, and identification documents. This duty is ongoing and requires prompt updates when information changes.
        </p>
        <p>
          <strong>9.2 Duty to Deliver Services</strong><br />
          Property Owners have a duty to deliver services as agreed and described in bookings. This duty includes meeting quality standards, adhering to schedules, and fulfilling all service obligations as outlined in the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>.
        </p>
        <p>
          <strong>9.2.1 Property Owner Duties:</strong> Property Owners must provide accommodations that match their listings, maintain property standards, ensure guest safety, and comply with all booking terms and local regulations.
        </p>
        <p>
          <strong>9.3 Duty to Resolve Disputes</strong><br />
          Property Owners have a duty to cooperate in resolving disputes with Users or NoLSAF. This includes responding to dispute notifications, providing requested information, and participating in dispute resolution processes in good faith.
        </p>
        <p>
          <strong>9.4 Duty to Comply with Platform Policies</strong><br />
          Property Owners have a duty to comply with all NoLSAF platform policies, terms of service, community guidelines, and applicable laws and regulations. Non-compliance may result in suspension of disbursements or account termination.
        </p>
        <p>
          <strong>9.5 Duty to Report Issues</strong><br />
          Property Owners have a duty to promptly report any issues, errors, or discrepancies related to their earnings, disbursements, or account information to NoLSAF through the appropriate support channels.
        </p>
        <p>
          <strong>9.6 Duty to Maintain Service Standards</strong><br />
          Property Owners have a duty to maintain high service standards and professional conduct, as their performance directly impacts User satisfaction and the reputation of the NoLSAF platform.
        </p>
      </div>
    ),
  },
  {
    title: "10. NoLSAF's Rights and Responsibilities",
    content: (
      <div className="space-y-4">
        <p>
          <strong>10.1 Right to Verify and Audit</strong><br />
          NoLSAF reserves the right to verify, audit, and review all transactions, earnings calculations, and disbursements. This includes the right to request additional documentation, verify service delivery, and investigate any discrepancies or suspicious activity.
        </p>
        <p>
          <strong>10.2 Right to Withhold Disbursements</strong><br />
          NoLSAF reserves the right to withhold, delay, or suspend disbursements in cases of: pending disputes, suspected fraud or policy violations, incomplete account verification, tax compliance issues, or other circumstances that require investigation or resolution.
        </p>
        <p>
          <strong>10.3 Right to Deduct Amounts</strong><br />
          NoLSAF reserves the right to deduct amounts from earnings or future disbursements for: refunds, chargebacks, penalties, fees, tax withholdings, or amounts owed to NoLSAF or Users.
        </p>
        <p>
          <strong>10.4 Responsibility to Process Disbursements</strong><br />
          NoLSAF has a responsibility to process disbursements accurately and in accordance with the payout schedules and terms outlined in this policy, subject to the conditions and requirements set forth herein.
        </p>
        <p>
          <strong>10.5 Responsibility to Provide Transparency</strong><br />
          NoLSAF has a responsibility to provide Property Owners with transparent, accurate, and accessible information about their earnings, deductions, and disbursements through the platform dashboard.
        </p>
        <p>
          <strong>10.6 Responsibility to Secure Transactions</strong><br />
          NoLSAF has a responsibility to maintain secure payment processing systems and protect Property Owner financial information, as outlined in section 1.9.1(c) of the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>.
        </p>
      </div>
    ),
  },
  {
    title: "11. Dispute Resolution",
    content: (
      <div className="space-y-4">
        <p>
          <strong>11.1 General Overview</strong><br />
          This section outlines the dispute resolution process between Property Owners and NoLSAF, particularly regarding conflicts arising from cancellations, refunds, chargebacks, and other issues initiated by Users. Property Owners are required to cooperate fully with NoLSAF's established dispute resolution measures to ensure fair and timely resolution of all conflicts in accordance with the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>, <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>, <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link>, and other applicable NoLSAF policies.
        </p>
        <p>
          <strong>11.2 Scope of Disputes</strong><br />
          Disputes covered under this section include, but are not limited to:
        </p>
        <p>
          <strong>11.2.1 Cancellation-Related Disputes:</strong> Disputes arising from booking cancellations, including refund eligibility, refund amounts, deduction calculations, and application of cancellation terms as outlined in the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>.
        </p>
        <p>
          <strong>11.2.2 Refund Disputes:</strong> Disputes regarding refund processing, refund deductions from earnings, prorated refund calculations, and refund eligibility determinations made in accordance with the Cancellation Policy.
        </p>
        <p>
          <strong>11.2.3 Chargeback Disputes:</strong> Disputes related to chargebacks initiated by Users, chargeback deductions from earnings, chargeback fees, and chargeback dispute processes.
        </p>
        <p>
          <strong>11.2.4 Earnings and Deduction Disputes:</strong> Disputes regarding earnings calculations, commission deductions, fee assessments, and other financial adjustments related to cancellations, refunds, or chargebacks.
        </p>
        <p>
          <strong>11.2.5 Policy Interpretation Disputes:</strong> Disputes regarding the interpretation or application of the Cancellation Policy, Terms of Service, Privacy Policy, or other NoLSAF policies as they relate to cancellations, refunds, and Property Owner earnings.
        </p>
        <p>
          <strong>11.2.6 User-Initiated Conflicts:</strong> Disputes arising from User complaints, claims, or requests that result in refunds, chargebacks, or other financial adjustments affecting Property Owner earnings.
        </p>
        <p>
          <strong>11.3 Property Owner Cooperation Requirements</strong><br />
          Property Owners are required to cooperate fully with NoLSAF's established dispute resolution measures. This cooperation is essential for resolving conflicts fairly, efficiently, and in accordance with applicable policies.
        </p>
        <p>
          <strong>11.3.1 Mandatory Cooperation:</strong> Property Owners shall be answerable to and must cooperate with all established measures by NoLSAF that are intended to resolve any kinds of conflicts arising from the Cancellation Policy, Terms of Service, Privacy Policy, and other applicable NoLSAF policies. Failure to cooperate may result in delays in dispute resolution, withholding of disbursements, or other actions as outlined in section 10.2 (Right to Withhold Disbursements).
        </p>
        <p>
          <strong>11.3.2 Timely Response Requirements:</strong> Property Owners must respond to NoLSAF's requests for information, documentation, or clarification within the specified timeframes. Failure to respond within the required timeframe may result in the dispute being resolved based on available information, which may not be favorable to the Property Owner.
        </p>
        <p>
          <strong>11.3.3 Documentation Provision:</strong> Property Owners must provide all requested documentation, evidence, and information relevant to the dispute. This includes booking records, communication with Users, property records, service delivery confirmations, and any other materials requested by NoLSAF.
        </p>
        <p>
          <strong>11.3.4 Truthful Representation:</strong> Property Owners must provide accurate, truthful, and complete information during the dispute resolution process. Providing false, misleading, or incomplete information may result in immediate resolution of the dispute against the Property Owner and may constitute a violation of the Terms of Service.
        </p>
        <p>
          <strong>11.3.5 Participation in Resolution Measures:</strong> Property Owners must actively participate in all resolution measures established by NoLSAF, including but not limited to: mediation discussions, evidence review sessions, policy clarification meetings, and any other processes deemed necessary by NoLSAF to resolve the conflict.
        </p>
        <p>
          <strong>11.3.6 Compliance with Interim Measures:</strong> During the dispute resolution process, NoLSAF may implement interim measures such as temporarily withholding disbursements, placing holds on accounts, or requiring additional verification. Property Owners must comply with all such interim measures.
        </p>
        <p>
          <strong>11.4 Dispute Submission Process</strong><br />
          Property Owners who have concerns or disputes regarding cancellations, refunds, chargebacks, earnings deductions, or other issues must submit their dispute through the established channels.
        </p>
        <p>
          <strong>11.4.1 Submission Channels:</strong> Disputes must be submitted through the NoLSAF platform support system, by contacting NoLSAF at <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a>, or through the <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">Help Center</Link>. Disputes submitted through other channels may not be processed.
        </p>
        <p>
          <strong>11.4.2 Submission Timeframe:</strong> Disputes must be submitted within 30 days of the occurrence that gave rise to the dispute, or within 30 days of the Property Owner becoming aware of the issue, whichever is later. Disputes submitted after this timeframe may not be considered.
        </p>
        <p>
          <strong>11.4.3 Required Information:</strong> Property Owners must provide the following information when submitting a dispute: booking reference number, date of the incident, description of the dispute, specific policy sections in question, requested resolution, and all relevant documentation.
        </p>
        <p>
          <strong>11.5 Dispute Documentation Requirements</strong><br />
          Property Owners must provide comprehensive documentation to support their dispute claims.
        </p>
        <p>
          <strong>11.5.1 Required Documentation:</strong> Property Owners must provide detailed documentation supporting their dispute, including but not limited to: transaction records, booking confirmations, cancellation notices, refund notifications, communication records with Users, screenshots, emails, payment receipts, service delivery confirmations, and any other relevant evidence.
        </p>
        <p>
          <strong>11.5.2 Documentation Standards:</strong> All documentation must be clear, legible, complete, and directly relevant to the dispute. Documentation that is unclear, incomplete, or irrelevant may not be considered in the dispute resolution process.
        </p>
        <p>
          <strong>11.5.3 Additional Documentation Requests:</strong> NoLSAF may request additional documentation or information during the dispute review process. Property Owners must provide such documentation within the specified timeframe, typically within 7 business days of the request.
        </p>
        <p>
          <strong>11.5.4 Consequences of Incomplete Documentation:</strong> Disputes submitted without adequate supporting documentation, or where requested additional documentation is not provided, may be resolved based on available information, which may result in an unfavorable outcome for the Property Owner.
        </p>
        <p>
          <strong>11.6 Dispute Review Process</strong><br />
          NoLSAF will conduct a thorough review of all disputes in accordance with applicable policies and established procedures.
        </p>
        <p>
          <strong>11.6.1 Review Timeline:</strong> NoLSAF will review disputes within 14-21 business days of submission, provided all required documentation has been received. Complex disputes or disputes requiring additional investigation may take longer, and Property Owners will be notified of any delays.
        </p>
        <p>
          <strong>11.6.2 Policy Application:</strong> During the review process, NoLSAF will apply the relevant provisions of the Cancellation Policy, Terms of Service, Privacy Policy, and this Disbursement Policy to determine the appropriate resolution. NoLSAF's interpretation of these policies is final, subject to applicable legal rights.
        </p>
        <p>
          <strong>11.6.3 Investigation Process:</strong> NoLSAF may conduct investigations, contact Users, review booking records, examine communication logs, verify service delivery, and take any other actions necessary to resolve the dispute fairly and in accordance with applicable policies.
        </p>
        <p>
          <strong>11.6.4 Property Owner Participation:</strong> Property Owners may be required to participate in the review process by providing additional information, clarifying statements, or participating in discussions. Property Owners must respond promptly to all requests during the review process.
        </p>
        <p>
          <strong>11.6.5 Interim Communication:</strong> NoLSAF may provide updates on the dispute review process, request additional information, or seek clarification from Property Owners during the review period. Property Owners should monitor their communication channels for such requests.
        </p>
        <p>
          <strong>11.7 Dispute Resolution Outcomes</strong><br />
          Dispute resolutions will be determined based on the application of applicable policies and the evidence provided.
        </p>
        <p>
          <strong>11.7.1 Possible Outcomes:</strong> Dispute resolutions may result in: correction of earnings or disbursements, adjustment of deductions, reversal of charges, confirmation that the original calculation was correct, partial adjustments, or other resolutions deemed appropriate based on the circumstances and applicable policies.
        </p>
        <p>
          <strong>11.7.2 Policy-Based Decisions:</strong> All dispute resolutions will be based on the terms and conditions outlined in the Cancellation Policy, Terms of Service, Privacy Policy, and this Disbursement Policy. NoLSAF's decision will reflect the application of these policies to the specific circumstances of the dispute.
        </p>
        <p>
          <strong>11.7.3 Finality of Decisions:</strong> NoLSAF's decision on disputes is final, subject to applicable legal rights and the appeal process outlined in section 11.8 below. Property Owners must accept and comply with NoLSAF's dispute resolution decisions.
        </p>
        <p>
          <strong>11.7.4 Implementation of Resolutions:</strong> Once a dispute is resolved, NoLSAF will implement the resolution by adjusting earnings, processing refunds or reversals, updating disbursement schedules, or taking other actions as determined by the resolution. Property Owners will be notified of the resolution and any actions taken.
        </p>
        <p>
          <strong>11.7.5 Binding Nature:</strong> Property Owners agree that NoLSAF's dispute resolution decisions are binding and must be complied with. Failure to comply with a dispute resolution decision may result in account suspension, withholding of disbursements, or other actions as outlined in section 10.2 (Right to Withhold Disbursements).
        </p>
        <p>
          <strong>11.8 Appeal Process</strong><br />
          Property Owners who disagree with a dispute resolution may submit an appeal under specific conditions.
        </p>
        <p>
          <strong>11.8.1 Appeal Eligibility:</strong> Property Owners may submit one appeal within 14 days of receiving the dispute resolution decision. Appeals must be based on new evidence or information that was not previously considered, or on claims that NoLSAF's decision was not in accordance with applicable policies.
        </p>
        <p>
          <strong>11.8.2 Appeal Submission:</strong> Appeals must be submitted through the same channels as initial disputes, clearly marked as an appeal, and must include: the original dispute reference number, the reason for the appeal, new evidence or information (if applicable), and a detailed explanation of why the original decision should be reconsidered.
        </p>
        <p>
          <strong>11.8.3 Appeal Review:</strong> Appeals will be reviewed by a different NoLSAF representative or team than the original dispute. The appeal review will consider the new evidence or information, verify policy compliance, and make a final determination.
        </p>
        <p>
          <strong>11.8.4 Finality of Appeals:</strong> NoLSAF's decision on appeals is final and binding. No further appeals or reconsiderations will be available through NoLSAF's internal processes, though Property Owners retain any applicable legal rights.
        </p>
        <p>
          <strong>11.9 Resolution of User-Initiated Conflicts</strong><br />
          When conflicts arise from User complaints, cancellation requests, refund claims, or chargebacks, Property Owners must cooperate with NoLSAF's resolution process.
        </p>
        <p>
          <strong>11.9.1 User Complaint Resolution:</strong> When Users file complaints that may result in refunds, chargebacks, or other financial adjustments, Property Owners must cooperate with NoLSAF's investigation and resolution process. Property Owners must provide all requested information and documentation related to the User's complaint.
        </p>
        <p>
          <strong>11.9.2 Cancellation Request Handling:</strong> When Users request cancellations in accordance with the Cancellation Policy, Property Owners must comply with the cancellation terms and cooperate with NoLSAF's processing of refunds or adjustments as outlined in section 6.3 (Refunds and Chargebacks).
        </p>
        <p>
          <strong>11.9.3 Refund Claim Cooperation:</strong> When Users claim refunds under the Cancellation Policy, Property Owners must provide all necessary information and documentation to assist NoLSAF in determining refund eligibility. Property Owners must accept NoLSAF's determination of refund eligibility based on the Cancellation Policy.
        </p>
        <p>
          <strong>11.9.4 Chargeback Response:</strong> When chargebacks are initiated by Users, Property Owners must cooperate with NoLSAF's chargeback dispute process by providing evidence of service delivery, booking fulfillment, and any other documentation required to dispute the chargeback. Property Owners must respond promptly to all chargeback-related requests.
        </p>
        <p>
          <strong>11.9.5 Alternative Resolution Measures:</strong> In some cases, NoLSAF may propose alternative resolution measures such as partial refunds, future booking credits, or other accommodations to resolve User conflicts. Property Owners must consider and cooperate with such alternative measures when proposed by NoLSAF.
        </p>
        <p>
          <strong>11.10 Consequences of Non-Cooperation</strong><br />
          Property Owners who fail to cooperate with NoLSAF's dispute resolution measures may face consequences.
        </p>
        <p>
          <strong>11.10.1 Withholding of Disbursements:</strong> NoLSAF may withhold disbursements until Property Owners comply with cooperation requirements and participate fully in the dispute resolution process.
        </p>
        <p>
          <strong>11.10.2 Resolution Based on Available Information:</strong> If Property Owners fail to provide requested information or documentation, NoLSAF may resolve the dispute based solely on available information, which may result in an unfavorable outcome for the Property Owner.
        </p>
        <p>
          <strong>11.10.3 Account Actions:</strong> Persistent non-cooperation may result in account suspension, restrictions on platform access, or other actions as outlined in the Terms of Service and section 10.2 (Right to Withhold Disbursements) of this policy.
        </p>
        <p>
          <strong>11.10.4 Policy Violation:</strong> Failure to cooperate with dispute resolution measures may constitute a violation of the Terms of Service and this Disbursement Policy, which may result in penalties, fines, or termination of the platform relationship.
        </p>
      </div>
    ),
  },
  {
    title: "12. Amendments to Disbursement Policy",
    content: (
      <div className="space-y-4">
        <p>
          <strong>12.1 Policy Changes</strong><br />
          NoLSAF reserves the right to amend this Disbursement Policy at any time to reflect changes in business practices, legal requirements, payment processing capabilities, or industry standards. Significant changes will be communicated to Property Owners via email or through notifications on the platform at least 21 days prior to the changes taking effect.
        </p>
        <p>
          <strong>12.2 Applicability</strong><br />
          The version of the Disbursement Policy in effect at the time a service is rendered or a disbursement is processed will apply to that transaction. Property Owners are encouraged to review the current Disbursement Policy regularly.
        </p>
        <p>
          <strong>12.3 Acceptance</strong><br />
          By continuing to use the NoLSAF platform and receive disbursements after policy changes take effect, Property Owners acknowledge and agree to be bound by the updated Disbursement Policy. If Property Owners do not agree with the updated policy, they should discontinue using the platform for receiving payments.
        </p>
      </div>
    ),
  },
  {
    title: "13. Confidentiality",
    content: (
      <div className="space-y-4">
        <p>
          <strong>13.1 Information Protection</strong><br />
          NoLSAF is committed to maintaining the confidentiality of all financial information, payment details, earnings data, and account information related to Property Owners. All disbursement-related information is treated as confidential and is protected in accordance with our <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link>.
        </p>
        <p>
          <strong>13.2 Disclosure Limitations</strong><br />
          NoLSAF will not disclose Property Owner financial information, earnings, or disbursement details to third parties except as required by law, as necessary to process disbursements, or with explicit consent from the Property Owner.
        </p>
        <p>
          <strong>13.3 Data Security</strong><br />
          NoLSAF employs industry-standard security measures to protect all financial and payment information. Property Owners are responsible for maintaining the confidentiality of their account credentials and should not share their login information with unauthorized parties.
        </p>
        <p>
          <strong>13.4 Authorized Access</strong><br />
          Property Owners may access their own disbursement information through their secure dashboard. NoLSAF personnel with authorized access to disbursement information are bound by confidentiality obligations and may only access such information for legitimate business purposes.
        </p>
      </div>
    ),
  },
  {
    title: "14. Termination of Disbursement Policy",
    content: (
      <div className="space-y-4">
        <p>
          <strong>14.1 Policy Termination</strong><br />
          This Disbursement Policy remains in effect for as long as Property Owners are registered and active on the NoLSAF platform and receiving disbursements. The policy may be terminated or replaced by NoLSAF at any time, subject to the notice requirements outlined in section 12 (Amendments to Disbursement Policy).
        </p>
        <p>
          <strong>14.2 Property Owner Account Termination</strong><br />
          For Property Owners, the following circumstances will be considered as termination of this Disbursement Policy:
        </p>
        <p>
          <strong>14.2.1 Account Deletion:</strong> If a Property Owner deletes their account, this Disbursement Policy will be terminated for that Property Owner. Outstanding earnings will be processed in accordance with the terms in effect at the time of account deletion, subject to any holds, disputes, or obligations that may delay or prevent disbursement.
        </p>
        <p>
          <strong>14.2.2 Property De-listing Agreement:</strong> If a Property Owner submits an established agreement to de-list their properties from the platform, this Disbursement Policy will be terminated for that Property Owner. NoLSAF will process final disbursements for any outstanding earnings related to completed bookings, subject to verification and compliance with all applicable policies.
        </p>
        <p>
          <strong>14.2.3 Account Deactivation:</strong> If a Property Owner's account is deactivated, whether by the Property Owner or by NoLSAF, this Disbursement Policy will be terminated. Outstanding earnings will be processed in accordance with the terms in effect at the time of deactivation, subject to any holds, disputes, or obligations.
        </p>
        <p>
          <strong>14.2.4 Policy Violations and Fraud Assessment:</strong> If a Property Owner violates NoLSAF Policies in a manner that requires NoLSAF to conduct an assessment and determines that there is untrustworthiness related to fraud, unlawful actions, or other serious violations, NoLSAF will assess the relationship with the Property Owner to determine eligibility as established. Based on this assessment, NoLSAF may terminate this Disbursement Policy and the Property Owner's access to the platform. In such cases, disbursements may be withheld pending investigation, and final disbursements will be processed only if the Property Owner is found eligible after the assessment.
        </p>
        <p>
          <strong>14.2.5 Eligibility Assessment:</strong> When NoLSAF conducts an assessment of a Property Owner's relationship and eligibility due to policy violations, fraud, or unlawful actions, the assessment will consider: the nature and severity of the violation, evidence of fraud or unlawful conduct, impact on Users or the platform, the Property Owner's history and cooperation, and any mitigating or aggravating factors. The outcome of this assessment will determine whether the Disbursement Policy continues to apply, is terminated, or is subject to modified terms.
        </p>
        <p>
          <strong>14.3 Outstanding Obligations</strong><br />
          Termination of this policy or a Property Owner's account does not relieve either party of outstanding obligations, including but not limited to: pending disbursements, refund obligations, chargeback responsibilities, or amounts owed to NoLSAF or Users.
        </p>
        <p>
          <strong>14.4 Final Disbursements</strong><br />
          Upon account termination, deletion, deactivation, or policy termination, NoLSAF will process final disbursements for any outstanding earnings, subject to verification, dispute resolution, compliance with all applicable policies, and completion of any required assessments. Property Owners must ensure their payment information remains valid and verified to receive final disbursements.
        </p>
      </div>
    ),
  },
  {
    title: "15. Contact Information",
    content: (
      <div className="space-y-4">
        <p>
          For questions, concerns, or assistance regarding this Disbursement Policy, earnings, or disbursements, Property Owners can contact NoLSAF:
        </p>
        <p>
          <strong>Email:</strong> <a href="mailto:info@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">info@nolsaf.com</a><br />
          <strong>Support Page:</strong> <Link href="/help" className="text-blue-600 hover:text-blue-800 underline">Help Center</Link><br />
          <strong>Platform:</strong> Access customer support through your Property Owner dashboard
        </p>
        <p>
          Our support team is available to assist with disbursement inquiries, payment method setup, earnings questions, and dispute resolution.
        </p>
      </div>
    ),
  },
  {
    title: "16. Glossary of Terms",
    content: (
      <div className="space-y-4">
        <p>
          This glossary defines key terms used throughout this Disbursement Policy to improve understanding and accessibility.
        </p>
        <p>
          <strong>Base Price:</strong> The agreed-upon price submitted by a Property Owner for their property listing, before the addition of commission rates. Property Owners receive disbursement of their base price for completed bookings, as established in the listing agreement during registration.
        </p>
        <p>
          <strong>Booking:</strong> A reservation made by a User for accommodation or services through the NoLSAF platform. A booking becomes active upon confirmation and payment.
        </p>
        <p>
          <strong>Bonus:</strong> Additional earnings or rewards provided to Property Owners or Drivers by NoLSAF at its discretion, based on custom-based rules and criteria. Bonuses are not guaranteed and are separate from base price disbursements and commission earnings.
        </p>
        <p>
          <strong>Chargeback:</strong> A reversal of a payment initiated by a User through their payment provider, typically due to a dispute or claim. Chargeback amounts are deducted from Property Owner earnings.
        </p>
        <p>
          <strong>Commission:</strong> A fee charged by NoLSAF on bookings and services, which is deducted from gross earnings before disbursement. Commission rates are agreed upon between NoLSAF and Property Owners or Drivers during registration.
        </p>
        <p>
          <strong>Disbursement:</strong> The process of transferring earnings from NoLSAF to Property Owners through digital payment methods. Disbursements are processed according to payout schedules and terms outlined in this policy.
        </p>
        <p>
          <strong>Discount:</strong> A reduction in the booking price offered to Users through promotional programs. Discounts are typically absorbed by NoLSAF and do not reduce Property Owner base price disbursements, unless otherwise specified in the listing agreement.
        </p>
        <p>
          <strong>Earnings:</strong> The amount of money earned by Property Owners for services rendered through the NoLSAF platform. Earnings include gross earnings (before deductions) and net earnings (after deductions).
        </p>
        <p>
          <strong>Exceptional Circumstances:</strong> Rare, verifiable emergencies that may qualify for refunds after check-in, as defined in section 3.2 of the Cancellation Policy. These include medical emergencies, death in the family, natural disasters, and government-imposed restrictions.
        </p>
        <p>
          <strong>Gross Earnings:</strong> The total amount earned by Property Owners from completed bookings, before any deductions for commissions, fees, refunds, or other adjustments.
        </p>
        <p>
          <strong>Listing Agreement:</strong> The agreement established between NoLSAF and a Property Owner during the listing process, which includes base price, commission rates, and terms for pricing adjustments to accommodate bonuses and discounts.
        </p>
        <p>
          <strong>Mobile Money:</strong> Digital payment services such as M-Pesa, Airtel Money, Mixx by Yas, and HaloPesa that allow money transfers through mobile devices. Mobile money is one of the supported digital payment methods for disbursements.
        </p>
        <p>
          <strong>Net Earnings:</strong> The amount remaining after all deductions (commissions, fees, refunds, chargebacks, penalties, tax withholdings) are subtracted from gross earnings. Net earnings represent the actual amount disbursed to Property Owners.
        </p>
        <p>
          <strong>No-Show:</strong> A situation where a User fails to arrive at a booked accommodation or service without prior cancellation or notification, as defined in section 5 of the Cancellation Policy. No-show bookings result in full charges with no refunds.
        </p>
        <p>
          <strong>NoLSAF:</strong> The platform and service provider that facilitates bookings, payments, and disbursements between Users, Property Owners, and Drivers.
        </p>
        <p>
          <strong>OTP (One-Time Password):</strong> A temporary security code sent by NoLSAF via SMS or email to verify payment method information and to confirm each withdrawal. OTP verification is required during registration, for payment method changes and for withdrawals.
        </p>
        <p>
          <strong>Unlock Time:</strong> The time a stay's payout becomes ready to withdraw, as set in section 5.1.2.
        </p>
        <p>
          <strong>Withdrawal:</strong> The Property Owner's request, confirmed with a one-time code, to send the payouts that are ready in My Payouts to their verified payout account.
        </p>
        <p>
          <strong>Payout Hold:</strong> A pause on a payout while one of the conditions in section 5.7 applies. No money is sent while a payout is on hold.
        </p>
        <p>
          <strong>Payout:</strong> The actual transfer of funds to Property Owners. Payouts are processed according to payout schedules, which may be flexible (on-demand) or scheduled (daily/weekly), as outlined in section 5 of this policy.
        </p>
        <p>
          <strong>Property Owner:</strong> An individual or entity registered on the NoLSAF platform who lists and provides accommodation properties to Users. Property Owners receive disbursements for completed bookings according to the terms of this policy.
        </p>
        <p>
          <strong>Refund:</strong> The return of payment to a User for a cancelled booking, processed in accordance with the Cancellation Policy. Refund amounts are deducted from Property Owner earnings based on the cancellation circumstances and timing.
        </p>
        <p>
          <strong>Service Fees:</strong> Additional fees charged by NoLSAF for platform services, separate from commission fees. Service fees are deducted from gross earnings before disbursement.
        </p>
        <p>
          <strong>User:</strong> An individual who books accommodations through the NoLSAF platform. Users make payments to NoLSAF, which are then disbursed to Property Owners after service completion.
        </p>
        <p>
          <strong>Verification:</strong> The process of confirming the accuracy and validity of payment method information, account details, and identity. Verification includes OTP confirmation and may require additional documentation or steps before disbursements can be processed.
        </p>
      </div>
    ),
  },
  {
    title: "17. Acknowledgment and Acceptance",
    content: (
      <div className="space-y-4">
        <p>
          By registering as a Property Owner on the NoLSAF platform and accepting disbursements, you acknowledge that you have read, understood, and agree to be bound by this Disbursement Policy. You further acknowledge that you understand your rights, responsibilities, and duties as outlined in this policy.
        </p>
        <p>
          Property Owners are encouraged to review this Disbursement Policy regularly and contact NoLSAF support if they have any questions or require clarification about any aspect of this policy. NoLSAF is committed to providing clear, fair, and transparent disbursement terms to ensure a positive experience for all Property Owners.
        </p>
        <p>
          This Disbursement Policy works in conjunction with the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link> and other applicable NoLSAF policies. Property Owners must comply with all applicable policies to remain eligible for disbursements.
        </p>
      </div>
    ),
  },
];

