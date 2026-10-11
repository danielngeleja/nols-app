# Managed app download promotions

The admin page at `/admin/management/app-distribution` owns website promotions for the NoLSAF mobile apps. Settings are stored in `app_distribution_settings` and exposed to the website through `GET /api/public/app-distribution`. The endpoint returns only effective, enabled links. Settings default to off.

## Publish a listing

1. Wait until the Google Play or Apple App Store listing is available to its intended audience. A review or test-track URL should not be promoted to the public site unless that audience can actually open it.
2. Enter the exact official listing URL. Android must point to `com.nolsaf.app` on `play.google.com`; iOS must point to the app's numeric ID on `apps.apple.com`.
3. Enable that platform, choose homepage and/or desktop footer placement, edit the headline and description, then enable the overall promotion switch and save.
4. Verify the public homepage at `/public`, the desktop footer, the effective public API response, and (for iOS) the homepage `apple-itunes-app` metadata.

Turning the overall switch off hides website download buttons and the iOS Smart App Banner. It does **not** remove Android Digital Asset Links, Apple App Site Association, installed app links, Universal Links, or passkey domain association. Those protocol files are deployment configuration, not marketing controls.

## App links and passkeys

- Android association: `/.well-known/assetlinks.json`. The package is `com.nolsaf.app`; the signing fingerprints come from Play Console. The Android app must also declare matching link paths and passkey asset statements in its installed build.
- Apple association: `/.well-known/apple-app-site-association`. Vercel needs `APPLE_TEAM_ID` and `APPLE_PASSKEY_BUNDLE_IDS` for this route to return a valid statement. The iOS app must carry matching Associated Domains entitlements.
- App route paths are declared in the native app (`apps/mobile/app.json` and navigation linking). Changing those paths or signing certificates is an app release and deployment task, not a website promotion edit.

The distribution page links to both association documents so an admin can inspect their published state. An iOS store button can be promoted only after the real App Store URL is known; an iOS Universal Link also requires the association document and a signed iOS build.

## Release sequence

This change adds a Prisma table. Follow `docs/ENGINEERING_DELIVERY_POLICY.md`: apply and verify the migration on staging before staging API/web deployment; qualify the exact staging commit on a restored production snapshot clone before production approval and release. Do not turn on promotions until the listing URLs are verified.
