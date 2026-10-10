import { describe, expect, it } from "vitest";
import { getDataExportAlertEmail } from "./authEmailTemplates.js";

describe("data download alert email", () => {
  it("names when and how, escapes what the client sent, and never carries data", () => {
    const { subject, html } = getDataExportAlertEmail({ when: "09 Oct 2026, 20:15 EAT", format: "Readable document (PDF)", device: "Chrome on <script>", ip: "41.59.1.2", securityUrl: "https://www.nolsaf.com/account/security" });
    expect(subject).toBe("A copy of your NoLSAF data was downloaded");
    expect(html).toContain("09 Oct 2026, 20:15 EAT");
    expect(html).toContain("41.59.1.2");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("/account/security");
  });
});
