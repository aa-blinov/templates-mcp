import { beforeEach, describe, expect, it, vi } from 'vitest'
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

interface AddTagInput {
  taskId: number
  tags: string | string[]
}

const tool = (await import('../../../../server/mcp/tools/tasks/add-task-tag')).default as unknown as {
  handler: (input: AddTagInput) => Promise<ToolContent>
}

describe('b24_task_tag_add', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('reads the current TAGS, merges, and writes the union back', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', tags: ['P1'] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', tags: ['P1', 'R260916'] } }))

    const result = await tool.handler({ taskId: 42, tags: 'R260916' })

    expect(fake.v2Call).toHaveBeenNthCalledWith(1, {
      method: 'tasks.task.get',
      params: { taskId: 42, select: ['ID', 'TITLE', 'TAGS'] },
    })
    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { TAGS: ['P1', 'R260916'] } },
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      added: ['R260916'],
      alreadyPresent: [],
      taskId: 42,
      title: 'Ship it',
      tags: ['P1', 'R260916'],
    })
  })

  it('is case-insensitive: adding "p1" when the task already has "P1" reports alreadyPresent, no write', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', tags: ['P1'] } }))

    const result = await tool.handler({ taskId: 42, tags: 'p1' })

    expect(fake.v2Call).toHaveBeenCalledTimes(1) // no update call
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      added: [],
      alreadyPresent: ['p1'],
      taskId: 42,
      title: 'Ship it',
      tags: ['P1'],
    })
  })

  it('throws INVALID_INPUT when the task does not exist', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({}))
    await expect(tool.handler({ taskId: 999, tags: 'P1' })).rejects.toMatchObject({ name: 'Bitrix24ToolError' })
  })
})
