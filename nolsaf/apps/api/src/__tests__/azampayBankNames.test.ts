import { describe, expect, it } from "vitest";
import { parseBankNames } from "../services/azampay/disbursement/client.js";

describe("AzamPay bank directory", () => {
  it("keeps exact bank names and excludes inactive banks and wallet entries", () => {
    expect(parseBankNames({ data: [
      { bankName: "A Long Bank Name With More Than Thirty Characters" },
      { bankName: "Unavailable", isActive: false }, "Azampesa", "Example", "Example",
    ] })).toEqual(["A Long Bank Name With More Than Thirty Characters", "Example"]);
  });
  it("accepts an empty directory and rejects errors and ambiguous identifiers", () => {
    expect(parseBankNames([])).toEqual([]);
    expect(() => parseBankNames({ success: false, data: ["Example"] })).toThrow();
    expect(() => parseBankNames([{ name: "Display name", code: "123" }])).toThrow();
  });
});
