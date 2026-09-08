import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { addTags, toTagTitles } from '~/server/utils/task-tags'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

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
 */

interface TaskTagsEnvelope {
  task?: { id?: string | number, title?: string, tags?: unknown, TAGS?: unknown }
}

export default defineMcpTool({
  name: 'b24_task_tag_add',
  description:
    'Add one or more tags to a Bitrix24 task, keeping the tags it already has. Tags are how a team marks priority ("P1") and the release a task belongs to ("R260916"), and `TAGS` is a whole-set field in Bitrix24 — writing it through `b24_task_update` silently drops every tag not in the payload. This tool reads the current set first, merges, and writes the union back, so nothing is lost. Tags that are already there are reported in `alreadyPresent` and not written twice; comparison is case-insensitive. Read tags with `b24_task_list` (`select: ["tags"]`) and find tasks by one with `filter: {tag: "P1"}`. Bitrix24 indexes the tag filter with a short lag: a task tagged a second ago may not show up in `filter: {tag: …}` for a few seconds, so verify a fresh write by reading the task rather than by searching for it.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to tag, e.g. from `b24_task_list`.'),
    tags: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .describe('Tag title, or a list of them: "P1", ["P1", "R260916"]. Titles are what Bitrix24 shows; a tag that does not exist yet is created by the write.'),
  },
  handler: async ({ taskId, tags }) => {
    const incoming = typeof tags === 'string' ? [tags] : tags
    const b24 = useBitrix24Tenant()

    const current = await callV2<TaskTagsEnvelope>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'TITLE', 'TAGS'] },
      `Failed to read the tags of Bitrix24 task ${taskId}`,
    )
    const task = current?.task
    if (!task) {
      throw new Bitrix24ToolError(`Bitrix24 task ${taskId} not found.`, Bitrix24ErrorCode.INVALID_INPUT)
    }
    const before = toTagTitles(task.tags ?? task.TAGS)
    const { next, changed } = addTags(before, incoming)

    if (changed.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { added: [], alreadyPresent: incoming, taskId, title: task.title ?? null, tags: before },
              null,
              2,
            ),
          },
        ],
      }
    }

    const updated = await callV2<TaskTagsEnvelope>(
      b24,
      'tasks.task.update',
      { taskId, fields: { TAGS: next } },
      `Failed to add tags to Bitrix24 task ${taskId}`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              added: changed,
              alreadyPresent: incoming.filter((tag) => !changed.includes(tag)),
              taskId,
              title: task.title ?? null,
              tags: toTagTitles(updated?.task?.tags ?? updated?.task?.TAGS ?? next),
            },
            null,
            2,
          ),
        },
      ],
    }
  },
})
