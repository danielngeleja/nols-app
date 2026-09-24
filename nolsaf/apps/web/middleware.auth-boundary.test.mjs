import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { NextRequest } from "next/server.js";

// Execute the actual middleware, including cookie selection and redirects.
// These tokens test routing only; API signature verification is tested separately.
const source = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "([^"]+)"/g, (match, specifier) => {
  if (specifier === "next/server") return `from "${import.meta.resolve("next/server.js")}"`;
  if (specifier.startsWith("./")) return `from "${new URL(`${specifier}.ts`, import.meta.url).href}"`;
  return match;
});
const { middleware } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const token = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.routing-fixture`;
const run = (path, cookie) => middleware(new NextRequest(`https://app.nolsaf.test${path}`, { headers: { cookie } }));
const destination = (response) => response.headers.get("location") && new URL(response.headers.get("location")).pathname;

test("an owner with a stale traveller legacy cookie stays in the owner portal", () => {
  const cookie = `token=${token("CUSTOMER")}; nolsaf_token=${token("OWNER")}; role=CUSTOMER`;
  assert.equal(destination(run("/owner", cookie)), null);
  assert.equal(destination(run("/login", cookie)), "/owner");
});

test("a traveller cannot use a stale owner legacy cookie to select the owner shell", () => {
  const cookie = `token=${token("OWNER")}; nolsaf_token=${token("CUSTOMER")}; role=OWNER`;
  assert.equal(destination(run("/owner", cookie)), "/login");
  assert.equal(destination(run("/login", cookie)), "/account");
});

test("host-prefixed owner sessions use the same precedence as API authentication", () => {
  assert.equal(destination(run("/owner", `__Host-nolsaf_token=${token("OWNER")}; token=${token("CUSTOMER")}`)), null);
  assert.equal(destination(run("/login", `__Host-token=${token("OWNER")}`)), "/owner");
});

test("a writable role cookie alone cannot admit a protected portal shell", () => {
  for (const [role, path] of [["OWNER", "/owner"], ["ADMIN", "/admin/home"], ["DRIVER", "/driver"]]) {
    assert.equal(destination(run(path, `role=${role}`)), "/login");
  }
});

test("a malformed primary token does not fall back to an elevated role cookie", () => {
  assert.equal(destination(run("/admin/home", "nolsaf_token=invalid; role=ADMIN")), "/login");
});
