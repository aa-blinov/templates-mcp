import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { type StageRaw, toStageList } from '~/server/utils/task-stages'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * List the kanban columns of a project (or of the operator's personal board).
 *
 * Bitrix24 REST: task.stages.get
 *   https://apidocs.bitrix24.com/api-reference/tasks/stages/task-stages-get.html
 *
 * This is the missing half of `stageId`: `b24_task_list` can return the id a
 * task sits in, but the id is meaningless without the board — "757" is
 * "Ждёт релиза" in one project and nothing in another. Call this once per
 * project and the agent can talk about columns by name.
 */

export default defineMcpTool({
  name: 'b24_task_stage_list',
  description:
    'List the kanban columns (stages) of a Bitrix24 project — id, title, order, colour, and the `systemType` marker Bitrix24 puts on the first ("NEW") and finishing ("FINISH") columns. Pass `groupId` for a project board, or omit it for the personal kanban of the account the server acts as. Use this to turn the `stageId` returned by `b24_task_list` into a column name, and to find the id (or exact title) to pass to `b24_task_stage_move`. Stages are per-project: two projects have different column sets, and an id from one board is not valid on another.',
  inputSchema: {
    groupId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Project (workgroup) id whose board to read, e.g. from a task’s `groupId`. Omit for the personal kanban of the current account.'),
  },
  handler: async ({ groupId }) => {
    const b24 = useBitrix24Tenant()
    // `task.stages.get` takes the board as entityId; the personal kanban is
    // the default when nothing is passed.
    const params = groupId === undefined ? {} : { entityId: groupId }
    const result = await callV2<Record<string, StageRaw>>(
      b24,
      'task.stages.get',
      params,
      groupId === undefined
        ? 'Failed to read the personal Bitrix24 kanban stages'
        : `Failed to read the kanban stages of Bitrix24 project ${groupId}`,
    )
    const stages = toStageList(result)
    if (stages.length === 0) {
      throw new Bitrix24ToolError(
        groupId === undefined
          ? 'The personal kanban has no stages — the account may never have opened it.'
          : `Project ${groupId} has no kanban stages. Check the id: a project without a task board returns an empty set.`,
        Bitrix24ErrorCode.INVALID_INPUT,
      )
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { board: groupId === undefined ? 'personal' : `group:${groupId}`, returned: stages.length, stages },
            null,
            2,
          ),
        },
      ],
    }
  },
})
