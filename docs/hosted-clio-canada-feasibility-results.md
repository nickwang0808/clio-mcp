# Hosted Clio feasibility: first executable findings

Date: 2026-10-26. Tested with Node 26.11.1 on Windows, Better Auth 1.7.14,
@better-auth/mcp 1.7.14, @modelcontextprotocol/server 2.4.0, and native SQLite.

## Decision status

The library-managed account-token store does **not** meet the hosted requirements
unchanged. Do not migrate the complete application or deploy this prototype yet.
Better Auth remains a possible OAuth/session layer, but adopting it requires a
separate decision about application-owned credential protection and lifecycle
coordination. No library fork or production authentication code has been added.

This is an early Phase 1 finding, not completion of the entire feasibility phase.

## What was run

The existing connector builds and its 593 tests across 40 files pass. The isolated
hosted package type-checks and runs six characterization/smoke tests. Its pinned
dependencies and lockfile are separate from the existing application.

The local simulator implements authorization codes with PKCE, token exchange,
identity lookup, refresh, and a read endpoint. Alice and Bob belong to Firm A;
Carol belongs to Firm B. Matter ID 1 overlaps across firms, and Bob is denied
that read. The simulator captures which token actually reaches it.

Tests exercise Better Auth through an actual loopback HTTP server, including
browser cookies, social-login redirects, callback handling, and sessions. Token
retrieval uses the library's public server API. They do not yet exercise the full
downstream MCP OAuth grant flow. The SDK v2 check only establishes that the
installed server can initialize and register a tool.

## Observations

| Case | Observed result | Meaning |
| --- | --- | --- |
| Three concurrent Clio-only logins | Three distinct local users; expected upstream credentials | Ordinary account selection works in this harness |
| Alice selects Carol's account | Rejected through the server API and through an HTTP request with Alice's session | The tested account ownership check works |
| Restricted Bob reads matter 1 | Simulator returns 403 using Bob's token | No borrowing of Alice's credentials in this path |
| Encryption enabled | Stored token differs from the usable upstream token | Encryption is applied |
| Carol's encrypted access/refresh tokens copied into Alice's account row | Alice's token retrieval returns Carol's usable token; simulator returns Firm B's fixture | Ciphertext is not authenticated against its intended account record |
| Plaintext substituted into an encrypted-token field | Library returns the plaintext | Encryption option retains a plaintext compatibility path |
| Refresh paused while Alice reconnects, then released | Delayed refresh overwrites reconnect's newer access token | Library token retrieval alone does not enforce connection-generation checks |
| Fresh SQLite migration repeated | No additional tables, columns, or indexes requested | Initial schema setup is repeatable in this fixture |

The record-substitution cases deliberately mutate the test database. They are
not evidence that a remote user can perform those mutations, and they do not
establish a leak in the deployed US demo. They test the stronger storage-integrity
requirement explicitly included in our design.

The refresh race uses a deterministic barrier, not a timing-dependent sleep.
It establishes an overwrite within one identity; cross-user refresh leakage has
not been demonstrated.

Native SQLite migration introspection reports TEXT-versus-string-array warnings
for the OAuth plugin tables. The test now waits for the asynchronous schema check
before closing SQLite; the earlier premature-close diagnostic is resolved.
Migration warnings and actual downstream grant persistence need further checking
before selecting the production SQLite driver.

## What these results change

“Replace our authentication code with Better Auth” is too broad. Better Auth can
manage browser login and downstream OAuth, but its standard account-token helper
cannot be our sole credential-isolation boundary under the current requirements.

The next design choice is:

1. Keep Better Auth for protocol/session handling and implement a narrowly scoped
   application credential store with authenticated record binding, immutable
   connection generations, and coordinated refresh/reconnect/disconnect. Prove
   supported integration points before adopting this approach. Do not patch
   library internals or build an OAuth issuer ourselves.
2. Evaluate another issuer, such as oidc-provider, before committing further.
   This can change downstream protocol handling, but does not automatically remove
   the need to manage Clio credentials and ownership in our application.

Recommendation: retain Better Auth as a candidate and first determine whether
option 1 can stay small and use supported interfaces. Its benefit must be measured
against the extra integration code, rather than assumed from configuration alone.
Do not relax record binding or lifecycle tests to make the candidate pass.

Still unproven: the full downstream authorization/MCP flow, downstream refresh
family concurrency, immutable grant binding, disconnect invalidation, file-backed
restart/recovery, malformed identity handling, complete logging controls, production
network restrictions, and real Canadian Clio behavior. No public rollout is ready.

## Reproduction and source references

Run `npm ci`, `npm run typecheck`, and `npm test` from `hosted/`. All credentials
and records are synthetic; no Clio credentials are required. Tests with the prefix
`GATE FAILURE` assert the observed limitation and must not be counted as passing
security acceptance tests. The simulator currently contacts only loopback services;
an enforced CI network allowlist remains future work.

- [Test cases](../hosted/test/account-isolation.test.ts)
- [Authentication harness](../hosted/test/helpers/auth-harness.ts)
- [Clio simulator](../hosted/test/helpers/clio-simulator.ts)
- [Better Auth 1.7.14 account implementation](https://github.com/better-auth/better-auth/blob/v1.7.14/packages/better-auth/src/api/routes/account.ts)
- [Better Auth 1.7.14 token encryption helpers](https://github.com/better-auth/better-auth/blob/v1.7.14/packages/better-auth/src/oauth2/utils.ts)
- [Implementation plan](hosted-clio-canada-implementation-plan.md)
