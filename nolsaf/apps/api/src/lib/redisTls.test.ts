import { describe, expect, it } from "vitest";
import { getRedisTlsOptions } from "./redisTls";

describe("Redis TLS options", () => {
  it("leaves non-TLS development URLs unchanged", () => {
    expect(getRedisTlsOptions("redis://localhost:6379")).toEqual({});
  });

  it("loads the complete Redis Cloud CA bundle for rediss URLs", () => {
    const options = getRedisTlsOptions("rediss://default:secret@example.db.redis.io:16379");
    const ca = options.tls?.ca;
    const text = Buffer.isBuffer(ca) ? ca.toString("utf8") : String(ca || "");

    expect(options.tls?.rejectUnauthorized).toBe(true);
    expect(options.tls?.servername).toBe("example.db.redis.io");
    expect((text.match(/-----BEGIN CERTIFICATE-----/g) || []).length).toBe(3);
  });
});
