import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { ChatMessagesEnvelope } from '~/server/types/bitrix24'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { type MessageShort, selectMessages, toMessageShort } from '~/server/utils/im-dialogs'
import { callV2 } from '~/server/utils/sdk-helpers'
import { chatUserNames } from '~/server/utils/task-comments'

/**
 * Read the messages of one conversation.
 *
 * Bitrix24 REST: im.dialog.messages.get
 *   https://apidocs.bitrix24.com/api-reference/chat/messages/im-dialog-messages-get.html
 *
 * Wire behaviour, same as the task-chat reader in `list-task-comments.ts`: the
 * endpoint answers newest-first, pages backwards through `LAST_ID`, and ships
 * a `users` array so author names come for free. Ordering, author and text
 * filtering are therefore local (see `im-dialogs.ts`).
 *
 * Message bodies are returned in full: never truncated, never summarised.
 * What the tool does add is oldest-first ordering by default, so a thread
 * reads as a conversation.
 *
 * Read-only by design — this family has no sending counterpart.
 */

/** Messages requested per call. Bitrix24 answers ~50 even when asked for more. */
const PAGE = 200
/** How many pages to walk back before stopping and saying the thread continues. */
const MAX_PAGES = 5

export default defineMcpTool({
  name: 'b24_im_message_list',
  description:
    'Read the messages of one Bitrix24 conversation — a group chat or a one-to-one dialog — as the account the server acts as. Pass `dialogId` from `b24_im_dialog_list`: "chat42" for a group chat, a bare user id like "7" for a person. Text comes back in full (verbatim, never truncated) with authorId + authorName, so attribution needs no second lookup. Default order is oldest-first, i.e. the thread reads as a conversation; pass order: "desc" for newest-first. Bound a long thread with `limit`, narrow to one person with `authorId` (from `b24_user_find`), and use `search` to keep only messages containing a substring (case-insensitive, applied over the fetched pages). Bitrix24 system entries (author id 0 — chat created, joins, leaves) are hidden by default; pass includeSystem: true to see them. `truncated: true` in the response means the walk stopped before the beginning of the conversation. Also returns an `authors` roll-up (id, name, message count) over the whole matched thread. Read-only: no tool in this family sends messages.',
  inputSchema: {
    dialogId: z
      .string()
      .min(1)
      .describe('Conversation to read: "chat42" for a group chat, a bare user id like "7" for a one-to-one dialog. Ids come from `b24_im_dialog_list`.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Max messages to return after ordering and filtering. Default 50. Whole messages are dropped, never shortened.'),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort by date: "asc" (default) reads oldest-first like a conversation; "desc" puts the latest message first.'),
    authorId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Return only messages written by this user id. Applied locally over the fetched pages.'),
    search: z
      .string()
      .min(1)
      .optional()
      .describe('Keep only messages whose text contains this substring, case-insensitive. Applied locally over the fetched pages.'),
    includeSystem: z
      .boolean()
      .optional()
      .describe('Include Bitrix24 system entries (author id 0): chat created, joins, leaves, service notices. Default false — they are hidden and counted in `systemHidden`.'),
  },
  handler: async ({ dialogId, limit, order, authorId, search, includeSystem }) => {
    const b24 = useBitrix24Tenant()

    const fetched: MessageShort[] = []
    const names = new Map<number, string>()
    let truncated = false
    let lastId: number | undefined

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, unknown> = { DIALOG_ID: dialogId, LIMIT: PAGE }
      if (lastId !== undefined) params.LAST_ID = lastId
      const envelope = await callV2<ChatMessagesEnvelope>(
        b24,
        'im.dialog.messages.get',
        params,
        `Failed to read Bitrix24 conversation ${dialogId}`,
      )
      const messages = Array.isArray(envelope?.messages) ? envelope.messages : []
      if (messages.length === 0) break

      for (const [id, name] of chatUserNames(envelope?.users)) names.set(id, name)
      for (const raw of messages) {
        const projected = toMessageShort(raw)
        if (projected) fetched.push(projected)
      }

      // A page shorter than asked means the beginning of the chat is reached.
      if (messages.length < PAGE) break
      const oldest = fetched.reduce<number | null>((min, m) => (min === null || m.id < min ? m.id : min), null)
      if (oldest === null) break
      lastId = oldest
      if (page === MAX_PAGES - 1) truncated = true
    }

    // Names arrive per page; resolve them once the whole thread is in.
    for (const message of fetched) {
      if (message.authorId !== null) message.authorName = names.get(message.authorId) ?? null
    }

    const selection = selectMessages(fetched, { authorId, search, includeSystem, order, limit })

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              dialogId,
              fetched: fetched.length,
              matched: selection.matched,
              returned: selection.page.length,
              systemHidden: selection.systemHidden,
              truncated,
              authors: selection.authors,
              messages: selection.page,
            },
            null,
            2,
          ),
        },
      ],
    }
  },
})
