// apps/api/src/lib/webauthnRp.ts
// Single source of truth for the WebAuthn Relying Party configuration, shared
// by every passkey endpoint (web + native apps).
//
// RP ID is the registrable domain passkeys are bound to (e.g. "nolsaf.com").
// Because the native apps prove ownership of the same domain (Apple Associated
// Domains / Android Digital Asset Links), one passkey works on web, iOS and
// Android as long as every surface uses the same RP ID.
//
// Expected origins are every origin an attestation/assertion may legitimately
// come from:
//   - the web origin (browser flows), from WEB_ORIGIN/APP_ORIGIN
//   - https://<rpID> — iOS AuthenticationServices reports the associated
//     domain itself as the origin, which may differ from WEB_ORIGIN when the
//     site is served from a subdomain (e.g. www.)
//   - android:apk-key-hash:<base64url-sha256> entries — Android Credential
//     Manager reports the APK signing-cert hash instead of a URL. Configure
//     one entry per signing cert (upload key AND Play App Signing key) via
//     WEB_AUTHN_NATIVE_ORIGINS (comma-separated).

export type WebAuthnRpConfig = {
  rpID: string;
  expectedOrigins: string[];
};

export function getWebAuthnRp(): WebAuthnRpConfig {
  const webOrigin = (process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

  let rpID = String(process.env.WEB_AUTHN_RP_ID || "").trim();
  if (!rpID) {
    try {
      rpID = new URL(webOrigin).hostname;
    } catch {
      rpID = "localhost";
    }
  }

  const origins = new Set<string>([webOrigin, `https://${rpID}`]);
  for (const entry of String(process.env.WEB_AUTHN_NATIVE_ORIGINS || "").split(",")) {
    const value = entry.trim();
    if (value) origins.add(value);
  }

  return { rpID, expectedOrigins: Array.from(origins) };
}

export default { getWebAuthnRp };
