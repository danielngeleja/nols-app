# NRMS Stock, Purchasing and Variance: Knowing Where Every Bottle and Kilo Went

Status: APPROVED 2026-09-24 with the section 15 recommendations as written (D1 to D11). Supplier network deferred (section 12). Milestone 1 BUILT 2026-09-24 (see 13.1); migration `20260924090000_add_nrms_stock_foundation`. Milestone 2 BUILT 2026-09-25 (see 13.2); migration `20260925090000_add_nrms_stock_purchasing`. Milestone 3 BUILT 2026-09-25 (see 13.3); migration `20260926090000_add_nrms_stock_counts` PREPARED, NOT APPLIED.
Owner: Daniel
Written: 2026-09-24
Rule: no implementation begins until this document is reviewed and approved. Any scope change is edited here first. No migration runs without Daniel's explicit yes.

## 1. Vision

An owner who is not on site opens NRMS (or reads the morning SMS/WhatsApp digest) and sees, in plain numbers:

> Bar, week of 15 to 21 September. Kilimanjaro Lager: 40 sold, stock fell by 52. 12 bottles unexplained, TZS 30,000 at cost, TZS 72,000 at selling price. Counted by Asha on Sunday close, bar held by Juma and Neema across 6 shifts.

Behind that sentence sits one system that already knows:

- what was **ordered** from which supplier, at what agreed price,
- what actually **arrived** (counted, weighed, damaged items rejected), at what price was really paid,
- what moved from the **main store** to the bar or the kitchen,
- what was **sold** (every order already goes through NRMS), and what that sale should have consumed (one bottle of beer, 25 ml of gin, 250 g of fish),
- what was **written off** with a reason (broken, spoiled, staff meal, complimentary),
- what was **physically counted**, by whom, and when.

The difference between what the system expects and what staff count is the variance. Variance is where the money goes.

## 2. Why we are building it

- Owner-managed hotels, lodges and guest houses in Tanzania lose the most money in the bar and the kitchen store, not at the front desk. Bottles walk out, fish is "bought" at inflated market prices, meat is under-weighed on delivery, and nobody can prove anything because stock lives in an exercise book.
- NRMS already records every sale (outlet orders, QR orders, walk-ins, folio posting, shifts, night audit). The sales half of the equation exists. The goods-in half and the count half do not. Once they exist, variance is arithmetic.
- The current stock feature (`NrmsMenuItem.stockQuantity`, `apps/api/src/lib/nrmsStock.ts`) counts **menu items**, not **goods**. A Kilimanjaro sold in the bar and the same Kilimanjaro sold in the restaurant are two unrelated counters, a bottle of gin cannot be sold by the tot, and a fish dish consumes nothing. It answers "can we still sell this today" and cannot answer "where did the stock go".
- eZee, Cloudbeds and Mews sell inventory and purchasing as a separate module or a third-party integration (Optimus, MarketMan, Apicbase), priced for chains. Small East African properties get nothing that works with market purchases, mobile-money supplier payments and weak connectivity. Built into NRMS, it rides the same order, shift and ledger data with no second system to reconcile.

### Product philosophy (governs scope decisions in this doc)

Premium execution of an existing problem. No AI forecasting, no barcode hardware, no supplier marketplace. The test for every feature: does a real Tanzanian property do this on paper today, does it work with cash and mobile money and a weak connection, and does it stay boring and correct under audit. Variance is presented as a **signal to investigate**, never as an automatic accusation against a named person.

## 3. What exists today (grounding)

| Area | Today | Gap |
|---|---|---|
| Counted stock | `NrmsMenuItem.stockQuantity Int?` + `lowStockThreshold`, reserved atomically at order creation, restored on cancel, not restored on void (`nrmsStock.ts`) | Counts menu items per outlet, integers only, no cost, no history of why it moved |
| Stock page | `/owner/nrms/stock`, editable quantity per menu item, BAR/RESTAURANT/OUTLET_SUPERVISOR/MANAGER | Editing a quantity leaves no trace, so a missing bottle can be "fixed" silently |
| Expenses | `NrmsExpense` with category `SUPPLIES`, optional tender, null tender = accrued to `2400 Accounts payable` in the night-audit ledger | No supplier, no line items, no link to the goods that arrived |
| Ledger | Night audit derives postings in `owner.nrms.finance.ts` (tender assets 1000 to 1090, revenue 4200 to 4290, expenses 5100 to 5900, AP 2400) | No inventory asset account, no cost of goods sold, so gross profit cannot be computed |
| Roles | MANAGER, SALES_EXECUTIVE, FRONT_DESK, RESTAURANT, BAR, OUTLET_SUPERVISOR | No one owns the store |
| Shift handover | Zero manual cash entry, server-computed close summary (`nrmsShifts.ts`) | Handover passes cash responsibility but not bottle responsibility |

Everything below builds on these; nothing here replaces the order, folio, shift or night-audit pipelines.

## 4. Core concepts

### 4.1 Stock item (the physical good)

A thing the property buys and holds: Kilimanjaro Lager 500 ml, Konyagi 750 ml, Tilapia (whole), Beef fillet, Rice, Cooking oil, Coca-Cola 350 ml.

- **Base unit**: the smallest unit we count in. `BOTTLE`, `CAN`, `PIECE`, `ML`, `G`. Quantities are stored as decimals in the base unit (for example `Decimal(14,3)`), so 1.5 kg of fish is 1500 g and 7.3 bottles of gin are valid.
- **Pack units**: how it is bought. Crate = 25 bottles, carton = 24 cans, case = 12 bottles, sack = 25 kg. Each pack unit has a conversion to the base unit. Suppliers sell in packs, stores issue in packs or loose, sales consume in base units.
- **Category**: BEER, SPIRITS, WINE, SOFT_DRINKS, WATER, MEAT, FISH_SEAFOOD, POULTRY, PRODUCE, DAIRY_EGGS, DRY_GOODS, OTHER. Drives reporting groups and which COGS account a sale hits (beverage vs food).
- **Perishable flag** plus optional shelf-life days. Perishables get expiry prompts on receipt and a spoilage write-off shortcut.
- **Par level and reorder point** per location (section 4.2). Below reorder point, the item appears on the reorder list.
- **Current average cost** per base unit (section 8.1).
- **Count style**: `WHOLE` (beer, cans, pieces) or `PARTIAL` (spirits and wine counted in tenths of a bottle, meat and fish counted by weight).

### 4.2 Stock location

Where goods physically sit, each with its own balance per item:

- `STORE`: the main store room (optional, see decision D2).
- One location per outlet that holds stock: the bar, the kitchen. Created automatically for each `NrmsOutlet`.

Small properties where "the bar is the store" run in **single-location mode**: goods are received straight into the outlet and transfers never appear.

### 4.3 Recipe (menu item to stock link)

A menu item consumes one or more stock items when it is sold:

| Menu item | Consumes |
|---|---|
| Kilimanjaro Lager | 1 BOTTLE Kilimanjaro Lager 500 ml |
| Konyagi single | 25 ML Konyagi 750 ml |
| Konyagi bottle | 750 ML Konyagi 750 ml |
| Grilled tilapia with chips | 1 PIECE Tilapia, 300 G Potatoes, 30 ML Cooking oil |
| Coca-Cola | 1 BOTTLE Coca-Cola 350 ml |

- A recipe line can carry a **yield/loss percentage** for kitchen items (a 1 kg fillet yields 850 g usable), so the expected consumption is honest.
- Menu items **without** a recipe keep today's behaviour exactly (untracked, or the legacy menu-level counter). Nothing breaks for a property that never sets this up.
- A menu item with a recipe derives its availability from the stock at its outlet's location: Kilimanjaro is "out" when the bar location has fewer than one bottle, regardless of how many sit in the store. The legacy `stockQuantity` on that menu item is no longer used (migration path in section 11).
- Sub-recipes (a sauce made in batches, then used by several dishes) are out of scope for v1 (section 12).

### 4.4 Stock movement (the append-only ledger)

Every change to a balance is a movement row. Balances are a cached sum of movements, never edited directly. This is the single property that makes variance trustworthy: there is no way to "just fix the number".

| Movement type | When | Effect |
|---|---|---|
| `OPENING_BALANCE` | Once per item and location at go-live, from an initial count | + |
| `RECEIPT` | Goods received from a supplier (with or without a purchase order) | + at receiving location |
| `TRANSFER_OUT` / `TRANSFER_IN` | Store issues 2 crates to the bar; always a pair | − source, + destination |
| `SALE` | Outlet order created (see decision D1) | − at outlet location, per recipe |
| `SALE_REVERSAL` | Order cancelled before service | + (restores, like `restoreMenuStock` today) |
| `WASTAGE` | Broken, spoiled, expired, spilled, returned by guest | − with mandatory reason |
| `STAFF_MEAL` | Staff consumption | − with reason, reported separately |
| `COMPLIMENTARY` | Owner/manager comp to a guest or visitor | − with approver |
| `RETURN_TO_SUPPLIER` | Damaged or wrong goods sent back after receipt | − |
| `COUNT_ADJUSTMENT` | The difference posted when a count is approved | ± equals the variance |

Each movement records: property, location, stock item, quantity in base units, unit cost at that moment, total cost, business day, source reference (order id, receipt id, count id, transfer id), actor, and time. Voided orders keep their `SALE` movement: the goods were consumed and the money reversed, exactly as `nrmsStock.ts` treats voids today, and the void report makes that visible.

## 5. Suppliers and purchasing

### 5.1 Supplier

Name, contact person, phone (WhatsApp-capable), email, TIN and VRN (optional, needed later for VAT input), physical location, payment terms (`CASH_ON_DELIVERY`, `CREDIT_7`, `CREDIT_14`, `CREDIT_30`), the supplier's receiving channels (Lipa Namba, M-Pesa/Airtel number, bank account), usual delivery days ("fish: Tuesday and Friday"), lead time, categories supplied, and active flag.

**Supplier price list**: per stock item and pack unit, the last price paid (automatic) and an optional agreed price. Used to pre-fill purchase orders and to flag price jumps at receipt.

Market vendors with no fixed identity (the fish lady at Feri market) are covered by one supplier per market, for example "Feri fish market (cash)". The goal is that every shilling spent on goods is attached to a supplier record, even a generic one.

### 5.2 The purchasing flow

```
Requisition  ->  Purchase order  ->  Sent to supplier  ->  Goods received (GRN)  ->  Supplier invoice  ->  Payment
 (bar/kitchen     (manager            (PDF + WhatsApp /     (storekeeper counts,      (what we owe)          (Lipa Namba, bank,
  asks)            approves)           SMS / email share)    weighs, rejects)                                  cash, mobile money)
```

Each step is optional where the real world skips it, but every path ends in a goods receipt, because that is the step that changes stock.

**Requisition** (bar, kitchen, outlet supervisor): "Need 5 crates Kilimanjaro, 10 kg beef by Friday." Pre-filled from the reorder list (items below reorder point, suggested quantity up to par). The requester does not choose the supplier or the price.

**Purchase order** (manager or owner): converts one or more requisitions, grouped by supplier, sets expected prices from the price list, expected delivery date. Approval thresholds (decision D5): above an amount set by the owner, a manager's PO needs owner approval. Status: `DRAFT -> APPROVED -> SENT -> PARTIALLY_RECEIVED -> RECEIVED | CANCELLED | CLOSED_SHORT`.

**Sending**: NRMS produces a PO PDF (house `pdfDocuments.ts` style) and a share action: WhatsApp link (`wa.me` with the supplier number and a short message plus the PDF link), SMS, or email. v1 does not require the supplier to log in or confirm anything. Whether to send through the property's existing Meta messaging connection is decision D7.

**Goods received note (GRN)**: the moment of truth, done by the storekeeper (or bar/kitchen in single-location mode) with the delivery in front of them:

- Against a PO: lines pre-filled with ordered quantities; receiver enters what actually arrived. Short deliveries leave the PO partially received. Over-deliveries are accepted only up to a tolerance or with manager approval.
- **Weighed goods** (meat, fish, poultry, produce): receiver enters the weight on the scale, not the weight on the paper. The supplier's claimed weight can be recorded next to it; the gap is reported.
- **Rejections**: damaged, spoiled, wrong item, with reason. Rejected quantity never enters stock.
- **Actual price paid per line**. Price above the last price or the agreed price by more than a tolerance (default 10%) is flagged on the receipt and in the owner digest.
- **Evidence**: photo of the supplier's delivery note or receipt (Cloudinary, a new `nrms-stock` folder, same access-check pattern as `nrms-menu`).
- **Expiry date** per line for perishables (optional).
- Receiver identity recorded. Separation of duties (decision D6): the person who approved the PO should not also be the sole receiver above the approval threshold.

**Direct purchase (no PO)**: the everyday market run. Kitchen staff take TZS 150,000 petty cash to the market, come back with fish and vegetables and a handwritten receipt. This is a GRN with no PO: supplier (often the generic market supplier), lines, weights, prices, receipt photo, paid immediately from a tender (cash, mobile money). This path is first-class, not an exception, because it is the most common purchase in the market and the one most prone to inflated prices. Direct purchases above a threshold need manager approval at entry.

**Supplier invoice and payment**:

- A GRN on credit terms creates a payable to the supplier (the supplier's balance goes up). A GRN paid on delivery records the tender and creates no payable.
- A supplier invoice can be recorded against one or more GRNs (invoice number, date, amount, VAT amount, photo). Invoice amount different from the received value is flagged (the supplier billed for goods we did not receive).
- Payments: amount, tender, reference (M-Pesa code, bank ref), who paid, partial payments allowed. NRMS records hotel money; it never moves it, exactly like guest pay instructions and hotel-direct deposits.
- Supplier statement (all GRNs, invoices, payments, running balance) as a page and a PDF, and an ageing view (current, 1 to 30, 31 to 60, 60+ days).

### 5.3 Relationship with `NrmsExpense`

Goods for resale or kitchen use go through purchasing, not `NrmsExpense`. Recording the same fish as both a `SUPPLIES` expense and a GRN would count the cost twice. `NrmsExpense` stays for non-stock spend (wages, utilities, repairs, licences, cleaning supplies until they are brought into stock). The expense form gets a hint when the description looks like stock ("Buying drinks or food? Record it as a purchase so it enters stock"), and the finance page shows purchasing totals as their own line. Whether to hard-block the `SUPPLIES` category for food and drink is decision D8.

## 6. Transfers, wastage and consumption

- **Transfer** (store to bar/kitchen, or bar to kitchen for cooking wine): issued by the storekeeper, lines in packs or base units. Default: a transfer is **received** by someone at the destination who confirms the quantities (two signatures, one per location). A transfer not confirmed within the business day shows as "in transit" and is on the manager's attention list. Single-step transfers are allowed in single-location mode only.
- **Wastage**: any staff member with access to the location records it, with a reason code (BROKEN, SPOILED, EXPIRED, SPILLED, GUEST_RETURN, OTHER) and optional photo. Above a value threshold it needs a manager's confirmation before it counts. Wastage is never silent and always shows in the report, so it cannot be used to hide theft without leaving a visible trail.
- **Staff meals and complimentary**: explicit movement types so they are reported rather than disappearing into variance.
- **Breakfast and meal plans** (`nrmsBreakfastList.ts`, `nrmsMealPlan.ts`): breakfast is served without per-guest orders. v1 lets the kitchen post a "breakfast service" consumption from a per-cover breakfast recipe times the covers served that day. Deferred to the last milestone because it needs the breakfast list numbers to be trusted first.

## 7. Counting and variance (the killer feature)

### 7.1 Stock counts

- A **count session** is for one location: `FULL` (every item) or `SPOT` (a chosen list, for example "all spirits"). Owners can schedule them (daily bar close, weekly full store count, monthly full count).
- **Blind by default** (decision D3): the counter sees item names and units, never the expected quantity. They enter what is physically there. This is the standard control against "count to match the book".
- Partial counts: spirits and wine in tenths of a bottle (0.1 to 1.0); weighed items in kg or g.
- Offline tolerant: counting happens in a store room with no signal. The count sheet is cached on the device and lines queue through the existing offline mutation foundation (`NrmsOfflineMutation`) with the same idempotency and conflict rules.
- The count is **frozen at a moment**. Sales that happen during the count are handled by recording the count's cut-off time and computing expected stock as of that cut-off, so a bar does not have to close to count.
- After submission, a manager **reviews** the variance and approves. Approval posts `COUNT_ADJUSTMENT` movements so the book matches the shelf from then on. Items above the tolerance require a note ("recount done, 2 bottles found in the cold room"). A recount request sends selected lines back to be counted again before approval.
- Counts can never be edited after approval; a mistake is corrected by a new count.

### 7.2 Shift handover count (bar)

Optional per outlet (decision D4). At bar shift handover, the incoming attendant counts a short list of high-value, high-risk items (spirits, premium beer, wine) before accepting the drawer. This extends the existing handover rule: the outgoing attendant hands over both cash (already computed by the system) and bottles (counted by the incoming attendant). A handover count variance is attributed to the outgoing shift window, which is the only fair way to say "the bar lost 3 bottles between 14:00 and 22:00". It uses the existing handover screen, one extra step, not a new flow.

### 7.3 The variance formula

For a location, an item and a period between two approved counts:

```
expected closing = opening count
                 + received
                 + transferred in   − transferred out
                 − sold (per recipe) + sale reversals
                 − wastage − staff meals − complimentary − returns to supplier

variance         = counted closing − expected closing
```

Reported in three units, because owners think in all three:

- **Quantity**: −12 bottles.
- **Cost**: −TZS 30,000 (at average cost). This is what the property lost.
- **Selling value**: −TZS 72,000 (at current menu price). This is the revenue that should have been in the till if those bottles were sold and not recorded. For a bar, this is the number that matters most.

And the plain-language "consumption" view Daniel named:

> Kilimanjaro Lager: sold 40, stock fell by 52.

Where "stock fell by" = opening count + received + net transfers − closing count. That sentence needs no accounting knowledge.

### 7.4 Variance report

- Per location and period, sorted by absolute value lost, grouped by category.
- Each line: opening, received, transfers, sold, wastage/staff/comp, expected, counted, variance (qty, cost, selling value), variance %.
- **Tolerance** per category (spirits tighter than produce), so small natural losses (a spilled tot, trimming loss on meat) do not create noise.
- **Who held the location**: the shifts and staff on duty at that outlet in the period, from `NrmsCashierShift`. Shown as context, never as "person X stole". With handover counts, the window narrows to one shift.
- **Trend**: the same item over the last 8 counts. One bad count is noise; a steady −3 every week is a pattern.
- Drill-down to every movement behind a number.
- Export: PDF and CSV, recorded like other report exports (see report print controls).

### 7.5 Other reports that fall out of the same data

- **Gross profit by outlet and by menu item**: revenue from orders minus cost of the recipe at average cost. GP % per item flags items priced below cost (common after supplier price rises).
- **Purchase price watch**: items whose price rose, by supplier, and receipts paid above the agreed price.
- **Supplier performance**: short deliveries, rejected quantity, late deliveries, price variance per supplier.
- **Wastage report**: by reason, item, location, and person recording it.
- **Stock valuation**: value on hand per location at average cost, for the month end.
- **Dead stock**: items with no movement in N days.

### 7.6 Owner digest

A daily (or weekly, owner's choice) short message to the owner by SMS or WhatsApp, and the same content as a card on the NRMS home page:

- top 3 variances in selling value since the last count,
- receipts with price jumps,
- wastage above threshold,
- items below reorder point with no open PO,
- overdue supplier payables.

Reuses the existing messaging and notification pipelines; wording is pre-approved templates, no free text.

## 8. Costing and the ledger

### 8.1 Cost method

**Weighted average cost** per stock item per property (not per location; a bottle costs the same in the store and in the bar). Recomputed on every receipt:

```
new average = (qty on hand × current average + received qty × received unit cost) / (qty on hand + received qty)
```

FIFO and lot costing are out of scope: they add real complexity and give small properties no better decisions. Every movement stores the unit cost used at that moment, so historic reports never change when the average moves.

Received unit cost is the actual price paid on the GRN divided into base units (a crate at TZS 42,500 for 25 bottles is TZS 1,700 per bottle). VAT handling (net or gross) follows the property's VAT status (decision D9).

### 8.2 Night-audit postings

The night-audit ledger derivation in `owner.nrms.finance.ts` gains new posting sources, same pattern (deterministic `sourceKey`, derived over the business-day window):

| Event | Debit | Credit |
|---|---|---|
| GRN paid on delivery | 1200 Inventory | tender (1000 to 1090) |
| GRN on credit | 1200 Inventory | 2400 Accounts payable |
| Supplier payment | 2400 Accounts payable | tender |
| Sale consumption, beverage | 5010 Cost of sales, beverage | 1200 Inventory |
| Sale consumption, food | 5020 Cost of sales, food | 1200 Inventory |
| Wastage | 5030 Stock wastage | 1200 Inventory |
| Staff meals | 5040 Staff meals | 1200 Inventory |
| Complimentary | 5050 Complimentary | 1200 Inventory |
| Count adjustment (loss) | 5060 Stock variance | 1200 Inventory |
| Count adjustment (gain) | 1200 Inventory | 5060 Stock variance |
| Return to supplier | 2400 Accounts payable (or tender if refunded) | 1200 Inventory |

Account codes above are proposals and must not collide with the existing 5000 (platform fees) and 5100 to 5900 series; the final numbers are fixed at implementation after checking every code in use. Transfers between locations post nothing (same asset, same property). With these, the finance page can show gross profit for the first time.

## 9. Roles and permissions

New assignable role **STOREKEEPER** (added to `NRMS_STAFF_ROLES`, labels, invite email; property-level, not outlet-scoped). Proposed matrix:

| Action | Owner | Manager | Storekeeper | Outlet supervisor | Bar / Restaurant |
|---|---|---|---|---|---|
| Stock items, units, recipes, par levels | yes | yes | view | recipes for own outlet (decision) | view |
| Suppliers and price lists | yes | yes | view | no | no |
| Requisition | yes | yes | yes | yes | yes |
| Approve purchase order | yes | up to threshold | no | no | no |
| Receive goods (GRN) | yes | yes | yes | own outlet in single-location mode | own outlet in single-location mode |
| Direct (market) purchase | yes | yes | yes | yes, needs approval above threshold | no |
| Transfer out of store | yes | yes | yes | no | no |
| Confirm transfer in | yes | yes | at store | own outlet | own outlet |
| Record wastage | yes | yes | yes | own outlet | own outlet (manager confirms above threshold) |
| Count | yes | yes | yes | own outlet | own outlet |
| Approve count / post adjustment | yes | yes | no | no | no |
| Supplier invoices and payments | yes | yes | no | no | no |
| Variance, GP, valuation reports | yes | yes | no | own outlet, quantities only | no |

Every write carries actor and time. Mutating endpoints that touch money or approvals use `blockImpersonated`.

## 10. Screens

Placed under the existing NRMS sidebar, checking existing nav groups first (the fiscal-card lesson):

- **Stock** (exists, `/owner/nrms/stock`): becomes the location view: balances per item at each location, low-stock pills, quick wastage and transfer actions. The legacy per-menu-item table remains for unlinked items.
- **Stock items** (`/owner/nrms/stock/items`): item catalogue, units and packs, par levels, and the recipe editor ("what does this menu item use").
- **Purchasing** (`/owner/nrms/purchasing`): requisitions, purchase orders, receiving (GRN) and direct purchases. The receiving screen is designed for a phone held in one hand next to a crate: big quantity steppers, weight input, photo button.
- **Suppliers** (`/owner/nrms/suppliers`): directory, price list, statement, payables ageing, record payment.
- **Counts** (`/owner/nrms/stock/counts`): start or continue a count, blind count sheet (offline capable), review and approve.
- **Variance and GP** (under Reports): the section 7.4 and 7.5 reports.

Admin (`/admin/nrms/[propertyId]`): read-only adoption and integrity signals only (is stock control switched on, last count date, count variance trend). Admin never edits a property's stock, consistent with "admin oversees, never operates".

## 11. Migration from today's menu-level stock

- Nothing changes for a property until it creates its first stock item. The feature is switched on per property.
- A helper offers to convert each currently tracked menu item (`stockQuantity` not null) into a stock item with a 1-unit recipe and an `OPENING_BALANCE` at that outlet's location equal to the current quantity, after the manager confirms each line. Nothing is converted automatically.
- Once a menu item has a recipe, `reserveMenuStock` / `restoreMenuStock` stop touching its `stockQuantity` and write `SALE` / `SALE_REVERSAL` movements instead, inside the same order transaction, with the same `gte` guard semantics on the location balance so concurrent orders still cannot oversell. Availability for the guest QR menu and staff order screens is derived from the location balance.
- Unlinked menu items keep today's behaviour indefinitely.

## 12. Explicitly out of scope (for now)

- Supplier portal or supplier logins, supplier-side PO confirmation.
- **Supplier network (decision 2026-09-24): deferred until adoption.** A supplier-facing dashboard where suppliers request links with owners and advertise what they sell is a separate B2B marketplace, not a stock control feature. Rejected for now because (1) it needs supplier onboarding, catalogue upkeep, disputes and support as a second customer type; (2) the suppliers that matter most (market fish, butcher, depot driver) run on WhatsApp and cash and would not use it, leaving owners with two purchasing modes; (3) supplier-entered prices and quantities would weaken the independent receiving control that variance depends on, so receiving stays hotel-side; (4) owners are losing money on the shelf, not struggling to find suppliers. It becomes worth building once many properties run purchasing on NRMS: aggregated real demand per category and region is leverage to negotiate group prices with distributors, the same aggregation thesis as `NRMS_MARKET_READINESS_PRIVATE.md` section 2. To keep that door cheap, supplier records store phone and TIN cleanly so a future supplier account can claim them without a data migration. The only supplier-facing surface in scope is an optional no-login capability link on a sent PO (confirm, delivery date) in milestone 4.
- Barcode or scale hardware integration (phone camera barcode scanning can be a later polish).
- Sub-recipes and batch production (sauces, bread baked in-house).
- FIFO or lot costing, batch-level expiry tracking beyond an optional expiry date per receipt line.
- Multi-property central store and inter-property transfers (fits the portfolio domain later).
- Automatic purchase orders sent without a human approving them.
- Payments to suppliers through NoLSAF. NRMS records hotel money, it never collects or disburses it.
- Housekeeping and guest amenities (soap, toilet paper, linen) stock. Same engine can take them later as a category; v1 is food and beverage.
- Accounting software export beyond CSV.

## 13. Build milestones (dependency order, each independently shippable)

1. **Foundation: items, locations, movements, recipes.** Stock items with units and packs, locations (store optional, one per outlet), movement ledger with cached balances, opening balances, recipe editor, sale consumption and cancel reversal wired into staff orders, QR orders and walk-ins, derived availability, legacy conversion helper, STOREKEEPER role. *Owner sees: accurate live stock by location.*
2. **Suppliers, receiving, transfers, wastage.** Supplier directory, price list, direct (market) purchase GRN and GRN with photo evidence, weighed receiving, rejections, price-jump flags, weighted average cost, two-step transfers, wastage, staff meals, complimentary. *Owner sees: what came in, at what price, and where it went.*
3. **Counts and variance (the killer feature).** Blind counts, partial counts, cut-off handling, offline count sheet, recount, approval posting adjustments, variance report with qty/cost/selling value, "sold X, stock fell by Y" view, tolerance, shift context, trend, bar handover count. *Owner sees: the Kilimanjaro sentence.*
4. **Purchase orders.** Requisitions, reorder list from par levels, PO with approval thresholds, PDF and WhatsApp/SMS/email share, receiving against PO, partial deliveries, over-delivery tolerance, separation of duties.
5. **Payables and the ledger.** Supplier invoices, payments, statement and ageing, night-audit postings (inventory, COGS, wastage, variance, AP), gross profit on the finance page, stock valuation.
6. **Insight and automation.** GP by menu item, purchase price watch, supplier performance, dead stock, owner digest, breakfast consumption.

### 13.1 Milestone 1 as built (2026-09-24)

- Schema: `NrmsStockItem`, `NrmsStockPackUnit`, `NrmsStockLocation` (OUTLET kind only in use; STORE reserved), `NrmsStockBalance`, `NrmsStockMovement`, `NrmsMenuRecipeLine`, plus `NrmsMenuItem.stockAutoOut`.
- Logic: `apps/api/src/lib/nrmsInventory.ts` (tests in `nrmsInventory.test.ts`). Wired into staff order create and cancel (`nrms.operations.ts`) and guest QR order create (`public.nrmsMenu.ts`), inside the existing order transactions.
- API: `apps/api/src/routes/nrms.stock.ts` at `/api/nrms/stock` (overview, items, packs, levels, receipts and opening counts, receipt reversal, movement history, recipes, legacy conversion).
- Roles: `STOREKEEPER` added; capabilities `stock.read`, `stock.receive`, `stock.catalog.manage`.
- Web: Stock page gains a "Goods on hand" view beside the unchanged "Menu availability" board (linked items show "From stock"); new page `/owner/nrms/stock/items` (Stock items, Recipes with cost and margin, Move menu counters).

Implementation decisions taken while building (flag if you disagree):

1. **PARTIAL goods may go below zero on a sale; WHOLE goods never do.** Refusing a guest's tot because an opening count was 20 ml off would stop service over rounding. The negative balance shows red ("Below zero, count needed") and the milestone 3 count corrects it. Only WHOLE ingredients switch a menu item off automatically.
2. **Milestone 1 includes a plain "Record a delivery" (quantity, pack, total paid, note) with no supplier record.** Without it stock could only go down until milestone 2. Milestone 2 turns this into the full goods-received note with supplier, weights, rejections and receipt photo.
3. **A mistaken receipt can be reversed by owner/manager with a reason,** as a new `RECEIPT_REVERSAL` row, never an edit. A WHOLE item cannot be reversed below zero (the goods were already sold, so the receipt was real).
4. **The store location and transfers move to milestone 2.** In milestone 1 every outlet is its own location and deliveries go straight to it.
5. **The system only switches back on what it switched off itself** (`stockAutoOut`). A person's manual "86" is never overridden by a delivery.

### 13.2 Milestone 2 as built (2026-09-25)

- Migration `20260925090000_add_nrms_stock_purchasing` (PREPARED, NOT APPLIED; needs the milestone 1 migration first): `NrmsStockSettings`, `NrmsSupplier`, `NrmsSupplierPrice`, `NrmsGoodsReceipt` + lines, `NrmsStockTransfer` + lines, `NrmsStockWriteOff`.
- API: `apps/api/src/routes/nrms.stock.operations.ts` (settings, suppliers + price list, goods received notes with approve/reject/void, transfers send/receive/cancel, write-offs with approve/reject, attention counts); location scoping in `apps/api/src/lib/nrmsStockScope.ts`. The catalogue API now keys everything on stock locations (outlets plus the optional main store).
- Capabilities: `stock.supplier.manage`, `stock.transfer.send`, `stock.transfer.receive`, `stock.writeoff.record`, `stock.adjustment.approve`. Upload folder `nrms-stock` for delivery-note and wastage photos.
- Web: new page `/owner/nrms/stock/operations` (Deliveries, Transfers, Write-offs, Suppliers, Approvals, Settings) under the Stock sidebar group; Goods on hand rows gain Write off, and deliveries go through the goods received note.

Build-time decisions:

1. **The plain milestone 1 "Record a delivery" is now owner/manager only**, for corrections. Everyone else records a goods received note, so the delivery limit and supplier trail cannot be bypassed.
2. **Settings are owner only** (not manager), so nobody sets their own approval limits.
3. **A storekeeper may add a supplier** (a new market vendor at the door) but only owner/manager can edit or retire one.
4. **Transfer shortfalls are not a separate movement.** The sender's shelf drops by what was sent, the receiver's rises by what arrived; the gap stays on the transfer line as lost in transit and will feed the milestone 3 variance report.
5. **Separation of duties warns, never blocks** (decision D6): approving your own delivery or receiving your own transfer succeeds and is shown.
6. **A goods received note's stock rows can only be undone by voiding the whole receipt**, never one movement at a time.

### 13.3 Milestone 3 as built (2026-09-25)

- Migration `20260926090000_add_nrms_stock_counts` (PREPARED, NOT APPLIED; needs the milestone 2 migration first): `NrmsStockCount`, `NrmsStockCountLine`, and `varianceTolerances` / `handoverCountItems` JSON on `NrmsStockSettings`.
- Logic: `apps/api/src/lib/nrmsStockCount.ts` (tolerance, variance, expected-at-a-moment, period breakdown, menu selling price per unit); `adjustStock` in `nrmsInventory.ts` posts `COUNT_ADJUSTMENT`.
- API: `apps/api/src/routes/nrms.stock.counts.ts` (start, sheet, save lines, submit, recount, approve, cancel, per-count report, period variance, count settings). New capability `stock.count` (everyone who works a location).
- Web: `/owner/nrms/stock/counts` (counts list, period variance with CSV export, count settings), `/owner/nrms/stock/counts/[countId]` (phone count sheet with offline queue, manager review), `/owner/nrms/stock/counts/[countId]/report` (per-good breakdown, "sold X, stock fell by Y", 8-count trend, staff on duty, short transfers, CSV).

Build-time decisions:

1. **Expected is taken per line at the moment it was counted**, not at count start, so sales during a long count are never read as losses. The device's own counting time is kept when an offline phone replays later (bounded to the count's life).
2. **One open count per location** so two people never count the same shelf into two books.
3. **Only a manager may run an open (non-blind) count**; everyone else always counts blind.
4. **Approving needs a note when any line is outside normal loss.** A tolerance never forgives a whole missing bottle when only a few were expected (the allowance rounds down for whole goods).
5. **Selling value** comes only from menu items that sell the good alone (a beer, a tot), never split out of a cocktail's price; goods with no such item show cost only.
6. **Recount clears the line** and it is counted blind again.
7. **The bar handover count** exists as a count type with the owner's short list per location; wiring it into the shift handover screen itself is left for a follow-up so the cash handover flow is not disturbed.
8. **Reports export as CSV** from the browser; the recorded PDF export used by other NRMS reports is a follow-up.

### 13.4 Milestone 4 as built (2026-09-25)

- Migration `20260927090000_add_nrms_purchase_orders` (PREPARED, NOT APPLIED; needs the milestone 3 migration first): `NrmsStockRequisition` + lines, `NrmsPurchaseOrder` + lines, `purchaseOrderId` / `purchaseOrderLineId` on the goods received note tables, `purchaseOrderLimit` (default TZS 500,000) and `overDeliveryPercent` (default 5) on `NrmsStockSettings`.
- Logic: `apps/api/src/lib/nrmsPurchasing.ts` (reorder suggestion in whole packs, who waits for the owner, over-delivery ceiling, order and request status) and `apps/api/src/lib/nrmsPurchaseOrderDocument.ts` (PDF, supplier link, public view); PDF drawn by `generateNrmsPurchaseOrderPdf` in `pdfDocuments.ts`.
- API: `apps/api/src/routes/nrms.stock.purchasing.ts` (reorder list, purchasing summary, requisitions, purchase orders: create, edit draft, submit, approve, return, send, PDF, cancel, close short). Goods received notes (`nrms.stock.operations.ts`) accept `purchaseOrderId` and fill the order line by line; a void takes the quantities back off. Public no-login link: `apps/api/src/routes/public.nrmsSupplierOrder.ts` at `/api/public/nrms/supplier-orders/:token` (view, PDF, confirm with delivery date).
- Capabilities: `stock.requisition` (everyone who works a shelf) and `stock.purchase.manage` (owner, manager).
- Web: `/owner/nrms/stock/purchasing` (Reorder list, Requests, Orders; staff see "Deliveries due"), `/owner/nrms/stock/purchasing/[orderId]` (order sheet: approve, send, receive, cancel, close short), public `/nrms/supplier-order/[token]` (allowed past login in `middleware.ts`). Store operations Settings gains the order limit and the over-delivery allowance; a delivery's order number shows on Deliveries.

Build-time decisions:

1. **Submitting is approving when allowed.** The owner's orders and a manager's orders up to the limit are approved on submit; a manager's order above it waits for the owner, who approves or returns it to draft with a note. Only a draft can be edited.
2. **Every order line needs an expected price before approval**, because the delivery is checked against it (price flag `ABOVE_ORDER`).
3. **Against an order, only the goods off the order and any excess count against the delivery limit.** The order itself was already approved. Excess beyond the owner's allowance (rounded down for whole goods, pending deliveries included) waits for a manager.
4. **A delivery against an order must go to the order's location and comes from the order's supplier.** Change the location on the draft if the goods should go elsewhere.
5. **Cancel before anything arrives; close short after.** Cancelling gives any linked requests back to the shelf; neither is allowed while a delivery on the order waits for approval.
6. **The reorder list suggests par minus stock minus what is already on order, in the pack last delivered.** At the reorder point with no par set it still suggests one pack. Staff see quantities only; suppliers and prices are for owner and manager.
7. **Several suppliers in one reorder selection become one draft per supplier and shelf**; one supplier opens the editor directly.
8. **The supplier link is a bearer token issued on first send and reused on later sends**, like the Pro Forma link. It shows the order, the PDF and a confirm step with a delivery date (repeatable to move the date); never who raised or approved the order. It changes no quantity or price.
9. **Separation of duties (D6) is shown, not enforced:** a delivery received alone by the person who approved someone else's order is marked on the order sheet.
10. **D7 as recommended:** WhatsApp (`wa.me` with the supplier's number in international form), SMS and email open on the user's own device with the message and link; sending through the property's Meta connection stays a later polish.

### 13.5 Milestone 5 as built (2026-09-25)

- Migration `20260928090000_add_nrms_supplier_payables` (PREPARED, NOT APPLIED; needs the milestone 4 migration first): `NrmsSupplierInvoice`, `NrmsSupplierPayment`, `NrmsGoodsReceipt.supplierInvoiceId`, `NrmsStockMovement.ledgerRunId`.
- Logic: `apps/api/src/lib/nrmsPayables.ts` (due dates from terms, oldest-first ageing, invoice check, statement running balance) and `apps/api/src/lib/nrmsStockLedger.ts` (stock postings for Night Audit). Statement PDF: `generateNrmsSupplierStatementPdf` in `pdfDocuments.ts`.
- API: `apps/api/src/routes/nrms.stock.payables.ts` (payables and ageing per supplier, statement page and PDF, invoices with void, payments with void). Night Audit close in `owner.nrms.finance.ts` now posts supplier payments and stock; the finance overview returns stock on hand at average cost.
- Capability: `stock.payables.manage` (owner, manager).
- Web: `/owner/nrms/stock/payables` (What you owe with ageing, Invoices, Payments) and `/owner/nrms/stock/payables/[supplierId]` (statement with running balance and PDF, open deliveries by due date, invoices, payments). Finance > Accounting ledger gains Food and beverage gross profit and stock on the shelves.

Accounts used (all free before this milestone): 1200 Inventory, food and beverage; 3900 Opening stock and corrections (equity); 5010 Cost of sales, beverage; 5020 Cost of sales, food; 5030 Stock wastage; 5040 Staff meals; 5050 Complimentary; 5060 Stock variance. 2400 Accounts payable and the tender accounts are the existing ones.

Build-time decisions:

1. **The debt is what was accepted at the door, not the invoice.** An invoice above the accepted value is saved and flagged "billed more than received" (decision taken 2026-09-25: flag, never block). Paying more than is owed is allowed and shows as credit held by the supplier.
2. **Payments clear the oldest debt first.** Due date is the invoice's due date when the delivery is invoiced, otherwise delivery day plus the supplier's credit days.
3. **Each stock movement posts exactly once.** Night Audit stamps every movement it posts with its run (`ledgerRunId`), so overlapping audit windows can never post a movement twice or skip one. Movements that existed before this milestone post with the first Night Audit after it is deployed.
4. **Deliveries post one ledger line each at the delivery's own total** (stock against the till, mobile money or bank if paid, against 2400 if on credit), so the payable matches the supplier statement to the shilling. A void posts the reverse.
5. **Sales, wastage, staff meals, complimentary and count results post as one combined line per Night Audit**, each account on the side its net amount falls, so a busy bar does not add hundreds of ledger rows a day.
6. **Opening counts and the owner's plain "record a delivery" corrections post against 3900 Opening stock and corrections**, not against cost or cash, because no purchase is known for them.
7. **Transfers post nothing**; goods in transit stay in 1200. Goods lost in transit post to 5060 when the transfer is received.
8. **VAT (D9):** captured on every invoice and shown; stock cost stays VAT-inclusive for now. Splitting input VAT out of cost for VAT-registered properties is a follow-up that needs the property's VAT status.
9. **A payment follows the expense rules:** dated on an open business date, voidable only while that date is open.
10. **Expenses accrued on the Expenses tab also post to 2400**; the supplier statements cover goods only, so 2400 in the ledger can exceed the sum of statements by those accrued expenses.

### 13.6 Milestone 6 as built (2026-09-25)

- Migration `20260929090000_add_nrms_stock_insights` (PREPARED, NOT APPLIED; needs the milestone 5 migration first): `digestFrequency`, `digestLastSentAt`, `deadStockDays`, `breakfastRecipe`, `breakfastLocationId` on `NrmsStockSettings`.
- Logic: `apps/api/src/lib/nrmsStockInsights.ts` (recipe cost and margin, price movement, dead stock, breakfast usage, digest timing and fixed wording), `nrmsStockDigest.ts` (digest facts), `nrmsStockQueries.ts` (reorder list and supplier balances, moved out of the purchasing and payables routes so the digest can reuse them). New movement type `BREAKFAST_SERVICE`, posted to cost of sales at Night Audit.
- API: `apps/api/src/routes/nrms.stock.insights.ts` (menu profit, price watch, supplier performance, wastage, dead stock, valuation, digest, digest settings, breakfast recipe and posting). Worker `apps/api/src/workers/nrmsStockDigest.ts` (hourly; posts the digest to the owner's notifications after 07:00 EAT when switched on).
- Capability: `stock.insights.read` (owner, manager).
- Web: `/owner/nrms/stock/insights` (Digest, Menu profit, Price watch, Suppliers, Wastage, Dead stock, Valuation); Store operations gains a Breakfast tab.

Build-time decisions:

1. **Menu profit uses today's average cost** for every ingredient, so it answers "is this price still right", not "what did it cost last month". Sales in the range are order lines, cancelled and voided orders left out. The target margin is chosen on the page (default 60%).
2. **Price watch is per supplier and good**, from what was actually paid on each delivery: the latest price against the one before it, against the start of the range, and against the agreed price.
3. **Supplier punctuality counts the first delivery on each order** against the date the supplier confirmed on the order link, else the date asked for. Short on the scale is the paper weight above what was accepted plus rejected.
4. **A count is not movement** for dead stock: a counted bottle is still an unsold bottle.
5. **The digest goes to the owner's in-app notifications**, off by default, daily or weekly after 07:00 EAT, in fixed wording only. SMS and WhatsApp delivery (section 7.6) waits for approved message templates; a digest card on the NRMS home page is left for later.
6. **Breakfast posts once per morning** from covers served (defaulting to the breakfast list's entitled covers) times a per-cover recipe the owner or manager sets; whole goods round up. Anyone who records write-offs may post it for their own shelves. A wrong morning is corrected by the next count, not by reposting.

Milestones 1 to 3 are the product. Milestone 3 is the sales pitch. Milestones 4 to 6 turn it from a control into a way of running the kitchen and bar.

Each milestone ships with its own migration (prepared, reviewed, applied only with Daniel's approval), tests in the house style (the stock race guard, cost averaging, variance arithmetic and tenant isolation are the must-test pieces), and no change to existing order, folio, shift or audit behaviour for properties that have not switched the feature on.

## 14. Security and integrity posture

- Append-only movements; balances derived. No endpoint sets a balance directly.
- Every approval (PO, direct purchase above threshold, wastage above threshold, count) records approver identity and is refused for the same user who raised it above the threshold.
- Receipt photos are evidence: stored in a property-scoped Cloudinary folder, not deletable by the uploader after submission.
- Tenant isolation: every query scoped by property, covered in `nrmsTenantIsolation.test.ts`.
- Reports and exports recorded and fail closed, same as existing report print controls.
- Impersonated sessions (`imp: true`) cannot approve, pay or post adjustments.

## 15. Open decisions for Daniel

- **D1. When a sale consumes stock.** At order creation (today's behaviour for tracked menu items, cancel restores) or at serve/settle. Recommendation: **keep order creation**, so availability stays honest on the QR menu and the concurrency guard stays where it is; cancellations restore, voids do not.
- **D2. Main store required or optional.** Recommendation: **optional**, single-location mode by default for guest houses, store switched on by properties that have a store room.
- **D3. Blind counts.** Recommendation: **blind by default**, owner can turn it off per property, and the report shows whether a count was blind.
- **D4. Bar handover count.** Recommendation: **optional per outlet**, short list of high-value items chosen by the manager, off by default.
- **D5. PO and direct-purchase approval thresholds.** Recommendation: owner sets two amounts (manager approval limit, direct-purchase limit without approval); defaults TZS 500,000 and TZS 200,000.
- **D6. Separation of duties strictness.** Recommendation: warn (not block) when the approver is also the receiver, and show it in the report, because many small properties have only two people.
- **D7. How POs reach suppliers.** Recommendation: **PDF plus WhatsApp/SMS/email share link in v1**; sending through the property's Meta messaging connection is a later polish.
- **D8. Block `SUPPLIES` expenses for food and drink?** Recommendation: **hint, not block**, in v1; revisit after the pilot.
- **D9. VAT on purchases.** For VAT-registered properties, store cost net of VAT and capture input VAT separately; for everyone else, cost is gross. Recommendation: capture VAT amount on the invoice from day one, use net cost only when the property's fiscal/VAT status says so.
- **D10. Who may edit recipes.** Owner/manager only, or also the outlet supervisor for their own outlet. Recommendation: **owner/manager only**, because recipe quantities directly change the variance (a generous recipe hides theft).
- **D11. Currency.** Recommendation: **TZS only in v1**. Some wine suppliers quote in USD; the receiver converts at entry and records the rate in the note.

## 16. Competitive references

- eZee Absolute plus eZee Optimus (POS and inventory sold separately, per-outlet licences).
- Cloudbeds and Mews: no native purchasing; rely on MarketMan, Apicbase, Supy through the marketplace, priced for chains.
- Local reality: exercise books, Excel, and the owner's phone calls to suppliers. The competition is paper.
