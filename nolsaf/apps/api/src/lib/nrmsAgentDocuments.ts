import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const TRAVELLER_PREFIX = "agent-traveller-documents/";

export function isAgentTravellerDocumentKey(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith(TRAVELLER_PREFIX)
    && value.length <= 255
    && /^[a-zA-Z0-9_./-]+$/.test(value);
}

/**
 * Produce a short-lived signed delivery URL for an authenticated Cloudinary
 * asset. Callers must authorize the booking/guest before invoking this helper;
 * the object key alone is never treated as a credential.
 */
export function signedAgentTravellerDocumentUrl(documentKey: string, resourceType: string): string {
  if (!isAgentTravellerDocumentKey(documentKey)) throw new Error("INVALID_AGENT_TRAVELLER_DOCUMENT_KEY");
  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_NAME) {
    throw new Error("CLOUDINARY_NOT_CONFIGURED");
  }
  return cloudinary.url(documentKey, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: resourceType === "raw" ? "raw" : "image",
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}
