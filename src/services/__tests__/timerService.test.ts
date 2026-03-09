import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import type { AuthSession, InvoiceNinjaTask } from "../../types/contracts";
import type { InvoiceNinjaClient } from "../../api/invoiceNinjaClient";

type ConfigValues = {
  requestTimeoutMs?: number;
  autoAppendWorkspaceWorklog?: boolean;
};

function installVscodeMock(config: ConfigValues = {}): () => void {
  const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
  const cfg = {
    requestTimeoutMs: 15000,
    autoAppendWorkspaceWorklog: false,
    ...config,
  };

  const vscodeMock = {
    window: {
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
    },
    workspace: {
      getConfiguration: () => ({
        get: <T>(section: string, defaultValue: T): T => {
          if (section === "requestTimeoutMs") {
            return cfg.requestTimeoutMs as T;
          }
          if (section === "autoAppendWorkspaceWorklog") {
            return cfg.autoAppendWorkspaceWorklog as T;
          }
          return defaultValue;
        },
      }),
      getWorkspaceFolder: () => undefined,
      workspaceFolders: undefined,
      workspaceFile: undefined,
    },
  };

  (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patchedLoad(request: unknown, parent: unknown, isMain: unknown): unknown {
    if (request === "vscode") {
      return vscodeMock;
    }
    return originalLoad(request, parent, isMain);
  };

  return () => {
    (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = originalLoad;
  };
}

function createContext(initialState: Record<string, unknown> = {}): {
  context: vscode.ExtensionContext;
  state: Map<string, unknown>;
} {
  const state = new Map<string, unknown>(Object.entries(initialState));
  const context = {
    subscriptions: [],
    globalState: {
      get<T>(key: string, defaultValue?: T): T | undefined {
        if (state.has(key)) {
          return state.get(key) as T;
        }
        return defaultValue;
      },
      async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
          state.delete(key);
          return;
        }
        state.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;

  return { context, state };
}

function createClientMock(overrides: {
  getTask?: InvoiceNinjaClient["getTask"];
  updateTask?: InvoiceNinjaClient["updateTask"];
}): InvoiceNinjaClient {
  const client = {
    getTask: overrides.getTask ?? (async () => ({ id: "task-1", description: "Task", number: "1", time_log: "[]" }) as InvoiceNinjaTask),
    updateTask: overrides.updateTask ?? (async (_baseUrl, _session, taskId, payload) => ({ id: taskId, description: String(payload.description ?? ""), number: "1", time_log: String(payload.time_log ?? "[]"), is_running: false }) as InvoiceNinjaTask),
  };

  return client as unknown as InvoiceNinjaClient;
}

async function loadTimerServiceModule(): Promise<typeof import("../timerService")> {
  const modulePath = require.resolve("../timerService");
  delete require.cache[modulePath];
  return import("../timerService");
}

function createSession(): AuthSession {
  return {
    mode: "cloud",
    baseUrl: "https://invoicing.co",
    email: "user@example.com",
    apiToken: "token",
    apiSecret: "",
    accountLabel: "Invoice Ninja",
    accountKey: "acc-1",
  };
}

test("stopTimer queues unsynced stop and replays successfully later", async () => {
  const restore = installVscodeMock();
  try {
    const { TimerService } = await loadTimerServiceModule();
    const { context, state } = createContext({
      "invoiceNinja.activeTimer": {
        accountKey: "acc-1",
        baseUrl: "https://invoicing.co",
        taskId: "task-1",
        taskLabel: "Task 1",
        startedAtUnix: 100,
      },
    });

    let updateCalls = 0;
    const failingClient = createClientMock({
      getTask: async () => ({ id: "task-1", description: "Task 1", number: "1", time_log: "[[100,0]]" }),
      updateTask: async () => {
        updateCalls += 1;
        throw new Error("network down");
      },
    });

    const service = new TimerService(context, failingClient);
    const result = await service.stopTimer(createSession(), "task-1");
    assert.equal(result.synced, false);
    assert.equal(updateCalls, 1);

    const pendingAfterStop = state.get("invoiceNinja.pendingStops.v1") as unknown[];
    assert.equal(Array.isArray(pendingAfterStop), true);
    assert.equal(pendingAfterStop.length, 1);

    const replayClient = createClientMock({
      updateTask: async (_baseUrl, _session, taskId, payload) => ({
        id: taskId,
        description: String(payload.description ?? ""),
        number: "1",
        time_log: String(payload.time_log ?? "[]"),
        is_running: false,
      }),
    });
    const replayService = new TimerService(context, replayClient);
    const updated = await replayService.flushPendingStops(createSession());
    assert.equal(updated.length, 1);
    assert.equal((state.get("invoiceNinja.pendingStops.v1") as unknown[]).length, 0);
  } finally {
    restore();
  }
});

test("stopTimer dedupes rapid duplicate stop requests", async () => {
  const restore = installVscodeMock();
  const originalNow = Date.now;
  Date.now = () => 1700000000000;
  try {
    const { TimerService } = await loadTimerServiceModule();
    const { context, state } = createContext({
      "invoiceNinja.activeTimer": {
        accountKey: "acc-1",
        baseUrl: "https://invoicing.co",
        taskId: "task-1",
        taskLabel: "Task 1",
        startedAtUnix: 100,
      },
    });

    const client = createClientMock({
      getTask: async () => ({ id: "task-1", description: "Task 1", number: "1", time_log: "[[100,0]]" }),
      updateTask: async () => {
        throw new Error("still offline");
      },
    });
    const service = new TimerService(context, client);
    await Promise.all([
      service.stopTimer(createSession(), "task-1"),
      service.stopTimer(createSession(), "task-1"),
    ]);

    const pending = state.get("invoiceNinja.pendingStops.v1") as unknown[];
    assert.equal(Array.isArray(pending), true);
    assert.equal(pending.length, 1);
  } finally {
    Date.now = originalNow;
    restore();
  }
});

test("stopTimer includes merged worklog text in queued payload", async () => {
  const restore = installVscodeMock({ autoAppendWorkspaceWorklog: true });
  try {
    const { TimerService } = await loadTimerServiceModule();
    const { context, state } = createContext({
      "invoiceNinja.activeTimer": {
        accountKey: "acc-1",
        baseUrl: "https://invoicing.co",
        taskId: "task-1",
        taskLabel: "Task 1",
        startedAtUnix: 100,
        worklogCurrentWorkspace: "repo-a",
        worklogSegmentStartedAtUnix: 150,
        worklogDailyWorkspaceSeconds: {
          "2026-01-15::repo-a": 60,
        },
      },
    });

    const client = createClientMock({
      getTask: async () => ({ id: "task-1", description: "Task 1", number: "1", time_log: "[[100,0]]" }),
      updateTask: async () => {
        throw new Error("offline");
      },
    });

    const service = new TimerService(context, client);
    await service.stopTimer(createSession(), "task-1");

    const pending = state.get("invoiceNinja.pendingStops.v1") as Array<{ payload: { description: string } }>;
    assert.equal(pending.length, 1);
    assert.match(pending[0].payload.description, /repo-a/);
  } finally {
    restore();
  }
});
