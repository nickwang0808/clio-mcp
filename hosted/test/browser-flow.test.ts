import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { navigate } from "./helpers/browser.ts";
import { authHarness } from "./helpers/auth-harness.ts";

test("first-time browser authorization resumes after Clio login and renders verified consent", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const registered = await fetch(`${h.origin}/api/auth/oauth2/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      client_name: "Example AI", redirect_uris: ["https://client.example.test/callback"], token_endpoint_auth_method: "none", scope: "clio:read clio:write offline_access",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    }) });
    assert.equal(registered.status, 201);
    const client = await registered.json();
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: "https://client.example.test/callback",
      response_type: "code", scope: "clio:read clio:write offline_access", resource: `${h.origin}/api/auth/mcp`, state: "client-state",
      code_challenge: createHash("sha256").update("a".repeat(43)).digest("base64url"), code_challenge_method: "S256" });
    const authorize = await navigate(`${h.origin}/api/auth/oauth2/authorize?${query}`);
    assert.equal(authorize.status, 302, await authorize.clone().text());
    const loginUrl = new URL(authorize.headers.get("location")!, h.origin);
    assert.equal(loginUrl.pathname, "/login");
    const page = await fetch(loginUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Continue with Clio/);
    const login = await h.login("alice", loginUrl.search.slice(1));
    const consent = await fetch(login.callbackUrl, { headers: login.headers() });
    assert.equal(consent.status, 200, await consent.clone().text());
    assert.match(await consent.text(), /Example AI/);
    const tampered = new URL(login.callbackUrl);
    tampered.searchParams.set("scope", "clio:read");
    assert.equal((await fetch(tampered, { headers: login.headers() })).status, 400);
    const discovery = await fetch(`${h.origin}/.well-known/oauth-protected-resource/api/auth/mcp`);
    assert.equal(discovery.status, 200);
    assert.equal((await discovery.json()).resource, `${h.origin}/api/auth/mcp`);
  } finally { await h.close(); }
});
