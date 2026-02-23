import type * as vscode from "vscode";
import { InvoiceNinjaClient } from "../api/invoiceNinjaClient";
import { AuthMode, AuthSession, InvoiceNinjaCompany, LoginInput } from "../types/contracts";

const SECRET_KEYS = {
  mode: "invoiceNinja.auth.mode",
  baseUrl: "invoiceNinja.auth.baseUrl",
  email: "invoiceNinja.auth.email",
  apiToken: "invoiceNinja.auth.apiToken",
  apiSecret: "invoiceNinja.auth.apiSecret",
  accountLabel: "invoiceNinja.auth.accountLabel",
};

const DEFAULT_ACCOUNT_LABEL = "Invoice Ninja";

interface InvoiceNinjaSettings {
  get<T>(section: string, defaultValue: T): T;
}

function defaultSettingsFactory(): InvoiceNinjaSettings {
  const runtimeVscode = require("vscode") as typeof import("vscode");
  return runtimeVscode.workspace.getConfiguration("invoiceNinja") as InvoiceNinjaSettings;
}

export class AuthService {
  private session: AuthSession | null = null;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: InvoiceNinjaClient,
    private readonly getSettings: () => InvoiceNinjaSettings = defaultSettingsFactory,
  ) {}

  public async getSession(): Promise<AuthSession | null> {
    if (this.session) {
      return this.session;
    }

    const [mode, baseUrl, email, apiToken, apiSecret, rawAccountLabel] = await Promise.all([
      this.context.secrets.get(SECRET_KEYS.mode),
      this.context.secrets.get(SECRET_KEYS.baseUrl),
      this.context.secrets.get(SECRET_KEYS.email),
      this.context.secrets.get(SECRET_KEYS.apiToken),
      this.context.secrets.get(SECRET_KEYS.apiSecret),
      this.context.secrets.get(SECRET_KEYS.accountLabel),
    ]);

    if (!mode || !baseUrl || !email || !apiToken) {
      return null;
    }

    const session: AuthSession = {
      mode: (mode as AuthMode) ?? "cloud",
      baseUrl,
      email,
      apiToken,
      apiSecret: apiSecret ?? undefined,
      accountLabel: (rawAccountLabel ?? "").trim(),
      accountKey: this.getAccountKey(baseUrl, email),
    };

    if (this.isInvalidAccountLabel(session.accountLabel, email)) {
      const resolved = await this.resolveCompanyName(session);
      session.accountLabel = this.finalizeAccountLabel(resolved, email);
    }

    if (!session.accountLabel) {
      session.accountLabel = DEFAULT_ACCOUNT_LABEL;
    }

    const storedLabel = rawAccountLabel ?? "";
    if (session.accountLabel !== storedLabel) {
      await this.context.secrets.store(SECRET_KEYS.accountLabel, session.accountLabel);
    }

    this.session = session;
    return session;
  }

  public async login(input: LoginInput): Promise<AuthSession> {
    const settings = this.getSettings();
    const fallbackUrl = String(settings.get("defaultBaseUrl", "https://invoicing.co"));
    const baseUrl = this.normalizeUrl(input.mode === "selfhost" ? input.url || "" : fallbackUrl);
    if (!baseUrl) {
      throw new Error("Please provide a valid Invoice Ninja URL");
    }

    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));
    const response = await this.client.login(baseUrl, input, timeoutMs);
    const token = this.extractToken(response) || input.secret;
    if (!token) {
      throw new Error("Login succeeded but no API token was found in the response");
    }

    const nextSession: AuthSession = {
      mode: input.mode,
      baseUrl,
      email: input.email,
      apiToken: token,
      apiSecret: input.secret || undefined,
      accountLabel: "",
      accountKey: this.getAccountKey(baseUrl, input.email),
    };

    let accountLabel = this.extractAccountLabel(response);
    if (this.isInvalidAccountLabel(accountLabel, input.email)) {
      accountLabel = await this.resolveCompanyName(nextSession);
    }
    nextSession.accountLabel = this.finalizeAccountLabel(accountLabel, input.email);

    this.session = nextSession;
    await Promise.all([
      this.context.secrets.store(SECRET_KEYS.mode, nextSession.mode),
      this.context.secrets.store(SECRET_KEYS.baseUrl, nextSession.baseUrl),
      this.context.secrets.store(SECRET_KEYS.email, nextSession.email),
      this.context.secrets.store(SECRET_KEYS.apiToken, nextSession.apiToken),
      this.context.secrets.store(SECRET_KEYS.accountLabel, nextSession.accountLabel),
      this.context.secrets.store(SECRET_KEYS.apiSecret, nextSession.apiSecret ?? ""),
    ]);

    return nextSession;
  }

  public async logout(): Promise<void> {
    this.session = null;
    await Promise.all([
      this.context.secrets.delete(SECRET_KEYS.mode),
      this.context.secrets.delete(SECRET_KEYS.baseUrl),
      this.context.secrets.delete(SECRET_KEYS.email),
      this.context.secrets.delete(SECRET_KEYS.apiToken),
      this.context.secrets.delete(SECRET_KEYS.apiSecret),
      this.context.secrets.delete(SECRET_KEYS.accountLabel),
    ]);
  }

  public getAccountKey(baseUrl: string, userIdentifier: string): string {
    return `${baseUrl.replace(/\/+$/, "")}|${userIdentifier.toLowerCase()}`;
  }

  private normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = new URL(trimmed);
      return parsed.origin;
    } catch {
      return "";
    }
  }

  private extractToken(payload: unknown): string {
    return this.findStringByKeys(payload, ["token", "api_token", "token_value"]);
  }

  private extractAccountLabel(payload: unknown): string {
    const candidates = [
      this.findNestedString(payload, ["company", "settings", "name"]),
      this.findNestedString(payload, ["data", "company", "settings", "name"]),
      this.findNestedString(payload, ["company_user", "company", "settings", "name"]),
      this.findNestedString(payload, ["data", "company_user", "company", "settings", "name"]),
      this.findNestedString(payload, ["data", "company", "name"]),
      this.findNestedString(payload, ["data", "company", "company_name"]),
      this.findNestedString(payload, ["company", "name"]),
      this.findNestedString(payload, ["company", "company_name"]),
      this.findNestedString(payload, ["company_user", "company", "name"]),
      this.findNestedString(payload, ["company_user", "company", "company_name"]),
      this.findNestedString(payload, ["data", "company_user", "company", "name"]),
      this.findNestedString(payload, ["data", "company_user", "company", "company_name"]),
    ];

    const hit = candidates.find((value) => Boolean(value && value.trim()));
    return hit ?? "";
  }

  private findNestedString(payload: unknown, path: string[]): string {
    let cursor: unknown = payload;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object") {
        return "";
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }

    if (typeof cursor === "string" && cursor.trim()) {
      return cursor;
    }

    return "";
  }

  private findStringByKeys(payload: unknown, keys: string[]): string {
    const lowered = new Set(keys.map((key) => key.toLowerCase()));
    const queue: unknown[] = [payload];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== "object") {
        continue;
      }

      const record = current as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === "string" && lowered.has(key.toLowerCase()) && value.trim()) {
          return value;
        }
        if (typeof value === "object") {
          queue.push(value);
        }
      }
    }

    return "";
  }

  private isInvalidAccountLabel(label: string, email: string): boolean {
    const value = label.trim();
    if (!value) {
      return true;
    }
    if (/token/i.test(value)) {
      return true;
    }
    if (value.toLowerCase() === email.trim().toLowerCase()) {
      return true;
    }
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return true;
    }
    if (/(mozilla\/|applewebkit\/|chrome\/|safari\/|edg\/|firefox\/|windows nt)/i.test(value)) {
      return true;
    }
    return false;
  }

  private finalizeAccountLabel(candidate: string, email: string): string {
    const normalized = candidate.trim();
    if (this.isInvalidAccountLabel(normalized, email)) {
      return DEFAULT_ACCOUNT_LABEL;
    }
    return normalized;
  }

  private readCompanyLabel(company: InvoiceNinjaCompany | null | undefined): string {
    if (!company) {
      return "";
    }
    const candidates = [company.settings?.name, company.name, company.company_name];
    const hit = candidates.find((value) => typeof value === "string" && value.trim());
    return hit ? hit.trim() : "";
  }

  private async resolveCompanyName(session: AuthSession): Promise<string> {
    const settings = this.getSettings();
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));

    try {
      const current = await this.client.getCurrentCompany(session.baseUrl, session, timeoutMs);
      const label = this.readCompanyLabel(current);
      if (label) {
        return label;
      }
    } catch {
      // no-op: fall back to /companies listing
    }

    try {
      const companies = await this.client.listCompanies(session.baseUrl, session, timeoutMs);
      for (const company of companies) {
        const label = this.readCompanyLabel(company);
        if (label) {
          return label;
        }
      }
    } catch {
      return "";
    }

    return "";
  }
}
