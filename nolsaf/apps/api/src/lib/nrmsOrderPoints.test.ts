import { afterEach, describe, it, expect } from "vitest";
import {
  generateOrderPointToken,
  buildMenuUrl,
  isValidOrderPointType,
} from "./nrmsOrderPoints.js";

describe("nrmsOrderPoints", () => {
  describe("generateOrderPointToken", () => {
    it("returns a base64url string of 24 chars", () => {
      const token = generateOrderPointToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    });

    it("produces unique tokens", () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateOrderPointToken()));
      expect(tokens.size).toBe(50);
    });
  });

  describe("buildMenuUrl", () => {
    const envKeys = ["WEB_ORIGIN", "APP_ORIGIN", "APP_URL", "BASE_URL", "NEXT_PUBLIC_URL", "NODE_ENV"] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

    afterEach(() => {
      for (const key of envKeys) {
        const original = originalEnv[key];
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    });

    function clearConfiguredOrigins() {
      for (const key of envKeys.slice(0, -1)) delete process.env[key];
    }

    it("uses WEB_ORIGIN and removes a trailing slash", () => {
      process.env.WEB_ORIGIN = "http://localhost:3000/";
      process.env.BASE_URL = "https://legacy.example.com";
      expect(buildMenuUrl("abc123")).toBe("http://localhost:3000/menu/abc123");
    });

    it("uses the safe localhost web origin outside production when no origin is configured", () => {
      clearConfiguredOrigins();
      process.env.NODE_ENV = "development";
      expect(buildMenuUrl("abc123")).toBe("http://localhost:3000/menu/abc123");
    });

    it("fails closed in production when WEB_ORIGIN is missing", () => {
      clearConfiguredOrigins();
      process.env.NODE_ENV = "production";
      expect(() => buildMenuUrl("abc123")).toThrow("WEB_ORIGIN must be configured");
    });
  });

  describe("isValidOrderPointType", () => {
    it("accepts ROOM and TABLE", () => {
      expect(isValidOrderPointType("ROOM")).toBe(true);
      expect(isValidOrderPointType("TABLE")).toBe(true);
    });

    it("rejects invalid types", () => {
      expect(isValidOrderPointType("POOL")).toBe(false);
      expect(isValidOrderPointType("")).toBe(false);
    });
  });
});
