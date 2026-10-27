import type { DatabaseSync } from "node:sqlite";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { mcp, type McpOptions } from "@better-auth/mcp";
import { createResourceServerChallenge, getOAuthProviderApi } from "@better-auth/oauth-provider";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

interface Connection { id: string; userId: string }
export interface McpIntegrationOptions {
  origin: string;
  database: DatabaseSync;
  /** Trusted host function; never receives user-selected credentials. */
  clioRequest(connection: Connection, method: "GET" | "PATCH", path: string, data?: unknown): Promise<unknown>;
}

/** Small resource adapter: the library owns OAuth; SQLite owns connection identity. */
export function createMcpIntegration(options: McpIntegrationOptions) {
  const resource = `${options.origin}/api/auth/mcp`;
  function connectionFor(userId: string, accountId?: string): Connection {
    const rows = options.database.prepare(
      "SELECT id, userId FROM account WHERE userId = ? AND providerId = 'clio-ca'" +
      (accountId === undefined ? "" : " AND id = ?"),
    ).all(...(accountId === undefined ? [userId] : [userId, accountId]));
    if (rows.length !== 1) throw new APIError("UNAUTHORIZED", { message: "Reconnect Clio to continue" });
    return rows[0] as unknown as Connection;
  }
  const oauthOptions: McpOptions = {
    resource,
    loginPage: "/login",
    consentPage: "/consent",
    disableJwtPlugin: true,
    grantTypes: ["authorization_code", "refresh_token"],
    scopes: ["clio:read", "clio:write", "offline_access"],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    refreshTokenReuseInterval: 0,
    storeTokens: "hashed",
    postLogin: {
      page: "/connected",
      shouldRedirect: () => false,
      consentReferenceId: ({ user }) => connectionFor(user.id).id,
    },
    customAccessTokenClaims: ({ user, referenceId }) => ({
      // Reuse the reference persisted on the original grant, never the latest account.
      clio_connection: user && referenceId ? referenceId : null,
    }),
  };
  const endpoint = createAuthEndpoint("/mcp", {
    method: ["GET", "POST", "DELETE"],
    disableBody: true,
    requireHeaders: true,
  }, async ctx => {
    let connection: Connection;
    let scopes: Set<string>;
    try {
      const bearer = /^Bearer ([^\s]+)$/i.exec(ctx.headers.get("authorization") ?? "");
      if (!bearer) throw new APIError("UNAUTHORIZED", { error: "invalid_token" });
      const claims = await getOAuthProviderApi(ctx, oauthOptions).requireActiveAccessToken(bearer[1]);
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(resource) || claims.iss !== `${options.origin}/api/auth` ||
          typeof claims.sub !== "string" || typeof claims.clio_connection !== "string" || claims.cnf) {
        throw new APIError("UNAUTHORIZED", { error: "invalid_token" });
      }
      connection = connectionFor(claims.sub, claims.clio_connection);
      scopes = new Set(typeof claims.scope === "string" ? claims.scope.split(" ") : []);
    } catch (error) {
      const challenge = createResourceServerChallenge(error, resource);
      if (challenge) throw challenge;
      throw new APIError("UNAUTHORIZED", { message: "Invalid or disconnected Clio authorization" }, {
        "WWW-Authenticate": `Bearer resource_metadata="${options.origin}/.well-known/oauth-protected-resource/api/auth/mcp"`,
      });
    }
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "hosted-clio-prototype", version: "0.0.0" });
      async function call(method: "GET" | "PATCH", id: string, data?: unknown) {
        // Recheck at dispatch so an account removed after HTTP authorization cannot be selected.
        connectionFor(connection.userId, connection.id);
        try {
          const result = await options.clioRequest(connection, method, `/matters/${id}.json`, data);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch {
          // Do not expose upstream payloads, tokens, or internal error details.
          return { isError: true, content: [{ type: "text" as const, text: "Clio request failed; check connection and permissions. Writes were not retried." }] };
        }
      }
      if (scopes.has("clio:read")) server.registerTool("get_matter", {
        description: "Read a matter with your own Clio permissions",
        inputSchema: z.object({ id: z.string().regex(/^[1-9][0-9]*$/) }).strict(),
        annotations: { readOnlyHint: true },
      }, ({ id }) => call("GET", id));
      if (scopes.has("clio:write")) server.registerTool("update_matter", {
        description: "Update a matter description with your own Clio permissions",
        inputSchema: z.object({ id: z.string().regex(/^[1-9][0-9]*$/), description: z.string().min(1).max(2000) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true },
      }, ({ id, description }) => call("PATCH", id, { description }));
      return server;
    }, { legacy: "stateless", maxRequestBodySize: 64 * 1024 });
    return handler.fetch(ctx.request!);
  });
  const resourcePlugin = { id: "clio-mcp-resource", endpoints: { clioMcp: endpoint } } satisfies BetterAuthPlugin;
  return { resource, plugins: [mcp(oauthOptions), resourcePlugin] as const };
}
