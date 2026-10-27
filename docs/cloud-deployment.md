# Run your own Canadian Clio MCP server

[Back to the README](../README.md) · [Run on your computer](local-deployment.md)

This guide deploys the multi-user Canadian application to **your Fly.io account**. Your firm controls the server, saved credentials, and deployment secrets. Users connect from their AI clients and sign in individually through Clio. The project's public hosted service is not involved.

The commands are intended to be followed in order. A firm can own this setup without being a software company, but someone needs to manage its account, updates, billing, and recovery. Have your IT provider help if terminal commands or secret management are unfamiliar.

## 1. Gather accounts and tools

You need:

- A Fly.io account with billing enabled. You pay for your Machine, storage, and applicable network/build usage; check [Fly pricing](https://fly.io/pricing/) before creating resources.
- A Canadian Clio Manage account with permission to create a developer application.
- A GitHub account if you want automatic deployment from your own fork.
- [Git](https://git-scm.com/downloads) and [flyctl](https://fly.io/docs/flyctl/install/), Fly's command-line tool, on your computer.
- A password manager for the Clio credentials and server encryption secret.

The design uses **one Machine** (Fly's name for a small server), in **Toronto (`yyz`)**, with **one persistent volume** (storage that survives application replacement). SQLite runs inside the application; you do not need Postgres. Do not scale this configuration to multiple Machines or processes.

## 2. Get the code

For automatic deployment, first fork [this repository](https://github.com/nickwang0808/clio-mcp) into your own GitHub account. Then clone **your fork**, replacing `YOUR_GITHUB_ACCOUNT` below:

```sh
git clone https://github.com/YOUR_GITHUB_ACCOUNT/clio-mcp.git
cd clio-mcp
flyctl auth login
```

If you only want manual deployment, clone `https://github.com/nickwang0808/clio-mcp.git` instead. All remaining commands run from the repository root. Fly builds the image remotely; a local Docker installation is optional for testing.

## 3. Create your app, storage, and public address

Choose a unique lowercase name with hyphens, such as `example-firm-clio-ca`. Replace **every** `YOUR_APP` below with that name. Use your own name, not the project's public app name.

```sh
flyctl apps create YOUR_APP
flyctl volumes create clio_auth --app YOUR_APP --region yyz --size 1
flyctl ips allocate-v4 --shared --app YOUR_APP
flyctl ips allocate-v6 --app YOUR_APP
```

Select your intended Fly organization if prompted. Accept the single-volume availability warning only with the understanding that this deployment accepts downtime and fresh-storage recovery. Record the volume ID (`vol_...`) printed by the second command.

Your origin will be `https://YOUR_APP.fly.dev`. An origin is just the HTTPS address, without a trailing slash or extra path. It will not serve the application until deployment is complete.

### Prepare the new volume's permissions

The application runs as an unprivileged user (ID 1000). Its mounted storage must belong to that user. **For the new, empty volume only**, replace `YOUR_VOLUME_ID` and run this temporary initialization Machine:

```sh
flyctl machine run --app YOUR_APP --region yyz --name clio-volume-init --volume YOUR_VOLUME_ID:/data --rm --restart no --entrypoint /bin/chown alpine:3.22 1000:1000 /data
flyctl machine list --app YOUR_APP
```

The command changes ownership of the mounted directory, exits, and removes the temporary Machine. Verify it has disappeared before deploying. If it remains stopped, remove that initialization Machine by its ID with `flyctl machine destroy MACHINE_ID --app YOUR_APP`; do not delete the volume. Do not run initialization commands against a serving application's storage.

The command syntax is documented in [Fly's Machine reference](https://fly.io/docs/flyctl/machine-run/); volume creation is documented [here](https://fly.io/docs/flyctl/volumes-create/). This is a one-time infrastructure step, not part of every deployment.

## 4. Register your Canadian Clio application

Follow Clio's [developer application instructions](https://docs.developers.clio.com/api-docs/applications/) for **Clio Manage in Canada**. Give it a name staff will recognize, and use your app origin as the website URL.

Register this exact redirect URI:

```text
https://YOUR_APP.fly.dev/api/auth/callback/clio-ca
```

This is where Clio returns the browser after sign-in. It is different from the MCP connection URL. Enable the Clio application permissions for the records you need and user-profile access: hosted identity validation requires the user's ID, name, email, and firm/account ID.

Save the **client ID** and **client secret** in your password manager. Your users should not receive these secrets. They sign in with their own Clio accounts.

This server has **open Canadian signup**, including when self-hosted. It does not have an invitation list, firm allowlist, or private-network access control. Using your own infrastructure does not automatically restrict who can sign in. Review Clio's app access/distribution requirements and your firm's access requirements before sharing the URL. If you need a server-enforced firm allowlist, that requires additional work.

## 5. Save the three deployment secrets

In your app's Fly dashboard, open its Secrets settings and add:

| Secret name | Value |
| --- | --- |
| `CLIO_CLIENT_ID` | Client ID from your Canadian Clio application |
| `CLIO_CLIENT_SECRET` | Client secret from that application |
| `BETTER_AUTH_SECRET` | A new random secret of at least 32 characters, generated by your password manager |

Store a separate copy in your password manager. Do not commit secrets to Git, include them in screenshots, or paste them into chat. The server encryption secret must remain stable across deployments; changing it casually can make saved connections unreadable.

For operators using the CLI, [Fly secrets import](https://fly.io/docs/flyctl/secrets-import/) accepts `NAME=VALUE` pairs through standard input with `--stage --app YOUR_APP`. Use a secure input method rather than putting literal secret values into shell history. Secrets should be supplied through Fly, not a committed `.env` file.

## 6. Deploy the application

From the repository root:

```sh
flyctl deploy --config hosted/fly.toml --app YOUR_APP --env HOSTED_ORIGIN=https://YOUR_APP.fly.dev --remote-only --ha=false --strategy immediate --yes
```

Use **`hosted/fly.toml`**, not the legacy root server configuration. The command supplies your app name and origin without editing the shared configuration. Keep `--ha=false`: this application supports only one Machine. The immediate strategy accepts brief downtime during updates.

On first startup, the server creates and migrates `/data/auth.sqlite` before it becomes healthy. There is no separate database migration command to run. An incompatible or damaged database causes startup to fail rather than being silently erased.

Check the result:

```sh
flyctl status --app YOUR_APP
flyctl checks list --app YOUR_APP
flyctl machine list --app YOUR_APP
```

You should have one application Machine and a passing health check. Visit `https://YOUR_APP.fly.dev/health`; it should return a successful health response. A healthy server confirms startup, not successful Clio authentication.

## 7. Connect and test

Add a remote OAuth MCP connection to your AI client with:

```text
https://YOUR_APP.fly.dev/api/auth/mcp
```

Each staff member completes their own Clio browser login and consent. For Codex, use the [official MCP configuration instructions](https://learn.chatgpt.com/docs/extend/mcp) and set the URL to **your app**. The repository's checked-in `.codex/config.toml` points at the project's public service; change it in your fork if you intend to use it for your own deployment.

First ask for a read, such as “List up to five open matters; do not change anything.” Compare the result with Clio. Then test a fictional contact, matter, and note through create/read/update/delete, recording their IDs and removing only the records you created. Test a second user with different Clio permissions before rolling out to staff.

The hosted service exposes 40 tools with both read/write scopes, including deletes. `clio:read`-only grants omit writes. The local server's `READ_ONLY` environment setting is not a hosted deployment switch. Client-side tool hiding is not a substitute for authorization.

## 8. Optional: deploy automatically from GitHub

In **your fork**, enable Actions if needed. In **Settings → Secrets and variables → Actions**, add:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `FLY_APP` | Your app name |
| Variable | `HOSTED_ORIGIN` | `https://YOUR_APP.fly.dev` without a trailing slash |
| Secret | `FLY_API_TOKEN` | App-scoped deployment token generated below |

Generate the token locally:

```sh
flyctl tokens create deploy --app YOUR_APP
```

Treat the output as a password: copy it only into GitHub's secret field and store/rotate it according to its expiry. The workflow uses the `production` GitHub environment; configure any approval rules there if your firm needs them.

Push to **`main`**. The existing [deployment workflow](../.github/workflows/fly-deploy.yml) runs offline acceptance tests, then deploys the server and waits for health checks. Review its Actions run to confirm completion. A failed test blocks deployment.

CI/CD updates the **application only**. It does not recreate a deleted app, volume, IP address, or secret. Do not add automatic infrastructure reconstruction to solve routine deployment failures.

## Updates, logs, and recovery

Keep one Machine and its persistent volume. Review source and dependency changes before updating your fork. Manual deployments use the same command from step 6; automatic deployments use pushes to `main`.

Use `flyctl logs --app YOUR_APP` for startup and operational errors. Application audit output contains internal identifiers and outcomes, not record results or arguments. Configure access and retention for infrastructure logs; hosted audit export is not implemented. Treat logs as sensitive when asking for help.

**If the authentication database is lost, the accepted recovery is a fresh database and user reconnection.** Clio's own records remain in Clio:

1. Stop the affected Machine before changing storage. Preserve corrupted files separately if investigation is needed; do not erase a database just because startup failed.
2. Provide a fresh `clio_auth` volume in `yyz` and initialize its ownership as above. If a stopped Machine still references the lost volume, your operator must remove/recreate that Machine or update its mount before redeploying. Confirm the new empty volume is the intended target.
3. If the app itself was deleted, recreate the app and its public addresses, restore the three secrets from the password manager, and replace GitHub's deployment token. Update the Clio callback if the origin changed.
4. Redeploy, verify one healthy Machine, and ask everyone to reconnect. Some AI clients need the old connector removed and added again because client registrations were lost too.

Do not restore old authentication snapshots directly into the running service: they can revive previously revoked grants. Fly snapshots are not the recovery procedure for this application. See the [detailed operations runbook](../hosted/README.md#sqlite-migrations-and-recovery) for the rationale and constraints.

## Troubleshooting

| Symptom | Next check |
| --- | --- |
| Database permission denied | `/data` must be writable by UID/GID 1000. Confirm the correct volume is attached and initialized. |
| Health check fails | Read startup logs for missing secrets, malformed origin, storage permissions, or schema errors. Do not disable validation to get a green check. |
| Clio login fails | Confirm the Canadian app credentials, exact callback URI, application access, and user-profile permissions. |
| Client cannot connect | Use `/api/auth/mcp`, not `/health` or the callback URL. Confirm the client supports remote OAuth MCP. |
| Deployment rejects multiple Machines | Inspect the Machine list, including any leftover initializer. Resolve the extra Machine deliberately; do not scale the SQLite service horizontally. |
| A write timed out | Check Clio before trying again. The server does not automatically replay uncertain writes. |
| Everyone must reconnect after a deployment | Check whether the volume changed, the database was reset, or the encryption secret changed. Normal code deployment should preserve connections. |

These instructions are checked against the repository configuration and the existing Canadian deployment. A new firm's account permissions and client behavior still need acceptance testing. For security evidence and limitations, start with the [README](../README.md#security-decisions-and-evidence).
