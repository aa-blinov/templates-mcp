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

const tool = (await import('../../../../server/mcp/tools/tasks/watch-task')).default as unknown as {
  handler: (input: { taskId: number }) => Promise<ToolContent>
}

describe('b24_task_watch', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('calls actions.v2.call.make with tasks.task.startwatch and returns the watched-task summary', async () => {
    fake.v2Call.mockResolvedValue(fakeOk({ task: { id: 4573, title: 'watch me', status: '2', responsibleId: '9' } }))

    const result = await tool.handler({ taskId: 4573 })

    expect(fake.v2Call).toHaveBeenCalledWith({ method: 'tasks.task.startwatch', params: { taskId: 4573 } })
    expect(fake.v3Call).not.toHaveBeenCalled()
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      watched: true,
      id: 4573,
      title: 'watch me',
      status: '2',
      responsibleId: '9',
    })
  })

  it('falls back to a re-list message when Bitrix24 returns no task body', async () => {
    fake.v2Call.mockResolvedValue(fakeOk({}))
    const result = await tool.handler({ taskId: 42 })
    expect(result.content[0]!.text).toMatch(/42/)
    expect(result.content[0]!.text).toMatch(/Re-list/i)
  })

  it('wraps SDK errors with the task id in the fallback', async () => {
    fake.v2Call.mockRejectedValue(new Error('ACCESSDENIEDEXCEPTION'))
    await expect(tool.handler({ taskId: 7 })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      message: 'ACCESSDENIEDEXCEPTION',
    })
  })
})
