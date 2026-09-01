import { describe, expect, it, vi } from "vitest";

import { verifyMnoWalletForCheckout } from "./mnoPreflight.js";

function lookupResponse(overrides: Record<string, unknown> = {}) {
  return {
    name: "Verified Wallet",
    status: true,
    statusCode: 200,
    accountNumber: "255754123456",
    bankName: "Vodacom",
    ...overrides
  } as any;
}

describe("MNO checkout preflight", () => {
  it("rejects a foreign country code without calling name lookup", async () => {
    const nameLookup = vi.fn();

    const result = await verifyMnoWalletForCheckout(
      { phoneNumber: "+256772123456", provider: "Mpesa" },
      { nameLookup }
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_tanzania_mno_number" });
    expect(nameLookup).not.toHaveBeenCalled();
  });

  it("rejects a Tanzanian fixed-line number without calling name lookup", async () => {
    const nameLookup = vi.fn();

    const result = await verifyMnoWalletForCheckout(
      { phoneNumber: "+255222123456", provider: "Mpesa" },
      { nameLookup }
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_tanzania_mno_number" });
    expect(nameLookup).not.toHaveBeenCalled();
  });

  it("accepts matching provider aliases and canonical account number", async () => {
    const nameLookup = vi.fn(async () => lookupResponse());

    const result = await verifyMnoWalletForCheckout(
      { phoneNumber: "+255754123456", provider: "MPESA" },
      { nameLookup }
    );

    expect(result).toEqual({ ok: true, normalizedPhone: "+255754123456" });
    expect(nameLookup).toHaveBeenCalledWith({ bankName: "MPESA", accountNumber: "255754123456" });
  });

  it("blocks a selected-provider mismatch before checkout", async () => {
    const nameLookup = vi.fn(async () => lookupResponse({ bankName: "Yas" }));

    const result = await verifyMnoWalletForCheckout(
      { phoneNumber: "+255754123456", provider: "Mpesa" },
      { nameLookup }
    );

    expect(result).toMatchObject({ ok: false, status: 409, code: "mno_provider_mismatch" });
  });

  it("blocks a provider response for a different account number", async () => {
    const nameLookup = vi.fn(async () => lookupResponse({ accountNumber: "255754999999" }));

    const result = await verifyMnoWalletForCheckout(
      { phoneNumber: "+255754123456", provider: "Mpesa" },
      { nameLookup }
    );

    expect(result).toMatchObject({ ok: false, status: 409, code: "mno_wallet_not_verified" });
  });

  it("fails closed when lookup is unavailable, without initiating checkout", async () => {
    const nameLookup = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await verifyMnoWalletForCheckout(
      { phoneNumber: "+255754123456", provider: "Mpesa" },
      { nameLookup }
    );

    expect(result).toMatchObject({ ok: false, status: 503, code: "mno_verification_unavailable" });
    if (!result.ok) expect(result.message).toContain("No payment request was sent");
  });
});
