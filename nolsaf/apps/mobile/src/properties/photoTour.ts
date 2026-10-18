import type { RoomSpec } from "./types";

export type PhotoTourSection = {
  title: string;
  imageIndexes: number[];
};

function roomTitle(room: RoomSpec): string {
  for (const value of [room.roomType, room.name, room.code]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Rooms";
}

/** Keep every public gallery image once, using room metadata only where it exists. */
export function buildPhotoTourSections(images: string[], roomsSpec: RoomSpec[]): PhotoTourSection[] {
  const indexByUrl = new Map(images.map((url, index) => [url, index]));
  const assigned = new Set<number>();
  const roomGroups = new Map<string, number[]>();

  for (const room of roomsSpec) {
    const urls = Array.isArray(room.roomImages) ? room.roomImages : [];
    for (const url of urls) {
      const index = indexByUrl.get(url);
      if (index === undefined || assigned.has(index)) continue;
      assigned.add(index);
      const title = roomTitle(room);
      const group = roomGroups.get(title) ?? [];
      group.push(index);
      roomGroups.set(title, group);
    }
  }

  const propertyImages = images.map((_, index) => index).filter((index) => !assigned.has(index));
  const sections: PhotoTourSection[] = [];
  if (propertyImages.length) {
    sections.push({ title: roomGroups.size ? "Property photos" : "Photos", imageIndexes: propertyImages });
  }
  for (const [title, imageIndexes] of roomGroups) sections.push({ title, imageIndexes });
  return sections;
}
