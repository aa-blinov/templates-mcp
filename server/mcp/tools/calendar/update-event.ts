import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { eventFieldsSchema, eventIdSchema, fetchEventOrThrow, toEventParams, type EventFieldsInput } from '~/server/utils/calendar'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * Change an existing calendar event.
 *
 * Bitrix24 REST: calendar.event.update (v2)
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/calendar-event-update.html
 *
 * `calendar.event.update` wants the calendar `type` and `ownerId` next to the
 * event id, and when the attendee list is sent it makes the CALLER the
 * organizer unless `host` is passed too. So the tool reads the event first
 * (`calendar.event.getbyid`): the agent passes only the id and the fields to
 * change, and an edit of the attendee list keeps the organizer it had.
 */

const FIELD_KEYS = Object.keys(eventFieldsSchema) as (keyof EventFieldsInput)[]

export default defineMcpTool({
  name: 'b24_calendar_event_update',
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  description:
    'Change an existing Bitrix24 calendar event: move it (`from` / `to`), rename it, change location, description, reminders or the attendee list. Pass only what changes; everything else stays. `attendeeIds` REPLACES the whole list — to add one person, pass the current attendees (from `b24_calendar_event_get`) plus the new one; the organizer stays the same. Attendees are notified of the change by Bitrix24. Only someone allowed to edit the event (usually its organizer) can do this. The id comes from `b24_calendar_event_list`.',
  inputSchema: {
    eventId: eventIdSchema,
    ...Object.fromEntries(FIELD_KEYS.map(key => [key, eventFieldsSchema[key].optional()])) as {
      [K in keyof typeof eventFieldsSchema]: ReturnType<(typeof eventFieldsSchema)[K]['optional']>
    },
  },
  handler: async ({ eventId, ...input }) => {
    const fields = input as EventFieldsInput
    const changed = FIELD_KEYS.filter(key => fields[key] !== undefined)
    if (changed.length === 0) {
      throw new Bitrix24ToolError(
        `Nothing to change on calendar event ${eventId}: pass at least one field.`,
        Bitrix24ErrorCode.NO_CHANGES,
      )
    }

    const b24 = useBitrix24Tenant()
    const current = await fetchEventOrThrow(b24, eventId)
    const params: Record<string, unknown> = {
      id: eventId,
      type: current.CAL_TYPE,
      ownerId: current.OWNER_ID,
      ...toEventParams(fields),
    }
    if (fields.attendeeIds !== undefined && current.MEETING_HOST) {
      params.host = current.MEETING_HOST
    }

    await callV2<unknown>(
      b24,
      'calendar.event.update',
      params,
      `Failed to update Bitrix24 calendar event ${eventId}`,
    )

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ updated: true, eventId, changed }) }],
    }
  },
})
