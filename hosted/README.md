# Hosted integration feasibility

This private package isolates the SDK v2 / Better Auth investigation from the
existing connector. It is not a production entrypoint or an approved security design.

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
