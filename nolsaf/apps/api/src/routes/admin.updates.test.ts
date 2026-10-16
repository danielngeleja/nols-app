import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  siteUpdate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  resource: vi.fn(),
  signRequest: vi.fn(() => "upload-signature"),
  audit: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: { siteUpdate: mocks.siteUpdate } }));
vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    utils: { api_sign_request: mocks.signRequest },
    api: { resource: mocks.resource },
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 1, role: "ADMIN" }; next(); },
}));
vi.mock("../middleware/admin.js", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/rateLimit.js", () => ({
  limitCloudinarySign: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));

import router from "./admin.updates.js";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/admin/updates", router);
  return instance;
}

const publicId = "site-updates/123e4567-e89b-12d3-a456-426614174000";
const clientId = "1bce7004-f041-46f6-96dd-61e94f4b0cb7";
const version = 123;
const signature = createHash("sha1").update(`public_id=${publicId}&version=${version}test-secret`).digest("hex");
const image = { publicId, version, signature };

describe("admin updates media boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";
    mocks.resource.mockResolvedValue({
      public_id: publicId,
      version,
      resource_type: "image",
      format: "jpg",
      bytes: 1_000_000,
      width: 1600,
      height: 1200,
      secure_url: `https://res.cloudinary.com/demo/image/upload/v123/${publicId}.jpg`,
    });
    mocks.siteUpdate.create.mockImplementation(async ({ data }: any) => ({
      ...data, createdAt: new Date(), updatedAt: new Date(),
    }));
    mocks.siteUpdate.update.mockImplementation(async ({ data }: any) => ({
      id: "update_existing", ...data, createdAt: new Date(), updatedAt: new Date(),
    }));
  });

  it("issues an admin signature restricted to update images", async () => {
    const response = await request(app()).get("/api/admin/updates/image-signature").expect(200);
    expect(response.body.params).toMatchObject({
      folder: "site-updates",
      overwrite: "false",
      allowed_formats: "jpg,png,webp,gif",
    });
    expect(response.body.maxBytes).toBe(5 * 1024 * 1024);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("stores only verified Cloudinary URLs in update metadata", async () => {
    await request(app()).post("/api/admin/updates").send({
      clientId, title: "New stay", content: "Available now", images: [image], videos: [],
    }).expect(201);
    expect(mocks.resource).toHaveBeenCalledWith(publicId, { resource_type: "image" });
    expect(mocks.siteUpdate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        images: [`https://res.cloudinary.com/demo/image/upload/v123/${publicId}.jpg`],
      }),
    });
  });

  it("rejects forged and oversized photo references before writing", async () => {
    await request(app()).post("/api/admin/updates").send({
      clientId, title: "New stay", content: "Available now", images: [{ ...image, signature: "0".repeat(40) }], videos: [],
    }).expect(400);
    mocks.resource.mockResolvedValueOnce({
      public_id: publicId, version, resource_type: "image", format: "jpg",
      bytes: 6 * 1024 * 1024,
      width: 1600, height: 1200,
      secure_url: `https://res.cloudinary.com/demo/image/upload/v123/${publicId}.jpg`,
    });
    await request(app()).post("/api/admin/updates").send({
      clientId, title: "New stay", content: "Available now", images: [image], videos: [],
    }).expect(400);
    expect(mocks.siteUpdate.create).not.toHaveBeenCalled();
  });

  it("returns the original update when a create response is lost and retried", async () => {
    const saved = {
      id: `update_${clientId}`, title: "New stay", content: "Available now",
      images: [`https://res.cloudinary.com/demo/image/upload/v123/${publicId}.jpg`],
      videos: [], createdAt: new Date(), updatedAt: new Date(),
    };
    mocks.siteUpdate.create.mockRejectedValueOnce({ code: "P2002" });
    mocks.siteUpdate.findUnique.mockResolvedValueOnce(saved);
    const response = await request(app()).post("/api/admin/updates").send({
      clientId, title: "New stay", content: "Available now", images: [image], videos: [],
    }).expect(200);
    expect(response.body.id).toBe(saved.id);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("keeps saved images by index without sending base64 data back through the proxy", async () => {
    const legacyImage = "data:image/jpeg;base64,abc";
    mocks.siteUpdate.findUnique.mockResolvedValue({
      id: "update_existing", title: "Old", content: "Old", images: [legacyImage],
      videos: [], createdAt: new Date(), updatedAt: new Date(),
    });
    await request(app()).put("/api/admin/updates/update_existing").send({
      title: "Revised", content: "Still here", retainedImageIndexes: [0], images: [], videos: [],
    }).expect(200);
    expect(mocks.siteUpdate.update).toHaveBeenCalledWith({
      where: { id: "update_existing" },
      data: { title: "Revised", content: "Still here", images: [legacyImage], videos: [] },
    });
  });
});
