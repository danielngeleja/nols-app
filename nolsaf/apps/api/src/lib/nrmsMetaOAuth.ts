import crypto from "node:crypto";

export type NrmsMetaOAuthState = {
  propertyId: number;
  ownerId: number;
  actorId: number;
  provider: "INSTAGRAM";
  expiresAt: number;
  nonce: string;
};

function stateSecret(): string {
  const value = process.env.META_OAUTH_STATE_SECRET || process.env.META_INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
  if (!value) throw new Error("META_OAUTH_STATE_SECRET is not configured");
  return value;
}

export function signNrmsMetaOAuthState(input: Omit<NrmsMetaOAuthState, "expiresAt" | "nonce">): string {
  const payload: NrmsMetaOAuthState = { ...input, expiresAt: Date.now() + 10 * 60_000, nonce: crypto.randomBytes(18).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyNrmsMetaOAuthState(value: string): NrmsMetaOAuthState | null {
  const [encoded, suppliedSignature, extra] = String(value || "").split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  let expectedSignature: Buffer;
  try { expectedSignature = crypto.createHmac("sha256", stateSecret()).update(encoded).digest(); } catch { return null; }
  let supplied: Buffer;
  try { supplied = Buffer.from(suppliedSignature, "base64url"); } catch { return null; }
  if (supplied.length !== expectedSignature.length || !crypto.timingSafeEqual(supplied, expectedSignature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as NrmsMetaOAuthState;
    if (parsed.provider !== "INSTAGRAM" || !Number.isInteger(parsed.propertyId) || !Number.isInteger(parsed.ownerId) || !Number.isInteger(parsed.actorId) || !parsed.nonce || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch { return null; }
}

export function instagramOAuthConfig() {
  return {
    appId: String(process.env.META_INSTAGRAM_APP_ID || process.env.META_APP_ID || ""),
    appSecret: String(process.env.META_INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || ""),
    redirectUri: String(process.env.META_INSTAGRAM_REDIRECT_URI || ""),
    graphVersion: String(process.env.META_GRAPH_API_VERSION || "v23.0"),
  };
}
