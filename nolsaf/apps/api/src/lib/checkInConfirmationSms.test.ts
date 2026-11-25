import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findAlert: vi.fn(), findBooking: vi.fn(), createAlert: vi.fn(), sendSms: vi.fn(), sendMail: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => ({ prisma: {
  auditLog: { findFirst: mocks.findAlert, create: mocks.createAlert },
  booking: { findUnique: mocks.findBooking },
} }));
vi.mock("./sms.js", () => ({ sendSms: mocks.sendSms }));
vi.mock("./mailer.js", () => ({ sendMail: mocks.sendMail }));
vi.mock("./tripSafety.js", () => ({ getSupportContact: vi.fn().mockResolvedValue({ phone: "+255736766726" }) }));
import { checkInConfirmationText, ensureGuestCheckInConfirmation } from "./checkInConfirmationSms.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAlert.mockResolvedValue(null);
  mocks.findBooking.mockResolvedValue({
    guestPhone: "+255712345678", user: { phone: null, email: "guest@example.com" },
    property: { title: "NoLSAF Hotel" }, code: { status: "USED", usedAt: new Date("2026-10-07T11:00:00Z") },
  });
  mocks.createAlert.mockResolvedValue({ id: 1 });
});

describe("checkInConfirmationText", () => {
  it("states the property, the time in EAT and the support number", () => {
    const text = checkInConfirmationText({
      propertyTitle: "NoLSAF Hotel",
      usedAt: new Date("2026-10-07T11:00:00Z"),
      supportPhone: "+255736766726",
    });
    expect(text).toBe(
      "Check-in confirmed at NoLSAF Hotel on 07 Oct, 14:00 EAT. If you have not checked in, call NoLSAF now on +255736766726."
    );
  });

  it("shortens a long property title", () => {
    const text = checkInConfirmationText({
      propertyTitle: "A very long property name that goes on and on past forty characters",
      usedAt: new Date("2026-10-07T11:00:00Z"),
      supportPhone: "+255736766726",
    });
    expect(text).toContain("at A very long property name that goes on.");
  });

  it("never uses an em dash", () => {
    const text = checkInConfirmationText({ propertyTitle: null, usedAt: new Date(), supportPhone: "+255736766726" });
    expect(text).not.toContain("—");
  });
});

describe("guest check-in awareness gate", () => {
  it("records accepted SMS without sending a duplicate email", async () => {
    mocks.sendSms.mockResolvedValue({ success: true, provider: "africastalking", messageId: "sms-1" });
    expect(await ensureGuestCheckInConfirmation(42)).toBe(true);
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityId: 42, afterJson: expect.objectContaining({ channel: "SMS" }) }),
    }));
  });

  it("falls back to email when SMS is not accepted", async () => {
    mocks.sendSms.mockResolvedValue({ success: false, error: "provider unavailable" });
    mocks.sendMail.mockResolvedValue({ success: true, provider: "resend", messageId: "email-1" });
    expect(await ensureGuestCheckInConfirmation(42)).toBe(true);
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), undefined,
      expect.objectContaining({ bypassEligibilityCheck: true }));
    expect(mocks.createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ afterJson: expect.objectContaining({ channel: "EMAIL" }) }),
    }));
  });

  it("selects only fields that exist on Booking (a wrong field throws in production and freezes payouts)", async () => {
    const { Prisma } = await import("@prisma/client");
    mocks.sendSms.mockResolvedValue({ success: true, provider: "africastalking", messageId: "sms-3" });
    await ensureGuestCheckInConfirmation(42);
    const select = mocks.findBooking.mock.calls[0][0].select as Record<string, unknown>;
    const relations = new Set(["user", "property", "code"]);
    const scalars = new Set(Object.keys((Prisma as any).BookingScalarFieldEnum));
    expect(scalars.size).toBeGreaterThan(5);
    for (const key of Object.keys(select)) expect(relations.has(key) || scalars.has(key), `Booking.${key}`).toBe(true);
  });

  it("does not report success when no provider accepted the alert", async () => {
    mocks.findBooking.mockResolvedValue({
      guestPhone: null, user: null,
      property: { title: "NoLSAF Hotel" }, code: { status: "USED", usedAt: new Date("2026-10-07T11:00:00Z") },
    });
    expect(await ensureGuestCheckInConfirmation(42)).toBe(false);
    expect(mocks.createAlert).not.toHaveBeenCalled();
  });

  it("does not unlock on console-only or suppressed delivery", async () => {
    mocks.sendSms.mockResolvedValue({ success: true, provider: "console" });
    mocks.sendMail.mockResolvedValue({ success: true, provider: "suppressed" });
    expect(await ensureGuestCheckInConfirmation(42)).toBe(false);
    expect(mocks.createAlert).not.toHaveBeenCalled();
  });
});
