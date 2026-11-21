import { describe, expect, it } from "vitest";
import {
  canTransition,
  occupiesHome,
  TENANCY_STATUSES,
  tenancyTransitionUpdate,
  TenancyTransitionError,
  type TenancyActor,
} from "./tenancyState.js";

const ACTORS: TenancyActor[] = ["TENANT", "LANDLORD", "ADMIN", "SYSTEM"];

describe("tenancy state machine", () => {
  it("walks the happy path, each step by the right side", () => {
    const path: Array<[string, string, TenancyActor]> = [
      ["OFFERED", "ACCEPTED", "LANDLORD"],
      ["ACCEPTED", "AWAITING_PAYMENT", "SYSTEM"],
      ["AWAITING_PAYMENT", "RESERVED", "SYSTEM"],
      ["RESERVED", "MOVE_IN", "SYSTEM"],
      ["MOVE_IN", "ACTIVE", "SYSTEM"],
      ["ACTIVE", "ENDING", "TENANT"],
      ["ENDING", "ENDED", "SYSTEM"],
    ];
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor), `${from}->${to} by ${actor}`).toBe(true);
  });

  it("only the system can mark a tenancy paid, and only from awaiting payment", () => {
    for (const actor of ["TENANT", "LANDLORD", "ADMIN"] as TenancyActor[]) {
      expect(canTransition("AWAITING_PAYMENT", "RESERVED", actor)).toBe(false);
    }
    for (const from of TENANCY_STATUSES.filter((s) => s !== "AWAITING_PAYMENT" && s !== "DISPUTED")) {
      expect(canTransition(from, "RESERVED", "SYSTEM"), from).toBe(false);
    }
  });

  it("no side accepts its own offer or skips the lease", () => {
    expect(canTransition("OFFERED", "ACCEPTED", "TENANT")).toBe(false);
    expect(canTransition("OFFERED", "ACCEPTED", "ADMIN")).toBe(false);
    expect(canTransition("OFFERED", "CANCELLED", "SYSTEM")).toBe(true);
    expect(canTransition("OFFERED", "AWAITING_PAYMENT", "SYSTEM")).toBe(false);
    expect(canTransition("ACCEPTED", "AWAITING_PAYMENT", "LANDLORD")).toBe(false);
  });

  it("only an admin resolves a dispute", () => {
    for (const to of TENANCY_STATUSES) {
      expect(canTransition("DISPUTED", to, "TENANT")).toBe(false);
      expect(canTransition("DISPUTED", to, "LANDLORD")).toBe(false);
      expect(canTransition("DISPUTED", to, "SYSTEM")).toBe(false);
    }
    expect(canTransition("DISPUTED", "CANCELLED", "ADMIN")).toBe(true);
  });

  it("once money is held, the parties cannot cancel after move-in day", () => {
    expect(canTransition("RESERVED", "CANCELLED", "TENANT")).toBe(true);
    expect(canTransition("MOVE_IN", "CANCELLED", "TENANT")).toBe(false);
    expect(canTransition("MOVE_IN", "CANCELLED", "LANDLORD")).toBe(false);
  });

  it("ended and cancelled are final", () => {
    for (const to of TENANCY_STATUSES) for (const actor of ACTORS) {
      expect(canTransition("ENDED", to, actor)).toBe(false);
      expect(canTransition("CANCELLED", to, actor)).toBe(false);
    }
  });

  it("refuses unknown statuses", () => {
    expect(canTransition("PAID", "RESERVED", "SYSTEM")).toBe(false);
    expect(canTransition("REQUESTED", "OFFERED", "TENANT")).toBe(false);
    expect(canTransition("OFFERED", "HACKED", "ADMIN")).toBe(false);
  });

  it("builds a compare-and-set update and refuses an illegal one", () => {
    const update = tenancyTransitionUpdate({ id: 9, status: "OFFERED", version: 3 }, "ACCEPTED", "LANDLORD", { leaseHash: "h" });
    expect(update).toEqual({
      where: { id: 9, status: "OFFERED", version: 3 },
      data: { leaseHash: "h", status: "ACCEPTED", version: { increment: 1 } },
    });
    expect(() => tenancyTransitionUpdate({ id: 9, status: "OFFERED", version: 3 }, "RESERVED", "TENANT")).toThrow(TenancyTransitionError);
  });

  it("reserved and let homes are occupied; requests and offers are not", () => {
    expect(occupiesHome("RESERVED")).toBe(true);
    expect(occupiesHome("ACTIVE")).toBe(true);
    expect(occupiesHome("OFFERED")).toBe(false);
    expect(occupiesHome("CANCELLED")).toBe(false);
  });
});
