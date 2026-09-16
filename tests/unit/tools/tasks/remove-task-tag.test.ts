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

interface RemoveTagInput {
  taskId: number
  tags: string | string[]
}

const tool = (await import('../../../../server/mcp/tools/tasks/remove-task-tag')).default as unknown as {
  handler: (input: RemoveTagInput) => Promise<ToolContent>
}

describe('b24_task_tag_remove', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('reads the current TAGS, drops the match case-insensitively, and writes the survivors back', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', tags: ['P1', 'R260916'] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', tags: ['P1'] } }))

    const result = await tool.handler({ taskId: 42, tags: 'r260916' }) // lowercase on purpose

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { TAGS: ['P1'] } },
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      removed: ['R260916'],
      notPresent: [],
      taskId: 42,
      title: 'Ship it',
      tags: ['P1'],
    })
  })

  it('clears the field entirely when removing the last tag', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, tags: ['P1'] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, tags: [] } }))

    await tool.handler({ taskId: 42, tags: 'P1' })

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { TAGS: [] } },
    })
  })

  it('skips the write and reports notPresent when the tag is not on the task', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', tags: ['P1'] } }))

    const result = await tool.handler({ taskId: 42, tags: 'R260916' })

    expect(fake.v2Call).toHaveBeenCalledTimes(1) // no update call
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      removed: [],
      notPresent: ['R260916'],
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
