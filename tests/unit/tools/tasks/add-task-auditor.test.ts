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

interface AddAuditorInput {
  taskId: number
  auditorId: number | number[]
}

const tool = (await import('../../../../server/mcp/tools/tasks/add-task-auditor')).default as unknown as {
  handler: (input: AddAuditorInput) => Promise<ToolContent>
}

describe('b24_task_auditor_add', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('reads the current AUDITORS, merges, and writes the union back', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', auditors: [12] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', auditors: [12, 47] } }))

    const result = await tool.handler({ taskId: 42, auditorId: 47 })

    expect(fake.v2Call).toHaveBeenNthCalledWith(1, {
      method: 'tasks.task.get',
      params: { taskId: 42, select: ['ID', 'TITLE', 'AUDITORS'] },
    })
    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { AUDITORS: [12, 47] } },
    })

    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({ added: [47], alreadyPresent: [], taskId: 42, title: 'Ship it', auditors: [12, 47] })
  })

  it('accepts an array of auditor ids in one call', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, auditors: [] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, auditors: [12, 47] } }))

    await tool.handler({ taskId: 42, auditorId: [12, 47] })

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { AUDITORS: [12, 47] } },
    })
  })

  it('skips the write and reports alreadyPresent when every id is already an auditor', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', auditors: [12, 47] } }))

    const result = await tool.handler({ taskId: 42, auditorId: 47 })

    expect(fake.v2Call).toHaveBeenCalledTimes(1) // no update call
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({ added: [], alreadyPresent: [47], taskId: 42, title: 'Ship it', auditors: [12, 47] })
  })

  it('throws INVALID_INPUT when the task does not exist', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({}))
    await expect(tool.handler({ taskId: 999, auditorId: 47 })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      code: Bitrix24ErrorCode.INVALID_INPUT,
    })
  })
})
