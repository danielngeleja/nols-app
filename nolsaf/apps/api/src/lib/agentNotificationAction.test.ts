import { describe, expect, it } from "vitest";
import { agentNotificationAction } from "./agentNotificationAction.js";

describe("operator notification shortcuts", () => {
  it("sends the contract notice to the agreement, as something to do", () => {
    expect(agentNotificationAction({ notificationKind: "agent_contract_ready" }, "agent")).toEqual({
      topic: "account", href: "/account/agent/contract", label: "Review and sign", needsAction: true,
    });
  });

  it("opens a paid booking by its reference, never its row id", () => {
    const action = agentNotificationAction({ notificationKind: "agent_tour_booking_paid", tourBookingId: 4321 }, "agent");
    expect(action.topic).toBe("bookings");
    expect(action.href).toMatch(/^\/account\/agent\/tour-bookings\/tr_[A-Za-z0-9_-]+$/);
    expect(action.href).not.toContain("4321");
  });

  it("rewrites an old numeric booking link to the reference", () => {
    const action = agentNotificationAction({ link: "/account/agent/tour-bookings/77" });
    expect(action.href).toMatch(/\/tour-bookings\/tr_/);
  });

  it("opens cancellation cases by booking code, from the stored absolute URL too", () => {
    const action = agentNotificationAction(
      { href: "https://evil.example/account/agent/cancellations", caseId: 9, bookingCode: "TR-ABC 1", kind: "EVIDENCE_REQUESTED" },
      "cancellation",
    );
    expect(action).toEqual({
      topic: "cancellations",
      href: "/account/agent/cancellations?view=all&booking=TR-ABC%201",
      label: "Add evidence",
      needsAction: true,
    });
  });

  it("filters the earnings page to the right stage", () => {
    expect(agentNotificationAction({ notificationKind: "agent_balance_claimable" }).href).toBe("/account/agent/revenues?track=NEW");
    expect(agentNotificationAction({ notificationKind: "agent_payout_rejected" }).href).toBe("/account/agent/revenues?track=REJECTED");
  });

  it("never links off the site", () => {
    expect(agentNotificationAction({ href: "https://evil.example/phish" }).href).toBeNull();
    expect(agentNotificationAction({ href: "//evil.example/phish" }).href).toBeNull();
    expect(agentNotificationAction({ notificationKind: "admin_message", href: "javascript:alert(1)" }).href).toBeNull();
  });
});
