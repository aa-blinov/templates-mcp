import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { eventIdSchema, fetchEventOrThrow } from '~/server/utils/calendar'
import { assertConfirmedDelete, confirmDeleteSchema } from '~/server/utils/define-action-tool'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * Delete a calendar event.
 *
 * Bitrix24 REST: calendar.event.delete (v2)
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/calendar-event-delete.html
 *
 * SKILL.md Rule #9: requires `confirmDelete: true`; the shared gate fires
 * before any wire call.
 *
 * SKILL.md Rule #10: on a recurring event `calendar.event.delete` removes
 * EVERY occurrence — verified live: a daily series of three was gone after
 * one delete. The method has no "this occurrence only" mode, so a recurring
 * event also needs `confirmDeleteSeries: true`.
 *
 * SKILL.md Rule #10 again: when the organizer deletes a meeting, Bitrix24
 * removes it from every attendee's calendar as well (verified live). That
 * needs `confirmCancelMeeting: true`. The organizer's own event is the one
 * with `MEETING_STATUS: H`; an attendee's copy carries their answer (Y / N /
 * Q) there, and deleting it is not gated beyond Rule #9.
 *
 * One pre-flight read (`calendar.event.getbyid`) feeds both checks and is
 * skipped when the agent already set both cascade flags.
 */
export default defineMcpTool({
  name: 'b24_calendar_event_delete',
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
  description:
    'Delete a Bitrix24 calendar event. Destructive — there is no undo. **Requires `confirmDelete: true`** after the operator has explicitly agreed. A recurring event is deleted as a WHOLE SERIES — every past and future occurrence, there is no way to drop just one — so it additionally needs `confirmDeleteSeries: true`; the tool refuses with SERIES_DELETE_NEEDS_CONFIRM and names the recurrence otherwise. When the organizer deletes a meeting with attendees, it disappears from every attendee\'s calendar too, so that needs `confirmCancelMeeting: true` (MEETING_DELETE_NEEDS_CONFIRM otherwise). To move or rename a single meeting use `b24_calendar_event_update` instead. Check what you are deleting with `b24_calendar_event_get` first. The id comes from `b24_calendar_event_list`.',
  inputSchema: {
    eventId: eventIdSchema,
    confirmDelete: confirmDeleteSchema(),
    confirmDeleteSeries: z
      .boolean()
      .optional()
      .describe('Required in addition to `confirmDelete` when the event repeats: deleting it removes the whole series. Set only after the operator agreed to lose every occurrence.'),
    confirmCancelMeeting: z
      .boolean()
      .optional()
      .describe('Required in addition to `confirmDelete` when you are the organizer of a meeting with attendees: deleting it cancels it for everyone. Set only after the operator agreed to cancel the meeting for all attendees.'),
  },
  handler: async ({ eventId, confirmDelete, confirmDeleteSeries, confirmCancelMeeting }) => {
    assertConfirmedDelete('b24_calendar_event_delete', `calendar event ${eventId}`, confirmDelete)
    const b24 = useBitrix24Tenant()

    if (!(confirmDeleteSeries && confirmCancelMeeting)) {
      const event = await fetchEventOrThrow(b24, eventId)
      const rrule = event.RRULE
      if (!confirmDeleteSeries && rrule && typeof rrule === 'object' && 'FREQ' in rrule) {
        const recurrence = typeof event['~RRULE_DESCRIPTION'] === 'string' ? ` (${event['~RRULE_DESCRIPTION']})` : ''
        throw new Bitrix24ToolError(
          `Calendar event ${eventId} is recurring${recurrence}: deleting it removes the whole series, every occurrence. Re-call \`b24_calendar_event_delete\` with \`confirmDeleteSeries: true\` as well only after the operator has agreed to lose the series (SKILL.md Ground Rule #10).`,
          Bitrix24ErrorCode.SERIES_DELETE_NEEDS_CONFIRM,
        )
      }
      const guests = Array.isArray(event.ATTENDEE_LIST)
        ? (event.ATTENDEE_LIST as { status?: unknown }[]).filter(a => a.status !== 'H').length
        : 0
      if (!confirmCancelMeeting && event.MEETING_STATUS === 'H' && guests > 0) {
        throw new Bitrix24ToolError(
          `Calendar event ${eventId} is a meeting you organize with ${guests} attendee(s): deleting it removes it from their calendars too. Re-call \`b24_calendar_event_delete\` with \`confirmCancelMeeting: true\` as well only after the operator has agreed to cancel it for everyone (SKILL.md Ground Rule #10).`,
          Bitrix24ErrorCode.MEETING_DELETE_NEEDS_CONFIRM,
        )
      }
    }

    await callV2<boolean>(
      b24,
      'calendar.event.delete',
      { id: eventId },
      `Failed to delete Bitrix24 calendar event ${eventId}`,
    )
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, eventId }) }],
    }
  },
})
