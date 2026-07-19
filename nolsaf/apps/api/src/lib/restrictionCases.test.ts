import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  restrictionFindFirst: vi.fn(),
  restrictionUpdate: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    platformRestrictionCase: {
      findFirst: mocks.restrictionFindFirst,
      update: mocks.restrictionUpdate,
    },
  },
}));

vi.mock("./mailer.js", () => ({ sendMail: mocks.sendMail }));

import {
  RESTRICTION_SCOPE,
  createRestrictionCase,
  generateRestrictionReference,
  resolveRestrictionCase,
  sendRestrictionOpenedEmail,
  sendRestrictionResolvedEmail,
} from "./restrictionCases.js";

const appliedAt = new Date("2026-07-19T08:30:00.000Z");

function openRestriction(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    referenceCode: "NLS-NRP-42-20260719-A1B2C3",
    activeKey: "NRMS_PROPERTY:42",
    scope: RESTRICTION_SCOPE.NRMS_PROPERTY,
    status: "OPEN",
    ownerId: 9,
    targetId: 42,
    propertyId: 42,
    reason: "Administrative safety review",
    appliedAt,
    resolutionNote: null,
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindUnique.mockResolvedValue({
    email: "owner@example.test",
    fullName: "Local Test Owner",
    name: null,
  });
  mocks.restrictionUpdate.mockImplementation(async ({ data }: any) => ({ ...openRestriction(), ...data }));
  mocks.sendMail.mockResolvedValue({ success: true, provider: "test", messageId: "local-test-message" });
});

describe("restriction references and lifecycle", () => {
  it("generates scoped, dated, non-repeating references", () => {
    const first = generateRestrictionReference(RESTRICTION_SCOPE.NRMS_PROPERTY, 42, appliedAt);
    const second = generateRestrictionReference(RESTRICTION_SCOPE.NRMS_PROPERTY, 42, appliedAt);

    expect(first).toMatch(/^NLS-NRP-42-20260719-[A-F0-9]{6}$/);
    expect(second).toMatch(/^NLS-NRP-42-20260719-[A-F0-9]{6}$/);
    expect(first).not.toBe(second);
  });

  it("creates an open case with a unique active restriction key", async () => {
    const create = vi.fn(async ({ data }) => ({ id: 1, ...data }));
    const client = { platformRestrictionCase: { create } };

    const result = await createRestrictionCase(client, {
      scope: RESTRICTION_SCOPE.MARKETPLACE_PROPERTY,
      ownerId: 9,
      targetId: 42,
      propertyId: 42,
      reason: "Property verification review",
      appliedByAdminId: 5,
      appliedAt,
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data).toMatchObject({
      activeKey: "MARKETPLACE_PROPERTY:42",
      scope: "MARKETPLACE_PROPERTY",
      status: "OPEN",
      ownerId: 9,
      targetId: 42,
      propertyId: 42,
      reason: "Property verification review",
      appliedByAdminId: 5,
      appliedAt,
    });
    expect(result.referenceCode).toMatch(/^NLS-MKT-42-20260719-[A-F0-9]{6}$/);
  });

  it("resolves the existing case and releases its active key", async () => {
    const current = openRestriction();
    const findFirst = vi.fn().mockResolvedValue(current);
    const update = vi.fn(async ({ data }) => ({ ...current, ...data }));
    const client = { platformRestrictionCase: { findFirst, update } };

    const result = await resolveRestrictionCase(client, {
      scope: RESTRICTION_SCOPE.NRMS_PROPERTY,
      targetId: 42,
      resolvedByAdminId: 5,
      resolutionNote: "Review completed locally",
      resolvedAt: new Date("2026-07-20T09:00:00.000Z"),
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { scope: "NRMS_PROPERTY", targetId: 42, status: "OPEN" },
      orderBy: { id: "desc" },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 77 },
      data: expect.objectContaining({
        status: "RESOLVED",
        activeKey: null,
        resolvedByAdminId: 5,
        resolutionNote: "Review completed locally",
      }),
    }));
    expect(result?.referenceCode).toBe(current.referenceCode);
  });
});

describe("restriction email delivery", () => {
  it("renders and sends an opened notice containing the appeal reference", async () => {
    const restriction = openRestriction({ reason: "Review <required> & pending" });

    const result = await sendRestrictionOpenedEmail(restriction, "Namibia Villa");

    expect(result).toEqual({ sent: true, provider: "test" });
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    const [to, subject, html, attachments, options] = mocks.sendMail.mock.calls[0];
    expect(to).toBe("owner@example.test");
    expect(subject).toContain(restriction.referenceCode);
    expect(html).toContain(restriction.referenceCode);
    expect(html).toContain("Namibia Villa");
    expect(html).toContain("Review &lt;required&gt; &amp; pending");
    expect(html).not.toContain("Review <required>");
    expect(attachments).toBeUndefined();
    expect(options).toEqual({ bypassEligibilityCheck: true, replyTo: "partnerships@nolsaf.com" });
    expect(mocks.restrictionUpdate).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { notificationEmailSentAt: expect.any(Date), notificationEmailError: null },
    });
  });

  it("records provider failures without claiming that delivery succeeded", async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error("Local provider unavailable"));

    const result = await sendRestrictionOpenedEmail(openRestriction(), "Namibia Villa");

    expect(result).toEqual({ sent: false, error: "Local provider unavailable" });
    expect(mocks.restrictionUpdate).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { notificationEmailError: "Local provider unavailable" },
    });
  });

  it("uses the original reference in the restoration email", async () => {
    const restriction = openRestriction({
      status: "RESOLVED",
      activeKey: null,
      resolutionNote: "The compliance review is complete.",
      resolvedAt: new Date("2026-07-20T09:00:00.000Z"),
    });

    const result = await sendRestrictionResolvedEmail(restriction, "Namibia Villa");

    expect(result).toEqual({ sent: true, provider: "test" });
    const [, subject, html] = mocks.sendMail.mock.calls[0];
    expect(subject).toContain(restriction.referenceCode);
    expect(html).toContain(restriction.referenceCode);
    expect(html).toContain("The compliance review is complete.");
    expect(mocks.restrictionUpdate).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { resolutionEmailSentAt: expect.any(Date), resolutionEmailError: null },
    });
  });
});

