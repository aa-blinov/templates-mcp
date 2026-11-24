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

const tool = (await import('../../../../server/mcp/tools/calendar/get-event')).default as unknown as {
  handler: (input: { eventId: number }) => Promise<ToolContent>
}

describe('b24_calendar_event_get', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('calls calendar.event.getbyid and includes the description', async () => {
    fake.v2Call.mockResolvedValue(fakeOk({ ID: '10', NAME: 'Sync', DESCRIPTION: 'agenda' }))

    const result = await tool.handler({ eventId: 10 })

    expect(fake.v2Call).toHaveBeenCalledWith({ method: 'calendar.event.getbyid', params: { id: 10 } })
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ id: 10, name: 'Sync', description: 'agenda' })
  })

  it('answers "not found" when Bitrix24 returns null', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(null))
    const result = await tool.handler({ eventId: 999 })
    expect(result.content[0]!.text).toMatch(/999 not found/)
  })

  it('wraps SDK errors into Bitrix24ToolError', async () => {
    fake.v2Call.mockRejectedValue(new Error('boom'))
    await expect(tool.handler({ eventId: 1 })).rejects.toMatchObject({ name: 'Bitrix24ToolError', message: 'boom' })
  })
})
