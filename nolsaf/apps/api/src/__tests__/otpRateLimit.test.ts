import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { limitOtpSend } from "../middleware/rateLimit";

describe("OTP send rate limit", () => {
  it("returns a structured retry response after three requests", async () => {
    const app = express();
    app.use(express.json());
    app.post("/send", limitOtpSend, (_req, res) => res.json({ ok: true }));

    const phone = `+255700${Date.now().toString().slice(-6)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app).post("/send").send({ phone });
      expect(response.status).toBe(200);
    }

    const limited = await request(app).post("/send").send({ phone });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: "rate_limited",
      error: "Too many OTP requests. Please wait before requesting another code.",
      message: "Too many OTP requests. Please wait before requesting another code.",
    });
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.body.retryAfterMs).toBeGreaterThan(0);
    expect(limited.body.cooldownUntil).toBeGreaterThan(Date.now());
  });
});
