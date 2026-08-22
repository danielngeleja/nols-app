# Sales Partner Workspace: Onboarding, Attribution, Earnings, Payouts

Document type: product design and historical implementation log. Migration
status statements below describe the moment they were written and are not
release instructions. Current delivery status and environment actions are
governed by [`ENGINEERING_DELIVERY_POLICY.md`](ENGINEERING_DELIVERY_POLICY.md).

Status: APPROVED, PHASE 1 IN PROGRESS. Schema and entitlement layer are written and typecheck clean. No migration has been generated and none will be: Daniel applies schema changes himself. Progress is logged in section 19. This document is the agreed scope; it is edited here first and only then implemented.
Owner: Daniel
Written: 2026-07-26
Revised: 2026-07-26. Trial length corrected to policy data rather than a fixed 45 days (moving to 15). Partner economics added at 7.4. Levels rebased on revenue generated rather than property count.

## 1. Purpose

NoLSAF needs a field sales force that is paid for outcomes rather than effort. A sales partner convinces a property owner to run NRMS, to list on the NoLSAF marketplace, or both. In return the partner earns a share of the revenue that property actually generates for NoLSAF, for as long as their contract is live.

Two commission streams, agreed commercially:

| Stream | Rate | Applied to |
|--------|------|-----------|
| NRMS usage share | 14% | Eligible net NRMS revenue collected from the attributed property |
| Marketplace revenue share | 20% | Eligible net commission NoLSAF earned on bookings at the attributed property |

The partner does not receive 20% of booking value. NoLSAF's own take on accommodation is around 10%, so 20% of booking value would be double the platform's revenue. The 20% applies to NoLSAF's commission after deductions. This distinction is the single most expensive thing to get wrong and it is restated in section 7.

This document covers the access model, the data model, both commission engines, every screen, every route, the security posture, and a build order. It is written against the real codebase, not against assumptions.

## 2. Governing principles

1. **No new login system.** A sales partner is an ordinary NoLSAF user who registered normally. Same email, same password, same `User` row, same session. Access to the sales workspace is an entitlement granted by an admin, never a change of `User.role`.
2. **Money is a ledger, never a calculation.** Every shilling a partner earns is a row written at the moment NoLSAF actually collected the underlying cash, with the contract rate snapshotted onto it. Balances are always summed from rows. No editable total is ever stored on a profile.
3. **Commission follows collection, not billing.** An invoice raised is not revenue. A commission is written when payment settles, and reversed when it is refunded or charged back. This protects both sides: NoLSAF never pays out on money it did not receive, and the partner never has an earning silently deleted.
4. **The partner sells, the admin verifies.** Partners create leads, work them, and request conversion. Partners never verify their own attribution, never approve their own commission, and never set their own rates.
5. **Attribution is exclusive and durable.** One property plus one product line binds to exactly one partner, enforced by a database constraint rather than by application logic.
6. **The contract is the gate.** Access, rates and the earning window all derive from a signed contract with a start and an expiry. When it lapses, earning stops and the workspace closes until it is renewed.
7. **Every sensitive action is audited.** Promotion, rate changes, attribution decisions, commission approval and reversal, and payout payment all write an audit row with actor, before state and after state.
8. **Existing guardrails apply.** `blockImpersonated` on every money-moving endpoint, admin 2FA re-auth for destructive actions, and the `tokensValidAfter` model for killing live sessions.

## 3. Reconciliation with the existing codebase

The originating brief was written against a generic stack. Several of its assumptions do not hold here. These are corrections, not preferences, and each one would have failed at build time or produced wrong money.

| # | Brief assumed | This codebase actually is | Decision |
|---|---------------|---------------------------|----------|
| 1 | `String @id @default(cuid())` on every model | Zero cuids in 5,559 lines. `User.id`, `Property.id`, `Booking.id`, `Invoice.id` are all `Int @default(autoincrement())` | Use `Int` autoincrement throughout. A `propertyId String` relation to `Property.id Int` does not compile. `agentCode`, `contractNumber` and `referenceNumber` stay unique strings because they are business identifiers |
| 2 | Eleven Prisma `enum` blocks | Zero enums in the schema. Status is always `String @db.VarChar(n)` with the value set in a doc comment, validated by Zod at the route boundary | Follow the existing convention. Value sets live in one shared TS constants module that Zod and the UI both import. Enums here would make every new status a migration |
| 3 | Models without table mapping | 146 models, every one carries `@@map("snake_case")` | Map every new table: `sales_partner_profile`, `sales_commission`, and so on |
| 4 | NRMS is a subscription with a plan and a `sourceSubscriptionId` | NRMS is pay as you go. Usage accrues into `NrmsUsageEvent`, closes into `NrmsBillingStatement`, and becomes cash when `NrmsServicePayment` settles and `NrmsBillingStatement.paidAt` is set | The 14% hangs off a paid statement. There is no subscription object to point at |
| 5 | Trial exclusion needs custom logic, on a fixed 45 day trial | `NrmsUsageEvent.classification` already distinguishes `BILLABLE_EXTERNAL` from `TRIAL_FREE`. Trial length is `NrmsUsageChargePolicy.trialDays`, admin-configurable policy data, not a constant. It defaults to 45 and is moving to 15 | Trial exclusion is free and needs no commission-side logic. Never hard-code a trial length anywhere in the commission engine: read the policy snapshotted on the account. Trial usage never reaches a payable statement, so it never generates commission |
| 6 | `Booking` carries NoLSAF's commission | `Booking` has `totalAmount` only. NoLSAF's accommodation commission lives on `Invoice.commissionPercent` and `Invoice.commissionAmount`, one invoice per booking, moving DRAFT to PAID | The 20% is applied to `Invoice.commissionAmount` when the invoice reaches `PAID`. This corrects an earlier reading of the schema |
| 7 | A new `SalesAuditLog` table | `AuditLog` already exists with actor, action, entity, entityId, beforeJson, afterJson, ip, ua, and a helper at `apps/api/src/lib/audit.ts` | Reuse `AuditLog`. A parallel audit table would split the trail in two |
| 8 | "Agent" is available as a name | `Agent` is already the tour operator model, `User.role = 'AGENT'`, with its own BRONZE to PLATINUM tiers | `SalesPartnerProfile` is the correct name. "Agent ID" survives as display text only |
| 9 | MySQL | MySQL 8, confirmed | No change |
| 10 | Next.js and Express | `apps/web` (Next.js, route groups `(admin)`, `(owner)`, `(driver)`) and `apps/api` (Express, `routes/*.ts`) | New route group `(sales)`, new route files `sales.*.ts` and `admin.sales.*.ts` |

Out of scope for v1, noted so nobody assumes otherwise: group stay revenue, transport commission, and tour bookings are separate revenue streams with their own models. Attribution is per property, so they can be added later as additional commission source types without reshaping the ledger.

## 4. Access model

### 4.1 Entitlement, not role

`User.role` is untouched. A new table grants workspace aliases:

`UserWorkspaceAccess` with `workspace` in {NORMAL, SALES} and `status` in {PENDING, ACTIVE, SUSPENDED, EXPIRED, REVOKED}, unique on (userId, workspace).

A user may hold normal access, sales access, or both. Admin retains unrestricted access for administration and support.

### 4.2 The gate

Sales workspace access is granted only when all five hold:

```
UserWorkspaceAccess.workspace = SALES
UserWorkspaceAccess.status    = ACTIVE
contract.status               = ACTIVE
contract.startsAt            <= now
contract.expiresAt            > now
```

`UserWorkspaceAccess.expiresAt` mirrors the contract expiry so the common check is one indexed read, but the contract stays authoritative and is re-read on every money operation.

### 4.3 Login flow

Login is unchanged. After a successful sign in:

1. Load the user and their active entitlements.
2. Normal access only, redirect to the existing NoLSAF experience. Nothing changes for the 99% of users.
3. Normal plus sales access, show the workspace selector.
4. The selection is stored server side and mirrored in a signed cookie. A client-supplied workspace value is never trusted on its own; every protected route re-checks the entitlement server side.
5. A workspace switcher in the account menu allows changing workspace without signing out.

Selector copy:

```
Welcome back, Amon

Choose where you want to continue:

NoLSAF Marketplace
Manage your normal account and platform activity.

Sales Partner Workspace
Manage leads, properties, earnings, contracts and payouts.
```

## 5. Data model

Ten new tables plus two columns on the existing `SystemSetting`. All `Int` ids, all `@@map`ped, all status fields as `VarChar`. What is deliberately **not** added is listed in 5.2.

| Model | Table | Purpose | Key constraint |
|-------|-------|---------|----------------|
| `UserWorkspaceAccess` | `user_workspace_access` | Grants a workspace alias to an existing user | unique (userId, workspace) |
| `SalesPartnerProfile` | `sales_partner_profile` | Sales identity, level, region, payout destination | unique userId, unique agentCode |
| `SalesPartnerContract` | `sales_partner_contract` | Rates, window, signature evidence, renewal chain | unique contractNumber |
| `SalesLead` | `sales_lead` | Prospect being worked, with claim protection | indexed on phone, email, name |
| `SalesLeadActivity` | `sales_lead_activity` | Append-only lead timeline | indexed (leadId, createdAt) |
| `PropertySalesAttribution` | `property_sales_attribution` | Binds property plus product to one partner | **unique (propertyId, productType)** |
| `SalesCommission` | `sales_commission` | The earnings ledger | **unique sourceKey** |
| `SalesPayoutRequest` | `sales_payout_request` | Withdrawal request and its review trail | unique referenceNumber |
| `SalesPayoutItem` | `sales_payout_item` | Locks one commission to one payout | **unique commissionId** |
| `SalesMaterial` | `sales_material` | Admin-managed sales enablement library | indexed (category, isPublished) |

The three bolded constraints are the whole integrity story and are worth stating plainly:

- unique (propertyId, productType) means two partners can never both earn on the same property and product.
- unique sourceKey means a replayed payment webhook is a no-op rather than a double payout. The key is deterministic, for example `NRMS_STATEMENT:412` or `INVOICE:9033`.
- unique commissionId on the payout item means an earning can never be claimed by two payout requests.

Each is enforced by the database, not by application code, because application code loses races.

### 5.1 Notes on specific fields

- Money is `Decimal(12, 2)`, matching every other money column in the schema. Rates are `Decimal(5, 2)`.
- `SalesCommission` stores `commissionRate` as a snapshot from the contract. A later renegotiation never rewrites history.
- `SalesCommission` stores every deduction (`taxAmount`, `processingFeeAmount`, `refundAmount`, `discountAmount`) alongside `grossAmount` and `eligibleNetRevenue`, so the calculation drawer in section 10.4 can show the full arithmetic rather than a bare number.
- Source pointers (`sourceStatementId`, `sourceInvoiceId`, `sourceBookingId`) are plain indexed `Int` columns rather than foreign keys. Those rows are never hard deleted, and this avoids adding relation fields to `Invoice`, `Booking` and `NrmsBillingStatement`, three of the most heavily used models in the schema. Idempotency is guaranteed by `sourceKey`, not by the FK.
- `SalesPayoutRequest` snapshots the payout destination at request time, so editing the profile mid-flight cannot redirect a payment.
- Reversals never edit the original row. The original moves to `REVERSED` and a linked negative row records the offset, so the ledger stays append-only and reconcilable.

### 5.2 Reuse decisions: what is deliberately not added

The original brief specified several structures that already exist here in another form. Adding them would have created a second source of truth for something the platform already answers. Each was checked against the codebase before being dropped.

| Brief asked for | Already exists as | Decision |
|-----------------|-------------------|----------|
| `SalesAuditLog` table | `AuditLog` (actor, action, entity, entityId, beforeJson, afterJson, ip, ua) with the helper at `apps/api/src/lib/audit.ts` | Reuse `AuditLog`. Sales actions use the `SALES_*` action prefix. A parallel audit table would split the trail in two and break the existing admin audit viewer |
| A notifications table | `Notification` (userId, title, body, read state) | Reuse. Partner notifications are ordinary user notifications |
| `SalesPartnerLevelRule` table | `apps/api/src/lib/agentLevel.ts`, the established pattern: tiers are a TypeScript spec constant declared as single source of truth, imported by both the dashboard and the admin panel so the two can never disagree | Drop the table. Add `apps/api/src/lib/salesPartnerLevel.ts` on the same pattern. Levels are display only and the thresholds are a starting guess, so a deploy to retune them is acceptable and is how every other tier model here already works |
| A contract template table | Templates are files: markdown plus a `.fields.json` dictionary in `docs/` (see `NoLSAF_Operator_Mutual_NDA.md`), validated through `contractTemplateFieldDictionarySchema` and `admin.contractTemplates.ts` | Reuse. The sales contract template becomes `docs/NoLSAF_Sales_Partner_Agreement.md` plus its field dictionary. `SalesPartnerContract.contractFileUrl` holds only the rendered signed PDF |
| Rates configured per deployment | `SystemSetting` singleton already holds `commissionPercent`, `driverCommissionPercent`, `agentCommissionPercent` and their currencies | Add two columns, `salesNrmsCommissionPercent` (default 14.00) and `salesMarketplaceRevenuePercent` (default 20.00), rather than a new table. These are the defaults used when issuing a contract. The contract still snapshots them, so changing the default never alters a signed agreement |

Two structures were checked and kept as new because no equivalent exists: `SalesMaterial` (the only content library is `SiteUpdate`, which is public marketing updates) and the payout pair `SalesPayoutRequest` and `SalesPayoutItem`. The payout pair intentionally mirrors the shape of the existing `ReferralEarning` and `ReferralWithdrawal` models used for drivers, so the two payout systems read alike, but they stay separate tables because the driver models carry driver-specific columns.

## 6. Lifecycle: lead to payout

```
Admin promotes an existing user
        |
        v
SalesPartnerProfile created, agent code issued, contract issued (status SENT)
        |
        v
Partner signs digitally  ->  contract ACTIVE  ->  workspace access ACTIVE
        |
        v
Partner registers a lead  ->  60 day claim protection opens
        |
        v
Partner works the lead (calls, meetings, proposal, documents)
        |
        v
Partner requests conversion  ->  admin verifies  ->  attribution VERIFIED then ACTIVE
        |
        v
Property earns money for NoLSAF
        |
   +----+----------------------------+
   |                                 |
NRMS statement paid            Invoice reaches PAID
   |                                 |
   v                                 v
SalesCommission (14%)          SalesCommission (20%)
        |
        v
Validation window clears  ->  ELIGIBLE  ->  admin approves  ->  AVAILABLE
        |
        v
Partner requests payout  ->  commissions locked  ->  admin approves and pays  ->  PAID
```

### 6.1 Lead claim protection

Before a lead is created the system checks for a possible duplicate on property name, phone, email, and location, plus registration and tax number where available. A likely duplicate does not hard block the partner. It raises a warning and flags the lead for admin review, because a legitimate second approach to the same hotel is common and an automatic rejection would make the tool feel hostile.

Protection runs 60 days from registration and extends when meaningful activity is recorded, so a partner who is genuinely working a lead keeps the claim and a partner who parks names loses it.

## 7. Commission engines

Two independent engines. Neither reads a hard-coded rate: both read the active contract and snapshot the rate onto the row.

### 7.1 NRMS usage share, 14%

Trigger: an `NrmsBillingStatement` transitions to paid, that is `paidAt` becomes non-null via `reconcileNrmsPayment`.

Statements are not calendar-monthly. `applyNrmsBilling` opens a payable statement the moment an account reaches `PAYMENT_REQUIRED`, which is driven by `unpaidBalance` crossing `unpaidLimit` (TSh 50,000 by default). Billing therefore runs fast for busy properties and slowly for quiet ones. This matters for partner cash flow and is worked through in 7.4.

Preconditions, all required:

- the statement belongs to an `OwnerPaygAccount` whose property has an ACTIVE NRMS attribution
- the attribution window is open (`commissionStartsAt <= now`, `commissionEndsAt` null or in future)
- the governing contract is ACTIVE and unexpired
- the underlying usage is not `TRIAL_FREE`
- no commission already exists for `sourceKey = NRMS_STATEMENT:<id>`

Arithmetic:

```
Gross NRMS payment collected
  minus applicable tax
  minus payment processing fees
  minus refunds
  minus discounts funded by NoLSAF
= eligible net NRMS revenue

eligible net NRMS revenue x contract nrmsCommissionRate = partner earning
```

Worked example, a paid statement of TSh 240,000 with VAT at 18% inclusive and a mobile money fee of TSh 2,400:

```
Gross statement:              TSh 240,000
VAT component (18% incl.):    TSh  36,610
Mobile money fee:             TSh   2,400
Eligible net NRMS revenue:    TSh 200,990
Partner rate:                          14%
Partner earning:              TSh  28,139
```

### 7.2 Marketplace revenue share, 20%

Trigger: an `Invoice` transitions to `PAID`.

Preconditions mirror 7.1 with a MARKETPLACE attribution, plus `sourceKey = INVOICE:<id>` must not already exist.

Arithmetic:

```
Booking value
  x NoLSAF property commission rate (Invoice.commissionPercent)
= gross NoLSAF commission (Invoice.commissionAmount)

gross NoLSAF commission
  minus tax
  minus payment processing costs
  minus refunds, reversals and chargebacks
= eligible net NoLSAF revenue

eligible net NoLSAF revenue x contract marketplaceRevenueRate = partner earning
```

Worked example, a TSh 1,000,000 booking at the platform default of 10%:

```
Booking value:                TSh 1,000,000
NoLSAF commission (10%):      TSh   100,000
Tax and processing:           TSh    12,000
Eligible net NoLSAF revenue:  TSh    88,000
Partner rate:                            20%
Partner earning:              TSh    17,600
```

The partner earns TSh 17,600 on a million shilling booking, which is 1.76% of gross. That is the correct order of magnitude for a residual and it is what the contract must state in words and in a worked example, so nobody signs expecting TSh 200,000.

### 7.3 Reversal

If the source payment is refunded, the booking cancelled, or a chargeback lands:

- an unpaid commission moves to `REVERSED` and leaves the available balance
- an already-paid commission generates a linked negative adjustment row that nets against future earnings
- the partner sees both rows and the reason, never a silently shrinking number

### 7.4 Partner economics and the year one ramp

The commercial question is not whether 14% is a fair rate. It is whether 14% of this particular product, billed on this particular cycle, adds up to a living for the person selling it. It does, and the arithmetic is worth writing down because it drives the level model in section 14.

At the current `roomNightPrice` of TSh 500, net of 18% VAT, steady-state monthly earnings per property:

| Property | Room-nights/mo | NoLSAF gross | Partner at 14% |
|----------|----------------|--------------|----------------|
| Guest house, 12 rooms at 45% | 162 | TSh 81,000 | TSh 9,600 |
| Mid hotel, 30 rooms at 60% | 540 | TSh 270,000 | TSh 32,000 |
| Large hotel, 80 rooms at 65% | 1,560 | TSh 780,000 | TSh 92,500 |

Because statements close on the TSh 50,000 threshold rather than on a calendar month, time from activation to first partner earning is short and scales with the property's own activity:

| Property | Accrual/day | Days post-trial to first payable statement |
|----------|-------------|---------------------------------------------|
| Guest house, 12 rooms at 45% | TSh 2,700 | about 19 days |
| Mid hotel, 30 rooms at 60% | TSh 9,000 | about 6 days |
| Large hotel, 80 rooms at 65% | TSh 26,000 | about 2 days |

With `trialDays` at 15, a mid-size hotel signed at the start of a month is billed, paid and generating partner commission inside the same month. Modelled at two mid-size signings per month:

| Month | Paying properties | Partner monthly income |
|-------|-------------------|------------------------|
| 1 | 2 (part month) | TSh 32,000 |
| 2 | 4 | TSh 96,000 |
| 3 | 6 | TSh 160,000 |
| 6 | 12 | TSh 352,000 |
| 9 | 18 | TSh 544,000 |
| 12 | 24 | TSh 736,000 |

The same model at the old 45 day trial produced TSh 0 in months 1 and 2 and TSh 30,000 in month 3. Shortening the trial to 15 days is what makes this programme viable for the partner, not just for NoLSAF cash flow. It should be treated as a dependency of the sales programme, not an unrelated pricing decision.

**Property mix dominates everything else.** Twenty guest houses earn a partner TSh 192,000 a month. Three large hotels earn TSh 277,500. Three beat twenty. Since room-nights accrue per occupied room per night, both size and real occupancy feed the partner's cheque directly.

Two consequences follow, and both are design constraints rather than observations:

1. Levels and targets must be based on revenue generated, never on property count. A count-based ladder rewards chasing small guest houses, which is the opposite of what the economics want. Section 14 is written accordingly.
2. A property that adopts NRMS but never checks guests in generates no room-nights and therefore no commission. The partner is automatically paid on real adoption rather than on signatures, so no separate anti-gaming rule is needed for inactive onboards.

**Bridging months one and two.** Income is thin but not absent in the first two months. Milestone bonuses at 5, 10 and 20 paying properties are sufficient to carry a partner through, and are cheap relative to the recurring revenue they unlock. A large one-time activation bounty was considered and rejected: it was designed for the 45 day trial and is no longer justified at 15 days.

**Marketplace expectations.** At 20% of a 10% commission the partner receives 2% of booking value. A newly listed property realistically produces one or two NoLSAF bookings a month in its first year, so this stream is worth roughly TSh 12,000 a month per property at first. It is also the one outcome the partner cannot influence, since they cannot generate demand for the owner's rooms. Keep the 20%, it costs little and grows as the demand side grows, but recruit on NRMS and present marketplace as upside.

## 8. Money state machine

```
PENDING -> VALIDATING -> ELIGIBLE -> APPROVED -> AVAILABLE -> PAID
   |            |            |           |            |
   +------------+------------+-----------+------------+--> REVERSED / DISPUTED / CANCELLED
```

| State | Meaning | Who moves it |
|-------|---------|--------------|
| PENDING | Written on collection, not yet checked | System |
| VALIDATING | Inside the refund and chargeback window | System |
| ELIGIBLE | Window cleared, safe to pay | System job |
| APPROVED | Finance has signed off | Admin |
| AVAILABLE | Included in the withdrawable balance | System |
| PAID | Settled to the partner | Admin, on payout |
| REVERSED | Clawed back with a recorded reason | System or admin |
| DISPUTED | Frozen pending investigation | Admin |
| CANCELLED | Voided before it ever became payable | Admin |

Balances are derived, never stored:

```
Pending balance   = PENDING + VALIDATING + ELIGIBLE + APPROVED
Available balance = AVAILABLE
Lifetime paid     = PAID
Reversed          = REVERSED
```

### 8.1 Payout locking

The whole withdrawal path runs inside one database transaction:

1. Select the partner's `AVAILABLE` commissions.
2. Insert a `SalesPayoutItem` per commission. The unique constraint on `commissionId` makes a concurrent second request fail rather than double claim.
3. Create the `SalesPayoutRequest` in `REQUESTED`.
4. Admin reviews, approves, and marks paid. Commissions move to `PAID`.
5. On rejection or cancellation, items are removed and the commissions return to `AVAILABLE`.
6. A downloadable receipt is generated on payment.

## 9. Surfaces

### 9.1 Partner navigation

```
Overview
Leads
Properties
Earnings
Payouts
Contract
Learning and materials
Notifications
Support
Switch workspace
```

### 9.2 Overview

Header: photo, name, agent code, level, region, account status, contract status, start date, expiry date, days remaining, workspace switcher, notifications.

Six KPI cards: total attributed properties, active NRMS properties, active marketplace properties, pending onboarding, total earnings this month, available for payout.

Below: an earnings chart split by stream with range filters (this month, last month, last 90 days, year, custom), an earnings breakdown, a performance snapshot (conversion rate, average earning per active property, bookings generated, properties onboarded in period, progress to next level), recently onboarded properties, and recent notifications.

### 9.3 Leads

Table on desktop, cards on mobile. Status tabs, filters, search, follow up reminders, activity timeline. The partner can create leads, edit their own, log calls and meetings, set follow up dates, upload documents, mark a proposal sent, and request conversion. The partner cannot verify attribution or approve commission.

### 9.4 Properties and earnings

Properties lists only the authenticated partner's attributed properties, with NRMS status, marketplace status, attribution status, activation date, monthly revenue and partner earnings. The detail page adds lead origin, attribution history, subscription and booking activity, and a timeline. Owner contact detail is shown only to the extent policy allows, and only for properties inside that partner's portfolio.

The earnings page carries summary cards per state, tabs per stream, and a table with date, property, source, source reference, gross revenue, deductions, eligible net revenue, rate, partner earning and status.

A calculation drawer on every row is mandatory, not optional:

```
Booking value:                 TSh 1,000,000
NoLSAF commission:             TSh   100,000
Payment and tax deductions:    TSh    12,000
Eligible net NoLSAF revenue:   TSh    88,000
Partner share:                            20%
Partner earning:               TSh    17,600
```

A partner who can see the arithmetic does not open a support ticket. A partner who sees only a total does.

### 9.5 Contract page

Contract number, dates, status, both rates, territory, PDF download, signature status, renewal history, and a timeline from created through sent, viewed, signed, activated, to expiring and renewed or expired. Rates and dates are read only to the partner.

### 9.6 Admin console

New section in the existing admin dashboard: Sales partners, Applications, Contracts, Leads, Attributions, Commissions, Payouts, Level rules, Materials, Disputes, Reports.

Promotion is one atomic transaction: confirm the user exists, confirm no profile exists, create the profile, generate the agent code, create pending workspace access, create the first contract, send the notification. Access activates only after the contract is signed and approved.

### 9.7 Design

NoLSAF green `#02665e`, dark green sidebar, white and soft grey surfaces, restrained shadows, rounded cards, readable financial figures, skeleton loaders, empty states, error states, confirmation modals, responsive down to mobile.

Status colours: green for active, approved, available and paid; amber for pending, trial, expiring and processing; red for rejected, suspended, reversed and terminated; blue for new, viewed and under review; grey for draft, expired and cancelled.

No em-dashes anywhere in UI copy, per the project convention.

## 10. API surface

Partner routes, all behind `requireWorkspaceAccess('SALES')` and `requireActivePartnerContract`:

```
GET  /api/me/workspaces
POST /api/me/workspace/select
GET  /api/sales/me

GET|POST      /api/sales/leads
GET|PATCH     /api/sales/leads/:id
POST          /api/sales/leads/:id/activities
POST          /api/sales/leads/:id/request-conversion

GET /api/sales/properties
GET /api/sales/properties/:propertyId
GET /api/sales/properties/:propertyId/earnings
GET /api/sales/properties/:propertyId/activity

GET /api/sales/earnings/summary
GET /api/sales/earnings
GET /api/sales/earnings/:commissionId
GET /api/sales/earnings/chart

GET|POST /api/sales/payouts
GET      /api/sales/payouts/:id
GET      /api/sales/payouts/:id/receipt

GET  /api/sales/contract/current
GET  /api/sales/contracts
GET  /api/sales/contracts/:id
POST /api/sales/contracts/:id/view
POST /api/sales/contracts/:id/accept
GET  /api/sales/contracts/:id/download

GET /api/sales/materials
GET /api/sales/materials/:id
```

Admin routes cover partner search and promotion, suspend and reactivate, contract create, send, activate, renew and terminate, lead conversion approval, attribution verify, revoke and reassign, commission approve, reverse and manual adjustment, payout approve, reject, mark processing and mark paid, material management, and reports.

All list endpoints paginate, filter, sort, and validate server side with Zod.

## 11. Security

Explicit permissions rather than a role check:

```
sales.workspace.access        admin.sales.partners.manage
sales.leads.create            admin.sales.contracts.manage
sales.leads.read_own          admin.sales.leads.review
sales.leads.update_own        admin.sales.attributions.manage
sales.properties.read_attributed   admin.sales.commissions.manage
sales.earnings.read_own       admin.sales.payouts.manage
sales.payouts.request         admin.sales.materials.manage
sales.contract.read_own       admin.sales.reports.read
sales.materials.read
```

Middleware chain: `requireAuthentication`, `requireWorkspaceAccess('SALES')`, `requirePermission(...)`, `requireActivePartnerContract`.

Every partner query is scoped by `salesPartnerId` derived from the session, never from a request parameter. Hiding a button in the frontend is not a control.

Additional requirements: input validation with Zod, CSRF where applicable, rate limiting, signed URLs for private documents, transactions on every money path, idempotency keys, duplicate commission protection, and audit logging.

Payout details are masked everywhere except the owning partner's own settings:

```
Mixx by Yas 4812
NMB 2391
```

### 11.1 Fraud surface

A partner could onboard a property they control and drive fake NRMS usage to earn commission. Paying only on collected cash removes most of the incentive, because fake usage means really paying NoLSAF first. Admin verification of every attribution closes the rest. This is worth stating because it is the reason attribution verification is a hard gate rather than a formality.

## 12. Background jobs

All idempotent, all safe to re-run:

contract expiry reminders at 60, 30 and 7 days; automatic contract status transitions; workspace expiration; lead follow up reminders; stale lead warnings; commission validation window clearing; commission availability; payout reconciliation; level recalculation.

## 13. Notifications and audit

In-app notifications on: contract sent, contract signed, workspace activated, workspace suspended, new attributed property, lead follow up due, attribution approved, attribution disputed, NRMS commission generated, marketplace commission generated, commission available, payout approved, payout paid, payout rejected, contract expiry approaching, level changed. Read and unread supported.

Audit rows via the existing `AuditLog` on: partner promotion, contract creation, rate changes, workspace activation and suspension, attribution approval, commission approval, commission reversal, payout approval, payout payment, manual adjustments, and level changes.

## 14. Levels

Declared in `apps/api/src/lib/salesPartnerLevel.ts` as a single-source-of-truth spec constant, following the existing `agentLevel.ts` pattern. No table, per 5.2.

**Levels are based on revenue generated for NoLSAF, not on property count.** This is a deliberate reversal of the original brief and follows directly from 7.4: three large hotels are worth more than twenty guest houses, so a count-based ladder would reward exactly the wrong behaviour. The measure is trailing twelve month eligible net revenue produced by the partner's active attributions, across both streams.

| Level | Starting rule (trailing 12 month eligible net revenue) |
|-------|--------------------------------------------------------|
| STARTER | Newly activated partner |
| GROWTH | TSh 1,500,000 generated |
| PROFESSIONAL | TSh 6,000,000 generated, with acceptable compliance |
| SENIOR | TSh 15,000,000 generated, plus admin approval |
| REGIONAL_LEAD | Explicit admin promotion |

The spec carries a `minProperties` field defaulted to 0 and normally unused, so a count condition can be reintroduced later without reshaping anything.

Levels affect visibility and progress display only. They do not change commission rates, because rates live on the contract. Senior and regional lead require admin approval.

Progress display:

```
Growth partner
TSh 2,400,000 of TSh 6,000,000 generated
TSh 3,600,000 more to reach Professional partner
```

The thresholds above are a starting guess. Ship levels as display only and set the real numbers after three months of live data rather than committing to them now.

## 15. Build order

| Phase | Contents | Ships as |
|-------|----------|----------|
| 1. Foundation | Schema, migration, entitlement middleware, profile, contract model, admin promotion, workspace selector | An admin can promote a user who then sees an empty workspace |
| 2. Partner operations | Overview, leads, properties, attribution, contract page, materials | A partner can work the pipeline end to end |
| 3. Revenue | Both commission engines, ledger, balances, payout request, receipts | Money starts accruing and can be withdrawn |
| 4. Administration | Partner management, contract management, attribution review, commission approval, payout processing, reports | Finance can run the programme |
| 5. Hardening | Audit, notifications, background jobs, tests, security review, responsive polish | Production ready |

### 15.1 Test coverage required before phase 3 goes live

Unit: commission arithmetic for both streams, contract eligibility, workspace permissions, duplicate lead detection, attribution uniqueness, commission idempotency, payout locking.

Integration: login and workspace selection, partner promotion, contract acceptance, NRMS commission generation, marketplace commission generation.

End to end: partner dashboard access, and cross-partner data access denial.

Edge cases that must have a named test each:

```
Payment refunded after commission creation
Booking cancelled after invoice paid
Contract expires before revenue becomes eligible
Property reassigned to a different partner
Two partners claim the same property
Payout requested twice concurrently
Payment webhook delivered twice
Admin changes rates on a future contract
Partner suspended while holding available earnings
Contract renewed before expiry
```

## 16. Acceptance criteria

1. An existing registered user can be promoted by an admin.
2. Promotion does not alter or replace the user's existing account.
3. The promoted user signs in with their existing credentials.
4. The user chooses between normal NoLSAF and the sales workspace.
5. Workspace selection is validated server side on every request.
6. A partner sees only their own leads, properties, earnings, contracts and payouts.
7. Admin can issue and manage a one year digital contract.
8. Commission rates are read from the active contract, never hard coded.
9. NRMS and marketplace earnings are calculated by separate engines.
10. Marketplace earnings are based on NoLSAF's eligible net commission, not booking value.
11. Commission records are idempotent and auditable.
12. Attribution prevents duplicate active claims at the database level.
13. An available commission can be claimed by exactly one payout.
14. Admin can approve, reject and mark payouts paid.
15. The partner can download their contract and payout receipt.
16. Expired or suspended access blocks entry to the workspace.
17. The dashboard is responsive and consistent with NoLSAF design.
18. All sensitive actions write an audit row.
19. Automated tests cover access, commission, attribution and payout flows.
20. Existing user, owner, booking and payment flows continue to work with no regression.

## 17. Open decisions for Daniel

These change the build and I am not deciding them alone.

1. **Is NRMS PAYG pricing VAT inclusive or exclusive?** Every worked example in section 7 assumes inclusive. If it is exclusive, the eligible net figure changes and so does every partner payout and every number in 7.4.
2. **Validation window length before a commission becomes ELIGIBLE.** My recommendation is 30 days for marketplace (covers the cancellation and chargeback window) and 7 days for NRMS (already collected cash, low reversal risk).
3. **Minimum withdrawal amount and payout cadence.** My recommendation is a TSh 50,000 floor and a monthly cycle, so payout admin does not become a daily job.
4. **What happens to available earnings when a partner is terminated for cause.** My recommendation is that earnings already `AVAILABLE` are paid, and everything still `PENDING` is forfeited, stated explicitly in the contract.
5. **Does the residual survive contract expiry?** The brief implies no, since commissions check contract eligibility. Confirming this in writing matters because it is the difference between a renewable agreement and a permanent liability on NoLSAF margin.
6. **Who signs on the NoLSAF side, and is a countersignature required** before a contract moves to ACTIVE. The existing `agentContractWorkflow.ts` models a two-sided signature for tour operators and could be reused.
7. **Confirm the move to `trialDays` = 15 lands before partners are recruited.** Section 7.4 shows the programme is viable at 15 days and marginal at 45. If the trial change slips, the milestone bonus structure has to be replaced with real bridge income, so these two decisions travel together.
8. **Milestone bonus amounts at 5, 10 and 20 paying properties.** Not yet costed. Needs a number from you before phase 3.

## 18. Migration note

The reviewed additive migration now lives at `prisma/migrations/20260726111500_add_sales_partner_workspace/migration.sql`. It was produced by an offline schema-to-schema diff from the last committed Prisma schema to the sales workspace schema. It creates the ten sales tables, their indexes and foreign keys, and adds the two sales default-rate columns to `SystemSetting`. It contains no drop, rename, data rewrite or destructive alteration.

**The migration has not been applied to any database.** Deploy it to Aiven staging first, validate the full promotion/signature/activation flow there, and only then deploy the same committed migration to AWS production. Do not use `db push` for either environment.

## 19. Build log

### Step 1: Schema. Complete.

`prisma/schema.prisma`, validates clean.

Ten models added: `UserWorkspaceAccess`, `SalesPartnerProfile`, `SalesPartnerContract`, `SalesLead`, `SalesLeadActivity`, `PropertySalesAttribution`, `SalesCommission`, `SalesPayoutRequest`, `SalesPayoutItem`, `SalesMaterial`.

Two columns added to the existing `SystemSetting` singleton: `salesNrmsCommissionPercent` (default 14.00) and `salesMarketplaceRevenuePercent` (default 20.00), as the defaults used when issuing a contract.

Back-relations added to `User` (eleven, all named) and `Property` (three). No other existing model was touched, and no existing column was altered, so the migration is purely additive.

`SalesPartnerLevelRule` was dropped per 5.2 in favour of a spec constant.

### Step 2: Shared value sets and level model. Complete.

`apps/api/src/lib/salesPartner.ts` is the single source of truth for every status set the schema stores as `VarChar`, so Zod, the route handlers and the UI cannot drift. It also holds `commissionSourceKey()`, which every commission writer must go through, since the unique index on `sourceKey` is the whole idempotency guarantee; `buildAgentCode()`; `maskPayoutAccount()`; and `isContractEarning()`, shared by the access gate and both commission engines so access and earning can never disagree on what active means.

`apps/api/src/lib/salesPartnerLevel.ts` follows the existing `agentLevel.ts` pattern. Revenue-based per section 14, with `minProperties` present but defaulted to 0. An admin-granted level always outranks the earned one, in both directions, so a deliberate promotion is never undone by a quiet quarter and an admin-only level is never reached automatically.

### Step 3: Entitlement middleware. Complete.

`apps/api/src/middleware/salesWorkspace.ts` provides `requireWorkspaceAccess('SALES')`, `requireActivePartnerContract`, `loadSalesPartnerContext()`, `hasWorkspaceAccess()`, `listWorkspaces()` and `partnerIdFor()`.

Three decisions worth recording. Admins pass the workspace gate without an entitlement row so they can administer and test, but they receive no partner context unless they genuinely have a profile, which stops partner-scoped queries from silently returning every partner's data. `partnerIdFor()` reads only from the session, never from a route or query parameter, which is the control that prevents cross-partner access. And the contract gate re-reads the contract rather than trusting `UserWorkspaceAccess.expiresAt`, which is only a fast path for the common check.

Typechecks clean under `tsc --noEmit`.

### Step 4: Workspace selection API and admin promotion. Complete.

`apps/api/src/routes/sales.workspace.ts`
- `GET /api/me/workspaces` returns the workspaces the account may enter plus `requiresSelection`, so the selector is only shown when there is genuinely a choice.
- `POST /api/me/workspace/select` validates the entitlement server side before setting the cookie, so the cookie can never hold a value the server would refuse.
- `GET /api/sales/me` returns identity, contract standing with days remaining, and level progress. Level is computed from actual ledger revenue over the trailing twelve months, never from a stored total.

`apps/api/src/routes/admin.sales.partners.ts`
- `GET /admin/sales/users/search` finds an existing user and reports whether they already hold a profile.
- `POST /admin/sales/partners/promote` runs the whole promotion in one `$transaction`: verify the user exists and is not suspended, reject a duplicate profile, mint the agent code, create the profile, upsert `PENDING` workspace access, and create the first contract in `SENT`. Audit and notification fire after the transaction commits, so a failed notification can never roll back a promotion.
- `GET /admin/sales/partners` and `/partners/:id`, both paginated and masking the payout account.

`apps/api/src/routes/sales.ts` registers all of it, wired into `routes/index.ts`.

**The selected workspace is a UI preference, not an authorization token.** It is stored in a client-readable cookie (mirroring the existing `role` cookie so Next.js middleware can route on it). Tampering with it changes which shell renders and nothing else, because every protected route independently re-checks the entitlement.

Promotion grants nothing on its own. Workspace access is created `PENDING` and the response says so explicitly. Entry requires signature plus admin activation, which is step 5.

Two existing files were extended rather than duplicated, consistent with 5.2:

| File | Change | Why |
|------|--------|-----|
| `lib/audit.ts` | `audit()` gained an optional sixth parameter `entityId` | It previously always wrote `entityId: null`, and the only helper that set it, `auditLog()`, is typed to `entity: "PROPERTY"` so it cannot serve sales. Additive and backward compatible; no call site changed |
| `lib/notifications.ts` | Ten `sales_partner_*` templates registered, plus a `sales` notification type | Unknown templates fall back to "You have an update", which is useless copy. Registering them is what reusing the `Notification` model actually requires |

Typechecks clean under `tsc --noEmit`.

### Step 5: Workspace selector UI and sales shell. Complete.

`apps/web/app/workspace/select/page.tsx` shows the chooser only when `requiresSelection` is true. A single-workspace account is redirected straight through, so nothing changes for the ordinary user who makes up almost all traffic.

`apps/web/components/SalesShell.tsx` is the shell: dark green sidebar on `brand-800`, the nine-item navigation from 9.1, the header block from 9.2 (avatar, name, level badge, status pill, agent code, region, contract expiry with days remaining), and the workspace switcher. It also exports `statusTone()`, the status colour mapping from 9.7, so every later page colours states identically instead of each one inventing its own.

`apps/web/app/(sales)/sales/page.tsx` renders active properties, revenue generated and the contract rates, plus level progress. It deliberately shows only figures the API can currently prove. The KPI row and earnings charts wait for phase 3, because a dashboard of zeros teaches a partner to distrust the numbers.

`apps/web/middleware.ts` gains a `/sales` and `/workspace/select` guard that requires a token and nothing more. This is the same reasoning as the existing `/owner/nrms` guard: there is no SALES role, the role cookie says nothing about the entitlement, and authorization lives in `UserWorkspaceAccess` where the API enforces it on every request. The shell only asks that somebody is signed in.

A 403 from `/api/sales/me` renders a named reason and a route back to NoLSAF rather than a blank screen, so a partner whose contract has lapsed is told what happened.

Both apps typecheck clean under `tsc --noEmit`.

**Not verified in a browser.** The pages require authentication, and the tables they read do not exist until the migration is applied. Per the standing convention, authenticated routes are not driven through the browser tooling; verification is by code parity and typecheck. The first real check is after the migration lands.

### Phase 1 status

Foundation complete: schema, entitlement middleware, workspace selection, admin promotion, selector UI, shell, agreement template and the contract acceptance/activation bridge required to open the workspace.

Not yet built:

1. Seed data for development.
2. The remaining phase 2 partner operations: leads, property portfolio, attribution views and learning materials.

**Carry into phase 2:** the web app disables Tailwind preflight, so there is no global `border-box`. Any sales page with `w-full` inputs must scope `#page-id * { box-sizing: border-box }` or the fields will overflow their container. The lead form is the first place this will bite.

### Step 6: Sales partner agreement template. Complete.

`docs/NoLSAF_Sales_Partner_Agreement.md` is the agreement a partner signs. Clause 5.3 includes the marketplace calculation from section 7.2 verbatim and states plainly that the 20% share applies to eligible net NoLSAF commission, not to the booking value.

`docs/NoLSAF_Sales_Partner_Agreement.fields.json` declares every template placeholder, its source, editability and validation rules. It parses under `contractTemplateFieldDictionarySchema`; all placeholders used by the Markdown are declared exactly once, and the dictionary contains no unused placeholders. Prisma-backed sources use the real `User`, `SalesPartnerProfile`, `SalesPartnerContract` and `NrmsUsageChargePolicy` field names. Fixed programme terms point to their dictionary defaults, shared sales constants point to `salesPartner.ts`, and the NoLSAF countersignatory uses the same `CONTRACT_NOLSAF_SIGNATORY_*` environment settings as the existing contract workflows.

### Step 7: Contract acceptance and activation. Complete.

`apps/api/src/routes/sales.contracts.ts` implements the partner-owned contract API from section 10: current, history, detail, viewed, accept and PDF download. These are the only sales routes available before workspace activation. They require authentication and resolve the `SalesPartnerProfile` from the session user; no partner id from a route, query or request body is trusted. Contract acceptance requires all three explicit confirmations, a typed legal-name match, and the exact terms hash returned when the agreement was viewed. A compare-and-set update on `SENT|VIEWED` makes concurrent/replayed signatures harmless.

Acceptance evidence binds the SHA-256 of the rendered terms to contract id and number, partner id, user id, legal name, server timestamp, proxy-normalized IP address and truncated user agent. The accepted terms hash, exact signed Markdown, rendered field snapshot and document digests are persisted on `SalesPartnerContract`; an executed document is never reconstructed from a later-edited user profile.

`POST /admin/sales/contracts/:id/activate` is the NoLSAF countersignature. It accepts only `SIGNED`, in-term agreements. The final PDF is generated deterministically and content-addressed. When `SALES_CONTRACT_S3_BUCKET` (or the existing `AWS_S3_BUCKET`/`S3_BUCKET`) is configured, it is uploaded under `private/sales-contracts/` with S3 server-side encryption and downloads use a five-minute presigned URL. Without object storage, the authenticated owner-only route streams the deterministically regenerated PDF from the immutable database snapshot. Contract status, partner status and workspace entitlement become `ACTIVE` in one transaction; storage failure never activates access.

The workspace selector now exposes a `PENDING` sales entitlement as “Agreement signature required” and sends it only to `/sales/contract`. This does not broaden authorization: the selected-workspace cookie remains a navigation preference, all normal sales APIs still require `ACTIVE`, and the onboarding contract API still scopes ownership from the authenticated session.

`apps/web/app/(sales)/sales/contract/page.tsx` renders the read-only rates, dates and territory, complete agreement, timeline, PDF download, explicit acceptance controls, evidence reference and the waiting-for-countersignature state. Executed agreements render inside the full sales shell; pending agreements use a restricted onboarding frame.

Schema additions to `SalesPartnerContract` are additive: `renderedContractBody`, `renderedFieldSnapshot`, `acceptedTermsHash`, `renderedBodyHash` and `pdfSha256`. They are included in the migration recorded in section 18; that migration remains unapplied.

Focused contract-evidence tests cover placeholder resolution, the worked marketplace example, commercial-term hash changes, acceptance-metadata binding, legal-name normalization and deterministic PDF generation.

### Step 8: Partner lead pipeline. Complete.

`apps/api/src/routes/sales.leads.ts` implements the four lead endpoints from section 10: paginated/filterable list and create, owned detail and patch, append-only activity creation, and conversion request. Every route requires authenticated `ACTIVE` sales workspace access plus an earning contract. Every lookup combines the route id with `salesPartnerId` derived from the session, and responses never expose another partner's candidate id or contact data.

Lead registration opens the 60-day protection window. Calls, emails, meetings, received documents and sent proposals extend it from the activity time; notes and follow-up reminders do not. Conversion requests are compare-and-set, append a status event, notify administrators, and never create a property attribution or commission. Only an administrator can verify that later phase.

The original `SalesLead` draft could index display-form phone/email/name values but could not match formatting variants or retain the registration/tax identifiers and review evidence required by section 6.1. Because the migration is still unapplied, the model and the same migration now include canonical indexed matching fields, registration and tax numbers, `duplicateReviewStatus`, and internal `duplicateEvidence`. The API preserves the partner's original display text while matching deterministic canonical values.

Possible duplicates are warnings, not rejections. One strong identifier (phone, email, registration or tax number), or property name plus location, flags the saved lead for admin review. A generic name match alone stays below the warning threshold. Strong identifiers are queried separately from names so a flood of common hotel names cannot hide an exact match, and a post-commit scan closes the ordinary check-then-insert race. Partner responses include only matched field names and ids of their own matching leads.

`apps/web/app/(sales)/sales/leads/` provides the responsive list/table, status tabs, server-side search and follow-up filters, registration form, duplicate warning, owned detail/editor, pipeline status changes, activity timeline, protection date, conversion confirmation and mobile layouts. All lead form controls scope `border-box` because Tailwind preflight is disabled.

`salesLeadMatching.test.ts` names the canonical phone, email, identifier, name/location threshold and strongest-match ordering cases. Full database ownership integration remains part of the staging test pass after the migration is applied.

### Step 9: Admin conversion and attribution boundary. Complete.

`apps/api/src/routes/admin.sales.attributions.ts` implements the administrator conversion queue, existing-property lookup, conversion approval/return, attribution listing, activation, revocation and reassignment. Approval binds the lead to an existing `Property` and creates `VERIFIED` rows only. It never starts earnings. Activation is a separate transition to `ACTIVE`, and activation, revocation and reassignment require the existing admin finance OTP grant.

Property/product exclusivity is checked before creation and remains enforced by the database unique constraint. All state changes use compare-and-set conditions, and the audit row is written inside the same transaction as the protected change. A concurrent claim therefore either commits once or returns a conflict without a partial lead conversion. Reassignment updates the unique property/product row in place; the previous and replacement partner states are preserved in the immutable `AuditLog`, while commission rows already snapshot their own partner and contract.

`apps/web/app/(admin)/admin/sales/page.tsx` exposes the review queue and attribution controls. Duplicate warnings must receive an explicit administrator decision, property search shows existing product ownership before approval, and verified rows remain visibly non-earning until an administrator activates them.

Focused lifecycle tests cover combined-product expansion, current-contract selection, activation/revocation/reassignment boundaries and commission start dates. Database concurrency and authenticated browser checks remain part of the Aiven staging pass after the unapplied migration lands.

### Step 10: Partner property portfolio and learning materials. Complete.

`apps/api/src/routes/sales.properties.ts` implements the four partner property routes from section 10. Every property lookup requires an attribution owned by `salesPartnerId` derived from the authenticated session; a property id from the URL never grants access. The list provides product/status filters and recorded earnings, while detail exposes only that partner's attribution, originating lead, contract, commission rows and activity. `AuditLog` bigint ids are converted to strings before JSON serialization.

`apps/web/app/(sales)/sales/properties/` provides the responsive attributed-property list and detail views, including independent NRMS/marketplace states, earning windows, lead origin, calculation inputs and activity history. Revoked and expired records remain visible when selected so portfolio history is not silently erased.

`apps/api/src/routes/sales.materials.ts` adds published-only partner reads and an admin create/edit/publish workflow. Resource links must be valid HTTPS URLs, partner routes require the active workspace and earning contract, admin writes block impersonation, and material audit rows commit in the same transaction as their changes. `apps/web/app/(sales)/sales/materials/page.tsx` is the partner library; `apps/web/app/(admin)/admin/sales/materials/page.tsx` manages drafts, ordering and publication.

Phase 2 partner operations are now structurally complete. The next build phase is Phase 3 revenue: commission accrual engines, earnings ledger views, balances and payout requests. The sales migration remains unapplied until the Aiven staging migration pass.

### Step 11: Phase 3 revenue ledger and payout requests. Complete.

`apps/api/src/lib/salesCommission.ts` is the single commission writer for both revenue streams. `NRMS_STATEMENT:<id>` and `INVOICE:<id>` source keys make provider replays and concurrent callbacks idempotent at the database boundary. Eligibility requires an ACTIVE product-specific attribution, an open attribution window and the same live contract bound to that attribution. Rates come only from that contract snapshot.

NRMS accrual runs when `reconcileNrmsPayment` settles the statement, including the finance-OTP manual reconciliation path. Marketplace accrual is connected to webhook collection, the admin invoice payment flow and the admin revenue payment flow. Marketplace `grossAmount` is `Invoice.commissionAmount`, never booking value. Missing source commission basis causes a recorded skip rather than inventing a percentage or paying against `Invoice.total`.

Tax deductions use data already known by the source: NRMS uses the configured inclusive-tax component and marketplace uses the invoice revenue convention. Provider processing fees are currently not persisted on either source, so the ledger snapshots zero and leaves the earning in `VALIDATING`; it does not fabricate a fee. The open VAT and validation-window programme decisions remain explicit configuration decisions before production payout approval.

`apps/api/src/workers/salesCommissionLifecycle.ts` provides the recovery boundary. The leader-only worker reconciles recent paid statements and invoices that missed their synchronous hook, relying on source-key uniqueness, and moves expired `VALIDATING` rows to `ELIGIBLE` with a transactional audit entry. It never moves a commission to `AVAILABLE`; finance approval remains an administrator action in Phase 4.

`apps/api/src/routes/sales.earnings.ts` provides summary, paginated ledger, detail and chart endpoints, all scoped by session-derived `salesPartnerId`. Withdrawable balance excludes `AVAILABLE` rows already locked to a payout. `apps/web/app/(sales)/sales/earnings/page.tsx` shows the balance states and the mandatory calculation breakdown for every row.

`apps/api/src/routes/sales.payouts.ts` creates and lists partner payout requests and permits cancellation only before review. The destination is snapshotted from the partner profile inside the transaction. Only `AVAILABLE` rows with no payout item can be selected, all items must share one currency, and the unique `SalesPayoutItem.commissionId` constraint prevents concurrent double claims. Cancelling releases those item locks while the payout amount and immutable audit evidence remain. `apps/web/app/(sales)/sales/payouts/page.tsx` exposes the available balance, masked destination, request history and unreviewed cancellation.

Focused verification for this build: API and web typechecks pass; the four commission arithmetic tests pass, including the agreement's NRMS inclusive-tax example and marketplace calculation. The full regression suite remains deferred during active construction, per the current build instruction. No migration was applied.

### Step 12: Phase 4 finance administration and payout settlement. Complete.

`apps/api/src/routes/admin.sales.finance.ts` provides the administrator commission and payout queues. Every write blocks impersonation, requires the existing finance OTP grant, uses a compare-and-set state transition and writes its audit row in the same database transaction as the financial change. An `ELIGIBLE` commission can be approved into `AVAILABLE`; a locked commission cannot be reversed while its payout is active. Reversing a paid commission retains the original row and creates a uniquely keyed negative `MANUAL_ADJUSTMENT`, so recovered money is visible in the ledger rather than deleted from history.

Manual adjustments are administrator-only ledger entries tied to an active partner contract. Optional property links must belong to that partner, zero-value adjustments are rejected, and both positive credits and negative recovery offsets carry the required audit reason. A payout request must still have a positive net credit balance before it can be submitted.

Payout review follows one forward path: `REQUESTED|UNDER_REVIEW -> APPROVED -> PROCESSING -> PAID`, with rejection available only before approval. Approval snapshots deductions and requires the net amount to remain positive. Rejection releases the unique commission locks. Marking a payout paid atomically moves every locked `AVAILABLE` commission to `PAID`, stores the external payment reference, records the receipt route and commits the audit evidence.

`apps/api/src/routes/sales.payouts.ts` now serves the generated PDF receipt only to the authenticated owning partner and only for a completed payout. It includes the immutable payout reference, masked destination, ledger-item count and settlement amounts, and is returned with private no-store caching. `apps/web/app/(admin)/admin/sales/finance/page.tsx` exposes the commission queue, payout state actions and manual adjustments in the existing admin shell; the existing API interceptor opens the finance verification panel when an OTP grant is required.

Focused verification for this build: API and web typechecks pass; eight targeted commission arithmetic and finance lifecycle tests pass. The full regression suite and authenticated database integration remain deferred until the additive migration is applied to Aiven staging. The migration remains unapplied.
