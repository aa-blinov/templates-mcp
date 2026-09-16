import { z } from 'zod'
import { defineFieldMergeTool } from '~/server/utils/define-field-merge-tool'
import { addTags, toTagTitles } from '~/server/utils/task-tags'

/**
 * Add tags to a task without losing the ones already on it.
 *
 * Bitrix24 REST: tasks.task.get + tasks.task.update (field `TAGS`)
 *
 * `TAGS` is a whole-set field: writing `["R260923"]` onto a task tagged `P1`
 * and `R260916` drops both. Teams keep the priority and the release marker in
 * exactly those tags, so a naive write quietly loses the two things a release
 * is planned by. This tool reads the current set, merges, and writes the union
 * back — and reports which tags it actually added.
 *
 * Built atop `defineFieldMergeTool` — see that file's doc for why (mirror of
 * `b24_task_auditor_add`, same read-merge-write shape, different value type).
 */
export default defineFieldMergeTool<string>({
  name: 'b24_task_tag_add',
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description:
    'Add one or more tags to a Bitrix24 task, keeping the tags it already has. Tags are how a team marks priority ("P1") and the release a task belongs to ("R260916"), and `TAGS` is a whole-set field in Bitrix24 — writing it through `b24_task_update` silently drops every tag not in the payload. This tool reads the current set first, merges, and writes the union back, so nothing is lost. Tags that are already there are reported in `alreadyPresent` and not written twice; comparison is case-insensitive. Tags are per project: the same title is a different tag on another board, so titles are the handle everywhere here and a tag added to this task lands in this task’s project. Read tags with `b24_task_list` (`select: ["tags"]`), see what a project uses with `b24_task_tag_list`, and find tasks by one with `filter: {tag: "P1"}` — that filter matches by title and therefore crosses projects unless you add `groupId`. Bitrix24 indexes the tag filter with a short lag: a task tagged a second ago may not show up in `filter: {tag: …}` for a few seconds, so verify a fresh write by reading the task rather than by searching for it.',
  taskIdDescribe: 'Task to tag, e.g. from `b24_task_list`.',
  itemFieldName: 'tags',
  itemSchema: z.string().min(1),
  itemDescribe: 'Tag title, or a list of them: "P1", ["P1", "R260916"]. Titles are what Bitrix24 shows; a tag that does not exist yet is created by the write.',
  wireField: 'TAGS',
  resultKey: 'tags',
  parse: toTagTitles,
  merge: addTags,
  verb: 'add',
  equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
})
