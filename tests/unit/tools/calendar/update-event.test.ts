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

type UpdateInput = Record<string, unknown> & { eventId: number }
const tool = (await import('../../../../server/mcp/tools/calendar/update-event')).default as unknown as {
  handler: (input: UpdateInput) => Promise<ToolContent>
}

const current = { ID: '10', CAL_TYPE: 'group', OWNER_ID: '5', MEETING_HOST: '3' }

describe('b24_calendar_event_update', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('reads the event first and sends its calendar type and owner with the changed fields only', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk(current)).mockResolvedValueOnce(fakeOk(10))

    const result = await tool.handler({ eventId: 10, from: '2026-11-26T10:00:00+03:00', to: '2026-11-26T11:00:00+03:00' })

    expect(fake.v2Call).toHaveBeenNthCalledWith(1, { method: 'calendar.event.getbyid', params: { id: 10 } })
    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'calendar.event.update',
      params: { id: 10, type: 'group', ownerId: '5', from: '2026-11-26T10:00:00+03:00', to: '2026-11-26T11:00:00+03:00' },
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual({ updated: true, eventId: 10, changed: ['from', 'to'] })
  })

  it('keeps the current organizer when the attendee list changes', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk(current)).mockResolvedValueOnce(fakeOk(10))

    await tool.handler({ eventId: 10, attendeeIds: [3, 7] })

    expect(fake.v2Call.mock.calls[1]![0].params).toMatchObject({ is_meeting: 'Y', attendees: [3, 7], host: '3' })
  })

  it('does not send host when the attendee list is untouched', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk(current)).mockResolvedValueOnce(fakeOk(10))

    await tool.handler({ eventId: 10, name: 'Renamed' })

    expect(fake.v2Call.mock.calls[1]![0].params).not.toHaveProperty('host')
  })

  it('refuses an empty change without a wire call', async () => {
    await expect(tool.handler({ eventId: 10 })).rejects.toMatchObject({ code: Bitrix24ErrorCode.NO_CHANGES })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('refuses when the event is not visible, before any update', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk(null))

    await expect(tool.handler({ eventId: 999, name: 'x' })).rejects.toMatchObject({
      code: Bitrix24ErrorCode.INVALID_INPUT,
      message: expect.stringContaining('999') as unknown as string,
    })
    expect(fake.v2Call).toHaveBeenCalledTimes(1)
  })
})
