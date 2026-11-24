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

const tool = (await import('../../../../server/mcp/tools/calendar/list-events')).default as unknown as {
  handler: (input: { calendarType: string; ownerId: number; from: string; to: string }) => Promise<ToolContent>
}

const input = { calendarType: 'user', ownerId: 1, from: '2026-11-24', to: '2026-11-30' }

describe('b24_calendar_event_list', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
    fake.v3Call.mockReset()
  })

  it('calls calendar.event.get on v2 and projects the rows', async () => {
    fake.v2Call.mockResolvedValue(fakeOk([{ ID: '10', NAME: 'Sync', DATE_FROM: '11/25/2026 03:00:00 pm', DESCRIPTION: 'long' }]))

    const result = await tool.handler(input)

    expect(fake.v2Call).toHaveBeenCalledWith({
      method: 'calendar.event.get',
      params: { type: 'user', ownerId: 1, from: '2026-11-24', to: '2026-11-30' },
    })
    expect(fake.v3Call).not.toHaveBeenCalled()
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toMatchObject({ total: 1, truncated: false })
    expect(payload.events[0]).toMatchObject({ id: 10, name: 'Sync', from: '11/25/2026 03:00:00 pm' })
    expect(payload.events[0]).not.toHaveProperty('description')
  })

  it('caps the answer at 100 events and says so', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(Array.from({ length: 130 }, (_, i) => ({ ID: String(i + 1) }))))

    const payload = JSON.parse((await tool.handler(input)).content[0]!.text)

    expect(payload.events).toHaveLength(100)
    expect(payload).toMatchObject({ total: 130, truncated: true })
  })

  it('refuses a reversed range without a wire call', async () => {
    await expect(tool.handler({ ...input, from: '2026-12-01' })).rejects.toMatchObject({
      code: Bitrix24ErrorCode.INVALID_INPUT,
    })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('wraps SDK errors into Bitrix24ToolError', async () => {
    fake.v2Call.mockRejectedValue(new Error('insufficient_scope'))
    await expect(tool.handler(input)).rejects.toMatchObject({ name: 'Bitrix24ToolError', message: 'insufficient_scope' })
  })
})
