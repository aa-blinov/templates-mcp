import { z } from 'zod'
import { defineFieldMergeTool } from '~/server/utils/define-field-merge-tool'
import { removeTags, toTagTitles } from '~/server/utils/task-tags'

/**
 * Remove tags from a task, leaving the rest in place.
 *
 * Bitrix24 REST: tasks.task.get + tasks.task.update (field `TAGS`)
 *
 * Mirror of `b24_task_tag_add`, and for the same reason: `TAGS` is written as
 * a whole set, so "drop the old release marker" through `b24_task_update`
 * means retyping every tag that should survive — and forgetting one is a
 * silent loss. Here the surviving set is computed from what the task actually
 * has.
 *
 * Built atop `defineFieldMergeTool` — see that file's doc.
 */
export default defineFieldMergeTool<string>({
  name: 'b24_task_tag_remove',
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description:
    'Remove one or more tags from a Bitrix24 task, keeping every other tag it has. Use it to retire a release marker ("R260916") or drop a priority tag without retyping the rest: `TAGS` is a whole-set field in Bitrix24, so removing one tag through `b24_task_update` means listing all the survivors and losing whatever you forget. Names are matched case-insensitively; names the task does not carry are reported in `notPresent` and change nothing. Tags are per project, so removal always applies to this task’s own project. Read tags with `b24_task_list` (`select: ["tags"]`), see what a project uses with `b24_task_tag_list`, add them with `b24_task_tag_add`. Bitrix24 indexes the tag filter with a short lag: a task tagged a second ago may not show up in `filter: {tag: …}` for a few seconds, so verify a fresh write by reading the task rather than by searching for it.',
  taskIdDescribe: 'Task to untag, e.g. from `b24_task_list`.',
  itemFieldName: 'tags',
  itemSchema: z.string().min(1),
  itemDescribe: 'Tag title to drop, or a list of them: "R260916", ["P1", "R260916"]. Matched case-insensitively against the tags the task has.',
  wireField: 'TAGS',
  resultKey: 'tags',
  parse: toTagTitles,
  merge: removeTags,
  verb: 'remove',
  equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
})
