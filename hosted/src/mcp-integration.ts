import type { DatabaseSync } from "node:sqlite";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { mcp, type McpOptions } from "@better-auth/mcp";
import { createResourceServerChallenge, getOAuthProviderApi } from "@better-auth/oauth-provider";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { SessionContext } from "../../build/lib.js";
import { registerHostedTools } from "./tools.ts";

export interface Connection { id: string; userId: string }
export interface McpIntegrationOptions {
  origin: string;
  database: DatabaseSync;
  /** Trusted host function; never receives user-selected credentials. */
  session(connection: Connection): SessionContext;
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
      registerHostedTools(server, scopes, () => options.session(connectionFor(connection.userId, connection.id)));
      return server;
    }, { legacy: "stateless", maxRequestBodySize: 64 * 1024 });
    return handler.fetch(ctx.request!);
  });
  const resourcePlugin = { id: "clio-mcp-resource", endpoints: { clioMcp: endpoint } } satisfies BetterAuthPlugin;
  return { resource, plugins: [mcp(oauthOptions), resourcePlugin] as const };
}
