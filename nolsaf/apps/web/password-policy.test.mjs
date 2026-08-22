import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PASSWORD_POLICY,
  normalizePasswordPolicy,
  validatePasswordAgainstPolicy,
} from "./lib/passwordPolicy.ts";

test("client accepts the same ordinary password as the API", () => {
  assert.equal(validatePasswordAgainstPolicy("CorrectHorse1!", DEFAULT_PASSWORD_POLICY).valid, true);
});

test("client does not mark emoji or whitespace as an accepted special character", () => {
  assert.equal(validatePasswordAgainstPolicy("CorrectHorse1😀", DEFAULT_PASSWORD_POLICY).valid, false);
  const spaced = validatePasswordAgainstPolicy("CorrectHorse1 ", DEFAULT_PASSWORD_POLICY);
  assert.equal(spaced.valid, false);
  assert.equal(spaced.requirements.find((item) => item.id === "special")?.pass, false);
  assert.equal(spaced.requirements.find((item) => item.id === "spaces")?.pass, false);
});

test("strong is shown only when every active requirement passes", () => {
  const missingSpecial = validatePasswordAgainstPolicy("CorrectHorse1", DEFAULT_PASSWORD_POLICY);
  assert.equal(missingSpecial.valid, false);
  assert.notEqual(missingSpecial.strength, "strong");
});

test("malformed server values cannot create an impossible browser policy", () => {
  const normalized = normalizePasswordPolicy({ minLength: 500, maxLength: 2 });
  assert.equal(normalized.minLength, 8);
  assert.equal(normalized.maxLength, 128);
});
