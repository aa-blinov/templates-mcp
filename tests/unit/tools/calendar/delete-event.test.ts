import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bitrix24ErrorCode } from '../../../../server/utils/errors'
import { fakeOk, makeFakeBitrix24 } from '../../_helpers/bitrix24-mock'

vi.mock('@nuxtjs/mcp-toolkit/server', () => ({
  defineMcpTool: <T,>(spec: T) => spec,
}))

const fake = makeFakeBitrix24()

vi.mock('~/server/utils/bitrix24-tenant', () => ({
  useBitrix24Tenant: () => fake.b24,
}))

interface ToolContent {
  content: { type: 'text'; text: string }[]
}

const tool = (await import('../../../../server/mcp/tools/calendar/delete-event')).default as unknown as {
  handler: (input: { eventId: number; confirmDelete?: boolean; confirmDeleteSeries?: boolean; confirmCancelMeeting?: boolean }) => Promise<ToolContent>
}

describe('b24_calendar_event_delete', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('reads the event, then deletes a one-off event when confirmDelete: true', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ ID: '10', RRULE: '' })).mockResolvedValueOnce(fakeOk(true))

    const result = await tool.handler({ eventId: 10, confirmDelete: true })

    expect(fake.v2Call).toHaveBeenNthCalledWith(1, { method: 'calendar.event.getbyid', params: { id: 10 } })
    expect(fake.v2Call).toHaveBeenNthCalledWith(2, { method: 'calendar.event.delete', params: { id: 10 } })
    expect(JSON.parse(result.content[0]!.text)).toEqual({ deleted: true, eventId: 10 })
  })

  it('refuses a recurring event without confirmDeleteSeries — the delete wipes the whole series (Ground Rule #10)', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ ID: '10', RRULE: { FREQ: 'WEEKLY' }, '~RRULE_DESCRIPTION': 'every week on: Tue' }))

    await expect(tool.handler({ eventId: 10, confirmDelete: true })).rejects.toMatchObject({
      code: Bitrix24ErrorCode.SERIES_DELETE_NEEDS_CONFIRM,
      message: expect.stringMatching(/10.*every week on: Tue.*confirmDeleteSeries/s) as unknown as string,
    })
    expect(fake.v2Call).toHaveBeenCalledTimes(1)
  })

  it('refuses the organizer\'s meeting with guests without confirmCancelMeeting — it disappears from every attendee\'s calendar (Ground Rule #10)', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({
      ID: '10',
      IS_MEETING: true,
      MEETING_STATUS: 'H',
      ATTENDEE_LIST: [{ id: 35, status: 'H' }, { id: 9, status: 'Q' }, { id: 1, status: 'Y' }],
    }))

    await expect(tool.handler({ eventId: 10, confirmDelete: true })).rejects.toMatchObject({
      code: Bitrix24ErrorCode.MEETING_DELETE_NEEDS_CONFIRM,
      message: expect.stringMatching(/10.*2 attendee.*confirmCancelMeeting/s) as unknown as string,
    })
    expect(fake.v2Call).toHaveBeenCalledTimes(1)
  })

  it('deletes the organizer\'s meeting once confirmCancelMeeting: true', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ ID: '10', IS_MEETING: true, MEETING_STATUS: 'H', ATTENDEE_LIST: [{ id: 35, status: 'H' }, { id: 9, status: 'Q' }] }))
      .mockResolvedValueOnce(fakeOk(true))

    await tool.handler({ eventId: 10, confirmDelete: true, confirmCancelMeeting: true })

    expect(fake.v2Call).toHaveBeenLastCalledWith({ method: 'calendar.event.delete', params: { id: 10 } })
  })

  it('does not ask for confirmCancelMeeting on an attendee\'s own copy of someone else\'s meeting', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ ID: '11', IS_MEETING: true, MEETING_STATUS: 'Y', ATTENDEE_LIST: [{ id: 9, status: 'H' }, { id: 35, status: 'Y' }] }))
      .mockResolvedValueOnce(fakeOk(true))

    await tool.handler({ eventId: 11, confirmDelete: true })

    expect(fake.v2Call).toHaveBeenLastCalledWith({ method: 'calendar.event.delete', params: { id: 11 } })
  })

  it('skips the pre-flight read when both cascade flags are already set', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk(true))

    const result = await tool.handler({ eventId: 10, confirmDelete: true, confirmDeleteSeries: true, confirmCancelMeeting: true })

    expect(fake.v2Call).toHaveBeenCalledTimes(1)
    expect(fake.v2Call).toHaveBeenCalledWith({ method: 'calendar.event.delete', params: { id: 10 } })
    expect(JSON.parse(result.content[0]!.text)).toEqual({ deleted: true, eventId: 10 })
  })

  it('refuses an event it cannot see, before deleting anything', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk(null))

    await expect(tool.handler({ eventId: 999, confirmDelete: true })).rejects.toMatchObject({
      code: Bitrix24ErrorCode.INVALID_INPUT,
    })
    expect(fake.v2Call).toHaveBeenCalledTimes(1)
  })

  it('refuses without confirmDelete and names the event (Ground Rule #9)', async () => {
    for (const confirmDelete of [undefined, false]) {
      await expect(tool.handler({ eventId: 42, confirmDelete })).rejects.toMatchObject({
        code: Bitrix24ErrorCode.DELETE_NEEDS_CONFIRM,
        message: expect.stringMatching(/calendar event 42/) as unknown as string,
      })
    }
    expect(fake.v2Call).not.toHaveBeenCalled()
  })
})
