import { defineMcpResource } from '@nuxtjs/mcp-toolkit/server'

/**
 * Cross-tool orchestration guidance for building up a task step by step and
 * for the "прими задачу" accept/approve ambiguity — addresses issue #107.
 *
 * Content lives in `docs/TASK-WORKFLOW-PLAYBOOK.md` (kept as a real doc file
 * so it's readable/reviewable on its own, not just through the MCP). Served
 * as an MCP **resource**, deliberately not folded into a tool description:
 * tool descriptions are sent to the model on every single turn (this
 * server's 47 tools already cost ~6.6K tokens there), while a resource is
 * fetched on demand via `resources/read`. `b24_task_create`'s description
 * points here so an agent about to build a task up has something to follow.
 *
 * HTTP build only — `server/mcp/resources/**` is auto-discovered by
 * `@nuxtjs/mcp-toolkit` the same way `server/mcp/tools/**` is (see the
 * module's `resources: [\`${mcpDir}/resources\`]` scan config). The stdio/DXT
 * bundle (`mcp-stdio/`) has no equivalent — `mcp-stdio/register.ts` only
 * ports tool registration (`registerToolFromDefinition`), not resources, so
 * this doc is unreachable from the DXT bundle today. Porting
 * `registerResourceFromDefinition` there (plus a Nuxt-context-free file
 * read) is a separate, larger piece of work than adding one playbook.
 */
export default defineMcpResource({
  uri: 'bx24://docs/task-workflow-playbook',
  name: 'task-workflow-playbook',
  title: 'Task workflow playbook',
  description:
    'How Bitrix24 task tools compose into workflows: the order to build a task up in (create → checklist/results/elapsed-time/tags/auditors/files/dependencies), and which tool "прими задачу" actually means (creator approving finished work vs. the not-yet-shipped assignment-accept flow). Read this before orchestrating more than one task tool in a row.',
  metadata: { mimeType: 'text/markdown' },
  file: 'docs/TASK-WORKFLOW-PLAYBOOK.md',
})
