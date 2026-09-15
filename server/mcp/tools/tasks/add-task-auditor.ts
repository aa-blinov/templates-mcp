import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { addAuditors, toAuditorIds } from '~/server/utils/task-auditors'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * Add observers (auditors) to a task without losing the ones already on it.
 *
 * Bitrix24 REST: tasks.task.get + tasks.task.update (field `AUDITORS`)
 *
 * `AUDITORS` is a whole-set field: writing `[47]` onto a task watched by 12
 * and 47 drops 12. This tool reads the current set, merges, and writes the
 * union back — mirror of `b24_task_tag_add`, same reasoning, see
 * `server/utils/task-auditors.ts`. Issue #113.
 */

interface TaskAuditorsEnvelope {
  task?: { id?: string | number, title?: string, auditors?: unknown, AUDITORS?: unknown }
}

export default defineMcpTool({
  name: 'b24_task_auditor_add',
  description:
    'Add one or more observers (auditors / наблюдатели) to a Bitrix24 task, keeping the observers it already has. `AUDITORS` is a whole-set field in Bitrix24 — writing it through `b24_task_update` silently drops everyone not in the payload. This tool reads the current set first, merges, and writes the union back, so nobody is dropped. Ids already watching are reported in `alreadyPresent` and not written twice. Resolve a name to an id with `b24_user_find` first.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to add observers to, e.g. from `b24_task_list`.'),
    auditorId: z
      .union([z.number().int().positive(), z.array(z.number().int().positive()).min(1)])
      .describe('User id to add as an observer, or a list of them: 47, [12, 47]. Resolve via `b24_user_find`.'),
  },
  handler: async ({ taskId, auditorId }) => {
    const incoming = Array.isArray(auditorId) ? auditorId : [auditorId]
    const b24 = useBitrix24Tenant()

    const current = await callV2<TaskAuditorsEnvelope>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'TITLE', 'AUDITORS'] },
      `Failed to read the observers of Bitrix24 task ${taskId}`,
    )
    const task = current?.task
    if (!task) {
      throw new Bitrix24ToolError(`Bitrix24 task ${taskId} not found.`, Bitrix24ErrorCode.INVALID_INPUT)
    }
    const before = toAuditorIds(task.auditors ?? task.AUDITORS)
    const { next, changed } = addAuditors(before, incoming)

    if (changed.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ added: [], alreadyPresent: incoming, taskId, title: task.title ?? null, auditors: before }),
          },
        ],
      }
    }

    const updated = await callV2<TaskAuditorsEnvelope>(
      b24,
      'tasks.task.update',
      { taskId, fields: { AUDITORS: next } },
      `Failed to add observers to Bitrix24 task ${taskId}`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            added: changed,
            alreadyPresent: incoming.filter((id) => !changed.includes(id)),
            taskId,
            title: task.title ?? null,
            auditors: toAuditorIds(updated?.task?.auditors ?? updated?.task?.AUDITORS ?? next),
          }),
        },
      ],
    }
  },
})
