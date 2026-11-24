import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { dateSchema } from '~/server/utils/calendar'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Busy slots of several people over a date range — the input for "find a time
 * that suits everyone".
 *
 * Bitrix24 REST: calendar.accessibility.get (v2)
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/calendar-accessibility-get.html
 *
 * The answer is keyed by user id; an unknown id comes back as an empty list,
 * indistinguishable from a free person, which the description says aloud.
 */
export default defineMcpTool({
  name: 'b24_calendar_accessibility_get',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'Show when people are busy over a date range, to pick a meeting time that suits everyone. Returns, per user id, the events that occupy their time: start / end as the portal shows them with the time zone, all-day flag and how the time is marked (`busy`, `quest` = tentative, `absent`, `free`). Anything not listed is free. Resolve names with `b24_user_find` first; an id that matches nobody also comes back with an empty list, so do not read "empty" as proof the person exists. Then create the meeting with `b24_calendar_event_add`.',
  inputSchema: {
    userIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(50)
      .describe('User ids to check — from `b24_user_find` (and your own from `b24_user_me`).'),
    from: dateSchema.describe('First day of the range, `YYYY-MM-DD`.'),
    to: dateSchema.describe('Last day of the range, `YYYY-MM-DD`, inclusive.'),
  },
  handler: async ({ userIds, from, to }) => {
    if (from > to) {
      throw new Bitrix24ToolError(`The range is reversed: from ${from} is after to ${to}.`, Bitrix24ErrorCode.INVALID_INPUT)
    }
    const b24 = useBitrix24Tenant()
    const result = await callV2<Record<string, Record<string, unknown>[]>>(
      b24,
      'calendar.accessibility.get',
      { users: userIds, from, to },
      `Failed to read Bitrix24 calendar availability for ${userIds.length} user(s)`,
    )

    const users = userIds.map(userId => {
      const rows = result?.[String(userId)]
      return {
        userId,
        busy: (Array.isArray(rows) ? rows : []).map(row => ({
          eventId: toNumber(row.ID),
          name: typeof row.NAME === 'string' ? row.NAME : null,
          from: row.DATE_FROM ?? null,
          to: row.DATE_TO ?? null,
          timezone: row.TZ_FROM ?? null,
          allDay: row.DT_SKIP_TIME === 'Y',
          accessibility: row.ACCESSIBILITY ?? null,
        })),
      }
    })

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ from, to, users }) }],
    }
  },
})
