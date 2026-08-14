import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, "..");
const repoRoot = resolve(apiDir, "..", "..");
const artifactPath = join(scriptDir, "eb-package-lock.json");
const rootManifestPath = join(repoRoot, "package.json");
const rootLockPath = join(repoRoot, "package-lock.json");
const apiManifestPath = join(apiDir, "package.json");
const deployLockPath = join(apiDir, "package-lock.json");

const vendoredDependencies = {
  "@nolsaf/prisma": "file:./_workspace/@nolsaf/prisma",
  "@nolsaf/shared": "file:./_workspace/@nolsaf/shared",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function packageNameFromLockPath(lockPath, entry) {
  if (typeof entry?.name === "string" && entry.name) return entry.name;
  const marker = "node_modules/";
  const markerIndex = lockPath.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const remainder = lockPath.slice(markerIndex + marker.length);
  const parts = remainder.split("/");
  return remainder.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function assertObjectEqual(actual, expected, label) {
  if (
    JSON.stringify(stableValue(actual || {})) !==
    JSON.stringify(stableValue(expected || {}))
  ) {
    throw new Error(`${label} does not match the deployment manifest`);
  }
}

function buildExpectedManifest(apiManifest, rootManifest) {
  const dependencies = {
    ...(apiManifest.dependencies || {}),
    ...vendoredDependencies,
  };
  const prismaCliVersion = apiManifest.devDependencies?.prisma;
  if (typeof prismaCliVersion !== "string" || !prismaCliVersion) {
    throw new Error("apps/api must declare the Prisma CLI in devDependencies");
  }
  dependencies.prisma = prismaCliVersion;
  const overrides = rootManifest.overrides || {};
  for (const [name, override] of Object.entries(overrides)) {
    if (
      typeof override === "string" &&
      typeof dependencies[name] === "string" &&
      dependencies[name] !== override
    ) {
      // npm rejects a standalone manifest when a direct dependency range and
      // its root override differ. Pin that deployment-only direct dependency
      // to the repository override; the source workspace manifest stays intact.
      dependencies[name] = override;
    }
  }
  const runtimeManifest = { ...apiManifest };
  delete runtimeManifest.devDependencies;
  return {
    ...runtimeManifest,
    dependencies,
    overrides,
  };
}

function validateSourceManifest(rootLock, apiManifest) {
  const lockedApiManifest = rootLock.packages?.["apps/api"];
  if (!lockedApiManifest) {
    throw new Error("Root package-lock.json has no apps/api workspace entry");
  }

  const sourceDependencies = { ...(apiManifest.dependencies || {}) };
  delete sourceDependencies["@nolsaf/prisma"];
  delete sourceDependencies["@nolsaf/shared"];
  assertObjectEqual(
    sourceDependencies,
    lockedApiManifest.dependencies,
    "API dependencies in root package-lock.json",
  );
  assertObjectEqual(
    apiManifest.devDependencies,
    lockedApiManifest.devDependencies,
    "API devDependencies in root package-lock.json",
  );
}

function validateDeployLock(deployLock, deployManifest, rootLock) {
  if (deployLock.lockfileVersion !== 3) {
    throw new Error(`Expected lockfileVersion 3, received ${deployLock.lockfileVersion}`);
  }

  const deployRoot = deployLock.packages?.[""];
  if (!deployRoot) throw new Error("EB package lock has no root package entry");
  if (deployRoot.name !== deployManifest.name || deployRoot.version !== deployManifest.version) {
    throw new Error("EB package lock root identity does not match apps/api/package.json");
  }
  assertObjectEqual(
    deployRoot.dependencies,
    deployManifest.dependencies,
    "EB package lock dependencies",
  );
  assertObjectEqual(
    deployRoot.devDependencies,
    deployManifest.devDependencies,
    "EB package lock devDependencies",
  );

  for (const [name, specifier] of Object.entries(vendoredDependencies)) {
    if (deployManifest.dependencies?.[name] !== specifier) {
      throw new Error(`Deployment manifest must wire ${name} to ${specifier}`);
    }
    const link = deployLock.packages?.[`node_modules/${name}`];
    if (!link?.link || link.resolved !== specifier.replace("file:./", "")) {
      throw new Error(`EB package lock does not contain the expected ${name} workspace link`);
    }
  }

  const rootVersions = new Set();
  for (const [lockPath, entry] of Object.entries(rootLock.packages || {})) {
    const name = packageNameFromLockPath(lockPath, entry);
    if (!name || !entry?.version) continue;
    rootVersions.add(`${name}\0${entry.version}\0${entry.integrity || ""}`);
  }

  for (const [lockPath, entry] of Object.entries(deployLock.packages || {})) {
    if (
      !lockPath ||
      lockPath.startsWith("_workspace/") ||
      entry?.link ||
      !entry?.version
    ) {
      continue;
    }
    const name = packageNameFromLockPath(lockPath, entry);
    if (!name) throw new Error(`Cannot determine package name for ${lockPath}`);
    const key = `${name}\0${entry.version}\0${entry.integrity || ""}`;
    if (!rootVersions.has(key)) {
      throw new Error(
        `EB package lock contains ${name}@${entry.version}, which is not pinned by root package-lock.json`,
      );
    }
  }

  for (const name of [
    ...Object.keys(deployManifest.dependencies || {}),
    ...Object.keys(deployManifest.devDependencies || {}),
  ]) {
    if (name in vendoredDependencies) continue;
    const deployEntry = deployLock.packages?.[`node_modules/${name}`];
    const rootEntry =
      rootLock.packages?.[`apps/api/node_modules/${name}`] ||
      rootLock.packages?.[`node_modules/${name}`];
    if (!deployEntry?.version || !rootEntry?.version) {
      throw new Error(`Cannot compare direct dependency ${name} against root package-lock.json`);
    }
    if (
      deployEntry.version !== rootEntry.version ||
      (deployEntry.integrity || "") !== (rootEntry.integrity || "")
    ) {
      throw new Error(
        `Direct dependency ${name} differs from root package-lock.json ` +
        `(${deployEntry.version} != ${rootEntry.version})`,
      );
    }
  }
}

function buildSeedLock(rootLock, deployManifest) {
  const packages = {
    "": {
      name: deployManifest.name,
      version: deployManifest.version,
      dependencies: deployManifest.dependencies,
    },
  };

  for (const [lockPath, entry] of Object.entries(rootLock.packages || {})) {
    if (!lockPath.startsWith("node_modules/") || entry?.link) continue;
    packages[lockPath] = globalThis.structuredClone(entry);
  }

  for (const name of Object.keys(deployManifest.dependencies || {})) {
    if (name in vendoredDependencies) continue;
    const workspaceEntry = rootLock.packages?.[`apps/api/node_modules/${name}`];
    if (workspaceEntry) {
      packages[`node_modules/${name}`] = globalThis.structuredClone(workspaceEntry);
    }
  }

  for (const packageName of ["prisma", "shared"]) {
    const scopeName = `@nolsaf/${packageName}`;
    const targetPath = `_workspace/@nolsaf/${packageName}`;
    const sourceEntry = rootLock.packages?.[`packages/${packageName}`];
    if (!sourceEntry) {
      throw new Error(`Root package lock has no packages/${packageName} entry`);
    }
    packages[`node_modules/${scopeName}`] = {
      resolved: targetPath,
      link: true,
    };
    packages[targetPath] = globalThis.structuredClone(sourceEntry);
  }

  return {
    name: deployManifest.name,
    version: deployManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}

function generateDeployLock(deployManifest, rootLock) {
  const tempRoot = mkdtempSync(join(tmpdir(), "nolsaf-eb-lock-"));
  try {
    writeFileSync(join(tempRoot, "package.json"), canonicalJson(deployManifest), "utf8");

    for (const packageName of ["prisma", "shared"]) {
      const sourceDir = join(repoRoot, "packages", packageName);
      const targetDir = join(tempRoot, "_workspace", "@nolsaf", packageName);
      mkdirSync(targetDir, { recursive: true });
      cpSync(join(sourceDir, "package.json"), join(targetDir, "package.json"));
    }
    writeFileSync(
      join(tempRoot, "package-lock.json"),
      canonicalJson(buildSeedLock(rootLock, deployManifest)),
      "utf8",
    );

    const npmCliCandidates = [
      process.env.npm_execpath,
      join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      process.platform === "win32"
        ? "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"
        : "/usr/lib/node_modules/npm/bin/npm-cli.js",
    ].filter(Boolean);
    const npmCli = npmCliCandidates.find(existsSync);
    if (!npmCli) {
      throw new Error("Unable to locate npm-cli.js for EB package-lock generation");
    }
    const result = spawnSync(
      process.execPath,
      [
        npmCli,
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--workspaces=false",
        "--legacy-peer-deps",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: tempRoot,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `npm failed to generate the EB package lock:\n${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`,
      );
    }

    const generated = readJson(join(tempRoot, "package-lock.json"));
    validateDeployLock(generated, deployManifest, rootLock);
    return generated;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const args = new Set(process.argv.slice(2));
const writeMode = args.has("--write");
const validateMode = args.has("--validate");
const materializeMode = args.has("--materialize");
if (args.size !== 1 || (!writeMode && !validateMode && !materializeMode)) {
  throw new Error(
    "Usage: node scripts/prepare-eb-package-lock.mjs --write|--validate|--materialize",
  );
}

const rootManifest = readJson(rootManifestPath);
const rootLock = readJson(rootLockPath);
const apiManifest = readJson(apiManifestPath);
validateSourceManifest(rootLock, apiManifest);
const deployManifest = buildExpectedManifest(apiManifest, rootManifest);

if (writeMode) {
  const generated = generateDeployLock(deployManifest, rootLock);
  const output = canonicalJson(generated);
  writeFileSync(artifactPath, output, "utf8");
  console.log(
    `[eb-lock] Wrote ${artifactPath} (${Object.keys(generated.packages || {}).length} package entries, sha256 ${sha256(output)})`,
  );
} else {
  const existing = readJson(artifactPath);
  validateDeployLock(existing, deployManifest, rootLock);
  const content = canonicalJson(existing);
  if (materializeMode) {
    writeFileSync(apiManifestPath, canonicalJson(deployManifest), "utf8");
    writeFileSync(deployLockPath, content, "utf8");
    console.log(
      `[eb-lock] Materialized deterministic package.json and package-lock.json for the EB bundle`,
    );
  }
  console.log(
    `[eb-lock] Validated ${artifactPath} (${Object.keys(existing.packages || {}).length} package entries, sha256 ${sha256(content)})`,
  );
}
