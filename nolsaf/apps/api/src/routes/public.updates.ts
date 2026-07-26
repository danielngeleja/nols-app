import { Router } from "express";
import { prisma } from "@nolsaf/prisma";

const router = Router();

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    // Public update media must be references, never embedded data/blob URLs.
    // This also prevents a handful of records from creating multi-megabyte
    // anonymous responses.
    .filter((value) => value.length <= 2_048 && /^(https?:\/\/|\/)/i.test(value))
    .slice(0, 12);
}

/** GET /api/public/updates - Get public updates */
router.get("/", async (_req, res, next) => {
  // Ensure we always return JSON, even on errors - set headers early
  res.setHeader('Content-Type', 'application/json');
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  
  try {
    const rows = await prisma.siteUpdate.findMany({
      orderBy: { id: "desc" },
      take: 20,
      select: { id: true, title: true, content: true, images: true, videos: true, createdAt: true, updatedAt: true },
    });

    const items = rows.map((row: any) => ({
      id: String(row.id),
      title: String(row.title),
      content: String(row.content),
      images: toStringArray(row.images),
      videos: toStringArray(row.videos),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));

    res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error("Error fetching public updates:", err);
    console.error("Error details:", {
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    
    // Don't send response if already sent
    if (res.headersSent) {
      return next(err);
    }
    
    // Ensure JSON response header is set
    res.setHeader('Content-Type', 'application/json');
    
    // Return empty array instead of 500 to prevent UI crash
    res.status(200).json({ items: [], total: 0 });
  }
});

export default router;
