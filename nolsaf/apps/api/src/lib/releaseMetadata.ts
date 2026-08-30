import { readFileSync } from "fs";
import path from "path";

export type ReleaseMetadata = {
  revision: string | null;
  repository: string | null;
  projectPath: string | null;
};

let bundledMetadata: ReleaseMetadata | null | undefined;

export function getReleaseMetadata(): ReleaseMetadata {
  const bundled = readBundledMetadata();
  return {
    revision: firstText(
      process.env.GIT_COMMIT_SHA,
      process.env.RAILWAY_GIT_COMMIT_SHA,
      process.env.VERCEL_GIT_COMMIT_SHA,
      process.env.APP_VERSION,
      bundled?.revision,
    ),
    repository: normalizeRepository(firstText(
      process.env.SOURCE_REPOSITORY_URL,
      process.env.GITHUB_REPOSITORY,
      bundled?.repository,
    )),
    projectPath: normalizeProjectPath(firstText(
      process.env.SOURCE_REPOSITORY_PATH,
      bundled?.projectPath,
    )),
  };
}

function readBundledMetadata(): ReleaseMetadata | null {
  if (bundledMetadata !== undefined) return bundledMetadata;
  const candidates = [
    firstText(process.env.RELEASE_METADATA_FILE),
    path.resolve(process.cwd(), "dist", "release.json"),
    path.resolve(process.cwd(), "release.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as Partial<ReleaseMetadata>;
      bundledMetadata = {
        revision: firstText(parsed.revision),
        repository: normalizeRepository(firstText(parsed.repository)),
        projectPath: normalizeProjectPath(firstText(parsed.projectPath)),
      };
      return bundledMetadata;
    } catch {
      // Try the next supported runtime location.
    }
  }
  bundledMetadata = null;
  return null;
}

function normalizeProjectPath(value: string | null): string | null {
  if (!value) return null;
  const clean = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean.split("/").some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === "..")) {
    return null;
  }
  return clean;
}

function normalizeRepository(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().replace(/\.git$/i, "").replace(/\/$/, "");
  const scpStyle = clean.match(/^git@github\.com:(.+)$/i);
  if (scpStyle) return `https://github.com/${scpStyle[1]}`;
  const sshStyle = clean.match(/^ssh:\/\/git@github\.com\/(.+)$/i);
  if (sshStyle) return `https://github.com/${sshStyle[1]}`;
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) return `https://github.com/${clean}`;
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (clean) return clean.slice(0, 500);
  }
  return null;
}
