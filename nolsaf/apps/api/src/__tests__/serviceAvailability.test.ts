import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  transportFindFirst: vi.fn(),
  transportFindUnique: vi.fn(),
  transportFindMany: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    transportAvailability: {
      findFirst: db.transportFindFirst,
      findUnique: db.transportFindUnique,
      findMany: db.transportFindMany,
    },
    paymentMethodAvailability: {
      findFirst: db.paymentFindFirst,
      findUnique: db.paymentFindUnique,
      findMany: db.paymentFindMany,
    },
  },
}));

async function loadGateModule() {
  vi.resetModules();
  return import("../lib/serviceAvailability.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.transportFindFirst.mockResolvedValue({ id: 1 });
  db.transportFindUnique.mockResolvedValue(null);
  db.transportFindMany.mockResolvedValue([]);
  db.paymentFindFirst.mockResolvedValue({ id: 1 });
  db.paymentFindUnique.mockResolvedValue(null);
  db.paymentFindMany.mockResolvedValue([]);
});

describe("transport service availability", () => {
  it("uses ward, then district, then region precedence", async () => {
    const { getTransportAvailability } = await loadGateModule();

    db.transportFindUnique.mockImplementation(async ({ where }: any) => {
      const scope = where.regionName_district_ward;
      if (scope.ward === "Kijitonyama") {
        return { isEnabled: false, reason: "Ward paused" };
      }
      if (scope.district === "Kinondoni") {
        return { isEnabled: true, reason: null };
      }
      return { isEnabled: true, reason: null };
    });

    await expect(getTransportAvailability({
      regionName: "Dar es Salaam",
      district: "Kinondoni",
      ward: "Kijitonyama",
    })).resolves.toEqual({ enabled: false, reason: "Ward paused" });

    expect(db.transportFindUnique).toHaveBeenCalledTimes(1);
    expect(db.transportFindUnique).toHaveBeenCalledWith({
      where: {
        regionName_district_ward: {
          regionName: "Dar es Salaam",
          district: "Kinondoni",
          ward: "Kijitonyama",
        },
      },
    });
  });

  it("falls back from a missing ward to its district before the region", async () => {
    const { getTransportAvailability } = await loadGateModule();

    db.transportFindUnique.mockImplementation(async ({ where }: any) => {
      const scope = where.regionName_district_ward;
      if (scope.ward) return null;
      if (scope.district) return { isEnabled: false, reason: "District paused" };
      return { isEnabled: true, reason: null };
    });

    await expect(getTransportAvailability({
      regionName: "Dar es Salaam",
      district: "Kinondoni",
      ward: "Kijitonyama",
    })).resolves.toEqual({ enabled: false, reason: "District paused" });

    expect(db.transportFindUnique.mock.calls.map(([arg]) => arg.where.regionName_district_ward)).toEqual([
      { regionName: "Dar es Salaam", district: "Kinondoni", ward: "Kijitonyama" },
      { regionName: "Dar es Salaam", district: "Kinondoni", ward: "" },
    ]);
  });

  it("falls back to the region when ward and district rows are absent", async () => {
    const { getTransportAvailability } = await loadGateModule();

    db.transportFindUnique.mockImplementation(async ({ where }: any) => {
      const scope = where.regionName_district_ward;
      return scope.district === "" && scope.ward === ""
        ? { isEnabled: true, reason: null }
        : null;
    });

    await expect(getTransportAvailability({
      regionName: "Dar es Salaam",
      district: "Kinondoni",
      ward: "Kijitonyama",
    })).resolves.toEqual({ enabled: true, reason: null });

    expect(db.transportFindUnique.mock.calls.map(([arg]) => arg.where.regionName_district_ward)).toEqual([
      { regionName: "Dar es Salaam", district: "Kinondoni", ward: "Kijitonyama" },
      { regionName: "Dar es Salaam", district: "Kinondoni", ward: "" },
      { regionName: "Dar es Salaam", district: "", ward: "" },
    ]);
  });

  it("locks a mapped property when the table exists but no row matches", async () => {
    const { getTransportAvailability } = await loadGateModule();

    await expect(getTransportAvailability({ regionName: "Arusha" })).resolves.toMatchObject({
      enabled: false,
    });
  });

  it("locks a property whose region is blank once the table exists", async () => {
    const { getTransportAvailability } = await loadGateModule();

    await expect(getTransportAvailability({ regionName: "  " })).resolves.toMatchObject({
      enabled: false,
    });
    expect(db.transportFindUnique).not.toHaveBeenCalled();
  });

  it("fails open before migration and re-probes successfully without a restart", async () => {
    const { getTransportAvailability } = await loadGateModule();
    db.transportFindFirst
      .mockRejectedValueOnce({ code: "P2021", message: "table does not exist" })
      .mockResolvedValueOnce({ id: 1 });

    await expect(getTransportAvailability({ regionName: "Arusha" })).resolves.toEqual({
      enabled: true,
      reason: null,
    });
    await expect(getTransportAvailability({ regionName: "Arusha" })).resolves.toMatchObject({
      enabled: false,
    });

    expect(db.transportFindFirst).toHaveBeenCalledTimes(2);
  });
});

describe("payment method service availability", () => {
  it("defaults an unconfigured provider to enabled", async () => {
    const { getPaymentMethodAvailability } = await loadGateModule();

    await expect(getPaymentMethodAvailability("Airtel")).resolves.toEqual({
      enabled: true,
      reason: null,
    });
  });

  it("keeps catalogued but unpublished banks disabled even before their seed row exists", async () => {
    const { getPaymentMethodAvailability } = await loadGateModule();

    await expect(getPaymentMethodAvailability("BANK_NBC")).resolves.toEqual({
      enabled: false,
      reason: "This payment method is not configured for checkout yet.",
    });
  });

  it("fails open before the payment gate table is migrated", async () => {
    const { getPaymentMethodAvailability } = await loadGateModule();
    db.paymentFindFirst.mockRejectedValueOnce({ code: "P2021", message: "table does not exist" });

    await expect(getPaymentMethodAvailability("CARD")).resolves.toEqual({
      enabled: true,
      reason: null,
    });
  });

  it("returns a disabled configured provider with its reason", async () => {
    const { getPaymentMethodAvailability } = await loadGateModule();
    db.paymentFindUnique.mockResolvedValue({
      isEnabled: false,
      reason: "Provider maintenance",
    });

    await expect(getPaymentMethodAvailability("CARD")).resolves.toEqual({
      enabled: false,
      reason: "Provider maintenance",
    });
  });

  it("keeps disabled methods in the public list instead of filtering them out", async () => {
    const { listPaymentMethodAvailability } = await loadGateModule();
    db.paymentFindMany.mockResolvedValue([
      { provider: "CARD", label: "Debit / Credit Card", isEnabled: false, reason: "Maintenance" },
    ]);

    const methods = await listPaymentMethodAvailability();

    expect(methods.find((method) => method.provider === "CARD")).toEqual({
      provider: "CARD",
      label: "Debit / Credit Card",
      isEnabled: false,
      reason: "Maintenance",
    });
  });
});
