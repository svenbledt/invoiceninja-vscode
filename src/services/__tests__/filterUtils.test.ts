import test from "node:test";
import assert from "node:assert/strict";
import { FILTER_VALUE_ALL, FILTER_VALUE_NONE } from "../../types/contracts";
import { matchesFilterSelection, normalizeFilterSelection, toApiFilterValue } from "../filterUtils";

test("normalizeFilterSelection defaults empty values to all", () => {
  assert.equal(normalizeFilterSelection(""), FILTER_VALUE_ALL);
  assert.equal(normalizeFilterSelection("   "), FILTER_VALUE_ALL);
  assert.equal(normalizeFilterSelection(undefined), FILTER_VALUE_ALL);
});

test("toApiFilterValue strips all/none pseudo values", () => {
  assert.equal(toApiFilterValue(FILTER_VALUE_ALL), undefined);
  assert.equal(toApiFilterValue(FILTER_VALUE_NONE), undefined);
  assert.equal(toApiFilterValue(""), undefined);
  assert.equal(toApiFilterValue("project-1"), "project-1");
});

test("matchesFilterSelection supports all/none/specific semantics", () => {
  assert.equal(matchesFilterSelection(FILTER_VALUE_ALL, "project-1"), true);
  assert.equal(matchesFilterSelection(FILTER_VALUE_NONE, ""), true);
  assert.equal(matchesFilterSelection(FILTER_VALUE_NONE, "project-1"), false);
  assert.equal(matchesFilterSelection("project-1", "project-1"), true);
  assert.equal(matchesFilterSelection("project-1", "project-2"), false);
});
