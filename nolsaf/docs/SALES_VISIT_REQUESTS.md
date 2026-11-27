# Owner visit requests and booking stickers

Built 2026-11-26 (approved by Daniel). The "visible agent" layer of the Sales Partner network: owners can ask NoLSAF for a visit, and every approved property can print a "Book this place on NoLSAF" sticker. The partner ID card (`/verify/sales`) already existed and is unchanged.

## Decisions

| Topic | Decision |
|---|---|
| Public partner list | None. Partners are never listed, named or contactable publicly (poaching and impersonation risk). The owner asks NoLSAF; NoLSAF routes. |
| Who assigns | An admin, to any active partner with a current agreement. The region's Regional lead, to an active partner of their own region, never to themself (NoLSAF assigns visits to leads). |
| What assigning does | Creates an ordinary `SalesLead` for the partner, with the owner's contact, a 48 hour follow-up and the normal 60 day claim protection. Same rules as a lead the partner registers: refused if another partner is already working the property, linked to the partner's own lead if they already have it, flagged as a possible duplicate where the matcher says so, and a property already listed on NoLSAF cannot be proposed for the Marketplace. |
| Owner's phone | Seen by admins and by the assigned partner (through the lead). The Regional lead sees name, property, place and interest only. |
| Money | None. A visit request never creates or changes a commission. |

## Owner visit requests

- **Public page:** `/public/request-a-visit` (linked from `/public/nrms`). Name, phone, optional email, property name, type, rooms, region, town or area, interest (bookings, NRMS, both, not sure), message, and consent that NoLSAF and one partner may call.
- **API:** `GET /api/public/visit-requests/regions`, `POST /api/public/visit-requests`. 5 submissions per 15 minutes per IP. A hidden `website` field catches simple bots (they get a normal-looking answer, nothing is saved). A second request from the same phone while one is open (14 days) returns the first number instead of creating another.
- **Reference:** `VR-` plus 8 characters, shown to the owner and used in every URL. No row ids.
- **Alerts:** admins get `sales_visit_request_new` (needs action). The region's lead, when the region has an active one, gets `sales_region_visit_request`. The assigned partner gets `sales_partner_visit_assigned`, linking to the new lead.
- **Admin:** Sales, **Visit requests** (`/admin/sales/visit-requests`, badge = waiting count). Tabs Waiting, Assigned, Closed; filter by region; assign by agent code (optionally choosing the product); close with a reason. API: `GET /api/admin/sales/visit-requests`, `POST …/:ref/assign`, `POST …/:ref/close`. Audited as `SALES_VISIT_REQUEST_ASSIGN` and `SALES_VISIT_REQUEST_CLOSE`.
- **Regional lead:** My region shows "Owners asking for a visit" with a partner picker. API: `GET /api/sales/region/visit-requests`, `POST /api/sales/region/visit-requests/:ref/assign`.

Code: `apps/api/src/lib/salesVisitRequests.ts`, `routes/public.visitRequests.ts`, `routes/admin.sales.visitRequests.ts`, `routes/sales.region.ts`. The lead duplicate scan moved to `lib/salesLeadDuplicates.ts` so partner-registered leads and visit leads flag the same way.

## Booking sticker

- A round 95 mm sticker (printed on A6) in the style NoLSAF used before: white top with the wordmark and "Available via NoLSAF" beside the mark, brand-green bottom with "Book, Pay this property via NoLSAF." (long-stay homes: "Rent, Pay this home via NoLSAF."), the QR in a white disc with the mark at its centre, and nolsaf.com. The QR uses error correction H so the centre mark does not stop it scanning. It opens the property's public page plus `?src=qr&qr=sticker`, so `/admin/channels` counts walk-in bookings as QR.
- Only for APPROVED properties. The link uses the public booking key; no row id, no partner code (partners already earn through property attribution).
- Owner: My properties, QR button on each card, `/owner/properties/[ref]/sticker`. API `GET /api/owner/properties/:id/booking-sticker` (own property only).
- Sales Partner: an attributed property's page, "Booking sticker", `/sales/properties/[ref]/sticker`. API `GET /api/sales/properties/:ref/booking-sticker` (attributed property only).
- Code: `apps/api/src/lib/propertyBookingSticker.ts`, `apps/web/components/BookingStickerSheet.tsx`. No migration.

## Release

Migration `20261126130000_add_sales_visit_requests` (one table, no foreign keys) is prepared, NOT applied. Apply it after `20261126120000_add_sales_regions`, run `prisma generate` with it, and regenerate `migration-checksums.json`. Until then the public form says visit requests are not open yet, the admin page says a database update is needed, and My region hides the section.

## Not yet

- No SMS to the owner. They see the VR number on screen; the partner calls them.
- No reassignment. Once assigned, the request stays with that partner's lead.
- Sticker sales are not separated per partner in reports; they show as QR / sticker in Channels.
