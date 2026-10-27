# Security reporting for this fork

This policy concerns [nickwang0808/clio-mcp](https://github.com/nickwang0808/clio-mcp) and its Canadian hosted service. The upstream maintainer does not operate this fork's hosted service.

## Reporting a vulnerability

Email [nick@highvizcto.com](mailto:nick@highvizcto.com) with the subject **Clio MCP security report**. This is the private security contact for this fork and its Canadian hosted service. No response-time commitment is currently published.

If this repository's **Security** tab offers **Report a vulnerability**, you may also use that private reporting channel. Its availability depends on the repository settings.

Include the affected commit, hosted/local mode, client, sanitized reproduction steps, approximate time, and suspected impact. Use fictional data and accounts you are authorized to test. Do not send access tokens, client secrets, database files, or client records, including by email. Keep exploitable reproduction details out of public issues.

## Review scope and evidence

Relevant areas include hosted token ownership and isolation, OAuth/session lifecycle, local credential storage, tool authorization, and logging. See the [README's security explanation](README.md#security-decisions-and-evidence) and [hosted runbook](hosted/README.md) for implemented controls, tests, and known limitations.

There is no independently audited or certified release claimed here. Existing npm metadata retains the upstream package name; identify this fork by its Git commit. No maintenance window for older fork revisions is promised. Review and test updates before deploying them.

Clio and AI-client vulnerabilities should also be reported to the operators of those products through their own reporting channels.
