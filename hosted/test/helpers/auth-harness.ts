import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { genericOAuth } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import { clioSimulator, close, listen, type Person } from "./clio-simulator.ts";

export async function authHarness() {
  const clio = await clioSimulator();
  const database = new DatabaseSync(":memory:");
  const server = createServer();
  const origin = await listen(server);
  const options = {
    baseURL: origin,
    database,
    secret: "test-only-secret-with-sufficient-entropy-1234567890",
    emailAndPassword: { enabled: false },
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
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  await auth.$context;
  server.on("request", toNodeHandler(auth));

  async function login(person: Person) {
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
      body: JSON.stringify({ provider: "clio-ca", callbackURL: `${origin}/connected` }),
      redirect: "manual",
    });
    assert.equal(start.status, 200, await start.clone().text());
    collect(start);
    const authorize = new URL((await start.json()).url);
    authorize.searchParams.set("person", person);
    const approved = await fetch(authorize, { redirect: "manual" });
    assert.equal(approved.status, 302);
    const callback = await fetch(approved.headers.get("location")!, { headers: headers(), redirect: "manual" });
    collect(callback);
    assert.equal(new URL(callback.headers.get("location")!, origin).pathname, "/connected");
    const session = await auth.api.getSession({ headers: new Headers(headers()) });
    assert.ok(session);
    const account = database.prepare("SELECT id, userId, accessToken, refreshToken FROM account WHERE userId = ?")
      .get(session.user.id) as { id: string; userId: string; accessToken: string; refreshToken: string };
    assert.ok(account);
    return { account, headers };
  }
  return { auth, database, origin, clio, login, async close() {
    await close(server);
    await clio.close();
    database.close();
  } };
}
