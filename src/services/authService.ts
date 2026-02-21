import * as vscode from "vscode";
import { InvoiceNinjaClient } from "../api/invoiceNinjaClient";
import { AuthMode, AuthSession, LoginInput } from "../types/contracts";

const SECRET_KEYS = {
  mode: "invoiceNinja.auth.mode",
  baseUrl: "invoiceNinja.auth.baseUrl",
  email: "invoiceNinja.auth.email",
  apiToken: "invoiceNinja.auth.apiToken",
  apiSecret: "invoiceNinja.auth.apiSecret",
  accountLabel: "invoiceNinja.auth.accountLabel",
};

export class AuthService {
  private session: AuthSession | null = null;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: InvoiceNinjaClient,
  ) {}

  public async getSession(): Promise<AuthSession | null> {
    if (this.session) {
      return this.session;
    }

    const [mode, baseUrl, email, apiToken, apiSecret, accountLabel] = await Promise.all([
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

    this.session = {
      mode: (mode as AuthMode) ?? "cloud",
      baseUrl,
      email,
      apiToken,
      apiSecret: apiSecret ?? undefined,
      accountLabel: accountLabel || email,
      accountKey: this.getAccountKey(baseUrl, email),
    };

    if (!this.session.accountLabel || /token/i.test(this.session.accountLabel)) {
      const resolved = await this.resolveCompanyName(this.session);
      if (resolved) {
        this.session.accountLabel = resolved;
        await this.context.secrets.store(SECRET_KEYS.accountLabel, resolved);
      }
    }

    return this.session;
  }

  public async login(input: LoginInput): Promise<AuthSession> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
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

    const session: AuthSession = {
      mode: input.mode,
      baseUrl,
      email: input.email,
      apiToken: token,
      apiSecret: input.secret || undefined,
      accountLabel: this.extractAccountLabel(response) || input.email,
      accountKey: this.getAccountKey(baseUrl, input.email),
    };

    const resolvedCompany = await this.resolveCompanyName(session);
    if (resolvedCompany) {
      session.accountLabel = resolvedCompany;
    }

    this.session = session;
    await Promise.all([
      this.context.secrets.store(SECRET_KEYS.mode, session.mode),
      this.context.secrets.store(SECRET_KEYS.baseUrl, session.baseUrl),
      this.context.secrets.store(SECRET_KEYS.email, session.email),
      this.context.secrets.store(SECRET_KEYS.apiToken, session.apiToken),
      this.context.secrets.store(SECRET_KEYS.accountLabel, session.accountLabel),
      this.context.secrets.store(SECRET_KEYS.apiSecret, session.apiSecret ?? ""),
    ]);

    return session;
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
    const companyLabel = this.findCompanyLabel(payload);
    if (companyLabel) {
      return companyLabel;
    }

    const generic = this.findStringByKeys(payload, ["name", "company_name", "display_name"]);
    if (generic && !/token/i.test(generic)) {
      return generic;
    }

    return "";
  }

  private findCompanyLabel(payload: unknown): string {
    const candidates = [
      this.findNestedString(payload, ["data", "company", "name"]),
      this.findNestedString(payload, ["data", "company", "company_name"]),
      this.findNestedString(payload, ["company", "name"]),
      this.findNestedString(payload, ["company", "company_name"]),
      this.findNestedString(payload, ["company_user", "company", "name"]),
      this.findNestedString(payload, ["data", "company_user", "company", "name"]),
    ];

    const hit = candidates.find((value) => Boolean(value && value.trim() && !/token/i.test(value)));
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

  private async resolveCompanyName(session: AuthSession): Promise<string> {
    const settings = vscode.workspace.getConfiguration("invoiceNinja");
    const timeoutMs = Number(settings.get("requestTimeoutMs", 15000));

    try {
      const companies = await this.client.listCompanies(session.baseUrl, session, timeoutMs);
      const first = companies.find((company) => (company.name || company.company_name || "").trim());
      if (!first) {
        return "";
      }

      return first.name?.trim() || first.company_name?.trim() || "";
    } catch {
      return "";
    }
  }
}
