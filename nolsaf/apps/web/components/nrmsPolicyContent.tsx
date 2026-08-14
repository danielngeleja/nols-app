"use client";

import Link from "@/components/PolicyLink";
import { TermsSection } from "./Terms";

export const NRMS_POLICY_LAST_UPDATED = "12 August 2026";

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
          <strong>2.6 "Statement"</strong> means a payable PAYG bill issued when a Property's unpaid usage
          balance reaches its unpaid limit and the grace period set by the active usage charge policy has
          passed, settled through a supported payment method inside NRMS billing.
        </p>
        <p>
          <strong>2.7 "Group Block"</strong> means rooms held in NRMS for an agreed party before any guest names
          exist, at agreed rates and until an agreed cut-off date, as described in section 5.5.
        </p>
        <p>
          <strong>2.8 "Rooming List"</strong> means the shared link through which a group organiser or agency
          submits the guest names for a Group Block, as described in sections 5.6 and 6.4.
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
          confirmation link. The NRMS staff form asks for an outlet when a Restaurant, Bar, or Outlet Supervisor
          role is invited; where one of those roles is recorded without a specific outlet, that Staff Member can
          serve every outlet at the Property, so the Owner should confirm the outlet is set correctly at the time
          of invitation. The Owner is responsible for the conduct of every Staff Member
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
        <p>
          <strong>4.5 Group and agency billing.</strong> A group block records how the stay will be billed at
          the time it is agreed: individually to each guest, split between the guests and a master account, or
          entirely to a master account that carries the group's extras as well. Setting or changing a billing
          mode that routes liability to a master account is a manager-level decision and is not available to
          front desk access. Where the master account requires settlement before departure, NRMS blocks checkout
          of the routed stays until that account is settled, including where the operational group has since
          been disbanded or a guest detached from it. The agreement with the agency, tour operator, or company
          behind a master account is between that party and the Property. NoLSAF is not a party to it, does not
          collect the master account payment, and does not guarantee, underwrite, or recover an amount that
          party fails to pay.
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
          frequency are as disclosed in the workspace at the time, and a connection type not offered there for a
          Property is not available to it. A calendar-only connection, such as iCal-based date blocking where it
          is offered, synchronizes on a delay set by the third-party provider, not by NoLSAF, and
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
        <p>
          <strong>5.5 Group blocks and cut-off dates.</strong> A group block holds a stated number of rooms of
          each type for an agreed party, at agreed rates, before any guest names exist. A held room that has not
          yet been picked up consumes inventory exactly as a reservation does, so it is unavailable to every
          other channel while the block is live. Any room in the block still unnamed when the cut-off moment
          passes returns to sale automatically at that moment, without further action by the Owner or by NoLSAF
          and without a warning at the time. Choosing the cut-off date, and picking up rooms before it passes,
          are the Owner's responsibility. NoLSAF does not extend a cut-off, hold a released room, or restore a
          block after the date has passed.
        </p>
        <p>
          <strong>5.6 Rooming lists and capability links.</strong> Where an Owner sends a rooming list to a
          group organiser or agency, NRMS issues a link that opens without a NoLSAF account and without a
          password. That link is a bearer credential: anyone holding it can open the list and submit names until
          it expires, is revoked, or the list is confirmed. The Owner chooses who receives the link and is
          responsible for sending it to the correct contact, for setting an appropriate validity period, and for
          revoking it when the group's arrangements change. Names submitted this way are staging text only: they
          hold no inventory, create no reservation, and change no availability until a member of staff accepts
          and confirms them, which is also the point at which cut-off and availability are re-checked. A Pro
          Forma verification link works the same way, exposing that document and the Property's own payment
          instructions to anyone holding the token.
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
          that guest's stay or order. How long NRMS guest records are held once a Property's NRMS account is
          closed is described in section 8.5.
        </p>
        <p>
          <strong>6.2 Charge-to-room.</strong> Charging an order to a room is offered only from a QR order point
          bound to a specific room, and only while that room holds a stay that is currently checked in. NRMS
          verifies the room and the stay occupying it, not the identity of the person scanning the code, so any
          person with access to a room's printed QR code can post a charge to the folio of the guest staying in
          that room. The Owner is responsible for where room QR codes are displayed, for rotating a code under
          section 6.3 where it may have been taken or copied, and for resolving any disputed charge-to-room order
          at the front desk before checkout.
        </p>
        <p>
          <strong>6.3 QR order point security.</strong> Order point access tokens can be rotated or deactivated
          by the Owner or Manager. The Owner is responsible for rotating a token if a printed QR code is lost,
          damaged, or suspected of misuse.
        </p>
        <p>
          <strong>6.4 Guest details submitted by a third party.</strong> A rooming list is normally filled in by
          a group organiser or agency rather than by the guests themselves, and asks for each guest's full name,
          phone number and nationality, and optionally an email address, sharing arrangement, and notes. The
          Owner is responsible for satisfying itself that whoever fills in the list is entitled to share those
          details, and for any consent or notice the Owner's own arrangement with that organiser requires.
          NoLSAF processes what is submitted in line with the <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link> and section 8.5, and does
          not verify that a submitted name, contact number, or nationality is accurate or lawfully provided.
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
          <strong>7.2 Trial and statements.</strong> Every Property's free trial period, per-night rate,
          reminder and warning thresholds, unpaid usage limit, and grace period are governed by the active NRMS
          usage charge policy, which is displayed to the Owner when they activate NRMS and is not fixed by this
          document. External room-nights falling inside the trial period are recorded at no charge. When the
          trial period ends, external room-nights begin accruing against the Property's unpaid balance; the end
          of a trial does not by itself produce a Statement or restrict the Property. As the balance rises it
          passes a reminder threshold and then a warning threshold, each of which triggers a notification under
          section 13. A Statement is issued only once the unpaid balance reaches the Property's unpaid limit and
          the grace period that follows has elapsed.
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
        <p>
          <strong>7.5 How PAYG terms change.</strong> A Property's trial length, per-night rate, reminder and
          warning thresholds, and unpaid limit are fixed to the specific policy version in effect when NRMS was
          activated for that Property. Publishing a new policy version for future activations does not change
          the terms already applied to an existing Property. NoLSAF may move a specific Property to a newer
          policy version, but only forward to a later version, never back to an earlier one, and only with a
          stated reason recorded against that account. When this happens, the Owner is notified of the change
          through the channel described in section 13.
        </p>
        <p>
          <strong>7.6 Property-level adjustments.</strong> Separately from a policy version change, NoLSAF may
          adjust a single Property's trial end date or unpaid limit, or apply a credit against its unpaid
          balance. Each of these requires a stated reason recorded against the account, and the Owner is
          notified through the channel described in section 13. Where a trial is shortened, the new end date
          must leave the Owner a minimum period of notice before it takes effect. A credit can never exceed the
          unpaid balance it is applied against, and reduces or cancels the related Statement accordingly.
        </p>
        <p>
          <strong>7.7 Effect of an unsettled Statement.</strong> While a Statement remains unsettled past the
          Property's unpaid limit, while a payment for it is still awaiting confirmation from the provider, or
          while the account is closed, NRMS restricts the opening of new external stays for that Property. That
          restriction is applied where an external reservation is opened directly. Some paths that turn an
          existing commitment into a stay, such as picking up a room from a group block or confirming a rooming
          list, may still complete while a balance is outstanding. Room-nights recorded that way remain billable
          in full, and recording them neither waives nor defers the obligation to settle the Statement. Settling
          the balance lifts the restriction immediately.
        </p>
        <p>
          <strong>7.8 Group room-nights.</strong> A stay created from a group block or a rooming list is an
          External Reservation unless it originated from a NoLSAF Marketplace booking. Its room-nights are
          billable under section 7.1 per room and per night, exactly as any other external stay, so a block
          picked up in full accrues usage for every one of its rooms. Held but unnamed block rooms accrue
          nothing: usage begins only once a picked-up stay is checked in and its nights elapse.
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
        <p>
          <strong>8.4 Closure is different from a freeze.</strong> NoLSAF may close a Property's NRMS account
          where the Owner asks for it, where the Property leaves the Marketplace permanently, or where an
          unresolved violation or unpaid balance makes continued service untenable. Unlike a freeze, a closed
          account is not reopened by settling a balance: reopening is a support decision, and closure does not
          cancel an outstanding Statement. Amounts already accrued remain payable.
        </p>
        <p>
          <strong>8.5 Retention after closure.</strong> Once a Property's NRMS account is closed and a retention
          date is recorded against it, NoLSAF applies the following schedule automatically. Guest records held
          for that Property, including guest names, phone numbers, email addresses, nationality and guest notes,
          together with the recipient details of any guest SMS campaign, are permanently anonymized 730 days
          (24 months) after that date. Free-text operational detail, including external reservation references,
          cancellation reasons, reservation notes, payment references and notes, charge descriptions, and outlet
          order labels, notes and guest feedback, is permanently removed 2,555 days (7 years) after that date.
          Anonymization and removal under this section are irreversible and cannot be undone on request.
          Financial records, usage events, and Statements are retained for as long as Tanzanian tax, accounting,
          and dispute resolution requirements demand. An Owner who needs a copy of their operational records
          should export them before closure, or ask NoLSAF support for a dispute export while the records are
          still held.
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
    title: "13. Notifications and Communication Channels",
    content: (
      <div className="space-y-4">
        <p>
          <strong>13.1 Primary channel: the in-app notification inbox.</strong> Events affecting a Property's
          NRMS access or billing, including a dunning reminder or warning, a payment token reconciled or voided,
          an unpaid limit or trial change, a policy migration under section 7.5, a property or QR ordering
          freeze or unfreeze, or a staff member's access being disabled, are delivered to the Owner through the
          in-app notification inbox, with a best-effort real-time alert while the Owner is connected to NoLSAF.
          This is the authoritative channel for these events. The Owner is responsible for checking the
          notification inbox regularly, and NoLSAF is not liable for a consequence of an Owner failing to review
          a notification that was correctly delivered to that inbox.
        </p>
        <p>
          <strong>13.2 Staff invitations are emailed.</strong> Inviting a Staff Member sends a confirmation link
          to the email address on that person's existing NoLSAF account. Access only takes effect once that
          link is accepted. The Owner should ask the invited Staff Member to check their spam or junk folder if
          the invitation does not appear promptly.
        </p>
        <p>
          <strong>13.3 No SMS for NRMS platform events.</strong> Unless NoLSAF states otherwise for a specific
          feature, NRMS platform events described in section 13.1 are not sent by SMS. SMS features made
          available to guests, such as consent-based campaigns, are governed separately and do not substitute
          for the Owner's own notification inbox.
        </p>
        <p>
          <strong>13.4 Owner-initiated contact.</strong> An Owner may reach NoLSAF through the channels shown in
          the NRMS help guide inside the workspace, currently WhatsApp, phone, and email. Response times for
          owner-initiated contact are not a substitute for the automated notifications described in section
          13.1.
        </p>
      </div>
    ),
  },
  {
    title: "14. Amendments to this Policy",
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
    title: "15. Contact",
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
