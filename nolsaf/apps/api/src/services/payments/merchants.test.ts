import { describe, expect, it } from "vitest";

import { resolveMerchantLink, resolvePayableMerchant } from "./merchants.js";

const NOW = new Date("2026-09-04T10:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2027-01-01T00:00:00Z");

type Overrides = {
  links?: Array<{
    merchantId: number;
    outletId: number | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }>;
  merchant?: { id: number; status: string } | null;
  account?: { id: number; status: string; providerMerchantId: string | null } | null;
  capability?: { isEnabled: boolean } | null;
  wallets?: Array<{ id: number; providerWalletId: string; isDefault: boolean }>;
};

function fakeDb(overrides: Overrides = {}) {
  return {
    merchantPropertyLink: {
      findMany: async () =>
        overrides.links ?? [
          { merchantId: 7, outletId: null, effectiveFrom: PAST, effectiveTo: null },
        ],
    },
    merchantLegalEntity: {
      findUnique: async () =>
        overrides.merchant === undefined ? { id: 7, status: "ACTIVE" } : overrides.merchant,
    },
    merchantProviderAccount: {
      findUnique: async () =>
        overrides.account === undefined
          ? { id: 31, status: "ACTIVE", providerMerchantId: "PM-1" }
          : overrides.account,
    },
    merchantChannelCapability: {
      findUnique: async () =>
        overrides.capability === undefined ? { isEnabled: true } : overrides.capability,
    },
    merchantWallet: {
      findMany: async () =>
        overrides.wallets ?? [{ id: 44, providerWalletId: "PW-1", isDefault: true }],
    },
  };
}

const baseInput = {
  propertyId: 55,
  outletId: null,
  connectionId: 10,
  channel: "MNO" as const,
  currency: "TZS",
  at: NOW,
};

describe("merchant link selection", () => {
  it("prefers an outlet-scoped link over the property-wide one", async () => {
    const db = fakeDb({
      links: [
        { merchantId: 7, outletId: null, effectiveFrom: PAST, effectiveTo: null },
        { merchantId: 8, outletId: 91, effectiveFrom: PAST, effectiveTo: null },
      ],
    });
    const link = await resolveMerchantLink(db, { propertyId: 55, outletId: 91, at: NOW });
    expect(link).toEqual({ merchantId: 8 });
  });

  it("falls back to the property link when no outlet link exists", async () => {
    const db = fakeDb();
    expect(await resolveMerchantLink(db, { propertyId: 55, outletId: 91, at: NOW })).toEqual({
      merchantId: 7,
    });
  });

  it("ignores a link that has not started or has ended", async () => {
    const notStarted = fakeDb({
      links: [{ merchantId: 7, outletId: null, effectiveFrom: FUTURE, effectiveTo: null }],
    });
    const ended = fakeDb({
      links: [
        {
          merchantId: 7,
          outletId: null,
          effectiveFrom: PAST,
          effectiveTo: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    });
    expect(await resolveMerchantLink(notStarted, { propertyId: 55, at: NOW })).toBeNull();
    expect(await resolveMerchantLink(ended, { propertyId: 55, at: NOW })).toBeNull();
  });
});

describe("payable merchant resolution refuses rather than falling back", () => {
  it("resolves a fully configured merchant", async () => {
    const result = await resolvePayableMerchant(fakeDb(), baseInput);
    expect(result).toEqual({
      ok: true,
      merchant: {
        merchantId: 7,
        providerAccountId: 31,
        walletId: 44,
        providerMerchantId: "PM-1",
        providerWalletId: "PW-1",
      },
    });
  });

  it("refuses when the property has no merchant link", async () => {
    const result = await resolvePayableMerchant(fakeDb({ links: [] }), baseInput);
    expect(result).toMatchObject({ ok: false, code: "no_merchant_link" });
  });

  it("refuses when the merchant entity is not ACTIVE", async () => {
    const result = await resolvePayableMerchant(
      fakeDb({ merchant: { id: 7, status: "SUSPENDED" } }),
      baseInput
    );
    expect(result).toMatchObject({ ok: false, code: "merchant_not_active" });
  });

  it("refuses when there is no provider account for that connection", async () => {
    const result = await resolvePayableMerchant(fakeDb({ account: null }), baseInput);
    expect(result).toMatchObject({ ok: false, code: "no_provider_account" });
  });

  it("does not treat local admin approval as provider activation", async () => {
    for (const status of ["SUBMISSION_QUEUED", "PROVIDER_REVIEW", "PROVIDER_ACCOUNT_CREATED"]) {
      const result = await resolvePayableMerchant(
        fakeDb({ account: { id: 31, status, providerMerchantId: "PM-1" } }),
        baseInput
      );
      expect(result, `${status} must not be payable`).toMatchObject({
        ok: false,
        code: "provider_account_not_active",
      });
    }
  });

  it("refuses an unrecognised account status rather than comparing loosely", async () => {
    // A value added to the column later must not become payable before this
    // code knows what it means.
    const result = await resolvePayableMerchant(
      fakeDb({ account: { id: 31, status: "SOME_FUTURE_STATE", providerMerchantId: "PM-1" } }),
      baseInput
    );
    expect(result).toMatchObject({ ok: false, code: "provider_account_not_active" });
  });

  it("refuses when the channel is not enabled on that account", async () => {
    const disabled = await resolvePayableMerchant(
      fakeDb({ capability: { isEnabled: false } }),
      baseInput
    );
    const missing = await resolvePayableMerchant(fakeDb({ capability: null }), baseInput);
    expect(disabled).toMatchObject({ ok: false, code: "channel_not_enabled" });
    expect(missing).toMatchObject({ ok: false, code: "channel_not_enabled" });
  });

  it("refuses when no active wallet exists for the currency", async () => {
    const result = await resolvePayableMerchant(fakeDb({ wallets: [] }), baseInput);
    expect(result).toMatchObject({ ok: false, code: "no_wallet_for_currency" });
  });

  it("refuses an ACTIVE account whose provider identifiers are missing", async () => {
    // Activation without identifiers means the callback did not carry what it
    // should have, so the destination would be a guess.
    const result = await resolvePayableMerchant(
      fakeDb({ account: { id: 31, status: "ACTIVE", providerMerchantId: null } }),
      baseInput
    );
    expect(result).toMatchObject({ ok: false, code: "provider_identifiers_missing" });
  });

  it("gives every refusal the same payer-facing message", async () => {
    const results = await Promise.all([
      resolvePayableMerchant(fakeDb({ links: [] }), baseInput),
      resolvePayableMerchant(fakeDb({ merchant: { id: 7, status: "CLOSED" } }), baseInput),
      resolvePayableMerchant(fakeDb({ wallets: [] }), baseInput),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe("Online payment is not available for this property.");
      }
    }
  });
});
