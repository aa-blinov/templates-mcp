# Architecture

How `bx24-template-mcp` is put together.

The server speaks MCP to an assistant and REST to a Bitrix24 portal, and
there is one catalogue of tools underneath both. The specification the
implementation is held to is [../PROJECT-BRIEF.md](../PROJECT-BRIEF.md);
this document describes the shape of the code.

## The shape

One catalogue of 31 tools, three ways to reach it.

```
        server/mcp/tools/**   (27 task tools, 2 user tools, 2 meta tools)
                  │
       ┌──────────┴──────────────┐
       │                         │
   Nuxt HTTP                  Stdio (DXT)
   /mcp route                 mcp-stdio/server.ts
   Streamable HTTP            StdioServerTransport
   Bearer auth                process trust
       │                         │
  ┌────┴────┐                    │
  Remote   Local HTTP        Claude Desktop
  (Docker) (laptop)          spawns the process
```

The same handler code, the same tenant dispatcher and the same redacting
logger sit behind both. Only the transport and the packaging differ.

| Layer | Where | What it does |
| --- | --- | --- |
| Transport | `@nuxtjs/mcp-toolkit`, `mcp-stdio/server.ts` | The HTTP and the stdio plumbing. The toolkit mounts `/mcp`. |
| Guard | `server/middleware/mcp-auth.ts` | The Bearer check on `/mcp`. With the OAuth flag off it compares the token with `timingSafeEqual` and answers 503 when the token is unset. With the flag on it steps aside. |
| Tenant scope | `server/mcp/index.ts` | Resolves a Bearer to a tenant and wraps the rest of the request in an AsyncLocalStorage scope, so every tool sees the right tenant without it being passed around. |
| Tool registry | The Nuxt file glob, `mcp-stdio/tools.ts` | Two registries for one catalogue. A parity test fails the build when they drift. |
| Tool handlers | `server/mcp/tools/{tasks,users,meta}/` | One file per tool. `defineMcpTool` is a passthrough. |
| Tenant dispatcher | `server/utils/bitrix24-tenant.ts` | `useBitrix24Tenant()`, which every tool calls. The webhook singleton when OAuth is off, the per-tenant client when it is on. |
| Bitrix24 client | `server/utils/bitrix24.ts`, `server/utils/bitrix24-oauth.ts` | The webhook client is a process singleton. The OAuth client is one per tenant, cached. Both are built with a redacting logger. |
| Token store | `server/utils/token-store.ts` | SQLite. The Bearers are hashed, and every mutation writes an audit record first. |
| REST dispatch | `server/utils/sdk-helpers.ts` | `callV2`, `callV3`, `batchV2` and `batchV3`, and the error funnel. |
| Action factories | `server/utils/define-action-tool.ts`, `task-lifecycle.ts`, `checklist.ts` | The single-or-batch contract, and the confirmation flag on the destructive tools. |
| Landing page | `app.vue`, `assets/css/main.css` | The one page of the product, and the gradient on it. |
| OAuth pages | `server/utils/oauth-html.ts`, `server/api/oauth/` | The install and the callback, with a self-contained stylesheet under a content security policy nonce. |

## The data flow

```
a client connects with a Bearer
 → the h3 guard on /mcp
 → the toolkit middleware resolves the Bearer to a tenant
 → the tool handler runs inside the tenant scope
 → useBitrix24Tenant() gives the handler a client
 → callV2 / callV3 / batchV2 / batchV3
 → the Bitrix24 REST API
 → the tool's Zod schema validates the answer
 → the tool returns JSON to the client
```

A write that fails because the portal said no comes back through the same
funnel: the helpers own `isSuccess`, the error message and the transport
errors, so every tool reports a failure the same way.

## Decisions worth knowing about

### The tools are found by glob, and the bundle carries a registry

The Nuxt server finds the tool files by glob. The stdio bundle has no
filesystem discovery, so it carries an explicit list of the same 31 tools.
A test in `tests/unit/mcp-stdio/tools.parity.test.ts` fails the build when
one of the two is missing.

### A tool never calls `useBitrix24()` directly

It calls `useBitrix24Tenant()`, which returns the webhook singleton or the
per-tenant client depending on the flag. A tool that reaches for the
webhook directly pins itself to the webhook path and breaks the multi
tenant mode without saying so. A test in
`tests/unit/mcp-stdio/tools.tenant-guard.test.ts` fails the build on that
import.

### v2 by default, and v3 only where v2 does not exist

`callV2` carries the classic methods. `callV3` is for `tasks.task.get` and
the task result methods, which exist only on REST v3. A classic method sent
over v3 fails with `UNKNOWNDTOPROPERTYEXCEPTION`, because the field casing
differs between the two transports.

### The bundle carries shims rather than the code being rewritten

The toolkit barrel re-exports Nitro-bound modules that do not load outside
a Nuxt build. Rather than rewrite 31 tool files, the build aliases the
barrel to `mcp-stdio/toolkit-shim.ts`, which supplies the one symbol the
tools use. `mcp-stdio/nuxt-shims.ts` rebuilds the runtime config from the
environment and moves `console.log` to stderr, because stdout carries the
JSON-RPC frames.

The cost of that choice is a rule to remember: a new `runtimeConfig` key
has to be forwarded by the shim, or it reads as `undefined` inside the
bundle and nothing fails loudly there.

### The webhook client is a process singleton

The `RestrictionManager` keeps the rate limit state in memory, so two
clients would race against the same bucket. The cost is that a test that
needs a fresh client has to reset the modules and import the module again.

### Every destructive tool asks twice

A tool whose main effect is to wipe a record refuses without
`confirmDelete: true` and answers with a `DELETE_NEEDS_CONFIRM` error that
names the target. A tool that takes the children with it needs a second
flag. The cost is one extra parameter on every destructive tool, and the
gain is that no assistant can empty a portal by accident.

### The secret never reaches a log

The Bitrix24 SDK logs the request URL, and the URL carries the webhook
secret. Every client that talks to the portal is therefore built with
`makeRedactingLogger`, and the secret renders as `<REDACTED>` in the
container log, in `journalctl` and in the extension's log panel.

### The OAuth token cache is process-local

The refresh state lives in memory, so two replicas behind a load balancer
refresh independently and disagree about the counters on
`/api/oauth/_health`. The deployment is one instance until a shared store
lands.

## Boundaries

- A tool handler calls `useBitrix24Tenant()` and the typed helpers. It
  never touches `b24.actions.*`, because the helpers own the error funnel.
- The Bitrix24 SDK is never wrapped or patched. It ships the hooks for
  this, and a wrapper around an SDK class is a sign that the right API was
  not found.
- The transport layer knows nothing about Bitrix24. The tool layer knows
  nothing about HTTP.
- The landing page and the OAuth pages share no style. The first is a Nuxt
  app with the platform's components, the second is a string of CSS under a
  content security policy nonce.
- The secret handling lives in one place, the redacting logger, and every
  client that talks to the portal goes through it.
