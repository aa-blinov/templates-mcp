import {
  type ActionToolInput,
  assertConfirmedDelete,
  confirmDeleteSchema,
  defineActionTool,
  forceFlagSchema,
  idOrIdArraySchema,
  mapBatchRows,
} from '~/server/utils/define-action-tool'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { batchV2, callV2 } from '~/server/utils/sdk-helpers'

/**
 * Delete a whole Bitrix24 task. Single or batch. Destructive — no undo.
 *
 * Bitrix24 REST: tasks.task.delete (v2 — no v3 equivalent)
 *   https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-delete.html
 *
 * Only the task creator or a portal admin can delete; anyone else gets
 * ACCESSDENIEDEXCEPTION from Bitrix24 (propagated as-is via callV2/batchV2,
 * not translated — the operator sees exactly what Bitrix24 said).
 *
 * SKILL.md Rule #9: requires `confirmDelete: true`. Built atop
 * `defineActionTool`, same shape as `b24_task_elapsed_time_delete` /
 * `b24_task_dependency_remove` — single id or an array (batch, cap 50,
 * `force: true` to override), one `{ batch, total, ok, failed, results }`
 * summary for batch mode.
 *
 * Issue #130.
 */

const DEFAULT_BATCH_CAP = 50
const USAGE_NOTES =
  ` Accepts a single task id OR an array of ids (batch mode, up to ${DEFAULT_BATCH_CAP} — pass \`force: true\` to override). Batch mode goes through one HTTP round-trip and returns a \`{ batch, total, ok, failed, results }\` summary; per-id errors do not abort the batch. If the operator names a task in free text, resolve it via \`b24_task_list\` (\`filter: {"%title": "..."}\`) first.`

interface DeleteTaskInput extends ActionToolInput {
  taskId: number | number[]
  confirmDelete?: boolean
}

interface DeleteTaskBatchRow {
  taskId: number
  ok: boolean
  error?: string
}

export default defineActionTool<DeleteTaskInput, DeleteTaskBatchRow>({
  name: 'b24_task_delete',
  description:
    'Permanently delete a Bitrix24 task. Destructive — there is no undo (use `b24_task_defer` instead if the operator just wants the task out of active lists but recoverable). REQUIRES `confirmDelete: true` (SKILL.md Ground Rule #9 — every delete needs explicit operator agreement, e.g. "да, удали"; "посмотри"/"проверь" is NOT consent). Only the task creator or a portal admin can delete a task; anyone else gets an access-denied error from Bitrix24.',
  usageNotes: USAGE_NOTES,
  pastTense: 'deleted',
  batchCap: DEFAULT_BATCH_CAP,
  inputSchema: {
    taskId: idOrIdArraySchema.describe(
      'Task id from `b24_task_list` / `b24_task_create`, or an array of ids for batch mode. Pass a number for single-task semantics; even a one-element array (e.g. [42]) enters batch mode and returns the batch summary shape.',
    ),
    confirmDelete: confirmDeleteSchema(),
    force: forceFlagSchema(DEFAULT_BATCH_CAP),
  },
  extractIds: (input) => input.taskId,
  runOne: (input, taskId) => runOne(taskId, input.confirmDelete ?? false),
  runBatch: (input, ids) => runBatch(ids, input.confirmDelete ?? false),
})

function describeTarget(taskId: number | number[]): string {
  return Array.isArray(taskId) ? `${taskId.length} tasks [${taskId.join(', ')}]` : `task ${taskId}`
}

async function runOne(taskId: number, confirmDelete: boolean) {
  assertConfirmedDelete('b24_task_delete', describeTarget(taskId), confirmDelete)
  const b24 = useBitrix24Tenant()
  await callV2<boolean>(b24, 'tasks.task.delete', { taskId }, `Failed to delete Bitrix24 task ${taskId}`)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ deleted: true, taskId }),
      },
    ],
  }
}

async function runBatch(taskIds: number[], confirmDelete: boolean): Promise<DeleteTaskBatchRow[]> {
  assertConfirmedDelete('b24_task_delete', describeTarget(taskIds), confirmDelete)
  const b24 = useBitrix24Tenant()
  const rows = await batchV2<boolean>(
    b24,
    taskIds.map((id) => ['tasks.task.delete', { taskId: id }]),
    `Failed to delete a batch of ${taskIds.length} task(s)`,
  )

  return mapBatchRows(rows, taskIds, 'taskId', ({ id, ok, errorMessages }) => {
    if (!ok) {
      return { taskId: id, ok: false, error: errorMessages.join('; ') || `Failed to delete Bitrix24 task ${id}` }
    }
    return { taskId: id, ok: true }
  })
}
