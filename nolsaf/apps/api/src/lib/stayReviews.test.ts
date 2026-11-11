import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
vi.mock("./notifications.js", () => ({ notifyOwner: vi.fn() }));
vi.mock("./mailer.js", () => ({ sendMail: vi.fn() }));

const { isFinishedStay, getStayReviewRequestEmail } = await import("./stayReviews.js");

const NOW = new Date("2026-11-11T09:00:00.000Z");
const yesterday = new Date(NOW.getTime() - 86_400_000);
const tomorrow = new Date(NOW.getTime() + 86_400_000);
const code = { id: 1 };

describe("isFinishedStay", () => {
  it("counts a checked-out stay at any time", () => {
    expect(isFinishedStay({ status: "CHECKED_OUT", checkOut: tomorrow }, NOW)).toBe(true);
  });

  it("counts a paid stay once its check-out date has passed (NRMS or forgotten check-out)", () => {
    expect(isFinishedStay({ status: "CHECKED_IN", checkOut: yesterday, code }, NOW)).toBe(true);
    expect(isFinishedStay({ status: "CONFIRMED", checkOut: yesterday, code }, NOW)).toBe(true);
  });

  it("never counts a stay still in progress, unpaid, or cancelled", () => {
    expect(isFinishedStay({ status: "CHECKED_IN", checkOut: tomorrow, code }, NOW)).toBe(false);
    expect(isFinishedStay({ status: "CONFIRMED", checkOut: yesterday, code: null }, NOW)).toBe(false);
    expect(isFinishedStay({ status: "NEW", checkOut: yesterday, code }, NOW)).toBe(false);
    expect(isFinishedStay({ status: "CANCELED", checkOut: yesterday, code }, NOW)).toBe(false);
  });
});

describe("review request email", () => {
  it("links to the rating card and escapes names", () => {
    const { subject, html } = getStayReviewRequestEmail({
      guestName: "<b>Amina</b>",
      propertyName: "Serengeti Villa",
      reviewUrl: "https://www.nolsaf.com/account/bookings/bk_ref#rate",
    });
    expect(subject).toBe("How was your stay at Serengeti Villa?");
    expect(html).toContain("https://www.nolsaf.com/account/bookings/bk_ref#rate");
    expect(html).toContain("&lt;b&gt;Amina&lt;/b&gt;");
    expect(html).not.toContain("<b>Amina</b>");
    expect(html).not.toContain("—");
  });
});
