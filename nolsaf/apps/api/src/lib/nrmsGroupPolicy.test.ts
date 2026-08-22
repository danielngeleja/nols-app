import { describe, expect, it } from "vitest";
import { qualifyGroupBlock } from "./nrmsGroupPolicy.js";

describe("NRMS group qualification", () => {
  it("routes a one-room stay to normal reservations", () => {
    expect(qualifyGroupBlock(1)).toMatchObject({ ok: false, code: "SINGLE_ROOM_NOT_GROUP" });
  });

  it("requires an explicit reason for a two-to-four-room contracted party", () => {
    expect(qualifyGroupBlock(4)).toMatchObject({ ok: false, code: "GROUP_MINIMUM_NOT_MET" });
    expect(qualifyGroupBlock(4, "VIP")).toMatchObject({ ok: false, code: "SMALL_GROUP_APPROVAL_REASON_REQUIRED" });
  });

  it("accepts an approved small group and preserves its reason", () => {
    expect(qualifyGroupBlock(3, "Tour operator contract")).toEqual({
      ok: true,
      classification: "APPROVED_SMALL",
      approvalReason: "Tour operator contract",
    });
  });

  it("accepts five or more rooms without an exception", () => {
    expect(qualifyGroupBlock(5)).toEqual({ ok: true, classification: "STANDARD", approvalReason: null });
  });
});
