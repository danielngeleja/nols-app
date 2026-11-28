import assert from "node:assert/strict";
import test from "node:test";
import { listingStepOrder, restoreListingStep } from "./app/(owner)/owner/properties/add/_components/listingFlow.ts";

test("skipping event hire goes from property photos straight to review", () => {
  const order = listingStepOrder(false);
  assert.equal(order[order.indexOf(5) + 1], 7);
  assert.equal(order[order.indexOf(7) - 1], 5);
  assert.equal(order.length, 7);
});

test("opting into event hire adds a child section before review", () => {
  const order = listingStepOrder(true);
  assert.equal(order[order.indexOf(5) + 1], 6);
  assert.equal(order[order.indexOf(6) + 1], 7);
  assert.equal(order[order.indexOf(7) - 1], 6);
});

test("old drafts still reopen rooms, photos and review correctly", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => restoreListingStep(n)), [0, 2, 3, 4, 5, 7]);
  assert.equal(restoreListingStep(6, 2), 7);
  assert.equal(restoreListingStep(6, 3), 6);
  assert.equal(restoreListingStep(7, 3), 7);
  for (const value of [undefined, null, NaN, -1, 1.5, "3"]) assert.equal(restoreListingStep(value, 3), 0);
});
