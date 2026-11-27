/**
 * Uploads one image straight to NoLSAF's Cloudinary account with a signature
 * from our API (GET /api/uploads/cloudinary/sign), the same way the listing
 * wizard does. The API decides which folders the signed-in user may use.
 */
import apiClient from "@/lib/apiClient";

export const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function uploadImageSigned(file: File, folder: string): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type.toLowerCase())) throw new Error("Use a JPG, PNG or WebP photo.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Each photo must be 10 MB or smaller.");
  const sign = await apiClient.get("/api/uploads/cloudinary/sign", { params: { folder } });
  const { cloudName, apiKey, timestamp, signature } = sign.data as { cloudName: string; apiKey: string; timestamp: number; signature: string };
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("overwrite", "true");
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error("The photo could not be uploaded. Try again.");
  const data = (await res.json()) as { secure_url?: string };
  if (!data.secure_url) throw new Error("The photo could not be uploaded. Try again.");
  return data.secure_url;
}
