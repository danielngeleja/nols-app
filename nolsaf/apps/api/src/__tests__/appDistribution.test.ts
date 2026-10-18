import { describe, expect, it } from "vitest";
import { appDistributionInput, defaultAppDistribution, publicAppDistribution } from "../lib/appDistribution.js";

const android = "https://play.google.com/store/apps/details?id=com.nolsaf.app";
const ios = "https://apps.apple.com/tz/app/nolsaf/id123456789";

describe("app distribution controls", () => {
  it("keeps promotions off before an admin publishes verified listings", () => {
    const publicSettings = publicAppDistribution(defaultAppDistribution);
    expect(publicSettings.enabled).toBe(false);
    expect(publicSettings.androidStoreUrl).toBeNull();
    expect(publicSettings.iosStoreUrl).toBeNull();
  });

  it("accepts official Android and iOS store listings", () => {
    const result = appDistributionInput.safeParse({
      ...defaultAppDistribution,
      enabled: true,
      androidEnabled: true,
      androidStoreUrl: android,
      iosEnabled: true,
      iosStoreUrl: ios,
    });
    expect(result.success).toBe(true);
  });

  it("rejects incorrect packages and lookalike store domains", () => {
    for (const url of [
      "https://play.google.com.evil.example/store/apps/details?id=com.nolsaf.app",
      "https://play.google.com/store/apps/details?id=com.other.app",
      "javascript:alert(1)",
    ]) {
      expect(appDistributionInput.safeParse({ ...defaultAppDistribution, androidEnabled: true, androidStoreUrl: url }).success).toBe(false);
    }
    expect(appDistributionInput.safeParse({ ...defaultAppDistribution, iosEnabled: true, iosStoreUrl: "https://apps.apple.com.evil.example/app/id123456789" }).success).toBe(false);
  });

  it("hides platform links when the master switch or platform switch is off", () => {
    const settings = { ...defaultAppDistribution, androidEnabled: true, androidStoreUrl: android, iosEnabled: true, iosStoreUrl: ios };
    expect(publicAppDistribution(settings).androidStoreUrl).toBeNull();
    expect(publicAppDistribution({ ...settings, enabled: true, androidEnabled: false }).androidStoreUrl).toBeNull();
    expect(publicAppDistribution({ ...settings, enabled: true, androidEnabled: false }).iosStoreUrl).toBe(ios);
  });

  it("requires a visible placement before promotions can be enabled", () => {
    const result = appDistributionInput.safeParse({
      ...defaultAppDistribution,
      enabled: true,
      showOnHome: false,
      showInFooter: false,
      androidEnabled: true,
      androidStoreUrl: android,
    });
    expect(result.success).toBe(false);
  });
});
