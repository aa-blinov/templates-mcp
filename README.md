# bx24-template-mcp

Give an AI assistant a Bitrix24 portal to work in: create a task, find the colleague who owns it, log ninety minutes against it, tick off a checklist item. The repository ships that as a running server with 29 tools for the tasks and users domains, two tools for the server itself, and the authentication, throttling, logging and test scaffolding a fork needs before it adds a domain of its own.

![The MCP mark](mcp-stdio/icon.png)

[![CI](https://github.com/bitrix24/templates-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bitrix24/templates-mcp/actions/workflows/ci.yml)
[![Deploy](https://github.com/bitrix24/templates-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/bitrix24/templates-mcp/actions/workflows/deploy.yml)
[![Release](https://img.shields.io/github/v/release/bitrix24/templates-mcp?sort=semver&display_name=tag&logo=github)](https://github.com/bitrix24/templates-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)](https://nuxt.com/)

---

## Quick start

Three shapes, one tool catalogue. Pick the row that matches who runs it.

| Shape | Command | What the operator gets |
| --- | --- | --- |
| Local HTTP | `pnpm dev` | A server on `localhost:3000` that any HTTP MCP client can point at. No domain, no TLS. |
| Desktop extension | `pnpm build:dxt` | One file, `dist/bx24-template-mcp.dxt`, installed by Claude Desktop over stdio. No port, no Bearer, no server to operate. |
| Docker | `make up` | The published image on a host behind a reverse proxy with TLS, updated from GHCR with a health-gated redeploy. |

### Local HTTP

Mint an incoming webhook in the portal first: Developer resources, then Other, then Inbound webhook. The URL has the shape `https://<portal>.bitrix24.<tld>/rest/<user-id>/<webhook-code>/`. Create it under a service account rather than a person's account, because every REST call inherits the permissions of the account that made it.

```bash
git clone https://github.com/bitrix24/templates-mcp.git
cd templates-mcp
cp .env.example .env
# in .env: NUXT_BITRIX24_WEBHOOK_URL and NUXT_MCP_AUTH_TOKEN
corepack enable
pnpm install
pnpm dev
```

Generate the Bearer token with `openssl rand -hex 32`. The placeholder that ships in `.env.example` counts as unset, so `/mcp` answers 503 until the value is replaced.

Check that the server is up:

```bash
curl http://localhost:3000/api/health
```

### Point a client at it

The wire shape is the same everywhere: a URL and an `Authorization: Bearer` header. Only the config file differs.

```bash
claude mcp add bx24 \
  --transport http \
  --url http://localhost:3000/mcp \
  --header "Authorization=Bearer <NUXT_MCP_AUTH_TOKEN>"
```

For Claude Desktop and Cursor the entry goes into `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows, `~/.config/Claude/` on Linux) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bx24": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <NUXT_MCP_AUTH_TOKEN>" }
    }
  }
}
```

Ask the assistant to show the current Bitrix24 user. The tool that answers is `b24_user_me`, and it returns the account the webhook belongs to.

### Desktop extension

```bash
pnpm install
pnpm build:dxt
# → dist/bx24-template-mcp.dxt
```

In Claude Desktop: Settings, then Extensions, then Install from file. Paste the webhook URL when prompted; it lands in the OS keychain, not in a file you have to protect. The build needs Node 22, and nothing else: the archive is written by an npm package rather than by a system `zip` binary. Guides in Russian and Brazilian Portuguese: [mcp-stdio/INSTALL.ru.md](mcp-stdio/INSTALL.ru.md), [mcp-stdio/INSTALL.pt-BR.md](mcp-stdio/INSTALL.pt-BR.md). The bundle internals are described in [mcp-stdio/README.md](mcp-stdio/README.md).

### Docker

```bash
cp .env.example .env
# in .env: the webhook URL, the Bearer token, VIRTUAL_HOST, LETSENCRYPT_*
make init-network   # the shared proxy-net, once per host
make up
make verify URL=https://mcp.example.com
```

`make redeploy` pulls the new image and waits on the container health check before it replaces the running one, so a crash-looping image fails the command instead of quietly taking the service down. The deployment procedure, the TLS terminator options and the rollback path live in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/RUNBOOK.md](docs/RUNBOOK.md).

## What it does

- **31 tools.** 29 talk to Bitrix24 (27 for tasks, 2 for users), 2 talk to the server itself: `bx24mcp_submit_feedback` files a labelled GitHub issue from inside a session, and `bx24mcp_list_session` lists the Bearer sessions a tenant holds.
- **Task lifecycle.** Create, list, update and comment, plus eight state changes: start, pause, complete, approve, disapprove, defer, renew and rate.
- **Checklists, results and elapsed time.** A checklist is a flat tree keyed by `parentId`, a result is the free-form outcome text on a task, and elapsed time is the manual entry logged next to the stopwatch.
- **Batch mode.** The eight lifecycle verbs take one id or up to 25; the checklist calls and the dependency calls take one id or up to 50, and so does the deletion of an elapsed time entry. A batch is one HTTP round trip against the Bitrix24 `batch` method, and a failure on one id does not abort the rest.
- **A gate on destruction.** Every tool whose main effect is to wipe a record refuses without `confirmDelete: true`. Deleting a checklist heading needs a second `confirmDeleteHeading` flag, because it takes every child item with it.
- **Bearer authentication on `/mcp`.** The shared token is compared with `crypto.timingSafeEqual`, and the `.env.example` placeholder is treated as unset, so a copy-pasted deployment answers 503 instead of accepting a publicly known secret.
- **Per-user OAuth, off by default.** With `NUXT_BITRIX24_OAUTH_ENABLED=true` each user authorises once and every REST call runs under that user's own Bitrix24 identity and permissions.
- **Rate limiting from the SDK.** The `RestrictionManager` runs on the standard tariff: a burst of 50, a drain of 2 requests a second, 3 retries with backoff on transient errors.
- **A secret that stays out of the logs.** The Bitrix24 SDK logs the request URL, which carries the webhook secret, so every client is wrapped in a redacting logger and the secret renders as `<REDACTED>` in `docker logs`, `journalctl` and the extension log panel.
- **A feedback channel with a limit.** The agent can file a structured issue against the repository, capped at 5 attempts an hour per tenant.
- **A health endpoint.** `GET /api/health` answers `{"status":"ok","timestamp":"..."}` without a token, which is what the deploy pipeline uses to decide whether to roll back.

## How it works

```
server/mcp/tools/**          one file per tool, discovered by the Nuxt server
        |
  useBitrix24Tenant()        webhook singleton, or the per-tenant OAuth client
        |
  callV2 / callV3            one method, one round trip
  batchV2 / batchV3          many methods, one round trip
        |
  Bitrix24 REST
```

One catalogue, three transports. The Nuxt server finds the tool files by glob and serves them over streamable HTTP, on a laptop or in a container. The stdio bundle carries an explicit registry listing the same 31 tools, and `tests/unit/mcp-stdio/tools.parity.test.ts` fails the build when the two drift apart.

Authentication has two layers. The h3 middleware in `server/middleware/mcp-auth.ts` guards the `/mcp` path and answers 401 or 503. The toolkit middleware in `server/mcp/index.ts` resolves a Bearer to a tenant and wraps the request in an AsyncLocalStorage scope, so every tool sees the right tenant without passing it around. Tool code never learns which client it got: `useBitrix24Tenant()` returns the webhook singleton when OAuth is off and a per-tenant `B24OAuth` when it is on.

REST calls go through four typed helpers. `callV2` is the default, `callV3` is for the methods that exist only on REST v3 (`tasks.task.get` and the task result methods), and the batch helpers wrap the `batch` method. Calling `b24.actions.*` from a tool is off limits, because the helpers own the error funnel and the transport errors.

The Bitrix24 client is a process singleton, because the `RestrictionManager` keeps the rate-limit state in memory and two clients would race against the same leaky bucket.

The DXT bundle is built by esbuild from `mcp-stdio/server.ts` with every dependency inlined, so the archive carries no `node_modules`. Three files stand in for what Nuxt would have provided: `mcp-stdio/nuxt-shims.ts` reconstructs the runtime config from the environment and redirects `console.log` to stderr, where it cannot corrupt the JSON-RPC frames on stdout; `mcp-stdio/toolkit-shim.ts` replaces the toolkit barrel, which cannot load outside a Nuxt build; and `mcp-stdio/tools.ts` is the registry, because there is no file-based discovery in this build.

The landing page at `/` is a Nuxt app built with the Bitrix24 component system, and it carries a ready-made prompt that exercises the tools end to end.

## Configuration

Everything is environment variables, read through `runtimeConfig` in `nuxt.config.ts`. `.env.example` is the contract, and it is the file a fork copies.

| Variable | Default | What it does |
| --- | --- | --- |
| `NUXT_BITRIX24_WEBHOOK_URL` | none | The incoming webhook every REST call goes through. Required. |
| `NUXT_MCP_AUTH_TOKEN` | none | The Bearer token a client presents on `/mcp`. The `.env.example` placeholder counts as unset. |
| `NUXT_BITRIX24_OAUTH_ENABLED` | `false` | Turns on the per-user OAuth flow. While it is on, `NUXT_MCP_AUTH_TOKEN` is ignored on `/mcp`. |
| `NUXT_BITRIX24_OAUTH_CLIENT_ID` | none | `CLIENT_ID` of a Bitrix24 Marketplace application. |
| `NUXT_BITRIX24_OAUTH_CLIENT_SECRET` | none | `CLIENT_SECRET` of the same application. |
| `NUXT_BITRIX24_OAUTH_REDIRECT_URL` | none | The callback URL. It has to match the registered one exactly. |
| `NUXT_BITRIX24_OAUTH_SCOPE` | `user,task` | The REST scopes requested at consent. |
| `NUXT_BITRIX24_OAUTH_DB_DIR` | `/data` | The directory holding `oauth.sqlite`. It has to be a persistent, writable mount. |
| `NUXT_BITRIX24_OAUTH_ADMIN_TOKEN` | none | Gates `GET /api/oauth/_health`. Empty leaves the route reachable from localhost only. |
| `NUXT_GITHUB_FEEDBACK_TOKEN` | none | The PAT that lets `bx24mcp_submit_feedback` open issues. |
| `NUXT_GITHUB_FEEDBACK_REPO` | `bitrix24/templates-mcp` | Where the feedback issues go. |
| `NUXT_LOG_LEVEL` | `info` | The console level. Unset means `debug` under `pnpm dev` and `info` elsewhere. An unrecognised value prints one warning to stderr and falls back. |
| `NUXT_AUDIT_DIR` | `/data/audit` | Where the OAuth and Bearer audit log is written, as JSONL. |
| `NITRO_PORT` | `3000` | The port the server listens on. |
| `COMPOSE_PROJECT_NAME` | `bx24-mcp` | The Docker Compose project name. The named volume and the container inherit it. |
| `NODE_EXTRA_CA_CERTS` | none | The trust bundle for a self-hosted portal on a private CA. |
| `VIRTUAL_HOST`, `VIRTUAL_PORT` | none, `3000` | What the reverse proxy routes to. Used by the nginx-proxy stack. |
| `LETSENCRYPT_HOST`, `LETSENCRYPT_EMAIL` | none | The certificate request made by acme-companion. |

The OAuth design, the event taxonomy and the threat model live in [docs/OAUTH-DESIGN.md](docs/OAUTH-DESIGN.md). The security posture, the disclosure process and the rotation procedure live in [docs/SECURITY.md](docs/SECURITY.md) and [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md).

## Development

```bash
pnpm install          # install
pnpm dev              # dev server on :3000
pnpm build            # production build into .output/
pnpm start            # run the production build
pnpm lint             # ESLint
pnpm typecheck        # vue-tsc through nuxt typecheck
pnpm test             # the whole vitest suite
pnpm test:unit        # unit tests only
pnpm test:integration # live Bitrix24 calls; needs NUXT_BITRIX24_TEST_WEBHOOK_URL
pnpm test:evals       # tool-selection evals; needs DEEPSEEK_API_KEY
pnpm build:dxt        # the Claude Desktop bundle
```

Node 22 and pnpm 11. The pnpm version is pinned through `packageManager`, so `corepack enable` picks the right one. `make dev`, `make test`, `make lint`, `make typecheck` and `make build-dxt` wrap the same commands, and the rest of the Makefile drives the Docker lifecycle.

| Path | What it holds |
| --- | --- |
| `server/mcp/tools/` | One file per tool, grouped into `tasks`, `users` and `meta`. |
| `server/utils/sdk-helpers.ts` | `callV2`, `callV3`, `batchV2`, `batchV3` and the error funnel. |
| `server/utils/bitrix24-tenant.ts` | The dispatcher every tool handler calls. |
| `server/utils/define-action-tool.ts` | `confirmDeleteSchema()` and `assertConfirmedDelete()`, shared by the delete tools. |
| `server/utils/logger-redactor.ts` | The wrapper that scrubs the webhook secret out of every log sink. |
| `server/middleware/mcp-auth.ts` | The Bearer check on `/mcp`. |
| `server/mcp/index.ts` | The toolkit handler that resolves a Bearer to a tenant. |
| `server/api/oauth/` | The install, callback and operator health routes. |
| `mcp-stdio/` | The DXT bundle: manifest, entry point, shims, registry and build script. |
| `tests/` | 70 Vitest files (69 unit, one live-portal integration), an eval suite and a shell test. |
| `docs/` | Architecture, deployment, runbook, security, evals and the reverse proxy guide. |
| `skills/` | The agent skill set, including the template for a new tool. |

Adding a tool is a nine-step procedure, written down in [docs/ADDING-TOOLS.md](docs/ADDING-TOOLS.md) and mirrored for agents in [skills/manage-bx24-template-mcp/adding-tools.md](skills/manage-bx24-template-mcp/adding-tools.md). The project specification is [PROJECT-BRIEF.md](PROJECT-BRIEF.md), the contribution rules are [CONTRIBUTING.md](CONTRIBUTING.md), and the release history is [CHANGELOG.md](CHANGELOG.md).

## License

MIT, © Bitrix24. See [LICENSE](LICENSE).
