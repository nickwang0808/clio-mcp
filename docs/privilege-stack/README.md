# Connect a local AI model to Clio

A local model can use this connector through an MCP-capable client. The model runs on your hardware; the connector still sends API requests to Clio. Use the [local setup guide](../local-deployment.md) for installation, credentials, region selection, and authentication.

## Set up the connection

1. Build the connector and configure your Clio application using the local setup guide.
2. Load a model in your local runtime and connect it to a client that supports MCP tool calls.
3. Configure that client to launch `node` with the absolute path to this repository's `build/index.js`.
4. Start with `READ_ONLY=true`. Authenticate with Clio, then ask for a small set of records and compare the results with Clio.
5. Enable writes when you are ready to test them. Use clearly labeled fictional records and verify each change in Clio.

Example configurations are available for [LM Studio](configs/lm-studio.example.json), [Continue](configs/continue-dev.example.json), and an [Ollama MCP bridge](configs/ollama-desktop-config.example.json). Replace paths, credentials, region, and model identifiers before use. These are starting points; check the configuration format supported by your installed client. A model runtime alone may need a separate MCP client or bridge.

## Check the data path

Confirm that the client uses the local model you selected. Review cloud fallback, telemetry, plugins, and logging settings in the client and runtime. Inspect network activity during a test session to understand which services receive traffic. Model downloads and software updates also require network access.

Local inference does not establish attorney-client privilege, regulatory compliance, or end-to-end data residency. The connector still accesses Clio, and client/runtime configuration determines other data flows. See the [project's security explanation](../../README.md#security-decisions-and-evidence) for implemented controls and known limitations.

## Size and test your setup

Use the [capacity checklist](hardware-spec-sheet.md) to record memory use, response time, context length, and tool-call reliability for your workload. Test with fictional data before connecting sensitive records.

The local connector uses one Clio identity per operating-system account. Do not expose that single-user setup as a shared server. For multiple users, see the [hosted application](../../hosted/README.md) and [cloud deployment guide](../cloud-deployment.md).

## Update and troubleshoot

Review source changes, record the installed Git commit, and follow the [local setup guide](../local-deployment.md). Rebuild after updating and restart your client.

For connection problems, check the build path, Node executable, Clio region, application permissions, and authentication status. For tool-call problems, compare the same request in another MCP client to help isolate connector errors from model or client behavior.

Report reproducible bugs through [project issues](https://github.com/nickwang0808/clio-mcp/issues). Include the installed commit, client/runtime versions, and a sanitized reproduction. Send security reports through the private contact in [SECURITY.md](../../SECURITY.md).
