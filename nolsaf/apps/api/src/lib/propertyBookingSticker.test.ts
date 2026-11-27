import { describe, expect, it } from "vitest";
import { buildBookingSticker, stickerPlace, stickerUnavailableReason, stickerUrl } from "./propertyBookingSticker.js";

const key = "ckx9booking0key0abcdefgh";
const approved = { title: "Diary Hotel", status: "APPROVED", nrmsBookingKey: key, district: "UBUNGO", city: "DAR ES SALAAM", regionName: "DAR-ES-SALAAM", rentalMode: "NIGHTLY" };

describe("booking sticker", () => {
  it("links to the public page by booking key, tagged as a sticker QR", () => {
    expect(stickerUrl(approved, "https://www.nolsaf.com")).toBe(`https://www.nolsaf.com/public/properties/diary-hotel-${key}?src=qr&qr=sticker`);
  });

  it("never puts a row id in the link", async () => {
    const sticker = await buildBookingSticker({ ...approved, id: 4242 } as any, "https://www.nolsaf.com");
    expect(sticker.url).not.toContain("4242");
    expect(sticker.qrSvg.startsWith("<svg")).toBe(true);
    expect(sticker).not.toHaveProperty("id");
  });

  it("is only offered for approved properties with a public key", () => {
    expect(stickerUnavailableReason(approved)).toBeNull();
    expect(stickerUnavailableReason({ ...approved, status: "PENDING" })).toMatch(/approves/);
    expect(stickerUnavailableReason({ ...approved, status: "SUSPENDED" })).not.toBeNull();
    expect(stickerUnavailableReason({ ...approved, nrmsBookingKey: null })).not.toBeNull();
  });

  it("reads the place in plain words without repeats", () => {
    expect(stickerPlace(approved)).toBe("Ubungo, Dar es Salaam");
    expect(stickerPlace({ district: null, city: null, regionName: null })).toBeNull();
  });

  it("uses long-stay wording mode for long-stay homes", async () => {
    const sticker = await buildBookingSticker({ ...approved, rentalMode: "LONG_STAY" }, "https://www.nolsaf.com");
    expect(sticker.rentalMode).toBe("LONG_STAY");
  });
});
