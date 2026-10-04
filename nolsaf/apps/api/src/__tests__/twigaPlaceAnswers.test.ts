import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Place answers read live listings and availability. These tests pin what the
 * visitor is told in each state, that links open the booking page on the asked
 * dates, and that alternatives never leak internal ids.
 */
const db = vi.hoisted(() => ({
  listings: [] as any[],
  rooms: new Map<number, { rooms: number; closed: boolean }>(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    property: {
      findFirst: vi.fn(async (args: any) =>
        db.listings.find((l) => l.nrmsBookingKey === args?.where?.nrmsBookingKey && args?.where?.status === "APPROVED") ?? null
      ),
      findMany: vi.fn(async (args: any) =>
        db.listings.filter(
          (l) =>
            (!args?.where?.regionName || l.regionName === args.where.regionName) &&
            (args?.where?.id?.not === undefined || l.id !== args.where.id.not)
        )
      ),
      count: vi.fn(async (args: any) => db.listings.filter((l) => l.regionName === args?.where?.regionName).length),
      aggregate: vi.fn(async () => ({ _min: { basePrice: 90000 }, _max: { basePrice: 150000 } })),
    },
  },
}));

vi.mock("../lib/availabilityCalculator", () => ({
  calculateAvailability: vi.fn(async (id: number) => {
    const state = db.rooms.get(id) ?? { rooms: 0, closed: false };
    return { summary: { totalSellableRooms: state.rooms }, restrictions: state.closed ? [{ message: "closed" }] : [] };
  }),
}));

import { answerForPlace } from "../lib/twiga/placeAnswers";

const NOW = new Date("2026-09-16T06:00:00.000Z");
const KEY = "ckabcdefghijklmnopqrstuv";
const OTHER = "ckzyxwvutsrqponmlkjihgfe";

const villa = {
  id: 42,
  title: "Sea Breeze Villa",
  type: "VILLA",
  regionName: "Zanzibar",
  district: "Nungwi",
  city: null,
  basePrice: 150000,
  currency: "TZS",
  maxGuests: 4,
  totalBedrooms: 2,
  nrmsBookingKey: KEY,
};
const lodge = { ...villa, id: 77, title: "Coral Lodge", type: "LODGE", basePrice: 90000, nrmsBookingKey: OTHER };

const property = { kind: "property" as const, id: 42, key: KEY, label: villa.title, slug: `sea-breeze-villa-${KEY}` };

beforeEach(() => {
  db.listings = [villa, lodge];
  db.rooms = new Map([[42, { rooms: 2, closed: false }], [77, { rooms: 1, closed: false }]]);
});

describe("a tagged property", () => {
  it("introduces the stay and asks for dates when none were given", async () => {
    const answer = await answerForPlace(property, "tell me about it", "en", NOW);
    expect(answer?.text).toContain("Sea Breeze Villa is a villa in Nungwi, Zanzibar.");
    expect(answer?.text).toContain("From TZS 150,000 a night");
    expect(answer?.text).toContain("Which dates do you have in mind?");
    expect(answer?.followUps).toContain("This weekend");
  });

  it("confirms availability with the total and a link on those dates", async () => {
    const answer = await answerForPlace(property, "12 to 15 October for 2 people", "en", NOW);
    expect(answer?.text).toContain("Good news: Sea Breeze Villa is available");
    expect(answer?.text).toContain("about TZS 450,000 for the stay");
    expect(answer?.links[0]).toEqual({
      label: "Book these dates",
      href: `/public/properties/sea-breeze-villa-${KEY}?checkIn=2026-10-12&checkOut=2026-10-15&guests=2`,
    });
  });

  it("warns when the party is bigger than the stay sleeps", async () => {
    const answer = await answerForPlace(property, "12 to 15 October for 6 people", "en", NOW);
    expect(answer?.text).toContain("sleeps up to 4");
  });

  it("offers free stays nearby as tappable tags when fully booked", async () => {
    db.rooms.set(42, { rooms: 0, closed: false });
    const answer = await answerForPlace(property, "this weekend", "en", NOW);
    expect(answer?.text).toContain("Sea Breeze Villa is fully booked");
    expect(answer?.text).toContain(`@[Coral Lodge](property:coral-lodge-${OTHER})`);
    // Public tokens only: the internal numeric id must not appear.
    expect(answer?.text).not.toMatch(/property:77/);
  });

  it("says so when the owner has closed the dates", async () => {
    db.rooms.set(42, { rooms: 3, closed: true });
    const answer = await answerForPlace(property, "tomorrow", "en", NOW);
    expect(answer?.text).toContain("is not taking bookings");
  });

  it("asks again for dates in the past instead of checking them", async () => {
    const answer = await answerForPlace(property, "2025-01-01", "en", NOW);
    expect(answer?.text).toContain("already passed");
  });

  it("returns nothing for a listing that is not approved", async () => {
    db.listings = [];
    expect(await answerForPlace(property, "tomorrow", "en", NOW)).toBeNull();
  });

  it("answers in Kiswahili", async () => {
    const answer = await answerForPlace(property, "12 hadi 15 oktoba", "sw", NOW);
    expect(answer?.text).toContain("Habari njema");
    expect(answer?.links[0].label).toBe("Hifadhi tarehe hizi");
  });
});

describe("a tagged region", () => {
  const region = { kind: "region" as const, name: "Zanzibar", label: "Zanzibar" };

  it("summarises the region and lists the cheapest first", async () => {
    const answer = await answerForPlace(region, "", "en", NOW);
    expect(answer?.text).toContain("Zanzibar has 2 approved stays on NoLSAF, from TZS 90,000 to TZS 150,000 a night.");
    const lines = answer!.text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines[0]).toContain("Coral Lodge");
  });

  it("lists only stays that are free on the dates", async () => {
    db.rooms.set(77, { rooms: 0, closed: false });
    const answer = await answerForPlace(region, "this weekend for 2", "en", NOW);
    expect(answer?.text).toContain("Sea Breeze Villa");
    expect(answer?.text).not.toContain("Coral Lodge");
    expect(answer?.links[0].href).toBe("/public/properties?region=Zanzibar&checkIn=2026-09-18&checkOut=2026-09-20");
  });
});
