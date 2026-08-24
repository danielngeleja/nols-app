# Agent bookings as group reservations

**Status:** staging candidate completed on 2026-08-24.
**Written:** 2026-08-24

## The problem in one line

An agent booking is one reservation carrying ten allocations, so the hotel gets
one folio, one check-in button and no rooming list, while an equivalent group
block gets ten reservations, ten folios, per-room check-in and the row and
column workspace at `/owner/nrms/groups`.

Everything the hotel needs already exists. It is wired to blocks, not to agent
bookings.

## What the hotel gets when this lands

The same workspace as `Kilimo Chao Tour`, reached from the agent request:

- One row per room: guest, room number, stay dates, status
- Room assignments complete / incomplete banner, with Manage rooms
- Check in and Check out for the whole party, or per row
- Review readiness and Review checkout, with per-room blockers
- `Agency billing is locked to BLK-…` on the footer
- Each traveller with their own folio, so one guest's bar tab is their own

## The decision that was blocking this

A master folio hangs off `blockId` **or** `agentBookingRequestId`
(`schema.prisma`, model `NrmsMasterFolio`). Both are nullable and unique, and
they sit on the same row. So the folio an agent booking already owns can also be
claimed by the block created for it. One folio, one set of payments, two owners
that both read it.

That removes the accounting fork: no payment is moved or recreated. The
hardening migration adds durable operational links from the request and every
manifest traveller to the room reservation created for them. Those links are
identity keys, not a second financial ledger.

## Flow, as built

The conversion happens at **manifest verification**, not at approval. That is
both what the hotel asked for ("the transformation of UI after review") and by
far the safer place to put it: everything before verification, the hold, the
approval, the invoice, the payment, the voucher and the expiry sweep, is
untouched and still runs on the single-reservation path.

### 1. Approval is unchanged

`createAgentHold` still writes one HELD reservation with N allocations. The
hold, decline, withdraw and expiry logic all keep working exactly as before.

### 2. Verification splits the booking

`materialiseAgentBookingRooms` (`apps/api/src/lib/nrmsAgentGroupMaterialise.ts`)
runs inside the verify transaction and:

1. releases the placeholder's allocations and cancels it, so the property never
   counts the same night twice
2. creates a `NrmsGroupBlock` named after the agency, with `billingMode` from
   the incidental declaration (AGENCY becomes MASTER, INDIVIDUAL_GUEST becomes
   SPLIT) and `cutOffAt` set to arrival, because a paid agency must never lose
   rooms to a names deadline
3. creates one `NrmsGroupBlockRoom` line for the booked room type and quantity
4. claims the agency's existing master folio for the block, by setting `blockId`
   on the same row that already carries `agentBookingRequestId`
5. groups the manifest by `roomNumber`, reuses a property guest profile only
   when a verified phone or email matches, and calls `pickUpBlockRoom` once per
   party
6. writes the new reservation id onto both the room reservation and every
   traveller in that room, so later screens never infer identity from a name

`pickUpBlockRoom` gained an optional `source` and `agentPropertyLinkId`, so the
resulting stays stay on the AGENT channel: the reservations table keeps its
badge and usage billing keeps classifying them BILLABLE_AGENT.

It refuses to run and leaves the booking alone when: it has already run, no
traveller was named, the reservation is not confirmed, or **any room-night has
already been billed**. That last one matters because usage billing dedupes on
allocation id, and new allocations would re-charge nights already posted.

### 3. The hotel is handed to the group workspace

The manifest review page shows a banner once the split has happened, linking to
`/owner/nrms/groups?group=<id>`, which now opens that party directly. Each room
shows its linked occupants, and the full verified register remains reachable
from the group header.

### 4. Money

- The agency invoice is untouched, still one invoice on the master folio.
- Each room's charge routes to that folio at pick-up, which is what
  `transferredToMaster` means everywhere else in NRMS.
- The `amountPaid` mirror is retired. Recording an agency payment no longer
  writes the folio total onto the reservation, and every view reads one
  `effectivePaid` figure resolved by the API from whichever ledger holds the
  money. That removes the cause of the double counting rather than the symptom.
- Extras route through `agentCoverDecision`: a charge reaches the agency bill
  only if the declaration covers its category and the running total is still
  inside the declared limit. Anything else stays on the traveller's folio.
  Per-traveller caps are evaluated against the specific room stay, not pooled
  across the entire group.

### 5. Check-in, check-out, rooms

Nothing new was needed. The reservations exist and share a group, so the
existing group endpoints and modal do all of it.

## What happens to bookings approved before the change

Existing unsplit bookings keep their original single-reservation behavior.
Already-split records are repaired deterministically from the block rooms and
folio source keys: child reservations receive the request link and manifest
travellers receive the reservation for their declared room. The migration also
backfills links where the evidence is unambiguous. No settled payment is copied
or moved.

## Order of work

1. ~~Block and folio at approval~~ replaced by: block and folio at verification,
   which leaves the whole hold and invoice lifecycle untouched **(done)**
2. `pickUpBlockRoom` source fix, plus manifest to pick-up on verification **(done)**
3. Group creation and naming, review page links into the group workspace **(done)**
4. Retire the `amountPaid` mirror, one `effectivePaid` from the API **(done)**
5. Extras routing from the incidental cover declaration **(done)**

Steps 1 and 2 are the load-bearing ones. Step 5 is what makes "agency covers
restaurant up to 50,000 per night" real rather than advisory.

## Risks worth naming

- **The original `reservationId` still names the audit placeholder.** Operational
  code no longer guesses from it: child stays carry
  `materializedAgentBookingRequestId`, and manifest guests carry their room's
  `reservationId`. The placeholder remains useful for approval and audit
  history without being mistaken for the checked-in stay.
- **Retries and concurrency are explicit.** Agent booking creation and hotel
  payment confirmation use stable client mutation keys. Materialisation locks
  the request and claims the folio once, while payment confirmation locks the
  folio and rejects duplicate references. A lost response can be retried safely.
- **A capped cover never splits a charge.** Once the ceiling is reached the
  whole charge stays with the traveller rather than being divided, because half
  a bar tab on each bill is a line item nobody agreed to.
- **The split is one-way and pre-arrival.** There is no un-split. Verification
  is guarded to SUBMITTED only, so a verified manifest cannot be returned, which
  is what makes that safe.
- **A party of twelve in ten rooms** needs the manifest's room grouping to be
  trustworthy. The agent no longer picks room numbers, correctly, but they are
  still the only party who knows who shares a bed.
- **Cut-off.** A block releases unnamed rooms at `cutOffAt`. An agency that has
  paid must never lose rooms to a cut-off timer, so the cut-off has to be pinned
  to check-in for paid agent blocks, not to the hold TTL.

## Staging acceptance gate

Before promotion, deploy the migration, regenerate Prisma Client, and exercise
one end-to-end booking with two rooms and at least one co-occupant. Acceptance
requires: one request after a retried submit, one master folio and payment after
a retried confirmation, one child reservation per room, every traveller linked
to the correct child stay, independent room check-in, and extras appearing on
only the policy-selected folio.
