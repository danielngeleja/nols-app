"use client";

import Link from "@/components/PolicyLink";
import { TermsSection } from "./Terms";

export const NRMS_POLICY_LAST_UPDATED = "20 July 2026";

export const NRMS_POLICY_SECTIONS: TermsSection[] = [
  {
    title: "1. General Overview and Acceptance",
    content: (
      <div className="space-y-4">
        <p>
          This NRMS Policy governs the use of the NoLSAF Rooms Management System (NRMS), the operational
          workspace NoLSAF provides to Property Owners for running front desk, reservations, housekeeping,
          restaurant and bar outlets, staff access, and Pay As You Go (PAYG) billing for a Property. This policy
          supplements, and does not replace, NoLSAF's general <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link> and
          {" "}<Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link>. Where this policy is silent, the Terms of Service govern.
        </p>
        <p>
          <strong>1.1 Applicability.</strong> This policy applies to every Owner, Manager, and staff member
          who accesses NRMS for a Property, and to every guest who interacts with a Property through NRMS
          features such as QR ordering. By activating NRMS, inviting staff, recording a reservation, or placing
          an order through an NRMS QR code, you accept this policy.
        </p>
        <p>
          <strong>1.2 Part of the Marketplace, not a separate product.</strong> NRMS operates on top of a
          Property's approved NoLSAF Marketplace listing. It is not sold or offered as a standalone operations
          tool. If a Property's Marketplace approval is withdrawn, suspended, or never granted, NRMS access for
          that Property is unavailable, regardless of any NRMS enrollment or trial status.
        </p>
      </div>
    ),
  },
  {
    title: "2. Definitions",
    content: (
      <div className="space-y-4">
        <p>
          <strong>2.1 "NRMS"</strong> means the NoLSAF Rooms Management System workspace, including front
          desk, reservations, room and rate management, housekeeping, outlets and menus, QR ordering, staff and
          roles, finance and night audit, reporting, and NRMS billing.
        </p>
        <p>
          <strong>2.2 "Owner"</strong> means the Property Owner account holder responsible for a Property on the
          NoLSAF Marketplace and for its use of NRMS.
        </p>
        <p>
          <strong>2.3 "Staff Member"</strong> means any individual an Owner or Manager invites into NRMS under a
          defined role (Manager, Front Desk, Housekeeper, Restaurant, Bar, or Outlet Supervisor), each scoped to
          the permissions described in the NRMS help guide available inside the workspace.
        </p>
        <p>
          <strong>2.4 "External Reservation"</strong> means a stay recorded in NRMS that did not originate from
          a NoLSAF Marketplace booking, including walk-in, phone, direct, or Online Travel Agency (OTA) stays
          such as Airbnb, Booking.com, or Expedia, whether recorded manually or through a future channel
          connection.
        </p>
        <p>
          <strong>2.5 "PAYG"</strong> means the Pay As You Go usage charge that applies to External Reservation
          room-nights, billed under the active NRMS usage charge policy shown to the Owner at activation.
        </p>
        <p>
          <strong>2.6 "Statement"</strong> means a payable PAYG bill issued once trial usage ends or an unpaid
          usage limit is reached, settled through a supported payment method inside NRMS billing.
        </p>
      </div>
    ),
  },
  {
    title: "3. Eligibility and Property Approval",
    content: (
      <div className="space-y-4">
        <p>
          <strong>3.1 Approved listing required.</strong> Only a Property with an active, admin-approved
          Marketplace listing may activate or continue using NRMS. NoLSAF may withdraw NRMS access at any time a
          Property's approval status changes to pending, rejected, or suspended, and restores access
          automatically once approval is reinstated.
        </p>
        <p>
          <strong>3.2 No guarantee of approval.</strong> Submitting a Property for review does not guarantee
          approval. NoLSAF reserves sole discretion over Marketplace approval decisions, subject to the appeal
          and resubmission process described on the Property status pages.
        </p>
        <p>
          <strong>3.3 One workspace per Property.</strong> NRMS entitlement is granted at the Owner account
          level, but operational access, billing, and trial status are tracked per Property. Activating one
          Property does not activate NRMS for any other Property the Owner may add later; each Property must
          independently meet the approval requirement in section 3.1.
        </p>
      </div>
    ),
  },
  {
    title: "4. Owner and Staff Responsibilities",
    content: (
      <div className="space-y-4">
        <p>
          <strong>4.1 Accuracy of records.</strong> The Owner is solely responsible for the accuracy of room
          inventory, rates, reservation details, guest information, and charges entered into NRMS. NoLSAF does
          not verify the accuracy of information an Owner or Staff Member records.
        </p>
        <p>
          <strong>4.2 Staff invitations and access.</strong> Owners and Managers may invite Staff Members by
          email to an existing NoLSAF account. Access only takes effect once the invited person accepts the
          confirmation link, and role-scoped access (Restaurant, Bar, Outlet Supervisor) requires an outlet to be
          selected at the time of invitation. The Owner is responsible for the conduct of every Staff Member
          they invite, and for promptly revoking access when a Staff Member's relationship with the Property
          ends. Revocation requires a stated reason and is recorded for audit purposes.
        </p>
        <p>
          <strong>4.3 Housekeeping and readiness overrides.</strong> NRMS enforces housekeeping status before a
          guest can be checked into a room, unless front desk records an explicit override. The Owner is
          responsible for any consequence of overriding a housekeeping readiness check.
        </p>
        <p>
          <strong>4.4 Folio charges and outlet payments.</strong> Charges posted to a guest folio, including
          restaurant and bar orders, must be settled or correctly classified before checkout. NoLSAF is not
          responsible for revenue an Owner fails to record or reconcile before completing a checkout.
        </p>
      </div>
    ),
  },
  {
    title: "5. Reservations, Availability, and Channel Connections",
    content: (
      <div className="space-y-4">
        <p>
          <strong>5.1 NRMS as the inventory record.</strong> NRMS maintains one internal calendar for
          Marketplace bookings, NRMS reservations, and manually recorded External Reservations for a Property.
          Keeping this calendar current is the Owner's responsibility.
        </p>
        <p>
          <strong>5.2 Manual entry and OTA labels.</strong> Where a Property records stays originating from an
          OTA, NoLSAF may allow the reservation to be labeled with that OTA as its source for reporting purposes.
          Recording such a label does not mean NRMS has a live, automated connection to that OTA's calendar or
          reservation system unless NoLSAF has expressly enabled and disclosed a channel connection for that
          Property.
        </p>
        <p>
          <strong>5.3 Connected channels are best effort, not a guarantee.</strong> Where NoLSAF makes an
          automated channel connection available for a Property, the connection's trust level and update
          frequency are as disclosed in the workspace at the time. A calendar-only connection (for example,
          iCal-based date blocking) synchronizes on a delay set by the third-party provider, not by NoLSAF, and
          does not guarantee real-time inventory closure, rate or restriction synchronization, or provider
          acknowledgement of a change. NoLSAF disclaims liability for a double-booking, lost reservation, or
          lost revenue arising from a delay, failure, or limitation inherent to a third-party channel's own
          synchronization schedule or systems, provided NoLSAF's own channel connection was operating within its
          disclosed trust level at the relevant time.
        </p>
        <p>
          <strong>5.4 Owner mitigation responsibility.</strong> Where NRMS offers protective controls for
          low-availability inventory, such as a stop-sell or manual confirmation setting, the Owner is
          responsible for enabling and using them appropriately for their risk tolerance.
        </p>
      </div>
    ),
  },
  {
    title: "6. Guest Data and QR Ordering",
    content: (
      <div className="space-y-4">
        <p>
          <strong>6.1 Guest information.</strong> Guest names, contact details, stay records, and orders placed
          through NRMS, including QR order points, are processed in accordance with NoLSAF's <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link>. The
          Owner must not use guest information collected through NRMS for any purpose unrelated to fulfilling
          that guest's stay or order.
        </p>
        <p>
          <strong>6.2 Charge-to-room verification.</strong> A guest ordering through a QR order point may charge
          an order to their room only where NRMS can verify they are currently checked in under a matching name.
          The Owner remains responsible for resolving any disputed charge-to-room order at the front desk.
        </p>
        <p>
          <strong>6.3 QR order point security.</strong> Order point access tokens can be rotated or deactivated
          by the Owner or Manager. The Owner is responsible for rotating a token if a printed QR code is lost,
          damaged, or suspected of misuse.
        </p>
      </div>
    ),
  },
  {
    title: "7. PAYG Billing and Payment Processing",
    content: (
      <div className="space-y-4">
        <p>
          <strong>7.1 What is billed.</strong> PAYG usage charges apply only to External Reservation room-nights
          recorded by the Property. Marketplace bookings carry no NRMS usage fee and remain subject to the
          Owner's normal Marketplace commission under the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>.
        </p>
        <p>
          <strong>7.2 Trial and statements.</strong> Every Property's free trial period, per-night rate, and
          unpaid usage limit are governed by the active NRMS usage charge policy, which is displayed to the Owner
          when they activate NRMS and is not fixed by this document. Once trial usage ends or the unpaid limit
          is reached, a Statement is issued and must be settled before further external stays may be recorded.
        </p>
        <p>
          <strong>7.3 Payment processing.</strong> Statements are settled through supported third-party payment
          channels, including mobile money, bank transfer, and card checkout. NoLSAF is not liable for a delay,
          failure, or error that originates with a third-party payment provider, network operator, or financial
          institution, provided NoLSAF processed the transaction request in accordance with its own systems.
        </p>
        <p>
          <strong>7.4 Disputes.</strong> An Owner who disputes a Statement, usage entry, or payment outcome must
          raise the dispute through NoLSAF support with supporting detail. NoLSAF may reconcile a disputed
          payment manually where the evidence supports it.
        </p>
      </div>
    ),
  },
  {
    title: "8. Suspension, Freeze, and Termination",
    content: (
      <div className="space-y-4">
        <p>
          <strong>8.1 Grounds for suspension.</strong> NoLSAF may freeze or suspend NRMS access for a Property
          where its Marketplace approval is withdrawn, PAYG usage remains unpaid past the applicable limit, or
          the Owner or a Staff Member violates this policy, the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>, or applicable law.
        </p>
        <p>
          <strong>8.2 Reversibility.</strong> A freeze or suspension under this policy is reversible once the
          underlying issue is resolved, whether that is reinstated approval, a settled Statement, or a resolved
          policy violation. NoLSAF does not delete room, reservation, or guest history as a result of a freeze.
        </p>
        <p>
          <strong>8.3 Appeal.</strong> An Owner may appeal a freeze or suspension through the reference and
          contact channel shown at the time of the action.
        </p>
      </div>
    ),
  },
  {
    title: "9. Service Availability and Disclaimers",
    content: (
      <div className="space-y-4">
        <p>
          <strong>9.1 No uptime guarantee.</strong> NRMS is provided on an "as available" basis. NoLSAF does not
          guarantee uninterrupted or error-free operation and is not liable for a service interruption caused by
          maintenance, third-party infrastructure, or events outside NoLSAF's reasonable control.
        </p>
        <p>
          <strong>9.2 Connectivity.</strong> Where a Property operates with unreliable internet connectivity,
          the Owner is responsible for reconciling any operational records affected by connection loss, until
          such time as NoLSAF discloses offline-tolerant capability for the affected NRMS feature.
        </p>
        <p>
          <strong>9.3 No warranty of fitness for a particular purpose.</strong> NoLSAF does not warrant that
          NRMS will meet every operational requirement of every Property, and provides NRMS without any implied
          warranty except where such warranty cannot lawfully be excluded.
        </p>
      </div>
    ),
  },
  {
    title: "10. Limitation of Liability",
    content: (
      <div className="space-y-4">
        <p>
          <strong>10.1 Exclusion of indirect loss.</strong> To the maximum extent permitted by law, NoLSAF is
          not liable for indirect, incidental, special, or consequential loss arising from use of NRMS, including
          lost profits, lost bookings, or reputational harm, except where such loss results from NoLSAF's own
          fraud, gross negligence, or willful misconduct.
        </p>
        <p>
          <strong>10.2 Aggregate cap.</strong> Where liability cannot be fully excluded, NoLSAF's aggregate
          liability to an Owner arising from NRMS is limited to the NRMS PAYG fees paid by that Owner for the
          affected Property in the twelve months preceding the event giving rise to the claim.
        </p>
        <p>
          <strong>10.3 Third-party channels.</strong> Section 5.3 governs liability specific to third-party
          channel connections and controls to the extent of any conflict with this section.
        </p>
      </div>
    ),
  },
  {
    title: "11. Indemnification",
    content: (
      <div className="space-y-4">
        <p>
          The Owner agrees to indemnify and hold NoLSAF harmless from a claim, loss, or expense arising from the
          Owner's or a Staff Member's use of NRMS, including inaccurate reservation or rate information, a guest
          dispute over property or service delivery, a Staff Member's misuse of NRMS access, or the Owner's
          failure to comply with applicable tax, consumer protection, or hospitality regulations in their
          jurisdiction.
        </p>
      </div>
    ),
  },
  {
    title: "12. Dispute Resolution and Governing Law",
    content: (
      <div className="space-y-4">
        <p>
          This NRMS Policy is governed by the laws of the United Republic of Tanzania. Any dispute arising from
          or related to this policy is subject to the exclusive jurisdiction of the competent courts of
          Tanzania, without prejudice to any mandatory consumer protection rights that may apply in the Owner's
          country of residence, consistent with section 1.13 of the <Link href="/terms" className="text-blue-600 hover:text-blue-800 underline">Terms of Service</Link>.
        </p>
      </div>
    ),
  },
  {
    title: "13. Amendments to this Policy",
    content: (
      <div className="space-y-4">
        <p>
          NoLSAF may update this NRMS Policy as the product changes. Material changes will be reflected in the
          "Last updated" date shown above and, where required by law, communicated to affected Owners in
          advance. Continued use of NRMS after a change takes effect constitutes acceptance of the updated
          policy.
        </p>
      </div>
    ),
  },
  {
    title: "14. Contact",
    content: (
      <div className="space-y-4">
        <p>
          Questions about this NRMS Policy can be directed to NoLSAF support through the contact options shown
          in the NRMS help guide, available from within the workspace.
        </p>
      </div>
    ),
  },
];
