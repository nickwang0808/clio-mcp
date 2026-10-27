import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { McpServer } from "@modelcontextprotocol/server";

test("pinned auth plugins initialize SQLite and repeated migration is empty", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const options = {
      database,
      baseURL: "http://127.0.0.1:3000",
      secret: "feasibility-only-secret-not-a-production-credential-1234",
      plugins: [jwt(), mcp({
        resource: "http://127.0.0.1:3000/mcp",
        loginPage: "/login",
        consentPage: "/consent",
        refreshTokenReuseInterval: 0,
      })],
    } satisfies BetterAuthOptions;
    const migration = await getMigrations(options);
    assert.ok(migration.toBeCreated.some(({ table }) => table === "oauthAccessToken"));
    await migration.runMigrations();
    const repeated = await getMigrations(options);
    assert.equal(repeated.toBeCreated.length, 0);
    assert.equal(repeated.toBeAdded.length, 0);
    assert.equal(repeated.toBeAddedIndexes.length, 0);
    const context = await betterAuth(options).$context;
    // The adapter starts this asynchronously; await it before closing SQLite.
    await context.checkSchema?.();
  } finally {
    database.close();
  }
});

test("SDK v2 server can register the prototype read tool", async () => {
  const server = new McpServer({ name: "clio-feasibility", version: "0.0.0" });
  server.registerTool("get_identity", { description: "Test-only identity read" }, async () => ({
    content: [{ type: "text", text: "simulator only" }],
  }));
  await server.close();
});
