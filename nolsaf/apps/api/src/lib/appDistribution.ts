import { z } from "zod";

export const defaultAppDistribution = {
  enabled: false,
  showOnHome: true,
  showInFooter: true,
  headline: "Take NoLSAF with you",
  description: "Plan and manage your trip in the NoLSAF app.",
  androidEnabled: false,
  androidStoreUrl: null as string | null,
  iosEnabled: false,
  iosStoreUrl: null as string | null,
};

function validStoreUrl(value: string | null, platform: "android" | "ios"): boolean {
  if (value === null) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    if (platform === "android") {
      return url.hostname === "play.google.com"
        && url.pathname === "/store/apps/details"
        && url.searchParams.get("id") === "com.nolsaf.app";
    }
    return url.hostname === "apps.apple.com"
      && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

const storeUrl = z.string().trim().max(500).nullable();

export const appDistributionInput = z.object({
  enabled: z.boolean(),
  showOnHome: z.boolean(),
  showInFooter: z.boolean(),
  headline: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(300),
  androidEnabled: z.boolean(),
  androidStoreUrl: storeUrl,
  iosEnabled: z.boolean(),
  iosStoreUrl: storeUrl,
}).strict().superRefine((value, context) => {
  if (!validStoreUrl(value.androidStoreUrl, "android")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["androidStoreUrl"], message: "Use the official Google Play listing for com.nolsaf.app." });
  }
  if (!validStoreUrl(value.iosStoreUrl, "ios")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["iosStoreUrl"], message: "Use an official Apple App Store listing URL ending in a numeric app ID." });
  }
  if (value.androidEnabled && !value.androidStoreUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["androidStoreUrl"], message: "Add the Google Play listing before enabling Android." });
  }
  if (value.iosEnabled && !value.iosStoreUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["iosStoreUrl"], message: "Add the App Store listing before enabling iOS." });
  }
  if (value.enabled && !value.androidEnabled && !value.iosEnabled) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["enabled"], message: "Enable at least one platform first." });
  }
  if (value.enabled && !value.showOnHome && !value.showInFooter) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["enabled"], message: "Choose at least one website placement first." });
  }
});

type AppDistribution = typeof defaultAppDistribution;

export function publicAppDistribution(input: AppDistribution) {
  const enabled = input.enabled && (
    (input.androidEnabled && !!input.androidStoreUrl && validStoreUrl(input.androidStoreUrl, "android"))
    || (input.iosEnabled && !!input.iosStoreUrl && validStoreUrl(input.iosStoreUrl, "ios"))
  );
  return {
    enabled,
    showOnHome: enabled && input.showOnHome,
    showInFooter: enabled && input.showInFooter,
    headline: input.headline,
    description: input.description,
    androidStoreUrl: enabled && input.androidEnabled && validStoreUrl(input.androidStoreUrl, "android") ? input.androidStoreUrl : null,
    iosStoreUrl: enabled && input.iosEnabled && validStoreUrl(input.iosStoreUrl, "ios") ? input.iosStoreUrl : null,
  };
}
