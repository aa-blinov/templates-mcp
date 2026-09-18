import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bitrix24ErrorCode } from '../../../../server/utils/errors'
import { fakeOk, makeFakeBitrix24 } from '../../_helpers/bitrix24-mock'

vi.mock('@nuxtjs/mcp-toolkit/server', () => ({
  defineMcpTool: <T,>(spec: T) => spec,
}))

const fake = makeFakeBitrix24()

vi.mock('~/server/utils/bitrix24', () => ({
  useBitrix24: () => fake.b24,
}))

interface ToolContent {
  content: { type: 'text'; text: string }[]
}

const tool = (await import('../../../../server/mcp/tools/groups/find-group')).default as unknown as {
  handler: (input: { query?: string, limit?: number }) => Promise<ToolContent>
}

const sampleGroups = [
  { ID: '1', NAME: 'test', DESCRIPTION: '', ACTIVE: 'Y', OWNER_ID: '9', NUMBER_OF_MEMBERS: '3' },
  { ID: '4', NAME: 'testing infra', DESCRIPTION: 'infra sandbox', ACTIVE: 'Y', OWNER_ID: '9', NUMBER_OF_MEMBERS: '1' },
]

describe('b24_group_find', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('matches by name (LIKE) and returns trimmed group objects', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(sampleGroups))

    const result = await tool.handler({ query: 'test' })

    expect(fake.v2Call).toHaveBeenCalledWith({
      method: 'sonet_group.get',
      params: { FILTER: { '%NAME': 'test' }, sort: 'NAME', order: 'ASC' },
    })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.returned).toBe(2)
    expect(payload.groups).toEqual([
      { id: 1, name: 'test', description: null, active: true, ownerId: 9, memberCount: 3 },
      { id: 4, name: 'testing infra', description: 'infra sandbox', active: true, ownerId: 9, memberCount: 1 },
    ])
  })

  it('throws INVALID_INPUT when query is whitespace-only (passes Zod min(1), still meaningless)', async () => {
    await expect(tool.handler({ query: '   ' })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      code: Bitrix24ErrorCode.INVALID_INPUT,
    })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('caps results to `limit` (default 10)', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ID: String(i + 1), NAME: `proj-${i}`, ACTIVE: 'Y' }))
    fake.v2Call.mockResolvedValue(fakeOk(many))
    const result = await tool.handler({ query: 'proj', limit: 3 })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.groups).toHaveLength(3)
  })

  it('wraps SDK errors into Bitrix24ToolError', async () => {
    fake.v2Call.mockRejectedValue(new Error('OPERATION_TIME_LIMIT'))
    await expect(tool.handler({ query: 'x' })).rejects.toMatchObject({ name: 'Bitrix24ToolError' })
  })
})
