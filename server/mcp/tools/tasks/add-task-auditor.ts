import { z } from 'zod'
import { defineFieldMergeTool } from '~/server/utils/define-field-merge-tool'
import { addAuditors, toAuditorIds } from '~/server/utils/task-auditors'

/**
 * Add observers (auditors) to a task without losing the ones already on it.
 *
 * Bitrix24 REST: tasks.task.get + tasks.task.update (field `AUDITORS`)
 *
 * `AUDITORS` is a whole-set field: writing `[47]` onto a task watched by 12
 * and 47 drops 12. This tool reads the current set, merges, and writes the
 * union back — mirror of `b24_task_tag_add`, same reasoning, see
 * `server/utils/task-auditors.ts`. Issue #113.
 *
 * Built atop `defineFieldMergeTool` — see that file's doc for why (mirror of
 * `b24_task_tag_add`, same read-merge-write shape, different value type).
 */
export default defineFieldMergeTool<number>({
  name: 'b24_task_auditor_add',
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description:
    'Add one or more observers (auditors / наблюдатели) to a Bitrix24 task, keeping the observers it already has. `AUDITORS` is a whole-set field in Bitrix24 — writing it through `b24_task_update` silently drops everyone not in the payload. This tool reads the current set first, merges, and writes the union back, so nobody is dropped. Ids already watching are reported in `alreadyPresent` and not written twice. Resolve a name to an id with `b24_user_find` first.',
  taskIdDescribe: 'Task to add observers to, e.g. from `b24_task_list`.',
  itemFieldName: 'auditorId',
  itemSchema: z.number().int().positive(),
  itemDescribe: 'User id to add as an observer, or a list of them: 47, [12, 47]. Resolve via `b24_user_find`.',
  wireField: 'AUDITORS',
  resultKey: 'auditors',
  parse: toAuditorIds,
  merge: addAuditors,
  verb: 'add',
})
