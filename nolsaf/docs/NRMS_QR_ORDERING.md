# NRMS QR Ordering: Guest Self-Service for Restaurant and Bar

Status: ALL 7 MILESTONES BUILT (2026-08-03). Migrations prepared, pending approval: 20260718113000_nrms_menu_polish, 20260718140000_nrms_order_points, 20260718170000_nrms_qr_guest_orders, 20260718200000_nrms_guest_pay_instructions. Milestone 1 and earlier migrations are applied locally. Decisions applied: out-of-stock shows greyed "Not available today", auto-accept defaults off with a per-outlet toggle, 200-char guest note included. Milestone 5: charge-to-room verified purely by the point->stay link (room QR resolving to an ACTIVE allocation on a CHECKED_IN reservation); no guest name entry (decision 2026-07-24, superseding the earlier last-name check). Milestone 6 (decision 2026-07-18): NO NoLSAF checkout for guest orders. Money goes directly to the property's own receiving channels (their Lipa Namba, bank, card machine, cash), avoiding collection, disbursement delay and reconciliation cost. The owner configures payment details once (QR order points page); the guest order page displays them; staff record the tender at settle exactly as for any outlet sale. Milestone 7 (decision 2026-08-03): an eligible front-desk check-in automatically queues a personalized SMS containing the assigned room's secure ordering link.
Owner: Daniel
Written: 2026-07-17
Rule: no implementation begins until this document is reviewed and approved. Any scope change is edited here first.

## 1. Vision

Every room (and later every restaurant/bar table) carries a printed QR code, downloaded from NRMS and placed by the owner. A guest scans it with a phone camera. No app, no login. The phone opens a NoLSAF menu page for that property showing, live:

- the restaurant menu with what is actually available right now,
- the bar shelf with the drinks actually in stock,
- a clear description, photo and price for every meal so the guest can set the standard they expect before ordering.

The guest selects items and places the order. The order lands on the restaurant or bar live queue inside NRMS, labeled with the room (or table) it came from. Staff prepare and deliver. Charging and settlement flow through the exact folio, cashier shift, classification, night audit and ledger controls NRMS already enforces.

## 2. Why we are building it

- The restaurant and bar module today can only serve checked-in guests, and only through staff. Real properties earn most outlet revenue from wider service. QR ordering plus walk-in sales makes NRMS the system for every sale, all day.
- OTAs (Airbnb, Booking.com, Expedia, Agoda) do not and will not operate on-property. No competition from the demand side.
- Global PMSs offer this only as stitched-together add-ons (eZee Absolute + Optimus + guest portal; Cloudbeds/Mews via third-party in-room dining apps over folio APIs). We ship it as one system: same database for the QR order, stock availability, folio, cashier shift and night audit.
- Their guest payment rails are card/Apple Pay/Google Pay. Ours are mobile money (M-Pesa, Airtel Money), which is what actually works in our market, and we already run those rails for bookings.
- Almost nothing in our segment in Tanzania has deployed this. First in-market with a practical version is the win condition.
- The QR page is also a NoLSAF acquisition channel. Every guest of every NRMS property, regardless of where they booked, meets the NoLSAF brand at the bedside and uses it to order. The order-status page may carry one quiet marketplace touch ("book your next stay on NoLSAF"), never intrusive, never blocking the order flow. This turns partner properties into zero-cost demand generation for the marketplace.

### Product philosophy (governs scope decisions in this doc)

We are working for premium execution of existing demand, not inventing new demand. The regional problem is systems (paper order books, unreconciled tills, unknown room status), not appetite. Features are judged by whether they solve a problem a Tanzanian property has today, work with the payment and connectivity reality of the market (mobile money, intermittent data), and remain boring and correct under audit. Trend-driven additions (AI assistants and similar) are out of scope unless they pass the same test.

## 3. Prerequisite polish (must land before or with the QR work)

The QR page is a shop window. The shop must be presentable first.

### 3.1 Menu quality (restaurant and bar)
- Menu items gain: description text, photo, and a live availability toggle (in stock / out of stock) that staff flip from the outlet screen.
- Categories become first-class for browsing (starters, mains, drinks, spirits, beers, soft drinks and so on) with a defined display order.
- Bar items are the same model as meals: the "bar shelf" is the bar outlet menu with availability flags.
- Out-of-stock items either hide or show greyed with "not available today" (owner setting).

### 3.2 Walk-in and non-resident orders (foundation)
- An outlet order no longer requires a checked-in reservation. Non-guest orders carry a label (table, name, "walk-in") and can only settle as direct outlet payment with a recorded tender.
- All existing controls remain: cashier shifts, payment classification, night audit, ledger, void with reason.

## 4. Guest flow (agreed)

1. Scan QR in the room. URL opens `<WEB_ORIGIN>/menu/<token>`: localhost in development, the staging web domain in staging, and the NoLSAF web domain in production.
2. Page shows the property's outlets (Restaurant, Bar) with live menus: photo, description, price, availability.
3. Guest selects items into a simple cart and places the order.
4. Order enters status PLACED with the room label. Staff see it instantly on the live queue and tap Accept (moves to CONFIRMED and the kitchen/bar starts). A per-outlet auto-accept toggle exists for owners who want zero friction.
5. Guest phone shows live status: received, being prepared, served.
6. Settlement:
   - In-house guest (QR is a room with a checked-in stay): may choose "Add to my bill", posted straight to the folio through the existing pipeline. No name entry: the room's QR resolving to an ACTIVE allocation on a CHECKED_IN reservation is the verification (decision 2026-07-24, replacing the earlier last-name check). The link needs no rotation at check-in/checkout: the lookup is scoped to the currently active stay on that room, so it tracks whichever guest is actually checked in and goes quiet automatically once they check out.
   - Anyone else: chooses "Pay Now" and pays at the counter/waiter exactly like today's outlet payment (cash, mobile money, bank, card), tender required before settle.
7. Later phase: pay from the phone via mobile money using the payment rails already used for booking deposits.
8. At check-in, NoLSAF automatically sends the guest a personalized room-ordering welcome when all eligibility checks pass: NRMS is active, the guest has a phone number, QR ordering is not administratively frozen, an assigned room has an active ordering-enabled ROOM point, and the property has an active RESTAURANT or BAR outlet. The SMS is queued transactionally and delivered by the guest-automation worker, so provider downtime cannot cause a duplicate message or a partially sent check-in. Group and marketplace-projected NRMS check-ins use the same rule.

## 5. Build milestones (dependency order, each independently shippable)

| # | Milestone | Contents | Depends on |
|---|-----------|----------|------------|
| 1 | Walk-in sales | Nullable reservation on outlet orders, customer label, direct settlement only, reports split resident vs non-resident | nothing |
| 2 | Menu polish | Descriptions, photos, availability toggles, category ordering, outlet screen management UI | nothing (parallel with 1) |
| 3 | Order points and QR | Order-point model (ROOM or TABLE, signed revocable token), QR generation and downloadable/printable PDF sheet from the Outlets page | 1 |
| 4 | Public menu and ordering | Public token-scoped API (menu fetch, order create, status poll), mobile-first guest page, PLACED status with staff Accept, rate limiting and abuse caps | 1, 2, 3 |
| 5 | Room folio charging | "Charge to my room" when the room QR resolves to an active allocation on a checked-in stay | 4 |
| 6 | Guest mobile-money payment | Pay the order from the phone via existing AzamPay/Coral rails, recorded as settled outlet payment | 4 (5 optional) |
| 7 | Automatic check-in welcome | On eligible check-in, queue one personalized SMS per stay with the assigned room's secure ordering link; skip safely when the guest, room QR, outlet, or QR service is ineligible | 3, 4, 5 |

Definition of done for each milestone: a real outlet runs a full day on it without falling back to paper.

## 6. Security and abuse posture

- QR tokens are high-entropy random bearer tokens (144 bits from a CSPRNG, unique per order point), property-scoped, and revocable per room/table (one click rotate makes the old code dead instantly; reprint). They are not signed JWTs: possession of the token is the capability, and the database row is the source of truth for validity, which is what makes instant revocation possible.
- Public endpoints are rate-limited per IP (as built: menu fetch 120 per 5 min, order placement 8 per 10 min, status polling 30 per min), inputs sanitized, order size capped (20 lines, quantity 20 each), and each room/table can hold at most 5 unfinished orders at a time.
- PLACED orders cost the kitchen nothing until staff Accept; auto-accept is opt-in per outlet.
- Room charging requires an actually checked-in stay on that exact room (the point->stay lookup, scoped to ACTIVE allocations on CHECKED_IN reservations); failure falls back to pay-at-counter. No guest personal data is shown on the public page.
- NoLSAF never handles the guest's money for outlet orders: payment goes directly to the property's own channels (their Lipa Namba, bank, card machine, cash) and staff record the tender at settle.

### 6.1 Fair use (the promise and its boundary)

Ordinary guest ordering is free and stays free: no per-order charge, no per-scan charge, no cap on how many genuine orders a busy restaurant takes in a day. NRMS billing remains what it is today (PAYG per room-night); QR traffic adds nothing to an owner's bill.

The boundary is abuse, not volume of real business. Automated or plainly non-human traffic (scripted scanning, order flooding, token scraping) is throttled by the rate limits above and may be blocked at source; a room or table generating abusive traffic can be rotated or deactivated by the owner in one click. These controls exist to protect the shared infrastructure every property depends on, never to monetize orders. If a legitimate property ever hits a limit through real guest volume, the limit is raised, not billed.

## 7. Explicitly out of scope (for now)

- Kitchen display system as a separate screen (the live queue serves this).
- Ingredient-level stock/inventory management (availability is a manual toggle first).
- Table maps / floor plans (order points are a flat list first).
- Multi-language guest page (English first; Swahili as a fast follow).
- TRA/VFD fiscal receipts (deferred by decision on 2026-07-17).

## 8. Open decisions for Daniel

1. Should out-of-stock items hide completely or show greyed out? (proposed: owner setting, default greyed)
2. Auto-accept default for QR orders: off (staff must accept) is proposed.
3. Do rooms get QR codes only, or tables in the first release too? (model supports both from day one; printing both is proposed)
4. Service charge / delivery note on QR orders: include a free-text note field? (proposed: yes, 200 chars)

## 9. Competitive references

- Mews POS QR ordering: https://www.mews.com/en/products/pos
- eZee Optimus (separate POS product): https://www.ezeeoptimus.com/
- eZee guest portal contactless room service: https://release.ezeetechnosys.com/guest-portal-contactless-ordering-for-room-service-orders/
- Pxier In-Room Dining (third-party add-on used by Cloudbeds/Mews/OPERA properties): https://www.pxier.com/en/in-room-dining-software
