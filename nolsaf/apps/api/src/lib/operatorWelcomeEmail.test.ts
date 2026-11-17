import { describe, expect, it } from "vitest";
import { generateOperatorWelcomeEmail } from "./operatorWelcomeEmail.js";
import { ADVANCE_BASE_PERCENT, ADVANCE_MAX_PERCENT, BALANCE_DISPUTE_WINDOW_HOURS } from "./tourPayoutPolicy.js";

const base = { name: "Amina", companyName: "Serengeti <Tours>", origin: "https://www.nolsaf.com/", createdAt: new Date("2026-11-18T07:30:00Z") };

describe("operator welcome email", () => {
  it("leads with the steps to become bookable and one button into the workspace", () => {
    const { subject, html } = generateOperatorWelcomeEmail(base);
    expect(subject).toBe("Welcome to NoLSAF: your first steps as an operator");
    for (const step of ["Complete your company profile", "Upload your documents", "Create packages travellers can book", "Add your mobile money payout account"]) {
      expect(html).toContain(step);
    }
    // One button into the workspace; the steps themselves carry no links.
    expect(html).not.toContain("/account/agent/profile?view=packages");
    expect(html).not.toContain("/account/agent/revenues");
    expect(html).toContain('href="https://www.nolsaf.com/account/agent"');
    expect(html).toContain("bank transfers are not available for now");
  });

  it("asks for the agreement signature only when it is pending", () => {
    expect(generateOperatorWelcomeEmail(base).html).not.toContain("Sign your partnership agreement");
    expect(generateOperatorWelcomeEmail({ ...base, agreementToSign: true }).html).toContain("Sign your partnership agreement");
  });

  it("states the timelines from the payout policy, not hand-typed numbers", () => {
    const { html } = generateOperatorWelcomeEmail(base);
    expect(html).toContain(`${ADVANCE_BASE_PERCENT}% of your share, up to ${ADVANCE_MAX_PERCENT}%`);
    expect(html).toContain(`${BALANCE_DISPUTE_WINDOW_HOURS} hours after it ends`);
    expect(html).toContain("3 to 30 minutes after each claim");
    expect(html).toContain("you receive your full package price");
  });

  it("carries the security notice in EAT, escapes names and keeps house style", () => {
    const { html } = generateOperatorWelcomeEmail(base);
    expect(html).toContain("EAT");
    expect(html).toContain("Serengeti &lt;Tours&gt;");
    expect(html).not.toContain("<Tours>");
    expect(html).not.toContain("—");
    expect(html).toContain("NoLSAF");
  });
});
