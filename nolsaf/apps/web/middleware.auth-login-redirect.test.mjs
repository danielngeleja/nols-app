import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthLoginRedirect,
  isSafeRelativeLoginTarget,
} from "./lib/authLoginRedirect.ts";

test("redirects the account login alias before React renders", () => {
  const result = buildAuthLoginRedirect(
    new URL(
      "https://nolsaf.com/account/login?next=%2Faccount%2Fbookings%3Ftab%3Dupcoming&role=traveller&ref=partner-12",
    ),
  );

  assert.ok(result);
  assert.equal(result.origin, "https://nolsaf.com");
  assert.equal(result.pathname, "/account/register");
  assert.equal(result.searchParams.get("mode"), "login");
  assert.equal(result.searchParams.get("next"), "/account/bookings?tab=upcoming");
  assert.equal(result.searchParams.get("role"), "traveller");
  assert.equal(result.searchParams.get("ref"), "partner-12");
});

test("redirects the general login alias and drops unrelated query parameters", () => {
  const result = buildAuthLoginRedirect(
    new URL("https://nolsaf.com/login?utm_source=legacy"),
  );

  assert.ok(result);
  assert.equal(result.href, "https://nolsaf.com/account/register?mode=login");
});

test("applies role-specific defaults for portal login aliases", () => {
  const cases = [
    ["/owner/login", "owner", "/owner"],
    ["/driver/login", "driver", "/driver"],
    ["/admin/login", "admin", "/admin/home"],
  ];

  for (const [pathname, role, next] of cases) {
    const result = buildAuthLoginRedirect(new URL(`https://nolsaf.com${pathname}`));
    assert.ok(result);
    assert.equal(result.pathname, "/account/register");
    assert.equal(result.searchParams.get("mode"), "login");
    assert.equal(result.searchParams.get("role"), role);
    assert.equal(result.searchParams.get("next"), next);
  }
});

test("keeps a safe explicit destination for role-specific aliases", () => {
  const result = buildAuthLoginRedirect(
    new URL("https://nolsaf.com/owner/login?next=%2Fowner%2Fnrms%3FpropertyId%3D17"),
  );

  assert.ok(result);
  assert.equal(result.searchParams.get("role"), "owner");
  assert.equal(result.searchParams.get("next"), "/owner/nrms?propertyId=17");
});

test("rejects external and protocol-relative next targets", () => {
  const external = buildAuthLoginRedirect(
    new URL("https://nolsaf.com/account/login?next=https%3A%2F%2Fevil.example"),
  );
  const protocolRelative = buildAuthLoginRedirect(
    new URL("https://nolsaf.com/driver/login?next=%2F%2Fevil.example"),
  );

  assert.ok(external);
  assert.equal(external.searchParams.has("next"), false);
  assert.ok(protocolRelative);
  assert.equal(protocolRelative.searchParams.get("next"), "/driver");
  assert.equal(isSafeRelativeLoginTarget("https://evil.example"), false);
  assert.equal(isSafeRelativeLoginTarget("//evil.example"), false);
  assert.equal(isSafeRelativeLoginTarget("/account"), true);
});

test("does not redirect the unified destination or unrelated routes", () => {
  assert.equal(
    buildAuthLoginRedirect(new URL("https://nolsaf.com/account/register?mode=login")),
    null,
  );
  assert.equal(buildAuthLoginRedirect(new URL("https://nolsaf.com/public")), null);
});
