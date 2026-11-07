/**
 * Private storage for visit photos. Photos are uploaded by the API (never
 * directly from the browser) as authenticated Cloudinary assets, so they have
 * no public URL; screens open them through signed links that expire in five
 * minutes.
 */
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const PREFIX = "sales-visits/";

function configured(): boolean {
  return Boolean(process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_CLOUD_NAME);
}

export function isVisitPhotoPublicId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX) && value.length <= 255 && !value.includes("..") && /^[a-zA-Z0-9_./-]+$/.test(value);
}

export async function uploadVisitPhoto(buffer: Buffer, salesPartnerId: number): Promise<string> {
  if (!configured()) throw new Error("CLOUDINARY_NOT_CONFIGURED");
  const result = await new Promise<{ public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${PREFIX}${salesPartnerId}`,
        resource_type: "image",
        type: "authenticated",
        access_mode: "authenticated",
        overwrite: false,
      },
      (error, uploaded) => {
        if (error || !uploaded?.public_id) return reject(error || new Error("VISIT_PHOTO_UPLOAD_FAILED"));
        resolve({ public_id: uploaded.public_id });
      },
    );
    stream.end(buffer);
  });
  return result.public_id;
}

/** Best effort: remove a photo whose visit was not saved. */
export async function deleteVisitPhoto(publicId: string): Promise<void> {
  if (!configured() || !isVisitPhotoPublicId(publicId)) return;
  await cloudinary.uploader.destroy(publicId, { type: "authenticated", resource_type: "image" }).catch(() => undefined);
}

export function signedVisitPhotoUrl(publicId: string): string | null {
  if (!configured() || !isVisitPhotoPublicId(publicId)) return null;
  return cloudinary.url(publicId, {
    secure: true,
    sign_url: true,
    type: "authenticated",
    resource_type: "image",
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}
