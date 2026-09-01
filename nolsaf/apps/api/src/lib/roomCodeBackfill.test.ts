import { describe, expect, it } from "vitest";

import {
  buildRoomCodeBackfillPlan,
  resolveRoomCodeForBackfill,
} from "./roomCodeBackfill.js";

describe("room code backfill planning", () => {
  it("updates a bare legacy code when there is exactly one target", () => {
    const before = [{ roomType: "Single", beds: { queen: 1 } }];
    const after = [{ ...before[0], code: "Single 1 Queen" }];

    expect(resolveRoomCodeForBackfill("Single", before, after)).toEqual({
      status: "update",
      code: "Single 1 Queen",
      reason: "unique_legacy_room_type",
    });
  });

  it("blocks an ambiguous live reference instead of guessing a variant", () => {
    const plan = buildRoomCodeBackfillPlan({
      roomsSpec: [
        { roomType: "Single", beds: { queen: 1 } },
        { roomType: "Single", beds: { king: 1 } },
      ],
      references: [
        { kind: "booking", id: 17, roomCode: "Single", active: true },
      ],
    });

    expect(plan.activeBlockers).toHaveLength(1);
    expect(plan.activeBlockers[0].resolution).toMatchObject({
      status: "ambiguous",
      candidates: ["Single 1 Queen", "Single 1 King"],
    });
    expect(plan.updates).toHaveLength(0);
  });

  it("reports but does not block an ambiguous historical reference", () => {
    const plan = buildRoomCodeBackfillPlan({
      roomsSpec: [
        { roomType: "Double", beds: { queen: 1 } },
        { roomType: "Double", beds: { king: 1 } },
      ],
      references: [
        { kind: "booking", id: 20, roomCode: "Double", active: false },
      ],
    });

    expect(plan.activeBlockers).toHaveLength(0);
    expect(plan.unresolvedHistorical).toHaveLength(1);
  });

  it("maps legacy numeric selections to the same array entry", () => {
    const plan = buildRoomCodeBackfillPlan({
      roomsSpec: [
        { roomType: "Twin", beds: { twin: 2 } },
        { roomType: "Suite", beds: { king: 1 } },
      ],
      references: [
        { kind: "booking", id: 21, roomCode: "1", active: true },
      ],
    });

    expect(plan.updates[0].targetCode).toBe("Suite 1 King");
    expect(plan.activeBlockers).toHaveLength(0);
  });

  it("never rewrites a real physical room unit code", () => {
    const result = resolveRoomCodeForBackfill(
      "Suite-2",
      [{ roomType: "Suite", beds: { king: 1 } }],
      [{ roomType: "Suite", beds: { king: 1 }, code: "Suite 1 King" }],
      ["Suite-2"],
    );

    expect(result).toEqual({
      status: "unchanged",
      code: "Suite-2",
      reason: "physical_room_unit",
    });
  });

  it("is idempotent after codes and references are already migrated", () => {
    const roomsSpec = [{ roomType: "Family", beds: { queen: 2 }, code: "Family 2 Queen" }];
    const plan = buildRoomCodeBackfillPlan({
      roomsSpec,
      references: [
        { kind: "availabilityBlock", id: 4, roomCode: "Family 2 Queen", active: true },
      ],
    });

    expect(plan.roomsSpecChanged).toBe(false);
    expect(plan.updates).toHaveLength(0);
    expect(plan.activeBlockers).toHaveLength(0);
  });
});
