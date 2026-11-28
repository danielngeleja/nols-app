import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import {
  adminDecide, confirmByToken, depositFor, eventSpacePhotoCount, eventTermsFingerprint, eventTermsProblems, hashEventConfirmToken, isEventConfirmToken,
  eventHireView, isEventHireAvailable, isOurEventPhotoUrl, multiDayPrice, listingPhotos, newEventConfirmToken, objectByToken, setEventSpacePhotos, setExtraEventPhotos, sanitizeEventTerms, saveEventTerms, sendToOwner, submitByOwner, suggestedDeposit,
} from "./eventHire.js";

const complete = {
  spaceType: "GARDEN", eventTypes: ["WEDDING", "BIRTHDAY"], capacitySeated: 60, capacityStanding: 100, earliestStart: "14:00", latestEnd: "02:00", noiseCutoff: "23:00",
  fullDayPrice: "800,000", deposit: 200000, allowed: { music: true, alcohol: false, hack: true }, provided: { chairs: 60, powerBackup: true },
};
const photos = ["https://cdn/a.jpg", "https://cdn/b.jpg"];
const areas = { "https://cdn/a.jpg": "EVENT_SPACE", "https://cdn/b.jpg": "KITCHEN" };

describe("event terms", () => {
  it("keeps only known fields and sane values", () => {
    const t = sanitizeEventTerms({ ...complete, spaceType: "CASTLE", capacitySeated: -4, earliestStart: "25:00", extra: "x" });
    expect(t.spaceType).toBeNull();
    expect(t.capacitySeated).toBeNull();
    expect(t.earliestStart).toBeNull();
    expect(t.fullDayPrice).toBe(800000);
    expect(t.allowed).toEqual({ music: true, decorations: false, outsideCatering: false, cooking: false, alcohol: false, overnightGuests: false });
    expect((t as any).extra).toBeUndefined();
  });

  it("passes complete terms, with an end after midnight", () => {
    expect(eventTermsProblems(sanitizeEventTerms(complete), 7)).toEqual([]);
    expect(eventTermsProblems(sanitizeEventTerms(complete), 12)).toEqual([]);
  });

  it("keeps only known event kinds, in a fixed order, and needs at least one", () => {
    const t = sanitizeEventTerms({ ...complete, eventTypes: ["MEETING", "RAVE", "WEDDING", "MEETING"] });
    expect(t.eventTypes).toEqual(["WEDDING", "MEETING"]);
    expect(eventTermsProblems(sanitizeEventTerms({ ...complete, eventTypes: [] }), 7)).toEqual(["Choose at least one kind of event the space suits."]);
    // Same choices in another order: same fingerprint.
    expect(eventTermsFingerprint(sanitizeEventTerms({ ...complete, eventTypes: ["BIRTHDAY", "WEDDING"] }))).toBe(eventTermsFingerprint(sanitizeEventTerms(complete)));
  });

  it("checks consent and approval against the stored fingerprint, so new fields never break one in review", () => {
    const row = { status: "PENDING", terms: { spaceType: "HALL" }, termsFingerprint: "a".repeat(64) };
    expect(eventHireView(row, { photos: [], photoAreas: null }).version).toBe("a".repeat(64));
  });

  it("prices events over several days from the full day, with the discount the length earns", () => {
    const t = sanitizeEventTerms({ ...complete, fullDayPrice: 1_000_000, multiDay: { enabled: true, maxDays: 7, off2: 5, off3: 10, off5: 20 } });
    expect(multiDayPrice(t, 2)).toEqual({ days: 2, gross: 2_000_000, percent: 5, total: 1_900_000, saving: 100_000 });
    expect(multiDayPrice(t, 4)?.total).toBe(3_600_000);
    expect(multiDayPrice(t, 5)?.total).toBe(4_000_000);
    expect(multiDayPrice(t, 8)).toBeNull(); // over the owner's maximum
    expect(multiDayPrice(sanitizeEventTerms(complete), 3)).toBeNull(); // not offered
    expect(eventTermsProblems(t, 7)).toEqual([]);
  });

  it("checks the several-days settings", () => {
    const base = { ...complete, fullDayPrice: 1_000_000 };
    expect(eventTermsProblems(sanitizeEventTerms({ ...base, multiDay: { enabled: true } }), 7)).toContain("Choose the most days in a row an event can take.");
    expect(eventTermsProblems(sanitizeEventTerms({ ...base, multiDay: { enabled: true, maxDays: 5, off2: 20, off3: 10 } }), 7)).toContain("Longer events should get the same or a bigger discount, not a smaller one.");
    expect(eventTermsProblems(sanitizeEventTerms({ ...complete, fullDayPrice: null, halfDayPrice: 300000, multiDay: { enabled: true, maxDays: 3 } }), 7)).toContain("Events over several days are priced from the full-day price. Enter it.");
    expect(sanitizeEventTerms({ multiDay: { enabled: true, maxDays: 99, off2: 80 } }).multiDay).toEqual({ enabled: true, maxDays: null, off2: 0, off3: 0, off5: 0 });
  });

  it("needs 7 to 12 photos of the event space", () => {
    expect(eventTermsProblems(sanitizeEventTerms(complete), 6)).toEqual(["Add at least 7 photos of the event space (6 so far)."]);
    expect(eventTermsProblems(sanitizeEventTerms(complete), 13)).toEqual(["Keep at most 12 photos of the event space (13 now)."]);
  });

  it("names what is missing", () => {
    const problems = eventTermsProblems(sanitizeEventTerms({ capacitySeated: 100, capacityStanding: 50, earliestStart: "14:00", latestEnd: "14:30" }), 0);
    expect(problems).toEqual(expect.arrayContaining([
      "Choose what kind of space it is.",
      "Standing guests cannot be fewer than seated guests.",
      "Allow at least one hour between the start and the end.",
      "Enter a half-day or a full-day price.",
      "Add at least 7 photos of the event space (0 so far).",
    ]));
  });

  it("works the deposit out from the price booked, or uses one fixed amount", () => {
    const pct = sanitizeEventTerms({ halfDayPrice: 300000, fullDayPrice: 800000 });
    expect(pct.depositMode).toBe("PERCENT");
    expect(pct.depositPercent).toBe(25);
    expect(depositFor(pct, 300000)).toBe(75000);
    expect(depositFor(pct, 800000)).toBe(200000);
    expect(depositFor({ ...pct, depositPercent: 30 }, 333333)).toBe(100000);
    expect(depositFor({ ...pct, depositPercent: 0 }, 800000)).toBe(0);
    const fixed = sanitizeEventTerms({ depositMode: "FIXED", deposit: 150000 });
    expect(depositFor(fixed, 300000)).toBe(150000);
    expect(depositFor(fixed, 800000)).toBe(150000);
    expect(eventTermsProblems(sanitizeEventTerms({ depositMode: "FIXED" }), 1)).toContain("Enter the refundable deposit (it can be 0).");
    expect(eventTermsProblems(sanitizeEventTerms({ depositMode: "PERCENT", depositPercent: "" }), 1)).toContain("Choose the deposit as a percent of the price (it can be 0%).");
  });

  it("refuses a quiet time outside the window", () => {
    const t = sanitizeEventTerms({ ...complete, latestEnd: "22:00", noiseCutoff: "23:00" });
    expect(eventTermsProblems(t, 1)).toContain("The quiet time must fall between the start and the end.");
  });

  it("fingerprints the terms independent of key order", () => {
    const a = sanitizeEventTerms(complete);
    const b = sanitizeEventTerms(Object.fromEntries(Object.entries(complete).reverse()));
    expect(eventTermsFingerprint(a)).toBe(eventTermsFingerprint(b));
    expect(eventTermsFingerprint(a)).not.toBe(eventTermsFingerprint(sanitizeEventTerms({ ...complete, deposit: 1 })));
  });

  it("counts only Event space photos that are on the listing", () => {
    expect(eventSpacePhotoCount(photos, areas)).toBe(1);
    expect(eventSpacePhotoCount(JSON.stringify(photos), JSON.stringify({ ...areas, "https://gone.jpg": "EVENT_SPACE" }))).toBe(1);
  });

  it("suggests a quarter of the full day as deposit", () => {
    expect(suggestedDeposit({ fullDayPrice: 800000, halfDayPrice: null })).toBe(200000);
    expect(suggestedDeposit({ fullDayPrice: null, halfDayPrice: null })).toBeNull();
  });

  it("issues SMS tokens and stores only a hash", () => {
    const t = newEventConfirmToken();
    expect(isEventConfirmToken(t.raw)).toBe(true);
    expect(t.hash).toBe(hashEventConfirmToken(t.raw));
    expect(isEventConfirmToken("x")).toBe(false);
  });
});

/** A tiny in-memory db with one property and its event hire row. */
function fakeDb(property: Record<string, unknown> = {}) {
  const state: { row: any } = { row: null };
  // Seven listing photos already show the space: the 7-photo minimum is met.
  const seven = Array.from({ length: 7 }, (_, i) => `https://cdn/e${i}.jpg`);
  const prop = {
    id: 5, title: "Garden Villa", status: "APPROVED", rentalMode: "NIGHTLY", ownerId: 9,
    photos: [...seven, "https://cdn/k.jpg"],
    photoAreas: { ...Object.fromEntries(seven.map((u) => [u, "EVENT_SPACE"])), "https://cdn/k.jpg": "KITCHEN" },
    ...property,
  };
  const db = {
    state,
    property: { findUnique: vi.fn(async () => prop), update: vi.fn(async ({ data }: any) => Object.assign(prop, data)) },
    propertyEventHire: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (!state.row) return null;
        if (where.propertyId) return where.propertyId === state.row.propertyId ? state.row : null;
        if (where.confirmTokenHash) return where.confirmTokenHash === state.row.confirmTokenHash ? state.row : null;
        return null;
      }),
      create: vi.fn(async ({ data }: any) => (state.row = { id: 1, ...data })),
      update: vi.fn(async ({ data }: any) => (state.row = { ...state.row, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return db;
}

describe("event hire under an accommodation property", () => {
  it("keeps an approved hotel approved through event drafts, submission, return and approval", async () => {
    const db = fakeDb({ title: "Approved Hotel" });
    const hotel = await db.property.findUnique();
    const original = structuredClone(hotel);
    const expectHotelUnchanged = () => {
      expect(hotel).toEqual(original);
      expect(hotel.status).toBe("APPROVED");
      expect(db.property.update).not.toHaveBeenCalled();
    };

    let saved = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: { spaceType: "HALL" }, allowIncomplete: true });
    expect(saved.row.status).toBe("DRAFT");
    expectHotelUnchanged();
    saved = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: saved.row.termsFingerprint, consent: true });
    expect(db.state.row.status).toBe("PENDING");
    expectHotelUnchanged();
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "RETURN", reason: "Please correct the event hours" });
    expect(db.state.row.status).toBe("RETURNED");
    expectHotelUnchanged();
    saved = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: { ...complete, latestEnd: "01:00" } });
    await submitByOwner(db, { propertyId: 5, version: saved.row.termsFingerprint, consent: true });
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: saved.row.termsFingerprint });
    expect(db.state.row.status).toBe("APPROVED");
    expectHotelUnchanged();
  });

  it("changes only photo labels when selecting existing hotel photos for events", async () => {
    const db = fakeDb({ title: "Approved Hotel" });
    const hotel = await db.property.findUnique();
    const originalPhotos = [...hotel.photos];
    await setEventSpacePhotos(db, 5, [originalPhotos[0], originalPhotos[1]]);
    expect(db.property.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.property.update.mock.calls[0][0].data)).toEqual(["photoAreas"]);
    expect(hotel.status).toBe("APPROVED");
    expect(hotel.photos).toEqual(originalPhotos);
  });

  it("lets an approved owner add event hire without having opted in during onboarding", async () => {
    const db = fakeDb();
    expect(db.state.row).toBeNull();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint });
    expect(db.state.row.status).toBe("APPROVED");
  });

  it("saves an incomplete onboarding draft without allowing it into review", async () => {
    const db = fakeDb({ status: "DRAFT" });
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: { spaceType: "GARDEN" }, allowIncomplete: true });
    expect(row.status).toBe("DRAFT");
    expect(row.terms.spaceType).toBe("GARDEN");
    await expect(submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true })).rejects.toMatchObject({ code: "INCOMPLETE" });
    expect(db.state.row.status).toBe("DRAFT");
  });

  it("can be prepared and submitted before accommodation approval, with activation held", async () => {
    const db = fakeDb({ status: "DRAFT" });
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    expect(db.state.row.status).toBe("PENDING");
    await expect(adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint })).rejects.toMatchObject({ code: "PROPERTY_NOT_APPROVED" });
    expect(db.state.row.status).toBe("PENDING");
  });

  it("cannot resume event hire while its parent is suspended", async () => {
    const db = fakeDb({ status: "SUSPENDED" });
    db.state.row = { id: 1, propertyId: 5, status: "PAUSED" };
    await expect(adminDecide(db, { propertyId: 5, adminId: 1, action: "RESUME" })).rejects.toMatchObject({ code: "PROPERTY_NOT_APPROVED" });
    expect(db.state.row.status).toBe("PAUSED");
  });

  it("requires both approvals and nightly accommodation for availability", () => {
    expect(isEventHireAvailable({ status: "APPROVED" }, { status: "APPROVED", rentalMode: "NIGHTLY" })).toBe(true);
    for (const status of ["DRAFT", "PENDING", "REJECTED", "SUSPENDED"]) {
      expect(isEventHireAvailable({ status: "APPROVED" }, { status, rentalMode: "NIGHTLY" })).toBe(false);
    }
    expect(isEventHireAvailable({ status: "PENDING" }, { status: "APPROVED" })).toBe(false);
    expect(isEventHireAvailable({ status: "APPROVED" }, { status: "APPROVED", rentalMode: "LONG_STAY" })).toBe(false);
  });
});

describe("uploading event photos on the add-on", () => {
  const ours = (n: number) => `https://res.cloudinary.com/nolsaf-test/image/upload/v1/properties/events/p${n}.jpg`;

  it("accepts only photos stored in our own Cloudinary property folders", () => {
    expect(isOurEventPhotoUrl(ours(1), "nolsaf-test")).toBe(true);
    expect(isOurEventPhotoUrl("https://res.cloudinary.com/someone-else/image/upload/v1/properties/x.jpg", "nolsaf-test")).toBe(false);
    expect(isOurEventPhotoUrl("https://evil.example/properties/x.jpg", "nolsaf-test")).toBe(false);
    expect(isOurEventPhotoUrl("http://res.cloudinary.com/nolsaf-test/image/upload/v1/properties/x.jpg", "nolsaf-test")).toBe(false);
    expect(isOurEventPhotoUrl("https://res.cloudinary.com/nolsaf-test/image/upload/v1/avatars/x.jpg", "nolsaf-test")).toBe(false);
  });

  it("saves them on the add-on, never on the listing, and counts them toward the photo rule", async () => {
    const before = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = "nolsaf-test";
    try {
      const db = fakeDb({ photos: ["u1"], photoAreas: null });
      const { row, property } = await setExtraEventPhotos(db, { propertyId: 5, userId: 9, by: "OWNER", urls: [ours(1), ours(2), ours(1)] });
      expect(row.extraPhotos).toEqual([ours(1), ours(2)]);
      expect(db.property.update).not.toHaveBeenCalled();
      expect(eventHireView(row, property).eventSpacePhotos).toBe(2);
      await expect(setExtraEventPhotos(db, { propertyId: 5, userId: 9, by: "OWNER", urls: ["https://evil.example/x.jpg"] })).rejects.toThrow(/Upload the photos here/);
    } finally {
      process.env.CLOUDINARY_CLOUD_NAME = before;
    }
  });

  it("photos cannot be changed on an approved add-on", async () => {
    const before = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = "nolsaf-test";
    try {
      const db = fakeDb();
      const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
      await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
      await adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint });
      await expect(setExtraEventPhotos(db, { propertyId: 5, userId: 9, by: "OWNER", urls: [ours(3)] })).rejects.toThrow(/cannot be changed/);
      await expect(setEventSpacePhotos(db, 5, [])).rejects.toThrow(/cannot be changed/);
      expect(db.state.row.status).toBe("APPROVED");
    } finally {
      process.env.CLOUDINARY_CLOUD_NAME = before;
    }
  });
});

describe("the 12-photo cap", () => {
  it("counts listing photos and uploaded photos together", async () => {
    const before = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = "nolsaf-test";
    try {
      const up = (n: number) => `https://res.cloudinary.com/nolsaf-test/image/upload/v1/properties/events/x${n}.jpg`;
      const db = fakeDb(); // 7 listing photos already tagged
      await setExtraEventPhotos(db, { propertyId: 5, userId: 9, by: "OWNER", urls: [1, 2, 3, 4, 5].map(up) });
      await expect(setExtraEventPhotos(db, { propertyId: 5, userId: 9, by: "OWNER", urls: [1, 2, 3, 4, 5, 6].map(up) })).rejects.toThrow(/Up to 12/);
      // 5 uploaded + 8 listing photos would be 13.
      const all = Array.from({ length: 7 }, (_, i) => `https://cdn/e${i}.jpg`);
      await expect(setEventSpacePhotos(db, 5, [...all, "https://cdn/k.jpg"])).rejects.toThrow(/Up to 12/);
    } finally {
      process.env.CLOUDINARY_CLOUD_NAME = before;
    }
  });
});

describe("choosing Event space photos", () => {
  it("marks exactly the chosen listing photos and leaves other areas alone", async () => {
    const db = fakeDb({ photos: ["u1", "u2", "u3"], photoAreas: { u1: "EVENT_SPACE", u2: "KITCHEN" } });
    const property = await setEventSpacePhotos(db, 5, ["u2", "u3", "https://not-on-listing.jpg"]);
    expect(property.photoAreas).toEqual({ u2: "EVENT_SPACE", u3: "EVENT_SPACE" });
    expect(listingPhotos(property.photos, property.photoAreas)).toEqual([
      { url: "u1", area: null }, { url: "u2", area: "EVENT_SPACE" }, { url: "u3", area: "EVENT_SPACE" },
    ]);
    expect(db.property.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { photoAreas: { u2: "EVENT_SPACE", u3: "EVENT_SPACE" } } });
    const none = await setEventSpacePhotos(fakeDb({ photos: ["u1"], photoAreas: { u1: "EVENT_SPACE" } }), 5, []);
    expect(none.photoAreas).toBeNull();
  });
});

describe("event hire flow", () => {
  it("owner saves, consents to the exact version and goes to review", async () => {
    const db = fakeDb();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    expect(row.status).toBe("DRAFT");
    await expect(submitByOwner(db, { propertyId: 5, version: "0".repeat(64), consent: true })).rejects.toThrow(/changed/);
    const { row: sent, changed } = await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    expect(changed).toBe(true);
    expect(sent).toMatchObject({ status: "PENDING", ownerConsentVia: "APP", ownerConsentFingerprint: row.termsFingerprint });
  });

  it("will not save until every required detail is filled, and refuses long-stay homes", async () => {
    const db = fakeDb();
    await expect(saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: { spaceType: "HALL" } })).rejects.toThrow(/Choose at least one kind of event/);
    await expect(saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: { ...complete, fullDayPrice: null } })).rejects.toThrow(/half-day or a full-day price/);
    expect(db.propertyEventHire.create).not.toHaveBeenCalled();
    await expect(saveEventTerms(fakeDb({ rentalMode: "LONG_STAY" }), { propertyId: 5, userId: 9, by: "OWNER", terms: complete })).rejects.toThrow(/short-stay/);
  });

  it("admin cannot approve one with required details missing", async () => {
    const db = fakeDb();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    // The listing photos showing the space were removed after it was sent.
    db.property.findUnique = vi.fn(async () => ({ id: 5, title: "Garden Villa", status: "APPROVED", rentalMode: "NIGHTLY", ownerId: 9, photos: [], photoAreas: null })) as any;
    await expect(adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint })).rejects.toThrow(/cannot be approved/);
    expect((await adminDecide(db, { propertyId: 5, adminId: 1, action: "RETURN", reason: "Add 7 photos of the space" })).status).toBe("RETURNED");
  });

  it("partner fills, owner confirms on the SMS link; a partner cannot change it afterwards", async () => {
    const db = fakeDb();
    await saveEventTerms(db, { propertyId: 5, userId: 40, by: "SALES_PARTNER", salesPartnerId: 3, terms: complete });
    const { token, row } = await sendToOwner(db, { propertyId: 5 });
    expect(row.status).toBe("AWAITING_OWNER");
    expect(db.state.row.confirmTokenHash).toBe(hashEventConfirmToken(token));
    const { row: confirmed } = await confirmByToken(db, token, row.termsFingerprint, true);
    expect(confirmed).toMatchObject({ status: "PENDING", ownerConsentVia: "SMS_LINK" });
    await expect(saveEventTerms(db, { propertyId: 5, userId: 40, by: "SALES_PARTNER", salesPartnerId: 3, terms: { ...complete, deposit: 0 } })).rejects.toThrow(/owner already confirmed/);
  });

  it("a partner edit after sending kills the old SMS link", async () => {
    const db = fakeDb();
    await saveEventTerms(db, { propertyId: 5, userId: 40, by: "SALES_PARTNER", salesPartnerId: 3, terms: complete });
    const { token, row } = await sendToOwner(db, { propertyId: 5 });
    await saveEventTerms(db, { propertyId: 5, userId: 40, by: "SALES_PARTNER", salesPartnerId: 3, terms: { ...complete, capacityStanding: 120 } });
    await expect(confirmByToken(db, token, row.termsFingerprint, true)).rejects.toThrow(/not valid/);
  });

  it("the owner can say something is wrong instead", async () => {
    const db = fakeDb();
    await saveEventTerms(db, { propertyId: 5, userId: 40, by: "SALES_PARTNER", salesPartnerId: 3, terms: complete });
    const { token } = await sendToOwner(db, { propertyId: 5 });
    const row = await objectByToken(db, token, "Only 50 people fit");
    expect(row).toMatchObject({ status: "DRAFT", ownerObjectionNote: "Only 50 people fit", confirmTokenHash: null });
  });

  it("admin approves only what the owner consented to", async () => {
    const db = fakeDb();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    await expect(adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: "f".repeat(64) })).rejects.toThrow(/changed/);
    const approved = await adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint });
    expect(approved).toMatchObject({ status: "APPROVED", approvedFingerprint: row.termsFingerprint });
  });

  it("is locked from the moment it is sent for review until NoLSAF returns it", async () => {
    const db = fakeDb();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    const changedTerms = { ...complete, fullDayPrice: 900000 };
    // In review: no change, an unchanged save is harmless.
    await expect(saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: changedTerms })).rejects.toThrow(/with NoLSAF for review/);
    expect((await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete })).row.status).toBe("PENDING");
    // Approved: still locked.
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint });
    await expect(saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: changedTerms })).rejects.toThrow(/call NoLSAF support/i);
    // Paused: the owner cannot send it again to get round the pause.
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "PAUSE", reason: "Neighbours complained" });
    expect((await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true })).row.status).toBe("PAUSED");
  });

  it("opens again for changes when NoLSAF returns it", async () => {
    const db = fakeDb();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "RETURN", reason: "Show the garden at night" });
    const edited = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: { ...complete, capacityStanding: 80 } });
    expect(edited.row.status).toBe("DRAFT");
  });

  it("pause needs a reason and resume goes back to approved", async () => {
    const db = fakeDb();
    const { row } = await saveEventTerms(db, { propertyId: 5, userId: 9, by: "OWNER", terms: complete });
    await submitByOwner(db, { propertyId: 5, version: row.termsFingerprint, consent: true });
    await adminDecide(db, { propertyId: 5, adminId: 1, action: "APPROVE", version: row.termsFingerprint });
    await expect(adminDecide(db, { propertyId: 5, adminId: 1, action: "PAUSE" })).rejects.toThrow(/why/);
    expect((await adminDecide(db, { propertyId: 5, adminId: 1, action: "PAUSE", reason: "Neighbours complained" })).status).toBe("PAUSED");
    expect((await adminDecide(db, { propertyId: 5, adminId: 1, action: "RESUME" })).status).toBe("APPROVED");
  });
});
