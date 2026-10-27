# Hosted integration feasibility

This private package isolates the SDK v2 / Better Auth investigation from the
existing connector. It is not a production entrypoint or an approved security design.

**Current result: no-go for using Better Auth's account-token storage unchanged.**
The characterization tests intentionally reproduce record substitution, plaintext
fallback, and a refresh/reconnect race. A green test run means those observations
are reproduced; it does not mean the security acceptance gate passed.
See [the findings](../docs/hosted-clio-canada-feasibility-results.md).

Use Node 24 or newer (native TypeScript stripping and SQLite):

```sh
cd hosted
npm ci
npm run typecheck
npm test
```

The parent project's baseline on 2026-10-26 passed its build and all 593 tests
across 40 files. Its SDK v1 dependency remains until the integration gate passes.

See [the implementation plan](../docs/hosted-clio-canada-implementation-plan.md).
