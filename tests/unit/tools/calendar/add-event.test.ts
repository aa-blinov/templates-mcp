import { beforeEach, describe, expect, it, vi } from 'vitest'
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

type AddInput = Record<string, unknown>
const tool = (await import('../../../../server/mcp/tools/calendar/add-event')).default as unknown as {
  handler: (input: AddInput) => Promise<ToolContent>
}

const base = {
  calendarType: 'user',
  ownerId: 1,
  name: 'Sync',
  from: '2026-11-25T15:00:00+03:00',
  to: '2026-11-25T16:00:00+03:00',
}

describe('b24_calendar_event_add', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('creates the event in the default calendar via auto_detect_section', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(1246))

    const result = await tool.handler(base)

    expect(fake.v2Call).toHaveBeenCalledWith({
      method: 'calendar.event.add',
      params: {
        type: 'user',
        ownerId: 1,
        name: 'Sync',
        from: '2026-11-25T15:00:00+03:00',
        to: '2026-11-25T16:00:00+03:00',
        auto_detect_section: 'Y',
      },
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      created: true,
      eventId: 1246,
      name: 'Sync',
      from: '2026-11-25T15:00:00+03:00',
      to: '2026-11-25T16:00:00+03:00',
      attendeeIds: [],
    })
  })

  it('turns attendees into a meeting and honours an explicit section', async () => {
    fake.v2Call.mockResolvedValue(fakeOk('77'))

    const result = await tool.handler({ ...base, attendeeIds: [1, 7], sectionId: 4 })

    const params = fake.v2Call.mock.calls[0]![0].params
    expect(params).toMatchObject({ is_meeting: 'Y', attendees: [1, 7], section: 4 })
    expect(params).not.toHaveProperty('auto_detect_section')
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ eventId: 77, attendeeIds: [1, 7] })
  })

  it('wraps SDK errors with the event name in the fallback', async () => {
    fake.v2Call.mockResolvedValue({ isSuccess: false, getData: () => ({ result: undefined }), getErrorMessages: () => [], hasMore: () => false, getTotal: () => 0 })
    await expect(tool.handler(base)).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      message: expect.stringContaining('"Sync"') as unknown as string,
    })
  })
})
