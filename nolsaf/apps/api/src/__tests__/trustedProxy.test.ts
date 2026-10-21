import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureTrustProxy } from "../security.js";

afterEach(() => vi.unstubAllEnvs());

function ipApp() {
  const app = express();
  configureTrustProxy(app);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe("production client IP behind ALB and nginx", () => {
  it("uses the address appended by the ALB, not the ALB private address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await request(ipApp())
      .get("/ip")
      .set("X-Forwarded-For", "203.0.113.10, 172.31.45.31")
      .expect(200);
    expect(response.body.ip).toBe("203.0.113.10");
  });

  it("ignores a client-supplied address before the ALB-appended address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await request(ipApp())
      .get("/ip")
      .set("X-Forwarded-For", "198.51.100.99, 203.0.113.10, 172.31.45.31")
      .expect(200);
    expect(response.body.ip).toBe("203.0.113.10");
  });
});
