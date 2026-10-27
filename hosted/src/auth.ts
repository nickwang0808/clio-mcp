import type { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { z } from "zod";
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
  /** Verified Clio identities, formatted ca:firm:user. No email-domain authorization. */
  invitations: ReadonlySet<string>;
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
  if (origin.origin !== config.origin || config.secret.length < 32 || !config.clientId || !config.clientSecret || !config.invitations.size) {
    throw new Error("Invalid hosted configuration");
  }
  let getToken!: (userId: string, accountId: string) => Promise<string>;
  const integration = createMcpIntegration({ origin: config.origin, database, async clioRequest(connection, method, path, data) {
    const token = await getToken(connection.userId, connection.id);
    // Exactly one attempt, especially for writes whose result may be uncertain.
    const response = await fetch(`${endpoints.api}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify({ data }) }),
    });
    if (!response.ok) throw new Error("Clio request failed");
    return response.json();
  } });
  const options = {
    database, baseURL: config.origin, secret: config.secret,
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
        if (!config.invitations.has(id)) return null;
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
    if (!result.accessToken) throw new Error("Clio connection missing");
    return result.accessToken;
  };
  return auth;
}
