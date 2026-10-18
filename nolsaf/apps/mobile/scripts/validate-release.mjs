import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(mobileRoot, "../..");
const app = JSON.parse(readFileSync(join(mobileRoot, "app.json"), "utf8")).expo;
const eas = JSON.parse(readFileSync(join(mobileRoot, "eas.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(mobileRoot, "package.json"), "utf8"));
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(app.android?.package === "com.nolsaf.app", "Android package must be com.nolsaf.app.");
assert(Number.isInteger(app.android?.versionCode) && app.android.versionCode > 0, "Android versionCode must be a positive integer.");
assert(!["portrait", "landscape"].includes(app.orientation), "The app must not lock orientation on large-screen Android devices.");
for (const permission of ["android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO"]) {
  assert(app.android?.blockedPermissions?.includes(permission), `${permission} must be blocked for Play photo/video policy.`);
}
assert(eas.build?.production?.android?.buildType === "app-bundle", "Production Android builds must use app-bundle.");
assert(String(pkg.dependencies?.expo || "").startsWith("~56."), "Expo SDK 56 is required for the current Android target SDK baseline.");
assert(Boolean(pkg.dependencies?.["expo-build-properties"]), "expo-build-properties is required for Android release optimization.");
const buildPropertiesPlugin = app.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties");
assert(buildPropertiesPlugin?.[1]?.android?.enableMinifyInReleaseBuilds === true, "Android release builds must enable R8 minification.");
assert(buildPropertiesPlugin?.[1]?.android?.enableShrinkResourcesInReleaseBuilds === true, "Android release builds must enable resource shrinking.");
assert(Boolean(pkg.dependencies?.["expo-secure-store"]), "expo-secure-store is required for session tokens.");
assert(Boolean(pkg.dependencies?.["react-native-passkeys"]), "react-native-passkeys is required for native passkeys.");
assert(Boolean(pkg.dependencies?.["socket.io-client"]), "socket.io-client is required for foreground real-time updates.");
assert(Boolean(pkg.dependencies?.["expo-notifications"]), "expo-notifications is required for phone alerts.");
assert(Boolean(pkg.dependencies?.["expo-constants"]), "expo-constants is required for the EAS push project ID.");
const notificationsPlugin = app.plugins?.find((plugin) => plugin === "expo-notifications" ||
  (Array.isArray(plugin) && plugin[0] === "expo-notifications"));
assert(Boolean(notificationsPlugin), "The expo-notifications config plugin is required for Android push.");
const notificationIcon = Array.isArray(notificationsPlugin) ? notificationsPlugin[1]?.icon : null;
const notificationIconPath = notificationIcon && resolve(mobileRoot, notificationIcon);
assert(Boolean(notificationIconPath) && existsSync(notificationIconPath), "A dedicated Android notification icon is required.");
if (notificationIconPath && existsSync(notificationIconPath)) {
  const png = readFileSync(notificationIconPath);
  assert(png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    png.readUInt32BE(16) === 96 && png.readUInt32BE(20) === 96,
    "The Android notification icon must be a 96x96 PNG.");
}
const googleServicesPath = app.android?.googleServicesFile && resolve(mobileRoot, app.android.googleServicesFile);
assert(Boolean(googleServicesPath) && existsSync(googleServicesPath), "Android google-services.json is missing.");
if (googleServicesPath && existsSync(googleServicesPath)) {
  const firebase = JSON.parse(readFileSync(googleServicesPath, "utf8"));
  assert(firebase.client?.some((client) => client.client_info?.android_client_info?.package_name === app.android.package),
    "Firebase Android package must match app.json.");
}
assert(app.ios?.associatedDomains?.includes("applinks:nolsaf.com"), "iOS must declare the nolsaf.com applinks association.");

const androidLinks = app.android?.intentFilters || [];
assert(
  androidLinks.some((filter) =>
    filter.action === "VIEW" &&
    filter.autoVerify === true &&
    filter.category?.includes("BROWSABLE") &&
    filter.data?.some((entry) => entry.scheme === "https" && entry.host === "nolsaf.com" && entry.pathPrefix === "/register")
  ),
  "Android must verify nolsaf.com/register App Links."
);

const splashPlugin = app.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen");
const splashImage = Array.isArray(splashPlugin) ? splashPlugin[1]?.image : app.splash?.image;
for (const asset of [app.icon, splashImage, app.android?.adaptiveIcon?.foregroundImage]) {
  assert(Boolean(asset) && existsSync(resolve(mobileRoot, asset)), `Configured app asset is missing: ${asset || "<unset>"}`);
}

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
function walk(path) {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (sourceExtensions.has(extname(entry))) {
      const content = readFileSync(full, "utf8");
      assert(!content.includes("../../../web/"), `Mobile source reaches into excluded web files: ${full}`);
    }
  }
}
walk(join(mobileRoot, "src"));

const assetLinks = readFileSync(join(repoRoot, "apps/web/app/.well-known/assetlinks.json/route.ts"), "utf8");
const appleAssociation = readFileSync(join(repoRoot, "apps/web/app/.well-known/apple-app-site-association/route.ts"), "utf8");
assert(assetLinks.includes("delegate_permission/common.handle_all_urls"), "Website assetlinks must authorize Android App Links.");
assert(appleAssociation.includes("/register*"), "Website Apple association must match referral registration links.");

if (process.argv.includes("--require-env")) {
  for (const name of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_WEB_URL", "EXPO_PUBLIC_SOCKET_URL"]) {
    const value = String(process.env[name] || "").trim();
    assert(/^https:\/\//i.test(value), `${name} must be set to a production HTTPS URL.`);
    assert(!/(localhost|127\.0\.0\.1|10\.0\.2\.2)/i.test(value), `${name} must not use a local development host.`);
  }
}

if (failures.length) {
  console.error("Mobile release validation failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Mobile release validation passed for ${app.android.package} versionCode ${app.android.versionCode}.`);
