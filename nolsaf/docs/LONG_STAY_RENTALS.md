# Long-Stay Rentals (monthly, minimum term)

**Status:** IN BUILD since 2026-11-21 (see section 12). Migrations prepared, not applied.
**Drafted:** 2026-11-20. Money model revised the same day to **first month through NoLSAF, balance paid to the landlord at move-in** (the group-stay deposit pattern).
**Owner:** Daniel

---

## 1. What it is

A second rental model on the same listing system. A landlord lists an apartment, house or unit for monthly rent with a minimum term (for example 6 months). The tenant books through NoLSAF by paying the **first month** plus the NoLSAF service fee by card. The rest of the prepaid term is paid **directly to the landlord at move-in**, face to face, once the tenant has seen the home and has the keys.

NoLSAF protects the **booking and handover**: the home exists, matches the listing, the landlord is verified and the keys are handed over. After move-in the signed lease governs the relationship.

Target tenants: expats, NGO and project staff, students, people relocating between cities, corporate housing.

Why NoLSAF: today this market runs through brokers (dalali) and social media groups, with frequent scams and "viewing fees". A verified listing plus a protected first payment is the edge, and the tenant never sends the large amount until they are standing in the home.

## 2. What stays the same

Long stay reuses the existing listing pipeline end to end:

- Same `Property` record, same owner onboarding, same DRAFT > PENDING > APPROVED moderation.
- Same photos, location, amenities, verification, location privacy rule (private homes get a shifted point until booked).
- Same owner payout methods, payout ledger, receipts and admin approval tooling.
- Same money pattern as **group stays**: a booking payment goes through NoLSAF, the balance is settled at check-in, and NoLSAF pays the owner after arrival net of its fees.
- Same card checkout. Long stays are **card only**.
- Same opaque references in URLs (no row ids).

## 3. What is different

Only three things change: **the rental model, the availability model, and the booking flow.**

### 3.1 Rental model

Each listing (or each unit inside a property) declares how it rents:

| Mode | Meaning |
|---|---|
| `NIGHTLY` | Today's behaviour. Price per night. |
| `LONG_STAY` | Monthly rent, minimum term in months. |
| `BOTH` (later) | Same unit offered both ways. Long-stay occupancy blocks nightly dates. Not in v1. |

Long-stay fields (owned by the landlord):

- `monthlyRent` and `currency`
- `minTermMonths` (allowed: 1, 3, 6, 12) and optional `maxTermMonths`
- `upfrontMonths`: how many months are prepaid at move-in in total (first month through NoLSAF + balance to the landlord). Defaults to `minTermMonths`. Lets a landlord ask for 6 months up front on a 12-month lease.
- `furnished` (furnished / semi / unfurnished)
- `utilitiesIncluded`: water, electricity (LUKU), internet, security, service charge. Each flag either included or paid by tenant.
- `securityDeposit` in months (0, 1, 2). Collected by the landlord directly, never through NoLSAF.
- `noticePeriodDays` for ending early or not renewing.
- `balanceMethods`: how the landlord accepts the balance at move-in (bank transfer, mobile money). Cash is discouraged and not offered in v1 because it leaves no proof.
- House rules relevant to residency (pets, occupants, subletting not allowed).

### 3.2 Availability model

Nightly listings use a date calendar. Long stay uses **tenancy periods**, not nights:

- `availableFrom` date (the earliest move-in).
- A unit is either **available**, **reserved** (first month paid, waiting for move-in), or **let** (a tenancy covers today).
- A tenancy occupies a contiguous block: move-in date to `moveIn + termMonths`.
- Before the current tenancy ends, the listing can reopen for "available from {end date}" so the next tenant can be lined up. The sitting tenant gets first right to renew until `noticePeriodDays` before the end.
- Search shows "Available now" or "Available from {date}", never a night calendar.
- If `BOTH` mode arrives later, a tenancy writes a hard block onto the nightly calendar for its whole period.
- NRMS: if the property is NRMS-activated, a let unit shows as occupied (long-stay) so it is not sold twice.

### 3.3 Booking flow (replaces instant book)

*Changed 2026-11-21 (section 13): no viewing request and no offer haggling. The listing carries everything, and NoLSAF has inspected the home.*

1. **Reserve at the listed terms.** The tenant picks a move-in date and a term the listing allows (3, 6 or 12 months within `minTermMonths` to `maxTermMonths`). No money. Needs a verified phone; the home must have a current NoLSAF inspection.
2. **Landlord confirms within 24 hours,** or the reservation lapses (worker). Confirming freezes the money and the lease; other reservations on the same dates close. Questions before this go to NoLSAF (Ask NoLSAF), never to the landlord. Names, phones and messages open only once the first month is paid (RESERVED).
3. *(was: offer)* The term and date chosen in step 1 are the offer.
4. **Lease.** Both sides accept the NoLSAF standard lease (generated from the listing and offer). It states the term, the monthly rent, the amount paid through NoLSAF, and the **balance due to the landlord at move-in**. Acceptance is timestamped.
5. **Booking payment.** Within 48 hours of lease acceptance, the tenant pays **first month + tenant service fee** by card. Allowed up to 60 days before move-in. The home shows **Reserved**.
6. **Move-in day**, in this order:
   1. Walk-through and move-in condition photos in the app.
   2. Tenant pays the **balance** to the landlord directly (bank transfer or mobile money).
   3. Keys handed over. Tenant pays the deposit to the landlord if the lease has one.
7. **Move-in confirmation (72 hours).** Both sides confirm in the app: the landlord confirms the balance received (amount, date, method); the tenant confirms the balance paid, keys received and the home matches the listing. If one side confirms and the other is silent for 72 hours, it counts as confirmed. A dispute stops the clock.
8. **Landlord paid.** NoLSAF releases the first month net of its commission (section 5.3).
9. **Renewal or end.** Reminder at `noticePeriodDays` before the prepaid period ends. A renewal follows the same pattern: first month of the new term through NoLSAF, the rest direct.

## 4. Pricing: what NoLSAF charges

### 4.1 Why the short-stay rate does not fit

Short stays use the accommodation commission (`SystemSetting.commissionPercent`, schema default 10%, overridable per property via `services.commissionPercent`). On a long stay that is a very large amount for one placement:

> Example: TSh 1,500,000/month x 6 months = TSh 9,000,000. At 10% NoLSAF takes TSh 900,000 from the landlord, which is 60% of a month's rent. Landlords will list elsewhere or take the tenant off-platform.

### 4.2 The local benchmark

Brokers in Tanzania typically charge **one month's rent** as a finder fee, often charged to the tenant, sometimes to both sides. On a 6-month term one month is about 16.7% of the term; on 12 months about 8.3%. NoLSAF comes in **below** that on each side.

### 4.3 Rates

Fees are charged on the **whole lease term** (the rent the lease covers up front), even though only the first month passes through NoLSAF.

| Who pays | Fee | When it is taken |
|---|---|---|
| Landlord commission (**L**) | **5% of the term's rent**, capped at **50% of one month's rent** | Deducted from the first-month payout |
| Tenant service fee (**T**) | **4% of the term's rent**, capped at **25% of one month's rent** | Paid on top of the first month at booking |

Total about **9%** of the term. The landlord cap guarantees the commission always fits inside the first month, whatever the term, so NoLSAF can always collect it from money it holds.

Renewals paid through NoLSAF pay the same rates on the renewal term. A lower landlord rate on renewals (for example 3%) is an option to encourage renewing in the app; decide after first data.

Rates live in config (new `SystemSetting` fields such as `longStayLandlordPercent`, `longStayTenantPercent` and the two caps) and are **snapshotted onto each tenancy**, so a later change never alters a signed lease.

### 4.4 Formula

For monthly rent **M** and term **n** months:

- T = min(4% x M x n, 0.25 x M)
- L = min(5% x M x n, 0.50 x M)
- Tenant pays NoLSAF by card: **M + T**
- Tenant pays landlord at move-in: **M x (n - 1)**
- NoLSAF releases to landlord: **M - L - D** (D = payout transfer fee, only if the provider charges one)
- Card fee (NoLSAF's own cost): 2.9% x (M + T), the configured `gatewayFeeRates.CARD`
- **NoLSAF keeps: T + L - card fee**

### 4.5 Worked examples

**USD 4,500/month, 6 months**

| | Amount |
|---|---|
| Tenant pays NoLSAF by card | 4,500 + 1,080 = **USD 5,580** |
| Tenant pays landlord at move-in | **USD 22,500** |
| NoLSAF releases to landlord | 4,500 - 1,350 = **USD 3,150** |
| Landlord receives in total | **USD 25,650** |
| Card fee (2.9% of 5,580) | USD 162 |
| **NoLSAF keeps** | 2,430 - 162 = **USD 2,268 (8.4%)** |

**TSh 1,500,000/month, 6 months**

| | Amount |
|---|---|
| Tenant pays NoLSAF by card | 1,500,000 + 360,000 = **TSh 1,860,000** |
| Tenant pays landlord at move-in | **TSh 7,500,000** |
| NoLSAF releases to landlord | 1,500,000 - 450,000 = **TSh 1,050,000** |
| Landlord receives in total | **TSh 8,550,000** |
| Card fee | TSh 53,940 |
| **NoLSAF keeps** | **TSh 756,060 (8.4%)** |

**USD 4,500/month, 12 months (caps apply)**

| | Amount |
|---|---|
| Tenant pays NoLSAF by card | 4,500 + 1,125 = **USD 5,625** |
| Tenant pays landlord at move-in | **USD 49,500** |
| NoLSAF releases to landlord | 4,500 - 2,250 = **USD 2,250** |
| Landlord receives in total | **USD 51,750** |
| Card fee | USD 163 |
| **NoLSAF keeps** | 3,375 - 163 = **USD 3,212 (5.9%)** |

### 4.6 Compared with taking the full block by card (earlier draft)

| | Full block by card | **First month via NoLSAF** |
|---|---|---|
| Money NoLSAF holds (USD 4,500 x 6) | USD 28,080 | **USD 5,580** |
| Card fee | USD 814 | **USD 162** |
| NoLSAF keeps, 6 months | 6.0% | **8.4%** |
| NoLSAF keeps, 12 months | 3.3% | **5.9%** |
| Large card payment declined by tenant's bank | Real risk | **Rare (one month)** |
| Landlord gets the bulk at move-in | No | **Yes, as in the market** |
| Tenant sees the home before sending the large amount | No | **Yes** |

## 5. Money model

### 5.1 Principle

NoLSAF handles **only the booking payment** (first month + tenant fee) and holds it only until move-in is confirmed. The balance never touches NoLSAF. NoLSAF's fees are calculated on the whole lease term and collected from the money it holds.

### 5.2 Holding window

- The booking payment can be made up to **60 days before move-in**.
- It is held until move-in is confirmed (up to 72 hours after the move-in date), then released.
- Maximum NoLSAF exposure per tenancy: one month's rent plus the tenant fee.

### 5.3 Payout to landlord

1. Move-in confirmed (section 3.3 step 7), including the balance confirmation.
2. NoLSAF releases **M - L - D** in one payout. USD 4,500 x 6 example: USD 3,150.
3. A landlord's **first** long-stay payout is reviewed by hand (same "first payout manual, then auto" policy as owners). Later payouts follow the normal auto-payout rules.
4. If the balance amount confirmed does not match the lease (`M x (n - 1)`), the payout is held and the tenancy is flagged for admin review. Commission stays based on the lease term.

### 5.4 Collection

- **Card only**, through the existing card checkout. Mobile money is not offered for long stays.
- Card fee 2.9% (configured rate) on the booking payment only, paid from NoLSAF's fees.
- The balance is paid landlord-direct by bank transfer or mobile money, recorded in the app by both sides. NoLSAF does not process or verify the transfer itself; the two confirmations and the lease are the record.

### 5.5 Revenue ledger

Each fee is a `RevenueEntry` line with a new source (for example `LONG_STAY_LANDLORD`, `LONG_STAY_TENANT`), so long stay shows up in the unified revenue overview from day one. The card fee is recorded as a gateway cost like other card payments.

## 6. Long-stay policy (draft)

Draft wording for the public policy pages and the lease. Not published. When this goes live it is added through the policy feed (`lib/policyMeta.ts`, date and summary bumped together).

### 6.1 How payment works

The tenant pays the **first month and the NoLSAF service fee** through NoLSAF by card when booking. The **rest of the prepaid rent** is paid directly to the landlord on move-in day, after the walk-through and before the keys are handed over. Both sides record that payment in the app. NoLSAF pays the landlord the first month, less NoLSAF's commission, after move-in is confirmed.

### 6.2 What NoLSAF guarantees

NoLSAF guarantees the **booking and the handover**: the home exists, is the one listed, matches the listing in all material points, the landlord is verified, and the tenant can move in on the agreed date. If any of these fails before the tenant pays the balance, the tenant gets a **full refund of the first month and the service fee**.

Tenants should inspect the home **before** paying the balance. If a problem is only found after the balance was paid and is reported within 72 hours of move-in, NoLSAF refunds the first month and the service fee, and the landlord must return the balance within 14 days (enforced as in 6.6).

### 6.3 What NoLSAF does not guarantee

The balance is paid to the landlord, not to NoLSAF, so NoLSAF cannot refund it. After move-in the relationship is governed by the **signed lease** between tenant and landlord. NoLSAF is not a party to the lease, does not insure the tenancy, and does not carry out evictions.

### 6.4 Cancellation before move-in

| Case | Outcome |
|---|---|
| Tenant cancels more than 14 days before move-in | First month refunded; service fee not refunded |
| Tenant cancels 14 days or less before move-in | First month goes to the landlord less 5% of that month; service fee not refunded |
| Tenant does not pay the balance on move-in day | No keys; treated as a late tenant cancellation (row above) |
| Landlord cancels, or the home is not available on the move-in date | Full refund of first month and service fee; landlord flagged; repeated cases suspend the landlord |
| Home does not match the listing | Full refund of first month and service fee after admin review; landlord's listing suspended pending review; any balance already paid must be returned by the landlord within 14 days |

### 6.5 After move-in (lease terms)

The NoLSAF standard lease must state, at minimum:

- **Prepaid rent:** the amount paid through NoLSAF and the balance paid to the landlord at move-in, and the period they cover.
- **Tenant ends early:** tenant gives `noticePeriodDays` written notice in the app. The landlord keeps rent up to the end of the notice period and **refunds unused prepaid months within 14 days** of the tenant moving out.
- **Landlord ends early without a lease ground:** landlord refunds **all unused prepaid months within 14 days** and gives at least `noticePeriodDays` notice.
- **Deposit:** held by the landlord; returned within 14 days of move-out less documented damage. Move-in and move-out condition photos are recorded in the app.
- **Renewal:** the sitting tenant has first right to renew until `noticePeriodDays` before the end of the prepaid period. Renewals through NoLSAF follow the same pattern (first month through NoLSAF).
- **Overstay:** staying past the prepaid period without a renewal is a breach of the lease, handled between the parties.

### 6.6 How NoLSAF enforces the lease

NoLSAF does not refund money it does not hold. It enforces through:

1. **Records:** the signed lease, the booking receipt, both balance confirmations, notices and condition photos, available to both parties for a lawyer or court.
2. **Recovery from future payouts:** a refund a landlord owes under the lease, confirmed by admin, is recovered from that landlord's future NoLSAF payouts (renewals, other listings) through the existing `PAYOUT_RECOVERY` mechanism, and paid to the tenant as it is recovered.
3. **Suspension and trust record:** a landlord who does not pay a confirmed refund within 14 days is suspended from listing until settled.
4. **Tenant side:** a tenant who leaves without notice, overstays or causes confirmed damage beyond the deposit is barred from booking long stays.

### 6.7 Optional later: rent protection

An optional add-on through an insurer partner: the tenant pays a small premium and the insurer (not NoLSAF) covers prepaid rent the landlord fails to refund. Not in v1.

## 7. Full scenario (USD 4,500/month, 6 months)

Landlord: Mr. Juma. Tenant: Sarah, an NGO staffer relocating to Dar es Salaam.

| Date | Step |
|---|---|
| 1 Dec | Mr. Juma lists the house as Long stay: USD 4,500/month, min 6 months, 6 up front, furnished, water and security included, LUKU by tenant, 1-month deposit (collected by him), 30-day notice, balance by bank transfer, available from 1 Jan. Admin approves as usual. |
| 10 Dec | Sarah requests an in-person viewing. |
| 11 Dec | Mr. Juma confirms; they message inside NoLSAF. |
| 12 Dec | Viewing. |
| 13 Dec | Sarah offers 1 Jan move-in, 6 months. Mr. Juma accepts. Both accept the lease: USD 4,500 through NoLSAF, USD 22,500 balance to Mr. Juma at move-in. |
| 14 Dec | Sarah pays **USD 5,580** by card (USD 4,500 first month + USD 1,080 fee). NoLSAF books USD 1,080 as revenue and holds USD 4,500. House shows **Reserved**. |
| 1 Jan | Walk-through and condition photos. Sarah transfers **USD 22,500** to Mr. Juma's bank account, then gets the keys and pays the deposit to him. |
| 1 Jan | Mr. Juma confirms "USD 22,500 received, bank transfer". Sarah confirms paid, keys received, matches the listing. House shows **Let**. |
| 2 Jan | First long-stay payout for Mr. Juma, reviewed by hand, then **USD 3,150 released** (USD 4,500 less USD 1,350 commission). NoLSAF holds nothing. |
| 1 May | Renewal reminder (30 days before 30 Jun). |
| By 30 Jun | Sarah renews in the app: pays the July rent + fee through NoLSAF and the rest to Mr. Juma on 1 Jul. Or she does not renew and the listing shows "Available from 1 Jul". |

**NoLSAF per placement:** USD 2,430 gross (USD 1,080 + USD 1,350), USD 162 card fee, **USD 2,268 net (8.4%)**. Renewals done in the app earn the same again.

**If things go wrong:**

- **Not as listed, found at the walk-through:** Sarah does not pay the balance and reports it. Admin upholds; Sarah gets USD 5,580 back; Mr. Juma gets nothing and is suspended pending review. NoLSAF absorbs the USD 162 card fee (charging it to the landlord is an open decision).
- **Not as listed, found after paying the balance (reported by 4 Jan):** Sarah gets USD 5,580 back from NoLSAF; Mr. Juma must return the USD 22,500 within 14 days, enforced through suspension and recovery from his future payouts.
- **Sarah cancels on 10 Dec (more than 14 days out):** USD 4,500 back; NoLSAF keeps USD 1,080.
- **Sarah cancels on 25 Dec (14 days or less), or does not pay the balance on 1 Jan:** Mr. Juma gets USD 4,275 (USD 4,500 less 5% of that month); NoLSAF keeps USD 1,080 + USD 225.
- **Sarah leaves early (gives notice 20 Mar, leaves about 19 Apr):** under the lease Mr. Juma keeps Jan to Apr and refunds May and June (USD 9,000) within 14 days. If he does not, admin confirms the claim, he is suspended, and the amount is recovered from his future NoLSAF payouts.
- **Mr. Juma ends early without cause (wants Sarah out 31 Mar):** he must refund Apr to Jun (USD 13,500) within 14 days and give 30 days' notice. Same enforcement.
- **Sarah overstays past 30 Jun without paying:** lease breach between the parties; tenancy shows **Overdue**; Sarah is barred from future long stays if confirmed.
- **Balance mismatch:** Mr. Juma confirms only USD 18,000 received against a lease balance of USD 22,500. Payout held, tenancy flagged, admin contacts both sides.

### Risk summary

| Risk | Who carries it |
|---|---|
| Fake or mismatched listing | Landlord (no payout; tenant refunded from held money; balance not yet paid if found at walk-through) |
| Tenant cancels or fails to pay the balance | Tenant (fee, and the first month inside 14 days) |
| Tenant leaves early | Tenant forfeits up to the notice period; landlord refunds the rest under the lease |
| Landlord ends early | Landlord refunds under the lease; NoLSAF enforces via recovery and suspension |
| Under-declared term to dodge commission | Commission follows the signed lease term (never below listing minimum); balance confirmations must match |
| Renewals done off-platform | NoLSAF (lost renewal revenue; first placement is the core revenue) |
| Damage | Deposit, held by the landlord |
| Card processing | NoLSAF (from its fees) |

## 8. Data model sketch (indicative, nothing approved)

- `Property` (or unit level): `rentalMode` enum, plus a `LongStayTerms` JSON or table holding the fields in 3.1.
- `Tenancy`: property/unit, tenant, landlord, moveIn, termMonths, endDate, monthlyRent, currency, fee snapshot (rates, caps, T, L), lease acceptance timestamps, notice dates, status (`REQUESTED > VIEWING > OFFERED > RESERVED > AWAITING_MOVE_IN > ACTIVE > ENDING > ENDED`, plus `CANCELLED`, `DISPUTED`, `OVERDUE`).
- `TenancyBookingPayment`: the card payment (first month + T), linked to the invoice, with hold and release state feeding the existing payout ledger.
- `TenancyBalanceConfirmation`: expected amount, landlord confirmation (amount, date, method, timestamp), tenant confirmation (same), match status.
- `TenancyClaim`: refund owed under the lease, amount, due date, status (`OPEN > SETTLED / RECOVERING / RECOVERED`), linked to `PAYOUT_RECOVERY` when the landlord does not pay.
- `ViewingRequest`: slot, mode (in person / video), status.
- Condition photo sets at move-in and move-out.

All public references opaque (for example `tn_` prefix). MySQL 8 and MariaDB 11.8 compatible migrations. Nothing applied without approval.

## 9. Legal, tax, compliance (check before build)

- **Lease template:** the most important legal document in this feature. It must be reviewed by a Tanzanian lawyer, including the balance-at-move-in clause, the 14-day refund obligations, and NoLSAF's right to recover sums owed from the landlord's future payouts.
- **Listing terms for landlords:** the landlord agrees that NoLSAF's commission is calculated on the whole lease term, even though only the first month passes through NoLSAF, and agrees to the recovery right.
- **Holding funds:** limited to one month plus fee per tenancy, for up to about 63 days. Same pattern as group-stay deposits.
- **Landlord tax:** rental income tax and withholding tax may apply. Default: NoLSAF provides a statement only, no withholding, unless counsel says otherwise.
- **Tenant identity:** ID verification before the booking payment.
- **Fiscal receipts:** NoLSAF fees need receipts like other NoLSAF revenue.

## 10. Phasing

1. **Pilot:** Dar es Salaam, hand-picked verified landlords, entire apartments and houses only, admin-assisted viewings, all payouts reviewed by hand. Prove demand and the fee level.
2. **v1:** self-serve listing with rental mode, viewing requests, lease acceptance, booking payment, move-in walk-through with balance confirmations, payouts, renewal reminders, claims and recovery.
3. **Later:** `BOTH` mode on the same unit, rooms and shared housing, rent protection add-on, landlord tax statements, NRMS integration for serviced apartments.

## 11. Decisions

**Locked (2026-11-20):**

1. The tenant pays the **first month + tenant fee through NoLSAF** by card at booking; the **balance is paid directly to the landlord at move-in**. Same pattern as group stays.
2. NoLSAF holds the booking payment only until move-in is confirmed by both sides (72 hours), then releases the first month less commission (and any payout transfer fee) to the landlord.
3. Fees about 9% of the lease term: landlord 5% (cap 50% of a month), tenant 4% (cap 25% of a month), snapshotted per tenancy. The landlord cap guarantees the commission fits inside the first month.
4. Long-stay payments through NoLSAF are card only. The card fee is NoLSAF's cost. NoLSAF keeps about 8.4% of rent on 6-month terms, about 5.9% on 12 months.
5. After move-in, refunds are between the parties under the lease. NoLSAF enforces through records, recovery from future payouts and suspension, and never refunds money it does not hold.
6. Deposits are held by the landlord, never by NoLSAF.

**Locked (2026-11-21):**

7. **Admin-granted switch.** The full v1 flow is built, but only landlords an admin switches on can list long stays. The pilot is run by choosing who gets it; opening wider needs no new code.
8. **Minimum terms 3, 6 and 12 months.** One month is not offered.
9. **Homes and apartments only:** house, apartment, condo, villa, townhouse, bungalow, and separate units. Hotels, lodges and guest houses stay nightly.
10. **Tenant identity:** verified phone plus a passport (any country, ICAO 9303), a national ID card (NIDA, Kenya, Uganda, Rwanda, Burundi) or a Tanzania residence permit, with expiry, name and date of birth as printed, nationality, the back of a card and a selfie holding the document. Holder 18 or older, document valid at least 30 days and through the lease end. Approved once by an admin before the first booking payment, then reused until it nears expiry.

**Locked (2026-11-21, section 13):**

11. **NoLSAF is the bridge.** No viewing requests or direct messages before payment: the tenant reserves at the listed terms, the landlord confirms within 24 hours, and questions or visits go to NoLSAF. Contacts open once the first month is paid.
12. **Every long-stay home is inspected on site by a NoLSAF Sales Partner** before approval and reservations, again every 12 months, and at once after an upheld complaint about the home. No other route.
13. **Inspection fee:** NoLSAF pays the partner a flat fee (`SystemSetting.longStayInspectionFee`, default TZS 25,000) for every report it accepts, pass or fail, from its long-stay commission. The landlord pays nothing for it.

**Open:**

1. Lower landlord rate on renewals (3%) or same 5%, and how hard to push renewals through the app.
2. Charge the card fee to the landlord when a listing is found not as described.
3. Whether cash is ever allowed for the balance (v1: no).

## 12. Build plan

Security posture for every milestone: every endpoint is role-scoped and ownership-checked; no numeric ids in URLs (`tn_` references); money amounts are computed only on the server from the snapshotted terms, never accepted from a client; state changes go through one transition table with conditional updates (no double-pay, no skipped steps); impersonated sessions cannot accept a lease, pay, confirm money or change payout details; every step writes an audit event.

| # | Milestone | Contents |
|---|---|---|
| 1 | Foundations | Tables and migration (prepared), fee calculator, tenancy state machine, tests |
| 2 | Landlord side | Admin grant switch; wizard rental-mode step and long-stay terms; admin moderation shows terms |
| 3 | Tenant identity | ID upload, admin review queue, tenant bar |
| 4 | Discovery and request | Public listing shows monthly terms and availability; viewing request and confirmation; masked messaging |
| 5 | Offer and lease | Offer, landlord accept, NoLSAF standard lease generated and accepted by both (hash + timestamps) |
| 6 | Booking payment | Card checkout for first month + tenant fee as a new hardened payment target; 48h payment window; Reserved |
| 7 | Move-in and payout | Walk-through photos, two-sided balance confirmation with 72h auto-confirm, mismatch hold, payout (first one manual), revenue ledger entries |
| 8 | After move-in | Notices, renewal reminders, claims and `PAYOUT_RECOVERY`, cancellations per 6.4 |

Before go-live, outside code: lawyer review of the lease template and landlord listing terms (section 9).

### Progress

- **Milestone 1 (2026-11-21):** schema, migration `20261121100000_add_long_stay_rentals` (prepared, not applied), `lib/longStay/fees.ts`, `lib/longStay/tenancyState.ts`.
- **Milestone 2 (2026-11-21):**
  - Admin switch per landlord: `Long stays` card on the admin owner page, `/api/admin/long-stay/landlords/:ownerId` (ENABLE, PAUSE with reason, RESUME, DISABLE with reason; audited).
  - Wizard: "How do you rent it out?" (By the night / Monthly) at the top of the rooms step, shown only to switched-on owners on home types. Monthly forces the whole place, hides the nightly price, and adds the "Monthly rent and terms" card with a fee preview from `/api/owner/long-stay/quote`.
  - Terms are saved with the listing (`rentalMode` + `longStay` on the listing PUT/POST) and validated only in `lib/longStay/listing.ts`; a refusal leaves the listing untouched. Assisted listings cannot use long stay.
  - Submit and admin approve re-check the switch, type and terms. **Approval of long-stay listings is refused while `LONG_STAY_BOOKINGS_OPEN` is false** (until milestones 4 to 6), so none can go on sale or be booked by the night; nightly booking also refuses any LONG_STAY property.
  - Moderation shows a "Long stay" badge and a terms panel with the server's fee preview.
- **Milestone 3 (2026-11-21):**
  - Tenant page `/account/long-stay-id`: NIDA (20 digits, TZ) or passport (6 to 9 characters plus issuing country) and a photo. Traveller accounts only, phone must be verified, never during a support session, 6 submissions an hour. An approved ID cannot be replaced by the tenant; a pending one can.
  - **ID standards (2026-11-21, migration `20261121120000_long_stay_id_standards`, not applied):** documents are PASSPORT (ICAO 9303 number, issuing state ISO 3166-1 alpha-2), NATIONAL_ID (per-country number format: TZ 20 digits, KE 7 to 9 digits, UG 14 starting CM/CF, RW 16 digits, BI 6 to 20; citizens only) and RES_PERMIT (TZ only, foreigners only). Expiry, holder name, date of birth and nationality are stored; front, back (cards) and a selfie are separate private uploads. The server refuses minors, documents expiring within 30 days, and (at lease acceptance and payment) IDs that expire before the lease ends. An approved ID may be replaced by the tenant within 60 days of expiry, and shows in the admin Expiring tab.
  - Review: the admin page shows counters, search (name, phone, email, last 4) and document and country filters, a name match hint, and the automatic checks. **Approve needs every photo opened by that admin since submission (checked against the audit log server side) and both "name matches" and "face matches" ticked.** Viewing a photo fails closed if its audit row cannot be written.
  - Storage: the photo is a private (authenticated) Cloudinary upload under `traveller-documents/long-stay-id/`, recorded as a `UserDocument`. The number is kept only as a keyed hash plus the last 4 characters (`lib/longStay/tenantIdentity.ts`). **Set `LONG_STAY_ID_HASH_SECRET` before go-live**; until then the hash falls back to the public link secret, and rotating that would stop duplicate IDs being spotted.
  - Admin queue `/admin/long-stay/tenants` (sidebar: Tenant IDs): To check, Verified, Rejected, Barred. The photo opens through a 5-minute signed link and every view is audited; Approve stays disabled until the photo was opened. Reject and Bar need a reason; a check is decided once (a second admin gets 409); an admin cannot review their own ID. The same ID number on other accounts is flagged to the reviewer only.
  - Admin alert `long_stay_tenant_id_submitted` closes itself once the check is decided; the tenant gets an in-app notice on approve or reject.
  - `tenantPaymentRefusal()` is ready for milestone 6: only an approved, unbarred tenant may pay.
- **Milestone 4 (2026-11-21):**
  - **Opening switch is now env `LONG_STAY_OPEN=1`** (`longStayOpen()` in `lib/longStay/fees.ts`). Off by default and to stay off in production until milestone 6. While off: no long-stay approval, no viewing requests. Staging can switch it on to test.
  - Public listing: the property API returns `rentalMode` and public terms (`publicLongStayView`: rent, term, up front, deposit, furnishing, bills, notice, occupants and pets, earliest move-in after any current tenancy). Balance methods stay private. The side card shows "per month" and **Request a viewing** instead of the nightly booking card. The main search lists nightly homes only; `?rental=long-stay` lists long stays.
  - Viewing request: in person or video, 1 to 3 times (at least 2 hours out, within 60 days, EAT), optional earliest move-in and note. Traveller account, verified phone, not barred, never in a support session, 10 an hour, 5 open requests per tenant, one open request per home, not your own home, landlord's switch must be on. Creates a `REQUESTED` tenancy with a random `tn_` reference.
  - Landlord (`/owner/long-stays`, shown in the sidebar only when switched on): confirm one of the proposed times or another (`VIEWING`), decline with a reason, message. Tenant (`/account/long-stays`): withdraw with a reason, message.
  - Messages are tenancy events. Phone numbers, emails and links typed before the viewing is confirmed are replaced by "[number hidden]" and the like; once confirmed, each side sees the other's phone. Views never include row ids or the other side's email. Notices go to the other side on request, confirm, decline and message.
- **Milestone 5 (2026-11-21):**
  - Offer (tenant, after the viewing): move-in date and term. Term between the listing's minimum and maximum (24 if none); move-in from the later of "available from" and two days out, and **no more than 60 days out** (payment is allowed at most 60 days before move-in). Dates may not overlap another tenancy holding the home. The tenant sees a live preview from `/tenancies/:ref/quote`. The tenant can change the offer; the landlord can decline it with a reason; both return the request to `VIEWING`.
  - Landlord accepts (`ACCEPTED`): the switch, listing, dates and overlap are checked again, then the money is computed once on the server and frozen on the tenancy (rent, up front, rates and caps, tenant fee, commission, booking amount, balance, landlord payout) with the lease inputs.
  - Lease (`lib/longStay/lease.ts`, version `LS-2026.11-draft`): built only on the server from the frozen inputs; stored as its SHA-256. Each side accepts by sending the hash of the text it read; a wording change in code makes old hashes stop matching, so nobody can accept text they did not see. **The tenant needs an approved long-stay ID to accept.** When both accept, the tenancy moves to `AWAITING_PAYMENT` with `paymentDueAt` 48 hours out. Either side may still close the request before payment.
  - **Legal:** the lease wording is a draft and must be reviewed by a Tanzanian lawyer before `LONG_STAY_OPEN` is switched on in production. Bump `LEASE_VERSION` on any wording change.
- **Milestone 6 (2026-11-21):**
  - Card checkout `POST /api/payments/coralcommerce/card/tenancy/initiate { ref }` (`lib/longStay/payment.ts`): tenant only, never in a support session, rate-limited, only while `AWAITING_PAYMENT` and before `paymentDueAt`, both leases accepted, tenant ID approved and not barred, landlord's switch still on. It charges the **frozen** `bookingAmount` in the tenancy's currency. One random `LST-` reference per tenancy, reused on retries.
  - Settlement is a new target inside the existing Coral handler, so it inherits every postback hardening (only a verified callback, or a postback passing every strict check, can settle; postback-only settlements alert admins). PaymentEvent has no tenancy column, so the tenancy reference rides in the event payload and the same-target check compares it: one Coral transaction can never settle two targets.
  - `settleTenancyPayment`: reserves once (compare-and-set to `RESERVED`, `payoutStatus HELD`); a repeat notice is a no-op; a different amount or currency never reserves and raises `long_stay_payment_review`; money arriving for a closed lease is recorded (`REFUND_DUE`) and raises the same alert for a refund. Both sides are notified on reserve. Coral notices carry no amount; the price is set by us at checkout from the frozen tenancy.
  - Worker `longStayPayments` (every 15 minutes, leader only): closes `AWAITING_PAYMENT` leases unpaid past 48 hours (30 minutes' grace when a checkout was opened) and tells both sides; moves `RESERVED` to `MOVE_IN` on the move-in day (EAT).
  - Tenant UI: "Pay {amount} by card" with the deadline, a banner on return from checkout, and the reserved / move-in-day steps.
  - Left for milestone 7: revenue ledger entries (adding a `LONG_STAY` stream touches the finance overview and reconciliation), move-in confirmations, payout.
- **Milestone 7 (2026-11-21):**
  - Move-in (`lib/longStay/moveIn.ts`): each side confirms once on move-in day (a reserved tenancy whose date has come opens it on the spot). Landlord: balance received and method. Tenant: balance paid, method, keys received and home as listed; anything else is a dispute. Both confirmed, or one confirmed and the other silent for **72 hours** (worker), moves the tenancy to `ACTIVE`. Any confirmed balance that differs from the lease sets `balanceMismatch` and holds the payout (`REVIEW`). Nobody confirming for 7 days alerts admins once.
  - Disputes: either side, from reserved to the end of the stay, with a reason; the tenancy goes to `DISPUTED` and a held or ready payout to `REVIEW`. Condition photos (up to 12 at a time, 20 sets) are tenancy events, shown to both sides.
  - Payout (`lib/longStay/payout.ts`): `HELD` (paid) → `READY` or `REVIEW` (after move-in) → admin approval. **Every long-stay payout is approved by an admin in the pilot.** TZS goes through the shared payout ledger as a new `TENANCY` source (eligibility re-checks the tenancy, pays the frozen landlord payout, never more than was paid or one month's rent, to the landlord's verified mobile money account; the usual Disbursements approve, batch and release follow; PAID writes back `RELEASED`). AzamPay pays TZS mobile money only, so **USD payouts are paid by bank and recorded by hand** with the reference. Admins cannot act on a tenancy they are part of.
  - Admin page `/admin/long-stay/tenancies` (sidebar: Long stays): Payouts, Problems, Refunds owed, Moving in, All; approve payout, record bank payout, decide (where the tenancy goes and what happens to the first month: pay landlord, keep reviewing, refund tenant), history. All audited.
  - **Revenue ledger (2026-11-21, follow-up):** new `LONG_STAY` stream, recognized once at confirmed move-in (gross = first month + tenant fee, commission = tenant fee + landlord commission, partner net = landlord payout), reversed if an admin later refunds the first month. The finance overview shows a "Long stay" stream with the same rule, the reconciliation compares them per tenancy, and the backfill script covers it. See docs/REVENUE_LEDGER.md.
- **Milestone 8 (2026-11-21):** migration `20261121110000_add_tenancy_claims` (prepared, not applied): table `tenancy_claim` and `tenancy.payoutDeduction`.
  - **Cancellation after payment** (`lib/longStay/lifecycle.ts`, section 6.4), from `RESERVED` only, with a preview of the money first. Tenant more than 14 days out: first month refunded, fee kept. Tenant 14 days or less: landlord gets the first month less 5% (USD 4,275 in the spec), NoLSAF keeps fee + 5%. Landlord: everything back to the tenant; the second paid cancellation by a landlord pauses their long stays. The split is frozen on the tenancy (`termsSnapshot.cancellation`); refunds are `REFUND_DUE` for an admin, landlord shares are `READY` payouts.
  - **One revenue rule** (`lib/longStay/revenueFigures.ts`) used by the ledger, the finance overview and the reconciliation: moved in, or cancelled with fees kept (earned at the cancellation). The backfill covers both.
  - **Notice** (ACTIVE to ENDING): leave date at least the lease's notice period away and not after the lease end; a landlord must state a lawful ground (admins are alerted). The end date moves to the leave date, so the home shows available from then. **Move-out**: the landlord confirms from the end date (ENDED). **Overdue**: past the end by 3 days with no move-out, both sides and admins are told. **Renewal reminder** once, when the notice window opens. **Renewal**: the sitting tenant, within 60 days of the end, opens a new request straight at VIEWING and goes through offer, lease and first-month payment as usual, from the day the current lease ends.
  - **Claims** (`lib/longStay/claims.ts`, section 6.6): an admin records what the landlord owes the tenant (unused months, a balance), within the lease's rent, due in 14 days; both sides see it; the tenant can confirm receipt. Past due: the landlord's long stays pause and the claim is recovered oldest first from the landlord's next long-stay payouts in the same currency (`payoutDeduction`; a payout fully used up sends nothing), then an admin passes it to the tenant and marks it paid. Admin tabs: Ending, Claims.
  - **Not done, still open:** (1) none for the ledger. (2) Refunds marked `REFUND_DUE` are paid back by hand for now (no card refund automation). (3) Section 6.4 cancellation rules after payment (14-day split) are decided by admins through "Decide", not yet automatic.

## 13. NoLSAF as the bridge: inspection, reserve, Ask NoLSAF (2026-11-21)

Daniel's direction: the landlord lists everything (rent, terms, location, availability); the tenant decides from the listing; NoLSAF stands between them until money moves, and a NoLSAF Sales Partner verifies every home on site. Built 2026-11-21 (uncommitted), migration `20261121130000_long_stay_inspections_enquiries` (not applied).

**Inspection (`lib/longStay/inspection.ts`, `long_stay_inspection`).**
- Landlord submission opens an inspection request. An approval attempt without a current pass also opens a request if none is pending.
- For localhost approval, set `LONG_STAY_OPEN=1` in the API environment and leave `LONG_STAY_REQUIRE_INSPECTION` unset or set it to `0`. The admin can approve while the inspection stays in the visit queue. Set `LONG_STAY_REQUIRE_INSPECTION=1` and restart the API to require a current pass before approval. Reservations require a current pass in either mode.
- An admin assigns a partner by agent code. Never the owner, never the partner attributed to the home (no marking your own homework). 5 days to visit.
- The partner reports from the home in `/sales/inspections`. The report includes phone GPS, exactly three different photos taken on site (entrance, main living area, and the most serious visible issue or a kitchen or bathroom), a 12-item checklist, a PASS or FAIL recommendation, and an overall note. Every No answer needs a short finding and can link to one of the three photos. All nine required items must be Yes to recommend PASS.
- The server measures the distance from the listing pin and flags NO_PIN, FAR_FROM_PIN (over 300 m), LOW_ACCURACY (over 100 m), DUPLICATE_PHOTO (hash seen on another inspection) and LATE_UPLOAD. FAR_FROM_PIN and DUPLICATE_PHOTO block a pass.
- Admin decides in `/admin/long-stay/inspections` after opening every photo (signed, audited): PASS (valid 12 months), FAIL (landlord told why), or REDO (back to the partner, no fee).
- **Fee:** PASS and FAIL both credit the flat fee as a `LONG_STAY_INSPECTION` sales earning (`ELIGIBLE`, idempotent on `LONG_STAY_INSPECTION:<id>`, needs an earning contract). Same fee either way, so passing a weak home earns nothing extra; REDO earns nothing, so a lazy report costs the partner.
- An upheld dispute can end the inspection and request a new visit through Decide. New reservations pause until the home passes again.
- The public page shows the visit date, NoLSAF review date, validity and all recorded checklist results for homes with a current pass. Other homes show the current review status. Photos, location evidence, notes and inspector identities stay in the admin review.

**Reserve (`offerService.createReservation`).** Tenant (verified phone, not barred, max 3 open) reserves at the listed terms; the tenancy starts at OFFERED with `offeredAt`. Landlord confirms (`acceptOffer`, within 24 hours and with a current inspection) or declines with a reason. The worker lapses unanswered reservations. Confirming closes other reservations whose dates now clash. Renewal is a reservation from the current end date. REQUESTED and VIEWING are gone from the state machine.

**Ask NoLSAF (`lib/longStay/enquiry.ts`, `long_stay_enquiry`).** QUESTION or VISIT (up to 3 times, 4 hours to 30 days out), contacts typed by the tenant hidden, max 5 open per tenant. Admin answers in `/admin/long-stay/enquiries`, seeing the landlord's phone to ask on the tenant's behalf; a VISIT gets an agreed time and a Sales Partner, who sees it in `/sales/inspections`. Tenants read answers in `/account/long-stays`.

**Contacts.** Names, phone numbers and the message thread open at RESERVED (first month paid). Before that `postMessage` refuses and the view hides the other side's name.

## 14. Sales Partner share on long stay (approved by Daniel 2026-11-26)

A partner who brings a long-stay home is expected to advertise and market it, so they earn from every tenancy there, the same way they earn on nightly stays. Before this, the bringing partner earned nothing on long stay (sales commission was only created from paid booking invoices; tenancies have none).

- **Who:** the partner on the home's `MARKETPLACE` sales attribution, while that attribution and their contract are earning on the move-in date. Never the inspector's fee: the bringing partner may not inspect their own home (section 13).
- **What:** the contract's `marketplaceRevenueRate` (the same rate as nightly stays) on NoLSAF's own long-stay fees for that tenancy: tenant fee plus landlord commission (`lib/longStay/revenueFigures.ts`, the single revenue rule). The fees are treated as tax-inclusive at `SystemSetting.taxPercent`, so the partner's share is of NoLSAF's net, never more.
- **When earned:** at confirmed move-in, the moment the `LONG_STAY` revenue is recognized. Recorded as a `LONG_STAY_TENANCY` sales commission, idempotent on `TENANCY:<id>`.
- **When withdrawable:** 14 days after move-in (status `VALIDATING` until then, then `ELIGIBLE` through the normal lifecycle worker), so a refund soon after move-in never pays out money NoLSAF must give back.
- **Reversed:** if the first month is refunded after move-in (`REFUND_DUE` / `REFUNDED`), or the tenancy no longer counts as a move-in. Paid shares are offset against the partner's next payout (`autoReverseSalesCommission`).
- **Blocked (recorded as reversed with the reason):** the partner owns the home, or the partner is the tenant.
- **Every tenancy counts**, not only the first: each new tenant who moves in earns again while the attribution runs. That is the partner's reason to keep marketing the home.
- **Safety net:** the sales commission worker accrues any moved-in tenancy that was missed and reverses refunded ones, the same as for nightly stays.
- Example (section 14): TSh 500,000 a month, 12 months. Landlord fee 5% capped at half a month = 250,000; tenant fee 4% capped at a quarter month = 125,000. NoLSAF earns 375,000; at a 20% contract rate (example only) and 18% VAT inclusive, the partner earns about 63,500.

## 15. Long stay on an assisted listing (approved by Daniel 2026-11-26)

A Sales Partner listing a home for an owner (docs/SALES_ASSISTED_LISTING.md) can now offer it as long stay. Before this, assisted listings refused long stay outright and the partner had no way to ask.

- **Request:** on the lead's "List it for the owner" card the partner writes one sentence and taps **Request long stay** (`POST /api/sales/leads/:id/assisted-listing/long-stay-request`). One waiting request per listing, only from the partner who owns it, only while the listing is DRAFTING or RETURNED, only for home types. New table `long_stay_access_request` (migration `20261126100000_add_long_stay_access_requests`, prepared, not applied), opaque `lr_` references.
- **While waiting:** the partner may already choose Monthly and write the terms in the owner's wizard (it calls `/api/sales/leads/:id/assisted-listing/long-stay/{eligibility,quote,lease-preview}`, the same answers an owner gets). Submitting still needs the owner's switch (`longStaySubmitRefusal`), with partner wording.
- **Admin:** `/admin/long-stay/requests` (Waiting, Approved, Declined, All) plus the `long_stay_access_requested` notification and an overview tile. **Approve** creates the owner's `LongStayLandlordGrant` (per owner, all their homes, note records the request) and texts the owner with a fresh "Not expecting this?" link. **Decline** needs a note the partner sees; the listing can continue as nightly.
- **Owner objects:** a waiting request is withdrawn when the listing pauses. If an admin then cancels the listing, a switch that came only from this request is removed, unless the owner has another long-stay home or an admin switched them on another way.
- **Money stays with the owner:** payouts go only to an account the owner adds and verifies. The bringing partner earns the section 14 share and may not inspect the home (section 13).
