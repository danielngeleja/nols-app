import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./components/CookieConsent.tsx", import.meta.url), "utf8");

test("cookie consent presents concise, explicit choices", () => {
  assert.match(source, /Your privacy, your choice/);
  assert.match(source, /Essential only/);
  assert.match(source, /Accept all/);
  assert.match(source, /Manage choices/);
  assert.doesNotMatch(source, /support our marketing efforts/);
});

test("cookie consent uses a compact centered glass dialog", () => {
  assert.match(source, /grid place-items-center/);
  assert.match(source, /max-w-\[380px\]/);
  assert.match(source, /bg-white\/95/);
  assert.match(source, /bg-\[#002b27\]\/60/);
  assert.match(source, /backdrop-blur-xl/);
  assert.match(source, /aria-modal="true"/);
});

test("NoLSAF brand casing is preserved", () => {
  assert.match(source, />\s*NoLSAF privacy\s*</);
  assert.doesNotMatch(source, /font-bold uppercase[^\n]*NoLSAF privacy/);
});

test("optional cookies default off and each decision stores exact preferences", () => {
  assert.match(source, /useState\(false\).*analytics/s);
  assert.match(source, /useState\(false\).*marketing/s);
  assert.match(source, /save\("accepted", \{ analytics: true, marketing: true \}\)/);
  assert.match(source, /save\("declined", \{ analytics: false, marketing: false \}\)/);
  assert.doesNotMatch(source, /prefs\?\.analytics \?\? true/);
});

test("custom preferences record declined when no optional category is selected", () => {
  assert.match(
    source,
    /save\(analytics \|\| marketing \? "accepted" : "declined", \{ analytics, marketing \}\)/
  );
});
