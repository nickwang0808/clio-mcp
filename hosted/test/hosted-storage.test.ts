import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHostedAuth, createTestHostedAuth } from "../src/auth.ts";
import { authHarness } from "./helpers/auth-harness.ts";
import { connectMcp } from "./helpers/mcp-client.ts";

test("file-backed SQLite preserves grants across restart and fresh storage rejects old credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-hosted-"));
  const h = await authHarness({ hosted: true, databasePath: join(directory, "auth.sqlite") });
  try {
    const alice = await connectMcp(h, "alice");
    await h.restart();
    assert.equal((await alice.rpc("tools/list", {})).status, 200);
    await h.restart(join(directory, "replacement.sqlite"));
    assert.equal((await alice.rpc("tools/list", {})).status, 401);
    const refreshed = await fetch(`${h.origin}/api/auth/oauth2/token`, { method: "POST", body: new URLSearchParams({
      grant_type: "refresh_token", client_id: alice.client.client_id, refresh_token: alice.tokens.refresh_token,
    }) });
    assert.notEqual(refreshed.status, 200);
    const newConnection = await connectMcp(h, "alice");
    assert.equal((await newConnection.rpc("tools/list", {})).status, 200);
    assert.equal((await alice.rpc("tools/list", {})).status, 401);
  } finally { await h.close(); await rm(directory, { recursive: true, force: true }); }
});

test("browser routes cannot return upstream tokens; internal retrieval still serves MCP", async () => {
  const h = await authHarness({ hosted: true });
  try {
    const alice = await connectMcp(h, "alice");
    for (const route of ["get-access-token", "refresh-token", "account-info", "unlink-account", "link-social"]) {
      const result = await fetch(`${h.origin}/api/auth/${route}`, {
        method: "POST", headers: { ...alice.login.headers(), "content-type": "application/json" },
        body: JSON.stringify({ accountId: alice.login.account.id, userId: alice.login.account.userId }),
      });
      assert.equal(result.status, 404, route);
    }
    const read = await alice.rpc("tools/call", { name: "get_matter", arguments: { matter_id: 1 } });
    assert.notEqual(read.body.result.isError, true);
  } finally { await h.close(); }
});

test("uninvited Clio identities cannot create hosted accounts", async () => {
  const h = await authHarness({ hosted: true, invitations: new Set(["ca:A:11"]) });
  try {
    await assert.rejects(h.login("carol"));
    assert.equal(h.database.prepare('SELECT count(*) AS n FROM "user"').get()!.n, 0);
    await h.login("alice");
  } finally { await h.close(); }
});

test("startup rejects unknown schema versions and production rejects insecure origins", async () => {
  const database = new DatabaseSync(":memory:");
  const config = { origin: "http://127.0.0.1:3000", secret: "test-only-012345678901234567890123456789", clientId: "test", clientSecret: "test", invitations: new Set(["ca:A:11"]) };
  try {
    await assert.rejects(createHostedAuth(database, config), /HTTPS/);
    database.exec("PRAGMA user_version = 99");
    await assert.rejects(createTestHostedAuth(database, config, "http://127.0.0.1:3001"), /Unsupported hosted database schema/);
    assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, 99);
  } finally { database.close(); }
});
