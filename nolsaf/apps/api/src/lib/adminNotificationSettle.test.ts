import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { autoSettleAdminNotifications } from "./adminNotificationSettle.js";

const NOW = new Date("2026-11-11T09:00:00.000Z");

function client(sources: Record<string, Array<Record<string, unknown>>>) {
  const model = (name: string) => ({ findMany: vi.fn(async () => sources[name] ?? []) });
  return {
    property: model("property"),
    jobApplication: model("jobApplication"),
    cancellationRequest: model("cancellationRequest"),
    salesLead: model("salesLead"),
    notification: { updateMany: vi.fn(async () => ({ count: 1 })) },
  } as any;
}

const alert = (id: number, kind: string, meta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, unread: false, readAt: NOW, resolvedAt: null, type: "property", requiresAction: true, meta: { notificationKind: kind, ...meta }, ...extra,
});

describe("autoSettleAdminNotifications", () => {
  it("closes a review request once the property was approved, with the reason and no admin", async () => {
    const c = client({ property: [{ id: 7, status: "APPROVED" }] });
    const closed = await autoSettleAdminNotifications([alert(1, "property_submitted", { propertyId: 7, propertyTitle: "NoLSAF VILLA" }, { unread: true })], NOW, c);
    expect(closed.get(1)).toBe("The property was approved.");
    const call = c.notification.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1, resolvedAt: null });
    expect(call.data).toMatchObject({ unread: false, readAt: NOW, resolvedAt: NOW, resolvedById: null, meta: { propertyTitle: "NoLSAF VILLA", autoResolved: "The property was approved." } });
  });

  it("leaves it open while the property is still waiting", async () => {
    const c = client({ property: [{ id: 7, status: "PENDING" }] });
    expect((await autoSettleAdminNotifications([alert(1, "property_submitted", { propertyId: 7 })], NOW, c)).size).toBe(0);
    expect(c.notification.updateMany).not.toHaveBeenCalled();
  });

  it("closes a career application once it was reviewed, and a cancellation once decided", async () => {
    const c = client({ jobApplication: [{ id: 3, status: "SHORTLISTED" }], cancellationRequest: [{ id: 9, status: "REVIEWING" }, { id: 10, status: "REJECTED" }] });
    const closed = await autoSettleAdminNotifications([
      alert(1, "careers_application_submitted", { applicationId: 3 }),
      alert(2, "cancellation_submitted", { requestId: 9 }),
      alert(3, "cancellation_submitted", { requestId: 10 }),
    ], NOW, c);
    expect([...closed.keys()].sort()).toEqual([1, 3]);
    expect(closed.get(3)).toBe("The cancellation was rejected.");
  });

  it("never touches resolved alerts, information-only alerts, or kinds without a rule", async () => {
    const c = client({ property: [{ id: 7, status: "APPROVED" }] });
    const closed = await autoSettleAdminNotifications([
      alert(1, "property_submitted", { propertyId: 7 }, { resolvedAt: NOW }),
      alert(2, "property_approved", { propertyId: 7 }, { requiresAction: false }),
      alert(3, "payment_unmatched", { paymentEventId: 4 }),
    ], NOW, c);
    expect(closed.size).toBe(0);
    expect(c.property.findMany).not.toHaveBeenCalled();
  });
});
