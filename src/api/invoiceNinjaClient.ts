import { AuthSession, InvoiceNinjaCompany, InvoiceNinjaProject, InvoiceNinjaTask, InvoiceNinjaTaskStatus, InvoiceNinjaUser, LoginInput, TaskQuery } from "../types/contracts";

interface RequestConfig {
  method?: string;
  body?: unknown;
  session?: AuthSession;
  timeoutMs?: number;
}

interface PaginatedResponse<T> {
  data?: T[];
}

export class ApiError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class InvoiceNinjaClient {
  public async login(baseUrl: string, input: LoginInput, timeoutMs: number): Promise<Record<string, unknown>> {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-Requested-With", "XMLHttpRequest");
    if (input.secret) {
      headers.set("X-API-SECRET", input.secret);
    }

    return this.request<Record<string, unknown>>(baseUrl, "/api/v1/login?include=company,user,token", {
      method: "POST",
      body: { email: input.email, password: input.password, one_time_password: input.otp ?? "" },
      timeoutMs,
      session: undefined,
      headersOverride: headers,
    });
  }

  public async listTasks(baseUrl: string, session: AuthSession, query: TaskQuery, timeoutMs: number): Promise<InvoiceNinjaTask[]> {
    const params = new URLSearchParams();
    params.set("per_page", String(query.perPage ?? 100));
    if (query.search) {
      params.set("query", query.search);
    }
    if (query.statusId) {
      params.set("status_id", query.statusId);
      params.set("task_status_id", query.statusId);
    }
    if (query.projectId) {
      params.set("project_id", query.projectId);
    }

    const response = await this.request<PaginatedResponse<InvoiceNinjaTask> | InvoiceNinjaTask[]>(baseUrl, `/api/v1/tasks?${params.toString()}`, {
      session,
      timeoutMs,
    });
    return this.unwrapList<InvoiceNinjaTask>(response);
  }

  public async getTask(baseUrl: string, session: AuthSession, taskId: string, timeoutMs: number): Promise<InvoiceNinjaTask> {
    const response = await this.request<InvoiceNinjaTask | { data: InvoiceNinjaTask }>(baseUrl, `/api/v1/tasks/${taskId}`, {
      session,
      timeoutMs,
    });
    return this.unwrapEntity(response);
  }

  public async createTask(
    baseUrl: string,
    session: AuthSession,
    payload: { description: string; project_id?: string; client_id?: string; status_id?: string },
    timeoutMs: number,
  ): Promise<InvoiceNinjaTask> {
    const response = await this.request<InvoiceNinjaTask | { data: InvoiceNinjaTask }>(baseUrl, "/api/v1/tasks", {
      method: "POST",
      body: payload,
      session,
      timeoutMs,
    });
    return this.unwrapEntity(response);
  }

  public async updateTask(
    baseUrl: string,
    session: AuthSession,
    taskId: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<InvoiceNinjaTask> {
    const response = await this.request<InvoiceNinjaTask | { data: InvoiceNinjaTask }>(baseUrl, `/api/v1/tasks/${taskId}`, {
      method: "PUT",
      body: payload,
      session,
      timeoutMs,
    });
    return this.unwrapEntity(response);
  }

  public async listProjects(baseUrl: string, session: AuthSession, timeoutMs: number): Promise<InvoiceNinjaProject[]> {
    const response = await this.request<PaginatedResponse<InvoiceNinjaProject> | InvoiceNinjaProject[]>(
      baseUrl,
      "/api/v1/projects?per_page=100",
      {
      session,
      timeoutMs,
      },
    );
    return this.unwrapList<InvoiceNinjaProject>(response);
  }

  public async listCompanies(baseUrl: string, session: AuthSession, timeoutMs: number): Promise<InvoiceNinjaCompany[]> {
    const response = await this.request<PaginatedResponse<InvoiceNinjaCompany> | InvoiceNinjaCompany[]>(
      baseUrl,
      "/api/v1/companies?per_page=100",
      {
        session,
        timeoutMs,
      },
    );
    return this.unwrapList<InvoiceNinjaCompany>(response);
  }

  public async getCurrentCompany(baseUrl: string, session: AuthSession, timeoutMs: number): Promise<InvoiceNinjaCompany> {
    const response = await this.request<InvoiceNinjaCompany | { data: InvoiceNinjaCompany }>(baseUrl, "/api/v1/companies/current", {
      method: "POST",
      session,
      timeoutMs,
    });
    return this.unwrapEntity(response);
  }

  public async listTaskStatuses(baseUrl: string, session: AuthSession, timeoutMs: number): Promise<InvoiceNinjaTaskStatus[]> {
    const response = await this.request<PaginatedResponse<InvoiceNinjaTaskStatus> | InvoiceNinjaTaskStatus[]>(
      baseUrl,
      "/api/v1/task_statuses?per_page=100",
      {
        session,
        timeoutMs,
      },
    );
    return this.unwrapList<InvoiceNinjaTaskStatus>(response);
  }

  public async listUsers(baseUrl: string, session: AuthSession, timeoutMs: number): Promise<InvoiceNinjaUser[]> {
    const response = await this.request<PaginatedResponse<InvoiceNinjaUser> | InvoiceNinjaUser[]>(
      baseUrl,
      "/api/v1/users?per_page=100",
      {
        session,
        timeoutMs,
      },
    );
    return this.unwrapList<InvoiceNinjaUser>(response);
  }

  public async deleteTask(baseUrl: string, session: AuthSession, taskId: string, timeoutMs: number): Promise<void> {
    await this.request<unknown>(baseUrl, `/api/v1/tasks/${taskId}`, {
      method: "DELETE",
      session,
      timeoutMs,
    });
  }

  public async bulkTaskAction(
    baseUrl: string,
    session: AuthSession,
    action: "archive" | "restore" | "delete",
    taskIds: string[],
    timeoutMs: number,
  ): Promise<void> {
    await this.request<unknown>(baseUrl, `/api/v1/tasks/bulk?action=${action}`, {
      method: "POST",
      session,
      body: taskIds,
      timeoutMs,
    });
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    config: RequestConfig & { headersOverride?: Headers },
  ): Promise<T> {
    const headers = config.headersOverride ?? new Headers();
    if (!config.headersOverride) {
      headers.set("Accept", "application/json");
      headers.set("X-Requested-With", "XMLHttpRequest");
      if (config.body) {
        headers.set("Content-Type", "application/json");
      }
    }

    if (config.session) {
      headers.set("X-API-TOKEN", config.session.apiToken);
      if (config.session.apiSecret) {
        headers.set("X-API-SECRET", config.session.apiSecret);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
    const method = config.method ?? "GET";

    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers,
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
      });

      const raw = await response.text();
      const parsed: unknown = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        const message = this.parseErrorMessage(parsed, response.status);
        throw new ApiError(response.status, message);
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(408, "Request timed out");
      }
      throw new ApiError(500, error instanceof Error ? error.message : "Unexpected API error");
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseErrorMessage(payload: unknown, status: number): string {
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const message = record.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
      const error = record.error;
      if (typeof error === "string" && error.trim()) {
        return error;
      }
    }

    if (status === 401) {
      return "Authentication failed";
    }

    return `Request failed with status ${status}`;
  }

  private unwrapList<T>(payload: PaginatedResponse<T> | T[]): T[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (payload && typeof payload === "object" && Array.isArray((payload as PaginatedResponse<T>).data)) {
      return (payload as PaginatedResponse<T>).data ?? [];
    }

    return [];
  }

  private unwrapEntity<T>(payload: T | { data: T }): T {
    if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")) {
      const data = (payload as { data: T }).data;
      if (data) {
        return data;
      }
    }

    return payload as T;
  }
}
