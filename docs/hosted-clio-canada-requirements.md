# Hosted Clio Canada: multi-user requirements and implementation handoff

Status: proposed implementation requirements; no implementation or deployment authorized by this document alone.
Prepared: 2026-10-26.
Owner: High Viz CTO.
Repository: C:\Users\nickw\Projects\clio-mcp.

Subsequent user decisions supersede the initial scope below: the hosted target
allows signup by authenticated Canadian Clio users without invitations. It
is read-write including deletion. Hosted document upload and audit export are
tracked separately in issues #3 and #2, linked from the hosted runbook. The same-user
refresh/reconnect overwrite reproduced during feasibility testing is deferred
in [issue #1](https://github.com/nickwang0808/clio-mcp/issues/1); it does not block
continuing the prototype. Other ownership, cross-identity isolation, and
disconnect/revocation requirements remain. See the implementation plan and
feasibility findings for the current decision record.

## Objective and user experience

Provide a free hosted Clio MCP connector so users can access their Clio records through an AI assistant. Lawyers should click Connect, sign into Clio, approve access, and use their AI assistant. They should not install servers, paste API keys, manage tokens, or create developer apps individually.

Support multiple users across multiple law firms on one hosted service. Start with Clio Manage Canada only and read-only tools. Each person connects their own Clio identity; firm membership does not grant access to another person's connection.

Retain a documented self-hosting option. Local installation is not the primary hosted user experience.

## Verified current state and source discrepancy

These findings came from read-only inspection of the running Fly application, not merely the upstream README:

- App: highvizcto-clio-mcp; origin: https://highvizcto-clio-mcp.fly.dev.
- One running machine in yyz (Toronto), shared-cpu-1x, 512 MB.
- Image observed: highvizcto-clio-mcp:deployment-01M4XYJX7FWQP2HAX3KY4VZCG1.
- Runtime configuration has CLIO_REGION=us and READ_ONLY=true. Canadian hosting does not make this a Canadian Clio integration.
- Persistent volume clio_data is mounted at /data.
- Custom hosted code is present at /app/build/demo.js and /app/build/server/{demo,demoOAuth,demoState}.js.
- The hosted OAuth layer publishes /authorize, /token, /register, /revoke, /clio/callback, and OAuth discovery metadata.
- GET /mcp without authorization returned 401 with a bearer challenge. Its resource metadata URL is /.well-known/oauth-protected-resource/mcp.
- The hosted route validates an MCP bearer token and uses stateless MCP transport, rather than the upstream shared-MCP_API_KEY/session-ID mechanism.
- The custom implementation accepts only one configured CLIO_OPERATOR_ID. Other Clio identities are rejected after who_am_i.
- One Clio connection is stored as store.data.clio. All approved MCP requests use that connection.
- /data/oauth.enc is an AES-256-GCM encrypted state file; STATE_KEY supplies its key. The file contains Clio credentials, OAuth client registrations, and hashes/metadata for issued MCP tokens.
- MCP access tokens are opaque random values with a one-hour lifetime. MCP refresh grants have a seven-day lifetime; refresh rotates the token, and revocation removes the grant family.
- The state implementation uses atomic encrypted snapshots and is explicitly single-process/single-writer.
- No runtime credential values, encrypted-state contents, or client records were inspected. No deployment was modified.

IMPORTANT: the local checkout at handoff is commit 78cb5626fe4b4b51037448c8df9bf8afce208393 ("Add contact matter and note CRUD operations"), package version 2.4.0. Its tracked files do not include the hosted demo source, Fly configuration, or Dockerfile. Available local worktrees searched during the conversation did not reveal the matching deployment source.

The first implementation step is to locate the source/branch/build context matching the deployed image. If unavailable, recover the compiled application as reference and deliberately reconstruct maintainable source with tests. Do not assume the local upstream HTTP entry point is the deployed one. Do not overwrite or redeploy the working demo while resolving this discrepancy.

## Corrected security assessment

No exploitable vulnerability or cross-user data leak was established. Earlier discussion of an upstream shared API key plus session ID did not describe this deployed custom OAuth route.

The real limitation is deliberate single-user storage and authorization. Removing the operator restriction alone is unsafe: a later login could overwrite the one Clio connection while earlier MCP grants remain valid.

Two credential relationships are intentional:

AI client -- MCP access token --> hosted service -- Clio access token --> Clio API

The AI client keeps the MCP credentials. The service holds the separately issued Clio credentials and binds each MCP grant to the correct connection. End users do not manually handle either token.

Clio enforces permissions associated with the presented Clio identity. Our service must enforce which caller may use which saved connection. Do not rebuild Clio's matter-access permission system or assume all firm members have equal access.

Encrypted storage reduces the consequences of a storage-only compromise. It does not prevent a compromised running service from using credentials it can decrypt. Do not claim statelessness or encryption eliminates this risk.

## Scope and exclusions

Initial scope:

- Clio Manage Canada only, including Canadian OAuth and API endpoints.
- One shared Fly application instance with a persistent volume.
- Read-only tool registration and suitably limited Clio app permissions.
- Individual connections; invitation-limited pilot before public signup.
- Existing ChatGPT connection experience first; verify other clients separately before claiming support.
- Reuse the connector's tool implementations and request context.
- No routine persistence of client documents, matter contents, or tool response bodies.
- Automated development and CI testing without live Clio access.

Out of initial scope:

- US/EU/Australia support or migration of existing US credentials into CA.
- Team administration, shared administrator connections, billing, and write tools.
- Multiple app replicas, distributed workers, or a separate managed database service.
- Claims that Canadian server placement alone guarantees end-to-end Canadian data residency.
- Automatic provisioning of Clio accounts or repeated free-trial creation.

## Data model and isolation requirements

Use SQLite on the Fly persistent volume as the preferred implementation: a local database file, not an additional hosted service. Final schema can vary, but must represent:

- Verified external identity: Clio region, user identifier, and firm/account identity.
- Connection: immutable internal ID, owner identity, encrypted upstream credentials, expiry, status, and generation/version.
- OAuth client registration.
- MCP authorization/grant: hashed credentials, OAuth client binding, authorized connection ID, scopes, expiry, and revocation/refresh-family state.
- Short-lived authorization flows: browser/state binding, PKCE challenge, redirect/resource binding, and expiration.
- Minimal audit metadata with tenant/user/request attribution.

Verify how the Canadian Clio API exposes firm/account identity and supports user membership. Do not invent a firm identifier, infer it from email domain, or accept a caller-provided firm ID as authoritative. Record the verified identity contract before implementation. Distinct firm identity may be useful for policy and auditing, but it must never enable connection sharing.

Required invariants:

1. Every valid MCP grant authorizes exactly its intended connection.
2. Tool execution derives connection ownership from validated authorization, never tool arguments or an arbitrary session/header ID.
3. A user in Firm A cannot select or use Firm B's connection.
4. A restricted user cannot borrow an administrator's connection within the same firm.
5. No missing-context fallback may use global/local single-user credentials.
6. Reconnects, logout, refresh, and revocation are scoped to the intended connection/grant.
7. Credential blobs are authenticated against their intended record/identity (for example, authenticated additional data) to prevent silent record swaps.
8. Absent, expired, corrupt, or revoked state fails closed.

## Authentication and connection lifecycle

Preserve the existing OAuth protections: exact redirect validation, resource/audience binding, PKCE where applicable, browser-bound state, one-use short-lived codes, explicit consent, and validation of access tokens before tools execute.

Replace the configured-operator gate and global connection atomically with verified per-user connections and per-grant connection bindings.

- Keep opaque MCP tokens initially; JWTs are not required.
- Store only hashes of issued MCP bearer/refresh tokens where lookup permits.
- Encrypt upstream Clio credentials using a key supplied separately from the volume (Fly secret for this initial design).
- Separate staging and production OAuth clients, credential stores, and encryption keys.
- Never expose Clio credentials to tool results, AI prompts, logs, or URLs.
- Preserve resource binding and do not authenticate the MCP endpoint by blindly passing through Clio tokens.
- Coordinate upstream refresh per connection; do not hold a database write transaction open during a network request.
- Use version checks so a delayed refresh cannot overwrite a newer reconnect or resurrect a disconnected connection.
- Define whether reconnect invalidates earlier grant families; prefer explicit invalidation where ownership might change.
- Distinguish revoking one AI-client grant from disconnecting the complete Clio connection.
- Full disconnect invalidates affected MCP grants and removes local usable credentials; implement upstream revocation where supported.
- Apply bounded request sizes, authorization-flow lifetimes, and per-principal limits. Replace single-operator rate-limit assumptions.
- Scope audit access to its owner; review all tools, including audit export and remote document handling, for cross-user assumptions.

## Storage and operations

- Put SQLite under /data on the persistent Fly volume.
- Start with one process/instance accessing that store. Do not scale out until storage and refresh coordination are redesigned.
- Use transactions for authorization changes and refresh-token rotation.
- Keep OAuth credentials encrypted; avoid payload logging in application, proxy, and error paths.
- Document restore, secret rotation, and schema upgrade procedures appropriate to this small service.
- Treat backups as credential-bearing sensitive data. Restoring an old snapshot can restore previously revoked grants; define safe recovery, such as invalidating MCP grants and requiring reconnection after restoration.
- Accepted pilot tradeoff: after unrecoverable state loss, users reconnect, potentially removing and re-adding the AI connector.
- Do not claim local state loss revokes previously issued Clio authorization.
- Keep the existing working US demo separate from the new Canadian staging deployment. No implicit migration or deletion.

## Automated testing without live Clio

Build a deterministic local Clio simulator or injectable HTTP adapter with a realistic OAuth/API contract. This is test infrastructure only, never a production fallback.

Test path:

Test MCP client -> real hosted application/auth code -> simulated Clio
                              |
                      temporary SQLite database

Use Alice (Firm A administrator), Bob (Firm A restricted user), and Carol (Firm B). Issue distinct upstream tokens and disjoint fixtures. Include overlapping numerical record IDs across firms so accidental ID-only lookups are detectable.

Run the real MCP authorization and tool routing rather than testing only mocked application functions. Assert which upstream credential was sent, not just which fixture was returned.

Required automated coverage:

- Full authorization/code exchange, valid consent, callback state and browser binding, PKCE, redirect/resource checks.
- Wrong client, token, scope, resource, expired code, repeated code, and replayed/invalid refresh rejection.
- Concurrent requests from different firms and users select only their own upstream tokens.
- Caller-supplied connection/user/firm/session IDs cannot switch authorization.
- Same-firm restricted user retains restricted behavior; the simulator models the restriction and tests our routing, not Clio's real enforcement.
- Upstream and MCP refresh rotation, concurrent refresh, invalid refresh, and timeout behavior.
- Reconnect/refresh/disconnect races and grant-family revocation.
- Restart with the same volume; missing state; wrong encryption key; corrupt ciphertext; partial-write/transaction rollback.
- Encryption and database-record substitution checks; no credentials or record content in logs/errors.
- Upstream 401/403/429/5xx, malformed responses, and bounded retries without falling back to another identity.
- Read-only registration; review exceptional tools that read files, export logs, or involve another service.
- Production configuration rejects simulated endpoints; CI network access is restricted to local test services.
- A black-box HTTP/MCP integration suite using temporary ports and storage, repeatable without Clio credentials.

Build on existing tests and SDK facilities. Avoid mirroring implementation details with superficial tests. Routine CI must not contact Clio or create accounts.

## Minimal real Canadian acceptance testing

Simulation proves our behavior against a contract, not the accuracy of that contract or Clio's live permission enforcement. Before public rollout verify real Canadian authorization, identity/firm mapping, tool reads, refresh/reconnect/revoke, and user/firm boundaries.

Desired minimum: two Canadian firm accounts, with two differently permissioned users in Firm A and one user in Firm B. Seed only a small, reusable set of clearly fictional data. Additional seats/developer entitlements are not yet confirmed.

User context: the operator already applied for a developer account on one free trial. Its region has not been established. They are concerned about repeated trials/account restrictions and do not want to manage many test workspaces.

Requirements:

- Reuse the pending developer account if it is Canadian and suitable.
- Ask Clio developer support to confirm access for a second Canadian test firm and needed test seats; do not assume approval, free entitlement, or that creating another trial is permitted.
- Do not automate trial creation or repeatedly create accounts to evade limits.
- Development can proceed with offline tests while access is pending.
- If cross-firm live access remains unavailable, document that acceptance gap; do not claim live multi-firm isolation has been demonstrated.
- No live writes, account provisioning, app publication, or production deployment are authorized by this requirements document.

Clio's documentation describes regional trials and application for developer-account conversion. Canadian app registration is separate from the US registration; verify distribution/app-review requirements before accepting unrelated firms.

## Delivery sequence and acceptance

1. Recover/locate the actual hosted source and establish reproducible build provenance.
2. Confirm Canadian identity/account API contract and configure offline fixtures.
3. Implement local SQLite storage and credential-to-connection bindings with isolation tests.
4. Adapt hosted OAuth and routing; retain the user-facing browser authorization experience.
5. Run automated build, type checks, and meaningful offline integration/security tests.
6. Prepare separate Canadian staging deployment and operational instructions.
7. Complete authorized live Canadian acceptance tests when appropriate account access is available.
8. Review the exact rollout and unresolved issues before public deployment.

Definition of done for the offline implementation:
- One service supports multiple simulated users and firms without a global connection.
- Automated suite demonstrates isolation, OAuth lifecycle, restart, and failure behavior.
- No live Clio credentials or accounts are required for local development/CI.
- Canada-only production configuration, storage design, and operational limitations are documented.
- Source matches a reproducible deployable artifact.
- Live acceptance requirements are clearly separate from completed automated tests.

Earlier discussion estimated 3-5 engineering days for a pilot and 1-2 weeks total for a public release. These were rough estimates, not commitments; revise after recovering the deployed source and evaluating tests. External Clio approval/account availability is separate.

## References

- Local upstream source: src/server/http.ts and src/server/httpAuth.ts (not the custom deployed OAuth route).
- Clio developer accounts: https://docs.developers.clio.com/handbook/getting-started/get-a-developer-account/
- Clio regions: https://docs.developers.clio.com/handbook/getting-started/regions/
- Developer applications: https://docs.developers.clio.com/api-docs/applications/
- App development: https://docs.developers.clio.com/handbook/build-your-app/
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

Recheck external documentation at implementation time. Never treat marketing security claims or this handoff as a completed security audit.
