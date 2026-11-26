# Sales Assisted Listing (partner lists on the owner's behalf)

**Status:** Phase 1 BUILT 2026-11-20 (uncommitted). Migration `20261120100000_add_sales_assisted_listing` prepared, NOT applied. Apply it before deploying this code. See section 16.
**Drafted:** 2026-11-20
**Owner:** Daniel
**Related:** `SALES_PARTNER_WORKSPACE.md` (leads, attribution, commission), `apps/api/src/lib/salesSelfDealing.ts`, `apps/api/src/lib/passwordSetupLink.ts`

---

## 1. The problem

Owners often agree to join NoLSAF when a sales partner visits, but they do not have the time or the skill to complete the listing steps themselves. Today the flow stops there: the partner registers the lead, requests conversion, and waits for an owner who never finishes the listing.

Assisted listing lets the partner do the whole listing for the owner. The owner only receives information messages and does **one** real action later: adding their payout number when there is money waiting.

## 2. Principles

1. **Simple for the owner.** No forms, no account setup, no password, no approval tap. Two information SMS messages, then one action when money is waiting.
2. **The partner does the work, never holds the keys.** The partner fills in the listing while it is a draft. They never set the owner's login, never touch payout details, and lose edit access once the listing is approved.
3. **Nobody but the owner sets the owner's password.** The account starts with no password. The owner signs in with an SMS code; a password is optional and set by the owner from a setup link.
4. **Money only reaches the real owner.** Bookings can come in before the owner engages, but nothing is paid out until the owner adds their own payout account, and the first payout is reviewed by hand.
5. **The owner can always stop it.** Every SMS carries a "not expecting this?" path that pauses the listing at once.

## 3. Flow

| Step | Who | What happens | Owner's part |
|---|---|---|---|
| 1. Agreement | Partner + owner | Owner agrees face to face during a visit. Partner records a **verified visit** (existing GPS and photo flow) on the lead. | Agrees verbally |
| 2. Start assisted listing | Partner | On the lead, partner taps **List for the owner** and enters the owner's **full name, phone and email** (email required since 2026-11-27). The email is stored on the listing as `PENDING`, never on the owner's account: see "Owner email" below. | Nothing |
| 3. Owner account | System | Creates or attaches the owner account (section 4). Creates a `DRAFT` property owned by that account, linked to the lead. | Nothing |
| 4. SMS 1: notice | System | Informs the owner who is preparing their listing, with a "not expecting this?" link (section 6). | Nothing, unless it is wrong |
| 5. Listing | Partner | Completes every listing step in the sales portal (same steps as the owner wizard). Photos come from the lead's photo pack (section 7). | Nothing |
| 6. Submit | Partner | Submits for review. Partner edit access ends here. | Nothing |
| 7. Review | Admin | Normal moderation, with an **Assisted listing** badge and extra checks (section 9). Approve or return to the partner. | Nothing |
| 8. SMS 2: live | System | Tells the owner the property is live, with a sign-in link to view it and set up payouts, plus an optional password setup link. | Nothing yet |
| 9. First booking | System | Booking SMS to the owner as usual. If no payout account exists: "You have a booking worth TSh X. Add your payout number to receive it." | **Signs in with SMS code and adds a payout account** |
| 10. First payout | Admin + system | First payout reviewed by hand (existing policy), name check against the owner (section 8). Then normal auto-payout rules. | Nothing |

## 4. Owner account: who creates it

**The system creates it,** at step 3, from the name and phone the partner entered. The partner never chooses login details.

| Case | Outcome |
|---|---|
| Phone not on any account | New `User` with role `OWNER`, no password, phone not yet verified, `createdVia = SALES_ASSISTED`, linked to the assisted listing |
| Phone belongs to an existing **owner** | The new property is attached to that owner. SMS 1 says a new property is being added to their account |
| Phone belongs to a **non-owner** account (customer, driver, operator, partner) | Blocked from auto-creation; goes to admin review. One role per account, so the role is never changed silently |
| Phone, email, or device matches the **partner** (`salesSelfDealing.ts` identity checks) | Blocked. Partner sees "The owner must be a different person from you" |
| Phone already used by another assisted listing from a **different** partner within its protection window | Normal lead duplicate rules apply (warning + admin review) |

Until the owner signs in for the first time, the account is **dormant**: it holds the property, receives SMS, and accrues bookings, but no one can sign in to it except via an SMS code to that phone.

## 5. Owner sign-in and password: who sets it

**Nobody except the owner, and the owner does not need one to start.**

- The account is created **without a password**.
- The owner signs in with **phone + one-time SMS code**, using the existing login OTP flow (`POST /auth/send-otp`, `POST /auth/verify-otp` without a role, which authenticates an existing account). First successful sign-in marks the phone verified and moves the account from dormant to active.
- SMS 2 also carries a **password setup link** built with the existing `passwordSetupLink(origin, raw, { onboarding: true, next })` helper (same pattern as admin-created tour operator accounts). Using it is optional. Link expiry follows the existing onboarding setup window; the owner can request a fresh one from the sign-in page.
- **Never:** a password set by the partner or an admin, a password or code sent in an SMS that the partner can see, or a "temporary password".
- The existing owner MFA policy applies as normal once the owner is a paid owner (passkey or authenticator, 14-day grace).

## 6. Owner messages

Sent to the owner's phone only. Brand reads "NoLSAF". No em-dashes. Final wording in English and Swahili to be approved before launch.

**SMS 1: notice (at step 3)**
> Habari {ownerFirstName}. {partnerName}, a NoLSAF sales partner, is preparing {propertyName} to go live on NoLSAF for you. You do not need to do anything now. Not expecting this? {objectLink} or call {supportPhone}.

**SMS 2: live (at admin approval)**
> {propertyName} is now live on NoLSAF. View it and set up how you get paid: {signInLink}. Optional: set a password {setupLink}. Not expecting this? {objectLink}

**SMS 3: payout needed (first booking with no payout account, then reminders)**
> You have a NoLSAF booking for {propertyName} worth TSh {amount}. Add your payout number to receive it: {signInLink}

Reminders for SMS 3: at 24 hours and at guest check-in, then stop. Payout stays held.

### "Not expecting this?" (objection)

- `objectLink` carries an opaque reference; only its SHA-256 hash is stored (same approach as `SalesOwnerConfirmation`).
- Opening it does **not** require sign-in. Objecting is low-harm: it only pauses.
- "Yes, I agreed" is the one primary button; "Report it" is a quieter link. Reporting needs a chosen reason (the API refuses a pause with no reason), plus a short note when the reason is "Something else".
- Effect, immediately: listing moves to `PAUSED_OBJECTION` (unpublished if live), partner edit access revoked, admin alerted, partner sees "Paused: owner query".
- Admin resolves by calling the owner: **cancel** (listing withdrawn, partner flagged, no attribution) or **resume** (owner confirmed, listing restored).
- Existing confirmed bookings on an objected listing are handled by admin case by case (contact owner and guest, rebook or refund under the normal policy).

## 7. Partner permissions

| Action | Partner |
|---|---|
| Start an assisted listing on **their own** lead with a verified visit | Yes |
| Edit all listing steps while the property is `DRAFT` or returned by admin | Yes |
| Use photos from the lead's photo pack (on-site visit photos tagged "Taken on site"; gallery uploads tagged "Uploaded") | Yes |
| Submit for review | Yes |
| Edit after submission, approval, or while live | No. May **propose** a change; owner or admin applies it |
| Payout accounts, bank or mobile money details | Never |
| Owner name or phone after SMS 1 is sent | No. Admin only, and a phone change re-sends SMS 1 to the new number |
| Owner password, sign-in, or MFA | Never |
| Approve, publish, or verify their own attribution | Never |
| See owner data beyond what they entered | No |

Server rule: the partner may write property `X` only when an `SalesAssistedListing` row for `X` belongs to the partner's `salesPartnerId` (derived from the session, never the request), and its status is `DRAFTING` or `RETURNED`. Every write is audited with the partner as actor. Impersonated sessions are refused (`blockImpersonated`).

Photos: GPS and camera metadata are stripped before an image becomes a public `PropertyImage`, so the location privacy rule for private homes still holds. Photo hashes are checked against other leads and properties; a match flags the listing for review.

## 8. Payout safety

1. **Bookings may come in before the owner engages.** Payouts are held until the owner, signed in themselves, adds a payout account.
2. **Owner-only payout setup.** Payout account endpoints keep `blockImpersonated` and require the owner's own session. The partner has no route to them.
3. **Name check.** For mobile money, `azamPayNameLookup` returns the wallet holder's name; it is compared with the owner's name. For bank accounts, the account name entered is compared. A mismatch does not block saving but holds the first payout for admin review.
4. **Not the partner.** The payout account is checked against the partner's payout account (`payoutAccountKey` in `salesSelfDealing.ts`). A match blocks the payout and flags the partner.
5. **First payout manual,** as for all owners. Later payouts follow the normal auto-payout rules.

## 9. Admin review and controls

Assisted listings appear in the normal moderation queue with an **Assisted listing** badge and a side panel showing:

- Partner name, level, and their assisted-listing history (approved, returned, objected counts).
- The verified visit: map distance from the property pin, capture time, photo.
- Photo provenance: how many "Taken on site" vs "Uploaded", any duplicate-hash matches.
- Owner account outcome (created, attached to existing owner, admin review).
- SMS 1 sent time and any objection.

Admin actions: approve, return to partner with reasons, cancel, resolve objection (cancel or resume), change owner phone (re-sends SMS 1), pause partner's assisted-listing ability.

Partner controls (admin-set):

- **Assisted listing is a capability** (`SalesPartnerCapability`, e.g. `ASSISTED_LISTING`), granted by admin. Not every partner gets it on day one.
- Limit on open drafts per partner (default 10).
- Automatic pause of the capability when objections or returns pass a threshold (for example 2 objections, or 40% returned over the last 10 submissions), pending admin review.

## 10. Attribution and commission

- An assisted listing creates the `PropertySalesAttribution` row as `PENDING`, linked to the lead. Admin approval of the listing moves it to `VERIFIED`, following the existing rules.
- The owner's "Did this partner bring you to NoLSAF?" confirmation (`SalesOwnerConfirmation`) is asked **inside the payout setup screen** as one optional question, not as a separate message. It reuses the existing confirmation record.
- An objection that admin upholds cancels the attribution; no commission is ever earned on that property by that partner.
- Commission rules, rates and self-dealing checks are unchanged.

## 11. Data model sketch (indicative, nothing approved)

- `SalesAssistedListing`
  - `leadId`, `salesPartnerId`, `propertyId`, `ownerUserId`, `visitId` (required verified visit)
  - `ownerAccountOutcome`: `CREATED`, `ATTACHED_EXISTING`, `ADMIN_REVIEW`
  - `status`: `DRAFTING`, `SUBMITTED`, `RETURNED`, `APPROVED`, `PAUSED_OBJECTION`, `CANCELLED`
  - `noticeSentAt`, `liveNoticeSentAt`, `payoutPromptSentAt`
  - `objectionReferenceHash` (unique), `objectedAt`, `objectionNote`, `objectionResolvedAt`, `objectionResolvedById`, `objectionOutcome`
  - `submittedAt`, `approvedAt`, `returnedAt`, `returnReasons`
  - Unique on `propertyId`.
- `User.createdVia` (or equivalent) gains `SALES_ASSISTED`; dormant state derived from no sign-in yet. Confirm `User.password` is nullable for OTP-only accounts before build.
- Lead photo pack: photos stored against the lead (with hash, source `VISIT` or `UPLOAD`, capture time), copied into `PropertyImage` with metadata stripped when used in the listing.
- `SalesPartnerCapability.capability` gains `ASSISTED_LISTING`.

All public references opaque. MySQL 8 and MariaDB 11.8 compatible. Nothing applied without approval.

## 12. API sketch

Partner (sales workspace, own leads only, `blockImpersonated`, rate limited):

```
POST   /api/sales/leads/:ref/assisted-listing            start (name, phone, email, visit ref)
GET    /api/sales/assisted-listings/:ref                 draft state
PATCH  /api/sales/assisted-listings/:ref/steps/:step     save a listing step (reuses owner step validators)
POST   /api/sales/assisted-listings/:ref/photos          add from photo pack
POST   /api/sales/assisted-listings/:ref/submit          submit for review
POST   /api/sales/assisted-listings/:ref/change-request  propose a change after submission
```

Public (no sign-in):

```
GET    /api/public/listing-notice/:ref                   what is being listed, by whom
POST   /api/public/listing-notice/:ref/object            pause + alert admin
```

Admin:

```
GET    /api/admin/sales/assisted-listings                queue with badge data
POST   /api/admin/sales/assisted-listings/:ref/return
POST   /api/admin/sales/assisted-listings/:ref/cancel
POST   /api/admin/sales/assisted-listings/:ref/objection/resolve
POST   /api/admin/sales/assisted-listings/:ref/owner-phone
```

Listing approval itself stays on the existing admin property moderation route; it triggers SMS 2 and the attribution move when the property has an assisted listing.

## 13. Edge cases

| Case | Handling |
|---|---|
| Owner never signs in, bookings keep coming | Payouts held; SMS 3 reminders stop after check-in; admin sees "payout pending, owner not engaged" list and calls the owner |
| Owner signs in and wants to edit the listing | Normal owner editing; partner has no access by then |
| Owner wants the partner to keep managing photos/availability | Later: owner-granted "listing manager" access, revocable, never prices or payouts without owner approval. Not in v1 |
| Wrong phone entered | SMS 1 reaches a stranger, who objects; admin corrects phone, SMS 1 re-sent |
| Partner leaves NoLSAF mid-draft | Draft returns to admin; admin cancels or reassigns |
| Owner already has the property listed | Duplicate check on lead and property name/location; admin review |
| Owner phone is shared (family, reception) | Accepted; the payout name check and first manual payout protect the money |

## 14. Phasing

1. **Phase 1:** capability grant, start flow with account creation, SMS 1 with objection, partner listing steps, submit, admin review with badge, SMS 2. Payouts held until owner adds account (existing behaviour plus the prompt).
2. **Phase 2:** SMS 3 payout prompts and reminders, name check hold, owner confirmation inside payout setup, auto-pause thresholds, partner change requests.
3. **Later:** owner-granted listing manager access.

## 15. Open decisions

1. Should assisted listings allow **instant booking** before the owner's first sign-in, or start as **request to book** until then? (Instant book is simpler and matches "owner does nothing"; request to book prevents a guest arriving at an owner who has not looked at the calendar.)
2. Capability: every active partner, or admin grant only (recommended: admin grant first).
3. Objection thresholds for automatic pause.
4. Whether the partner earns a one-time onboarding bonus for assisted listings, or the normal commission only.
5. Final SMS wording in English and Swahili.

## 16. Implementation (phase 1, 2026-11-20)

One listing implementation, reused rather than copied:

- **Listing steps:** the owner wizard moved to `apps/web/app/(owner)/owner/properties/add/_components/PropertyListingWizard.tsx` with a small adapter (load, save, submit, where to go after). The owner page is a thin wrapper; the partner page `/sales/leads/[ref]/listing` mounts the same wizard with the assisted adapter.
- **Server handlers:** the owner GET, PUT and submit handlers in `routes/owner.properties.ts` are exported and read the owner from `req.listingScope` when set. `routes/sales.assistedListing.ts` proves the partner owns the lead, holds the right, and the listing is DRAFTING or RETURNED, then calls those handlers. Audit entries name the partner as actor. A partner never sees the owner account's contact details in the property payload.
- **Attribution:** no new path. Submitting puts the lead into the existing conversion queue (CONVERSION_REQUESTED); the admin conversion review preselects the assisted property. Owner confirmation stays the existing `SalesOwnerConfirmation` flow.
- **Rules in one place:** `lib/salesAssistedListing.ts` (gate, owner account resolution, notice token, SMS text, submit/approve/reject hooks, objection and its resolution).

| Piece | Where |
|---|---|
| Partner start, state, scoped listing | `routes/sales.assistedListing.ts`, `components/sales/AssistedListingCard.tsx` (lead page) |
| Owner "Not expecting this?" | `routes/public.listingNotice.ts`, `app/listing-notice/[token]/page.tsx` |
| Admin queue, objection resolve, withdraw, partner right | `routes/admin.sales.assistedListings.ts`, `/admin/sales/assisted-listings`, partner record tab "List for owners" |
| Property review hooks and guards | `routes/admin.properties.ts`: approve sends SMS 2, reject returns to partner, approve/unsuspend refused while paused or cancelled; list cards show an "Assisted listing" badge |
| Photo uploads | `routes/uploads.cloudinary.ts`: a partner with the right (granted, not paused) may sign uploads to `properties/*` |
| Tests | `__tests__/salesAssistedListing.test.ts` |

Differences from the draft above:

- **The right** lives on `SalesPartnerProfile` (`assistedListingEnabledAt`, `assistedListingPausedAt`, `assistedListingPauseReason`), not `SalesPartnerCapability`, which carries Agency Desk rate and addendum fields that do not apply here.
- **Phone on a non-owner account** is refused with a "contact support" message instead of an admin review queue.
- **Saving progress:** like the owner flow, the server copy changes on submit; in between, progress is kept in the browser per lead and restored when newer than the server copy.
- **The notice link** is re-issued in the live SMS (only one hash is stored), so the link in SMS 1 stops working once the listing is live.
- **Withdraw / cancel** sets the property to SUSPENDED and keeps the record; nothing is deleted.
- **Not built yet (phase 2):** SMS 3 payout prompts and reminders, payout name-check hold, owner confirmation inside the payout setup screen, partner change requests after submission, and the instant-book decision (open decision 1; booking behaviour is unchanged).


## Owner email (added 2026-11-27)

The partner must enter the owner's email, but it is only a candidate. "Forgot password" sends its link to the account email, so an email chosen by the partner would let the partner reset the owner's password and take the account (and its payouts).

- **Stored:** `sales_assisted_listing.ownerEmail` with `ownerEmailStatus = PENDING` when the owner account has no email. An owner who already has an email keeps theirs; the partner's is not offered. The owner account itself is still created with `email: null`.
- **Proved by the owner:** the password setup page (`/account/reset-password`) shows both sign-in details masked: phone (confirmed by the SMS link) and the email marked "To confirm". "Send me a code" emails a 6-digit code (5 minutes, 5 tries, stored hashed, `lib/contactChangeOtp.ts`); the right code sets `User.email` + `emailVerifiedAt` and marks the listing `VERIFIED`. It never replaces an email the owner already set and refuses an address another account uses.
- **"Not my email":** marks it `REJECTED`; it is never offered again. The owner can add their own later in Owner, Profile.
- **Endpoints** (setup token in the body, no sign-in): `POST /api/auth/reset-password/email/send`, `/email/verify { code }`, `/email/reject`. `POST /api/auth/reset-password/check` returns `contacts { phone, email, emailState }`, all masked.
- **Migration:** `20261127100000_add_assisted_owner_email` (three nullable columns), prepared, not applied. Apply before deploying the API.
