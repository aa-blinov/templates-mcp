import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { TaskListEnvelope } from '~/server/types/bitrix24'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { summarizeTaskTime } from '~/server/utils/task-time'
import {
  normalizeBitrix24Filter,
  normalizeBitrix24Select,
  toTaskShort,
  type TaskShort,
} from '~/server/utils/tasks'

const SELECT_CAMEL = ['id', 'title', 'status', 'groupId', 'closedDate', 'timeSpentInLogs']
const SELECT_WIRE = normalizeBitrix24Select(SELECT_CAMEL)

/** Bitrix24 serves 50 tasks per page. The cap guards against a runaway loop
 *  on a portal with an unexpectedly large project (200 pages = 10 000 tasks). */
const PAGE_SIZE = 50
const MAX_PAGES = 200

/**
 * Every task of one project with the hours logged on it.
 *
 * Bitrix24 REST: tasks.task.list (v2), paged by `start`. The hours come from
 * the task's own `TIME_SPENT_IN_LOGS`, which is the sum of all its
 * `task.elapseditem` entries, so no per-task elapsed-time call is needed.
 * `b24_task_elapsed_time_list` has no project filter and no `total`, which is
 * why a project report is built here and not from that tool.
 */
export default defineMcpTool({
  name: 'b24_group_task_time_list',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'List every task of one project (Bitrix24 group) with the hours logged on it: open and closed tasks, and tasks with no time (they come back with 0). Hours are the sum of all time entries on the task from all users. Each row has id, title, status, closedDate (null while open), timeSpentSeconds and hours. Returns totalHours for the whole project. Use this for a project time report instead of calling b24_task_elapsed_time_list task by task.',
  inputSchema: {
    groupId: z
      .number()
      .int()
      .positive()
      .describe('Project (Bitrix24 group) id, e.g. 95. Use b24_group_find to get it from a name.'),
  },
  handler: async ({ groupId }) => {
    const b24 = useBitrix24Tenant()
    const tasks: TaskShort[] = []
    const filter = normalizeBitrix24Filter({ groupId })

    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * PAGE_SIZE
      const data = await callV2<TaskListEnvelope>(
        b24,
        'tasks.task.list',
        { filter, order: { ID: 'ASC' }, select: SELECT_WIRE, start },
        'Failed to list project tasks',
      )
      const batch = (data?.tasks ?? [])
        .map((task) => toTaskShort(task))
        .filter((t): t is TaskShort => t !== null)
      tasks.push(...batch)

      const total = data?.total
      const reachedTotal = typeof total === 'number' && start + PAGE_SIZE >= total
      if (batch.length === 0 || reachedTotal) break
    }

    const summary = summarizeTaskTime(tasks)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            groupId,
            returned: summary.rows.length,
            totalHours: summary.totalHours,
            tasks: summary.rows,
          }),
        },
      ],
    }
  },
})
