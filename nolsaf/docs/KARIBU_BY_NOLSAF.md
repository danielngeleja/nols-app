# Karibu NoLSAF

Status: first-stay pilot foundation implemented on `codex/karibu-pilot`; rollout remains off by default. Updated 2026-10-09.

### Implementation note

The current build gives admins editable default limits (20% of provisional contribution, 4,000 TZS floor, 3,000 TZS gift cap, 60,000 TZS per-property monthly cap, 300,000 TZS overall monthly cap and 10% deterministic holdout). An admin must enable the program, record a participating NRMS property's agreement and approve nonalcoholic menu items at agreed prices. After a paid account-linked first stay is checked in, an admin can check eligibility, ask for the guest's drink choice and issue a distinct NRMS order. The outlet marks it served; the guest folio is untouched, a NoLSAF payable is recorded, and an admin records the external repayment reference. A cancelled unserved order releases stock and can be replaced. Owners and managers can see served payables.

This is an **operated pilot foundation**, not the full journey below. A private Karibu NoLSAF page now shows account-linked completed-stay milestones and welcomes that were actually issued, and asks the guest once after service whether the welcome arrived and how it was. Pre-arrival choice messaging, automatic offer creation, actual payment initiation, post-checkout contribution reconciliation, a funded refund-risk reserve and 90/180-day experiment reporting still need to be built before an eight-week measured pilot. The displayed refundable-stay exposure currently covers only the latest 200 served gestures. The admin must verify any direct booking costs that the data cannot attribute automatically and enter them before issuing a gift. The holdout rule is deterministic, but changing its percentage during a study would change the cohort threshold; freeze it for a measured run.

Karibu ("welcome" in Swahili) is NoLSAF's way of keeping travellers: NoLSAF is present at the moments that matter during a stay, with a small, personal gesture. A paid booking creates a provisional gesture budget; its final cost is measured against the contribution NoLSAF actually earns after the stay.

The promise to the traveller is not "earn rewards". It is:

> **When you arrive somewhere through NoLSAF, someone is expecting you.**

---

## 1. Why this works for NoLSAF

NRMS gives NoLSAF a practical way to coordinate a welcome at the property: menu items, check-in, outlet orders and served status already exist. Karibu still needs its own eligibility, funding, order settlement and property repayment flow. Its advantage will depend on reliable delivery by participating properties; it is not an exclusive capability that other OTAs could never develop.

### Design principles

1. **The guest never asks for it.** A surprise is a gift; a claimed reward is a transaction.
2. **It shows the guest is known.** Their name, their birthday, their usual drink.
3. **It arrives at the right moment.** Arrival, the first evening, the birthday. Not an email a week later.
4. **It is served by people.** Hotel staff are the warm face of NoLSAF; the card says it comes from the NoLSAF family.
5. **It costs little but means a lot.** A glass of juice or wine against a stay's commission.
6. **It is light and simple.** Only gifts the property already serves, perks it can grant, or NoLSAF's own digital gifts. Nothing that NoLSAF has to prepare, carry or deliver itself.

### The food-safety rule

> **Anything edible or drinkable is prepared and served by the property itself, from its own menu. NoLSAF never brings food or drinks in from outside.**

---

## 2. The gift catalogue

Every Karibu gesture comes from one of these four groups.

### 2.1 Light gifts the property serves

Only at NRMS properties with a bar, restaurant or kitchen. Prepared by the property, from items it already sells.

| Gift | Notes |
|---|---|
| Welcome drink: juice, soda, coffee, tea | Non-alcoholic is the default |
| Glass of wine or a beer | Only for adults who explicitly choose it where the property permits it |
| Mocktail or the house's fresh juice | Feels special for the same small cost |
| Coffee with a small item from the menu (for example mandazi or cookies) | Only items the property already makes and sells |
| Fruit plate | For bigger moments (third stay, one year) |

The current first-stay pilot places a distinct NRMS order, records when staff serve it, and creates a NoLSAF payable without charging the guest's folio. Finance records the reference after paying the property outside NoLSAF; automatic transfer and reconciliation are still pending.

### 2.2 Room perks the property grants

Work at participating properties, with no food involved. Owners opt in and confirm availability for each stay; an empty room or late checkout can still have an opportunity or staffing cost. A badge is a later option after delivery is proven.

| Perk | Notes |
|---|---|
| Late checkout (for example until 14:00) | Offered only when the room is not needed that day |
| Early check-in | Offered only when the room is ready |
| Room choice (quiet side, higher floor, a view) | A note to the front desk |
| Upgrade if available | Only when a better room is empty that night |

### 2.3 NoLSAF's own gifts (future phase)

Work everywhere, including guest houses and private apartments, because nothing physical has to be prepared.

| Gift | Notes |
|---|---|
| **Karibu credit** toward the next NoLSAF stay | Future phase: credit only, never cash; proposed 12-month expiry and redemption rules need review |
| Free or discounted Get There ride | Only when the transport rules pass (section 5) |
| Longer free-cancellation window on the next booking | Future phase only if the property's policy and NoLSAF's refund exposure permit it |
| Priority support | Future phase; requires support capacity and has a real operating cost |
| Early access to deals | New properties and seasonal prices before others |

### 2.4 Recognition

Free, and often the most powerful.

| Gesture | How |
|---|---|
| Greeted by name as a NoLSAF guest | Proposed staff prompt: "NoLSAF guest · 3rd stay · prefers juice"; cross-property preferences require consent |
| A personal message at the right moment | "Karibu Neema, Jamirex is expecting you" before arrival; "Thank you for staying with the NoLSAF family" after |
| Milestone badge in the app | 3rd stay, one year with NoLSAF; shown only once reached, never as a countdown (section 14.1) |

### 2.5 Which group applies at which property

| Property | What the guest can receive |
|---|---|
| NRMS property with a bar, restaurant or kitchen | Pilot: 2.1 + personal messages; later: 2.2, 2.3 and wider 2.4 |
| NRMS property without food or drink service | Pilot: personal messages; later: opted-in room perks and Karibu credit |
| Property on NoLSAF but not on NRMS | Pilot: personal messages; later: Karibu credit if its checkout and accounting rules are built |

Every guest can be recognised, but a physical gift or credit is not guaranteed at every property. The pilot does not promise Karibu credit.

---

## 3. The money rule: spend from booking contribution

Gestures are never priced from the booking value or a headline percentage. Use the booking's recorded commission and subtract costs attributable to earning it.

> **Eligible contribution (R) = max(0, recorded NoLSAF accommodation commission − payment fees absorbed by NoLSAF − attributed sales/referral payouts − partner bonuses − other direct variable booking costs).**

The gateway percentages in code are configurable estimates until checked against actual settings and settlement statements. Do not assume a 10% commission rate means 10% of the guest price: for an owner-price markup, the recorded commission is `guest accommodation price − owner payout`. Example, a 200,000 TZS accommodation price, a 10% markup on the owner price, and an estimated 2.5% mobile-money fee, with no other attributed costs:

| | TZS |
|---|---|
| Booking value | 200,000 |
| Owner payout (200,000 ÷ 1.10) | 181,818.18 |
| Recorded NoLSAF commission | 18,181.82 |
| Payment fee (2.5% of 200,000) | −5,000 |
| Other attributed variable costs (assumed zero in this illustration) | 0 |
| **Eligible contribution (R)** | **13,181.82** |

For a real booking, use its stored invoice commission amount and actual absorbed payment fee, including the correct accommodation and transport split. Before arrival, a paid and confirmed booking has only a **provisional R**. A modest gift can be authorised against that estimate and a separate pilot risk reserve. Final R and the pool contribution are settled only after checkout and payment reconciliation. If a stay is later refunded, reverse its pool contribution; a gift already served remains a real Karibu cost and must be covered by the risk reserve, never charged to the guest.

### Three funding sources

| Source | What it is | Pays for |
|---|---|---|
| **This stay's provisional budget** | A capped share of estimated R from a paid booking, finalised after checkout | A welcome served during this stay |
| **The guest's relationship pool** | An internal reserve from final R of earlier completed stays | Later milestones, only when this stay's own budget is not enough |
| **Service recovery budget** | A fixed monthly amount, not tied to commission | "Something went wrong"; the cost of a mistake, not a reward |

### Starting levers (to be confirmed, see section 10)

| Lever | Proposal |
|---|---|
| Per-stay gesture budget | Pilot hypothesis: up to 20% of provisional R, subject to a fixed TZS cap and the risk reserve; validate against real margins |
| Relationship pool contribution | Future phase hypothesis: 5% of final R from each completed stay |
| Floor | No served gesture if provisional R is under 4,000 TZS; a warm message only |
| Stay cap | Future phase: hospitality plus ride cost at most 35% of this stay's R **and** the remaining lifetime allowance |
| Lifetime ceiling | Future phase: loyalty gestures at most 25% of the guest's historical final R plus this stay's provisional R, less prior Karibu spending; recalculate after checkout; service recovery is separate |
| Price paid to the property | Agreed partner price, checked against menu price and recipe cost where the item is costed; do not infer all item costs from stock data |
| Unused per-stay budget | Returns to NoLSAF; it does not carry over |

The proposed 20%, 5%, 35% and 25% are planning limits, not evidence that every booking is profitable. Validate them on actual booking-level contribution before launch. A private relationship pool is an internal budget; if Karibu credit or a specified future gift is promised to guests, finance must assess the resulting obligation and settlement treatment.

### Order within the stay cap

1. The ride, if requested and eligible (section 5); it must fit both its own 30% limit and the guest's remaining lifetime allowance.
2. The personal moment (birthday, third stay, one year), using what is left plus the guest's prior pool **only as a top-up**.
3. The welcome drink, only if there is still room.

At most two loyalty gestures with a cost per stay: one ride plus one hospitality gesture. Apply the **smaller** of the remaining stay cap and remaining lifetime allowance to each offer. If two hospitality moments fall on the same stay, give the bigger one and mention both on the card. Room perks require the property's confirmation and may have a cost to it. Service recovery is a separate response to a problem, not a loyalty gesture.

---

## 4. The moments

⭐ marks the pilot moments.

### 4.1 Arrival

| Moment | Trigger | Data exists today? | Budget | Gesture |
|---|---|---|---|---|
| ⭐ First ever NoLSAF stay | First verified check-in on an account-linked, paid NoLSAF booking | Yes for linked bookings | Up to 20% of provisional R and the fixed pilot cap | Guest's choice of eligible welcome drink at participating NRMS properties; personal message elsewhere |
| First stay at this property (returning NoLSAF guest) | First check-in at this property | Yes for linked bookings | 15% of R | Coffee, tea or juice; early check-in where offered |
| Long journey in | NoLSAF airport or bus transfer completed | Yes | 10% of R | Cold water or juice on arrival |

### 4.2 Personal

| Moment | Trigger | Data exists today? | Budget | Gesture |
|---|---|---|---|---|
| Birthday during the stay | Consenting staying guest's verified birthday falls within the stay dates | Partly: account DOB may belong to the booker, not the staying guest | 20% of R + prior pool if needed | Personal birthday message; where the property participates, a chosen drink or confirmed room perk; Karibu credit only in a later phase |
| Anniversary or honeymoon | Guest marks "special occasion" when booking | No (new optional field) | 20% of R + pool | Two drinks of their choice, or an upgrade if available |
| Their usual | Past orders across NRMS properties, with consent | Partly | 10% of R | "We remember you like your coffee black. It's waiting." |

### 4.3 Loyalty

| Moment | Trigger | Data exists today? | Budget | Gesture |
|---|---|---|---|---|
| Third stay | 3rd completed account-linked stay | Yes for linked bookings | 20% of R + prior pool | Fruit plate or the house mocktail; late checkout where offered |
| 5th and 10th stays | Stay count milestone | Yes | 20% of R + pool | Upgrade if available, plus a drink; on the 10th, a larger Karibu credit |
| One year with NoLSAF | 12 months since the first completed stay | Yes for linked bookings | Prior pool, if milestone funding is live | "One year of travelling together" message; future phase may add Karibu credit |
| Coming back to the same property | 2nd or later stay at the same property | Yes | 10% of R | "Welcome back" by name, with their usual drink |
| Returning after a long absence | 6+ months since the last stay | Yes | 15% of R | "We missed you": a welcome drink |

### 4.4 During and after the stay

| Moment | Trigger | Data exists today? | Budget | Gesture |
|---|---|---|---|---|
| Long stay, 5+ nights | Nights on the booking | Yes | Property-approved perk; possible opportunity cost | Late checkout on the last day, or room choice |
| Group stays | NoLSAF group booking arrives | Yes | 15% of the group's R, with a fixed group cap | Welcome juice for the whole group if the budget covers every serving |
| Tour day | A NoLSAF tour starts during the stay | Yes | 10% of R | Early coffee or tea before departure |
| Something went wrong | Issue reported in NRMS or to support | Partly | Recovery budget | "Sorry, this one is on us": a drink, late checkout, or Karibu credit |
| Thank-you after the stay | Checkout completed | Yes | No gift cost; delivery channel still has a cost | "Thank you for staying with the NoLSAF family", plus a review request |

---

## 5. Transport: the ride is on us

Arrival can be the most stressful moment of a trip. In a later phase, eligible guests could request a subsidised Get There pickup ending at their booked stay. Eligibility depends on a real fare quote, route, driver availability and the budget; no ride is promised to everyone.

### Who qualifies (all seven must be true)

| # | Condition | How it is calculated |
|---|---|---|
| 1 | Paid, confirmed NoLSAF booking for an individual | Group stays have their own rule |
| 2 | Provisional eligible contribution R ≥ 60,000 TZS for this stay | Actual booking commission less estimated attributable costs, then reconciled after checkout |
| 3 | Known pickup point and property | A verified Get There pickup point and verified property location |
| 4 | Within 15 km by road | Use the routed road distance for a firm offer; straight-line distance × 1.35 is only a screening estimate |
| 5 | The fare fits the stay | See the fare rule below |
| 6 | A driver can be confirmed for the arrival time | Get There coverage and dispatch confirmation before promising the ride |
| 7 | The guest asked for it | Answered yes with an arrival time, at least 24 hours before |

If any condition fails there is no ride offer; the guest may still qualify for a separate hospitality gesture.

### The fare rule

Use the fare actually quoted by the Get There booking path that will dispatch the ride. The standalone transport policy currently uses the following car estimate, while the combined accommodation-booking path has a different pricing calculation; these must be reconciled before launch:

> **Fare = 5,000 + 1,800 × road km**

| Result | Offer |
|---|---|
| Full fare fits both 30% of R and the remaining 25% lifetime allowance | Free ride |
| Half the fare fits both limits | 50% off |
| Otherwise | No ride offer |
| Pickup and drop-off subsidies together fit both limits and both rides are confirmed | Both may be covered |

### Distance check (approximate)

| Route | Illustrative road km | Within 15 km? | Indicative standalone car fare (TZS) |
|---|---|---|---|
| Zanzibar Airport → Stone Town hotel | about 7 | Yes | about 17,600 |
| JNIA (Dar) → city-centre hotel | about 13.5 | Yes | about 29,300 |
| Ubungo bus terminal → Mikocheni hotel | about 8 | Yes | about 19,400 |
| Kilimanjaro Airport → Arusha hotel | about 54 | No | No ride offer |

### Worked examples (illustrative quotes; stay cap = 35% of R, lifetime cap = 25% of cumulative R)

**A. High-value stay in Dar with a birthday.** R = 195,000; JNIA to the hotel, 13.5 km. Stay cap 68,250. Assuming no prior Karibu spending, the lifetime allowance is 48,750. Fare 29,300 fits both limits: free ride. Birthday drink 5,000 also fits. Total 34,300 (18% of R).

**B. Mid-value stay.** R = 80,000; JNIA to the hotel. Stay cap 28,000; assuming no prior spending, lifetime allowance 20,000. Fare 29,300 is above 30% of R (24,000), so not free; half fare 14,650 fits. The remaining lifetime allowance is 5,350, so a 3,000 welcome drink also fits.

**C. Small stay.** R = 15,000. Below the 60,000 minimum: no ride offer. Welcome drink 3,000 fits.

**D. High value but too far.** R = 195,000; Kilimanjaro Airport to Arusha, 54 km. Fails the 15 km limit: no ride offer. The guest still gets a full hospitality gesture.

### Guest message (two days before arrival, only to guests who pass the preliminary screen)

Before a driver and fare are confirmed: "Neema, your stay may qualify for a NoLSAF pickup. Would you like us to check availability?" Only after a firm quote and dispatch confirmation may the message say "It's on us" or state a 50% price.

### Rules

- Never booked automatically; only when the guest says they need it.
- The ride always ends at the booked stay.
- Tied to a paid, confirmed booking; cancelled with the booking.
- Paid first from the stay cap; must also fit the remaining 25% lifetime allowance. If the booking later loses its contribution, the subsidy is a program risk-reserve cost, not a charge to the guest.
- The driver is paid normally; the cost is booked against that stay's commission.

---

## 6. Respect and consent

- **The guest always chooses when it is a drink.** If they do not answer, the default is **non-alcoholic**. Alcohol is offered only to adults who explicitly opt in for this stay or have an active opt-in preference.
- **Ask permission to celebrate.** Account date of birth may be the booker's rather than the staying guest's. Confirm whose birthday it is before notifying the property; explain why the date is used.
- **"Surprise me on special days"** is off until the guest opts in and can be switched off in one tap.
- **No public announcement without consent.** Staff are told about a birthday; anything more is the guest's choice.
- **Preferences travel only with consent.** "Their usual" across properties needs the guest's permission.
- **No cash value.** Gestures and Karibu credit never turn into money; credit is only spent on NoLSAF stays.

---

## 7. Scenario: Neema's year

Illustrative **later-phase** journey, beyond the narrow welcome pilot. Assume a 10% markup on the owner's accommodation price, payment fees of 2.5% for mobile money and 2.9% for cards, no other attributed variable costs, a 20% welcome budget, a 5% pool contribution from final R, a 4,000 TZS floor, and agreed partner prices. Money is rounded to whole TZS per booking here; real calculations use recorded invoice and settlement amounts. The pool is credited only after a completed, paid stay.

### Stay 1, March: Jamirex Hotel, Dar, 2 nights, mobile money

| | TZS |
|---|---|
| Booking | 200,000 |
| Recorded commission (200,000 − 200,000 ÷ 1.10) | 18,182 |
| Payment fee | −5,000 |
| **Eligible contribution (R)** | **13,182** |
| Provisional gesture budget (20%) | 2,636 |
| Added to pool after checkout (5%) | 659 → **pool 659** |

**First ever NoLSAF stay.** The day before, Neema is asked "wine, juice or coffee?" She picks passion juice. At check-in it arrives with a card: "Karibu. From your NoLSAF family." Partner price 2,500 (menu 4,000), repaid to Jamirex after it is marked served.

### Stay 2, May: guest house in Dodoma, 1 night, mobile money

| | TZS |
|---|---|
| Booking | 50,000 |
| Recorded commission | 4,545 |
| Payment fee | −1,250 |
| **Eligible contribution (R)** | **3,295** (below the floor) |
| Added to pool after checkout | 165 → **pool 824** |

No served gesture, only a warm message: "Safe travels to Dodoma, Neema." It still builds her pool.

### Stay 3, July: Serengeti lodge, 3 nights, card; her birthday is on day 2

| | TZS |
|---|---|
| Booking | 900,000 |
| Recorded commission | 81,818 |
| Payment fee (2.9%) | −26,100 |
| **Eligible contribution (R)** | **55,718** |
| This stay's provisional budget (20%) | 11,144 |

Third stay and birthday land together: the bigger moment (birthday) is given and both are mentioned, after Neema has opted in. On the morning of her birthday she receives "Happy birthday, Neema", and at dinner the lodge serves her chosen birthday drink with a card: "Happy birthday, and thank you for your 3rd stay with NoLSAF." Partner price 5,000. The lodge also grants late checkout after confirming availability. The stay's budget covers the drink, so the prior pool is untouched. After checkout, 5% of this stay's R (2,786) is added: **pool 3,610**.

### Stay 4, September: booked, then cancelled and refunded

Final contribution 0. No gesture was served and nothing is added to the pool. **Pool stays 3,610.** If a gesture had already been served before a later refund, its cost would remain in the pilot risk reserve.

### Stay 5, November: back at Jamirex, 2 nights, mobile money

| | TZS |
|---|---|
| Booking | 220,000 |
| Recorded commission | 20,000 |
| Payment fee | −5,500 |
| **Eligible contribution (R)** | **14,500** |
| Provisional budget (10%, welcome back) | 1,450 |
| Added to pool after checkout | 725 → **pool 4,335** |

**Coming back to the same property.** Her passion juice is waiting: "Welcome back, Neema. We remembered." Agreed partner price 1,400, within the 1,450 budget. Her room's air conditioning fails; the separate recovery budget pays for a complimentary drink and the hotel adds late checkout if available: "Sorry about tonight." Recovery cost 3,000.

### Next March: one year with NoLSAF

Her 4,335 internal pool could fund a "one year of travelling together" moment. Karibu credit is an option only after its redemption and accounting rules have been designed; the pool itself is not a guest-visible balance or promise.

### The year in numbers

| | TZS |
|---|---|
| Neema's total eligible contribution before Karibu | **86,695** |
| Spent on her loyalty gestures (juice, birthday drink, juice) | 8,900 (**10.3%**) |
| Internally reserved in her pool for a later phase | 4,335 |
| Service recovery | 3,000, separate budget |
| **Unallocated contribution after these items** | **70,460** |

The loyalty gestures plus the unused internal pool represent 15.3% of her illustrative R; service recovery is tracked separately. The 70,460 TZS is **not net profit**: it excludes shared operating costs and any variable costs omitted by this example. Gifts at arrival used provisional budgets; only after checkout could NoLSAF verify that final R covered them.

---

## 8. Proposed pilot flow

### Guest journey

1. Books a paid, account-linked stay at a participating NRMS property. There is no guaranteed gift advertised at booking.
2. NoLSAF checks a provisional budget, a fixed pilot cap, menu availability and the property's agreement before offering a welcome. In the first implementation, staff asks the guest's drink preference after check-in and issues the gift from the admin workspace. A pre-arrival choice message requires a later messaging and consent flow. Alcohol requires a separate adult opt-in design and is outside this pilot.
3. Checks in. Staff serve the confirmed gesture with a card: "Karibu. From your NoLSAF family."
4. NoLSAF records service and asks once, at an appropriate time, whether the welcome was enjoyed.
5. After checkout and payment reconciliation, the final booking contribution and Karibu cost are reviewed.

### Property and staff

1. The current Karibu NoLSAF workflow creates a distinct NRMS order at check-in with NoLSAF as payer; it never posts the amount to the guest's room folio.
2. A planned personalised bar or kitchen ticket would read, for example: "NoLSAF welcome: 1 passion juice for Room 12, Neema M." The current order uses a generic NoLSAF welcome note and the linked NRMS reservation.
3. Staff serve it and mark it served. That is the proof.
4. Once served and reconciled, the property is repaid through a dedicated payable or payout line, without changing the agreed room payout.
5. In later phases, a room perk is shown only after the property confirms it for that stay.

---

## 9. What properties get

- A chance to give the guest a strong first impression. Any effect on bar sales must be measured rather than assumed.
- A possible **"Karibu NoLSAF" badge** after service quality is proven; its effect on booking choice must be tested.
- A fair partner price for every gesture served, and staff recognised in guest feedback.
- A reason to join NRMS if the pilot shows guests value a delivered welcome.

---

## 10. Controls and measurement

### Controls

- During the pilot, a hospitality gesture is released only after a real check-in and within both the provisional percentage budget and fixed TZS cap. In later phases, it must also fit the smaller of the stay allowance and the guest's remaining lifetime allowance. The first-stay welcome is given once per verified guest account.
- The property is repaid only after the gesture is marked served and the agreed price is verified; staff service status is operational evidence, with guest feedback used to detect missed deliveries.
- Monthly budget caps per property and overall; the recovery budget has its own cap.
- A separate pilot risk reserve covers any gesture already served on a stay that is later refunded; the guest is never charged for it.
- A clear record of every gesture: eligible, offered, chosen, released, served, repaid, cancelled or reversed.

### Measurement

- **Hold-out group:** a small random share of first-time guests receive no Karibu during the pilot.
- **Repeat booking rate** at 90 and 180 days after each guest's first eligible stay: Karibu guests against the hold-out. These results mature after the eight-week operating pilot.
- **Time to second booking.**
- **Gesture cost as a share of actual booking contribution**, including refunded-stay losses; track the 25% loyalty ceiling and recovery spending separately.
- **Choice and served rates,** and guest feedback per property.

---

## 11. Priorities

### P0: evidence and decisions needed before the pilot

| # | Decision | Why it matters |
|---|---|---|
| 1 | Actual recorded commission, settlement fees and attributed variable costs for recent completed bookings | Estimate the distribution of R rather than assuming one commission rate |
| 2 | Pilot welcome limit: percentage of provisional R, fixed TZS cap, 4,000 TZS floor and refunded-stay risk reserve | Authorise a small gift at check-in without claiming final profit is already known |
| 3 | Agreed partner prices and recipe-cost coverage for selected drinks | Ensure each pilot item is available and its cost is understood |
| 4 | Three to five trusted NRMS properties with a bar or restaurant and staff training | Test delivery before expanding the catalogue |
| 5 | Guest drink choice and a no-surprise preference; defer alcohol until adult opt-in is designed; approve the guest preference fields and consent defaults in section 14 | Make the welcome appropriate for the person receiving it |
| 7 | Whether a third-stay or one-year reward exists at all | Until it is decided, milestones stay a record of what happened and are never shown as targets |
| 6 | Hold-out design and budget for the eight-week operating pilot | Measure delivery now and repeat booking later |

### P1: foundations

| # | Piece |
|---|---|
| 1 | Provisional and final booking contribution from recorded commission and attributable costs |
| 2 | Gesture record: eligible → offered → chosen → released → served → repaid, with cancellation and refund-loss states |
| 3 | "NoLSAF Karibu" as a distinct payer/settlement path that never charges the guest folio |
| 4 | Agreed-price repayment of served gestures through a dedicated property payable or payout line |
| 5 | Guest drink choice and opt-out preference (section 14.2); idempotency so one check-in cannot create duplicate gifts |
| 6 | Monthly pilot cap, refunded-stay risk reserve and a simple delivery report |

### P2: pilot (8 weeks, 3 to 5 NRMS properties)

| # | Piece |
|---|---|
| 1 | One moment: first verified NoLSAF stay at a participating NRMS property |
| 2 | One gift type: the guest's chosen eligible welcome drink at an agreed partner price, plus a personal greeting |
| 3 | Staff asks the guest's choice only after property and budget checks; no public gift promise |
| 4 | Distinct Karibu order at check-in; staff mark it served and NoLSAF reconciles repayment |
| 5 | Monthly caps, refunded-stay losses, choice rate, served rate and guest feedback |
| 6 | Random hold-out group; evaluate 90- and 180-day repeat bookings when those windows have elapsed |

### P3: phase 2

After the welcome pilot proves delivery and booking-level economics: birthday with staying-guest consent, third stay, first stay at another property, group arrival, welcome back, and opted-in room perks. Add the relationship pool only when milestone funding rules and records are settled. Service recovery remains a separate program. Consider the "Karibu NoLSAF" badge after participating properties meet a delivery standard.

### P4: phase 3 (needs new data and consent design)

Karibu credit requires a checkout redemption ledger and finance review of any promised future benefit. Transport requires one authoritative fare quote, routed distance, driver confirmation and subsidy settlement before a free or half-price ride is promised. Other later moments include cross-property preferences with consent, anniversary or honeymoon, and 5th and 10th stays.

---

## 12. Open questions

- Should the relationship pool remain an internal discretionary budget? (Proposal: yes. Guest-visible Karibu credit would be a separately defined benefit with its own rules.)
- Should properties be able to add their own gesture on top, for extra visibility?
- Should the "Karibu NoLSAF" badge appear at booking? (Proposal: first prove delivery during the pilot, then test a badge.)

## 13. First implementation boundary

The current admin workflow covers an account-linked guest's first checked-in NRMS stay, one approved nonalcoholic drink, an NRMS order paid by NoLSAF, service confirmation by outlet staff, and an admin record of an external property repayment. The pilot is off by default. Finance can change its limits with an audited reason, and each property must separately agree to participate and to its drink prices.

Eligibility is recalculated when the order is issued. The preview uses paid booking commission, estimated gateway fees, recorded referral and sales costs, and any additional booking costs reviewed by the admin. It excludes drinks that are inactive, out of stock, outside approved categories, above the agreed menu price, or above the booking or monthly budget. These values are provisional at check-in; final contribution and refund-loss review remain operational reconciliation work.

Pre-arrival messaging, alcohol, birthday gestures, loyalty credit, automatic bank transfers, and 90/180-day repeat-booking measurement are later phases. Guest preference capture is specified in section 14 and is next in the build order. The guest journey page displays actual issued welcomes and completed-stay milestones; it does not promise a future gift. Recording a repayment reference in the admin workspace does not send funds.

---

## 14. The travel story page and guest preferences

### 14.1 What the guest sees

The guest page lives at `/account/karibu` and is reached from **My Story** in the account dropdown (desktop) and **My story** under Account in the mobile menu. It holds the travel story and the guest's preferences, which the guest manages, so it sits with the other account pages.

| Block | Content | Rule |
|---|---|---|
| Story band | Completed stays, nights, places (distinct cities) | Counted from completed stays only |
| Next stay | "Your next stay" or "Staying now", with property and dates | Links to the booking by its `bk_` reference |
| Welcomes prepared for you | Each welcome actually issued: drink, property, served date; one delivery question after service | Shown only when at least one exists; never an empty "your moments will appear here" promise |
| Where you have stayed | The six latest stays with city, dates and nights; a welcome tag on stays that had one | No amounts, budgets or eligibility shown |
| Milestones | First stay, third stay, one year with NoLSAF | **Shown only once reached**, as a record. No countdown ("2 more stays to go"), no progress bar, no upcoming targets |

**Why no countdown.** A progress bar toward a third stay reads as a promise that something happens when it fills. Karibu is a surprise that is never promised, and the third-stay reward is not decided (P0 decision 7). A countdown is added only if NoLSAF later commits to a real milestone reward and runs it as a stated programme.

### 14.2 Preferences the guest can give

A **"Your preferences"** card on the travel story page. Everything is optional, everything starts off, and one button clears it all.

| Preference | Default | How it is captured | Used for |
|---|---|---|---|
| Celebrate special days | Off | One switch, off in one tap | Allows a birthday gesture (P3); without it the birthday is never used |
| Birthday | Empty | **Day and month only, no year** | A birthday moment during a stay, only while "Celebrate special days" is on. The guest confirms it is their own date, not the booker's (section 6) |
| Drinks I enjoy | None selected | Chips matching the pilot drink categories: Tea and coffee, Fresh juice, Soft drink, Water, Mocktail | Admin sees these first when choosing the welcome drink |
| Adult drinks (wine, beer) | Hidden | Not offered until the alcohol policy is decided; then an adult opt-in with an 18+ confirmation | Later phase only |
| Dietary needs or allergies | None | Chips (No sugar, Lactose-free, Nut allergy, Vegetarian) plus a short note, up to 200 characters | Admin never picks a drink that conflicts; shared with the property only with consent |
| Share with the property I stay at | Off | One switch | Lets staff at the property where the guest is staying see the drinks and dietary needs during that stay |
| Clear my preferences | Not applicable | One button | Deletes every preference immediately |

### 14.3 How preferences are used, and where they never go

- **Admin welcome popup:** liked drinks are listed first and marked; a drink that conflicts with a dietary need is flagged and cannot be chosen; a birthday falling inside the stay is shown only when the guest opted in.
- **Property staff:** see preferences only when the guest switched sharing on, only for the guest's current stay at that property, and only as a short prompt ("NoLSAF guest · prefers juice · nut allergy").
- **Never:** used for marketing, sold or shared with partners, shown to other guests, or used to decide eligibility or budget.
- **Retention:** kept until the guest clears them or deletes their account; each change is time-stamped.

### 14.4 Data and build

- **New table** `karibu_guest_preference`, one row per account: celebrate switch, birthday day and month, liked drinks, dietary tags, dietary note, share switch, updated time. The migration is prepared as a file and applied only with Daniel's approval; its SQL must run on both MySQL 8 (staging) and MariaDB 11.8 (production).
- **Guest API:** read, save and clear the account's own preferences; no other account's data is reachable.
- **Admin API:** the booking preview returns the guest's preferences beside the drink options.
- **Property side (later):** the staff prompt reads preferences only when sharing is on and the reservation is in-house.

### 14.5 What is next, in order

| # | Step | Needs a migration |
|---|---|---|
| 1 | Milestones shown only once reached on the travel story page (built) | No |
| 2 | Prepare the `karibu_guest_preference` migration for review (prepared: `20261010120000_add_karibu_guest_preference`) | Prepared, not applied |
| 3 | Guest "Your preferences" card and its API (built; the card stays hidden until step 2 is applied) | Needs step 2 applied to work |
| 4 | Admin welcome popup uses liked drinks and dietary flags (built; a clashing drink is also refused by the server when the gift is issued). The guest's booking page invites them to add preferences on an upcoming paid stay | Needs step 2 applied to work |
| 5 | Property staff prompt, only with sharing consent | Later phase |
| 6 | Birthday moment for opted-in guests | P3 |

**Decisions before step 3:** the dietary chip list above, and confirming that dietary needs reach a property only with the guest's sharing consent (the admin still avoids a conflicting drink either way).
