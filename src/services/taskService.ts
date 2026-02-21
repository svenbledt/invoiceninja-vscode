import * as vscode from "vscode";
import { AuthService } from "./authService";
import { InvoiceNinjaClient } from "../api/invoiceNinjaClient";
import { AccountPreferences, AuthSession, InvoiceNinjaProject, InvoiceNinjaTask, InvoiceNinjaTaskStatus, InvoiceNinjaUser } from "../types/contracts";

const DEFAULT_PREFS: AccountPreferences = {
  theme: "dark",
  selectedStatusId: "",
  selectedProjectId: "",
  lastSearchText: "",
  selectedTaskId: "",
};

const PREF_PREFIX = "invoiceNinja.prefs.";

export class TaskService {
  private tasks: InvoiceNinjaTask[] = [];
  private statuses: InvoiceNinjaTaskStatus[] = [];
  private projects: InvoiceNinjaProject[] = [];
  private users: InvoiceNinjaUser[] = [];

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: InvoiceNinjaClient,
    private readonly authService: AuthService,
  ) {}

  public getTasks(): InvoiceNinjaTask[] {
    return this.tasks;
  }

  public upsertTask(task: InvoiceNinjaTask): void {
    const existing = this.tasks.findIndex((candidate) => candidate.id === task.id);
    if (existing >= 0) {
      this.tasks[existing] = { ...this.tasks[existing], ...task };
      return;
    }

    if (!task.is_deleted) {
      this.tasks.unshift(task);
    }
  }

  public getStatuses(): InvoiceNinjaTaskStatus[] {
    return this.statuses;
  }

  public getProjects(): InvoiceNinjaProject[] {
    return this.projects;
  }

  public getUsers(): InvoiceNinjaUser[] {
    return this.users;
  }

  public async refresh(session: AuthSession, searchOverride?: string): Promise<void> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    const prefs = await this.getPreferences(session.accountKey);
    const search = searchOverride ?? prefs.lastSearchText;

    const list = await this.client.listTasks(
      session.baseUrl,
      session,
      {
        search,
        statusId: prefs.selectedStatusId || undefined,
        projectId: prefs.selectedProjectId || undefined,
      },
      timeoutMs,
    );

    this.tasks = list.filter((task) => !task.is_deleted);
    await this.loadFilterSources(session, timeoutMs);
  }

  public async createTask(session: AuthSession, description: string): Promise<InvoiceNinjaTask> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    const defaultClientId = String(settings.get("defaultClientId", "")).trim();
    const prefs = await this.getPreferences(session.accountKey);

    const created = await this.client.createTask(
      session.baseUrl,
      session,
      {
        description,
        client_id: defaultClientId || undefined,
        project_id: prefs.selectedProjectId || String(settings.get("defaultProjectId", "")).trim() || undefined,
        status_id: prefs.selectedStatusId || undefined,
      },
      timeoutMs,
    );

    this.tasks = [created, ...this.tasks.filter((task) => task.id !== created.id)];
    return created;
  }

  public async updateTask(session: AuthSession, taskId: string, payload: Record<string, unknown>): Promise<InvoiceNinjaTask> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    const updated = await this.client.updateTask(session.baseUrl, session, taskId, payload, timeoutMs);
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...updated } : task));
    return updated;
  }

  public async deleteTask(session: AuthSession, taskId: string): Promise<void> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    try {
      await this.client.deleteTask(session.baseUrl, session, taskId, timeoutMs);
    } catch {
      await this.client.bulkTaskAction(session.baseUrl, session, "delete", [taskId], timeoutMs);
    }
    this.tasks = this.tasks.filter((task) => task.id !== taskId);
  }

  public async archiveTask(session: AuthSession, taskId: string): Promise<void> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    try {
      await this.client.bulkTaskAction(session.baseUrl, session, "archive", [taskId], timeoutMs);
    } catch {
      await this.client.updateTask(
        session.baseUrl,
        session,
        taskId,
        {
          archived_at: Math.floor(Date.now() / 1000),
        },
        timeoutMs,
      );
    }
    this.tasks = this.tasks.filter((task) => task.id !== taskId);
  }

  public async getPreferences(accountKey: string): Promise<AccountPreferences> {
    const prefs = this.context.globalState.get<AccountPreferences>(`${PREF_PREFIX}${accountKey}`);
    return { ...DEFAULT_PREFS, ...prefs };
  }

  public async updatePreferences(accountKey: string, patch: Partial<AccountPreferences>): Promise<AccountPreferences> {
    const current = await this.getPreferences(accountKey);
    const next = { ...current, ...patch };
    await this.context.globalState.update(`${PREF_PREFIX}${accountKey}`, next);
    return next;
  }

  public async clearAccountState(accountKey: string): Promise<void> {
    this.tasks = [];
    this.statuses = [];
    this.projects = [];
    this.users = [];
    await this.context.globalState.update(`${PREF_PREFIX}${accountKey}`, undefined);
  }

  public async getSessionOrThrow(): Promise<AuthSession> {
    const session = await this.authService.getSession();
    if (!session) {
      throw new Error("Please log in first");
    }
    return session;
  }

  private async loadFilterSources(session: AuthSession, timeoutMs: number): Promise<void> {
    try {
      this.projects = await this.client.listProjects(session.baseUrl, session, timeoutMs);
    } catch {
      this.projects = this.deriveProjectsFromTasks(this.tasks);
    }

    try {
      this.statuses = await this.client.listTaskStatuses(session.baseUrl, session, timeoutMs);
    } catch {
      this.statuses = this.deriveStatusesFromTasks(this.tasks);
    }

    try {
      this.users = await this.client.listUsers(session.baseUrl, session, timeoutMs);
    } catch {
      this.users = [];
    }
  }

  private deriveProjectsFromTasks(tasks: InvoiceNinjaTask[]): InvoiceNinjaProject[] {
    const seen = new Set<string>();
    const projects: InvoiceNinjaProject[] = [];

    for (const task of tasks) {
      if (!task.project_id || seen.has(task.project_id)) {
        continue;
      }
      seen.add(task.project_id);
      projects.push({ id: task.project_id, name: task.project_id });
    }

    return projects;
  }

  private deriveStatusesFromTasks(tasks: InvoiceNinjaTask[]): InvoiceNinjaTaskStatus[] {
    const seen = new Set<string>();
    const statuses: InvoiceNinjaTaskStatus[] = [];

    for (const task of tasks) {
      const raw = task.task_status_id ?? task.status_id;
      const id = raw ? String(raw) : "";
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      statuses.push({ id, name: id });
    }

    return statuses;
  }
}
