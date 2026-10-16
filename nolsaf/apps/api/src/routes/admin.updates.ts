import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { limitCloudinarySign } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireAdmin as RequestHandler);

const IMAGE_FOLDER = "site-updates";
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const SIGNED_FORMATS = "jpg,png,webp,gif";
type NewImage = { publicId: string; version: number; signature: string };
class InvalidUpdate extends Error {}
class ImageServiceUnavailable extends Error {}

function validCloudinaryResponseSignature(image: NewImage): boolean {
  const algorithm = image.signature.length === 64 ? "sha256" : "sha1";
  const source = `public_id=${image.publicId}&version=${image.version}${process.env.CLOUDINARY_API_SECRET}`;
  const expected = createHash(algorithm).update(source).digest();
  const supplied = Buffer.from(image.signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function cloudinaryReady(): boolean {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function configureCloudinary(): void {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    api_key: process.env.CLOUDINARY_API_KEY!,
    api_secret: process.env.CLOUDINARY_API_SECRET!,
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toApiDto(row: any) {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    images: toStringArray(row.images),
    videos: toStringArray(row.videos),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function parseBody(body: any, existingImages: string[] = []) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!title || title.length > 120 || !content || content.length > 20_000) {
    throw new InvalidUpdate("Title or message is missing or too long.");
  }
  const retained = body?.retainedImageIndexes ?? [];
  const images = body?.images ?? [];
  const videos = body?.videos ?? [];
  if (!Array.isArray(retained) || !Array.isArray(images) || !Array.isArray(videos) ||
      retained.length + images.length > MAX_IMAGES || videos.length > 10) {
    throw new InvalidUpdate("Too many photos or videos.");
  }
  if (retained.some((index: unknown) => typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= existingImages.length) ||
      new Set(retained).size !== retained.length) {
    throw new InvalidUpdate("An existing photo reference is invalid.");
  }
  if (videos.some((url: unknown) => typeof url !== "string" || !/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/.test(url))) {
    throw new InvalidUpdate("A video link is invalid.");
  }
  for (const image of images) {
    if (!image || typeof image.publicId !== "string" ||
        !/^site-updates\/[a-f0-9-]{36}$/.test(image.publicId) ||
        !Number.isSafeInteger(image.version) || image.version <= 0 ||
        typeof image.signature !== "string" || !/^[a-f0-9]{40,64}$/i.test(image.signature)) {
      throw new InvalidUpdate("A new photo reference is invalid.");
    }
  }
  if (new Set(images.map((image: NewImage) => image.publicId)).size !== images.length) {
    throw new InvalidUpdate("A photo was added twice.");
  }
  return { title, content, retained: retained as number[], images: images as NewImage[], videos: videos as string[] };
}

function createId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) {
    throw new InvalidUpdate("The update request ID is invalid.");
  }
  return `update_${value}`;
}

async function verifiedImageUrls(images: NewImage[]): Promise<string[]> {
  if (!images.length) return [];
  if (!cloudinaryReady()) throw new ImageServiceUnavailable("cloudinary_not_configured");
  configureCloudinary();
  const urls: string[] = [];
  for (const image of images) {
    if (!validCloudinaryResponseSignature(image)) {
      throw new InvalidUpdate("A photo upload could not be verified.");
    }
    let asset: any;
    try {
      asset = await cloudinary.api.resource(image.publicId, { resource_type: "image" });
    } catch (error: any) {
      if (error?.http_code === 404) throw new InvalidUpdate("An uploaded photo was not found.");
      throw new ImageServiceUnavailable("cloudinary_lookup_failed");
    }
    if (asset.public_id !== image.publicId || asset.version !== image.version ||
        asset.resource_type !== "image" || !ALLOWED_FORMATS.has(String(asset.format).toLowerCase()) ||
        !Number.isFinite(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_IMAGE_BYTES ||
        !Number.isInteger(asset.width) || !Number.isInteger(asset.height) ||
        asset.width <= 0 || asset.height <= 0 || asset.width * asset.height > MAX_IMAGE_PIXELS ||
        typeof asset.secure_url !== "string" ||
        !asset.secure_url.startsWith(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`)) {
      throw new InvalidUpdate("A photo does not meet the upload rules.");
    }
    urls.push(asset.secure_url);
  }
  return urls;
}

function handleError(res: Response, action: string, err: unknown): void {
  if (err instanceof InvalidUpdate) {
    res.status(400).json({ error: "invalid_update", message: err.message });
    return;
  }
  console.error(`Error ${action} update:`, err);
  if (err instanceof ImageServiceUnavailable) {
    res.status(503).json({ error: "image_service_unavailable", message: "Could not verify the uploaded photos. Please try again." });
    return;
  }
  res.status(500).json({ error: "update_unavailable", message: "Could not save the update. Please try again." });
}

/** A short-lived, admin-only signature for one direct image upload. */
router.get("/image-signature", limitCloudinarySign as RequestHandler, (_req, res) => {
  if (!cloudinaryReady()) return res.status(503).json({ error: "cloudinary_not_configured" });
  configureCloudinary();
  const params = {
    timestamp: Math.floor(Date.now() / 1000),
    folder: IMAGE_FOLDER,
    public_id: randomUUID(),
    overwrite: "false",
    allowed_formats: SIGNED_FORMATS,
  };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET!);
  res.setHeader("Cache-Control", "no-store");
  res.json({ cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, params, signature, maxBytes: MAX_IMAGE_BYTES });
});

/** GET /api/admin/updates - List all updates */
router.get("/", async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const take = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 100;
    const rows = await prisma.siteUpdate.findMany({
      orderBy: { id: "desc" },
      take,
      select: { id: true, title: true, content: true, images: true, videos: true, createdAt: true, updatedAt: true },
    });
    const total = await prisma.siteUpdate.count();
    res.json({ items: rows.map(toApiDto), total, limit: take });
  } catch (err: any) {
    console.error("Error fetching updates:", err);
    res.status(500).json({ error: "Failed to fetch updates", message: err?.message });
  }
});

/** GET /api/admin/updates/:id - Get single update */
router.get("/:id", async (req, res) => {
  try {
    const row = await prisma.siteUpdate.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Update not found" });
    res.json(toApiDto(row));
  } catch (err: any) {
    console.error("Error fetching update:", err);
    res.status(500).json({ error: "Failed to fetch update", message: err?.message });
  }
});

/** POST /api/admin/updates - Metadata only; media goes directly to Cloudinary. */
router.post("/", async (req, res) => {
  try {
    const input = parseBody(req.body);
    const id = createId(req.body?.clientId);
    const images = await verifiedImageUrls(input.images);
    let created: any;
    try {
      created = await prisma.siteUpdate.create({
        data: { id, title: input.title, content: input.content, images, videos: input.videos },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const prior = await prisma.siteUpdate.findUnique({ where: { id } });
      if (!prior || prior.title !== input.title || prior.content !== input.content ||
          JSON.stringify(toStringArray(prior.images)) !== JSON.stringify(images) ||
          JSON.stringify(toStringArray(prior.videos)) !== JSON.stringify(input.videos)) {
        throw new InvalidUpdate("This update request was already used with different content.");
      }
      return res.status(200).json(toApiDto(prior));
    }
    const dto = toApiDto(created);
    await audit(req, "ADMIN_UPDATE_CREATE", `update:${id}`, null, dto);
    res.status(201).json(dto);
  } catch (err) {
    handleError(res, "creating", err);
  }
});

/** PUT /api/admin/updates/:id - Retained media is selected by index from the saved row. */
router.put("/:id", async (req, res) => {
  try {
    const existing = await prisma.siteUpdate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Update not found" });
    const savedImages = toStringArray(existing.images);
    const input = parseBody(req.body, savedImages);
    const newImages = await verifiedImageUrls(input.images);
    const images = [...input.retained.map((index) => savedImages[index]), ...newImages];
    const updated = await prisma.siteUpdate.update({
      where: { id: req.params.id },
      data: { title: input.title, content: input.content, images, videos: input.videos },
    });
    const dto = toApiDto(updated);
    await audit(req, "ADMIN_UPDATE_UPDATE", `update:${req.params.id}`, toApiDto(existing), dto);
    res.json(dto);
  } catch (err) {
    handleError(res, "updating", err);
  }
});

/** DELETE /api/admin/updates/:id - Delete update */
router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.siteUpdate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Update not found" });
    await prisma.siteUpdate.delete({ where: { id: req.params.id } });
    await audit(req, "ADMIN_UPDATE_DELETE", `update:${req.params.id}`, toApiDto(existing), null);
    res.json({ ok: true, message: "Update deleted successfully" });
  } catch (err: any) {
    console.error("Error deleting update:", err);
    res.status(500).json({ error: "Failed to delete update", message: err?.message });
  }
});

export default router;
