import assert from "node:assert/strict";
import test from "node:test";

import { signedInLoginDestination } from "./lib/postAuthRouting.ts";

const expectedHomes = {
  ADMIN: "/admin/home",
  OWNER: "/owner",
  DRIVER: "/driver",
  AGENT: "/account/agent",
  USER: "/account",
  CUSTOMER: "/account",
};

test("middleware sends every mismatched portal login to the authenticated role home", () => {
  const portalCases = [
    ["owner", "/owner"],
    ["admin", "/admin/home"],
    ["driver", "/driver"],
    ["agent", "/account/agent"],
    ["traveller", "/account"],
  ];

  let checks = 0;
  for (const [role, expectedHome] of Object.entries(expectedHomes)) {
    for (const [hint, target] of portalCases) {
      const expectedPath =
        (role === "OWNER" && hint === "owner") ||
        (role === "ADMIN" && hint === "admin") ||
        (role === "DRIVER" && hint === "driver") ||
        (role === "AGENT" && hint === "agent") ||
        ((role === "USER" || role === "CUSTOMER") && hint === "traveller")
          ? target
          : expectedHome;

      assert.equal(signedInLoginDestination(target, hint, role), expectedPath, `${role} through ${hint}`);
      checks += 1;
    }
  }
  assert.equal(checks, 30);
});

test("middleware ignores a protected next target that conflicts with the token role", () => {
  const cases = [
    ["USER", "/owner", "/account"],
    ["CUSTOMER", "/admin/home", "/account"],
    ["OWNER", "/driver", "/owner"],
    ["DRIVER", "/account/agent", "/driver"],
    ["AGENT", "/admin/home", "/account/agent"],
  ];

  for (const [role, next, expected] of cases) {
    assert.equal(signedInLoginDestination(next, "", role), expected);
  }
});
