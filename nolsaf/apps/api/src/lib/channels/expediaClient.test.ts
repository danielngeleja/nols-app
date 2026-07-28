import { describe, expect, it, vi } from "vitest";
import { ExpediaApiError, ExpediaClient } from "./expediaClient.js";

describe("Expedia lodging supply client", () => {
  it("uses Basic OAuth and reuses the access token", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "token", expires_in: 1800, token_type: "Bearer" }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new ExpediaClient(fetcher as typeof fetch, { tokenUrl: "https://example.test/token" });
    await client.exchangeToken({ username: "EQC-user", password: "secret" });
    await client.exchangeToken({ username: "EQC-user", password: "secret" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0]![1] as RequestInit;
    expect((request.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("EQC-user:secret").toString("base64")}`);
    expect(request.body).toBe("grant_type=client_credentials");
  });

  it("treats GraphQL errors returned with HTTP 200 as failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "Too many requests", extensions: { code: "RATE_LIMIT_EXCEEDED" } }] }), { status: 200 }));
    const client = new ExpediaClient(fetcher as typeof fetch, { graphqlUrl: "https://example.test/graphql" });
    await expect(client.graphql("token", "query { property(id: \"1\") { id } }", {})).rejects.toMatchObject({ providerCode: "RATE_LIMIT_EXCEEDED", retryable: true });
  });

  it("does not invent a production ARI endpoint", async () => {
    const client = new ExpediaClient(vi.fn() as unknown as typeof fetch, { ariUrl: "" });
    await expect(client.updateAvailability({ username: "u", password: "p" }, "<AvailRateUpdateRQ/>")).rejects.toMatchObject({ providerCode: "ARI_ENDPOINT_MISSING" });
  });
});
