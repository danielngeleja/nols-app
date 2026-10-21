# Admin account correction and retirement policy

## Purpose

Support can resolve a mistaken OWNER or DRIVER registration without creating a second identity, and can retire an unused non-admin account. Admins must use **Admin → Users → Account correction or retirement**. Direct role edits through `/admin/settings/users/:id/role` are closed.

## Required review

1. Confirm the request came from the account holder through the approved support identity check. Record the support case reference and a reason that describes the verification and requested outcome. Do not place secrets or identity-document images in the reason.
2. Open the linked-record preview. If it reports any blocker, stop the automated action and refer the case to the owner of that business or compliance workflow. A zero balance or absence of an active trip is insufficient.
3. Re-authenticate with the admin finance OTP grant. Select the specific action and explicitly confirm it. The server repeats every eligibility check within a serializable transaction before changing the account.
4. Check the resulting admin audit entry and whether the verified email/SMS security notice was delivered. If delivery failed, follow up through the support case. Never repeat an action only to retry a notice.

## Eligibility

- **Correct to traveller:** only an unused OWNER or DRIVER account may become CUSTOMER. Partner onboarding is the only path to a new OWNER or DRIVER role. This action removes unverified, unused payout destinations and live driver location, clears role-specific profile and payout fields, and revokes all sessions. The person's verified contact details and traveller profile remain.
- **Retire unused account:** only an unused OWNER, DRIVER or CUSTOMER account may be retired. It is disabled, sessions and credentials are revoked, direct contact and profile fields are masked, and the User row remains as a tombstone. This is not a hard delete or a declaration that all historical data has been erased.
- **Blockers:** any property, booking, trip, invoice, KYC review, partner/staff role, finance or payout record, verified payout destination, referral beneficiary, restriction case, active support handoff, legal hold, safety reminder, driver route history, or any other business relation. The review includes payout release, withdrawal job/challenge, recovery, referral, Karibu, NRMS offline/portfolio and guest-code tables that lack a Prisma User relation. New User list relations block automatically unless explicitly reviewed and classified as non-commercial security or preference records. Schema changes adding one-to-one or unlinked user identifiers must update the explicit checks before release.
- ADMIN and other privileged roles never qualify. An existing suspension or disablement requires manual review. Accounts already retired cannot be changed through this workflow or re-enabled through the ordinary admin edit action.

## Records and exceptions

Audit, notification and session records follow their existing retention schedule; the workflow does not delete financial or trip history. A request for full data erasure, an account with blocking records, or a disputed identity needs a separate reviewed case under the applicable retention and legal-hold rules. Do not directly mutate `User.role`, delete a User row, or reuse the ordinary self-delete endpoint to bypass this policy.

The preview is advisory. A failed or conflicting transaction makes no account change; reopen the account and review its current blockers. Delivery failure after a committed change is handled as a notice incident, not a rollback.
