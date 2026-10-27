# Security reporting for this fork

This policy concerns [nickwang0808/clio-mcp](https://github.com/nickwang0808/clio-mcp) and its Canadian hosted service. The upstream maintainer does not operate this fork's hosted service.

## Reporting status

A dedicated private security contact and response-time commitment have not yet been published for this fork. Do not send reports about this service to the upstream company's support address.

If this repository's **Security** tab offers **Report a vulnerability**, use that private reporting channel. Its availability depends on the repository settings. Otherwise, contact the [maintainer](https://github.com/nickwang0808) to request a private channel before sending details; a public issue requesting contact must contain no exploit details or sensitive data.

Do not put access tokens, client secrets, database files, client records, or exploitable reproduction details in public issues. Once a private channel is established, include the affected commit, hosted/local mode, client, sanitized reproduction steps, approximate time, and suspected impact. Use fictional data and accounts you are authorized to test.

## Review scope and evidence

Relevant areas include hosted token ownership and isolation, OAuth/session lifecycle, local credential storage, tool authorization, and logging. See the [README's security explanation](README.md#security-decisions-and-evidence) and [hosted runbook](hosted/README.md) for implemented controls, tests, and known limitations.

There is no independently audited or certified release claimed here. Existing npm metadata retains the upstream package name; identify this fork by its Git commit. No maintenance window for older fork revisions is promised. Review and test updates before deploying them.

Clio and AI-client vulnerabilities should also be reported to the operators of those products through their own reporting channels.
