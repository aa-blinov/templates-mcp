import { z } from 'zod'
import { defineFieldMergeTool } from '~/server/utils/define-field-merge-tool'
import { removeAuditors, toAuditorIds } from '~/server/utils/task-auditors'

/**
 * Remove observers (auditors) from a task, leaving the rest in place.
 *
 * Bitrix24 REST: tasks.task.get + tasks.task.update (field `AUDITORS`)
 *
 * Mirror of `b24_task_auditor_add` / `b24_task_tag_remove` — same
 * read-modify-write reasoning, see `server/utils/task-auditors.ts`.
 * Issue #113.
 *
 * Built atop `defineFieldMergeTool` — see that file's doc.
 */
export default defineFieldMergeTool<number>({
  name: 'b24_task_auditor_remove',
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description:
    'Remove one or more observers (auditors / наблюдатели) from a Bitrix24 task, keeping everyone else watching. `AUDITORS` is a whole-set field in Bitrix24, so removing one observer through `b24_task_update` means listing all the survivors and losing whoever you forget. Ids the task does not have as observers are reported in `notPresent` and change nothing. Removing the last observer clears the field, not an error.',
  taskIdDescribe: 'Task to remove observers from, e.g. from `b24_task_list`.',
  itemFieldName: 'auditorId',
  itemSchema: z.number().int().positive(),
  itemDescribe: 'User id to stop watching the task, or a list of them: 47, [12, 47].',
  wireField: 'AUDITORS',
  resultKey: 'auditors',
  parse: toAuditorIds,
  merge: removeAuditors,
  verb: 'remove',
})
