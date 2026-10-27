import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";

export const people = {
  alice: { id: "11", name: "Alice", email: "alice@example.test", account: { id: "A" } },
  bob: { id: "12", name: "Bob", email: "bob@example.test", account: { id: "A" } },
  carol: { id: "21", name: "Carol", email: "carol@example.test", account: { id: "B" } },
} as const;
export type Person = keyof typeof people;

export async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local TCP address");
  return `http://127.0.0.1:${address.port}`;
}

export async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

// Test infrastructure only: choosing a person simulates Clio's own login screen.
// There is intentionally no import of this helper from application code.
export async function clioSimulator() {
  const codes = new Map<string, { person: Person; redirect: string; challenge: string }>();
  const credentials = new Map<string, Person>();
  const refreshCredentials = new Map<string, Person>();
  const matters = { A: "A confidential fixture", B: "B confidential fixture" };
  const profiles = new Map<Person, unknown>();
  let dropWriteResponse = false;
  let refreshGate: { entered(): void; release: Promise<void> } | undefined;
  const requests: { person: Person; token: string; path: string }[] = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://127.0.0.1");
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === "/oauth/authorize") {
        const person = url.searchParams.get("person") as Person;
        const redirect = url.searchParams.get("redirect_uri");
        const challenge = url.searchParams.get("code_challenge");
        if (!(person in people) || !redirect || !challenge ||
            url.searchParams.get("client_id") !== "test-clio-client" ||
            url.searchParams.get("code_challenge_method") !== "S256") {
          return json(400, { error: "invalid_request" });
        }
        const code = randomUUID();
        codes.set(code, { person, redirect, challenge });
        const callback = new URL(redirect);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", url.searchParams.get("state")!);
        res.writeHead(302, { location: callback.href });
        return res.end();
      }
      if (url.pathname === "/oauth/token" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        if (body.get("client_id") !== "test-clio-client" || body.get("client_secret") !== "test-clio-secret") {
          return json(401, { error: "invalid_client" });
        }
        if (body.get("grant_type") === "refresh_token") {
          const person = refreshCredentials.get(body.get("refresh_token") ?? "");
          if (!person) return json(400, { error: "invalid_grant" });
          const gate = refreshGate;
          refreshGate = undefined;
          gate?.entered();
          await gate?.release;
          const access = `refreshed-${person}-${randomUUID()}`;
          credentials.set(access, person);
          return json(200, { access_token: access, expires_in: 3600, token_type: "Bearer" });
        }
        const code = body.get("code") ?? "";
        const grant = codes.get(code);
        if (!grant || body.get("grant_type") !== "authorization_code" ||
            body.get("redirect_uri") !== grant.redirect ||
            createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") !== grant.challenge) {
          return json(400, { error: "invalid_grant" });
        }
        codes.delete(code);
        const access = `simulated-${grant.person}-${randomUUID()}`;
        credentials.set(access, grant.person);
        const refresh = `refresh-${randomUUID()}`;
        refreshCredentials.set(refresh, grant.person);
        return json(200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "Bearer" });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const person = credentials.get(token);
      if (!person) return json(401, { error: "unauthorized" });
      requests.push({ person, token, path: url.pathname });
      if (url.pathname === "/api/v4/users/who_am_i.json") return json(200, { data: profiles.has(person) ? profiles.get(person) : people[person] });
      if (url.pathname === "/api/v4/matters/1.json") {
        if (person === "bob") return json(403, { error: "forbidden" });
        const firm = people[person].account.id;
        if (req.method === "PATCH") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          matters[firm] = JSON.parse(Buffer.concat(chunks).toString()).data.description;
          if (dropWriteResponse) { dropWriteResponse = false; res.destroy(); return; }
        }
        return json(200, { data: { id: 1, description: matters[firm] } });
      }
      return json(404, { error: "not_found" });
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  const origin = await listen(server);
  return { origin, requests, close: () => close(server),
    setProfile(person: Person, profile: unknown) { profiles.set(person, profile); },
    dropNextWriteResponse() { dropWriteResponse = true; },
    pauseNextRefresh() {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    refreshGate = { entered, release: new Promise<void>(resolve => { release = resolve; }) };
    return { started, release };
  } };
}
