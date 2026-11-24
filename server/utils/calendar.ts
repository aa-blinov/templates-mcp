import { z } from 'zod'
import type { TypeB24 } from '@bitrix24/b24jssdk'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Shared pieces of the calendar tools (`server/mcp/tools/calendar/**`).
 *
 * Bitrix24 REST: calendar.event.* and calendar.accessibility.get — all
 * classic (v2) methods with snake_case params and UPPERCASE response fields.
 *   https://apidocs.bitrix24.com/api-reference/calendar/calendar-event/index.html
 *
 * Dates go back to the agent exactly as Bitrix24 renders them (`DATE_FROM`,
 * in the portal's display format and the event's own `TZ_FROM` wall clock).
 * Converting them is a trap: `DATE_FROM_TS_UTC` is documented as NOT being
 * UTC despite its name, so the only honest projection is "the string plus
 * the time zone it is in".
 */

export const calendarTypeSchema = z
  .enum(['user', 'group', 'company_calendar'])
  .describe('Whose calendar: `user` — a person\'s calendar, `group` — a workgroup/project calendar, `company_calendar` — the shared company calendar.')

export const ownerIdSchema = z
  .number()
  .int()
  .nonnegative()
  .describe('Owner of the calendar: the user id for `user` (your own id comes from `b24_user_me`, a colleague\'s from `b24_user_find`), the workgroup id for `group` (from `b24_group_find`), `0` for `company_calendar`.')

export const eventIdSchema = z
  .number()
  .int()
  .positive()
  .describe('Event id from `b24_calendar_event_list` or `b24_calendar_event_add`.')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/

/** `YYYY-MM-DD` — what list / accessibility take as a range bound. */
export const dateSchema = z.string().regex(DATE_RE, 'Expected YYYY-MM-DD')

/** An event boundary: ISO date-time (offset optional) or a bare date for all-day events. */
const eventDateSchema = z
  .string()
  .refine(v => DATE_RE.test(v) || DATE_TIME_RE.test(v), 'Expected YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM]')

const reminderSchema = z.object({
  unit: z.enum(['min', 'hour', 'day']).describe('`min`, `hour` or `day`.'),
  count: z.number().int().positive().describe('How many units before the start.'),
})

/**
 * The editable event fields. `add` takes them with `name` / `from` / `to`
 * required; `update` takes all of them optional.
 */
export const eventFieldsSchema = {
  name: z.string().trim().min(1).max(255).describe('Event title, as the attendees will see it.'),
  from: eventDateSchema.describe('Start. Prefer ISO 8601 with an offset, e.g. `2026-11-25T15:00:00+03:00` — then `timezone` is ignored. Without an offset (`2026-11-25T15:00:00`) the time is read in `timezone`, or in the account\'s own time zone. For an all-day event pass a bare date `2026-11-25` together with `allDay: true`.'),
  to: eventDateSchema.describe('End, same format as `from`. For a one-day all-day event pass the same date as `from`.'),
  allDay: z.boolean().optional().describe('`true` — an all-day event: `from` / `to` are bare dates and carry no time.'),
  timezone: z.string().min(1).optional().describe('IANA time zone for `from` / `to` without an offset, e.g. `Europe/Moscow`. Ignored when the dates carry an offset.'),
  description: z.string().max(20_000).optional().describe('Free-text description shown in the event card.'),
  location: z.string().max(255).optional().describe('Where: free text like "Переговорка 3" or a video-call link.'),
  attendeeIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(100)
    .optional()
    .describe('User ids to invite — resolve names with `b24_user_find` first. Turns the event into a meeting: every attendee gets an invitation. The organizer is always an attendee on their own, no need to list them. On update this REPLACES the whole attendee list, it does not add to it.'),
  reminders: z
    .array(reminderSchema)
    .max(5)
    .optional()
    .describe('Reminders before the start, e.g. `[{ unit: "min", count: 15 }]`. On update this replaces the existing reminders.'),
  accessibility: z
    .enum(['busy', 'quest', 'free', 'absent'])
    .optional()
    .describe('How the time shows to others: `busy`, `quest` (tentative), `free`, `absent` (out of office).'),
  importance: z.enum(['high', 'normal', 'low']).optional().describe('`high`, `normal` or `low`.'),
  isPrivate: z.boolean().optional().describe('`true` — others see the slot as busy but not its title or details.'),
}

export interface EventFieldsInput {
  name?: string
  from?: string
  to?: string
  allDay?: boolean
  timezone?: string
  description?: string
  location?: string
  attendeeIds?: number[]
  reminders?: { unit: 'min' | 'hour' | 'day', count: number }[]
  accessibility?: 'busy' | 'quest' | 'free' | 'absent'
  importance?: 'high' | 'normal' | 'low'
  isPrivate?: boolean
}

const yn = (v: boolean) => (v ? 'Y' : 'N')

/**
 * Translate the tool's camelCase fields into `calendar.event.add/update`
 * params. Only fields the caller set are sent — on update an absent field
 * keeps its current value on the portal.
 */
export function toEventParams(input: EventFieldsInput): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (input.name !== undefined) params.name = input.name
  if (input.from !== undefined) params.from = input.from
  if (input.to !== undefined) params.to = input.to
  if (input.allDay !== undefined) params.skip_time = yn(input.allDay)
  if (input.timezone !== undefined) {
    params.timezone_from = input.timezone
    params.timezone_to = input.timezone
  }
  if (input.description !== undefined) params.description = input.description
  if (input.location !== undefined) params.location = input.location
  if (input.attendeeIds !== undefined) {
    params.is_meeting = 'Y'
    params.attendees = input.attendeeIds
  }
  if (input.reminders !== undefined) {
    params.remind = input.reminders.map(r => ({ type: r.unit, count: r.count }))
  }
  if (input.accessibility !== undefined) params.accessibility = input.accessibility
  if (input.importance !== undefined) params.importance = input.importance
  if (input.isPrivate !== undefined) params.private_event = yn(input.isPrivate)
  return params
}

/** Bitrix24 attendee status letters → words an operator reads without a legend. */
const ATTENDEE_STATUS: Record<string, string> = {
  H: 'organizer',
  Y: 'accepted',
  N: 'declined',
  Q: 'invited',
}

export interface CalendarEvent {
  id: number | null
  name: string | null
  from: string | null
  to: string | null
  timezone: string | null
  allDay: boolean
  calendarType: string | null
  ownerId: number | null
  sectionId: number | null
  location: string | null
  isMeeting: boolean
  organizerId: number | null
  attendees: { userId: number | null, status: string }[]
  accessibility: string | null
  importance: string | null
  isPrivate: boolean
  recurrence: string | null
  description?: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Compact projection of a `calendar.event.get` / `getbyid` row. The raw row
 * carries ~60 fields (DAV ids, sync labels, duplicated `~` variants); the
 * agent needs about fifteen. `description` is opt-in because a list of
 * fifty events with full descriptions is mostly noise.
 */
export function projectEvent(raw: Record<string, unknown>, opts: { withDescription?: boolean } = {}): CalendarEvent {
  const attendeeList = Array.isArray(raw.ATTENDEE_LIST) ? raw.ATTENDEE_LIST as Record<string, unknown>[] : []
  const event: CalendarEvent = {
    id: toNumber(raw.ID),
    name: str(raw.NAME),
    from: str(raw.DATE_FROM),
    to: str(raw.DATE_TO),
    timezone: str(raw.TZ_FROM),
    allDay: raw.DT_SKIP_TIME === 'Y',
    calendarType: str(raw.CAL_TYPE),
    ownerId: toNumber(raw.OWNER_ID),
    sectionId: toNumber(raw.SECTION_ID),
    location: str(raw.LOCATION),
    isMeeting: raw.IS_MEETING === true || raw.IS_MEETING === '1' || raw.IS_MEETING === 'Y',
    organizerId: toNumber(raw.MEETING_HOST),
    attendees: attendeeList.map(a => ({
      userId: toNumber(a.id),
      status: ATTENDEE_STATUS[String(a.status)] ?? String(a.status),
    })),
    accessibility: str(raw.ACCESSIBILITY),
    importance: str(raw.IMPORTANCE),
    isPrivate: raw.PRIVATE_EVENT === 'Y' || raw.PRIVATE_EVENT === '1' || raw.PRIVATE_EVENT === true,
    recurrence: str(raw['~RRULE_DESCRIPTION']),
  }
  if (opts.withDescription) event.description = str(raw.DESCRIPTION)
  return event
}

/**
 * `calendar.event.getbyid` — the raw row, or `null` when the event does not
 * exist or the account cannot see it (Bitrix24 answers `result: null` for
 * both).
 */
export async function fetchEvent(b24: TypeB24, eventId: number): Promise<Record<string, unknown> | null> {
  const row = await callV2<Record<string, unknown> | null>(
    b24,
    'calendar.event.getbyid',
    { id: eventId },
    `Failed to fetch Bitrix24 calendar event ${eventId}`,
  )
  return row && typeof row === 'object' ? row : null
}

/** {@link fetchEvent} that refuses instead of returning `null`. */
export async function fetchEventOrThrow(b24: TypeB24, eventId: number): Promise<Record<string, unknown>> {
  const row = await fetchEvent(b24, eventId)
  if (!row) {
    throw new Bitrix24ToolError(
      `Calendar event ${eventId} was not found, or this account cannot see it. Look the id up with \`b24_calendar_event_list\`.`,
      Bitrix24ErrorCode.INVALID_INPUT,
    )
  }
  return row
}
