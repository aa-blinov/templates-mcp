# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Plus a local build with no server at all. The product is two artefacts built from one tool catalogue: a Nuxt 4 and Nitro HTTP server that mounts the MCP endpoint at `/mcp`, and a Claude Desktop extension that speaks MCP over stdio on the operator's own machine. The server renders one page, a landing page, and it answers three OAuth routes.

## Users

Two groups meet at the same screen, and a third keeps the lights on.

The first is whoever forks the repository: a developer who wants an MCP server on top of Bitrix24 and would rather start from the authentication, throttling, logging and test scaffolding than write them. The package description says it plainly: a starter template for building MCP servers on Bitrix24, with example tools for tasks and users, plus the scaffolding to fork and extend.

The second is the operator whose portal the assistant works in: an HR head, an accountant, a foreman, an owner-operator. The skill file walks every tool description through six of them, from a factory director in Russian manufacturing to a clinic head who is not technical and is over fifty, to a retail COO in the UAE. They speak in names rather than ids, they do not know the REST field names, and what reaches them is the tool description and the error message.

A third person runs the server: they deploy it behind a reverse proxy, rotate a token and read a JSONL audit log. That person is not the person who uses it.

## Product Purpose

The product does one thing: it lets an AI assistant work inside a Bitrix24 portal that somebody already operates, under that portal's own permissions. Around that it ships the scaffolding for the same thing in a domain the template has not reached yet.

Success for the operator: the assistant answers in the chat window, the task exists in the portal afterwards, and what the assistant says about it matches the shape of the portal. Success for the product: a fork adds one tool per pull request, with a schema, a test and an eval case, and a reviewer can tell from the description alone what the tool will do to the portal.

## Positioning

The claim is narrower than "a Bitrix24 MCP server". The template does the tedious part of the work once and leaves the domain to whoever forks it.

Five things in here are hard to copy, and each of them is held in place by a check rather than by a convention:

- The dispatcher invariant. One seam, `useBitrix24Tenant()`, sits between a tool and the Bitrix24 client, and a test fails the build when a tool reaches around it. Multi-tenant OAuth arrived later as a change to that one dispatcher, and the tool handlers kept their shape.
- The parity test between the file-based registry and the explicit registry the stdio bundle carries, so the two builds cannot drift apart.
- The redaction layer, and the audit procedure it forces on every SDK bump: a new SDK version has to be read for a fresh URL-shaped log line before it merges.
- The deletion gate, agreed on by the tool author rather than left to the model's judgement at call time.
- The deployment set: a bootstrap script that fetches a pinned tag, a redeploy that waits on the container health check, monitor-only Watchtower, and a smoke test that boots the container and checks the auth contract.

## Operating Context

The operator is in a chat window and mid-sentence when the assistant reaches for a tool. The call happens out of sight. What they see afterwards is the answer, plus whatever the assistant says about it. The server runs unattended between those moments behind a reverse proxy, and the person who keeps it running is somebody else.

Three facts about the environment shape the design. Deadlines are stored in portal-local time, so a phrase like "by tomorrow 6pm" is ambiguous and the documentation pushes for an explicit offset. Bitrix24 permissions decide what an answer can contain, so the webhook is bound to a service account with the narrowest rights the tool set needs, and the OAuth mode exists for the case where each user has to act as themselves. The REST API is half migrated to v3, so the transport is chosen per method rather than once for the whole project.

## Capabilities and Constraints

Confirmed by the code:

- 31 tools: 29 for tasks and users, 2 for the server itself.
- The eight task lifecycle verbs, plus checklists, task results, elapsed time and dependencies.
- Batch mode on the mutation tools, up to 25 ids for the lifecycle verbs and up to 50 for the checklist calls, the dependency calls and the deletion of an elapsed time entry, in a single HTTP round trip.
- A `confirmDelete` gate on every destructive tool, and a second flag where a delete takes the children with it.
- Bearer authentication on `/mcp`, compared in a way that does not leak the length, and a 503 for a token that was never configured.
- OAuth 2.0 multi-tenant mode, off by default, where every call runs under the consenting user's own identity.
- Rate limiting, retry and back-pressure from the Bitrix24 SDK's `RestrictionManager` on the standard tariff: a burst of 50, a drain of 2 a second, 3 retries.
- Log redaction of the webhook secret, applied to every client when it is constructed.
- An audit trail of OAuth and Bearer mutations, written as JSONL.
- A health endpoint, an image on GHCR, a reverse-proxy deployment set, and a smoke test that boots the container and checks the auth contract.
- A feedback tool that opens a GitHub issue from a session, capped at 5 attempts an hour per tenant.

Deliberately not true, and worth knowing before a change:

- The tool set covers the tasks domain. There is no CRM tool, and the specification says so rather than implying a roadmap.
- The OAuth deployment is single instance. The token cache and the refresh state are in memory.
- The predecessors of a task cannot be read back. Bitrix24 deprecated the endpoint that listed them and no documented select replaces it, so the operators look in the portal.
- A task is attributed to the webhook owner, not to the person who asked for it.
- The project sends no telemetry and keeps no analytics. The only outbound calls are to the portal and, when a feedback token is configured, to the GitHub Issues API.

## Brand Commitments

**Name:** bx24-template-mcp. The extension manifest shows it to the operator as "Bitrix24 (b24-mcp)", and the connector in a client is named by whoever deploys it.

**Tone:** plain and operational. A tool description tells the model what will happen to the portal, in the vocabulary of the portal. The landing page calls itself "An official starter by the Bitrix24 team", and the surface around it is built from the Bitrix24 component system, `@bitrix24/b24ui-nuxt`, with the semantic colour tokens rather than raw Tailwind colours.

**Failures are reported.** A refused deletion, a missing token, an unreadable deadline format: each produces a sentence the operator can act on, and an error code the operator can grep for in the log.

**A fork can rename itself.** `NUXT_BITRIX24_OAUTH_BRAND_STYLES` adds a minimal stylesheet under a per-response CSP nonce, and `NUXT_BITRIX24_OAUTH_APP_DISPLAY_NAME` changes the heading on the OAuth landing, so an operator can put their own name on the page without editing the template.

## Evidence on Hand

- 31 tool files under `server/mcp/tools/`, each with a unit test beside it in `tests/unit/tools/`.
- 70 Vitest files, 69 of them unit tests and one a live-portal integration test, plus an eval suite that measures tool selection against DeepSeek and a shell test for the deployment script.
- Three CI workflows: the pull request gate with commitlint, lint, typecheck, unit tests, a security audit, a compose validation, a Docker smoke test and two workflow analysers; the release workflow that publishes the image and the extension bundle on a tag; and a dependency drift check.
- The documentation set: architecture, deployment, runbook, security policy, security audit, evals, feedback, reverse proxy, manual test phrases.
- The agent skill set, with the template for a new tool and the persona walk.
- Released versions up to 0.3.0, and a changelog that records the breaking changes.

Absent, and not to be invented: no download counts, no usage numbers, no testimonials, no comparison with the other Bitrix24 MCP servers, and no claim about how many portals run this. It is a template, and a template has no user base to count.

## Product Principles

1. **One catalogue, three transports.** A tool is written once. The HTTP server finds it by glob, the extension registers it by hand, and a test fails the build when the two lists differ. The catalogue grows one tool per pull request.
2. **The description is the interface.** The model reads the Zod descriptions and the operator reads the error message. Both are written for the people who will see them, and both go through the persona walk before a tool ships.
3. **Destruction is gated.** A tool that wipes a record refuses until it has been told the operator agreed. The gate lives in the tool, not in the prompt.
4. **The secret never reaches a log.** Every client is wrapped in a redacting logger, the audit trail records a token hash rather than the token, and a dependency bump has to pass an audit before it merges.
5. **The simple path stays the default.** The webhook flow is what a fork inherits, and OAuth is opt-in and reversible. A change that turns the simple path into the complicated one has to earn it.

## Accessibility & Inclusion

- **The terminal is not part of the path.** The extension route exists so that an operator with no command line can install the product: one file, two clicks, the webhook in the OS keychain.
- **The description is written for the operator.** A person who has never seen a REST field name reads it through the model. The persona walk exists to catch a description that a developer reads as clear and an operator does not.
- **The portal's own vocabulary wins.** Status names, role names and the terms the portal uses, so nothing has to be translated a second time in the operator's head.
- **Install guides in Russian and Brazilian Portuguese.** The extension ships both, because Bitrix24 is strongest in Russia, in Brazil and in Latin America.
- **Errors name the next step.** A refusal says which target was refused and what the tool needs in order to proceed.

Not decided, and stated as open:

- **No contrast standard has been set for the landing page.** It is built from the Bitrix24 component system and renders on the dark brand surface, and no contrast audit has been run against it.
- **The OAuth landing has not been tested with a screen reader.** The pages are HTML with a strict CSP and no JavaScript, which helps, and no assistive technology has run against them.
- **There is no internationalisation layer.** The English tool descriptions, the Russian and Portuguese install guides and the portal-local deadline handling are the whole of the localisation story. A right-to-left operator is served by the portal, not by this project.
