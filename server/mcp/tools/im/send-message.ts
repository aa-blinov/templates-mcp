import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Post a message into a Bitrix24 conversation.
 *
 * Bitrix24 REST: im.message.add
 *   https://apidocs.bitrix24.com/api-reference/chat/messages/im-message-add.html
 *
 * This is the one tool in the IM family that writes, and it writes **as the
 * account the server acts as** — the message appears under that person's
 * name, in a chat other people read, and cannot be silently taken back
 * (Bitrix24 marks an edited or deleted message as such for everyone). That is
 * why it asks for an explicit `confirmSend`: every other guarded operation in
 * this server follows the same pattern (`confirmDelete`, …), and a message to
 * a colleague deserves the same deliberate second step as a delete.
 *
 * Text goes to Bitrix24 as it is written. BBCode works ([B], [URL=…]), so a
 * `[` in ordinary text can be read as markup — the caller decides, the tool
 * does not escape anything behind the operator's back.
 */

/** Bitrix24 rejects a message body over 20000 characters. */
const MESSAGE_MAX = 20_000

export default defineMcpTool({
  name: 'b24_im_message_add',
  description:
    'Send a message to a Bitrix24 conversation as the account the server acts as (see `b24_user_me`). `dialogId` is what `b24_im_dialog_list` returns: "chat42" for a group chat, a bare user id like "7" for a one-to-one dialog. Requires `confirmSend: true` — the message is posted under the operator\'s own name into a chat other people read, so it is a deliberate two-step call, not something to do while exploring. Text is sent verbatim and BBCode is live ([B]bold[/B], [URL=https://…]link[/URL], [USER=7]Имя[/USER] to mention someone), so square brackets in ordinary prose may be read as markup. Returns the new message id. For a task discussion prefer `b24_task_comment_add`: it posts into the task thread where the work is tracked, not into a chat.',
  inputSchema: {
    dialogId: z
      .string()
      .min(1)
      .describe('Where to post: "chat42" for a group chat, a bare user id like "7" for a one-to-one dialog. Ids come from `b24_im_dialog_list`.'),
    text: z
      .string()
      .min(1)
      .max(MESSAGE_MAX)
      .describe(`Message body, sent verbatim. BBCode is interpreted. Up to ${MESSAGE_MAX} characters.`),
    confirmSend: z
      .literal(true)
      .describe('Must be `true`. Explicit confirmation that this message should be posted under the operator’s name into a chat other people read.'),
  },
  handler: async ({ dialogId, text }) => {
    // A blank body passes `min(1)` when it is spaces or newlines; Bitrix24
    // would accept it and post an empty bubble into the chat.
    if (text.trim() === '') {
      throw new Bitrix24ToolError(
        'Refusing to post a blank message: the text is only whitespace.',
        Bitrix24ErrorCode.INVALID_INPUT,
      )
    }

    const b24 = useBitrix24Tenant()
    const result = await callV2<number | string>(
      b24,
      'im.message.add',
      { DIALOG_ID: dialogId, MESSAGE: text },
      `Failed to send a Bitrix24 message to ${dialogId}`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { sent: true, dialogId, messageId: toNumber(result), chars: text.length },
            null,
            2,
          ),
        },
      ],
    }
  },
})
