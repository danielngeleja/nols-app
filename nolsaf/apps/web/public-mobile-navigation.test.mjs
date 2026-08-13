import assert from "node:assert/strict";
import test from "node:test";

import { hidesPublicMobileNavigation } from "./lib/publicMobileNavigation.ts";

test("hides the public mobile navigation throughout the sales portal", () => {
  for (const pathname of [
    "/sales",
    "/sales/contract",
    "/sales/leads",
    "/sales/leads/42",
    "/sales/support",
  ]) {
    assert.equal(hidesPublicMobileNavigation(pathname), true, pathname);
  }
});

test("keeps the public mobile navigation on public and customer routes", () => {
  for (const pathname of [
    "/public",
    "/public/properties",
    "/account",
    "/account/rides",
  ]) {
    assert.equal(hidesPublicMobileNavigation(pathname), false, pathname);
  }
});
