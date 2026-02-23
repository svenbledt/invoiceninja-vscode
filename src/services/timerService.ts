import * as path from "path";
import * as vscode from "vscode";
import { InvoiceNinjaClient } from "../api/invoiceNinjaClient";
import { ActiveTimerSession, AuthSession, InvoiceNinjaTask } from "../types/contracts";
import { addIntervalToWorklogMap, mergeDescriptionWithWorklog } from "./worklogUtils";

const ACTIVE_TIMER_KEY = "invoiceNinja.activeTimer";
const WORKLOG_RETENTION_DAYS = 14;
const AUTO_APPEND_WORKLOG_SETTING = "autoAppendWorkspaceWorklog";

export class TimerService {
  private activeTimerVersion = 0;
  private workspaceChangeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: InvoiceNinjaClient,
  ) {
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.workspaceChangeQueue = this.workspaceChangeQueue
          .then(() => this.handleActiveEditorChange(editor))
          .catch(() => undefined);
      }),
    );
  }

  public async getActiveTimer(): Promise<ActiveTimerSession | null> {
    return this.context.globalState.get<ActiveTimerSession>(ACTIVE_TIMER_KEY) ?? null;
  }

  public async startTimer(session: AuthSession, task: InvoiceNinjaTask): Promise<ActiveTimerSession> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    const now = this.nowUnix();

    const serverTask = await this.client.getTask(session.baseUrl, session, task.id, timeoutMs);
    const segments = parseTimeLog(serverTask.time_log);
    const openSegment = segments.find((segment) => !segment[1] || segment[1] <= 0);
    if (!openSegment) {
      segments.push([now, 0]);
    }

    await this.client.updateTask(
      session.baseUrl,
      session,
      task.id,
      {
        description: serverTask.description || task.description,
        time_log: JSON.stringify(segments),
        is_running: true,
      },
      timeoutMs,
    );

    const active: ActiveTimerSession = {
      accountKey: session.accountKey,
      baseUrl: session.baseUrl,
      taskId: task.id,
      taskLabel: task.description || "Task",
      startedAtUnix: openSegment ? openSegment[0] : now,
    };
    if (this.isWorklogEnabled()) {
      active.worklogCurrentWorkspace = this.resolveWorkspaceLabel(vscode.window.activeTextEditor);
      active.worklogSegmentStartedAtUnix = now;
      active.worklogDailyWorkspaceSeconds = {};
    }

    this.activeTimerVersion += 1;
    await this.context.globalState.update(ACTIVE_TIMER_KEY, active);
    return active;
  }

  public async stopTimer(session: AuthSession, taskId: string): Promise<InvoiceNinjaTask> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    const now = this.nowUnix();

    const serverTask = await this.client.getTask(session.baseUrl, session, taskId, timeoutMs);
    const segments = parseTimeLog(serverTask.time_log);
    const openIndex = segments.findIndex((segment) => !segment[1] || segment[1] <= 0);

    if (openIndex >= 0) {
      segments[openIndex][1] = now;
    } else {
      segments.push([now, now]);
    }

    const active = await this.getActiveTimer();
    const shouldMergeWorklog =
      this.isWorklogEnabled() &&
      active &&
      active.taskId === taskId &&
      active.accountKey === session.accountKey &&
      active.baseUrl === session.baseUrl;

    let description = serverTask.description ?? "";
    if (shouldMergeWorklog && active) {
      const worklog = { ...(active.worklogDailyWorkspaceSeconds ?? {}) };
      this.closeCurrentWorkspaceSegment(worklog, active, now);
      if (Object.keys(worklog).length > 0) {
        description = mergeDescriptionWithWorklog(serverTask.description, worklog, now, WORKLOG_RETENTION_DAYS);
      }
    }

    const updatedTask = await this.client.updateTask(
      session.baseUrl,
      session,
      taskId,
      {
        description,
        time_log: JSON.stringify(segments),
        is_running: false,
      },
      timeoutMs,
    );

    this.activeTimerVersion += 1;
    await this.context.globalState.update(ACTIVE_TIMER_KEY, undefined);
    return updatedTask;
  }

  public async clearActiveTimer(): Promise<void> {
    this.activeTimerVersion += 1;
    await this.context.globalState.update(ACTIVE_TIMER_KEY, undefined);
  }

  public formatElapsedSeconds(timer: ActiveTimerSession | null): number {
    if (!timer) {
      return 0;
    }

    return Math.max(0, this.nowUnix() - timer.startedAtUnix);
  }

  private nowUnix(): number {
    return Math.floor(Date.now() / 1000);
  }

  private isWorklogEnabled(): boolean {
    return Boolean(vscode.workspace.getConfiguration("invoiceNinja").get(AUTO_APPEND_WORKLOG_SETTING, false));
  }

  private async handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!this.isWorklogEnabled()) {
      return;
    }

    const versionAtStart = this.activeTimerVersion;
    const active = await this.getActiveTimer();
    if (!active || versionAtStart !== this.activeTimerVersion) {
      return;
    }

    const now = this.nowUnix();
    const nextWorkspace = this.resolveWorkspaceLabel(editor);
    const currentWorkspace = (active.worklogCurrentWorkspace ?? "").trim();
    const currentSegmentStart = Number(active.worklogSegmentStartedAtUnix ?? 0);
    const nextWorklog = { ...(active.worklogDailyWorkspaceSeconds ?? {}) };

    let changed = false;
    if (!currentWorkspace || !Number.isFinite(currentSegmentStart) || currentSegmentStart <= 0) {
      active.worklogCurrentWorkspace = nextWorkspace;
      active.worklogSegmentStartedAtUnix = now;
      active.worklogDailyWorkspaceSeconds = nextWorklog;
      changed = true;
    } else if (nextWorkspace !== currentWorkspace) {
      addIntervalToWorklogMap(nextWorklog, currentWorkspace, currentSegmentStart, now);
      active.worklogCurrentWorkspace = nextWorkspace;
      active.worklogSegmentStartedAtUnix = now;
      active.worklogDailyWorkspaceSeconds = nextWorklog;
      changed = true;
    }

    if (!changed || versionAtStart !== this.activeTimerVersion) {
      return;
    }

    const latest = await this.getActiveTimer();
    if (!latest || versionAtStart !== this.activeTimerVersion || !this.isSameTimer(latest, active)) {
      return;
    }

    await this.context.globalState.update(ACTIVE_TIMER_KEY, active);
  }

  private closeCurrentWorkspaceSegment(worklog: Record<string, number>, active: ActiveTimerSession, nowUnix: number): void {
    const workspace = (active.worklogCurrentWorkspace ?? "").trim() || this.resolveWorkspaceLabel(vscode.window.activeTextEditor);
    const segmentStart = Number(active.worklogSegmentStartedAtUnix ?? active.startedAtUnix);
    if (!workspace || !Number.isFinite(segmentStart) || segmentStart <= 0 || segmentStart >= nowUnix) {
      return;
    }

    addIntervalToWorklogMap(worklog, workspace, segmentStart, nowUnix);
  }

  private resolveWorkspaceLabel(editor: vscode.TextEditor | undefined): string {
    const document = editor?.document;
    const uri = document?.uri;
    if (uri) {
      let folder: vscode.WorkspaceFolder | undefined;
      try {
        folder = vscode.workspace.getWorkspaceFolder(uri);
      } catch {
        folder = undefined;
      }
      const folderName = folder?.name?.trim();
      if (folderName) {
        return folderName;
      }

      if (document?.isUntitled || uri.scheme === "untitled") {
        return "Untitled document";
      }

      if (uri.scheme === "file" && uri.fsPath) {
        const fileName = path.basename(uri.fsPath).trim();
        if (fileName) {
          return fileName;
        }

        const fileParent = path.basename(path.dirname(uri.fsPath)).trim();
        if (fileParent) {
          return fileParent;
        }
      }

      const fromUriPath = path.posix.basename(uri.path || "").trim();
      if (fromUriPath) {
        try {
          return decodeURIComponent(fromUriPath);
        } catch {
          return fromUriPath;
        }
      }
    }

    const fromDocumentName = path.basename(document?.fileName || "").trim();
    if (fromDocumentName) {
      return fromDocumentName;
    }

    const rootFolderName = vscode.workspace.workspaceFolders?.[0]?.name?.trim();
    if (rootFolderName) {
      return rootFolderName;
    }

    const workspaceFile = vscode.workspace.workspaceFile;
    if (workspaceFile?.scheme === "file" && workspaceFile.fsPath) {
      const workspaceName = path.parse(workspaceFile.fsPath).name.trim();
      if (workspaceName) {
        return workspaceName;
      }
    }

    return "Untitled document";
  }

  private isSameTimer(a: ActiveTimerSession, b: ActiveTimerSession): boolean {
    return a.accountKey === b.accountKey && a.baseUrl === b.baseUrl && a.taskId === b.taskId && a.startedAtUnix === b.startedAtUnix;
  }
}

export function parseTimeLog(raw: string | undefined): Array<[number, number]> {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const result: Array<[number, number]> = [];
    for (const segment of parsed) {
      if (!Array.isArray(segment) || segment.length < 2) {
        continue;
      }

      const start = Number(segment[0]);
      const end = Number(segment[1]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        result.push([Math.floor(start), Math.floor(end)]);
      }
    }
    return result;
  } catch {
    return [];
  }
}
