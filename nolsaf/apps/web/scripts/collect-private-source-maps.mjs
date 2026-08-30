import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const staticRoot = path.join(webRoot, ".next", "static");
const repositoryRoot = path.resolve(webRoot, "../..");
const packageJson = JSON.parse(await fs.readFile(path.join(webRoot, "package.json"), "utf8"));
const release = sanitizeSegment(
  process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || process.env.APP_VERSION
    || gitRevision()
    || packageJson.version
    || "unknown"
);
const artifactRoot = path.join(repositoryRoot, "artifacts", "source-maps", release);

const files = await walk(staticRoot).catch(() => []);
let mapCount = 0;
const collectedMaps = [];

for (const file of files) {
  if (!file.endsWith(".map")) continue;
  const relative = path.relative(staticRoot, file);
  const destination = path.join(artifactRoot, "_next", "static", relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(file, destination);
  await fs.rm(file, { force: true });
  collectedMaps.push({
    file: destination,
    keyPath: path.posix.join("_next", "static", relative.split(path.sep).join("/")),
  });
  mapCount += 1;
}

// Remove browser-visible map references after extracting the private maps.
for (const file of files) {
  if (!/\.(?:js|mjs)$/.test(file)) continue;
  const source = await fs.readFile(file, "utf8");
  const stripped = source.replace(/\n?\/\/[#@]\s*sourceMappingURL=.*?(?=\r?\n|$)/g, "");
  if (stripped !== source) await fs.writeFile(file, stripped, "utf8");
}

await uploadPrivateSourceMaps(collectedMaps, release);
console.log(`[source-maps] collected ${mapCount} private map${mapCount === 1 ? "" : "s"} for release ${release}`);

async function uploadPrivateSourceMaps(maps, releaseName) {
  const bucket = clean(process.env.SOURCE_MAP_UPLOAD_BUCKET);
  const required = /^true$/i.test(clean(process.env.SOURCE_MAP_UPLOAD_REQUIRED) || "");
  if (!bucket) {
    if (required) throw new Error("SOURCE_MAP_UPLOAD_REQUIRED is true but SOURCE_MAP_UPLOAD_BUCKET is missing");
    return;
  }
  if (maps.length === 0) throw new Error("No browser source maps were generated for private upload");

  const region = clean(process.env.SOURCE_MAP_AWS_REGION || process.env.AWS_REGION);
  if (!region) throw new Error("SOURCE_MAP_AWS_REGION or AWS_REGION is required for source-map upload");
  const prefix = safePrefix(process.env.SOURCE_MAP_S3_PREFIX || "source-maps");
  const [{ PutObjectCommand, S3Client }, oidc] = await Promise.all([
    import("@aws-sdk/client-s3"),
    process.env.VERCEL_OIDC_TOKEN
      ? import("@vercel/oidc-aws-credentials-provider")
      : Promise.resolve(null),
  ]);

  const clientOptions = { region };
  if (process.env.VERCEL_OIDC_TOKEN) {
    const roleArn = clean(process.env.SOURCE_MAP_AWS_ROLE_ARN || process.env.AWS_ROLE_ARN);
    if (!roleArn) throw new Error("SOURCE_MAP_AWS_ROLE_ARN or AWS_ROLE_ARN is required for Vercel OIDC upload");
    clientOptions.credentials = oidc.awsCredentialsProvider({ roleArn });
  }

  const s3 = new S3Client(clientOptions);
  let cursor = 0;
  const workerCount = Math.min(8, maps.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < maps.length) {
      const map = maps[cursor++];
      const body = await fs.readFile(map.file);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}/${releaseName}/${map.keyPath}`,
        Body: body,
        ContentType: "application/json",
        CacheControl: "private, max-age=31536000, immutable",
        ServerSideEncryption: "AES256",
        Metadata: { release: releaseName },
      }));
    }
  }));
  console.log(`[source-maps] uploaded ${maps.length} private maps for release ${releaseName}`);
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}

function sanitizeSegment(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160) || "unknown";
}

function safePrefix(value) {
  const parts = String(value).replace(/\\/g, "/").split("/").filter(Boolean);
  const safe = parts.filter((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..");
  return safe.length ? safe.join("/") : "source-maps";
}

function clean(value) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result || null;
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
