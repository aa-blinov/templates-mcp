import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { calendarTypeSchema, eventFieldsSchema, ownerIdSchema, toEventParams } from '~/server/utils/calendar'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Create a calendar event or a meeting with attendees.
 *
 * Bitrix24 REST: calendar.event.add (v2)
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/calendar-event-add.html
 *
 * The organizer is always the account the server acts as — the method has
 * no parameter to hand that role to someone else. Without `sectionId`
 * Bitrix24 picks the owner's default calendar (`auto_detect_section: Y`),
 * which is what an operator means by "put it in my calendar".
 */
export default defineMcpTool({
  name: 'b24_calendar_event_add',
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description:
    'Create an event in a Bitrix24 calendar; with `attendeeIds` it becomes a meeting and every attendee gets an invitation they can accept or decline. The organizer is the account the server acts as (see `b24_user_me`). Resolve people with `b24_user_find` first, and check when they are free with `b24_calendar_accessibility_get`. Pass times as ISO 8601 with an offset (`2026-11-25T15:00:00+03:00`) so the time zone is never guessed. Not idempotent: calling twice creates two events and sends invitations twice. Returns the new event id.',
  inputSchema: {
    calendarType: calendarTypeSchema,
    ownerId: ownerIdSchema,
    ...eventFieldsSchema,
    sectionId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('A specific calendar of the owner (one person can have several). Omit to use the owner\'s default calendar.'),
  },
  handler: async ({ calendarType, ownerId, sectionId, ...fields }) => {
    const b24 = useBitrix24Tenant()
    const params: Record<string, unknown> = {
      type: calendarType,
      ownerId,
      ...toEventParams(fields),
      ...(sectionId === undefined ? { auto_detect_section: 'Y' } : { section: sectionId }),
    }
    const result = await callV2<number | string>(
      b24,
      'calendar.event.add',
      params,
      `Failed to create Bitrix24 calendar event "${fields.name}"`,
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            created: true,
            eventId: toNumber(result),
            name: fields.name,
            from: fields.from,
            to: fields.to,
            attendeeIds: fields.attendeeIds ?? [],
          }),
        },
      ],
    }
  },
})
