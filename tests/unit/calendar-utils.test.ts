import { describe, expect, it } from 'vitest'
import { eventFieldsSchema, projectEvent, toEventParams } from '../../server/utils/calendar'

describe('toEventParams', () => {
  it('sends only the fields that were set', () => {
    expect(toEventParams({ name: 'Sync' })).toEqual({ name: 'Sync' })
  })

  it('maps camelCase fields to the snake_case wire params', () => {
    expect(toEventParams({
      name: 'Sync',
      from: '2026-11-25T15:00:00+03:00',
      to: '2026-11-25T16:00:00+03:00',
      allDay: false,
      timezone: 'Europe/Moscow',
      description: 'agenda',
      location: 'Room 3',
      attendeeIds: [1, 7],
      reminders: [{ unit: 'min', count: 15 }],
      accessibility: 'busy',
      importance: 'high',
      isPrivate: true,
    })).toEqual({
      name: 'Sync',
      from: '2026-11-25T15:00:00+03:00',
      to: '2026-11-25T16:00:00+03:00',
      skip_time: 'N',
      timezone_from: 'Europe/Moscow',
      timezone_to: 'Europe/Moscow',
      description: 'agenda',
      location: 'Room 3',
      is_meeting: 'Y',
      attendees: [1, 7],
      remind: [{ type: 'min', count: 15 }],
      accessibility: 'busy',
      importance: 'high',
      private_event: 'Y',
    })
  })

  it('keeps an empty reminder list, which clears the reminders on update', () => {
    expect(toEventParams({ reminders: [] })).toEqual({ remind: [] })
  })
})

describe('eventFieldsSchema dates', () => {
  it.each(['2026-11-25', '2026-11-25T15:00', '2026-11-25T15:00:00', '2026-11-25 15:00:00', '2026-11-25T15:00:00+03:00', '2026-11-25T12:00:00Z'])(
    'accepts %s', (v) => {
      expect(eventFieldsSchema.from.safeParse(v).success).toBe(true)
    },
  )

  it.each(['25.11.2026', 'tomorrow 3pm', '2026-11-25T15', ''])('rejects %s', (v) => {
    expect(eventFieldsSchema.from.safeParse(v).success).toBe(false)
  })
})

describe('projectEvent', () => {
  const raw = {
    ID: '1265',
    NAME: 'Sync',
    DATE_FROM: '11/25/2026 03:00:00 pm',
    DATE_TO: '11/25/2026 04:00:00 pm',
    TZ_FROM: 'Europe/Moscow',
    DT_SKIP_TIME: 'N',
    CAL_TYPE: 'user',
    OWNER_ID: '1',
    SECTION_ID: '4',
    LOCATION: '',
    DESCRIPTION: 'agenda',
    IS_MEETING: true,
    MEETING_HOST: '1',
    ATTENDEE_LIST: [{ id: 1, entryId: '1265', status: 'H' }, { id: 7, entryId: '1266', status: 'Q' }, { id: 9, status: 'N' }],
    ACCESSIBILITY: 'busy',
    IMPORTANCE: 'normal',
    PRIVATE_EVENT: '',
    '~RRULE_DESCRIPTION': 'every week on: Mon',
    DAV_XML_ID: 'noise',
  }

  it('keeps the fields an agent needs and names attendee answers in words', () => {
    expect(projectEvent(raw)).toEqual({
      id: 1265,
      name: 'Sync',
      from: '11/25/2026 03:00:00 pm',
      to: '11/25/2026 04:00:00 pm',
      timezone: 'Europe/Moscow',
      allDay: false,
      calendarType: 'user',
      ownerId: 1,
      sectionId: 4,
      location: null,
      isMeeting: true,
      organizerId: 1,
      attendees: [
        { userId: 1, status: 'organizer' },
        { userId: 7, status: 'invited' },
        { userId: 9, status: 'declined' },
      ],
      accessibility: 'busy',
      importance: 'normal',
      isPrivate: false,
      recurrence: 'every week on: Mon',
    })
  })

  it('adds the description only on request', () => {
    expect(projectEvent(raw)).not.toHaveProperty('description')
    expect(projectEvent(raw, { withDescription: true }).description).toBe('agenda')
  })

  it('survives a row with no attendee list', () => {
    expect(projectEvent({ ID: '5', IS_MEETING: false }).attendees).toEqual([])
  })
})
