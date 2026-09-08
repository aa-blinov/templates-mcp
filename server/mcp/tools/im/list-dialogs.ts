import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { filterDialogs, type RecentRowRaw, toDialogShort } from '~/server/utils/im-dialogs'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * List the operator's recent conversations.
 *
 * Bitrix24 REST: im.recent.get
 *   https://apidocs.bitrix24.com/api-reference/chat/messages/im-recent-get.html
 *
 * The webhook (or the OAuth-consenting user) acts as one person, so this is
 * that person's own chat list and nobody else's — REST offers no way to read
 * someone else's dialogs. It is the entry point for reading a conversation:
 * `b24_im_message_list` needs a `dialogId`, and this is where those come from
 * ("chat42" for a group chat, a bare user id for a one-to-one dialog).
 *
 * Read-only by design: this tool family has no counterpart that sends
 * messages. Reading a colleague's message and writing in the operator's name
 * are different levels of risk, and only the first one is wired up.
 *
 * `SKIP_OPENLINES: 'Y'` keeps external-channel (Open Lines) conversations out:
 * they are a support-desk queue, not the operator's own correspondence.
 */

/** Default page for a listing. Bitrix24 answers around 50 rows per call. */
const DEFAULT_LIMIT = 20

export default defineMcpTool({
  name: 'b24_im_dialog_list',
  description:
    'List the recent Bitrix24 conversations of the account the server acts as (see `b24_user_me`) — group chats, one-to-one dialogs, notification feeds. Returns for each: `dialogId` (pass it to `b24_im_message_list`), title, type, unread flag, and a preview of the last message with its date and author id. This is a listing tool: message text comes back only as that preview, so read a conversation with `b24_im_message_list`. Narrow with `kind: "chat"` (group chats only) or `kind: "private"` (people only) to keep service feeds out, and with `unreadOnly`. Task chats appear here too, but a task thread is better read with `b24_task_comment_list`, which merges the chat with the older forum store. Read-only: no tool in this family sends messages.',
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('How many conversations to return, most recent activity first. Default 20; Bitrix24 answers around 50 per call.'),
    kind: z
      .enum(['all', 'chat', 'private'])
      .optional()
      .describe('Narrow by kind: "chat" keeps group chats, "private" keeps one-to-one dialogs with people, "all" (default) returns everything including notification feeds.'),
    unreadOnly: z
      .boolean()
      .optional()
      .describe('Return only conversations Bitrix24 marks unread. Default false.'),
  },
  handler: async ({ limit, kind, unreadOnly }) => {
    const b24 = useBitrix24Tenant()
    const rows
      = (await callV2<RecentRowRaw[]>(
          b24,
          'im.recent.get',
          { SKIP_OPENLINES: 'Y' },
          'Failed to list Bitrix24 conversations',
        ))
      ?? []

    const filtered = filterDialogs(rows.map(toDialogShort), { kind, unreadOnly })
    const page = filtered.slice(0, limit ?? DEFAULT_LIMIT)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: filtered.length, returned: page.length, dialogs: page }, null, 2),
        },
      ],
    }
  },
})
