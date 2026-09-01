import { Router } from "express";
import type { RequestHandler } from "express";
import { randomBytes } from "crypto";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { z } from "zod";
import { buildPropertySlug, pickImages, formatLocation } from "../lib/publicPropertyDto.js";

const router = Router();
router.use(requireAuth as RequestHandler);

// Validation schemas
const savePropertySchema = z.object({
  propertyId: z.number().int().positive(),
});

const queryParamsSchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, "Page must be a positive integer")
    .default("1")
    .transform(Number)
    .pipe(z.number().int().positive()),
  pageSize: z
    .string()
    .regex(/^\d+$/, "Page size must be a positive integer")
    .default("20")
    .transform(Number)
    .pipe(z.number().int().positive().max(100, "Page size cannot exceed 100")),
});

/**
 * Share tokens are opaque and short enough to survive a WhatsApp message
 * without wrapping. 16 chars of base32 alphabet is ~80 bits, far beyond
 * guessing range for a link that only reveals a public listing anyway.
 */
const SHARE_TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newShareToken(): string {
  const bytes = randomBytes(16);
  let token = "";
  for (let i = 0; i < 16; i += 1) {
    token += SHARE_TOKEN_ALPHABET[bytes[i] % SHARE_TOKEN_ALPHABET.length];
  }
  return token;
}

const SHARE_CHANNELS = ["WHATSAPP", "COPY_LINK", "NATIVE", "SMS", "EMAIL"];

function parseShareChannel(raw: unknown): string | null {
  const value = String(raw || "").trim().toUpperCase();
  return SHARE_CHANNELS.includes(value) ? value : null;
}

function buildShareUrl(token: string, propertyId: number, title: string | null): string {
  const origin = process.env.WEB_ORIGIN || process.env.FRONTEND_URL || process.env.APP_ORIGIN || "";
  // Same canonical listing URL the rest of the app links to, with the token as
  // a query param. No new route, and the SEO canonical is unaffected.
  const slug = buildPropertySlug(title || "", propertyId);
  return `${origin}/public/properties/${slug}?s=${encodeURIComponent(token)}`;
}

const propertyIdParamSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, "Property ID must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().positive()),
});

// Type definitions
type SavedPropertyWithRelations = {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  property: {
    id: number;
    title: string;
    type: string;
    regionName: string | null;
    district: string | null;
    city: string | null;
    street: string | null;
    ward: string | null;
    basePrice: any;
    currency: string | null;
    services: any;
    photos: any;
    images?: Array<{ url: string | null }>;
  } | null;
  savedAt: Date;
  sharedAt: Date | null;
};

type PropertyItem = {
  id: number;
  slug: string;
  title: string;
  location: string;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  services: unknown;
  savedAt: string;
  sharedAt: string | null;
};

// Helper function to validate and get user ID
function getUserId(req: AuthedRequest): number | null {
  const userId = Number(req.user?.id);
  if (!userId || isNaN(userId) || userId <= 0) {
    return null;
  }
  return userId;
}

// Helper function to transform saved property to response item
function transformSavedPropertyToItem(
  sp: SavedPropertyWithRelations
): PropertyItem | null {
  if (!sp?.property?.id) {
    return null;
  }

  const title = sp.property.title || "Untitled property";
  const slug = buildPropertySlug(title, sp.property.id);
  
  // Extract primary image - use the first image URL if available, otherwise use photos
  let primaryImage: string | null = null;
  if (sp.property.images && sp.property.images.length > 0 && sp.property.images[0]?.url) {
    primaryImage = sp.property.images[0].url;
  } else if (sp.property.photos) {
    // If photos is a string, use it directly; if it's an array, use the first item
    if (typeof sp.property.photos === "string") {
      primaryImage = sp.property.photos;
    } else if (Array.isArray(sp.property.photos) && sp.property.photos.length > 0) {
      primaryImage = String(sp.property.photos[0]);
    }
  }
  
  const location =
    formatLocation({
      city: sp.property.city,
      district: sp.property.district,
      ward: sp.property.ward,
      regionName: sp.property.regionName,
    }) || sp.property.street || "Location not specified";

  return {
    id: sp.property.id,
    slug,
    title,
    location,
    primaryImage,
    basePrice: sp.property.basePrice ? Number(sp.property.basePrice) : null,
    currency: sp.property.currency,
    services: sp.property.services ?? null,
    savedAt: sp.savedAt.toISOString(),
    sharedAt: sp.sharedAt?.toISOString() || null,
  };
}

function transformSavedPropertiesToItems(
  properties: SavedPropertyWithRelations[]
): PropertyItem[] {
  const items: PropertyItem[] = [];

  for (const sp of properties) {
    const item = transformSavedPropertyToItem(sp);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

// Helper function to fetch saved properties with pagination
async function fetchSavedProperties(
  userId: number,
  whereClause: {
    userId: number;
    sharedAt?: { not: null } | null;
  },
  orderBy: { savedAt?: "asc" | "desc" } | { sharedAt?: "asc" | "desc" },
  page: number,
  pageSize: number
) {
  const skip = (page - 1) * pageSize;

  const [properties, total] = await Promise.all([
    prisma.savedProperty.findMany({
      where: whereClause,
      include: {
        property: {
          select: {
            id: true,
            title: true,
            type: true,
            regionName: true,
            district: true,
            city: true,
            street: true,
            ward: true,
            basePrice: true,
            currency: true,
            services: true,
            photos: true,
            images: {
              where: { status: "READY" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.savedProperty.count({ where: whereClause }),
  ]);

  return { properties, total };
}

// Audit logging helper
function logAction(
  action: "save" | "unsave" | "share",
  userId: number,
  propertyId: number,
  success: boolean,
  error?: string
) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${action.toUpperCase()} | User: ${userId} | Property: ${propertyId} | Success: ${success}${error ? ` | Error: ${error}` : ""}`;
  
  if (success) {
    console.log(logMessage);
  } else {
    console.error(logMessage);
  }
}

/**
 * GET /api/customer/saved-properties
 * Get all saved properties for the authenticated customer
 * Query params: page, pageSize
 */
router.get(
  "/",
  (async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "Invalid user ID",
        });
      }

      // Validate query parameters
      const queryParams = queryParamsSchema.parse(req.query);

      const { properties, total } = await fetchSavedProperties(
        userId,
        { userId },
        { savedAt: "desc" },
        queryParams.page,
        queryParams.pageSize
      );

      const items = transformSavedPropertiesToItems(properties);

      res.json({
        ok: true,
        items,
        total,
        page: queryParams.page,
        pageSize: queryParams.pageSize,
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: "Invalid query parameters",
          details: error.issues,
        });
      }

      console.error("Failed to fetch saved properties:", error);
      res.status(500).json({
        ok: false,
        error: "Failed to fetch saved properties",
      });
    }
  }) as RequestHandler
);

/**
 * POST /api/customer/saved-properties
 * Save a property to favorites
 */
router.post(
  "/",
  (async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "Invalid user ID",
        });
      }

      const body = savePropertySchema.parse(req.body);

      // Check if property exists and is approved
      const property = await prisma.property.findFirst({
        where: {
          id: body.propertyId,
          status: "APPROVED",
        },
      });

      if (!property) {
        logAction("save", userId, body.propertyId, false, "Property not found or not approved");
        return res.status(404).json({
          ok: false,
          error: "Property not found or not available",
        });
      }

      // Check if already saved
      const existing = await prisma.savedProperty.findUnique({
        where: {
          userId_propertyId: {
            userId,
            propertyId: body.propertyId,
          },
        },
      });

      if (existing) {
        logAction("save", userId, body.propertyId, false, "Property already saved");
        return res.status(400).json({
          ok: false,
          error: "Property is already saved",
        });
      }

      // Save the property
      const savedProperty = await prisma.savedProperty.create({
        data: {
          userId,
          propertyId: body.propertyId,
        },
        include: {
          property: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      logAction("save", userId, body.propertyId, true);

      const slug = buildPropertySlug(
        savedProperty.property.title,
        savedProperty.property.id
      );

      res.json({
        ok: true,
        data: {
          id: savedProperty.property.id,
          slug,
          title: savedProperty.property.title,
          savedAt: savedProperty.savedAt.toISOString(),
        },
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: "Invalid request data",
          details: error.issues,
        });
      }

      console.error("Failed to save property:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Error details:", {
        message: errorMessage,
        code: (error as { code?: string })?.code,
        meta: (error as { meta?: unknown })?.meta,
      });

      const userId = getUserId(req);
      if (userId && req.body?.propertyId) {
        logAction(
          "save",
          userId,
          Number(req.body.propertyId),
          false,
          errorMessage
        );
      }

      res.status(500).json({
        ok: false,
        error: "Failed to save property",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      });
    }
  }) as RequestHandler
);

/**
 * DELETE /api/customer/saved-properties/:id
 * Remove a property from saved list
 */
router.delete(
  "/:id",
  (async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "Invalid user ID",
        });
      }

      const params = propertyIdParamSchema.parse(req.params);
      const propertyId = params.id;

      const savedProperty = await prisma.savedProperty.findUnique({
        where: {
          userId_propertyId: {
            userId,
            propertyId,
          },
        },
      });

      if (!savedProperty) {
        logAction("unsave", userId, propertyId, false, "Property not found in saved list");
        return res.status(404).json({
          ok: false,
          error: "Property not found in saved list",
        });
      }

      await prisma.savedProperty.delete({
        where: {
          id: savedProperty.id,
        },
      });

      logAction("unsave", userId, propertyId, true);

      res.json({
        ok: true,
        message: "Property removed from saved list",
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: "Invalid property ID",
          details: error.issues,
        });
      }

      console.error("Failed to unsave property:", error);
      const userId = getUserId(req);
      if (userId && req.params?.id) {
        logAction(
          "unsave",
          userId,
          Number(req.params.id),
          false,
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      res.status(500).json({
        ok: false,
        error: "Failed to remove property from saved list",
      });
    }
  }) as RequestHandler
);

/**
 * GET /api/customer/saved-properties/shared
 * Get all shared properties for the authenticated customer
 * Query params: page, pageSize
 */
router.get(
  "/shared",
  (async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "Invalid user ID",
        });
      }

      // Validate query parameters
      const queryParams = queryParamsSchema.parse(req.query);

      const { properties, total } = await fetchSavedProperties(
        userId,
        {
          userId,
          sharedAt: { not: null },
        },
        { sharedAt: "desc" },
        queryParams.page,
        queryParams.pageSize
      );

      const items = transformSavedPropertiesToItems(properties);

      res.json({
        ok: true,
        items,
        total,
        page: queryParams.page,
        pageSize: queryParams.pageSize,
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: "Invalid query parameters",
          details: error.issues,
        });
      }

      console.error("Failed to fetch shared properties:", error);
      res.status(500).json({
        ok: false,
        error: "Failed to fetch shared properties",
      });
    }
  }) as RequestHandler
);

/**
 * POST /api/customer/saved-properties/:id/share
 * Mark a saved property as shared (updates sharedAt timestamp)
 */
router.post(
  "/:id/share",
  (async (req: AuthedRequest, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: "Invalid user ID",
        });
      }

      const params = propertyIdParamSchema.parse(req.params);
      const propertyId = params.id;

      const savedProperty = await prisma.savedProperty.findUnique({
        where: {
          userId_propertyId: {
            userId,
            propertyId,
          },
        },
      });

      if (!savedProperty) {
        logAction("share", userId, propertyId, false, "Property not found in saved list");
        return res.status(404).json({
          ok: false,
          error: "Property not found in saved list",
        });
      }

      // `sharedAt` keeps its first value so existing reads and the Shared tab
      // behave exactly as before. Attribution lives on the new share row.
      const updated = await prisma.savedProperty.update({
        where: {
          id: savedProperty.id,
        },
        data: {
          sharedAt: savedProperty.sharedAt || new Date(),
        },
      });

      // One row per share, so re-shares and per-channel performance are both
      // visible. Fail-soft: an older deployment without the table must still be
      // able to share, just without attribution (expand and contract).
      const channel = parseShareChannel((req.body as any)?.channel);
      let share: { token: string; url: string } | null = null;
      try {
        const [created, property] = await Promise.all([
          prisma.propertyShare.create({
            data: { token: newShareToken(), sharerId: userId, propertyId, channel },
            select: { token: true },
          }),
          prisma.property.findUnique({ where: { id: propertyId }, select: { title: true } }),
        ]);
        share = { token: created.token, url: buildShareUrl(created.token, propertyId, property?.title ?? null) };
      } catch (shareError) {
        console.warn("Property share attribution unavailable", shareError);
      }

      logAction("share", userId, propertyId, true);

      res.json({
        ok: true,
        data: {
          id: updated.propertyId,
          sharedAt: updated.sharedAt?.toISOString() || null,
          shareToken: share?.token || null,
          shareUrl: share?.url || null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: "Invalid property ID",
          details: error.issues,
        });
      }

      console.error("Failed to mark property as shared:", error);
      const userId = getUserId(req);
      if (userId && req.params?.id) {
        logAction(
          "share",
          userId,
          Number(req.params.id),
          false,
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      res.status(500).json({
        ok: false,
        error: "Failed to mark property as shared",
      });
    }
  }) as RequestHandler
);

export default router;
