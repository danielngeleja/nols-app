import assert from "node:assert/strict";
import test from "node:test";

import {
  doesRoleHintMatchAccount,
  isPostAuthTargetAllowed,
  roleHomePath,
  shouldResolveWorkspaceSelection,
  validatedPostAuthTarget,
} from "./lib/postAuthRouting.ts";

test("maps every authenticated role to its own home", () => {
  assert.equal(roleHomePath("ADMIN"), "/admin/home");
  assert.equal(roleHomePath("OWNER"), "/owner");
  assert.equal(roleHomePath("DRIVER"), "/driver");
  assert.equal(roleHomePath("AGENT"), "/account/agent");
  assert.equal(roleHomePath("NRMS_AGENT"), "/agent-portal");
  assert.equal(roleHomePath("USER"), "/account");
  assert.equal(roleHomePath("CUSTOMER"), "/account");
  assert.equal(roleHomePath(undefined), "/account");
});

test("only ordinary customer roles enter workspace selection", () => {
  assert.equal(shouldResolveWorkspaceSelection("USER"), true);
  assert.equal(shouldResolveWorkspaceSelection("CUSTOMER"), true);
  assert.equal(shouldResolveWorkspaceSelection("ADMIN"), false);
  assert.equal(shouldResolveWorkspaceSelection("OWNER"), false);
  assert.equal(shouldResolveWorkspaceSelection("DRIVER"), false);
  assert.equal(shouldResolveWorkspaceSelection("AGENT"), false);
  assert.equal(shouldResolveWorkspaceSelection("NRMS_AGENT"), false);
  assert.equal(shouldResolveWorkspaceSelection(undefined), false);
});

test("rejects protected portal targets for the wrong account role", () => {
  assert.equal(isPostAuthTargetAllowed("/owner", "USER"), false);
  assert.equal(isPostAuthTargetAllowed("/owner/properties", "DRIVER"), false);
  assert.equal(isPostAuthTargetAllowed("/driver", "OWNER"), false);
  assert.equal(isPostAuthTargetAllowed("/admin/home", "OWNER"), false);
  assert.equal(isPostAuthTargetAllowed("/account/agent", "USER"), false);
  assert.equal(isPostAuthTargetAllowed("/agent-portal", "AGENT"), true);

  assert.equal(isPostAuthTargetAllowed("/owner", "OWNER"), true);
  assert.equal(isPostAuthTargetAllowed("/driver/earnings", "DRIVER"), true);
  assert.equal(isPostAuthTargetAllowed("/admin/home", "ADMIN"), true);
  assert.equal(isPostAuthTargetAllowed("/account/agent/assignments", "AGENT"), true);
  assert.equal(isPostAuthTargetAllowed("/agent-portal/bookings", "NRMS_AGENT"), true);
});

test("keeps NRMS membership routes available to authenticated staff", () => {
  assert.equal(isPostAuthTargetAllowed("/owner/nrms?propertyId=17", "USER"), true);
  assert.equal(isPostAuthTargetAllowed("/owner/nrms/front-desk", "AGENT"), true);
  assert.equal(isPostAuthTargetAllowed("/owner/nrms", ""), false);
  assert.equal(isPostAuthTargetAllowed("/owner/nrms", "NRMS_AGENT"), true);
});

test("treats a portal role hint as intent instead of authenticated role truth", () => {
  assert.equal(doesRoleHintMatchAccount("owner", "OWNER"), true);
  assert.equal(doesRoleHintMatchAccount("owner", "USER"), false);
  assert.equal(doesRoleHintMatchAccount("owner", "ADMIN"), false);
  assert.equal(doesRoleHintMatchAccount("admin", "ADMIN"), true);
  assert.equal(doesRoleHintMatchAccount("admin", "USER"), false);
  assert.equal(doesRoleHintMatchAccount("driver", "DRIVER"), true);
  assert.equal(doesRoleHintMatchAccount("agent", "NRMS_AGENT"), true);
  assert.equal(doesRoleHintMatchAccount("traveller", "CUSTOMER"), true);
  assert.equal(doesRoleHintMatchAccount("traveller", "OWNER"), false);
});

test("rejects malformed return targets", () => {
  assert.equal(isPostAuthTargetAllowed("https://evil.example/owner", "OWNER"), false);
  assert.equal(isPostAuthTargetAllowed("//evil.example/owner", "OWNER"), false);
  assert.equal(isPostAuthTargetAllowed("/\\evil.example/owner", "OWNER"), false);
  assert.equal(isPostAuthTargetAllowed("/%E0%A4%A", "OWNER"), false);
});

test("exhaustive role, role-hint, and destination matrix", () => {
  const roles = ["ADMIN", "OWNER", "DRIVER", "AGENT", "NRMS_AGENT", "USER", "CUSTOMER", ""];
  const hints = ["", "admin", "owner", "partner", "partners", "driver", "agent", "traveller", "customer", "unknown"];
  const targets = [
    ["/admin", new Set(["ADMIN"])],
    ["/admin/home?tab=security", new Set(["ADMIN"])],
    ["/owner", new Set(["OWNER", "ADMIN"])],
    ["/owner/properties/42?tab=bookings", new Set(["OWNER", "ADMIN"])],
    ["/driver", new Set(["DRIVER", "ADMIN"])],
    ["/driver/earnings/history", new Set(["DRIVER", "ADMIN"])],
    ["/account/agent", new Set(["AGENT", "ADMIN"])],
    ["/account/agent/assignments/9", new Set(["AGENT", "ADMIN"])],
    ["/agent-portal", new Set(["AGENT", "NRMS_AGENT", "ADMIN"])],
    ["/agent-portal/bookings", new Set(["AGENT", "NRMS_AGENT", "ADMIN"])],
    ["/owner/nrms?propertyId=17", new Set(["ADMIN", "OWNER", "DRIVER", "AGENT", "NRMS_AGENT", "USER", "CUSTOMER"])],
    ["/account/bookings?tab=upcoming", new Set(roles)],
    ["/public/properties/serengeti", new Set(roles)],
  ];

  const hintRoles = {
    admin: new Set(["ADMIN"]),
    owner: new Set(["OWNER"]),
    partner: new Set(["OWNER"]),
    partners: new Set(["OWNER"]),
    driver: new Set(["DRIVER"]),
    agent: new Set(["AGENT", "NRMS_AGENT"]),
    traveller: new Set(["USER", "CUSTOMER"]),
    customer: new Set(["USER", "CUSTOMER"]),
  };

  let assertions = 0;
  for (const role of roles) {
    for (const hint of hints) {
      for (const [target, allowedRoles] of targets) {
        const hintAllows = hintRoles[hint] ? hintRoles[hint].has(role) : true;
        const expected = allowedRoles.has(role) && hintAllows ? target : null;
        assert.equal(
          validatedPostAuthTarget(target, hint, role),
          expected,
          `role=${role || "missing"}, hint=${hint || "none"}, target=${target}`,
        );
        assertions += 1;
      }
    }
  }
  assert.equal(assertions, 1040);
});

test("normalizes tricky same-origin paths before applying role policy", () => {
  const deniedForUser = [
    "/OWNER",
    "/OwNeR/Properties",
    "/%6fwner",
    "/owner%2Fproperties",
    "/account/../owner",
    "/public/../admin/home",
    "/driver/../admin/home",
  ];
  for (const target of deniedForUser) {
    assert.equal(validatedPostAuthTarget(target, "", "USER"), null, target);
  }

  assert.equal(validatedPostAuthTarget("  /owner?tab=home  ", "owner", "owner"), "/owner?tab=home");
  assert.equal(validatedPostAuthTarget("/ADMIN/home", "admin", "admin"), "/ADMIN/home");
  assert.equal(validatedPostAuthTarget("/account", "traveller", "customer"), "/account");
});

test("twenty thousand generated cross-role redirect attempts obey the independent policy matrix", () => {
  const roles = ["ADMIN", "OWNER", "DRIVER", "AGENT", "NRMS_AGENT", "USER", "CUSTOMER", ""];
  const portalTargets = [
    { prefix: "/admin", allowed: new Set(["ADMIN"]) },
    { prefix: "/owner", allowed: new Set(["OWNER", "ADMIN"]) },
    { prefix: "/driver", allowed: new Set(["DRIVER", "ADMIN"]) },
    { prefix: "/account/agent", allowed: new Set(["AGENT", "ADMIN"]) },
    { prefix: "/agent-portal", allowed: new Set(["AGENT", "NRMS_AGENT", "ADMIN"]) },
  ];
  const roleHints = [
    { value: "admin", allowed: new Set(["ADMIN"]) },
    { value: "owner", allowed: new Set(["OWNER"]) },
    { value: "driver", allowed: new Set(["DRIVER"]) },
    { value: "agent", allowed: new Set(["AGENT", "NRMS_AGENT"]) },
    { value: "traveller", allowed: new Set(["USER", "CUSTOMER"]) },
    { value: "", allowed: new Set(roles) },
  ];

  let seed = 0x51af2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };

  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const role = roles[random() % roles.length];
    const portal = portalTargets[random() % portalTargets.length];
    const hint = roleHints[random() % roleHints.length];
    const suffix = `/section-${random() % 97}/record-${random() % 1009}?attempt=${attempt}#details`;
    const target = `${portal.prefix}${suffix}`;
    const expected = portal.allowed.has(role) && hint.allowed.has(role) ? target : null;
    assert.equal(
      validatedPostAuthTarget(target, hint.value, role),
      expected,
      `attempt=${attempt}, role=${role || "missing"}, hint=${hint.value || "none"}, target=${target}`,
    );
  }
});
