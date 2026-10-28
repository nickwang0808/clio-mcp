# Hosted Clio Canada implementation plan

Prepared: 2026-10-26. Status: ready to begin offline implementation; Better Auth adoption remains conditional on Phase 1.

Implementation update: the hosted application, shared-tool SDK v2 adapter, local
Clio simulator, browser consent flow, SQLite startup, offline container tests, and
runtime image are implemented. See [the runbook](../hosted/README.md) for verified
behavior and outstanding acceptance work. The original self-hosted transports
retain SDK v1; the hosted service runs SDK v2. The original phase checklist below
is not a claim that every public-launch requirement has passed.

Subsequent user decisions: target read-write capability including deletion.
Signup is open to authenticated Canadian Clio users; invitation requirements in
the original phase checklist below are superseded. Identity validation and
connection ownership checks remain required.
Hosted document upload and audit export are deferred to issues #3 and #2,
linked from the runbook. Read-only scope
below is superseded by that direction. The demonstrated same-user upstream
refresh/reconnect overwrite is deferred in [issue #1](https://github.com/nickwang0808/clio-mcp/issues/1)
and does not block continuing the prototype. Its frequency is unknown. Keep the
reproduction test and retain ownership, cross-identity isolation, and
disconnect/revocation requirements. This deferral does not authorize automatic
replay of writes with unknown outcomes or constitute production acceptance.

This plan follows [the hosted requirements](hosted-clio-canada-requirements.md). It updates the proposed authentication approach and delivery order; it retains the isolation requirements and launch restrictions. It does not authorize deployment, live writes, or account provisioning.

## Intended outcome and decisions

One hosted service lets individual users from multiple Canadian law firms connect their AI client through Clio login. There are no separate passwords or independent signup methods. Clio determines the permissions of each upstream request; our service must prove that each request uses the correct person's Clio credentials.

- Keep TypeScript and the useful existing Clio tools. Adopt the official MCP TypeScript SDK v2; this is not a FastMCP rewrite.
- Build a new hosted application layer with Better Auth as the preferred authentication library. Use its supported generic OAuth integration for Clio and its MCP/OAuth facilities for downstream authorization.
- Use one Fly Machine, one application process, and SQLite on a persistent volume. No managed PostgreSQL service is needed for this scope.
- Start Canada-only, read-only, with an invitation-limited pilot. Each user has an individual connection, including users in the same firm.
- Preserve the existing US demo and local/self-hosted functionality. Do not migrate US credentials into Canada.
- Reuse code where it saves work. Preserve the MIT license and required copyright notices for reused code; a complete rewrite is not necessary to operate and brand the hosted service.

The authentication relationship remains:

AI client → library-issued MCP credential → approved connection → Clio credential → Canadian Clio API.

Clio login is the only user login. Better Auth still needs local identities, sessions, and grants to authorize the AI client. It does not eliminate the application's responsibility for connection ownership, lifecycle coordination, or data isolation.

## Limits on custom code

Delegate OAuth protocol handling, browser sessions, authorization codes, PKCE, and token issuance to the library. Do not recreate an authorization server or fork Better Auth to make the design work.

Application code should be limited to the Clio provider adapter, verified identity mapping, immutable grant-to-connection binding, lifecycle coordination, request context, operational configuration, and tests. Any additional credential protection must use established cryptographic libraries and a reviewed design.

Better Auth is a candidate, not a completed security assessment. Research against version 1.7.14 found areas requiring proof: upstream refresh coordination, downstream refresh-family invalidation under concurrency, grant behavior after disconnect/reconnect, and authenticated binding of encrypted credentials to their database records. Encryption enabled in configuration alone does not establish record-swap protection.

If supported APIs cannot satisfy these requirements with a small integration, stop adoption and evaluate oidc-provider against the same tests. Do not weaken the requirements or accumulate authentication patches to preserve the initial choice.

## Phase 0 — Establish the baseline

Deliverables:

1. Record the checkout, existing changes, dependency versions, build, type checks, and meaningful existing test results. Keep unrelated changes intact.
2. Map the reusable tool registry and request-context interfaces. Identify hosted exclusions: authentication/logout tools, writes, server filesystem access, and audit export until ownership enforcement is proven.
3. Record the discrepancy between local source and deployed custom OAuth code. Source searches have not located the deployed implementation. Recovering a compiled artifact can supply reference behavior, but it must not block a separate, reproducible hosted implementation.
4. Record the Canadian identity contract from Clio documentation: stable user identity, verified firm/account identity, required profile fields, and endpoint behavior. Mark any assumptions needing live confirmation.

Exit: a reproducible local baseline and an explicit list of reusable components. The working US deployment remains separate.

## Phase 1 — Prove the integration with one tool

Build an isolated SDK v2 hosted prototype before migrating the complete tool set. Pin compatible versions of the SDK, Better Auth packages, schema library, Node runtime, and SQLite driver after checking their current release documentation.

Use the current supported Better Auth MCP integration without configuring a second competing OAuth provider. Verify the client registration mechanism supported by the target AI client; do not assume support for newer registration mechanisms.

Create a deterministic local Clio simulator with authorization, token, identity, and one read endpoint. Run the real hosted HTTP authorization and MCP path against it, using a temporary SQLite database. Production configuration must reject simulator endpoints.

Fixtures:

| User | Identity | Purpose |
| --- | --- | --- |
| Alice | Firm A administrator | Full fixture access |
| Bob | Firm A restricted user | Detect borrowing Alice's credentials |
| Carol | Firm B user | Detect cross-firm routing |

Give each identity distinct credentials and include overlapping numerical record IDs across firms. Capture the actual upstream authorization header in the simulator; returned fixtures alone are insufficient evidence.

Prove these integration decisions:

- Clio is the only configured login provider. No password, email login, or alternative signup route is enabled.
- Validate identity fields before creating a connection. Missing identifiers must fail closed. Do not infer firm identity from email or merge different Clio identities because their email addresses match.
- Every downstream grant binds to an immutable connection ID and generation. Resolve this from validated authorization, never a tool argument, arbitrary session header, or a lookup of the user's latest account.
- Resource, issuer, client, scope, expiry, token type, and revocation checks apply at the MCP boundary. Prefer supported opaque MCP credentials as required by the original design. Any proposed change needs explicit rationale and equivalent live-state checks.
- Reject upstream Clio credentials presented as MCP credentials. Block public routes that would expose saved Clio tokens; trusted internal token retrieval must remain available through supported APIs.
- Coordinate upstream refresh per connection, with a post-network status/generation check. Delayed refresh cannot overwrite reconnect or restore disconnected credentials. Do not hold a database write transaction open during the upstream request.
- Distinguish revoking one client's grant from disconnecting the entire Clio connection. Reconnect creates a new generation and cannot revive old grants.
- Demonstrate downstream refresh rotation and family revocation under controlled concurrent execution. A single process does not prevent asynchronous races.
- Credential substitution between records must fail authentication. Verify encryption, record binding, wrong-key behavior, and whether plaintext migration fallbacks can violate the chosen policy.

Exit: a runnable one-tool integration and a short go/no-go record covering each point above, including the amount of application code required. Full migration begins only after this gate passes. No live Clio account is required for this phase; simulator assumptions remain explicitly provisional.

## Phase 2 — Complete the hosted application

After Phase 1 passes:

1. Migrate the remaining reusable tools to SDK v2 and compatible schemas. Remove v1 dependencies only after consumers have migrated. Preserve documented local usage and verify existing behavior.
2. Implement the proven connection and grant model using library tables plus minimal application-owned tables. Use supported extension points rather than private library internals.
3. Populate request-scoped Clio clients from validated connection ownership. Missing context must fail closed; hosted requests must never fall back to local token files, environment credentials, or a shared global client.
4. Register only reviewed read tools. Keep audit export disabled until queries enforce trusted owner attribution independent of caller filters. Exclude tools that expose server files or credential-management flows.
5. Add invitation enforcement, explicit consent, bounded request sizes, flow expiration, rate limits, and bounded upstream retries. Store only necessary operational metadata; redact credentials and upstream payloads in logs and errors.
6. Make Canada endpoints and supported production origins explicit. Separate staging and production secrets, databases, OAuth clients, and encryption keys.

Exit: all selected tools operate through the proven hosted authorization path, without the old single-connection authentication implementation.

## Phase 3 — Make SQLite startup and recovery predictable

Use /data/auth.sqlite on the Fly volume. Fail startup if required production storage or secrets are unavailable; do not silently use an ephemeral database. Keep the service explicitly single-process and single-Machine.

Migration behavior:

- Run pinned, tested schema migrations in the application Machine entrypoint before accepting traffic. Fly release commands run separately without the application's persistent volume.
- On an empty database, initialize both library and application schemas, then start.
- On an existing database, apply only supported migrations and record their completion. Re-running startup must be safe.
- Fail closed on unsupported schema versions, corruption, migration errors, or the wrong encryption key. Never automatically delete an existing database to make startup succeed.
- Test upgrades from the previous supported schema with populated identities and grants, including interrupted migration behavior. Document rollback constraints.

Accepted loss policy: if the database is deliberately replaced after unrecoverable loss, users reconnect and some AI clients may need to remove and re-add the connector. Old access tokens, refresh tokens, sessions, and connection references must be rejected. Signature validation alone is insufficient to establish that a grant still exists.

Keep the pilot invitation policy and deployment secrets outside disposable database state. Document the loss of registrations, audit history, and local revocation records. Losing our database does not itself revoke authorization at Clio.

Fly volume snapshots provide an optional recovery aid, not a substitute for a tested recovery procedure. Restoring older authentication state can restore previously revoked grants. The recovery procedure must invalidate restored downstream authorization before serving requests and require reconnection where needed. Database reset and snapshot restore are explicit operator procedures, not automatic repair logic.

Exit: tested fresh startup, upgrade, restart, deliberate reset, and safe restore procedures. No separate database service is introduced.

## Phase 4 — Establish the offline acceptance suite

Run black-box HTTP/MCP tests with real application/authentication code, temporary ports, temporary SQLite databases, and the local simulator. CI must not require credentials or reach live Clio. Use deterministic barriers for races rather than timing-dependent sleeps.

| Area | Required evidence |
| --- | --- |
| Browser authorization | State/browser binding, consent, PKCE, exact redirect checks, expired and reused code rejection |
| MCP authorization | Wrong client/resource/scope/type, expired/revoked credentials, and direct Clio token rejection |
| Isolation | Concurrent Alice/Bob/Carol calls; actual upstream credential and response ownership; malicious supplied identifiers |
| Identity | Missing/malformed identity rejected; same-email distinct identities remain distinct; firm membership never shares credentials |
| Lifecycle | Upstream refresh and downstream rotation; replay; disconnect/reconnect/refresh races; revocation cannot resurrect grants |
| Persistence | Same-volume restart, schema upgrade, interrupted writes, missing state, wrong key, ciphertext corruption, record substitution |
| Recovery | Fresh initialization rejects old grants; restored state cannot revive revoked authorization |
| Upstream failures | 401/403/429/5xx, timeout, malformed responses; bounded retries with no identity fallback |
| Exposure | No credentials or matter content in logs/errors; token-returning routes blocked; reviewed read-only tool list |
| Production boundaries | Simulator endpoints rejected; required storage/secrets enforced; no hosted local-credential fallback |

Demonstrate that deliberately misrouting a connection makes the isolation tests fail. This checks that the suite detects the central failure mode, rather than merely returning expected fixtures.

Run build, type checks, existing relevant tests, and the new acceptance suite. Record unsupported cases and any remaining risks. Passing these tests establishes behavior against the simulated contract; it does not prove Clio's live permissions or certify the service as secure.

Exit: repeatable offline acceptance with no unresolved isolation or authentication failures.

## Phase 5 — Prepare staging and complete live acceptance

Prepare a reproducible image, separate Canadian staging configuration, health checks, migration entrypoint, secrets inventory, and deployment/recovery runbook. Do not overwrite the existing US demo.

Before public rollout, complete separately authorized Canadian acceptance:

- Confirm Canadian app registration, identity/firm fields, requested permissions, and Clio's distribution/review requirements.
- Verify the target AI client's actual connect, registration, consent, refresh, and disconnect behavior.
- Verify real read behavior with two Canadian firms and differently permissioned users in one firm, using fictional data.
- Verify upstream refresh, reconnect, revocation behavior where supported, and the connection boundaries exercised offline.
- Resolve test-account access with Clio if necessary; do not create repeated trials or claim live cross-firm verification without it.

Exit: documented live acceptance and a concrete pilot rollout for review. Broader public availability follows the pilot, not merely a passing simulator suite.

## Readiness and implementation boundary

We are ready to start Phase 0 and the Phase 1 offline prototype. No further architecture discussion is required before that work begins.

We are not yet ready to promise that Better Auth replaces all required custom authentication-related code, or to deploy publicly. Its supported integration must first pass the feasibility gate. Canadian account availability and live acceptance can proceed later without blocking offline work.

A complete offline implementation means the selected tools run through SDK v2 and the chosen library; immutable connection bindings and lifecycle tests pass; SQLite initialization, upgrades, and recovery work; production configuration is Canada-only; and a reproducible artifact exists. Report live acceptance separately from that milestone.

Re-estimate the remaining work after Phase 1. The main uncertainty is integration fit, not the number of existing tool handlers.

## Technical references

Recheck versions and documentation when implementing; research is not a substitute for running the acceptance suite.

- [MCP TypeScript SDK v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [Better Auth MCP integration](https://better-auth.com/docs/plugins/mcp)
- [Better Auth generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)
- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth SQLite](https://better-auth.com/docs/adapters/sqlite) and [database migrations](https://better-auth.com/docs/concepts/database)
- [Better Auth 1.7.14 downstream token implementation](https://github.com/better-auth/better-auth/blob/v1.7.14/packages/oauth-provider/src/token.ts) and [upstream token helpers](https://github.com/better-auth/better-auth/blob/v1.7.14/packages/better-auth/src/oauth2/utils.ts)
- [Fly volumes](https://docs.fly.io/volumes/overview), [snapshots](https://docs.fly.io/volumes/snapshots), and [configuration](https://docs.fly.io/reference/configuration)
- [Clio authorization](https://docs.developers.clio.com/api-docs/clio-manage/authorization/) and [regions](https://docs.developers.clio.com/handbook/getting-started/regions/)
