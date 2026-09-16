import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { removeAuditors, toAuditorIds } from '~/server/utils/task-auditors'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * Remove observers (auditors) from a task, leaving the rest in place.
 *
 * Bitrix24 REST: tasks.task.get + tasks.task.update (field `AUDITORS`)
 *
 * Mirror of `b24_task_auditor_add` / `b24_task_tag_remove` — same
 * read-modify-write reasoning, see `server/utils/task-auditors.ts`.
 * Issue #113.
 */

interface TaskAuditorsEnvelope {
  task?: { id?: string | number, title?: string, auditors?: unknown, AUDITORS?: unknown }
}

export default defineMcpTool({
  name: 'b24_task_auditor_remove',
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description:
    'Remove one or more observers (auditors / наблюдатели) from a Bitrix24 task, keeping everyone else watching. `AUDITORS` is a whole-set field in Bitrix24, so removing one observer through `b24_task_update` means listing all the survivors and losing whoever you forget. Ids the task does not have as observers are reported in `notPresent` and change nothing. Removing the last observer clears the field, not an error.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to remove observers from, e.g. from `b24_task_list`.'),
    auditorId: z
      .union([z.number().int().positive(), z.array(z.number().int().positive()).min(1)])
      .describe('User id to stop watching the task, or a list of them: 47, [12, 47].'),
  },
  handler: async ({ taskId, auditorId }) => {
    const outgoing = Array.isArray(auditorId) ? auditorId : [auditorId]
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
    const { next, changed } = removeAuditors(before, outgoing)

    if (changed.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ removed: [], notPresent: outgoing, taskId, title: task.title ?? null, auditors: before }),
          },
        ],
      }
    }

    // An empty array is how Bitrix24 is told "no observers at all"; it
    // accepts it and clears the field — the honest result of removing the
    // last one, not something to refuse.
    const updated = await callV2<TaskAuditorsEnvelope>(
      b24,
      'tasks.task.update',
      { taskId, fields: { AUDITORS: next } },
      `Failed to remove observers from Bitrix24 task ${taskId}`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            removed: changed,
            notPresent: outgoing.filter((id) => !changed.includes(id)),
            taskId,
            title: task.title ?? null,
            auditors: toAuditorIds(updated?.task?.auditors ?? updated?.task?.AUDITORS ?? next),
          }),
        },
      ],
    }
  },
})
