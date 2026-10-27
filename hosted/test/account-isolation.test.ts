import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { authHarness } from "./helpers/auth-harness.ts";

test("Clio-only browser logins keep different users separate and reject selecting another account", async () => {
  const h = await authHarness();
  try {
    const [alice, bob, carol] = await Promise.all([h.login("alice"), h.login("bob"), h.login("carol")]);
    assert.equal(new Set([alice.account.userId, bob.account.userId, carol.account.userId]).size, 3);
    await assert.rejects(h.auth.api.getAccessToken({ body: { userId: alice.account.userId, accountId: carol.account.id } }));
    for (const [person, loggedIn] of [["alice", alice], ["bob", bob], ["carol", carol]] as const) {
      const { accessToken } = await h.auth.api.getAccessToken({ body: { userId: loggedIn.account.userId, accountId: loggedIn.account.id } });
      assert.ok(accessToken?.startsWith(`simulated-${person}-`));
      assert.notEqual(loggedIn.account.accessToken, accessToken);
      const read = await fetch(`${h.clio.origin}/api/v4/matters/1.json`, { headers: { authorization: `Bearer ${accessToken}` } });
      assert.equal(read.status, person === "bob" ? 403 : 200);
      assert.equal(h.clio.requests.at(-1)?.person, person);
    }
    const spoofed = await fetch(`${h.origin}/api/auth/get-access-token`, {
      method: "POST", headers: { ...alice.headers(), "content-type": "application/json" },
      body: JSON.stringify({ userId: carol.account.userId, accountId: carol.account.id }),
    });
    assert.notEqual(spoofed.status, 200);
  } finally { await h.close(); }
});

// Characterization, NOT a passing security acceptance test. This records a
// library limitation; production adoption remains blocked until it is addressed.
test("GATE FAILURE: encrypted credential copied to another account is accepted by the library", async () => {
  const h = await authHarness();
  try {
    const alice = await h.login("alice");
    const carol = await h.login("carol");
    h.database.prepare("UPDATE account SET accessToken = ?, refreshToken = ? WHERE id = ?")
      .run(carol.account.accessToken, carol.account.refreshToken, alice.account.id);
    const { accessToken } = await h.auth.api.getAccessToken({ body: { userId: alice.account.userId, accountId: alice.account.id } });
    assert.ok(accessToken?.startsWith("simulated-carol-"));
    const read = await fetch(`${h.clio.origin}/api/v4/matters/1.json`, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(read.status, 200);
    assert.equal(h.clio.requests.at(-1)?.person, "carol");
    assert.equal((await read.json()).data.description, "B confidential fixture");
  } finally { await h.close(); }
});

test("GATE FAILURE: plaintext replacement is accepted even with token encryption enabled", async () => {
  const h = await authHarness();
  try {
    const alice = await h.login("alice");
    h.database.prepare("UPDATE account SET accessToken = ? WHERE id = ?")
      .run("plaintext-replacement", alice.account.id);
    const result = await h.auth.api.getAccessToken({ body: { userId: alice.account.userId, accountId: alice.account.id } });
    assert.equal(result.accessToken, "plaintext-replacement");
  } finally { await h.close(); }
});

test("GATE FAILURE: delayed upstream refresh overwrites a newer reconnect", { timeout: 10_000 }, async t => {
  const h = await authHarness();
  const gate = h.clio.pauseNextRefresh();
  let pending: Promise<unknown> | undefined;
  try {
    const alice = await h.login("alice");
    h.database.prepare("UPDATE account SET accessTokenExpiresAt = ? WHERE id = ?")
      .run(Date.now() - 60_000, alice.account.id);
    pending = h.auth.api.getAccessToken({ body: { userId: alice.account.userId, accountId: alice.account.id } });
    await Promise.race([gate.started, once(t.signal, "abort").then(() => {
      throw new Error("Refresh did not reach the simulator before test cancellation");
    })]);
    const reconnect = await h.login("alice");
    assert.equal(reconnect.account.id, alice.account.id);
    const latest = await h.auth.api.getAccessToken({ body: { userId: alice.account.userId, accountId: alice.account.id } });
    assert.ok(latest.accessToken?.startsWith("simulated-alice-"));
    gate.release();
    await pending;
    const after = await h.auth.api.getAccessToken({ body: { userId: alice.account.userId, accountId: alice.account.id } });
    assert.ok(after.accessToken?.startsWith("refreshed-alice-"));
    assert.notEqual(after.accessToken, latest.accessToken);
  } finally {
    gate.release();
    await pending?.catch(() => {});
    await h.close();
  }
});
