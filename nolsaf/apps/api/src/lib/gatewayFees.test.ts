import { describe, expect, it } from "vitest";
import { DEFAULT_GATEWAY_FEE_RATES, channelOf, estimateGatewayFees, normalizeFeeRates } from "./gatewayFees.js";

describe("gateway fees", () => {
  it("sorts stored payment methods into channels", () => {
    expect(channelOf("CARD")).toBe("CARD");
    expect(channelOf("visa")).toBe("CARD");
    expect(channelOf("BANK_CRDB")).toBe("BANK");
    expect(channelOf("NMB")).toBe("BANK");
    expect(channelOf("MPESA")).toBe("MNO");
    expect(channelOf(null)).toBe("MNO");
  });

  it("estimates per channel and charges unattributed GMV at the mobile money rate", () => {
    const e = estimateGatewayFees({ MNO: 1_000_000, BANK: 200_000, CARD: 100_000 }, 400_000, DEFAULT_GATEWAY_FEE_RATES);
    expect(e.lines.find((l) => l.channel === "MNO")?.fee).toBe(35_000); // 2.5% of 1.4M
    expect(e.lines.find((l) => l.channel === "BANK")?.fee).toBe(5_000);
    expect(e.lines.find((l) => l.channel === "CARD")?.fee).toBe(2_900);
    expect(e.total).toBe(42_900);
  });

  it("falls back to AzamPay defaults field by field", () => {
    expect(normalizeFeeRates({ CARD: 3.1 })).toEqual({ provider: "AzamPay", MNO: 2.5, BANK: 2.5, CARD: 3.1 });
    expect(normalizeFeeRates({ MNO: 99 }).MNO).toBe(2.5);
  });
});
