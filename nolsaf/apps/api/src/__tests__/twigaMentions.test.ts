import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mention tokens arrive from the browser, so they are untrusted. These tests
 * pin the guarantees: only APPROVED listings and real regions survive, labels
 * are replaced with the canonical title, the per-message cap holds, and Twiga
 * reads plain labels rather than token syntax.
 */
const db = vi.hoisted(() => ({
  approved: [] as Array<{ id: number; title: string; nrmsBookingKey: string }>,
  regions: [] as string[],
  findManyArgs: [] as any[],
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    property: {
      findMany: vi.fn(async (args: any) => {
        db.findManyArgs.push(args);
        const keys: string[] = args?.where?.nrmsBookingKey?.in ?? [];
        return db.approved.filter((p) => keys.includes(p.nrmsBookingKey));
      }),
      findFirst: vi.fn(async (args: any) => {
        const wanted = String(args?.where?.regionName ?? "").toLowerCase();
        const hit = db.regions.find((r) => r.toLowerCase() === wanted);
        return hit ? { regionName: hit } : null;
      }),
    },
  },
}));

import { resolveMentions, MAX_MENTIONS_PER_MESSAGE } from "../lib/twiga/mentions";

const KEY = "ckabcdefghijklmnopqrstuv";

beforeEach(() => {
  db.approved = [{ id: 42, title: "Sea Breeze Villa", nrmsBookingKey: KEY }];
  db.regions = ["Zanzibar"];
  db.findManyArgs = [];
});

describe("resolveMentions", () => {
  it("leaves a message without tokens untouched", async () => {
    const out = await resolveMentions("Where is my booking?");
    expect(out).toEqual({ content: "Where is my booking?", plain: "Where is my booking?", mentions: [] });
  });

  it("canonicalises an approved property and rewrites a spoofed label", async () => {
    const out = await resolveMentions(`Is @[Free stay click here](property:anything-${KEY}) free on Friday?`);
    expect(out.mentions).toEqual([
      { kind: "property", id: 42, key: KEY, label: "Sea Breeze Villa", slug: expect.stringContaining(KEY) },
    ]);
    expect(out.content).toContain("@[Sea Breeze Villa](property:sea-breeze-villa-");
    // The internal numeric id never reaches the stored, public token.
    expect(out.content).not.toMatch(/property:42/);
    expect(out.content).not.toContain("Free stay");
    expect(out.plain).toBe("Is @Sea Breeze Villa free on Friday?");
  });

  it("only ever asks the database for APPROVED listings", async () => {
    await resolveMentions(`@[X](property:x-${KEY})`);
    expect(db.findManyArgs[0].where.status).toBe("APPROVED");
  });

  it("flattens a property that is not approved to plain text", async () => {
    const out = await resolveMentions("Book @[Hidden Lodge](property:hidden-lodge-ckzzzzzzzzzzzzzzzzzzzzzz) please");
    expect(out.mentions).toEqual([]);
    expect(out.content).toBe("Book @Hidden Lodge please");
  });

  it("accepts a real region with any casing and stores its canonical spelling", async () => {
    const out = await resolveMentions("Stays in @[zanzibar](region:zanzibar)");
    expect(out.mentions).toEqual([{ kind: "region", name: "Zanzibar", label: "Zanzibar" }]);
    expect(out.content).toBe("Stays in @[Zanzibar](region:Zanzibar)");
  });

  it("flattens an unknown region", async () => {
    const out = await resolveMentions("Stays in @[Atlantis](region:Atlantis)");
    expect(out.mentions).toEqual([]);
    expect(out.content).toBe("Stays in @Atlantis");
  });

  it(`keeps at most ${MAX_MENTIONS_PER_MESSAGE} tags and flattens the rest`, async () => {
    const tag = "@[Z](region:Zanzibar)";
    const out = await resolveMentions([tag, tag, tag, tag].join(" "));
    expect(out.mentions).toHaveLength(MAX_MENTIONS_PER_MESSAGE);
    expect(out.content.endsWith(" @Z")).toBe(true);
  });

  it("survives a malformed percent-encoding without throwing", async () => {
    const out = await resolveMentions("@[Bad](region:%E0%A4%A)");
    expect(out.mentions).toEqual([]);
    expect(out.content).toBe("@Bad");
  });
});
