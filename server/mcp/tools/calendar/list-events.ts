import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { calendarTypeSchema, dateSchema, ownerIdSchema, projectEvent } from '~/server/utils/calendar'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * List the events of one calendar in a date range.
 *
 * Bitrix24 REST: calendar.event.get (v2)
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/calendar-event-get.html
 *
 * The method has no paging: it returns the whole range at once, and a
 * recurring event comes back once per occurrence under the same id. The
 * tool therefore caps the answer and says so, instead of handing the agent
 * a few hundred rows.
 */

/** Rows returned to the agent; the rest is reported as `truncated`. */
const MAX_EVENTS = 100

export default defineMcpTool({
  name: 'b24_calendar_event_list',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'List events in one Bitrix24 calendar between two dates (inclusive): title, start / end as the portal shows them plus the event\'s time zone, location, organizer and attendees with their answers (accepted / declined / invited), recurrence. Your own calendar: `calendarType: "user"` with your id from `b24_user_me`; a colleague\'s: their id from `b24_user_find` — you see only what their calendar shares with you. A recurring event appears once per occurrence with the same id. At most 100 events come back; `truncated: true` means narrow the range. For "when are these people free" use `b24_calendar_accessibility_get` instead.',
  inputSchema: {
    calendarType: calendarTypeSchema,
    ownerId: ownerIdSchema,
    from: dateSchema.describe('First day of the range, `YYYY-MM-DD`.'),
    to: dateSchema.describe('Last day of the range, `YYYY-MM-DD`, inclusive.'),
  },
  handler: async ({ calendarType, ownerId, from, to }) => {
    if (from > to) {
      throw new Bitrix24ToolError(`The range is reversed: from ${from} is after to ${to}.`, Bitrix24ErrorCode.INVALID_INPUT)
    }
    const b24 = useBitrix24Tenant()
    const rows = await callV2<Record<string, unknown>[]>(
      b24,
      'calendar.event.get',
      { type: calendarType, ownerId, from, to },
      `Failed to list Bitrix24 calendar events for ${calendarType} ${ownerId}`,
    )
    const all = Array.isArray(rows) ? rows : []
    const events = all.slice(0, MAX_EVENTS).map(row => projectEvent(row))

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            calendarType,
            ownerId,
            from,
            to,
            total: all.length,
            truncated: all.length > MAX_EVENTS,
            events,
          }),
        },
      ],
    }
  },
})
