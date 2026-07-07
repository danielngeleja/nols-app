import { NextResponse } from "next/server";

/**
 * Apple App Site Association (AASA) for passkeys in the native apps.
 *
 * iOS grants an app access to passkeys for this domain only when the app's
 * `webcredentials:<domain>` Associated Domains entitlement is matched by this
 * file. Apple's CDN fetches it from https://<domain>/.well-known/... — it must
 * be served over HTTPS, without redirects, as application/json.
 *
 * Configure via env (Vercel project settings):
 *   APPLE_TEAM_ID            e.g. "AB12CD34EF"
 *   APPLE_PASSKEY_BUNDLE_IDS comma-separated, e.g. "com.nolsaf.driver,com.nolsaf.partners"
 *
 * Returns 404 until both are set so Apple's CDN never caches a placeholder.
 */
export async function GET() {
  const teamId = (process.env.APPLE_TEAM_ID || "").trim();
  const bundleIds = (process.env.APPLE_PASSKEY_BUNDLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!teamId || bundleIds.length === 0) {
    return NextResponse.json({ error: "not configured" }, { status: 404 });
  }

  return NextResponse.json(
    {
      webcredentials: {
        apps: bundleIds.map((id) => `${teamId}.${id}`),
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
