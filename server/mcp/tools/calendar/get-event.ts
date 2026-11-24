import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { eventIdSchema, fetchEvent, projectEvent } from '~/server/utils/calendar'

/**
 * Fetch one calendar event with its description.
 *
 * Bitrix24 REST: calendar.event.getbyid (v2)
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/calendar-event-get-by-id.html
 *
 * Bitrix24 answers `result: null` both for a missing id and for an event the
 * account may not see; the tool reports that as a plain "not found" text, the
 * same as `b24_task_get` does in the reference template.
 */
export default defineMcpTool({
  name: 'b24_calendar_event_get',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'Fetch one Bitrix24 calendar event by id, including its description: title, start / end with the event\'s time zone, location, organizer, every attendee with their answer (accepted / declined / invited), recurrence. Use it to check an event before `b24_calendar_event_update` or `b24_calendar_event_delete`. Ids come from `b24_calendar_event_list`.',
  inputSchema: {
    eventId: eventIdSchema,
  },
  handler: async ({ eventId }) => {
    const b24 = useBitrix24Tenant()
    const row = await fetchEvent(b24, eventId)
    if (!row) {
      return {
        content: [{ type: 'text' as const, text: `Calendar event ${eventId} not found, or this account cannot see it.` }],
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(projectEvent(row, { withDescription: true })) }],
    }
  },
})
