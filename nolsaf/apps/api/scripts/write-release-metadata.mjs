import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(apiDir, "../..");
const gitRoot = gitRootPath() || path.resolve(repositoryRoot, "..");
const output = path.join(apiDir, "dist", "release.json");

const revision = firstText(
  process.env.GIT_COMMIT_SHA,
  process.env.RENDER_GIT_COMMIT,
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.RAILWAY_GIT_COMMIT_SHA,
  git(["rev-parse", "HEAD"]),
);
const repository = normalizeRepository(firstText(
  process.env.SOURCE_REPOSITORY_URL,
  process.env.RENDER_GIT_REPO_SLUG,
  process.env.GITHUB_REPOSITORY,
  git(["config", "--get", "remote.origin.url"]),
));

if (!revision || !/^[A-Za-z0-9._-]{1,160}$/.test(revision)) {
  throw new Error("Unable to determine a safe release revision for the API bundle");
}
if (!repository) {
  throw new Error("Unable to determine the source repository URL for the API bundle");
}
const projectPath = path.relative(gitRoot, repositoryRoot).split(path.sep).join("/") || null;

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ revision, repository, projectPath }, null, 2)}\n`, "utf8");
console.log(`[release] embedded revision ${revision.slice(0, 12)} in dist/release.json`);

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function gitRootPath() {
  const result = git(["rev-parse", "--show-toplevel"]);
  return result ? path.resolve(result) : null;
}

function normalizeRepository(value) {
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

function firstText(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (clean) return clean;
  }
  return null;
}
