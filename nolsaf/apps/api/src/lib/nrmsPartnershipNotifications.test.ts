import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notificationCreate: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({
  prisma: { notification: { create: mocks.notificationCreate } },
}));

import { notifyOwner, notifyUser } from "./notifications.js";

describe("NRMS partnership notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationCreate.mockImplementation(async ({ data }: any) => ({ id: 1, createdAt: new Date(), ...data }));
  });

  it("gives a hotel a specific, actionable operator-request notification", async () => {
    await notifyOwner(41, "nrms_agent_partnership_requested", {
      linkId: 72,
      agencyName: "Kilimanjaro Travel",
      propertyTitle: "Sheraton Hotel",
      transition: "REQUESTED",
    });

    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 41,
        title: "New accommodation partnership request",
        body: expect.stringContaining("Kilimanjaro Travel"),
        meta: expect.objectContaining({ linkId: 72, transition: "REQUESTED", notificationKind: "nrms_agent_partnership_requested" }),
      }),
    });
  });

  it("gives an operator a specific activation notification with delivery evidence", async () => {
    await notifyUser(84, "nrms_partnership_activated", {
      linkId: 72,
      propertyTitle: "Sheraton Hotel",
      transition: "ACTIVE",
    });

    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 84,
        title: "Hotel partnership activated",
        body: expect.stringContaining("Sheraton Hotel"),
        meta: expect.objectContaining({ linkId: 72, transition: "ACTIVE", notificationKind: "nrms_partnership_activated" }),
      }),
    });
  });

  it("uses explicit suspension language for both parties", async () => {
    await notifyOwner(41, "nrms_partnership_suspended", { propertyTitle: "Sheraton Hotel", agencyName: "Kilimanjaro Travel", reason: "Compliance review" });
    await notifyUser(84, "nrms_partnership_suspended", { propertyTitle: "Sheraton Hotel", reason: "Compliance review" });

    const [ownerCall, agentCall] = mocks.notificationCreate.mock.calls;
    expect(ownerCall?.[0].data.title).toBe("Accommodation partnership suspended");
    expect(agentCall?.[0].data.title).toBe("Hotel partnership suspended");
    expect(ownerCall?.[0].data.body).toContain("Compliance review");
    expect(agentCall?.[0].data.body).toContain("Compliance review");
  });

  it("tells the hotel when central authority resumes a partnership", async () => {
    await notifyOwner(41, "nrms_partnership_activated", { propertyTitle: "Sheraton Hotel", agencyName: "Kilimanjaro Travel", reason: "Review completed", transition: "ACTIVE" });
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 41,
        title: "Accommodation partnership active",
        body: expect.stringContaining("Review completed"),
        meta: expect.objectContaining({ transition: "ACTIVE", notificationKind: "nrms_partnership_activated" }),
      }),
    });
  });
});
