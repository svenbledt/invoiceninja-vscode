import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKLOG_SECTION_END,
  WORKLOG_SECTION_START,
  addIntervalToWorklogMap,
  localDateKey,
  mergeDescriptionWithWorklog,
  worklogMapKey,
} from "../worklogUtils";

function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("mergeDescriptionWithWorklog appends a new section to the bottom when none exists", () => {
  const now = Math.floor(new Date(2026, 0, 15, 12, 0, 0).getTime() / 1000);
  const date = localDateKey(now);
  const result = mergeDescriptionWithWorklog(
    "Existing task description",
    { [worklogMapKey(date, "repo-a")]: 3660 },
    now,
  );

  assert.ok(result.startsWith("Existing task description\n\n"));
  assert.match(result, new RegExp(`- ${date} \\| repo-a \\| 3660s`));
  assert.equal(countMatches(result, WORKLOG_SECTION_START), 1);
  assert.equal(countMatches(result, WORKLOG_SECTION_END), 1);
});

test("mergeDescriptionWithWorklog updates existing section entries without duplicates", () => {
  const now = Math.floor(new Date(2026, 0, 15, 12, 0, 0).getTime() / 1000);
  const date = localDateKey(now);
  const existing = [
    "Top",
    WORKLOG_SECTION_START,
    `- ${date} | repo-a | 120s`,
    WORKLOG_SECTION_END,
  ].join("\n");

  const result = mergeDescriptionWithWorklog(
    existing,
    {
      [worklogMapKey(date, "repo-a")]: 60,
      [worklogMapKey(date, "repo-b")]: 30,
    },
    now,
  );

  assert.match(result, new RegExp(`- ${date} \\| repo-a \\| 180s`));
  assert.match(result, new RegExp(`- ${date} \\| repo-b \\| 30s`));
  assert.equal(countMatches(result, `- ${date} | repo-a |`), 1);
});

test("mergeDescriptionWithWorklog preserves user text outside of managed section", () => {
  const now = Math.floor(new Date(2026, 0, 15, 12, 0, 0).getTime() / 1000);
  const date = localDateKey(now);
  const existing = [
    "Intro text",
    "",
    WORKLOG_SECTION_START,
    `- ${date} | repo-a | 120s`,
    WORKLOG_SECTION_END,
    "",
    "Footer text",
  ].join("\n");

  const result = mergeDescriptionWithWorklog(
    existing,
    { [worklogMapKey(date, "repo-a")]: 30 },
    now,
  );

  assert.ok(result.startsWith("Intro text\n\n"));
  assert.ok(result.endsWith("\n\nFooter text"));
  assert.match(result, new RegExp(`- ${date} \\| repo-a \\| 150s`));
});

test("mergeDescriptionWithWorklog appends a fresh section when markers are malformed", () => {
  const now = Math.floor(new Date(2026, 0, 15, 12, 0, 0).getTime() / 1000);
  const date = localDateKey(now);
  const existing = `${WORKLOG_SECTION_START}\n- ${date} | repo-a | 120s`;

  const result = mergeDescriptionWithWorklog(
    existing,
    { [worklogMapKey(date, "repo-a")]: 30 },
    now,
  );

  assert.ok(result.startsWith(`${WORKLOG_SECTION_START}\n- ${date} | repo-a | 120s`));
  assert.equal(countMatches(result, WORKLOG_SECTION_START), 2);
  assert.equal(countMatches(result, WORKLOG_SECTION_END), 1);
  assert.match(result, new RegExp(`- ${date} \\| repo-a \\| 30s`));
});

test("mergeDescriptionWithWorklog prunes entries older than 14 days", () => {
  const now = Math.floor(new Date(2026, 0, 20, 12, 0, 0).getTime() / 1000);
  const oldDate = localDateKey(now - (20 * 86400));
  const recentDate = localDateKey(now - (3 * 86400));
  const existing = [
    WORKLOG_SECTION_START,
    `- ${oldDate} | repo-a | 200s`,
    `- ${recentDate} | repo-b | 100s`,
    WORKLOG_SECTION_END,
  ].join("\n");

  const result = mergeDescriptionWithWorklog(
    existing,
    { [worklogMapKey(recentDate, "repo-b")]: 10 },
    now,
  );

  assert.equal(result.includes(oldDate), false);
  assert.match(result, new RegExp(`- ${recentDate} \\| repo-b \\| 110s`));
});

test("addIntervalToWorklogMap splits seconds across local day boundaries", () => {
  const start = Math.floor(new Date(2026, 0, 10, 23, 59, 0).getTime() / 1000);
  const end = Math.floor(new Date(2026, 0, 11, 0, 1, 0).getTime() / 1000);
  const dayA = localDateKey(start);
  const dayB = localDateKey(end - 1);
  const worklog: Record<string, number> = {};

  addIntervalToWorklogMap(worklog, "repo-a", start, end);

  assert.equal(worklog[worklogMapKey(dayA, "repo-a")], 60);
  assert.equal(worklog[worklogMapKey(dayB, "repo-a")], 60);
});
