import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { removeTags, toTagTitles } from '~/server/utils/task-tags'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

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
 */

interface TaskTagsEnvelope {
  task?: { id?: string | number, title?: string, tags?: unknown, TAGS?: unknown }
}

export default defineMcpTool({
  name: 'b24_task_tag_remove',
  description:
    'Remove one or more tags from a Bitrix24 task, keeping every other tag it has. Use it to retire a release marker ("R260916") or drop a priority tag without retyping the rest: `TAGS` is a whole-set field in Bitrix24, so removing one tag through `b24_task_update` means listing all the survivors and losing whatever you forget. Names are matched case-insensitively; names the task does not carry are reported in `notPresent` and change nothing. Tags are per project, so removal always applies to this task’s own project. Read tags with `b24_task_list` (`select: ["tags"]`), see what a project uses with `b24_task_tag_list`, add them with `b24_task_tag_add`. Bitrix24 indexes the tag filter with a short lag: a task tagged a second ago may not show up in `filter: {tag: …}` for a few seconds, so verify a fresh write by reading the task rather than by searching for it.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to untag, e.g. from `b24_task_list`.'),
    tags: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .describe('Tag title to drop, or a list of them: "R260916", ["P1", "R260916"]. Matched case-insensitively against the tags the task has.'),
  },
  handler: async ({ taskId, tags }) => {
    const outgoing = typeof tags === 'string' ? [tags] : tags
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
    const { next, changed } = removeTags(before, outgoing)

    if (changed.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { removed: [], notPresent: outgoing, taskId, title: task.title ?? null, tags: before },
              null,
              2,
            ),
          },
        ],
      }
    }

    // An empty array is how Bitrix24 is told "no tags at all"; it accepts it
    // and clears the field, which is the honest result of removing the last
    // tag rather than something to refuse.
    const updated = await callV2<TaskTagsEnvelope>(
      b24,
      'tasks.task.update',
      { taskId, fields: { TAGS: next } },
      `Failed to remove tags from Bitrix24 task ${taskId}`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              removed: changed,
              notPresent: outgoing.filter((tag) => !changed.some((c) => c.toLowerCase() === tag.toLowerCase())),
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
