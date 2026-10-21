# AGENTS.md — agent context for `bx24-template-mcp`

A Nuxt 4 and Nitro server that speaks MCP to an AI assistant and REST to a Bitrix24 portal, with a second build that ships the same tools as a Claude Desktop extension over stdio. This file is what you need to change the code without reading all of it.

## Run / build / test

```bash
pnpm install          # install
pnpm dev              # dev server on :3000
pnpm build            # production build into .output/
pnpm start            # run the production build
pnpm lint             # ESLint
pnpm typecheck        # vue-tsc through nuxt typecheck
pnpm test             # vitest, the whole suite
pnpm test:unit        # unit tests only
pnpm test:integration # live Bitrix24 calls; needs NUXT_BITRIX24_TEST_WEBHOOK_URL
pnpm test:evals       # tool-selection evals; needs DEEPSEEK_API_KEY
pnpm build:dxt        # the Claude Desktop bundle, dist/bx24-template-mcp.dxt
```

Node 22 and pnpm 11. The pnpm version is pinned through `packageManager`, so `corepack enable` fetches the right one. The Makefile wraps the same commands for operators (`make dev`, `make test`, `make lint`, `make typecheck`, `make build-dxt`) and adds the Docker lifecycle (`make up`, `make redeploy`, `make verify URL=...`).

## Where things live

| Path | What it holds |
| --- | --- |
| `server/mcp/tools/tasks/` | The 27 task tools, one file each. |
| `server/mcp/tools/users/` | `b24_user_me` and `b24_user_find`. |
| `server/mcp/tools/meta/` | `bx24mcp_submit_feedback` and `bx24mcp_list_session`. Neither calls Bitrix24. |
| `server/utils/bitrix24-tenant.ts` | The dispatcher every tool handler calls. |
| `server/utils/sdk-helpers.ts` | `callV2`, `callV3`, `batchV2`, `batchV3` and the error funnel. |
| `server/utils/define-action-tool.ts` | `confirmDeleteSchema()` and `assertConfirmedDelete()`, shared by the delete tools. |
| `server/utils/logger-redactor.ts` | The wrapper that scrubs the webhook secret out of every log sink. |
| `server/middleware/mcp-auth.ts` | The h3 guard on `/mcp`. |
| `server/mcp/index.ts` | The toolkit handler that resolves a Bearer to a tenant. |
| `server/api/oauth/` | The install, callback and operator health routes. |
| `server/utils/token-store.ts` | The SQLite store for OAuth tokens and minted Bearers. |
| `mcp-stdio/tools.ts` | The explicit registry the stdio bundle uses. |
| `mcp-stdio/nuxt-shims.ts` | The runtime-config and console shims for the bundle. |
| `mcp-stdio/toolkit-shim.ts` | The stand-in for the toolkit barrel, which cannot load outside a Nuxt build. |
| `tests/unit/mcp-stdio/` | The parity, tenant-guard, naming-convention and shim tests. |
| `docs/` | Architecture, deployment, runbook, security, evals, reverse proxy. |
| `skills/manage-bx24-template-mcp/` | The agent skill set, including the template for a new tool. |

## Traps

- **Two registries, one catalogue.** A new tool lands in `server/mcp/tools/<group>/<name>.ts` for the HTTP server and in `mcp-stdio/tools.ts` for the stdio bundle. `tests/unit/mcp-stdio/tools.parity.test.ts` fails the build when one of the two is missing.
- **A tool never calls `useBitrix24()`.** It calls `useBitrix24Tenant()`, which returns the webhook singleton when OAuth is off and the per-tenant client when it is on. `tests/unit/mcp-stdio/tools.tenant-guard.test.ts` fails the build when a tool file imports `useBitrix24` directly.
- **v2 by default, v3 only where v2 does not exist.** `callV2` for the classic methods, `callV3` only for `tasks.task.get` and `tasks.task.result.*`. A classic method sent over v3 fails with `UNKNOWNDTOPROPERTYEXCEPTION`, because the field casing differs between the two transports.
- **A new `runtimeConfig` key has to be forwarded by the shim.** `mcp-stdio/nuxt-shims.ts` carries only the fields it was told to carry. A field the shim does not know reads as `undefined` inside the DXT bundle, and nothing fails loudly there.
- **Never import the toolkit barrel from a tool.** It re-exports Nitro-bound modules that do not load outside a Nuxt build. The DXT build aliases `@nuxtjs/mcp-toolkit/server` to `mcp-stdio/toolkit-shim.ts`, which provides the one symbol the tools use.
- **`vitest.config.ts` has a pinned `envPrefix`.** A CI step greps for the exact line `envPrefix: ['VITE_', 'NUXT_BITRIX24_TEST_', 'DEEPSEEK_'],`. A test that reads any other variable out of `.env` sees `undefined` and skips without an error.
- **The placeholder token produces a 503, not a 401.** `NUXT_MCP_AUTH_TOKEN=replace-with-secure-token` means "not configured", and the middleware answers 503. The docker-smoke job boots a second container to pin that behaviour.
- **OAuth on means the shared token stops working.** With `NUXT_BITRIX24_OAUTH_ENABLED=true`, `/mcp` accepts only per-user OAuth Bearers. There is no dual-accept window, so every connected client has to be migrated first.
- **The OAuth token cache is process-local.** The refresh state lives in memory, so two replicas behind a load balancer refresh independently and disagree about the counts on `/api/oauth/_health`. Keep the deployment to one instance until a shared store lands.
- **`console.log` in the bundle corrupts the transport.** `mcp-stdio/nuxt-shims.ts` redirects `console.log` and `console.info` to stderr, because stdout carries the JSON-RPC frames.
- **esbuild runs with `treeShaking: false`.** Zod 4 and the MCP SDK break under aggressive tree shaking, because `z.custom(...)` is evaluated at module load.
- **`NODE_ENV=production` breaks the repo-root `.env`.** Nuxt reads that file during `pnpm dev` and `pnpm test`. The variable belongs in the host `.env` beside `docker-compose.yml`, which Docker Compose reads and Nuxt never sees.
- **A `better-sqlite3` database on NFS corrupts.** The OAuth store uses WAL, so `NUXT_BITRIX24_OAUTH_DB_DIR` has to sit on a local disk.
- **The audit directory has to be an absolute path.** `server/utils/audit-log.ts` refuses a path with `..` in it, and it creates the directory with mode `0750` and the files with `0640`.
- **The batch caps differ per tool.** The eight lifecycle verbs cap a batch at 25; the checklist calls and the dependency calls cap at 50, and so does the deletion of an elapsed time entry. A larger batch raises `BATCH_TOO_LARGE` unless `force: true` is set.
- **The webhook client is cached in module scope.** A test that needs a fresh client calls `vi.resetModules()` and re-imports the module.
- **`scripts/verify-deployment.sh` does not know about OAuth.** It checks the shared-token contract only. The OAuth surface has its own script, `scripts/manual-qa-pr2c.sh`.

## Style / safety rails

- **One tool per file**, in `server/mcp/tools/<group>/`. The name is `b24_<domain>(_<entity>)*_<action>` for a tool that calls Bitrix24 and `bx24mcp_<verb>` for one that does not. The action is the last token and every token is singular.
- **Every Zod field carries `.describe()`.** The model reads the description at runtime, so a missing one is a field the model has to guess.
- **Every destructive tool needs `confirmDelete: true`.** A tool whose main effect is to wipe a record has to refuse without it and answer with a `DELETE_NEEDS_CONFIRM` error that names the target. A tool that wipes more than its target needs a second, cascade-specific flag.
- **Tools call the typed helpers, never `b24.actions.*`.** The helpers own `isSuccess`, the error messages and the transport error funnel.
- **The Bitrix24 SDK is never monkey-patched.** It ships `setRestrictionManagerParams`, `setLogger`, `ParamsFactory` and `getStats` for this. A wrapper around an SDK class is a sign that the right API was not found.
- **No secrets in code, in tests or in logs.** Read them from `useRuntimeConfig()` and `.env`. Every Bitrix24-facing client gets `makeRedactingLogger` on construction, and `redactValue` recurses into plain objects only, so a class instance passed as a log context needs the redactor widened first.
- **Do not bind the container to a host port in production.** The compose file is meant to sit behind the reverse proxy on the shared `proxy-net` network.
- **Do not change the MCP transport, and do not remove the auth middleware.**
- **Every piece of code under `server/` needs a test.** A new tool needs a unit test with the Bitrix24 client mocked.
- **Conventional Commits, and `commitlint` checks them in CI.** The PR title becomes the commit message.
- **Renovate does not merge the Bitrix24 SDK or the MCP stack on its own.** Both need a human read, and an SDK bump has to go through the audit procedure in `docs/SECURITY-AUDIT.md`.
- **An edit to `.env.example` has to touch the manual-QA scaffold in the same pull request.** A CI job compares the two file lists and fails the build otherwise.

## Where the product truth lives

`PRODUCT.md` holds it. Read it before changing what the product does, and write the change there when the behaviour changes.
