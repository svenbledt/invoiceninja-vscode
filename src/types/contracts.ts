export type AuthMode = "cloud" | "selfhost";
export type ThemeMode = "dark" | "light";

export interface AuthSession {
  mode: AuthMode;
  baseUrl: string;
  email: string;
  apiToken: string;
  apiSecret?: string;
  accountLabel: string;
  accountKey: string;
}

export interface LoginInput {
  mode: AuthMode;
  email: string;
  password: string;
  otp?: string;
  url?: string;
  secret?: string;
}

export interface InvoiceNinjaTask {
  id: string;
  number?: string;
  description: string;
  project_id?: string;
  client_id?: string;
  assigned_user_id?: string;
  is_deleted?: boolean;
  status_id?: string | number;
  task_status_id?: string | number;
  rate?: number | string;
  duration?: number | string;
  time_log?: string;
  is_running?: boolean;
  updated_at?: number;
}

export interface InvoiceNinjaProject {
  id: string;
  name: string;
}

export interface InvoiceNinjaCompany {
  id: string;
  name?: string;
  company_name?: string;
}

export interface InvoiceNinjaTaskStatus {
  id: string;
  name: string;
}

export interface InvoiceNinjaUser {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  display_name?: string;
}

export interface ActiveTimerSession {
  accountKey: string;
  baseUrl: string;
  taskId: string;
  taskLabel: string;
  startedAtUnix: number;
}

export interface AccountPreferences {
  theme: ThemeMode;
  selectedStatusId: string;
  selectedProjectId: string;
  lastSearchText: string;
  selectedTaskId: string;
}

export interface TaskReminder {
  id: string;
  accountKey: string;
  taskId: string;
  taskLabel: string;
  dueAtUnix: number;
  createdAtUnix: number;
}

export interface TaskQuery {
  search?: string;
  statusId?: string;
  projectId?: string;
  perPage?: number;
}

export interface SidebarState {
  authenticated: boolean;
  mode: AuthMode;
  authForm: {
    email: string;
    url: string;
    secret: string;
  };
  accountLabel: string;
  accountEmail: string;
  baseUrl: string;
  theme: ThemeMode;
  tasks: InvoiceNinjaTask[];
  statuses: InvoiceNinjaTaskStatus[];
  projects: InvoiceNinjaProject[];
  users: InvoiceNinjaUser[];
  selectedTaskId: string;
  selectedStatusId: string;
  selectedProjectId: string;
  lastSearchText: string;
  isTimerRunning: boolean;
  timerTaskId: string;
  timerElapsedSeconds: number;
  editTask: InvoiceNinjaTask | null;
  errorMessage: string;
  infoMessage: string;
}

export type IncomingMessage =
  | { type: "ready" }
  | { type: "toggleMode"; mode: AuthMode }
  | {
      type: "login";
      payload: { email: string; password: string; otp?: string; url?: string; secret?: string; mode: AuthMode };
    }
  | { type: "logout" }
  | { type: "refresh" }
  | { type: "saveTask"; payload: { description: string } }
  | { type: "search"; payload: { text: string } }
  | { type: "selectTask"; payload: { taskId: string } }
  | { type: "setStatusFilter"; payload: { statusId: string } }
  | { type: "setProjectFilter"; payload: { projectId: string } }
  | { type: "startTimer"; payload?: { taskId?: string } }
  | { type: "stopTimer"; payload?: { taskId?: string } }
  | { type: "assignUser"; payload: { taskId: string } }
  | { type: "assignProject"; payload: { taskId: string } }
  | { type: "assignTaskStatus"; payload: { taskId: string } }
  | { type: "openTaskMenu"; payload: { taskId: string } }
  | { type: "editTask"; payload: { taskId: string } }
  | { type: "saveTaskEdit"; payload: { taskId: string; description: string; projectId: string; assignedUserId: string; rate: string } }
  | { type: "archiveTask"; payload: { taskId: string } }
  | { type: "deleteTask"; payload: { taskId: string } }
  | { type: "taskReminder"; payload: { taskId: string; value: string } }
  | { type: "toggleTheme" };
