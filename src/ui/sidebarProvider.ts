import * as vscode from "vscode";
import { ApiError } from "../api/invoiceNinjaClient";
import { AuthService } from "../services/authService";
import { TaskService } from "../services/taskService";
import { TimerService } from "../services/timerService";
import { AuthMode, IncomingMessage, LoginInput, SidebarState, TaskReminder } from "../types/contracts";
import { renderSidebarHtml } from "./webview/template";
import { isTimerOnlyStateUpdate } from "./webview/stateDiff";

const VIEW_ID = "invoiceNinja.sidebar";
const REMINDER_STORAGE_KEY = "invoiceNinja.taskReminders.v1";

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly defaultBaseUrl: string;
  private readonly statusBar: vscode.StatusBarItem;
  private lastMessage = "";
  private lastError = "";
  private editTaskId = "";
  private ticker?: NodeJS.Timeout;
  private ticking = false;
  private remindersLoaded = false;
  private readonly reminderTimers = new Map<string, NodeJS.Timeout>();
  private authDraft: { mode: AuthMode; email: string; url: string; secret: string };
  private lastState: SidebarState | null = null;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly authService: AuthService,
    private readonly taskService: TaskService,
    private readonly timerService: TimerService,
  ) {
    this.defaultBaseUrl = String(vscode.workspace.getConfiguration("invoiceNinja").get("defaultBaseUrl", "https://invoicing.co"));
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.command = "invoiceNinja.showStatus";
    this.statusBar.tooltip = "Invoice Ninja timer status";
    this.statusBar.text = "$(clock) Invoice Ninja: idle";
    this.statusBar.show();
    this.authDraft = { mode: "cloud", email: "", url: this.defaultBaseUrl, secret: "" };
  }

  public static get viewId(): string {
    return VIEW_ID;
  }

  public dispose(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    this.clearReminderTimers();
    this.statusBar.dispose();
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: IncomingMessage) => {
      void this.handleMessage(message);
    });
    await this.initializeReminderScheduler();
    await this.pushState();
  }

  public async open(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.invoiceNinja");
  }

  public async refresh(): Promise<void> {
    this.lastError = "";
    this.lastMessage = "";
    try {
      const session = await this.authService.getSession();
      if (session) {
        const prefs = await this.taskService.getPreferences(session.accountKey);
        await this.taskService.refresh(session, prefs.lastSearchText);
      }
    } catch (error) {
      this.lastError = this.toUserMessage(error);
    }
    await this.pushState();
  }

  public async logout(): Promise<void> {
    const session = await this.authService.getSession();
    if (session) {
      await this.taskService.clearAccountState(session.accountKey);
    }
    this.editTaskId = "";
    await this.timerService.clearActiveTimer();
    await this.authService.logout();
    this.lastMessage = "Logged out";
    this.lastError = "";
    await this.pushState();
  }

  public async startTimerFromCommand(taskId?: string): Promise<void> {
    const session = await this.authService.getSession();
    if (!session) {
      void vscode.window.showErrorMessage("Please log in to Invoice Ninja first");
      return;
    }

    const prefs = await this.taskService.getPreferences(session.accountKey);
    const id = taskId || prefs.selectedTaskId;
    const task = this.taskService.getTasks().find((candidate) => candidate.id === id);
    if (!task) {
      void vscode.window.showErrorMessage("Select a task in the sidebar first");
      return;
    }

    try {
      await this.taskService.updatePreferences(session.accountKey, { selectedTaskId: task.id });
      await this.timerService.startTimer(session, task);
      this.taskService.upsertTask({
        ...task,
        is_running: true,
        time_log: task.time_log,
      });
      this.lastMessage = `Timer started: ${task.description || task.id}`;
      this.lastError = "";
      await this.pushState();
    } catch (error) {
      void vscode.window.showErrorMessage(this.toUserMessage(error));
    }
  }

  public async stopTimerFromCommand(taskId?: string): Promise<void> {
    const session = await this.authService.getSession();
    if (!session) {
      return;
    }
    const active = await this.timerService.getActiveTimer();
    if (!active) {
      void vscode.window.showInformationMessage("No active Invoice Ninja timer");
      return;
    }

    const id = taskId || active.taskId;
    if (id !== active.taskId) {
      void vscode.window.showInformationMessage("Only one timer can run at a time. Stop the active timer first.");
      return;
    }

    try {
      const updatedTask = await this.timerService.stopTimer(session, active.taskId);
      this.taskService.upsertTask(updatedTask);
      this.lastMessage = "Timer stopped";
      this.lastError = "";
      await this.pushState();
    } catch (error) {
      void vscode.window.showErrorMessage(this.toUserMessage(error));
    }
  }

  public async showStatus(): Promise<void> {
    const active = await this.timerService.getActiveTimer();
    if (!active) {
      void vscode.window.showInformationMessage("Invoice Ninja: no active timer");
      return;
    }

    const elapsed = this.timerService.formatElapsedSeconds(active);
    void vscode.window.showInformationMessage(`Running: ${active.taskLabel} (${formatDuration(elapsed)})`);
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    this.lastError = "";
    this.lastMessage = "";

    try {
      switch (message.type) {
        case "ready":
          break;
        case "toggleMode":
          this.authDraft.mode = message.mode;
          break;
        case "login":
          this.authDraft = {
            mode: message.payload.mode,
            email: message.payload.email,
            url: message.payload.url || this.defaultBaseUrl,
            secret: message.payload.secret || "",
          };
          await this.login(message.payload);
          break;
        case "logout":
          await this.logout();
          return;
        case "refresh":
          await this.refresh();
          return;
        case "saveTask":
          await this.saveTask(message.payload.description);
          break;
        case "search":
          await this.search(message.payload.text);
          break;
        case "selectTask":
          await this.selectTask(message.payload.taskId);
          break;
        case "setStatusFilter":
          await this.setStatus(message.payload.statusId);
          break;
        case "setProjectFilter":
          await this.setProject(message.payload.projectId);
          break;
        case "startTimer":
          await this.startTimerFromCommand(message.payload?.taskId);
          return;
        case "stopTimer":
          await this.stopTimerFromCommand(message.payload?.taskId);
          return;
        case "assignUser":
          await this.assignUser(message.payload.taskId);
          break;
        case "assignProject":
          await this.assignProject(message.payload.taskId);
          break;
        case "assignTaskStatus":
          await this.assignTaskStatus(message.payload.taskId);
          break;
        case "editTask":
          this.editTaskId = message.payload.taskId;
          break;
        case "saveTaskEdit":
          await this.saveTaskEdit(message.payload);
          break;
        case "archiveTask":
          await this.archiveTask(message.payload.taskId);
          break;
        case "deleteTask":
          await this.deleteTask(message.payload.taskId);
          break;
        case "taskReminder":
          await this.createTaskReminder(message.payload.taskId, message.payload.value);
          break;
        case "openTaskMenu":
          break;
      }
    } catch (error) {
      this.lastError = this.toUserMessage(error);
    }

    await this.pushState();
  }

  private async login(payload: LoginInput): Promise<void> {
    const session = await this.authService.login(payload);
    await this.taskService.updatePreferences(session.accountKey, { lastSearchText: "", selectedTaskId: "" });
    await this.taskService.refresh(session);
    this.lastMessage = "Logged in";
  }

  private async saveTask(description: string): Promise<void> {
    if (!description.trim()) {
      throw new Error("Please enter a task description");
    }
    const session = await this.taskService.getSessionOrThrow();
    const created = await this.taskService.createTask(session, description.trim());
    await this.taskService.updatePreferences(session.accountKey, { selectedTaskId: created.id });
    this.lastMessage = "Task created";
  }

  private async search(text: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    await this.taskService.updatePreferences(session.accountKey, { lastSearchText: text });
    await this.taskService.refresh(session, text);
  }

  private async selectTask(taskId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    await this.taskService.updatePreferences(session.accountKey, { selectedTaskId: taskId });
  }

  private async setStatus(statusId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    await this.taskService.updatePreferences(session.accountKey, { selectedStatusId: statusId });
    await this.taskService.refresh(session);
  }

  private async setProject(projectId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    await this.taskService.updatePreferences(session.accountKey, { selectedProjectId: projectId });
    await this.taskService.refresh(session);
  }

  private async assignUser(taskId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const picks = [{ label: "-- Unassigned --", value: "" }].concat(
      this.taskService.getUsers().map((user) => ({
        label: userLabel(user),
        description: user.email || "",
        value: user.id,
      })),
    );
    const picked = await vscode.window.showQuickPick(picks, { placeHolder: "Assign user" });
    if (!picked) {
      return;
    }

    await this.taskService.updateTask(session, taskId, { assigned_user_id: picked.value || "" });
    this.lastMessage = "Assigned user updated";
  }

  private async assignProject(taskId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const picks = [{ label: "-- Unassigned --", value: "" }].concat(
      this.taskService.getProjects().map((project) => ({
        label: project.name || project.id,
        description: project.id,
        value: project.id,
      })),
    );
    const picked = await vscode.window.showQuickPick(picks, { placeHolder: "Assign project" });
    if (!picked) {
      return;
    }

    await this.taskService.updateTask(session, taskId, { project_id: picked.value || "" });
    this.lastMessage = "Project updated";
  }

  private async assignTaskStatus(taskId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const picks = this.taskService.getStatuses().map((status) => ({
      label: status.name || String(status.id),
      description: String(status.id),
      value: String(status.id),
    }));
    const picked = await vscode.window.showQuickPick(picks, { placeHolder: "Set task state" });
    if (!picked) {
      return;
    }

    await this.taskService.updateTask(session, taskId, { task_status_id: picked.value, status_id: picked.value });
    this.lastMessage = "Task state updated";
  }

  private async saveTaskEdit(payload: { taskId: string; description: string; projectId: string; assignedUserId: string; rate: string }): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const rate = payload.rate.trim() === "" ? 0 : Number(payload.rate);
    await this.taskService.updateTask(session, payload.taskId, {
      description: payload.description,
      project_id: payload.projectId || "",
      assigned_user_id: payload.assignedUserId || "",
      rate: Number.isFinite(rate) ? rate : 0,
    });
    this.lastMessage = "Task updated";
    this.editTaskId = "";
  }

  private async archiveTask(taskId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    await this.taskService.archiveTask(session, taskId);
    if (this.editTaskId === taskId) {
      this.editTaskId = "";
    }
    this.lastMessage = "Task archived";
  }

  private async deleteTask(taskId: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const confirmed = await vscode.window.showWarningMessage("Delete this task?", { modal: true }, "Delete");
    if (confirmed !== "Delete") {
      return;
    }

    await this.taskService.deleteTask(session, taskId);
    await this.removeTaskReminders(session.accountKey, taskId);
    if (this.editTaskId === taskId) {
      this.editTaskId = "";
    }
    this.lastMessage = "Task deleted";
  }

  private async createTaskReminder(taskId: string, value: string): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const task = this.taskService.getTasks().find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found for reminder");
    }

    let minutes: number;
    try {
      minutes = await this.resolveReminderMinutes(value);
    } catch (error) {
      if (error instanceof Error && error.message === "Reminder cancelled") {
        return;
      }
      throw error;
    }
    if (minutes <= 0) {
      throw new Error("Reminder must be greater than 0 minutes");
    }

    const dueAtUnix = Math.floor(Date.now() / 1000) + (minutes * 60);
    const reminder: TaskReminder = {
      id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      accountKey: session.accountKey,
      taskId,
      taskLabel: (task.description || task.number || task.id || "Task").trim(),
      dueAtUnix,
      createdAtUnix: Math.floor(Date.now() / 1000),
    };
    const reminders = await this.getReminders();
    reminders.push(reminder);
    await this.saveReminders(reminders);
    this.scheduleReminder(reminder);

    this.lastMessage = `Reminder set in ${minutes} minute${minutes === 1 ? "" : "s"}`;
    this.lastError = "";
  }

  private async resolveReminderMinutes(value: string): Promise<number> {
    const normalized = value.trim().toLowerCase();
    if (normalized === "5 minutes") {
      return 5;
    }
    if (normalized === "30 minutes") {
      return 30;
    }
    if (normalized === "2 hours") {
      return 120;
    }
    if (normalized === "24 hours") {
      return 1440;
    }
    if (normalized === "custom") {
      const input = await vscode.window.showInputBox({
        prompt: "Set custom reminder (minutes)",
        placeHolder: "e.g. 45",
        validateInput: (text) => {
          const minutes = Number(text.trim());
          return Number.isFinite(minutes) && minutes > 0 ? null : "Enter a positive number of minutes";
        },
      });
      if (!input) {
        throw new Error("Reminder cancelled");
      }
      return Math.floor(Number(input.trim()));
    }

    const match = normalized.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hour|hours)$/);
    if (match) {
      const amount = Number(match[1]);
      const unit = match[2];
      if (unit.startsWith("h")) {
        return amount * 60;
      }
      return amount;
    }
    throw new Error("Unsupported reminder value");
  }

  private async initializeReminderScheduler(): Promise<void> {
    if (this.remindersLoaded) {
      return;
    }
    this.remindersLoaded = true;

    const reminders = await this.getReminders();
    reminders.forEach((reminder) => this.scheduleReminder(reminder));
  }

  private clearReminderTimers(): void {
    this.reminderTimers.forEach((timer) => clearTimeout(timer));
    this.reminderTimers.clear();
  }

  private scheduleReminder(reminder: TaskReminder): void {
    const existing = this.reminderTimers.get(reminder.id);
    if (existing) {
      clearTimeout(existing);
    }

    const delayMs = Math.max(0, (reminder.dueAtUnix * 1000) - Date.now());
    const timer = setTimeout(() => {
      this.reminderTimers.delete(reminder.id);
      void this.fireReminder(reminder.id);
    }, delayMs);
    this.reminderTimers.set(reminder.id, timer);
  }

  private async fireReminder(reminderId: string): Promise<void> {
    const reminders = await this.getReminders();
    const reminder = reminders.find((entry) => entry.id === reminderId);
    if (!reminder) {
      return;
    }

    const remaining = reminders.filter((entry) => entry.id !== reminderId);
    await this.saveReminders(remaining);

    const action = await vscode.window.showInformationMessage(
      `Task reminder: ${reminder.taskLabel}`,
      "Open Sidebar",
      "Snooze 5m",
      "Dismiss",
    );

    if (action === "Open Sidebar") {
      await this.open();
      return;
    }
    if (action === "Snooze 5m") {
      const snoozedReminder: TaskReminder = {
        ...reminder,
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        dueAtUnix: Math.floor(Date.now() / 1000) + (5 * 60),
      };
      const updated = await this.getReminders();
      updated.push(snoozedReminder);
      await this.saveReminders(updated);
      this.scheduleReminder(snoozedReminder);
    }
  }

  private async removeTaskReminders(accountKey: string, taskId: string): Promise<void> {
    const reminders = await this.getReminders();
    const toRemove = reminders.filter((entry) => entry.accountKey === accountKey && entry.taskId === taskId).map((entry) => entry.id);
    toRemove.forEach((id) => {
      const timer = this.reminderTimers.get(id);
      if (timer) {
        clearTimeout(timer);
      }
      this.reminderTimers.delete(id);
    });

    if (toRemove.length > 0) {
      await this.saveReminders(reminders.filter((entry) => !(entry.accountKey === accountKey && entry.taskId === taskId)));
    }
  }

  private async getReminders(): Promise<TaskReminder[]> {
    return this.context.globalState.get<TaskReminder[]>(REMINDER_STORAGE_KEY, []);
  }

  private async saveReminders(reminders: TaskReminder[]): Promise<void> {
    await this.context.globalState.update(REMINDER_STORAGE_KEY, reminders);
  }

  private async pushState(timerOnly = false): Promise<void> {
    let state: SidebarState;
    if (timerOnly && this.lastState && this.lastState.authenticated && this.lastState.isTimerRunning) {
      const active = await this.timerService.getActiveTimer();
      if (!active) {
        state = await this.buildState();
      } else {
        const candidate: SidebarState = {
          ...this.lastState,
          isTimerRunning: true,
          timerTaskId: active.taskId,
          timerElapsedSeconds: this.timerService.formatElapsedSeconds(active),
        };
        state = isTimerOnlyStateUpdate(this.lastState, candidate) ? candidate : await this.buildState();
      }
    } else {
      state = await this.buildState();
    }

    this.lastState = state;
    this.updateStatusBar(state);
    this.updateTicker(state);
    if (this.view) {
      this.view.webview.postMessage({ type: "state", payload: state });
    }
  }

  private updateTicker(state: SidebarState): void {
    const shouldTick = state.authenticated && state.isTimerRunning && Boolean(this.view);
    if (shouldTick && !this.ticker) {
      this.ticker = setInterval(() => {
        if (this.ticking) {
          return;
        }
        this.ticking = true;
        void this.pushState(true).finally(() => {
          this.ticking = false;
        });
      }, 1000);
      return;
    }

    if (!shouldTick && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private async buildState(): Promise<SidebarState> {
    const session = await this.authService.getSession();
    if (!session) {
      return {
        authenticated: false,
        mode: this.authDraft.mode,
        authForm: { email: this.authDraft.email, url: this.authDraft.url, secret: this.authDraft.secret },
        accountLabel: "",
        baseUrl: this.defaultBaseUrl,
        tasks: [],
        statuses: [],
        projects: [],
        users: [],
        selectedTaskId: "",
        selectedStatusId: "",
        selectedProjectId: "",
        lastSearchText: "",
        isTimerRunning: false,
        timerTaskId: "",
        timerElapsedSeconds: 0,
        editTask: null,
        errorMessage: this.lastError,
        infoMessage: this.lastMessage,
      };
    }

    const prefs = await this.taskService.getPreferences(session.accountKey);
    const active = await this.timerService.getActiveTimer();
    this.authDraft = { mode: session.mode, email: session.email, url: session.baseUrl, secret: session.apiSecret ?? "" };
    const statuses = this.taskService.getStatuses();
    const doneStatusIds = new Set(statuses.filter((status) => /done|complete/i.test(status.name || "")).map((status) => String(status.id)));
    const allTasks = this.taskService.getTasks();
    const tasks = allTasks.filter((task) => {
      const statusId = String(task.task_status_id ?? task.status_id ?? "");
      return statusId ? !doneStatusIds.has(statusId) : true;
    });

    return {
      authenticated: true,
      mode: session.mode,
      authForm: { email: session.email, url: session.baseUrl, secret: session.apiSecret ?? "" },
      accountLabel: session.accountLabel || "Invoice Ninja",
      baseUrl: session.baseUrl,
      tasks,
      statuses,
      projects: this.taskService.getProjects(),
      users: this.taskService.getUsers(),
      selectedTaskId: prefs.selectedTaskId,
      selectedStatusId: prefs.selectedStatusId,
      selectedProjectId: prefs.selectedProjectId,
      lastSearchText: prefs.lastSearchText,
      isTimerRunning: Boolean(active),
      timerTaskId: active?.taskId ?? "",
      timerElapsedSeconds: this.timerService.formatElapsedSeconds(active),
      editTask: this.editTaskId ? allTasks.find((task) => task.id === this.editTaskId) ?? null : null,
      errorMessage: this.lastError,
      infoMessage: this.lastMessage,
    };
  }

  private updateStatusBar(state: SidebarState): void {
    if (!state.isTimerRunning) {
      this.statusBar.text = "$(clock) Invoice Ninja: idle";
      return;
    }

    const task = state.tasks.find((entry) => entry.id === state.timerTaskId) ?? state.editTask;
    this.statusBar.text = `$(clock) ${task?.description || "Task"} ${formatDuration(state.timerElapsedSeconds)}`;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "invoiceninja.svg"));
    return renderSidebarHtml({
      cspSource: webview.cspSource,
      nonce,
      logoUri: logoUri.toString(),
    });
  }

  private toUserMessage(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return "Authentication failed. Check credentials, OTP, URL, and secret.";
      }
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Unexpected error";
  }
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(1, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function userLabel(user: { first_name?: string; last_name?: string; display_name?: string; email?: string; id: string }): string {
  const full = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return full || user.display_name || user.email || user.id;
}
