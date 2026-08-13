import { describe, expect, it } from "vitest";
import { getFinanceOtpEmail } from "./financeOtpEmail.js";

describe("finance OTP email", () => {
  it("renders a short branded security email with the shared footer", () => {
    const email = getFinanceOtpEmail({ code: "976546", expiryMinutes: 10 });

    expect(email.subject).toBe("NoLSAF finance verification code");
    expect(email.html).toContain("Finance verification code");
    expect(email.html).toContain("976546");
    expect(email.html).toContain("This code expires in 10 minutes.");
    expect(email.html).toContain("Do not share this code with anyone.");
    expect(email.html).toContain("support@nolsaf.com");
    expect(email.html).toContain("nolsaf.com");
    expect(email.html).toContain("background:#eaf7f4");
  });

  it("keeps only six numeric code characters", () => {
    const email = getFinanceOtpEmail({ code: "97A65-46<script>", expiryMinutes: 10 });

    expect(email.html).toContain("976546");
    expect(email.html).not.toContain("97A65-46");
    expect(email.html).not.toContain("&lt;script&gt;");
  });
});
