import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import {
  describeStages,
  resolveStage,
  type StageRaw,
  toStageList,
} from '~/server/utils/task-stages'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Move a task between kanban columns — by column name, not by opaque id.
 *
 * Bitrix24 REST: task.stages.movetask
 *   https://apidocs.bitrix24.com/api-reference/tasks/stages/task-stages-move-task.html
 *
 * Why the tool does three calls instead of one:
 *
 *   - a stage id is only valid on its own board, and boards are per project,
 *     so the task's `groupId` has to be read before anything can be resolved;
 *   - operators say "перенеси в Ждёт релиза", not "STAGE_ID 757", and the
 *     mapping name → id lives in the project's board;
 *   - a stage from a different project is the classic silent failure here,
 *     so membership is verified rather than assumed.
 *
 * A task already in the requested column is reported as `moved: false`
 * instead of being pushed through the API again: re-moving is not free, it
 * bumps the task's activity for everyone watching the board.
 *
 * `STAGE_ID` via `b24_task_update` also works, but only when the caller
 * already knows the numeric id and that it belongs to the right board. This
 * tool is the one to reach for.
 */

interface TaskEnvelope {
  task?: {
    id?: string | number
    title?: string
    groupId?: string | number
    stageId?: string | number
  }
}

export default defineMcpTool({
  name: 'b24_task_stage_move',
  description:
    'Move a Bitrix24 task to another kanban column (stage), naming the column the way a person does. `stage` accepts the column title ("Ждёт релиза", case- and ё/е-insensitive, a unique prefix is enough) or its numeric id from `b24_task_stage_list`. The tool reads the task, resolves the name against the board of the task\'s own project, and refuses a column that belongs to a different project — the classic silent failure of `STAGE_ID` writes. A task already in that column comes back as `moved: false` without touching the API, so it does not bump activity on the board for everyone watching. An unknown or ambiguous name comes back as an error listing the real columns instead of guessing. Returns the task id, project, and the column before and after the move. Note that a kanban column is not the same thing as task status: use `b24_task_complete` / `b24_task_start` for the lifecycle, this tool for the board.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to move, e.g. from `b24_task_list`.'),
    stage: z
      .union([z.string().min(1), z.number().int().positive()])
      .describe('Target column: its title ("Ждёт релиза", "готово") or its numeric id from `b24_task_stage_list`. Titles match case-insensitively, ё/е alike, and a unique prefix is accepted.'),
  },
  handler: async ({ taskId, stage }) => {
    const b24 = useBitrix24Tenant()

    const taskData = await callV2<TaskEnvelope>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'TITLE', 'GROUP_ID', 'STAGE_ID'] },
      `Failed to read Bitrix24 task ${taskId}`,
    )
    const task = taskData?.task
    if (!task) {
      throw new Bitrix24ToolError(`Bitrix24 task ${taskId} not found.`, Bitrix24ErrorCode.INVALID_INPUT)
    }
    const groupId = toNumber(task.groupId)
    const currentStageId = toNumber(task.stageId)

    const stagesRaw = await callV2<Record<string, StageRaw>>(
      b24,
      'task.stages.get',
      // A task outside any project lives on the operator's personal kanban,
      // which `task.stages.get` returns when no entity is passed.
      groupId === null || groupId === 0 ? {} : { entityId: groupId },
      `Failed to read the kanban stages for Bitrix24 task ${taskId}`,
    )
    const stages = toStageList(stagesRaw)
    if (stages.length === 0) {
      throw new Bitrix24ToolError(
        `No kanban stages found for task ${taskId}`
        + `${groupId ? ` (project ${groupId})` : ' (personal kanban)'} — nothing to move it between.`,
        Bitrix24ErrorCode.INVALID_INPUT,
      )
    }

    const resolution = resolveStage(stages, stage)
    if (!resolution.ok) {
      const board = groupId ? `project ${groupId}` : 'the personal kanban'
      const detail
        = resolution.reason === 'ambiguous-title'
          ? `"${stage}" matches several columns of ${board}: ${describeStages(resolution.matches)}. Name one exactly.`
          : `"${stage}" is not a column of ${board}. Columns are: ${describeStages(stages)}.`
      throw new Bitrix24ToolError(detail, Bitrix24ErrorCode.INVALID_INPUT)
    }

    const target = resolution.stage
    const from = stages.find((s) => s.id === currentStageId) ?? null

    if (currentStageId === target.id) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                moved: false,
                reason: 'already-in-stage',
                taskId,
                title: task.title ?? null,
                groupId,
                stage: { id: target.id, title: target.title },
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    await callV2<unknown>(
      b24,
      'task.stages.movetask',
      { id: taskId, stageId: target.id },
      `Failed to move Bitrix24 task ${taskId} to stage ${target.id}`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              moved: true,
              taskId,
              title: task.title ?? null,
              groupId,
              from: from ? { id: from.id, title: from.title } : { id: currentStageId, title: null },
              to: { id: target.id, title: target.title },
            },
            null,
            2,
          ),
        },
      ],
    }
  },
})
