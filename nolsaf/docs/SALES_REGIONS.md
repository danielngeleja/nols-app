# Sales regions and regional leads

Approved by Daniel 2026-11-26. A management layer between team leads and NoLSAF, so the sales force can grow beyond what one admin oversees.

## Decisions

| Topic | Decision |
|---|---|
| Regions | Fixed list, managed in admin: Dar es Salaam (DAR), Arusha and Kilimanjaro (ARK), Zanzibar (ZNZ), Mwanza and Lake (LKE), Dodoma and Central (CEN), Mbeya and Southern Highlands (SHL), Coast and South (CST) |
| Lead | One Regional lead per region, an ACTIVE Sales Partner with an earning contract. A region may have no lead; NoLSAF covers it |
| Pay | An override: `overridePercent` of the commission each partner in the region earns, paid to the lead. Set per region (each region has one lead, so it is the lead's rate). Never on the lead's own earnings |
| Approvals | None that move money. The lead may recommend a long-stay request or a partner's first withdrawal; the admin still decides and sees "Recommended by the regional lead" |

## Data (migration `20261126120000_add_sales_regions`, prepared, NOT applied)

- `sales_region`: code, name, `areas` (Tanzanian administrative regions it covers, used to map the old free-text region), status, `leadPartnerId` (unique), `leadSince`, `overridePercent`.
- `sales_region_month`: a region's monthly target (owner-confirmed properties). Without one, the target is the sum of its partners' targets.
- `sales_region_recommendation`: one per subject (`LONG_STAY_REQUEST` or `SALES_PAYOUT`).
- `regionId` added (nullable, no foreign key) to `sales_partner_profile` and `sales_team`. The old free-text `region` is kept.
- The seven regions are inserted by the migration. Existing partners and teams are mapped by **Auto-assign** in admin; unmatched ones stay unassigned until an admin picks.

## Override earnings

- Type `REGIONAL_OVERRIDE`, source key `REGION_OVERRIDE:<base commission id>`, one per base commission.
- Base commissions: revenue-based types earned by a partner of the region (not the lead), on or after `leadSince`. Excluded: inspection fees, bonuses, adjustments, overrides.
- Amount = base `commissionAmount` × `overridePercent`. Contract: the lead's earning contract; none, no override.
- It waits until its base commission is withdrawable, and is reversed (or offset if paid) when the base is reversed. Run by the sales commission worker.

## Regional lead

- Portal page `/sales/region`, menu item only for leads (`/api/sales/team/status` returns `isRegionLead`); every endpoint re-checks.
- Shows: target and progress, teams with their health, partners with points, confirmed homes, owner denials, inspections, open long-stay requests, first withdrawals waiting, earnings this month, and the lead's own override.
- Recommend: `POST /api/sales/region/recommendations` for a waiting long-stay request or first withdrawal of a partner in the region, not their own.

## Alerts

- Team at risk: the region's lead is told too (admins still are).
- Owner says "Not expecting this?" on a region partner's assisted listing: the region's lead is told too.

## Admin

`/admin/sales/regions`: regions with lead, override, partners, teams, target vs achieved; set lead (agent code), override percent (finance code needed), monthly target; auto-assign and assign partners and teams.
