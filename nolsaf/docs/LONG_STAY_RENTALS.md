# Long-Stay Rentals (monthly, minimum term)

**Status:** ON HOLD. Agreed as something NoLSAF needs; parked until scheduled. Nothing built, no migrations.
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

1. **Request viewing.** Tenant picks a slot, in person or video. No money.
2. **Viewing confirmed** by landlord. Contact details stay masked inside NoLSAF messaging until this point.
3. **Offer.** Tenant chooses move-in date and term (at least `minTermMonths`). Landlord accepts.
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

**Open:**

1. Lower landlord rate on renewals (3%) or same 5%, and how hard to push renewals through the app.
2. Charge the card fee to the landlord when a listing is found not as described.
3. Minimum terms offered: 1, 3, 6, 12 months, or 6 and 12 only.
4. Whether cash is ever allowed for the balance (v1: no).
5. Whether hotels and lodges can offer monthly rates under this model, or entire homes and apartments only.
