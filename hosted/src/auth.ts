import type { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ClioApiError } from "../../build/lib.js";
import { createMcpIntegration } from "./mcp-integration.ts";

export const CANADA_ENDPOINTS = {
  authorize: "https://ca.app.clio.com/oauth/authorize",
  token: "https://ca.app.clio.com/oauth/token",
  api: "https://ca.app.clio.com/api/v4",
} as const;
const identifier = z.union([z.string().regex(/^[A-Za-z0-9_-]+$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const identitySchema = z.object({ data: z.object({
  id: identifier, name: z.string().min(1), email: z.email(), account: z.object({ id: identifier }),
}) });

export interface HostedAuthConfig {
  origin: string;
  secret: string;
  clientId: string;
  clientSecret: string;
  audit?: (event: { userId: string; connectionId: string; requestId: string; tool: string; outcome: string }) => void;
}

/** Explicit test seam; production construction always selects Canadian endpoints. */
export async function createHostedAuth(database: DatabaseSync, config: HostedAuthConfig) {
  if (new URL(config.origin).protocol !== "https:") throw new Error("Hosted origin must use HTTPS");
  return initializeHostedAuth(database, config, CANADA_ENDPOINTS);
}

export async function createTestHostedAuth(database: DatabaseSync, config: HostedAuthConfig, simulator: string) {
  for (const value of [config.origin, simulator]) {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Tests require loopback endpoints");
  }
  return initializeHostedAuth(database, config, {
    authorize: `${simulator}/oauth/authorize`, token: `${simulator}/oauth/token`, api: `${simulator}/api/v4`,
  });
}

async function initializeHostedAuth(database: DatabaseSync, config: HostedAuthConfig,
  endpoints: { authorize: string; token: string; api: string }) {
  const origin = new URL(config.origin);
  if (origin.origin !== config.origin || config.secret.length < 32 || !config.clientId || !config.clientSecret) {
    throw new Error("Invalid hosted configuration");
  }
  let getToken!: (userId: string, accountId: string) => Promise<string>;
  function assertConnection(userId: string, id: string) {
    if (!database.prepare("SELECT id FROM account WHERE id = ? AND userId = ? AND providerId = 'clio-ca'").get(id, userId)) {
      throw new Error("Clio connection is disconnected");
    }
  }
  const integration = createMcpIntegration({ origin: config.origin, database, session(connection) {
    const requestId = randomUUID();
    return {
      sessionId: connection.id, userId: connection.userId, requestId, region: "ca",
      getAccessToken: async () => { assertConnection(connection.userId, connection.id); return getToken(connection.userId, connection.id); },
      getTokens: async () => null,
      storeTokens: async () => { throw new Error("Hosted credentials are managed by the login provider"); },
      clearTokens: async () => { throw new Error("Use the hosted disconnect flow"); },
      appendAudit: async entry => {
        (config.audit ?? (event => console.info(JSON.stringify(event))))({
          userId: connection.userId, connectionId: connection.id, requestId, tool: entry.tool, outcome: entry.outcome,
        });
      },
      fetchClio: async (value, init) => {
        assertConnection(connection.userId, connection.id);
        const url = new URL(value);
        if (url.origin !== "https://ca.app.clio.com" || !url.pathname.startsWith("/api/v4/")) throw new Error("Invalid Clio endpoint");
        const method = init.method ?? "GET";
        if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) throw new Error("Clio operation is disabled");
        let response: Response;
        try {
          // Exactly one HTTP attempt; never replay a write whose outcome is uncertain.
          response = await fetch(`${endpoints.api}${url.pathname.slice("/api/v4".length)}${url.search}`, {
            ...init, method, redirect: "error", signal: AbortSignal.timeout(15_000),
          });
        } catch { throw new Error("Clio request did not complete. Check its outcome before retrying a write."); }
        if (!response.ok) throw new ClioApiError(response.status, `Clio request failed (${response.status}). Check connection and permissions.`);
        return response;
      },
    };
  } });
  const options = {
    database, baseURL: config.origin, secret: config.secret,
    advanced: { ipAddress: { ipAddressHeaders: ["x-clio-client-ip"] } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100, customRules: { "/mcp": { window: 60, max: 300 } } },
    emailAndPassword: { enabled: false },
    user: { deleteUser: { enabled: true } },
    disabledPaths: ["/get-access-token", "/refresh-token", "/account-info", "/link-social", "/unlink-account", "/change-email", "/update-user", "/oauth2/create-client"],
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false, disableImplicitLinking: true } },
    plugins: [genericOAuth({ config: [{
      providerId: "clio-ca", clientId: config.clientId, clientSecret: config.clientSecret,
      authorizationUrl: endpoints.authorize, tokenUrl: endpoints.token, authentication: "post", pkce: true,
      getUserInfo: async tokens => {
        const url = new URL(`${endpoints.api}/users/who_am_i.json`);
        url.searchParams.set("fields", "id,name,email,account{id}");
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${tokens.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return null;
        const parsed = identitySchema.safeParse(await response.json());
        if (!parsed.success) return null;
        const data = parsed.data.data;
        const id = `ca:${data.account.id}:${data.id}`;
        return { id, name: data.name, email: data.email, emailVerified: false };
      },
    }] }), ...integration.plugins],
  } satisfies BetterAuthOptions;
  const version = database.prepare("PRAGMA user_version").get()!.user_version;
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (version !== 0 && version !== 1 || version === 0 && tables.length) throw new Error("Unsupported hosted database schema");
  const migration = await getMigrations(options);
  if (version === 1 && (migration.toBeCreated.length || migration.toBeAdded.length || migration.toBeAddedIndexes.length)) {
    throw new Error("Hosted schema does not match the pinned migration");
  }
  if (version === 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      await migration.runMigrations();
      database.exec("PRAGMA user_version = 1; COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }
  const auth = betterAuth(options);
  const context = await auth.$context;
  await context.checkSchema?.();
  getToken = async (userId, accountId) => {
    const result = await auth.api.getAccessToken({ body: { userId, accountId } });
    assertConnection(userId, accountId);
    if (!result.accessToken) throw new Error("Clio connection missing");
    return result.accessToken;
  };
  return auth;
}
