import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { limitCloudinarySign, limitUploadPresign } from "../middleware/rateLimit.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

export const router = Router();
router.use((req, _res, next) => {
  if (process.env.NODE_ENV === "production") return next();
  const hasCookie = !!req.headers.cookie;
  const cookieKeys = hasCookie ? req.headers.cookie!.split(";").map(c => c.trim().split("=")[0]) : [];
  console.log(`[UPLOAD_DEBUG] ${req.method} ${req.path} | cookie header present: ${hasCookie} | cookie keys: [${cookieKeys.join(", ")}] | auth header: ${!!req.headers.authorization}`);
  next();
});
router.use(requireAuth);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_TRAVELLER_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_NRMS_MENU_PHOTO_BYTES = 2 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
const nrmsMenuUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_NRMS_MENU_PHOTO_BYTES } });

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export function isCloudinaryFileTypeAllowed(mimetype: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimetype);
}

const signQuerySchema = z
  .object({
    folder: z
      .string()
      .trim()
      .min(1)
      .max(80)
      // Cloudinary folder constraints (keep tight to avoid weird injection/abuse)
      .regex(/^[a-z0-9]+(?:[a-z0-9_-]*)(?:\/[a-z0-9]+(?:[a-z0-9_-]*))*$/i)
      .optional(),
      maxBytes: z.string().regex(/^\d+$/).optional().transform((v) => (typeof v === "string" ? Number(v) : undefined)),
  })
  .strict();

const allowedFolderPatterns: Array<{ type: "exact"; value: string } | { type: "prefix"; value: string }> = [
  { type: "exact", value: "uploads" },
  { type: "exact", value: "avatars" },
  { type: "exact", value: "agent-operator" },
  { type: "prefix", value: "agent-operator/" },
  { type: "exact", value: "agent-documents" },
  { type: "prefix", value: "agent-documents/" },
  { type: "exact", value: "agent-traveller-documents" },
  { type: "prefix", value: "agent-traveller-documents/" },
  { type: "exact", value: "owner-documents" },
  { type: "exact", value: "driver-documents" },
  { type: "prefix", value: "driver-documents/" },
  { type: "exact", value: "properties" },
  { type: "prefix", value: "properties/" },
  { type: "exact", value: "trust-partners" },
  { type: "exact", value: "nrms-menu" },
  { type: "prefix", value: "nrms-menu/" },
];

function isAllowedFolder(folder: string): boolean {
  for (const p of allowedFolderPatterns) {
    if (p.type === "exact" && folder === p.value) return true;
    if (p.type === "prefix" && folder.startsWith(p.value)) return true;
  }
  return false;
}

function folderMatches(folder: string, base: string): boolean {
  return folder === base || folder.startsWith(`${base}/`);
}

export function maxCloudinaryUploadBytesForFolder(folder: string): number | null {
  if (folderMatches(folder, "uploads") || folderMatches(folder, "agent-traveller-documents")) return MAX_TRAVELLER_DOCUMENT_BYTES;
  if (folderMatches(folder, "nrms-menu")) return MAX_NRMS_MENU_PHOTO_BYTES;
  return null;
}

/**
 * Parse the multipart upload with the correct limit before buffering the full
 * file. NRMS menu callers identify the folder in the query string as well as
 * the form body, so a 2MB+ photo is stopped at the boundary rather than being
 * allowed through the shared 15MB parser first.
 */
function parseCloudinaryUpload(req: Request, res: Response, next: NextFunction): void {
  const requestedFolder = String(req.query?.folder || "").trim();
  const parser = folderMatches(requestedFolder, "nrms-menu") ? nrmsMenuUpload : upload;
  parser.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      const formFolder = String(req.body?.folder || "").trim();
      const folder = requestedFolder || formFolder;
      const menuPhoto = folderMatches(folder, "nrms-menu");
      const maxBytes = menuPhoto ? MAX_NRMS_MENU_PHOTO_BYTES : MAX_UPLOAD_BYTES;
      res.status(413).json({
        error: "file_too_large",
        code: "UPLOAD_SIZE_LIMIT_EXCEEDED",
        maxBytes,
        message: menuPhoto
          ? "Photo exceeds the 2MB upload limit. Choose a smaller image."
          : "File exceeds the 15MB upload limit. Choose a smaller file.",
      });
      return;
    }
    next(error);
  });
}

function isFolderAllowedForRole(req: any, folder: string): boolean {
  const role = String(req.user?.role || "").toUpperCase();
  if (role === "ADMIN") return true;
  if (folder === "uploads" || folder === "avatars") return true;
  if (role === "AGENT" || role === "NRMS_AGENT") return folderMatches(folder, "agent-operator") || folderMatches(folder, "agent-documents") || folderMatches(folder, "agent-traveller-documents");
  if (role === "OWNER") return folderMatches(folder, "owner-documents") || folderMatches(folder, "properties") || folderMatches(folder, "nrms-menu");
  if (role === "DRIVER") return folderMatches(folder, "driver-documents");
  return false;
}

/**
 * Async permission layer on top of the role map. NRMS menu photos may also be
 * uploaded by non-owner staff who hold an active manager or outlet-supervisor
 * membership, which only the database can confirm.
 */
async function isFolderAllowedForUser(req: any, folder: string): Promise<boolean> {
  if (isFolderAllowedForRole(req, folder)) return true;
  if (folderMatches(folder, "nrms-menu") && req.user?.id) {
    const membership = await (prisma as any).nrmsStaffMembership.findFirst({
      where: { userId: req.user.id, status: "ACTIVE", role: { in: ["MANAGER", "OUTLET_SUPERVISOR"] } },
      select: { id: true },
    });
    return Boolean(membership);
  }
  return false;
}

/** GET /uploads/cloudinary/sign?folder=avatars */
router.get("/sign", limitCloudinarySign as any, async (req, res) => {
  const parsed = signQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query" });

  const folder = parsed.data.folder || "uploads";
  if (!isAllowedFolder(folder)) {
    return res.status(400).json({ error: "invalid_folder" });
  }
  if (!(await isFolderAllowedForUser(req, folder))) {
    return res.status(403).json({ error: "folder_forbidden" });
  }

  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({ error: "cloudinary_not_configured" });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const requestedMaxBytes = parsed.data.maxBytes;
  let maxFileSize: number | undefined;

  const folderLimit = maxCloudinaryUploadBytesForFolder(folder);
  if (folderLimit != null) {
    // Traveller documents and NRMS menu photos are hard-limited to 2MB.
    maxFileSize = folderLimit;
  } else if (typeof requestedMaxBytes === "number" && Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0) {
    maxFileSize = Math.min(Math.floor(requestedMaxBytes), MAX_UPLOAD_BYTES);
  }

  // Cloudinary signature is sensitive to exact param values.
  // Use string values to match what browsers send via FormData.
  // `max_file_size` is not included by Cloudinary in the upload signature
  // canonical string. Keep the signed fields to the exact fields sent to its
  // upload API; size limits remain enforced by the application upload flow.
  const params: Record<string, string | number> = { timestamp, folder, overwrite: "true" };
  const signature = cloudinary.utils.api_sign_request(params as any, process.env.CLOUDINARY_API_SECRET!);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    maxFileSize: maxFileSize ?? null,
    signature,
  });
});

/** POST /uploads/cloudinary/upload */
router.post("/upload", limitUploadPresign as any, parseCloudinaryUpload, async (req, res) => {
  const parsed = signQuerySchema.safeParse({ folder: req.body?.folder });
  if (!parsed.success) return res.status(400).json({ error: "invalid_folder" });

  const folder = parsed.data.folder || "uploads";
  const requestedFolder = String(req.query?.folder || "").trim();
  if (requestedFolder && requestedFolder !== folder) {
    return res.status(400).json({ error: "folder_mismatch" });
  }
  if (!isAllowedFolder(folder)) {
    return res.status(400).json({ error: "invalid_folder" });
  }
  if (!(await isFolderAllowedForUser(req, folder))) {
    return res.status(403).json({ error: "folder_forbidden" });
  }

  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({ error: "cloudinary_not_configured" });
  }

  const file = req.file;
  if (!file?.buffer?.length) {
    return res.status(400).json({ error: "file_required" });
  }
  const folderLimit = maxCloudinaryUploadBytesForFolder(folder);
  if (folderLimit != null && file.size > folderLimit) {
    return res.status(413).json({
      error: "file_too_large",
      code: "UPLOAD_SIZE_LIMIT_EXCEEDED",
      maxBytes: folderLimit,
      message: folderMatches(folder, "nrms-menu")
        ? "Photo exceeds the 2MB upload limit. Choose a smaller image."
        : "Files in this area must be 2MB or smaller.",
    });
  }
  if (!isCloudinaryFileTypeAllowed(file.mimetype)) {
    return res.status(400).json({ error: "invalid_file_type" });
  }

  try {
    const authenticatedTravellerDocument = folderMatches(folder, "agent-traveller-documents");
    const uploaded = await new Promise<{ secure_url: string; public_id: string; resource_type: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          overwrite: true,
          resource_type: "auto",
          ...(authenticatedTravellerDocument ? { type: "authenticated" as const, access_mode: "authenticated" as const } : {}),
        },
        (error, result) => {
          if (error || !result?.secure_url || !result.public_id) {
            reject(error || new Error("cloudinary_upload_failed"));
            return;
          }
          resolve({ secure_url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type || "image" });
        }
      );

      stream.end(file.buffer);
    });

    res.setHeader("Cache-Control", "no-store");
    return res.json(uploaded);
  } catch (error: any) {
    const cloudinaryMessage =
      error?.message ||
      error?.error?.message ||
      "cloudinary_upload_failed";
    return res.status(502).json({ error: "cloudinary_upload_failed", message: String(cloudinaryMessage) });
  }
});
