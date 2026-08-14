import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/redis.js", () => ({ getRedis: () => null }));

import { getAzamPayDisburseToken } from "../services/azampay/disbursement/auth";

describe("AzamPay disbursement token generation", () => {
  beforeEach(() => {
    vi.stubEnv("AZAMPAY_DISBURSE_APP_NAME", "NoLSAF");
    vi.stubEnv("AZAMPAY_DISBURSE_CLIENT_ID", "client-id");
    vi.stubEnv("AZAMPAY_DISBURSE_CLIENT_SECRET", "client-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the documented GenerateToken endpoint and request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { accessToken: "access-token", expire: Date.now() + 3_600_000 },
          message: "Token generated successfully",
          success: true,
          statusCode: 200,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAzamPayDisburseToken()).resolves.toBe("access-token");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://authenticator-sandbox.azampay.co.tz/AppRegistration/GenerateToken");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      appName: "NoLSAF",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });
});
