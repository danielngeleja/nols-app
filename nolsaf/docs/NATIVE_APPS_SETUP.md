# Native Apps Setup

Setup notes for the NoLSAF native (Expo) apps: the Driver app and the Partners
(Owner + Operator) app. This doc covers what the apps need from the platform
side (API, web domain, stores) that is not visible inside the app code itself.

---

## Passkeys (Face ID / fingerprint sign-in)

The API already runs a full WebAuthn/FIDO2 stack (`@simplewebauthn/server`) and
the web app has passkey management for customers, owners, drivers and agents.
The native apps reuse the SAME backend and the SAME passkeys. A passkey created
on the web works in the app and vice versa, because all surfaces bind to one
Relying Party ID (the domain).

### How the pieces fit

```
Expo app (iOS/Android)
  └─ react-native-passkeys        platform passkey UI (Face ID / fingerprint)
       ├─ iOS: AuthenticationServices  + Associated Domains entitlement
       └─ Android: Credential Manager  + Digital Asset Links
API (Express, EB)
  └─ @simplewebauthn/server       options + verification (same endpoints as web)
Web (Next.js, Vercel, nolsaf.com)
  ├─ /.well-known/apple-app-site-association   proves the iOS app owns the domain
  └─ /.well-known/assetlinks.json              proves the Android app owns the domain
```

### 1. API environment variables

Set on the API (Elastic Beanstalk) environment:

| Variable | Example | Purpose |
| --- | --- | --- |
| `WEB_AUTHN_RP_ID` | `nolsaf.com` | The domain passkeys are bound to. Must be the registrable domain, not a subdomain, so web + apps share credentials. Falls back to the hostname of `WEB_ORIGIN` when unset. |
| `WEB_AUTHN_NATIVE_ORIGINS` | `android:apk-key-hash:z5aN...31Bw` | Comma-separated extra origins accepted during verification. Android sends `android:apk-key-hash:<base64url-sha256-of-signing-cert>` instead of a URL; add one entry per signing cert per app (debug, upload, and Play App Signing). iOS needs no entry: it sends `https://<rpID>`, which is accepted automatically. |

Production AWS API example:

```env
WEB_ORIGIN=https://nolsaf.com
WEB_AUTHN_RP_ID=nolsaf.com
WEB_AUTHN_NATIVE_ORIGINS=android:apk-key-hash:<real_customer_hash>,android:apk-key-hash:<real_driver_hash>,android:apk-key-hash:<real_partners_hash>
```

Staging AWS API example, when staging web is a subdomain such as
`https://staging.nolsaf.com`:

```env
WEB_ORIGIN=https://staging.nolsaf.com
WEB_AUTHN_RP_ID=nolsaf.com
WEB_AUTHN_NATIVE_ORIGINS=android:apk-key-hash:<real_staging_customer_hash>,android:apk-key-hash:<real_staging_driver_hash>,android:apk-key-hash:<real_staging_partners_hash>
```

Do not paste placeholder values like `<real_customer_hash>` into AWS. Replace
each one with the real base64url Android APK key hash for that app and signing
certificate. If staging is on a non-`nolsaf.com` domain such as a Vercel preview
URL, web passkeys cannot share the production `nolsaf.com` relying party there;
native passkeys can still use `nolsaf.com` once the app/domain association is
configured.

To compute an Android apk-key-hash from a keystore:

```sh
keytool -exportcert -alias <alias> -keystore <keystore> | openssl sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '='
```

Prefix the output with `android:apk-key-hash:`.

The shared config lives in `apps/api/src/lib/webauthnRp.ts`; every passkey
endpoint (account, driver, auth login) reads from it.

### 2. Domain association files (web app, Vercel)

Both files are served by route handlers in the web app and are driven entirely
by env vars on the **web** Vercel project. They return 404 until configured, so
nothing bad is cached while values are missing.

`https://nolsaf.com/.well-known/apple-app-site-association`
(`apps/web/app/.well-known/apple-app-site-association/route.ts`)

| Variable | Example |
| --- | --- |
| `APPLE_TEAM_ID` | `AB12CD34EF` (Apple Developer > Membership) |
| `APPLE_PASSKEY_BUNDLE_IDS` | `com.nolsaf.app,com.nolsaf.driver,com.nolsaf.partners` |

`https://nolsaf.com/.well-known/assetlinks.json`
(`apps/web/app/.well-known/assetlinks.json/route.ts`)

| Variable | Format |
| --- | --- |
| `ANDROID_PASSKEY_APPS` | `<package>=<sha256-fp>\|<sha256-fp>;<package>=...` e.g. `com.nolsaf.app=AA:BB:...:FF\|11:22:...:EE;com.nolsaf.driver=AA:BB:...:FF;com.nolsaf.partners=AA:BB:...:FF` |

Vercel web project example:

```env
APPLE_TEAM_ID=<your_apple_team_id>
APPLE_PASSKEY_BUNDLE_IDS=com.nolsaf.app,com.nolsaf.driver,com.nolsaf.partners
ANDROID_PASSKEY_APPS=com.nolsaf.app=<customer_sha256_fingerprint>;com.nolsaf.driver=<driver_sha256_fingerprint>;com.nolsaf.partners=<partners_sha256_fingerprint>
```

Use Vercel values only for the web app association files. The `WEB_AUTHN_*`
variables belong on AWS API, not Vercel.

Get the SHA-256 cert fingerprints from Play Console > Setup > App signing
(App signing key certificate AND Upload key certificate) plus, for local
release testing, your debug/upload keystore via
`keytool -list -v -keystore <keystore>`.

Gotchas:

- Apple's CDN (`app-site-association.cdn-apple.com`) caches the AASA file for
  hours; after changing it, expect a delay or reinstall the app with the
  alternate mode `?mode=developer` entitlement during development.
- No redirects are allowed when fetching either file; they must be HTTPS 200.
- If the Android fingerprints do not include the Play App Signing key, passkeys
  work in internal builds but fail silently for Play-installed builds.

### 3. Expo app configuration

Add to the app config (`app.json` / `app.config.ts`) of each app:

```jsonc
{
  "expo": {
    "ios": {
      "associatedDomains": ["webcredentials:nolsaf.com"]
    },
  }
}
```

- Library: `react-native-passkeys` (Expo module autolinked by native builds;
  wraps AuthenticationServices on iOS and Credential Manager on Android).
- Requires an EAS/dev-client build. Passkeys do NOT work in Expo Go.
- Minimum OS: iOS 15+ (16+ recommended), Android 9+ with Google Play services.

### 4. API endpoints the apps call

All JSON + Bearer token, no cookies/CSRF involvement:

Enrollment (after login, from the app's Security screen):

- `POST /api/driver/security/passkeys` → registration options (drivers)
- `POST /api/driver/security/passkeys/verify` → store credential
- `POST /api/account/security/passkeys` (+ `/verify`) → same for other roles
- Both create/verify routes are guarded with `blockImpersonated`; keep that on
  any new credential endpoints.

Login (no session yet):

- `POST /api/auth/passkeys/options` → `{ sessionId, publicKey }` challenge for
  discoverable credentials
- `POST /api/auth/passkeys/verify` → `{ ok, token, user }`. Native apps use the
  `token` from the body (the cookie is for browsers); store it the same way as
  the OTP login token (SecureStore via `secureSession`).

Client flow with `react-native-passkeys`:

```ts
import { create, get } from "react-native-passkeys";

// enroll
const { publicKey } = await api.post("/driver/security/passkeys");
const credential = await create(publicKey);
await api.post("/driver/security/passkeys/verify", credential);

// sign in
const { sessionId, publicKey: options } = await api.post("/auth/passkeys/options");
const assertion = await get(options);
const { token, user } = await api.post("/auth/passkeys/verify", { sessionId, response: assertion });
```

### 5. Recommended UX

- After the first successful OTP/password login, offer once: "Sign in faster
  with fingerprint / Face ID" and run the enrollment flow.
- Passkey button is the primary option on the login screen; OTP/password stays
  as the fallback (needed for new devices anyway).
- The app Security screen lists and revokes passkeys using the same endpoints
  as the web `PasskeysManager`.

### 6. Testing checklist

1. `curl https://nolsaf.com/.well-known/apple-app-site-association` returns 200
   JSON with the right `TEAMID.bundleId` values, no redirect.
2. `curl https://nolsaf.com/.well-known/assetlinks.json` returns 200 JSON with
   the right package + fingerprints. Validate with Google's tool:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://nolsaf.com&relation=delegate_permission/common.get_login_creds`
3. On a staging API hosted under `*.nolsaf.com`, keep `WEB_AUTHN_RP_ID=nolsaf.com`
   and set `WEB_AUTHN_NATIVE_ORIGINS` to the debug/staging apk-key-hashes.
4. Enroll on device → row appears in the `Passkey` table and in the web
   Security page for the same account.
5. Sign out → sign in with passkey on device → `token` returned and API calls
   succeed.
6. Cross-check: enroll on web, sign in with the same passkey in the app
   (requires the credential to be synced by iCloud Keychain / Google Password
   Manager on that device).
