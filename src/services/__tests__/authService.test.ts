import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { InvoiceNinjaClient } from "../../api/invoiceNinjaClient";
import { AuthService } from "../authService";
import { LoginInput } from "../../types/contracts";

const SECRET_KEYS = {
  mode: "invoiceNinja.auth.mode",
  baseUrl: "invoiceNinja.auth.baseUrl",
  email: "invoiceNinja.auth.email",
  apiToken: "invoiceNinja.auth.apiToken",
  apiSecret: "invoiceNinja.auth.apiSecret",
  accountLabel: "invoiceNinja.auth.accountLabel",
};

function createSettingsFactory(
  values: { defaultBaseUrl?: string; requestTimeoutMs?: number } = {},
): () => { get<T>(section: string, defaultValue: T): T } {
  const defaults = {
    defaultBaseUrl: "https://invoicing.co",
    requestTimeoutMs: 15000,
    ...values,
  };

  return () => ({
    get<T>(section: string, defaultValue: T): T {
      if (section === "defaultBaseUrl") {
        return defaults.defaultBaseUrl as T;
      }
      if (section === "requestTimeoutMs") {
        return defaults.requestTimeoutMs as T;
      }
      return defaultValue;
    },
  });
}

function createContext(initialSecrets: Record<string, string> = {}): {
  context: vscode.ExtensionContext;
  values: Map<string, string>;
} {
  const values = new Map<string, string>(Object.entries(initialSecrets));
  const context = {
    secrets: {
      async get(key: string): Promise<string | undefined> {
        return values.get(key);
      },
      async store(key: string, value: string): Promise<void> {
        values.set(key, value);
      },
      async delete(key: string): Promise<void> {
        values.delete(key);
      },
    },
  } as unknown as vscode.ExtensionContext;

  return { context, values };
}

type ClientMock = {
  login: InvoiceNinjaClient["login"];
  getCurrentCompany: InvoiceNinjaClient["getCurrentCompany"];
  listCompanies: InvoiceNinjaClient["listCompanies"];
};

function createClientMock(overrides: Partial<ClientMock>): InvoiceNinjaClient {
  const client: ClientMock = {
    login: async () => ({}),
    getCurrentCompany: async () => {
      throw new Error("not implemented");
    },
    listCompanies: async () => [],
    ...overrides,
  };
  return client as unknown as InvoiceNinjaClient;
}

function cloudLoginInput(email = "user@example.com"): LoginInput {
  return {
    mode: "cloud",
    email,
    password: "password123",
  };
}

test("login prefers company.settings.name over token.name user agent", async () => {
  let currentCompanyCalls = 0;
  const client = createClientMock({
    login: async () => ({
      company: { settings: { name: "Acme GmbH" } },
      token: { name: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", token: "tok_123" },
    }),
    getCurrentCompany: async () => {
      currentCompanyCalls += 1;
      return { id: "unused", settings: { name: "Fallback Co" } };
    },
  });

  const { context } = createContext();
  const settings = createSettingsFactory();
  const service = new AuthService(context, client, settings);

  const session = await service.login(cloudLoginInput());

  assert.equal(session.accountLabel, "Acme GmbH");
  assert.equal(currentCompanyCalls, 0);
});

test("login resolves company label from /companies/current when login response has no company name", async () => {
  let listCompaniesCalls = 0;
  const client = createClientMock({
    login: async () => ({ token: { token: "tok_123", name: "Browser UA" } }),
    getCurrentCompany: async () => ({ id: "1", settings: { name: "Current Co" } }),
    listCompanies: async () => {
      listCompaniesCalls += 1;
      return [{ id: "2", settings: { name: "List Co" } }];
    },
  });

  const { context } = createContext();
  const service = new AuthService(context, client, createSettingsFactory());

  const session = await service.login(cloudLoginInput());

  assert.equal(session.accountLabel, "Current Co");
  assert.equal(listCompaniesCalls, 0);
});

test("login falls back to /companies list when /companies/current fails", async () => {
  const client = createClientMock({
    login: async () => ({ token: { token: "tok_123", name: "Browser UA" } }),
    getCurrentCompany: async () => {
      throw new Error("current company endpoint failed");
    },
    listCompanies: async () => [
      { id: "1", settings: { name: "List Settings Co" }, name: "Ignored Name" },
      { id: "2", name: "Another Co" },
    ],
  });

  const { context } = createContext();
  const service = new AuthService(context, client, createSettingsFactory());

  const session = await service.login(cloudLoginInput());

  assert.equal(session.accountLabel, "List Settings Co");
});

test("login uses default account label when all company lookups fail", async () => {
  const client = createClientMock({
    login: async () => ({ token: { token: "tok_123", name: "Mozilla/5.0 test" } }),
    getCurrentCompany: async () => {
      throw new Error("current company endpoint failed");
    },
    listCompanies: async () => {
      throw new Error("companies endpoint failed");
    },
  });

  const { context } = createContext();
  const service = new AuthService(context, client, createSettingsFactory());

  const session = await service.login(cloudLoginInput());

  assert.equal(session.accountLabel, "Invoice Ninja");
});

test("getSession normalizes legacy stored email label", async () => {
  const storedEmail = "owner@example.com";
  const { context, values } = createContext({
    [SECRET_KEYS.mode]: "cloud",
    [SECRET_KEYS.baseUrl]: "https://invoicing.co",
    [SECRET_KEYS.email]: storedEmail,
    [SECRET_KEYS.apiToken]: "tok_abc",
    [SECRET_KEYS.apiSecret]: "",
    [SECRET_KEYS.accountLabel]: storedEmail,
  });

  const client = createClientMock({
    getCurrentCompany: async () => ({ id: "1", settings: { name: "Resolved Co" } }),
  });
  const service = new AuthService(context, client, createSettingsFactory());

  const session = await service.getSession();

  assert.ok(session);
  assert.equal(session.accountLabel, "Resolved Co");
  assert.equal(values.get(SECRET_KEYS.accountLabel), "Resolved Co");
});

test("getSession normalizes legacy stored user-agent label", async () => {
  const { context, values } = createContext({
    [SECRET_KEYS.mode]: "cloud",
    [SECRET_KEYS.baseUrl]: "https://invoicing.co",
    [SECRET_KEYS.email]: "owner@example.com",
    [SECRET_KEYS.apiToken]: "tok_abc",
    [SECRET_KEYS.apiSecret]: "",
    [SECRET_KEYS.accountLabel]: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });

  const client = createClientMock({
    getCurrentCompany: async () => ({ id: "1", settings: { name: "Resolved Co" } }),
  });
  const service = new AuthService(context, client, createSettingsFactory());

  const session = await service.getSession();

  assert.ok(session);
  assert.equal(session.accountLabel, "Resolved Co");
  assert.equal(values.get(SECRET_KEYS.accountLabel), "Resolved Co");
});
