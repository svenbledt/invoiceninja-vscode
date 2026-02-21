import * as vscode from "vscode";
import { InvoiceNinjaClient } from "../api/invoiceNinjaClient";
import { ActiveTimerSession, AuthSession, InvoiceNinjaTask } from "../types/contracts";

const ACTIVE_TIMER_KEY = "invoiceNinja.activeTimer";

export class TimerService {
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: InvoiceNinjaClient,
  ) {}

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

    const updatedTask = await this.client.updateTask(
      session.baseUrl,
      session,
      taskId,
      {
        description: serverTask.description,
        time_log: JSON.stringify(segments),
        is_running: false,
      },
      timeoutMs,
    );

    await this.context.globalState.update(ACTIVE_TIMER_KEY, undefined);
    return updatedTask;
  }

  public async clearActiveTimer(): Promise<void> {
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
