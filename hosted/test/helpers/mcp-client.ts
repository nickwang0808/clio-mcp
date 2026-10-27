import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { authHarness } from "./auth-harness.ts";
import type { Person } from "./clio-simulator.ts";

export async function connectMcp(h: Awaited<ReturnType<typeof authHarness>>, person: Person, scope = "clio:read clio:write offline_access", alterExchange?: (body: URLSearchParams) => void) {
  const login = await h.login(person);
  const redirect = "https://client.example.test/callback";
  const registered = await fetch(`${h.origin}/api/auth/oauth2/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Offline MCP test", redirect_uris: [redirect],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope }),
  });
  assert.equal(registered.status, 201, await registered.clone().text());
  const client = await registered.json();
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${h.origin}/api/auth/oauth2/authorize`);
  authorize.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", scope,
    resource: `${h.origin}/api/auth/mcp`, state: "test-client-state", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  const authorized = await fetch(authorize, { headers: { ...login.headers(), accept: "text/html" }, redirect: "manual" });
  assert.equal(authorized.status, 200, await authorized.clone().text());
  const consentUrl = new URL((await authorized.json()).url, h.origin);
  assert.equal(consentUrl.pathname, "/consent");
  const consent = await fetch(`${h.origin}/api/auth/oauth2/consent`, {
    method: "POST", headers: { ...login.headers(), "content-type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.searchParams.toString() }), redirect: "manual",
  });
  assert.equal(consent.status, 200, await consent.clone().text());
  const callback = new URL((await consent.json()).url);
  assert.equal(callback.searchParams.get("state"), "test-client-state");
  const exchangeBody = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id,
    code: callback.searchParams.get("code")!, redirect_uri: redirect, code_verifier: verifier, resource: `${h.origin}/api/auth/mcp` });
  alterExchange?.(exchangeBody);
  const exchanged = await fetch(`${h.origin}/api/auth/oauth2/token`, { method: "POST", body: exchangeBody });
  assert.equal(exchanged.status, 200, await exchanged.clone().text());
  const tokens = await exchanged.json();
  async function rpc(method: string, params: unknown, token = tokens.access_token) {
    const response = await fetch(`${h.origin}/api/auth/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await response.text();
    const payload = text.startsWith("event:") ? text.split("\n").find(line => line.startsWith("data: "))!.slice(6) : text;
    return { status: response.status, body: JSON.parse(payload) };
  }
  return { login, client, tokens, rpc, exchangeBody };
}
