import { describe, expect, it } from "vitest";
import {
  guardPackageItems, isRestorable, pruneRemovedPackages, removalNameConfirmed, withoutLivePackage,
  type RemovedPackage,
} from "./operatorPackageRemoval.js";

const pkg = (id: string, name = `Package ${id}`) => ({ id, name });
const removedEntry = (id: string, daysAgo = 1): RemovedPackage => ({
  item: pkg(id),
  removedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  removedByUserId: 1,
});

describe("operator package removal", () => {
  it("a save that leaves packages out does not delete them", () => {
    const out = guardPackageItems([pkg("a"), pkg("b"), pkg("c")], [pkg("a")], []);
    expect(out.items.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(out.keptIds).toEqual(["b", "c"]);
  });

  it("an empty or broken save cannot wipe the catalogue", () => {
    expect(guardPackageItems([pkg("a"), pkg("b")], [], []).items).toHaveLength(2);
    expect(guardPackageItems([pkg("a")], undefined, []).items).toHaveLength(1);
  });

  it("an older copy of the page cannot bring back a removed package", () => {
    const out = guardPackageItems([pkg("a")], [pkg("a"), pkg("gone")], [removedEntry("gone")]);
    expect(out.items.map((p) => p.id)).toEqual(["a"]);
    expect(out.droppedIds).toEqual(["gone"]);
  });

  it("keeps edits and new packages from the save", () => {
    const out = guardPackageItems([pkg("a", "Old")], [pkg("a", "New"), pkg("n")], []);
    expect(out.items).toEqual([pkg("a", "New"), pkg("n")]);
  });

  it("requires the typed name, ignoring case and spacing", () => {
    expect(removalNameConfirmed({ name: "Serengeti Essential" }, "  serengeti   essential ")).toBe(true);
    expect(removalNameConfirmed({ name: "Serengeti Essential" }, "Serengeti")).toBe(false);
    expect(removalNameConfirmed({ name: "Serengeti Essential" }, undefined)).toBe(false);
    expect(removalNameConfirmed({ name: "" }, "")).toBe(true);
  });

  it("takes the package out of the approved copy travellers see", () => {
    const profile = { approvedSnapshot: { packageItems: [pkg("a"), pkg("b")], companyName: "X" } };
    const out = withoutLivePackage(profile, "a");
    expect(out.liveItem).toEqual(pkg("a"));
    expect(out.approvedSnapshot?.packageItems).toEqual([pkg("b")]);
    expect(out.approvedSnapshot?.companyName).toBe("X");
    expect(withoutLivePackage({}, "a").liveItem).toBeNull();
  });

  it("keeps removed packages restorable for 30 days only", () => {
    expect(isRestorable(removedEntry("a", 29))).toBe(true);
    expect(isRestorable(removedEntry("a", 31))).toBe(false);
    const pruned = pruneRemovedPackages([removedEntry("old", 40), removedEntry("x", 2), removedEntry("y", 1)]);
    expect(pruned.map((e) => e.item.id)).toEqual(["y", "x"]);
  });
});
