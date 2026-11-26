# Channel attribution

Which marketing channel brought each stay, tour booking and long stay, so NoLSAF can see which channel pays for itself. Built 2026-11-26 (approved by Daniel). Reporting only: it never changes a price, a payment or any partner's commission.

## What already existed

- Google Search Console: verified for the `nolsaf.com` domain (DNS TXT), with `app/sitemap.ts` and `app/robots.ts`.
- Partner links (Agency Desk, `?ag=`): server-verified `BookingChannelAttribution` and `TourBookingAttribution`, with partner commission. Unchanged.

## How it works

1. **Browser** (`apps/web/lib/acquisitionSource.ts`, `components/AcquisitionTracker.tsx`): on the first page of a visit the source is worked out and held in the tab (sessionStorage) only.
   - `?ag=` partner link: PARTNER_LINK (the token is not stored here).
   - `?src=qr`, or landing on `/verify/property|operator|sales|driver`: QR, with the kind of code. Already printed certificates and sales cards count.
   - `gclid`: CAMPAIGN google cpc. `utm_*`: CAMPAIGN, or SOCIAL when `utm_medium` is social. `fbclid`: SOCIAL facebook.
   - Referrer: search engines SEARCH, social sites SOCIAL, other sites REFERRAL, none or our own site DIRECT.
2. **Consent:** saved as the first-party cookie `nolsaf_src` (30 days, SameSite=Lax) only when the visitor allows **Marketing** cookies. Declining drops it and clears any old cookie. First visit wins: the cookie is never replaced while it lasts.
3. **Server** (`apps/api/src/lib/acquisitionSource.ts`): when a stay booking, tour booking or long-stay reservation is created, the cookie is re-validated (channel whitelist, 30-day window, short plain words only, landing path shape without tokens) and stored once in `acquisition_source`. Failures never affect the booking.
4. **Report:** `/admin/channels` (sidebar, under All Revenue), API `GET /api/admin/finance/channels?from&to` (EAT days, finance code required). Per channel: bookings, paid, conversion, money collected, NoLSAF take, partner cost, top sources. A partner link always wins over the cookie. Records with no consent, from the apps, or from before this feature show as "Not recorded".

## Not yet

- Advertising spend is not in NoLSAF, so only partner cost is shown.
- The mobile apps send no source; their bookings show as "Not recorded".
- Add `?src=qr&qr=<kind>` to new printed QR codes and `utm_*` tags to campaign links for sharper figures.

## Release

Migration `20261126110000_add_acquisition_source` (one table, no foreign keys) is prepared, NOT applied. Apply it before deploy and regenerate `migration-checksums.json`. Until then nothing is recorded and the report says so.
