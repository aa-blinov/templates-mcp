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

const tool = (await import('../../../../server/mcp/tools/calendar/get-accessibility')).default as unknown as {
  handler: (input: { userIds: number[]; from: string; to: string }) => Promise<ToolContent>
}

describe('b24_calendar_accessibility_get', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('calls calendar.accessibility.get and returns busy slots per requested user, in input order', async () => {
    fake.v2Call.mockResolvedValue(fakeOk({
      7: [{ ID: '8373', NAME: 'Stand-up', DATE_FROM: '11/25/2026 10:00:00 am', DATE_TO: '11/25/2026 11:00:00 am', TZ_FROM: 'Europe/Moscow', DT_SKIP_TIME: 'N', ACCESSIBILITY: 'busy' }],
      1: [],
    }))

    const result = await tool.handler({ userIds: [1, 7, 42], from: '2026-11-25', to: '2026-11-25' })

    expect(fake.v2Call).toHaveBeenCalledWith({
      method: 'calendar.accessibility.get',
      params: { users: [1, 7, 42], from: '2026-11-25', to: '2026-11-25' },
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      from: '2026-11-25',
      to: '2026-11-25',
      users: [
        { userId: 1, busy: [] },
        {
          userId: 7,
          busy: [{ eventId: 8373, name: 'Stand-up', from: '11/25/2026 10:00:00 am', to: '11/25/2026 11:00:00 am', timezone: 'Europe/Moscow', allDay: false, accessibility: 'busy' }],
        },
        { userId: 42, busy: [] },
      ],
    })
  })

  it('refuses a reversed range without a wire call', async () => {
    await expect(tool.handler({ userIds: [1], from: '2026-11-26', to: '2026-11-25' })).rejects.toMatchObject({
      code: Bitrix24ErrorCode.INVALID_INPUT,
    })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })
})
