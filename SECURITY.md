# Security reporting for Clio MCP

This policy concerns [nickwang0808/clio-mcp](https://github.com/nickwang0808/clio-mcp) and its Canadian hosted service.

## Reporting a vulnerability

Email [nick@highvizcto.com](mailto:nick@highvizcto.com) with the subject **Clio MCP security report**. This is the private security contact for this project and its Canadian hosted service. No response-time commitment is currently published.

If this repository's **Security** tab offers **Report a vulnerability**, you may also use that private reporting channel. Its availability depends on the repository settings.

Include the affected commit, hosted/local mode, client, sanitized reproduction steps, approximate time, and suspected impact. Use fictional data and accounts you are authorized to test. Do not send access tokens, client secrets, database files, or client records, including by email. Keep exploitable reproduction details out of public issues.

## Review scope and evidence

Relevant areas include hosted token ownership and isolation, OAuth/session lifecycle, local credential storage, tool authorization, and logging. See the [README's security explanation](README.md#security-decisions-and-evidence) and [hosted runbook](hosted/README.md) for implemented controls, tests, and known limitations.

There is no independently audited or certified release claimed here. Identify the installed source revision by its Git commit. Package metadata does not establish that a release has been published. No maintenance window for older revisions is promised. Review and test updates before deploying them.

Clio and AI-client vulnerabilities should also be reported to the operators of those products through their own reporting channels.
