import fs from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "dist");

const JS_EXTS = [".js", ".mjs", ".cjs", ".json", ".node"];

function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../");
}

function hasKnownExt(spec) {
  return JS_EXTS.some((ext) => spec.endsWith(ext));
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveWithJsExtension(fileDir, spec) {
  // Try direct file.js
  const direct = path.resolve(fileDir, `${spec}.js`);
  if (await fileExists(direct)) return `${spec}.js`;

  // Try folder/index.js
  const idx = path.resolve(fileDir, spec, "index.js");
  if (await fileExists(idx)) return `${spec}/index.js`;

  return null;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...(await walk(full)));
    else if (e.isFile() && e.name.endsWith(".js")) results.push(full);
  }
  return results;
}

function rewriteInFile(content, rewriteMap) {
  let out = content;
  for (const [from, to] of rewriteMap) {
    // Replace only full-quoted specifiers to avoid accidental partial matches.
    out = out
      .replaceAll(`"${from}"`, `"${to}"`)
      .replaceAll(`'${from}'`, `'${to}'`);
  }
  return out;
}

(async () => {
  const files = await walk(distDir);

  // The compiled local db singleton — @nolsaf/prisma is replaced with this.
  const dbJsPath = path.resolve(distDir, "src", "lib", "db.js");

  for (const file of files) {
    const fileDir = path.dirname(file);
    let src = await fs.readFile(file, "utf8");

    // ── Rewrite @nolsaf/prisma → relative path to the local db.js ──────────
    if (src.includes('"@nolsaf/prisma"') || src.includes("'@nolsaf/prisma'")) {
      let rel = path.relative(fileDir, dbJsPath).replace(/\\/g, "/");
      if (!rel.startsWith(".")) rel = "./" + rel;
      src = src
        .replaceAll('"@nolsaf/prisma"', `"${rel}"`)
        .replaceAll("'@nolsaf/prisma'", `'${rel}'`);
    }

    // Capture static import/export specifiers.
    // Examples:
    //   import "./env";
    //   import x from "./routes/auth";
    //   export * from "../lib/foo";
    const specRe = /\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.[^"']+)["']/g;

    const rewriteMap = new Map();
    let m;
    while ((m = specRe.exec(src)) !== null) {
      const spec = m[1];
      if (!isRelative(spec)) continue;
      if (hasKnownExt(spec)) continue;
      if (spec.includes("?") || spec.includes("#")) continue;

      // Avoid rewriting paths that already point to a directory with trailing slash.
      if (spec.endsWith("/")) continue;

      // Only rewrite if the target exists.
      // Note: resolve relative specifier against fileDir.
      const resolved = await resolveWithJsExtension(fileDir, spec);
      if (resolved) rewriteMap.set(spec, resolved);
    }

    const out = rewriteMap.size > 0 ? rewriteInFile(src, rewriteMap) : src;
    const original = await fs.readFile(file, "utf8");
    if (out !== original) {
      await fs.writeFile(file, out, "utf8");
    }
  }

  console.log("[fix-esm-imports] done");
})().catch((err) => {
  console.error("[fix-esm-imports] failed", err);
  process.exit(1);
});
