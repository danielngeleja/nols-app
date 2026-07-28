import { describe, expect, it } from "vitest";
import { csrfProtection, csrfTokenHeader } from "../middleware/csrf";
import { canAccessBookingInvoice } from "../routes/public.invoices";

describe("invoice access authorization", () => {
  const booking = { userId: 22, property: { ownerId: 44 } };

  it("does not treat authentication alone as authority over a booking invoice", () => {
    expect(canAccessBookingInvoice({ id: 11, role: "USER" }, booking, false)).toBe(false);
    expect(canAccessBookingInvoice({ id: 22, role: "USER" }, booking, false)).toBe(true);
    expect(canAccessBookingInvoice({ id: 44, role: "OWNER" }, booking, false)).toBe(true);
    expect(canAccessBookingInvoice({ id: 99, role: "ADMIN" }, booking, false)).toBe(true);
    expect(canAccessBookingInvoice({ id: 11, role: "USER" }, booking, true)).toBe(true);
  });
});

describe("CSRF proxy handling", () => {
  function createResponseCapture() {
    let statusCode: number | undefined;
    let payload: unknown;
    const variedHeaders: string[] = [];
    const res: any = {
      vary(name: string) { variedHeaders.push(name); return this; },
      status(code: number) { statusCode = code; return this; },
      json(body: unknown) { payload = body; return this; },
    };
    return {
      res,
      get statusCode() { return statusCode; },
      get payload() { return payload; },
      variedHeaders,
    };
  }

  it("binds CSRF to the same auth cookie regardless of Cookie header order", async () => {
    let issuedToken = "";
    const getReq: any = {
      method: "GET",
      headers: { cookie: "token=legacy-token; nolsaf_token=primary-token" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get: () => "test-agent",
    };
    const getRes: any = { setHeader(_name: string, value: string) { issuedToken = value; } };
    await csrfTokenHeader(getReq, getRes, () => undefined);

    const postReq: any = {
      method: "POST",
      path: "/api/nrms/operations/rooms/7/housekeeping-status",
      headers: { cookie: "nolsaf_token=primary-token; token=legacy-token", "x-csrf-token": issuedToken },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get: () => "",
    };
    const postRes: any = { vary() { return this; }, status() { return this; }, json() { return this; } };
    let nextCalled = false;
    await csrfProtection(postReq, postRes, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("fails closed when a cookie-authenticated mutation has neither a token nor origin metadata", async () => {
    const req: any = {
      method: "POST",
      path: "/api/account/profile",
      headers: { cookie: "nolsaf_token=test-token" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get: () => "",
    };
    const capture = createResponseCapture();
    let nextCalled = false;

    await csrfProtection(req, capture.res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(capture.statusCode).toBe(403);
    expect(capture.payload).toMatchObject({
      error: "CSRF token missing",
      code: "CSRF_TOKEN_MISSING",
    });
    expect(capture.variedHeaders).toEqual(["Sec-Fetch-Site", "Origin"]);
  });

  it("allows a tokenless mutation only with positive same-origin browser metadata", async () => {
    const req: any = {
      method: "POST",
      path: "/api/account/profile",
      headers: { cookie: "nolsaf_token=test-token" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get(name: string) {
        const headers: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          host: "app.nolsaf.test",
        };
        return headers[name.toLowerCase()] || "";
      },
    };
    const capture = createResponseCapture();
    let nextCalled = false;

    await csrfProtection(req, capture.res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(capture.statusCode).toBeUndefined();
  });

  it("allows the Origin/Referer fallback only when it exactly matches the target origin", async () => {
    const req: any = {
      method: "POST",
      path: "/api/account/profile",
      headers: { cookie: "nolsaf_token=test-token" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get(name: string) {
        const headers: Record<string, string> = {
          origin: "https://app.nolsaf.test",
          host: "app.nolsaf.test",
        };
        return headers[name.toLowerCase()] || "";
      },
    };
    const capture = createResponseCapture();
    let nextCalled = false;

    await csrfProtection(req, capture.res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(capture.statusCode).toBeUndefined();
  });

  it("does not trust same-site metadata without a matching Origin or Referer", async () => {
    const req: any = {
      method: "POST",
      path: "/api/account/profile",
      headers: { cookie: "nolsaf_token=test-token" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get(name: string) {
        const headers: Record<string, string> = {
          "sec-fetch-site": "same-site",
          host: "app.nolsaf.test",
        };
        return headers[name.toLowerCase()] || "";
      },
    };
    const capture = createResponseCapture();
    let nextCalled = false;

    await csrfProtection(req, capture.res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(capture.statusCode).toBe(403);
  });

  it("does not let a proxy marker bypass cross-site cookie CSRF protection", async () => {
    const req: any = {
      method: "POST",
      path: "/api/account/profile",
      headers: {
        cookie: "nolsaf_token=test-token",
        "x-proxy-secret": "test-proxy-marker",
      },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get(name: string) {
        const headers: Record<string, string> = {
          "sec-fetch-site": "cross-site",
          origin: "https://attacker.invalid",
          host: "api.nolsaf.test",
        };
        return headers[name.toLowerCase()] || "";
      },
    };
    const capture = createResponseCapture();
    let nextCalled = false;

    await csrfProtection(req, capture.res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(capture.statusCode).toBe(403);
    expect(capture.payload).toMatchObject({ error: "CSRF token missing" });
  });
});
