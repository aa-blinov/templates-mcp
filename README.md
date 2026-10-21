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

## Available tools

| Tool | What it does |
|---|---|
| `b24_user_me` | Returns the Bitrix24 user that owns the configured webhook. Useful as a connectivity check. |
| `b24_user_find` | Find users by name / surname / position / department, or free-text. **Call this before any tool that takes a userId** — operators speak in names, not numeric ids. |
| `b24_group_find` | Find a workgroup/project by name (LIKE match). **Call this before any tool that takes a groupId** — operators name projects, not numeric ids. |
| `b24_task_create` | Create a task — title, responsibleId required; description / deadline / groupId / priority / accomplices / auditors optional. |
| `b24_task_list` | List tasks with filter (`{ RESPONSIBLE_ID, STATUS, "!STATUS", ">=DEADLINE", … }`), order, select, and pagination (page size fixed at 50). Add `description` to `select` to read task bodies (with the `descriptionInBbcode` markup flag); `groupId` / `createdBy` / `parentId` / `changedDate` / `closedDate` likewise come back when selected. |
| `b24_task_update` | Update an existing task by id with a partial UPPERCASE-keyed `fields` object. |
| `b24_task_comment_add` | Append a comment to a task (BBCode-friendly). |
| `b24_task_chat_file_list` | List files/images posted in a task's chat (screenshots, PDFs shared mid-thread) — name, human-readable size + bytes, dimensions, uploader, and signed download/preview URLs. Metadata only, never bytes/base64. |
| `b24_task_file_list` | List files attached directly to a task's card (separate from its chat — check both). Requires `disk` scope on the webhook. **`downloadUrl` embeds the portal's webhook secret** (legacy Disk mechanism, not a scoped token) — treat it as credential-bearing. |
| `b24_task_file_attach` | Attach a file to a task's card — an existing Disk file (`fileId`), or upload a new one (`upload`, base64, max 3 MiB, requires the task to belong to a project). File and task must share the same project's Disk storage. Requires `disk` scope. |
| `b24_task_comment_list` | Read a task's comment thread — merges the task chat and the legacy forum store, so it works on tasks of any age. Full bodies, `authorId` + `authorName` per comment, an author roll-up, and `source` / `isSystem` per entry. Oldest-first by default; `authorId` filter, `includeSystem`, `limit` / `offset` paging. |
| `b24_task_start` | Move a task to In progress (3). |
| `b24_task_pause` | Move an In-progress task back to Pending (2). |
| `b24_task_complete` | Mark a task as completed (5), or Supposedly completed (4) when task control is on. |
| `b24_task_approve` | Creator approves a Supposedly-completed task → Completed (5). |
| `b24_task_disapprove` | Creator rejects a Supposedly-completed task → Pending (2) for rework. |
| `b24_task_defer` | Move a task to Deferred (6) — postponed but not closed. |
| `b24_task_renew` | Reopen a Completed or Deferred task → Pending (2). |
| `b24_task_watch` | Subscribe the caller to a task's notifications (self-subscribe only, doesn't change status). Idempotent. |
| `b24_task_unwatch` | Unsubscribe the caller from a task's notifications. Idempotent. |
| `b24_task_rate` | Set or clear the task rating (positive / negative / none — Bitrix24 `MARK` field). |
| `b24_task_checklist_item_add` | Add an item to a task checklist. Omit `parentId` (or pass 0) to start a new checklist — the `title` becomes the heading. |
| `b24_task_checklist_item_list` | List every checklist item on a task as a flat tree (`parentId: 0` = checklist heading). |
| `b24_task_checklist_item_complete` | Check off a checklist item. |
| `b24_task_checklist_item_renew` | Un-check a previously completed checklist item. |
| `b24_task_checklist_item_delete` | Delete a checklist item. Heading deletion (parentId 0) wipes the whole checklist and is refused without `confirmDeleteHeading: true`. |
| `b24_task_result_add` | Record a free-form RESULT (outcome text) on a task — separate from comments and from the task body. |
| `b24_task_result_list` | List the results recorded on a task. Newest-first by default; pagination via limit/offset. |
| `b24_task_result_update` | Rewrite the text of an existing result. Author-only: Bitrix24 returns `ACCESSDENIEDEXCEPTION` if any other operator (besides a portal admin) tries to edit. |
| `b24_task_result_delete` | Delete a result by id. Author-only; the task itself is not affected. |
| `b24_task_elapsed_time_add` | Log a manual elapsed-time entry on a task ("how long did this take"), separate from the auto stopwatch. `seconds` capped at 86400 (24h). |
| `b24_task_elapsed_time_list` | List elapsed-time entries (manual + stopwatch) on tasks. Filter by `taskId` or a custom camelCase filter; paginates at 50. |
| `b24_task_elapsed_time_update` | Correct an existing elapsed-time entry (duration / comment / attribution). Author-or-admin only. |
| `b24_task_elapsed_time_delete` | Delete elapsed-time entries. Requires `confirmDelete: true`. Author-or-admin only. |
| `b24_task_dependency_add` | Create a "previous task" dependency (`taskIdFrom` → `taskIdTo`) for Gantt-style scheduling. |
| `b24_task_dependency_remove` | Remove a "previous task" dependency. Requires `confirmDelete: true`. |
| `b24_task_auditor_add` | Add observers (auditors) to a task without clobbering the ones already watching it — reads the current set, merges, writes the union back. |
| `b24_task_auditor_remove` | Remove observers from a task, leaving the rest in place. Removing the last one clears the field, not an error. |
| `b24_task_delete` | Permanently delete a task. Requires `confirmDelete: true`. Creator/admin only. Single id or batch (up to 50; `force: true` to override). |
| `bx24mcp_submit_feedback` | Meta-tool: lets the AI agent file a GitHub issue against this repository with structured feedback. See [`docs/FEEDBACK.md`](./docs/FEEDBACK.md). |

29 Bitrix24 + 1 meta = **30 tools total**.

The 8 task-mutation tools above (`start_task` / `pause_task` / `complete_task` / `approve_task` / `disapprove_task` / `defer_task` / `renew_task` / `rate_task`) accept a single id **or** an array for batch mode (up to **25**; pass `force: true` to override) and go through one HTTP round-trip via the `batchV2` helper. The 3 checklist actions (`complete_checklist_item` / `renew_checklist_item` / `delete_checklist_item`) also accept single or batch (up to **50**; `force: true` to override) via `batchV2`. `delete_elapsed_time` and `remove_task_dependency` likewise take a single id or an array for batch deletion (up to **50**; `force: true` to override; each still gated by `confirmDelete: true`). `add_checklist_item` and `list_checklist_items` are single-call only by design. Rate limiting, retry, and adaptive back-pressure are provided by the [`@bitrix24/b24jssdk`](https://www.npmjs.com/package/@bitrix24/b24jssdk) `RestrictionManager` — initialised with `ParamsFactory.getDefault()` (standard tariff: burst 50, drain 2 req/sec, 3 retries on transient errors). Override at runtime via `client.setRestrictionManagerParams(ParamsFactory.getEnterprise())` etc.

## MCP resources

Beyond tools, the server exposes one MCP **resource** (fetched on demand via `resources/read`, not injected into every turn the way tool descriptions are):

| Resource | What it does |
|---|---|
| `bx24://docs/task-workflow-playbook` | Cross-tool orchestration guidance: the order to build a task up in, and which tool "прими задачу" actually means (see [`docs/TASK-WORKFLOW-PLAYBOOK.md`](./docs/TASK-WORKFLOW-PLAYBOOK.md)). HTTP build only — not yet ported to the stdio/DXT bundle. |

## Connecting Claude

### Remote MCP — production server (Claude.ai web)

1. Claude.ai → Settings → Connectors → Add custom connector.
2. Name: `Bitrix24 (b24-mcp)`.
3. URL: `https://prod.example.com/mcp`.
4. Advanced → Custom header: `Authorization: Bearer <NUXT_MCP_AUTH_TOKEN>`.
5. Save, enable in chat, ask "Show me my Bitrix24 current user".

For production deployment, see [`docs/REVERSE-PROXY.md`](./docs/REVERSE-PROXY.md) — covers nginx-proxy (the default), Caddy, plain nginx + certbot, and Traefik. Pick whichever your hosting provider already runs.

#### Multi-tenant OAuth 2.0 — per-user identity (opt-in)

The Remote setup above shares one `NUXT_MCP_AUTH_TOKEN` and runs every call under one webhook service user — right for a single team. For a **multi-user / SaaS** deployment, flip on OAuth (`NUXT_BITRIX24_OAUTH_ENABLED=true`) and each end user authorises once at `https://<your-mcp>/api/oauth/install?portal=<theirportal>`, then pastes the per-user Bearer they receive into their connector. Every REST call then runs under *that* user's Bitrix24 identity and permissions — no shared service user.

> **Warning.** When the flag is on, `NUXT_MCP_AUTH_TOKEN` is bypassed on `/mcp`** — the endpoint accepts only per-user OAuth Bearers. Migrate every connected client to its own Bearer **before** flipping the flag. It stays **off by default**, so existing webhook deployments are unaffected. Full operator guide: [`docs/DEPLOYMENT.md` → OAuth 2.0 multi-tenant](./docs/DEPLOYMENT.md#oauth-20-multi-tenant-opt-in); design + threat model: [`docs/OAUTH-DESIGN.md`](./docs/OAUTH-DESIGN.md).

### Local MCP — your own machine (Claude Desktop, Cursor, Claude Code, Cline, …)

No public domain or TLS required. Run the same Nuxt build on `localhost` and point any HTTP-MCP-capable AI client at it.

```bash
git clone https://github.com/bitrix24/templates-mcp.git
cd templates-mcp
cp .env.example .env
# In .env: set NUXT_BITRIX24_WEBHOOK_URL; generate NUXT_MCP_AUTH_TOKEN
#   Linux/macOS:  openssl rand -hex 32
#   Windows:      -join ((48..57)+(97..102) | Get-Random -Count 64 | %{[char]$_})
#   Any Node:     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
pnpm install
pnpm build
pnpm start
# → server listening on http://localhost:3000/mcp
```

Health check while it's up:

```bash
curl http://localhost:3000/api/health
```

Then add an MCP server entry to your client. The wire shape is identical everywhere — URL + `Authorization: Bearer <token>` header — only the config file location differs.

#### Claude Code (CLI agent — `claude mcp add`)

One-line registration, no JSON editing:

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
