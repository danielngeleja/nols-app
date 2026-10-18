import { describe, expect, it } from "vitest";
import { buildPhotoTourSections } from "./photoTour";

describe("buildPhotoTourSections", () => {
  it("keeps an unclassified listing as one photo tour section", () => {
    expect(buildPhotoTourSections(["cover", "lobby"], [])).toEqual([
      { title: "Photos", imageIndexes: [0, 1] }
    ]);
  });

  it("groups known room photos without requiring labels for every image", () => {
    expect(buildPhotoTourSections(["cover", "lobby", "suite-1", "suite-2", "twin"], [
      { roomType: "Suite", roomImages: ["suite-1", "suite-2"] },
      { roomType: "Twin", roomImages: ["twin"] }
    ])).toEqual([
      { title: "Property photos", imageIndexes: [0, 1] },
      { title: "Suite", imageIndexes: [2, 3] },
      { title: "Twin", imageIndexes: [4] }
    ]);
  });

  it("shows duplicate and unlabeled room references only once", () => {
    expect(buildPhotoTourSections(["cover", "room-a", "room-b"], [
      { roomImages: ["room-a", "room-a", "missing"] },
      { roomImages: ["room-b", "room-a"] }
    ])).toEqual([
      { title: "Property photos", imageIndexes: [0] },
      { title: "Rooms", imageIndexes: [1, 2] }
    ]);
  });
});
