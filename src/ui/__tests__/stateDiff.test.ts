import test from "node:test";
import assert from "node:assert/strict";
import { SidebarState } from "../../types/contracts";
import { isTimerOnlyStateUpdate, taskSignature } from "../webview/stateDiff";

function baseState(): SidebarState {
  return {
    authenticated: true,
    mode: "cloud",
    authForm: { email: "a@b.com", url: "https://invoicing.co", secret: "" },
    accountLabel: "Test",
    baseUrl: "https://invoicing.co",
    tasks: [
      {
        id: "1",
        description: "Task One",
        task_status_id: "new",
        duration: 0,
        time_log: "[]",
      },
    ],
    statuses: [{ id: "new", name: "New" }],
    projects: [],
    users: [],
    selectedTaskId: "1",
    selectedStatusId: "",
    selectedProjectId: "",
    lastSearchText: "",
    autoAppendWorkspaceWorklog: false,
    isTimerRunning: true,
    timerTaskId: "1",
    timerElapsedSeconds: 10,
    editTask: null,
    errorMessage: "",
    infoMessage: "",
  };
}

test("taskSignature changes when task visual data changes", () => {
  const a = taskSignature({ id: "1", description: "Task", task_status_id: "1" });
  const b = taskSignature({ id: "1", description: "Task updated", task_status_id: "1" });
  assert.notEqual(a, b);
});

test("isTimerOnlyStateUpdate detects timer tick updates", () => {
  const previous = baseState();
  const next = {
    ...baseState(),
    timerElapsedSeconds: 11,
  };
  assert.equal(isTimerOnlyStateUpdate(previous, next), true);
});

test("isTimerOnlyStateUpdate rejects structural task changes", () => {
  const previous = baseState();
  const next = {
    ...baseState(),
    timerElapsedSeconds: 11,
    tasks: [{ ...baseState().tasks[0], description: "Changed" }],
  };
  assert.equal(isTimerOnlyStateUpdate(previous, next), false);
});
