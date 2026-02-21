import * as vscode from "vscode";
import { ApiError } from "../api/invoiceNinjaClient";
import { AuthService } from "../services/authService";
import { TaskService } from "../services/taskService";
import { parseTimeLog, TimerService } from "../services/timerService";
import { AuthMode, IncomingMessage, LoginInput, SidebarState, TaskReminder, ThemeMode } from "../types/contracts";

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
        case "toggleTheme":
          await this.toggleTheme();
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
    this.lastMessage = `Logged in as ${session.email}`;
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

  private async toggleTheme(): Promise<void> {
    const session = await this.taskService.getSessionOrThrow();
    const prefs = await this.taskService.getPreferences(session.accountKey);
    const nextTheme: ThemeMode = prefs.theme === "dark" ? "light" : "dark";
    await this.taskService.updatePreferences(session.accountKey, { theme: nextTheme });
    this.lastMessage = `Switched to ${nextTheme} mode`;
  }

  private async pushState(): Promise<void> {
    const state = await this.buildState();
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
        void this.pushState().finally(() => {
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
        accountEmail: "",
        baseUrl: this.defaultBaseUrl,
        theme: "dark",
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
      accountLabel: session.accountLabel || session.email,
      accountEmail: session.email,
      baseUrl: session.baseUrl,
      theme: prefs.theme,
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

    return `<!doctype html><html><head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <style>
    body{font-family:Segoe UI,Arial;background:#1b232e;color:#f4f7fb;margin:0;padding:12px} .h{display:flex;justify-content:space-between;align-items:center} .l{display:flex;gap:8px;align-items:center}
    .logo{width:30px;height:30px;border-radius:50%;overflow:hidden;border:1px solid #405164} .logo img{width:100%;height:100%} input,select,button{background:#1f2935;color:#fff;border:1px solid #405164;border-radius:6px;padding:8px}
    .row{display:flex;gap:6px;align-items:center;margin-top:6px} .grow{flex:1} .task{border:1px solid #405164;border-radius:8px;padding:10px;margin-top:8px} .task h3{margin:0 0 6px 0} .meta{font-size:12px;opacity:.85}
    .pill{background:#fff;color:#000;border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700} .right{margin-left:auto;display:flex;align-items:center;gap:8px} .menu{border:1px solid #405164;border-radius:8px;margin-top:4px}
    .menu button{width:100%;text-align:left;background:transparent;border:0;padding:8px} .hide{display:none} .err{color:#f87171} .ok{color:#86efac}
    </style></head><body>
    <div id="auth"><div class="l"><div class="logo"><img src="${logoUri}" /></div><strong>InvoiceNinja</strong></div>
    <div class="row"><input id="email" class="grow" placeholder="E-mail address" /></div>
    <div class="row"><input id="password" type="password" class="grow" placeholder="Password" /></div>
    <div class="row"><input id="otp" class="grow" placeholder="One Time Password" /></div>
    <div id="sh" class="hide"><div class="row"><input id="url" class="grow" placeholder="URL" /></div><div class="row"><input id="secret" class="grow" placeholder="Secret" /></div></div>
    <div class="row"><button id="login" class="grow">Log in</button></div><button id="mode">Self-hosting? Click to set URL</button><div id="amsg" class="meta"></div></div>

    <div id="work" class="hide"><div class="h"><div class="l"><div class="logo"><img src="${logoUri}" /></div><strong id="acc"></strong></div><div><button id="refresh">↻</button><button id="menu">☰</button></div></div>
    <div id="mp" class="hide"><div class="meta" id="mail"></div><div class="meta" id="base"></div><button id="theme">Toggle Theme</button><button id="logout">Logout</button></div>
    <div id="list"><div class="row"><input id="q" class="grow" placeholder="What are you working on?" /><button id="save">Save</button><button id="search">⌕</button></div>
    <div class="row"><select id="sf"></select><select id="pf"></select></div><div id="tasks"></div><div id="empty" class="meta hide">No tasks found.</div></div>
    <div id="edit" class="hide"><div class="meta">Home / Tasks / Edit</div><h2 id="enum"></h2><div class="row"><input id="edesc" class="grow" placeholder="Description" /></div><div class="row"><select id="eproj" class="grow"></select></div><div class="row"><input id="erate" class="grow" type="number" /></div><div class="row"><select id="euser" class="grow"></select></div><div class="row"><button id="esave" class="grow">Save</button><button id="eback">Back</button></div></div>
    <div id="wmsg" class="meta"></div></div>
    <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = { mode: "cloud", menu: false, openMenu: "", editId: "", data: null };
    const $ = (id) => document.getElementById(id);

    $("mode").onclick = () => { state.mode = state.mode === "cloud" ? "selfhost" : "cloud"; $("sh").classList.toggle("hide", state.mode !== "selfhost"); vscode.postMessage({ type: "toggleMode", mode: state.mode }); };
    $("login").onclick = () => vscode.postMessage({ type: "login", payload: { mode: state.mode, email: $("email").value.trim(), password: $("password").value, otp: $("otp").value.trim(), url: $("url").value.trim(), secret: $("secret").value } });
    $("refresh").onclick = () => vscode.postMessage({ type: "refresh" });
    $("menu").onclick = () => { state.menu = !state.menu; $("mp").classList.toggle("hide", !state.menu); };
    $("theme").onclick = () => vscode.postMessage({ type: "toggleTheme" });
    $("logout").onclick = () => vscode.postMessage({ type: "logout" });
    $("save").onclick = () => vscode.postMessage({ type: "saveTask", payload: { description: $("q").value.trim() } });
    $("search").onclick = () => vscode.postMessage({ type: "search", payload: { text: $("q").value.trim() } });
    $("sf").onchange = (e) => vscode.postMessage({ type: "setStatusFilter", payload: { statusId: e.target.value } });
    $("pf").onchange = (e) => vscode.postMessage({ type: "setProjectFilter", payload: { projectId: e.target.value } });
    $("esave").onclick = () => { if (!state.editId) return; vscode.postMessage({ type: "saveTaskEdit", payload: { taskId: state.editId, description: $("edesc").value, projectId: $("eproj").value, assignedUserId: $("euser").value, rate: $("erate").value } }); };
    $("eback").onclick = () => { state.editId = ""; render(state.data); };

    function taskNo(task) { return (task.number && String(task.number).trim()) ? String(task.number) : String(task.id || "").slice(0, 4).padStart(4, "0"); }
    function statusName(task, statuses) { const id = String(task.task_status_id || task.status_id || ""); const s = statuses.find((x) => String(x.id) === id); return s ? (s.name || id) : (id || "Backlog"); }
    function parseClockText(value) {
      if (typeof value !== "string" || !value.includes(":")) return NaN;
      const parts = value.split(":").map((x) => Number(x));
      if (parts.some((x) => !Number.isFinite(x))) return NaN;
      if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      if (parts.length === 2) return (parts[0] * 60) + parts[1];
      return NaN;
    }
    function parseNumericDuration(raw, decimalMeansHours) {
      if (raw === undefined || raw === null || raw === "") return NaN;
      const clock = parseClockText(raw);
      if (Number.isFinite(clock)) return clock;
      const text = String(raw).trim();
      const n = Number(text);
      if (!Number.isFinite(n)) return NaN;
      const isDecimal = text.includes(".") || Math.abs(n - Math.trunc(n)) > 0;
      if (decimalMeansHours && isDecimal) return Math.round(n * 3600);
      return Math.max(0, Math.round(n));
    }
    function totalSeconds(task, payload) {
      if (payload.isTimerRunning && payload.timerTaskId === task.id) return payload.timerElapsedSeconds;

      const fromDuration = parseNumericDuration(task.duration, true);
      if (Number.isFinite(fromDuration) && fromDuration > 0) return fromDuration;

      const raw = task.time_log;
      const direct = parseNumericDuration(raw, true);
      if (Number.isFinite(direct) && direct > 0 && (typeof raw !== "string" || !raw.trim().startsWith("["))) {
        return direct;
      }

      try {
        const arr = JSON.parse(task.time_log || "[]");
        const now = Math.floor(Date.now() / 1000);
        return Array.isArray(arr)
          ? arr.reduce((sum, seg) => {
              if (!Array.isArray(seg) || seg.length < 2) return sum;
              const s = Number(seg[0]) || 0;
              const e = Number(seg[1]) || 0;
              return sum + (s ? Math.max(0, (e > 0 ? e : now) - s) : 0);
            }, 0)
          : 0;
      } catch {
        return 0;
      }
    }
    function userLabel(user) { const full = ((user.first_name || "") + " " + (user.last_name || "")).trim(); return esc(full || user.display_name || user.email || user.id); }
    function esc(v) { return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
    function fmt(s) { const h = String(Math.floor(s/3600)); const m = String(Math.floor((s%3600)/60)).padStart(2, "0"); const sec = String(Math.floor(s%60)).padStart(2, "0"); return h + ":" + m + ":" + sec; }

    function render(payload) {
      if (!payload) return;
      state.data = payload;
      $("auth").classList.toggle("hide", payload.authenticated);
      $("work").classList.toggle("hide", !payload.authenticated);

      if (!payload.authenticated) {
        $("email").value = payload.authForm.email || "";
        $("url").value = payload.authForm.url || "";
        $("secret").value = payload.authForm.secret || "";
        state.mode = payload.mode;
        $("sh").classList.toggle("hide", state.mode !== "selfhost");
        $("amsg").className = "meta " + (payload.errorMessage ? "err" : payload.infoMessage ? "ok" : "");
        $("amsg").textContent = payload.errorMessage || payload.infoMessage || "";
        return;
      }

      $("acc").textContent = payload.accountLabel;
      $("mail").textContent = payload.accountEmail;
      $("base").textContent = payload.baseUrl;
      $("q").value = payload.lastSearchText || "";
      $("sf").innerHTML = "<option value=''>Status</option>" + payload.statuses.map((s) => "<option value='" + s.id + "'>" + (s.name || s.id) + "</option>").join("");
      $("sf").value = payload.selectedStatusId || "";
      $("pf").innerHTML = "<option value=''>Project</option>" + payload.projects.map((p) => "<option value='" + p.id + "'>" + (p.name || p.id) + "</option>").join("");
      $("pf").value = payload.selectedProjectId || "";

      const editing = payload.editTask && state.editId === payload.editTask.id;
      $("list").classList.toggle("hide", editing);
      $("edit").classList.toggle("hide", !editing);
      if (editing) {
        $("enum").textContent = taskNo(payload.editTask);
        $("edesc").value = payload.editTask.description || "";
        $("erate").value = String(payload.editTask.rate || 0);
        $("eproj").innerHTML = "<option value=''>-- Unassigned --</option>" + payload.projects.map((p) => "<option value='" + p.id + "'>" + (p.name || p.id) + "</option>").join("");
        $("eproj").value = payload.editTask.project_id || "";
        $("euser").innerHTML = "<option value=''>-- Unassigned --</option>" + payload.users.map((u) => "<option value='" + u.id + "'>" + userLabel(u) + "</option>").join("");
        $("euser").value = payload.editTask.assigned_user_id || "";
      }

      const container = $("tasks");
      container.innerHTML = "";
      payload.tasks.forEach((task) => {
        const card = document.createElement("div");
        const running = payload.isTimerRunning && payload.timerTaskId === task.id;
        card.className = "task" + (payload.selectedTaskId === task.id ? " active" : "");
        card.innerHTML = "<h3>" + esc(task.description || "(no description)") + "</h3>" +
          "<div class='row'><span class='meta'><strong>" + esc(taskNo(task)) + "</strong></span><button class='pill' data-a='assign-status' data-id='" + task.id + "'>" + esc(statusName(task, payload.statuses)) + "</button>" +
          "<button data-a='assign-user' data-id='" + task.id + "'>👤</button><button data-a='assign-project' data-id='" + task.id + "'>🗂</button>" +
          "<span class='right'>⏱ " + fmt(totalSeconds(task, payload)) + " <button data-a='toggle' data-id='" + task.id + "'>" + (running ? "■" : "▶") + "</button><button data-a='menu' data-id='" + task.id + "'>⋮</button></span></div>";

        if (state.openMenu === task.id) {
          const menu = document.createElement("div");
          menu.className = "menu";
          menu.innerHTML = "<button data-a='edit' data-id='" + task.id + "'>Edit</button>" +
            "<button data-a='archive' data-id='" + task.id + "'>Archive</button>" +
            "<button data-a='delete' data-id='" + task.id + "'>Delete</button>" +
            "<button data-a='rem' data-id='" + task.id + "' data-v='5 minutes'>Reminder 5 minutes</button>" +
            "<button data-a='rem' data-id='" + task.id + "' data-v='30 minutes'>Reminder 30 minutes</button>" +
            "<button data-a='rem' data-id='" + task.id + "' data-v='2 hours'>Reminder 2 hours</button>" +
            "<button data-a='rem' data-id='" + task.id + "' data-v='24 hours'>Reminder 24 hours</button>" +
            "<button data-a='rem' data-id='" + task.id + "' data-v='Custom'>Reminder custom</button>";
          card.appendChild(menu);
        }

        card.onclick = (event) => {
          const t = event.target.closest("[data-a]");
          if (!t) {
            vscode.postMessage({ type: "selectTask", payload: { taskId: task.id } });
            return;
          }
          const id = t.getAttribute("data-id") || task.id;
          const action = t.getAttribute("data-a");
          if (action === "assign-status") vscode.postMessage({ type: "assignTaskStatus", payload: { taskId: id } });
          if (action === "assign-user") vscode.postMessage({ type: "assignUser", payload: { taskId: id } });
          if (action === "assign-project") vscode.postMessage({ type: "assignProject", payload: { taskId: id } });
          if (action === "toggle") {
            if (running) vscode.postMessage({ type: "stopTimer", payload: { taskId: id } });
            else vscode.postMessage({ type: "startTimer", payload: { taskId: id } });
          }
          if (action === "menu") { state.openMenu = state.openMenu === id ? "" : id; render(payload); }
          if (action === "edit") { state.editId = id; state.openMenu = ""; vscode.postMessage({ type: "editTask", payload: { taskId: id } }); }
          if (action === "archive") { state.openMenu = ""; vscode.postMessage({ type: "archiveTask", payload: { taskId: id } }); }
          if (action === "delete") { state.openMenu = ""; vscode.postMessage({ type: "deleteTask", payload: { taskId: id } }); }
          if (action === "rem") { state.openMenu = ""; vscode.postMessage({ type: "taskReminder", payload: { taskId: id, value: t.getAttribute("data-v") || "Custom" } }); }
        };
        container.appendChild(card);
      });

      $("empty").classList.toggle("hide", payload.tasks.length > 0);
      $("wmsg").className = "meta " + (payload.errorMessage ? "err" : payload.infoMessage ? "ok" : "");
      $("wmsg").textContent = payload.errorMessage || payload.infoMessage || "";
    }

    window.addEventListener("message", (event) => { if (event.data && event.data.type === "state") render(event.data.payload); });
    vscode.postMessage({ type: "ready" });
    </script></body></html>`;
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

export function taskElapsedSeconds(task: { duration?: number | string; time_log?: string }, nowUnix = Math.floor(Date.now() / 1000)): number {
  const durationText = task.duration === undefined || task.duration === null ? "" : String(task.duration).trim();
  if (durationText) {
    if (durationText.includes(":")) {
      const parts = durationText.split(":").map((value) => Number(value));
      if (parts.length === 3 && parts.every((value) => Number.isFinite(value))) {
        return Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]));
      }
      if (parts.length === 2 && parts.every((value) => Number.isFinite(value))) {
        return Math.max(0, Math.round(parts[0] * 60 + parts[1]));
      }
    }

    const duration = Number(durationText);
    if (Number.isFinite(duration)) {
      if (durationText.includes(".") || Math.abs(duration - Math.trunc(duration)) > 0) {
        return Math.max(0, Math.round(duration * 3600));
      }
      return Math.max(0, Math.round(duration));
    }
  }

  const segments = parseTimeLog(task.time_log);
  return segments.reduce((sum, segment) => {
    const start = Number(segment[0]) || 0;
    const end = Number(segment[1]) || 0;
    if (!start) {
      return sum;
    }
    return sum + Math.max(0, (end > 0 ? end : nowUnix) - start);
  }, 0);
}
