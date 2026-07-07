import { NextResponse } from "next/server";

/**
 * Android Digital Asset Links for passkeys in the native apps.
 *
 * Android Credential Manager lets an app use passkeys for this domain only
 * when the app's package name + signing-cert SHA-256 fingerprint appear here
 * with the `get_login_creds` relation.
 *
 * Configure via env (Vercel project settings):
 *   ANDROID_PASSKEY_APPS  semicolon-separated entries of
 *                         <package>=<fingerprint>|<fingerprint>...
 *     e.g. "com.nolsaf.driver=AA:BB:...:FF|11:22:...:EE;com.nolsaf.partners=CC:DD:...:00"
 *
 * Include BOTH the upload key and the Google Play App Signing key fingerprints
 * for each app, or release builds installed from Play will fail silently.
 *
 * Returns 404 until configured so nothing caches a placeholder.
 */
export async function GET() {
  const raw = (process.env.ANDROID_PASSKEY_APPS || "").trim();
  if (!raw) {
    return NextResponse.json({ error: "not configured" }, { status: 404 });
  }

  const statements = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [packageName, fingerprints] = entry.split("=").map((s) => (s || "").trim());
      const sha256 = (fingerprints || "")
        .split("|")
        .map((f) => f.trim().toUpperCase())
        .filter(Boolean);
      if (!packageName || sha256.length === 0) return null;
      return {
        relation: ["delegate_permission/common.get_login_creds"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: sha256,
        },
      };
    })
    .filter(Boolean);

  if (statements.length === 0) {
    return NextResponse.json({ error: "not configured" }, { status: 404 });
  }

  return NextResponse.json(statements, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
