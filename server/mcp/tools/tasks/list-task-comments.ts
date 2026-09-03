import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toTaskCommentShort, type TaskCommentShort } from '~/server/utils/task-comments'

/**
 * Read the comment thread of a Bitrix24 task.
 *
 * Bitrix24 REST: task.commentitem.getlist (v2 — no working v3 equivalent;
 * `tasks.task.chat.message.list` returns an empty body on webhook auth)
 *   https://apidocs.bitrix24.com/api-reference/tasks/comment-item/task-comment-item-get-list.html
 *
 * Wire facts verified against the live portal (2026-09-02):
 *   - The endpoint accepts ONLY `TASKID`. Passing `ORDER` (or `FILTER`)
 *     fails the whole call with `ERROR_CORE` /
 *     `TASKS_ERROR_EXCEPTION_#8 … ACTION_FAILED_TO_BE_PROCESSED`, so sorting,
 *     author filtering and paging are all done locally on the full thread.
 *     Threads are small (tens of comments per task), so the one round-trip
 *     is cheap; do NOT "optimise" this by pushing params onto the wire.
 *   - Items ship `AUTHOR_ID` **and** `AUTHOR_NAME`, so attribution needs no
 *     follow-up `user.get`.
 *   - A task the webhook user cannot read answers `ERROR_CORE` too — the
 *     error text is forwarded as-is by `callV2`.
 *   - Bitrix24 posts its own lifecycle notes ("Задача завершена.", "Крайний
 *     срок изменен на: …", "<user>, вы назначены соисполнителем.") into the
 *     same thread, authored by whoever triggered the change. There is no
 *     REST flag separating them from human comments, so the tool returns
 *     them verbatim rather than guessing — the description tells the agent
 *     to judge by the text.
 *
 * Comment bodies are returned in full: never truncated, never summarised.
 */

export default defineMcpTool({
  name: 'b24_task_comment_list',
  description:
    'Read the comment thread on a Bitrix24 task — who wrote what, and when. Returns every comment in full (BBCode body verbatim, never truncated) with authorId + authorName, so attribution is explicit without a second lookup. Default order is oldest-first, i.e. the thread reads as a conversation; pass order: "desc" for newest-first. Narrow to one person with `authorId` (get the id from `b24_user_find`), and bound a long thread with `limit` / `offset` — those drop whole comments, they never shorten one. Note: Bitrix24 mixes its own lifecycle notes into the same thread ("Задача завершена.", "Крайний срок изменен на: …", "…вы назначены соисполнителем."), attributed to the user who triggered the change; the REST API offers no flag for them, so judge by the text before quoting a comment back as something a person said. Also returns an `authors` roll-up (id, name, comment count) for the whole thread. Use `b24_task_comment_add` to write.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task id to read comments from, e.g. from `b24_task_list`.'),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .describe(
        'Sort by post date: "asc" (default) reads oldest-first like a conversation; "desc" puts the latest comment first. Applied locally — the Bitrix24 endpoint rejects sort params.',
      ),
    authorId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Return only comments written by this user id. Omit for the whole thread. Applied locally.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .describe(
        'Max number of comments to return after ordering and author filtering. Omit to return the ENTIRE thread (the default — nothing is dropped). Comments are never individually truncated.',
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Skip this many comments after ordering / filtering. Default 0. Use with `limit` to page a long thread.'),
  },
  handler: async ({ taskId, order, authorId, limit, offset }) => {
    const b24 = useBitrix24Tenant()
    // TASKID is the only param this endpoint tolerates — see the header note.
    const data = await callV2<unknown[] | { result?: unknown[] }>(
      b24,
      'task.commentitem.getlist',
      { TASKID: taskId },
      `Failed to list comments on Bitrix24 task ${taskId}`,
    )

    // The SDK unwraps the envelope, so a bare array arrives here; the
    // `.result` branch mirrors list-elapsed-time's tolerance for the legacy
    // object shape.
    const rows: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { result?: unknown[] })?.result)
        ? ((data as { result?: unknown[] }).result ?? [])
        : []

    const all: TaskCommentShort[] = rows
      .map((row) => toTaskCommentShort(row, taskId))
      .filter((c): c is TaskCommentShort => c !== null)

    // Author roll-up is computed over the WHOLE thread, before filtering or
    // paging — it answers "who is in this conversation", which a filtered
    // slice cannot.
    const authorCounts = new Map<string, { id: number | null, name: string | null, comments: number }>()
    for (const c of all) {
      const key = `${c.authorId ?? 'null'}|${c.authorName ?? ''}`
      const seen = authorCounts.get(key)
      if (seen) seen.comments += 1
      else authorCounts.set(key, { id: c.authorId, name: c.authorName, comments: 1 })
    }

    const filtered = authorId === undefined ? all : all.filter((c) => c.authorId === authorId)

    // Bitrix24 returns the thread in insertion order (ascending id / date).
    // Sort explicitly anyway so the contract holds if that ever changes;
    // fall back to id when POST_DATE is missing on either side.
    const sorted = [...filtered].sort((a, b) => {
      const byDate = (a.postDate ?? '').localeCompare(b.postDate ?? '')
      const delta = byDate !== 0 ? byDate : a.id - b.id
      return order === 'desc' ? -delta : delta
    })

    const from = offset ?? 0
    const page = limit === undefined ? sorted.slice(from) : sorted.slice(from, from + limit)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            taskId,
            // `total` is the thread size before author filter / paging;
            // `matched` after the filter; `returned` after paging. The agent
            // can tell "no comments" from "filtered everything out" and
            // knows whether more pages exist.
            total: all.length,
            matched: filtered.length,
            returned: page.length,
            offset: from,
            authors: [...authorCounts.values()],
            comments: page,
          }),
        },
      ],
    }
  },
})
