import test from "node:test";
import assert from "node:assert/strict";
import { taskElapsedSeconds } from "../timeUtils";

test("taskElapsedSeconds reads hh:mm:ss duration strings", () => {
  const seconds = taskElapsedSeconds({ duration: "1:02:03", time_log: "[]" });
  assert.equal(seconds, 3723);
});

test("taskElapsedSeconds handles decimal hours", () => {
  const seconds = taskElapsedSeconds({ duration: "1.5", time_log: "[]" });
  assert.equal(seconds, 5400);
});

test("taskElapsedSeconds falls back to time log segments", () => {
  const seconds = taskElapsedSeconds({ time_log: "[[10,40],[100,0]]" }, 120);
  assert.equal(seconds, 50);
});
