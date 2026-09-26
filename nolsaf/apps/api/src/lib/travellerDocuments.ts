import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const TRAVELLER_DOCUMENT_PREFIX = "traveller-documents/";

export function isTravellerDocumentPublicId(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith(TRAVELLER_DOCUMENT_PREFIX)
    && value.length <= 300
    && !value.includes("..")
    && /^[a-zA-Z0-9_./-]+$/.test(value);
}

export function signedTravellerDocumentUrl(publicId: string, resourceType: string): string {
  if (!isTravellerDocumentPublicId(publicId)) throw new Error("INVALID_TRAVELLER_DOCUMENT_ID");
  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_NAME) {
    throw new Error("CLOUDINARY_NOT_CONFIGURED");
  }
  return cloudinary.url(publicId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: resourceType === "raw" ? "raw" : "image",
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}
