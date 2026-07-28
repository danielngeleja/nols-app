import { describe, expect, it } from "vitest";
import {
  SALES_INVITATION_TTL_MS,
  createSalesContractInvitation,
  hashSalesInvitationToken,
} from "../lib/salesContractInvitation.js";
import { salesAgreementInvitationEmail } from "../lib/salesPartnerEmails.js";

describe("sales contract invitations", () => {
  it("generates unique URL-safe tokens and stores a one-way digest", () => {
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    const now = new Date("2026-07-26T10:00:00.000Z");
    const first = createSalesContractInvitation(expiresAt, now);
    const second = createSalesContractInvitation(expiresAt, now);

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).toBe(hashSalesInvitationToken(first.token));
    expect(first.tokenHash).not.toContain(first.token);
    expect(second.token).not.toBe(first.token);
  });

  it("expires after seven days or at contract expiry, whichever is sooner", () => {
    const now = new Date("2026-07-26T10:00:00.000Z");
    const longContract = createSalesContractInvitation(new Date("2027-07-26T10:00:00.000Z"), now);
    const shortContractExpiry = new Date("2026-07-28T10:00:00.000Z");
    const shortContract = createSalesContractInvitation(shortContractExpiry, now);

    expect(longContract.expiresAt.getTime()).toBe(now.getTime() + SALES_INVITATION_TTL_MS);
    expect(shortContract.expiresAt).toEqual(shortContractExpiry);
  });

  it("renders a login-bound invitation without allowing HTML injection", () => {
    const email = salesAgreementInvitationEmail({
      recipientName: "<script>alert(1)</script>",
      agentCode: "NSA-DAR-0001",
      contractNumber: "NSC-2026-00001",
      invitationUrl: "https://www.nolsaf.com/sales/invite?t=safe_token",
      invitationExpiresAt: new Date("2026-08-02T10:00:00.000Z"),
    });

    expect(email.subject).toContain("NSC-2026-00001");
    expect(email.html).toContain("https://www.nolsaf.com/sales/invite?t=safe_token");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("normal NoLSAF authentication is still required");
    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain("Agreement details");
    expect(email.html).toContain("All rights reserved");
  });
});
