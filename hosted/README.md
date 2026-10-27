# Hosted Clio Canada

Working offline-tested implementation; not yet accepted against live Clio or
deployed. Clio is the only login provider. Better Auth handles browser sessions
and downstream OAuth; the official MCP SDK v2 serves the existing Clio tools.

The current policy registers **37 tools: 23 reads and 14 writes**. Exclusions:
three delete tools, server-file document upload, audit export, and local
authentication tools. Updates can still be destructive. Upload requirements and
the final deletion policy need confirmation before claiming full capability.

Self-hosted transports retain SDK v1 for compatibility. A small registration
adapter shares their handlers with hosted SDK v2. Shared schemas use Zod v4;
there is no second copy of the Clio tool implementations.

## Development and verification

Use Node 24 or newer. From the repository root:

```sh
npm ci
npm run build
npm --prefix hosted ci
npm --prefix hosted run typecheck
npm --prefix hosted test
```

Tests simulate Clio locally. To enforce isolation from the public internet, use
the same Linux container as the new CI job:

```sh
docker build --target test -f hosted/Dockerfile -t clio-hosted-test .
docker run --rm --network none clio-hosted-test
docker build --target runtime -f hosted/Dockerfile -t clio-hosted-runtime .
```

Completed locally: root build, 594 shared tests, 22 hosted tests, hosted type
checks, Linux suites with networking disabled, package secret scan, and runtime
startup/health with synthetic configuration. Three original `GATE FAILURE`
tests reproduce known limitations; passing them does not mean those limitations
are fixed. Both dependency audits reported no known vulnerabilities after updates.

## Configuration and startup

| Variable | Meaning |
| --- | --- |
| HOSTED_ORIGIN | Exact HTTPS origin, without a trailing slash or path |
| HOSTED_DATABASE_PATH | Absolute persistent SQLite path; normally /data/auth.sqlite |
| BETTER_AUTH_SECRET | Separately managed high-entropy secret, at least 32 characters; keep off the volume |
| CLIO_CLIENT_ID / CLIO_CLIENT_SECRET | Canadian Clio app credentials, supplied as deployment secrets |
| CLIO_INVITED_IDENTITIES | Comma-separated verified identities: ca:firm-id:user-id; never email-domain authorization |
| HOSTED_TRUST_FLY_PROXY | True only when all public traffic arrives through Fly Proxy |
| PORT | Defaults to 8080 |

Start with `npm --prefix hosted start` after building the shared library, or use
the runtime image. Production accepts no simulator endpoint overrides. The test
constructor accepts only loopback origins.

MCP address: `HOSTED_ORIGIN/api/auth/mcp`. Clio callback:
`HOSTED_ORIGIN/api/auth/callback/clio-ca`. Browser pages are `/login`, `/consent`,
and `/connected`; discovery is library-managed. Consent identifies the AI client
and requested access. `/health` becomes available after initialization.

Use exactly one process/Machine. The runtime image uses UID/GID 1000; its mounted
database directory and existing database/WAL files must be writable by that user.
Provisioning Fly volume permissions remains part of staging setup. The example
Fly configuration deliberately names no existing app and is not named fly.toml.

Incoming bodies are limited to 64 KB. Better Auth enforces database-backed rate
limits. These are currently IP-based; test realistic client/proxy sharing and tune
before public access. The host overwrites its internal IP header and trusts
Fly-Client-IP only when configured. See [Fly's header contract](https://docs.fly.io/networking/request-headers).

## Ownership and lifecycle

- Each grant retains the original Clio account-row ID. Tool calls recheck that
  reference against the authorized user. Caller-supplied firm/account/session IDs
  cannot select credentials.
- MCP access tokens are opaque and validated against live state. The library
  hashes stored downstream tokens and encrypts Clio credentials. Public upstream
  token-returning and account-linking routes are disabled; internal retrieval
  selects an explicit owner and account ID.
- Disconnect uses the library's session-authorized user deletion. Old grants
  cannot attach to a new user/account. This does not revoke authorization at Clio;
  users can revoke that separately there.
- Hosted HTTP requests make one attempt. A lost write response asks the user to
  check the outcome; the write is not automatically retried.
- Audit output contains internal owner/connection/request IDs, tool name, and
  outcome. No shared audit file, tool arguments, upstream error bodies, or results
  are logged. Audit export remains disabled.

The upstream refresh/reconnect overwrite is deferred in [issue #1](https://github.com/nickwang0808/clio-mcp/issues/1).
Record substitution and plaintext fallback remain characterized library behavior.
This implementation trusts database integrity instead of adding a credential vault;
the tests did not demonstrate a public cross-firm exploit.

Downstream MCP refresh uses the library's 30-second response-recovery window.
Identical retries can recover the same token pair. Tests verify one active branch
and rejection/family invalidation for a later sequential replay. An earlier strict
mode test exposed incomplete family invalidation under concurrency. The selected
retry window addresses the tested duplicate-request behavior; it does not prove
every revocation race solved. This is separate from upstream issue #1.

## SQLite migrations and recovery

Startup initializes an empty database transactionally, records schema version 1,
and starts serving only afterward. Restart checks the pinned schema and rejects
unknown versions or missing elements rather than resetting data. Future schema
changes require explicit migrations and populated-database tests. No automatic
destructive migration or downgrade is provided.

Migrate on the application Machine with its volume attached, not in a Fly release
command. Keep one writer. Better Auth currently emits TEXT-versus-string-array
introspection warnings; exercised persistence and restart tests pass, but recheck
these warnings when upgrading.

Accepted total-loss recovery is **fresh storage and user reconnection**. Stop the
application, preserve failed files separately if needed, provision a fresh writable
store, and restart. Some clients may need to remove and re-add the connector.
Secrets and invitation configuration must survive outside the lost database.
Registrations and local history will be lost.

Never restore an old authentication snapshot directly into a serving application:
it can revive revoked grants. Inspect snapshots offline; use fresh storage until a
tested invalidating-restore command exists. Secret rotation currently requires an
explicit reconnect/reset procedure, not in-place re-encryption. Never automatically
erase a database following a decryption or migration failure.

## Before staging or public access

- Confirm Canadian identity fields (`id,name,email,account{id}`), app permissions,
  PKCE support, and live refresh/revocation behavior. Simulation does not verify
  Clio's actual contract.
- Verify the intended AI client's registration, scopes, browser, and MCP protocol.
  Automated HTTP tests exercise 2025-era stateless compatibility through SDK v2;
  live client compatibility has not been demonstrated.
- Resolve pilot upload scope and deletion policy. The original server-file upload
  cannot be exposed as-is on a shared service.
- Complete authorized live tests across two Canadian firms and differently
  permissioned users, with fictional data and explicitly authorized writes.
- Review remaining concurrency/revocation cases, load and rate limits, response
  sizes, populated schema upgrades, monitoring, and retention before public claims.
- Configure separate staging secrets, origin, volume permissions, and Clio app
  distribution/approval requirements. Preserve the US demo. Nothing has been
  provisioned, deployed, or pushed by this work.

MIT attribution for reused Oktopeak code remains in the root LICENSE. See
[the plan](../docs/hosted-clio-canada-implementation-plan.md) and
[the original findings](../docs/hosted-clio-canada-feasibility-results.md).
