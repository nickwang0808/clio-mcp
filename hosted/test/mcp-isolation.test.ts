import assert from "node:assert/strict";
import { test } from "node:test";
import { authHarness } from "./helpers/auth-harness.ts";
import { connectMcp } from "./helpers/mcp-client.ts";

test("library OAuth grants route MCP reads and writes to the consenting user's Clio connection", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const bob = await connectMcp(h, "bob");
    const carol = await connectMcp(h, "carol");
    for (const client of [alice, bob, carol]) {
      assert.equal(client.tokens.access_token.split(".").length, 1, "MCP credentials must be opaque");
      const stored = h.database.prepare("SELECT token FROM oauthAccessToken WHERE userId = ?").get(client.login.account.userId)!;
      assert.notEqual(stored.token, client.tokens.access_token, "Store only bearer-token hashes");
    }
    const calls = Array.from({ length: 12 }, (_, i) => i % 2 ? carol : alice);
    const reads = await Promise.all(calls.map(client => client.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1 } })));
    reads.forEach((read, i) => {
      assert.equal(read.status, 200, JSON.stringify(read.body));
      assert.equal(read.body.result.isError, undefined, JSON.stringify(read.body));
      assert.match(read.body.result.content[0].text, i % 2 ? /B confidential fixture/ : /A confidential fixture/);
    });
    const restricted = await bob.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1 } });
    assert.equal(restricted.body.result.isError, true);
    assert.equal(h.clio.requests.at(-1)?.person, "bob");
    await Promise.all([alice, carol].map((client, i) => client.rpc("tools/call", {
      name: "update_matter", arguments: { matter_id: 1, description: i ? "Carol's edit" : "Alice's edit" },
    }).then(result => assert.notEqual(result.body.result.isError, true))));
    for (const [client, expected] of [[alice, "Alice's edit"], [carol, "Carol's edit"]] as const) {
      const read = await client.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1 } });
      assert.equal(JSON.parse(read.body.result.content[0].text).description, expected);
    }
    const deniedWrite = await bob.rpc("tools/call", { name: "update_matter", arguments: { matter_id: 1, description: "Unauthorized" } });
    assert.equal(deniedWrite.body.result.isError, true);
    const before = h.clio.requests.length;
    const injected = await alice.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1, accountId: carol.login.account.id } });
    assert.ok(injected.body.error || injected.body.result?.isError);
    assert.equal(h.clio.requests.length, before);
  } finally { await h.close(); }
});

test("delete tools use the consenting user's connection and preserve other firms' records", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const bob = await connectMcp(h, "bob");
    const carol = await connectMcp(h, "carol");
    const listed = (await alice.rpc("tools/list", {})).body.result.tools;
    for (const resource of ["matter", "contact", "note"]) {
      const name = `delete_${resource}`;
      assert.equal(listed.find((tool: { name: string }) => tool.name === name)?.annotations?.destructiveHint, true);
      const args = { [`${resource}_id`]: 1 };
      const denied = await bob.rpc("tools/call", { name, arguments: args });
      assert.equal(denied.body.result.isError, true);
      assert.equal(h.clio.requests.at(-1)?.person, "bob");
      const before = h.clio.requests.length;
      const injected = await alice.rpc("tools/call", { name, arguments: { ...args, accountId: carol.login.account.id } });
      assert.ok(injected.body.error || injected.body.result?.isError);
      assert.equal(h.clio.requests.length, before);
      const removed = await alice.rpc("tools/call", { name, arguments: args });
      assert.notEqual(removed.body.result.isError, true, JSON.stringify(removed.body));
      assert.equal(h.clio.requests.at(-1)?.person, "alice");
      assert.equal(h.clio.requests.at(-1)?.method, "DELETE");
      // Repeating Alice's delete sees her missing record; Carol's identical ID still exists.
      const [repeat, otherFirm] = await Promise.all([alice, carol].map(client => client.rpc("tools/call", { name, arguments: args })));
      assert.equal(repeat.body.result.isError, true);
      assert.notEqual(otherFirm.body.result.isError, true, JSON.stringify(otherFirm.body));
    }
  } finally { await h.close(); }
});

test("a delete with a lost response is not automatically replayed", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const before = h.clio.requests.length;
    h.clio.dropNextWriteResponse();
    const result = await alice.rpc("tools/call", { name: "delete_matter", arguments: { matter_id: 1 } });
    assert.equal(result.body.result.isError, true);
    assert.match(result.body.result.content[0].text, /Check its outcome/);
    assert.equal(h.clio.requests.length - before, 1);
    const read = await alice.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1 } });
    assert.equal(read.body.result.content[0].text, "Matter 1 not found.");
  } finally { await h.close(); }
});

test("a read-only grant cannot invoke a write, and refresh tokens are not MCP access tokens", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice", "clio:read offline_access");
    const tools = await alice.rpc("tools/list", {});
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("get_matter") && names.includes("list_contacts"));
    assert.ok(!names.includes("update_matter") && !names.includes("create_contact"));
    for (const resource of ["matter", "contact", "note"]) {
      const name = `delete_${resource}`;
      assert.ok(!names.includes(name));
      const before = h.clio.requests.length;
      const denied = await alice.rpc("tools/call", { name, arguments: { [`${resource}_id`]: 1 } });
      assert.ok(denied.body.error || denied.body.result?.isError);
      assert.equal(h.clio.requests.length, before);
    }
    const before = h.clio.requests.length;
    const write = await alice.rpc("tools/call", { name: "update_matter", arguments: { matter_id: 1, description: "Denied" } });
    assert.ok(write.body.error || write.body.result?.isError);
    assert.equal(h.clio.requests.length, before);
    assert.equal((await alice.rpc("tools/list", {}, alice.tokens.refresh_token)).status, 401);
    assert.equal((await alice.rpc("tools/list", {}, "invalid-token")).status, 401);
  } finally { await h.close(); }
});

test("an old grant cannot attach to a replacement Clio account after removal", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    await h.auth.api.deleteUser({ body: {}, headers: new Headers(alice.login.headers()) });
    assert.equal((await alice.rpc("tools/list", {})).status, 401);
    const reconnect = await h.login("alice");
    assert.notEqual(reconnect.account.id, alice.login.account.id);
    assert.equal((await alice.rpc("tools/list", {})).status, 401);
  } finally { await h.close(); }
});

test("one-use codes, client-bound refresh, and token revocation use library enforcement", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const refresh = (clientId: string) => fetch(`${h.origin}/api/auth/oauth2/token`, {
      method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId,
        refresh_token: alice.tokens.refresh_token, resource: `${h.origin}/api/auth/mcp` }),
    });
    assert.equal((await refresh("unregistered-client")).status, 400);
    const refreshed = await refresh(alice.client.client_id);
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const tokens = await refreshed.json();
    assert.equal((await alice.rpc("tools/list", {}, tokens.access_token)).status, 200);
    const revoked = await fetch(`${h.origin}/api/auth/oauth2/revoke`, {
      method: "POST", body: new URLSearchParams({ client_id: alice.client.client_id,
        token: tokens.access_token, token_type_hint: "access_token" }),
    });
    assert.equal(revoked.status, 200, await revoked.clone().text());
    assert.equal((await alice.rpc("tools/list", {}, tokens.access_token)).status, 401);
    const replay = await fetch(`${h.origin}/api/auth/oauth2/token`, { method: "POST", body: alice.exchangeBody });
    assert.equal(replay.status, 400);
  } finally { await h.close(); }
});

test("a write applied by Clio with a lost response is not automatically replayed", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const before = h.clio.requests.length;
    h.clio.dropNextWriteResponse();
    const result = await alice.rpc("tools/call", { name: "update_matter", arguments: { matter_id: 1, description: "Applied once" } });
    assert.equal(result.body.result.isError, true);
    assert.match(result.body.result.content[0].text, /Check its outcome/);
    assert.equal(h.clio.requests.length - before, 1);
    const read = await alice.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1 } });
    assert.equal(JSON.parse(read.body.result.content[0].text).description, "Applied once");
  } finally { await h.close(); }
});

test("removing an account alone rejects grants even if a replacement row belongs to the same user", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    h.database.prepare("UPDATE account SET id = ? WHERE id = ?").run("replacement-row", alice.login.account.id);
    assert.equal((await alice.rpc("tools/list", {})).status, 401);
  } finally { await h.close(); }
});

test("PKCE and resource substitution are rejected at token exchange", async () => {
  const h = await authHarness({ hosted: true });
  try {
    await assert.rejects(connectMcp(h, "alice", "clio:read", body => body.set("code_verifier", "x".repeat(43))), /invalid_grant/);
    await assert.rejects(connectMcp(h, "carol", "clio:read", body => body.set("resource", "https://other.example.test/mcp")), /invalid_target/);
  } finally { await h.close(); }
});

test("expired MCP credentials and direct upstream credentials are rejected", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const upstream = await h.auth.api.getAccessToken({ body: { userId: alice.login.account.userId, accountId: alice.login.account.id } });
    assert.equal((await alice.rpc("tools/list", {}, upstream.accessToken!)).status, 401);
    h.database.prepare("UPDATE oauthAccessToken SET expiresAt = ? WHERE userId = ?").run(Date.now() - 60_000, alice.login.account.userId);
    assert.equal((await alice.rpc("tools/list", {})).status, 401);
  } finally { await h.close(); }
});

test("downstream refresh retries recover one token set within the library retry window", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    const refresh = () => fetch(`${h.origin}/api/auth/oauth2/token`, {
      method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: alice.client.client_id,
        refresh_token: alice.tokens.refresh_token, resource: `${h.origin}/api/auth/mcp` }),
    });
    const results = await Promise.all([refresh(), refresh()]);
    assert.ok(results.some(response => response.status === 200));
    assert.ok(results.every(response => response.status === 200 || response.status === 400));
    const issued = await results.find(response => response.status === 200)!.json();
    const retried = await refresh();
    assert.equal(retried.status, 200, await retried.clone().text());
    const recovered = await retried.json();
    assert.equal(recovered.access_token, issued.access_token);
    assert.equal(recovered.refresh_token, issued.refresh_token);
    assert.equal((await alice.rpc("tools/list", {}, issued.access_token)).status, 200);
    assert.equal(h.database.prepare("SELECT count(*) AS n FROM oauthRefreshToken WHERE userId = ? AND revoked IS NULL").get(alice.login.account.userId)!.n, 1);
    h.database.prepare("UPDATE oauthRefreshToken SET rotationReplayExpiresAt = ? WHERE userId = ? AND revoked IS NOT NULL")
      .run(Date.now() - 60_000, alice.login.account.userId);
    assert.equal((await refresh()).status, 400);
    assert.equal((await alice.rpc("tools/list", {}, issued.access_token)).status, 401);
  } finally { await h.close(); }
});
