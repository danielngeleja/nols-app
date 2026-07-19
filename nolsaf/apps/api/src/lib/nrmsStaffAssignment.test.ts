import { describe, expect, it } from "vitest";
import { nrmsAssignmentNeedsConfirmation } from "./nrmsStaffAssignment.js";

describe("NRMS staff assignment confirmation policy", () => {
  it("requires confirmation for new, pending, and disabled assignments", () => {
    expect(nrmsAssignmentNeedsConfirmation(null, "BAR", 4)).toBe(true);
    expect(nrmsAssignmentNeedsConfirmation({ status: "PENDING", role: "BAR", outletId: 4 }, "BAR", 4)).toBe(true);
    expect(nrmsAssignmentNeedsConfirmation({ status: "DISABLED", role: "BAR", outletId: 4 }, "BAR", 4)).toBe(true);
  });

  it("keeps an identical active assignment idempotent", () => {
    expect(nrmsAssignmentNeedsConfirmation({ status: "ACTIVE", role: "BAR", outletId: 4 }, "BAR", 4)).toBe(false);
  });

  it("requires fresh agreement when the role or work area changes", () => {
    const active = { status: "ACTIVE", role: "BAR", outletId: 4 };

    expect(nrmsAssignmentNeedsConfirmation(active, "MANAGER", null)).toBe(true);
    expect(nrmsAssignmentNeedsConfirmation(active, "BAR", 7)).toBe(true);
  });
});
