# NRMS Admin Oversight: Monitor, Revoke, Track, Reconcile

Status: APPROVED, BUILT, SAFETY CONTROLS APPLIED. NRMS now has a distinct temporary `FROZEN` account state with billing-state restoration, finance-role segregation (`NONE`/`OPERATOR`/`APPROVER`), global QR shutdown, persistent worker health, redacted and tracked exports, cursor-paginated investigation APIs, and per-property quotas. Migration `20260720000000_nrms_safety_controls` was applied and verified against the local MySQL database on 2026-07-18. The earlier phases remain available through the `/admin/nrms` console. Any scope change is edited here first.
Owner: Daniel
Written: 2026-07-18

## 1. Purpose

NRMS today is entirely owner-operated: owners enroll, activate properties, invite staff, print QR codes, run night audits and pay PAYG statements, and the NoLSAF admin has no window into any of it. There is no admin route and no admin page that reads a single NRMS table. As NRMS becomes the daily operating system for real properties, that is not acceptable: the platform must be able to see what is happening, stop an actor who misbehaves, prove what happened afterwards, and reconcile every shilling of NRMS billing.

This document maps every authorization and trust surface NRMS has today, states what the admin must be able to do about each, and lays out a build roadmap from API to UI.

## 2. Governing principles

1. **Admin oversees, never operates.** Admin can see everything and stop anything, but never creates orders, edits menus, posts folio charges or runs a night audit on behalf of a property. Operating stays with the property; that keeps the audit story clean.
2. **Every admin action is recorded.** Each enforcement or reconciliation action writes an `AdminAudit` row (actor, target, reason, before/after state). No silent actions, no deletes of history.
3. **Reason required, owner informed.** Suspensions and revocations require a typed reason and trigger an owner notification (in-app alert plus email through the pro shell). Nothing disappears without the owner knowing why.
4. **Money paths stay untouched.** Hotel-direct guest payments (their Lipa Namba, bank, card machine) are never visible to nor touchable by NoLSAF. Admin reconciliation applies only to NRMS PAYG billing, which is NoLSAF revenue.
5. **Tenant isolation is preserved.** Admin views are cross-tenant by design, but exports and detail views never mix one owner's guest data into another's context, and guest PII appears only where a dispute requires it.
6. **Existing guardrails apply.** `blockImpersonated` on every enforcement endpoint, admin 2FA re-auth for destructive actions, and the `tokensValidAfter` revocation model for killing live sessions.

## 3. Inventory: every authorization surface in NRMS today

| # | Surface | Where it lives | Grants | Revocation today |
|---|---------|----------------|--------|------------------|
| 1 | Service enrollment | `OwnerServiceEnrollment` (plan `NRMS_PAYG`; PENDING, TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED) | Owner-level product access; workspace mode | No admin UI; DB only |
| 2 | Property activation | `Property.nrmsActivatedAt` + `OwnerPaygAccount` (TRIAL, ACTIVE, WARNING, PAYMENT_REQUIRED, PAYMENT_PENDING, FROZEN, CLOSED; `unpaidBalance` vs `unpaidLimit`) | Per-property operational access; 45-day trial clock | Admin temporary freeze preserves the prior billing state; permanent closure is separate |
| 3 | Staff memberships | `NrmsStaffMembership` (MANAGER, FRONT_DESK, HOUSEKEEPER, RESTAURANT, BAR, OUTLET_SUPERVISOR; PENDING, ACTIVE, DISABLED) | Role-scoped workspace access, outlet scoping | Owner/manager revoke per property; no cross-property or admin view |
| 4 | Staff invite tokens | 7-day JWT (`nrmsStaffInviteToken.ts`) | Confirms membership PENDING to ACTIVE | Expiry only; no forced invalidation |
| 5 | Login sessions | JWT cookies + `User.tokensValidAfter` | All authenticated access | Bumping cutoff works; not wired to any NRMS admin action |
| 6 | QR order point tokens | `NrmsOrderPoint.token` (144-bit random bearer, active flag) | Public menu access and order placement for a room/table | Owner/manager rotate or deactivate; admin has no view |
| 7 | Guest order status codes | `NrmsOutletOrder.publicCode` (random bearer) | Public status polling for one order | None needed (single order scope); no admin view |
| 8 | Public QR endpoints | `public.nrmsMenu.ts` + per-IP rate limits (menu 120/5min, order 8/10min, status 30/min; caps: 20 lines, qty 20, 5 open orders per point) | Unauthenticated ordering surface | Limits are static; no per-property freeze, no counters surfaced |
| 9 | Upload permission | Cloudinary folder `nrms-menu` for owners + active MANAGER/OUTLET_SUPERVISOR | Menu photo uploads | Follows membership status |
| 10 | Financial controls | `NrmsCashierShift`, `NrmsBusinessDay`, `NrmsNightAuditRun`, `NrmsLedgerTransaction/Entry`, order void/cancel with reason, folio charges (`ReservationCharge`) | Property-internal money discipline | Owner-side only; admin cannot see anomalies |
| 11 | PAYG billing | `NrmsUsageEvent` (BILLABLE_EXTERNAL, TRIAL_FREE, COMMISSION_ONLY, REVERSAL), `NrmsBillingStatement(+Item)`, `NrmsServicePaymentToken` (PENDING, PROCESSING, PAID, FAILED, EXPIRED, VOID), `NrmsServicePayment`, AzamPay/Coral webhooks (`reconcileNrmsPayment`, `markNrmsPaymentFailed`) | NoLSAF revenue collection | Webhook-driven only; stuck PROCESSING tokens and amount mismatches die in server logs |
| 12 | Usage pricing | `NrmsUsageChargePolicy` (versioned, effectiveFrom/To) | Per-room-night rate | DB only |
| 13 | Guest payment instructions | `Property.nrmsGuestPayInstructions` JSON | What guests see as "How to pay" | Owner-edited; no admin review for fraud (fake till numbers) |
| 14 | Guest data | `GuestProfile`, reservations, folio, SMS preferences | Owner's guest book | Tenant-isolated; no admin abuse view |

## 4. Roadmap

Six phases, each independently shippable, each usable the day it lands. Order is deliberate: see first, stop second, price and collect third, reconcile fourth, detect fifth, support sixth.

### Phase 1: The Observatory (read-only console)

The admin cannot govern what the admin cannot see. This phase is pure read, zero risk.

**UI**: new sidebar section `/admin/nrms` with three pages.
- **Directory**: every NRMS-enrolled owner and activated property in one table: enrollment status, account status, trial days left, unpaid balance vs limit, rooms, staff count, outlets, QR points (active/inactive), last night audit date, last order date. Filter by status; search by owner or property.
- **Property detail**: drill-down per property: staff roster with roles and statuses, outlets and menu size, order volume by day (counts and totals split resident/walk-in/QR, no dish-level detail needed), housekeeping snapshot, night audit history, cashier shift list, order points with rotation history, guest payment instructions as entered.
- **Billing board**: all `OwnerPaygAccount` rows grouped by status, with unpaid balances, open statements and token states. This is the collections worklist.

**API**: new `admin.nrms.ts` (requireAuth + requireRole ADMIN + blockImpersonated), read-only endpoints mirroring the three pages. No schema changes.

**Definition of done**: an admin answers "which properties are live, which owe us money, who works where" without touching the database.

### Phase 2: Enforcement (revoke the misbehaving)

Each action: typed reason, `AdminAudit` row, owner notification, admin 2FA where marked.

| Action | Effect | Mechanism |
|--------|--------|-----------|
| Suspend owner enrollment (2FA) | Whole NRMS workspace becomes read-only refusal (`NRMS_NOT_ENROLLED`) for owner and all their staff | `OwnerServiceEnrollment.status = SUSPENDED` + `suspendedAt`; already enforced by `isNrmsEntitled` everywhere, so this is one write with total effect |
| Restore enrollment | Reverses the above | Status back to ACTIVE/TRIAL with audit |
| Freeze one property (2FA) | Property fails `loadAccess`/`loadOwnedActiveNrmsProperty`; other properties unaffected | `OwnerPaygAccount.status = FROZEN` plus retained prior billing state; permanent `CLOSED` is a separate action |
| Disable a staff member globally | All their NRMS memberships DISABLED across every property + session kill | `updateMany` on memberships + bump `User.tokensValidAfter` |
| Invalidate outstanding staff invites | Pending invites stop confirming | New `invitesValidAfter` timestamp checked in the confirm endpoint (small migration) or per-membership status flip to DISABLED |
| Force-deactivate or rotate QR points (property-wide or single) | Scanning dies instantly | Existing `active`/token fields; admin endpoint wraps them |
| Freeze public QR ordering for a property | Menu and order endpoints return "temporarily unavailable" while staff ordering continues | New `Property.nrmsQrOrderingFrozenAt` (small migration) checked in `loadActivePoint` |
| Flag suspicious payment instructions | Guest "How to pay" hidden pending owner correction | New `reviewStatus` alongside the JSON, or admin clears the JSON with reason; protects guests from a hijacked account advertising a fraudster's till number |

**UI**: action buttons with confirm modals on the Phase 1 property/owner detail pages, plus a "recent enforcement actions" feed backed by `AdminAudit`.

### Phase 3: Commercial levers (pricing, trials, credit)

The numbers that define the NRMS deal are already data, not code: `NrmsUsageChargePolicy` holds the room-night price (currently TZS 500), the trial length (45 days), the reminder threshold (25,000), the warning threshold (40,000) and the unpaid limit (50,000). Each property account snapshots the policy at activation. Today none of this is reachable except in the database, so the business cannot move without a developer. This phase hands the levers to admin.

**Global pricing editor**
- View the active policy and its full version history.
- Publish a new policy version: set room-night price, trial days, reminder/warning/limit amounts, effective-from date. The old version is closed (`effectiveTo`), never edited, so every historical charge stays explainable.
- Forward-only by principle: a new price applies to activations and usage accrued after its effective date. Usage events already snapshot their amount at accrual, so past charges never move.

**Per-property commercial overrides** (each with reason, audit, owner notification; 2FA where marked)
- Extend or shorten a running trial: edit `trialEndsAt` on the property's account. The lever for pilots, partner deals, or clawing back an abused trial.
- Adjust the unpaid credit limit per property (2FA): a trusted lodge can run a higher balance; a risky one gets tightened.
- Grant credit / comp a period (2FA): posted as REVERSAL usage events against the account, never by deleting billable events.
- Migrate one account to a newer policy version explicitly (2FA), for renegotiated deals; nothing migrates implicitly.

**Dunning configuration**
- The reminder and warning thresholds in the policy drive the collection sequence; this phase adds the sequence itself: what happens at each threshold (in-app alert, email, restriction), grace days before a freeze, and a per-account view of where every debtor sits in that sequence. Collections becomes a process the admin owns, not a worklist they interpret.

### Phase 4: Billing reconciliation (PAYG is NoLSAF revenue)

- **Statement browser**: statements with items down to the usage event and room-night; the answer to any owner dispute about a bill.
- **Payment timeline**: every `NrmsServicePaymentToken` joined to its `PaymentEvent` webhook rows; one screen showing initiated, prompted, confirmed, reconciled.
- **Stuck-payment queue**: tokens in PROCESSING older than N hours, webhook amount mismatches (today only a console.warn), and FAILED tokens; each row resolvable by admin: mark reconciled with provider reference (2FA) or void the token so the owner can retry. Both write `NrmsServicePayment`/`AdminAudit` rows; nothing is edited in place.
- **Manual adjustment**: credit or reverse a usage event via a REVERSAL classification event (never editing the original), with reason. Shares machinery with Phase 3's comp lever.
- **Exports**: CSV of statements/payments per period for accounting.

### Phase 5: Integrity signals and tracking

Detection, not punishment: surface the patterns, let a human decide, feed the Impact Center (in-app alerts only, per existing decision).

- **Anomaly signals** (computed daily by a worker, stored per property): void and cancel rates per outlet and per staff member vs property baseline; folio charges voided after checkout; night audit not run for N days while orders flow; cashier shifts with repeated variances; readiness overrides ("check in anyway") frequency; QR rate-limit hits per property (requires counting limiter rejections into a small metrics table); order points rotated unusually often.
- **Property risk view**: signals rolled into a simple attention list ("3 properties need a look this week"), not a score theater.
- **Unified activity timeline** per property: reservation events, enforcement actions, billing events and night audits interleaved chronologically; the single page an admin reads before acting on a complaint.

### Phase 6: Support tooling

- **Read-only property snapshot** ("view as property", explicitly not impersonation): renders the owner's key screens from admin credentials for support calls, write-blocked at the API by the existing impersonation guard pattern.
- **Dispute export**: a property's orders, folio and statements for a period as PDF/CSV on request.
- **Retention**: define how long order-level and guest-level data is kept for closed accounts, and implement the cleanup worker.

Retention policy implemented in Phase 6:
- Retention starts only after an admin explicitly schedules a permanently closed account with finance OTP, a typed reason, audit row and owner notification. A temporary Phase 2 property freeze does not start the clock.
- Guest identifiers are retained for 730 days after the recorded closure, then names, contact details, nationality, notes and campaign recipient identifiers are anonymized.
- Operational free text is retained for 2,555 days after closure, then reservation references/notes, folio notes, payment references and guest-entered order text are minimized.
- Financial totals, ledger entries, night audits, AdminAudit rows and immutable NRMS usage events are retained so billing and accounting remain explainable.

## 5. Authorization matrix after the roadmap

| Surface | Owner/Manager can | Admin can (new) |
|---------|-------------------|-----------------|
| Enrollment | Enroll, cancel own | Suspend, restore, view all |
| Property NRMS access | Activate | Freeze, reopen, view all |
| Staff membership | Invite, revoke (own property) | View all, disable globally, kill sessions |
| Staff invites | Send, resend | Invalidate outstanding |
| QR order points | Create, rotate, deactivate | View all, force-rotate/deactivate, freeze property-wide |
| Public QR traffic | n/a | Freeze per property, see abuse counters |
| Orders, folio, audits | Full operation | Read-only view, anomaly signals, dispute export |
| PAYG pricing and trials | n/a (accepts the deal) | Version room-night price/trial days/thresholds, extend trials, adjust credit limits, grant credit |
| PAYG billing | Pay statements | Full reconciliation, adjustment, dunning sequence |
| Payment instructions | Edit | Review, hide pending correction |

## 6. Explicitly out of scope

- Admin creating or editing orders, menus, reservations, folio entries or audits. Oversight, not operation.
- Any access to the hotel's own money channels. NoLSAF reconciles only its own PAYG revenue.
- Automated punishment (auto-suspend on a signal). Signals inform a human; a human acts.
- SMS to guests from admin. All notification stays owner-to-guest.

## 7. Build order and sizing

| Phase | Contents | Schema changes | Relative size |
|-------|----------|----------------|---------------|
| 1 | Read-only console (3 pages + admin.nrms.ts) | None | Medium |
| 2 | Enforcement actions + audit + notifications | 2 small columns (`nrmsQrOrderingFrozenAt`, invite invalidation) | Medium |
| 3 | Commercial levers: policy versioning, trial/credit overrides, dunning sequence | None for pricing (policy table exists); dunning config table | Medium |
| 4 | Billing reconciliation suite | None (uses existing billing tables + AdminAudit) | Medium-large |
| 5 | Signals worker + metrics table + timeline | 1 small metrics table | Medium |
| 6 | Support snapshot + exports + retention | Retention fields TBD | Small-medium |

Recommended start: Phase 1, the two Phase 2 quick wins that need no migration (enrollment suspend, global staff disable), and the two platform prerequisites below marked "before real traffic", since `isNrmsEntitled` and membership status checks already enforce the enforcement wins everywhere the moment the status flips.

## 8. Platform prerequisites (protective and scale work outside the console)

Admin pages are only half of "protective and scalable". These items have no UI of their own but the platform is not production-honest without them.

| Item | Why | When |
|------|-----|------|
| Redis-backed rate limiters for public QR endpoints | `express-rate-limit` counts per process; behind a multi-instance load balancer every public limit silently multiplies by the instance count. The CSRF layer's Redis-with-fallback pattern is the template. | Before real traffic |
| Worker health monitoring | Billing statements and daily housekeeping depend on background workers; a silently dead worker means bills stop accruing and rooms stop entering the cleaning cycle. Log every run, alert the Impact Center on a missed run. | Before real traffic |
| Global QR kill switch | One platform-wide off switch for the public ordering surface (bad deploy, abuse wave), independent of per-property freezes. | BUILT: `/admin/nrms/health`, finance approver + OTP |
| Persistent abuse counters | Phase 5's per-property rate-limit signals cannot be computed from per-instance memory; rejections must increment a small metrics table (or Redis counters flushed to it). | With Phase 5 |
| Per-property quotas | Caps on rooms, outlets, menu items, staff and QR points; generous defaults, admin-raisable. Protects the database from one pathological tenant. | BUILT: enforced on NRMS creation paths |
| Data protection (Tanzania PDPA 2022) | Guest PII accumulates at scale: export/delete a guest's data on request, retention rules enforced by a cleanup worker, SMS consent already recorded. Legal exposure, not a feature. | With Phase 6, requirements fixed earlier |
| Backup and restore discipline | Ledgers and night audits are only as immutable as the database under them: documented backup cadence, point-in-time recovery, rehearsed restore drill. | Ops runbook, immediately |
| Adoption funnel analytics | Enrolled, activated, first staff invite, first order, first night audit, first paid statement: where owners stall is the product roadmap. | With Phase 1 (same read queries) |
| Public menu caching | Menu GET is deliberately no-store for stock accuracy; at hundreds of properties a 30-60s cache is the relief valve. Decision recorded now so it is a plan, not a surprise. | When traffic demands |

## 9. Open decisions for Daniel

1. Should enrollment suspension also freeze the owner's marketplace presence, or NRMS only? (proposed: NRMS only; marketplace moderation stays a separate lever)
2. Who inside NoLSAF gets these powers: all admins, or a finance subset for the money phases? (proposed: all admins for 1-2, finance-flagged admins for 3-4)
3. Stuck-payment threshold for the Phase 4 queue (proposed: PROCESSING older than 6 hours)
4. Signal review cadence for Phase 5 (proposed: daily compute, weekly digest into Impact Center)
5. Dunning sequence defaults for Phase 3 (proposed: reminder at 25,000, warning at 40,000 as today; freeze at limit after 3 grace days instead of instantly)
6. May admin shorten a running trial, or only extend? (proposed: both, since abuse exists, but shortening requires 2FA and 7 days notice to the owner)
