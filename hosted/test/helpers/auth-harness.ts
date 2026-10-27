import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { genericOAuth } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import { clioSimulator, close, listen, type Person } from "./clio-simulator.ts";
import { createTestHostedAuth } from "../../src/auth.ts";
import { createHostedHttpHandler } from "../../src/http.ts";
import { navigate } from "./browser.ts";

export async function authHarness({ hosted = false, databasePath = ":memory:", invitations = new Set(["ca:A:11", "ca:A:12", "ca:B:21"]) } = {}) {
  const clio = await clioSimulator();
  let database = new DatabaseSync(databasePath);
  const server = createServer();
  const origin = await listen(server);
  const options = {
    baseURL: origin,
    database,
    secret: "test-only-secret-with-sufficient-entropy-1234567890",
    emailAndPassword: { enabled: false },
    user: { deleteUser: { enabled: true } },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    plugins: [genericOAuth({ config: [{
      providerId: "clio-ca",
      clientId: "test-clio-client",
      clientSecret: "test-clio-secret",
      authorizationUrl: `${clio.origin}/oauth/authorize`,
      tokenUrl: `${clio.origin}/oauth/token`,
      authentication: "post",
      pkce: true,
      getUserInfo: async tokens => {
        const response = await fetch(`${clio.origin}/api/v4/users/who_am_i.json`, {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!response.ok) return null;
        const { data } = await response.json();
        if (!data?.id || !data?.account?.id || !data?.email) return null;
        return { id: `ca:${data.account.id}:${data.id}`, name: data.name, email: data.email, emailVerified: false };
      },
    }] })],
  } satisfies BetterAuthOptions;
  if (!hosted) await (await getMigrations(options)).runMigrations();
  const createHost = () => createTestHostedAuth(database, {
    origin, secret: options.secret, clientId: "test-clio-client", clientSecret: "test-clio-secret",
    invitations, audit: () => {},
  }, clio.origin);
  let auth = hosted ? await createHost() : betterAuth(options);
  await auth.$context;
  server.on("request", (req, res) => {
    const handler = hosted ? createHostedHttpHandler(auth as Awaited<ReturnType<typeof createTestHostedAuth>>, origin) : toNodeHandler(auth);
    void handler(req, res);
  });

  async function login(person: Person, oauthQuery?: string) {
    const cookies = new Map<string, string>();
    function collect(response: Response) {
      for (const cookie of response.headers.getSetCookie()) {
        const part = cookie.split(";")[0];
        const split = part.indexOf("=");
        cookies.set(part.slice(0, split), part.slice(split + 1));
      }
    }
    function headers() {
      return { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), origin };
    }
    const start = await fetch(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ provider: "clio-ca", callbackURL: `${origin}/connected`, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) }),
      redirect: "manual",
    });
    assert.equal(start.status, 200, await start.clone().text());
    collect(start);
    const authorize = new URL((await start.json()).url);
    authorize.searchParams.set("person", person);
    const approved = await fetch(authorize, { redirect: "manual" });
    assert.equal(approved.status, 302);
    const callback = await navigate(approved.headers.get("location")!, headers());
    collect(callback);
    const callbackUrl = new URL(callback.headers.get("location")!, origin);
    assert.equal(callbackUrl.pathname, oauthQuery ? "/consent" : "/connected", await callback.clone().text());
    const session = await auth.api.getSession({ headers: new Headers(headers()) });
    assert.ok(session);
    const account = database.prepare("SELECT id, userId, accessToken, refreshToken FROM account WHERE userId = ?")
      .get(session.user.id) as { id: string; userId: string; accessToken: string; refreshToken: string };
    assert.ok(account);
    return { account, headers, callbackUrl };
  }
  return { get auth() { return auth; }, get database() { return database; }, origin, clio, login,
    async restart(path = databasePath) {
      if (!hosted) throw new Error("Restart is for the hosted implementation");
      database.close();
      database = new DatabaseSync(path);
      auth = await createHost();
    }, async close() {
    await close(server);
    await clio.close();
    database.close();
  } };
}
