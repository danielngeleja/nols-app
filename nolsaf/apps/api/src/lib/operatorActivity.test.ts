import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { gradeDown, gradeUp, maskAccount, worst } from "./operatorActivity.js";

describe("operator behaviour grading", () => {
  it("grades counts where more is worse", () => {
    expect(gradeUp(0, 1, 3)).toBe("CLEAN");
    expect(gradeUp(1, 1, 3)).toBe("WATCH");
    expect(gradeUp(3, 1, 3)).toBe("ACTION");
  });

  it("grades rates where less is worse", () => {
    expect(gradeDown(0.9, 0.7, 0.4)).toBe("CLEAN");
    expect(gradeDown(0.6, 0.7, 0.4)).toBe("WATCH");
    expect(gradeDown(0.3, 0.7, 0.4)).toBe("ACTION");
  });

  it("rolls signals up to the worst band", () => {
    expect(worst([])).toBe("CLEAN");
    expect(worst(["CLEAN", "WATCH", "CLEAN"])).toBe("WATCH");
    expect(worst(["WATCH", "ACTION"])).toBe("ACTION");
  });

  it("never shows more than the last four digits of a payout number", () => {
    expect(maskAccount("255 712 345 678")).toBe("****5678");
    expect(maskAccount("")).toBe("");
    expect(maskAccount(null)).toBe("");
  });
});
