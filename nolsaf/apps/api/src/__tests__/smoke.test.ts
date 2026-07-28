import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app: any;
const testRunIpPrefix = (process.pid % 65_535).toString(16);

beforeAll(async () => {
  // Ensure the API entrypoint does not bind to a port.
  process.env.NODE_ENV = "test";
  const mod = await import("../index");
  app = (mod as any).app;
}, 30000);

describe("API smoke", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"] || "").toContain("application/json");
    expect(res.body).toHaveProperty("error");
  });

  it("does not disclose Express through the X-Powered-By header", async () => {
    const res = await request(app).get("/definitely-not-a-route");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects non-string login credentials before authentication work", async () => {
    const res = await request(app)
      .post("/api/auth/login-password")
      .set("X-Forwarded-For", `2001:db8:${testRunIpPrefix}::31`)
      .send({ email: { injected: true }, password: ["not", "text"] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_login_input" });
  });

  it("rejects oversized login credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login-password")
      .set("X-Forwarded-For", `2001:db8:${testRunIpPrefix}::32`)
      .send({ email: `${"a".repeat(321)}@example.com`, password: "test-password" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_login_input" });
  });

  it("keeps the placeholder codes search endpoint reachable", async () => {
    const res = await request(app).post("/codes/search").send({ q: "abc" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });

  it("mounts admin updates endpoints (unauthenticated request is rejected)", async () => {
    const res = await request(app).get("/api/admin/updates");
    expect([401, 403]).toContain(res.status);
  });

  it("mounts cloudinary signer endpoint (unauthenticated request is rejected)", async () => {
    const res = await request(app).get("/api/uploads/cloudinary/sign?folder=test");
    expect([401, 403]).toContain(res.status);
  });

  it("mounts public updates endpoint (must not 404)", async () => {
    const res = await request(app).get("/api/public/updates");
    expect(res.status === 404).toBe(false);
    expect(res.headers["content-type"] || "").toContain("application/json");
  });

  it("mounts public trust partners endpoint (must not 404)", async () => {
    const res = await request(app).get("/api/admin/trust-partners/public");
    expect(res.status === 404).toBe(false);
    expect(res.headers["content-type"] || "").toContain("application/json");
  });

  it("mounts public properties endpoint (must not 404)", async () => {
    const res = await request(app).get("/api/public/properties");
    expect(res.status === 404).toBe(false);
    expect(res.headers["content-type"] || "").toContain("application/json");
  });

  it("mounts plan request endpoint (must not 404)", async () => {
    // Send an intentionally minimal/invalid payload; we only care that the route exists.
    const res = await request(app).post("/api/plan-request").send({});
    expect(res.status === 404).toBe(false);
    expect(res.headers["content-type"] || "").toContain("application/json");
  });
});
