import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { TaskListEnvelope } from '~/server/types/bitrix24'
import { tagUsage, toTagTitles } from '~/server/utils/task-tags'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * Which tags are actually in use in a project.
 *
 * Bitrix24 REST: tasks.task.list (select `TAGS`)
 *
 * There is no tag catalogue to read: `tasks.task.tag.list` answers
 * `Could not find description of list in …Task\Tag`, and the legacy
 * `task.tags.*` family is gone. So the vocabulary is derived from the tasks —
 * which is also the more honest answer to "what release markers do we use",
 * since a tag nobody put on a task does not matter.
 *
 * Tags are per project (the same title is a different tag id on another
 * board), which is why this tool asks for one project rather than answering
 * portal-wide.
 */

/** Tasks per page; Bitrix24 caps `tasks.task.list` at 50. */
const PAGE = 50
/** How many pages to walk. 10 × 50 covers a project's open backlog. */
const MAX_PAGES = 10

export default defineMcpTool({
  name: 'b24_task_tag_list',
  description:
    'List the tags actually used in a Bitrix24 project, with how many tasks carry each — the way to find out which release markers ("R260916") and priorities ("P1") a team is running. Bitrix24 has no tag catalogue in REST, so the list is aggregated from the project\'s tasks: pass `groupId`, and optionally `includeClosed` to count completed tasks too (off by default, so you see what is live). Tags are per project — the same title is a different tag on another board — so ask per project rather than expecting a portal-wide answer. `scannedTasks` says how many tasks the answer is based on and `truncated` whether the walk stopped early. Change tags with `b24_task_tag_add` / `b24_task_tag_remove`; find tasks by one with `b24_task_list` and `filter: {tag: "P1"}`.',
  inputSchema: {
    groupId: z.number().int().positive().describe('Project (workgroup) id whose tags to collect.'),
    includeClosed: z
      .boolean()
      .optional()
      .describe('Count completed tasks as well. Default false — the answer then describes the live backlog.'),
  },
  handler: async ({ groupId, includeClosed }) => {
    const b24 = useBitrix24Tenant()
    const filter: Record<string, unknown> = { GROUP_ID: groupId }
    if (includeClosed !== true) filter['!STATUS'] = 5

    const perTask: string[][] = []
    let truncated = false
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await callV2<TaskListEnvelope>(
        b24,
        'tasks.task.list',
        { filter, select: ['ID', 'TAGS'], order: { ID: 'desc' }, start: page * PAGE },
        `Failed to collect the tags of Bitrix24 project ${groupId}`,
      )
      const tasks = data?.tasks ?? []
      if (tasks.length === 0) break
      for (const task of tasks) {
        const raw = task as Record<string, unknown>
        perTask.push(toTagTitles(raw.tags ?? raw.TAGS))
      }
      if (tasks.length < PAGE) break
      if (page === MAX_PAGES - 1) truncated = true
    }

    const tags = tagUsage(perTask)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              groupId,
              includeClosed: includeClosed === true,
              scannedTasks: perTask.length,
              truncated,
              returned: tags.length,
              tags,
            },
            null,
            2,
          ),
        },
      ],
    }
  },
})
