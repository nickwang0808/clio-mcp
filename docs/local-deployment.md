# Run Clio MCP on your computer

[Back to the README](../README.md) · [Cloud deployment](cloud-deployment.md)

Your AI application starts a connector on your computer. It talks directly to Clio; the project's hosted service is not involved. Your AI provider still receives the records returned to the assistant.

This guide uses **single-user stdio mode**: the client and connector communicate through a local process. It is not the hosted multi-tenant application. Use one Clio identity per operating-system account; processes under that account share the saved local connection. Do not expose this setup as a shared law-firm server.

## 1. Gather what you need

- A Canadian Clio Manage account and permission to register a developer application. Your Clio administrator may need to help.
- [Node.js](https://nodejs.org/en/download) 24 and [Git](https://git-scm.com/downloads).
- An AI client that can launch local stdio MCP servers. A web-only remote connector cannot start a process on your laptop.
- A text editor and terminal: PowerShell on Windows, Terminal on macOS/Linux.

These instructions target Canada. The inherited local implementation also has other region settings; those are not covered by our Canadian live acceptance evidence.

## 2. Download and build this fork

Run these commands one at a time:

```sh
git clone https://github.com/nickwang0808/clio-mcp.git
cd clio-mcp
npm ci
npm run build
```

Success means the build completes without errors and `build/index.js` exists. Keep this directory: your client will run the built file from here. Do not substitute an `npx @oktopeak/clio-mcp` command; that installs the upstream distribution, not this fork.

## 3. Register your Clio application

Follow Clio's [developer application instructions](https://docs.developers.clio.com/api-docs/applications/) using the **Canadian Clio Manage** developer portal. Choose a recognizable name such as “Our Firm Local AI Connector.”

Register this exact redirect URI (the address Clio returns your browser to after login):

```text
http://127.0.0.1:5678/callback
```

Enable the application permissions needed for the records you intend to use, including user-profile access for identity lookup. Save the client ID and client secret in your password manager. If your account cannot register the application, resolve that with your administrator or Clio before continuing.

## 4. Create the local settings file

In the repository folder, create a plain text file named `.env` (not `.env.txt`). Paste this, replacing the two placeholder values:

```dotenv
CLIO_CLIENT_ID=YOUR_CANADIAN_CLIENT_ID
CLIO_CLIENT_SECRET=YOUR_CANADIAN_CLIENT_SECRET
CLIO_REGION=ca
CLIO_REDIRECT_PORT=5678
TRANSPORT=stdio
READ_ONLY=true
```

This starts with writes disabled for the first check. Later, change `READ_ONLY=false` and restart the connector to enable creates, updates, deletes, and local document upload.

The application loads `.env` from this repository's directory, even if your client starts elsewhere. It is ignored by Git, but it is still a plaintext secret file: protect your computer/account and do not share it. Leave `TOKEN_BROKER_URL` and endpoint overrides unset. This setup uses your own Clio app directly.

## 5. Point your AI client at the connector

Find the absolute path to `build/index.js`. In clients that use an `mcpServers` JSON configuration, merge this entry into the existing configuration:

```json
{
  "mcpServers": {
    "clio_local": {
      "command": "node",
      "args": ["C:/Users/YOUR_NAME/Projects/clio-mcp/build/index.js"],
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

Replace the example path with yours. On macOS/Linux it might be `/Users/your-name/Projects/clio-mcp/build/index.js` or `/home/your-name/clio-mcp/build/index.js`. Forward slashes work in the Windows JSON example. If the client cannot find `node`, supply its full executable path instead.

For **Codex**, add this entry to your user configuration (`~/.codex/config.toml`) or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.clio_local]
command = "node"
args = ["C:/Users/YOUR_NAME/Projects/clio-mcp/build/index.js"]
tool_timeout_sec = 300

[mcp_servers.clio_local.env]
TRANSPORT = "stdio"
```

See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) for configuration locations and project trust. This repository also configures the remote `clio_canada` connection: disable it in your client while testing locally so the assistant uses only `clio_local`.

Restart/reload the client. You should see local tools, including `authenticate` and `auth_status`. Running `npm start` alone is not the client setup; stdio expects an MCP client on the other end.

## 6. Sign in and check a read

Ask your assistant:

> Use clio_local's authenticate tool so I can sign in to Clio. Do not create or change records.

Complete browser login, return to the assistant, and ask it to run `auth_status`, then list up to five open matters. Compare the results with your Clio account. Allow time for login; clients with short tool timeouts may need a longer timeout or a retry after browser authorization.

To enable writes, set `READ_ONLY=false` in `.env`, restart the client connection, and test only with fictional records. The local server has 45 tools with writes enabled; read-only mode omits the 18 Clio write tools. Authentication tools still manage local login state.

Local `upload_document` reads a path on **this computer**. A file attached to a chat is not necessarily available at that path. Hosted upload remains unavailable.

## Storage, logout, and updates

The local application stores its encrypted connection at `~/.clio-mcp/tokens.enc` and audit metadata at `~/.clio-mcp/audit.log`. On Windows, `~` means your user profile directory. Audit records include allowlisted metadata such as record IDs and dates; they are not encrypted or tamper-proof, and the application does not automatically rotate them.

The encryption key normally uses your operating system's keychain. If unavailable, the code falls back to `~/.clio-mcp/key.hex`. In that case the key and encrypted token are on the same filesystem; copying both defeats that at-rest protection. An explicit `ENCRYPTION_KEY` is also supported for managed environments. See [token storage implementation](../src/auth/tokenStorage.ts).

Use `logout` to clear the saved local token, and revoke the application's access in Clio to revoke upstream authorization. Stop the client before manually managing stored files. Deleting the source folder alone does not delete saved credentials in your home directory.

For an update, stop the connector, review changes, then run these commands in the repository:

```sh
git pull --ff-only
npm ci
npm run build
npm test
```

Restart the client and repeat the read check. Record `git rev-parse HEAD` to identify the installed revision. Do not overwrite local changes to force an update.

## If something goes wrong

| Symptom | What to check |
| --- | --- |
| Client cannot start the server | Node is installed, executable and `build/index.js` paths are correct, and the build succeeded. |
| It asks for `MCP_API_KEY` | It started in HTTP mode. Set `TRANSPORT=stdio` and reload. |
| Clio reports a redirect mismatch | The registered address must exactly match `http://127.0.0.1:5678/callback`. |
| Browser cannot reach the callback | Another process may occupy port 5678. Stop the competing connector, or change both `CLIO_REDIRECT_PORT` and the registered redirect URI to the same new port. |
| Unauthorized, wrong region, or missing records | Confirm `CLIO_REGION=ca`, app permissions, and the account used to sign in. Log out before switching identities. |
| Token cannot be decrypted | Check keychain availability or a changed encryption key. Do not send token/key files to support. Reauthentication may be necessary. |
| Writes are missing | Change `READ_ONLY=false` and reload only when you intend to allow changes. |

For a shared server with separate browser sign-ins, use the [cloud guide](cloud-deployment.md). The legacy root HTTP transport is not the multi-tenant deployment described there.
