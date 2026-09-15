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

interface RemoveAuditorInput {
  taskId: number
  auditorId: number | number[]
}

const tool = (await import('../../../../server/mcp/tools/tasks/remove-task-auditor')).default as unknown as {
  handler: (input: RemoveAuditorInput) => Promise<ToolContent>
}

describe('b24_task_auditor_remove', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('reads the current AUDITORS, drops the id, and writes the survivors back', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', auditors: [12, 47] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', auditors: [12] } }))

    const result = await tool.handler({ taskId: 42, auditorId: 47 })

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { AUDITORS: [12] } },
    })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({ removed: [47], notPresent: [], taskId: 42, title: 'Ship it', auditors: [12] })
  })

  it('clears the field entirely when removing the last auditor', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, auditors: [12] } }))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, auditors: [] } }))

    await tool.handler({ taskId: 42, auditorId: 12 })

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.update',
      params: { taskId: 42, fields: { AUDITORS: [] } },
    })
  })

  it('skips the write and reports notPresent when the id is not an auditor', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, title: 'Ship it', auditors: [12] } }))

    const result = await tool.handler({ taskId: 42, auditorId: 99 })

    expect(fake.v2Call).toHaveBeenCalledTimes(1) // no update call
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({ removed: [], notPresent: [99], taskId: 42, title: 'Ship it', auditors: [12] })
  })

  it('throws INVALID_INPUT when the task does not exist', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({}))
    await expect(tool.handler({ taskId: 999, auditorId: 47 })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      code: Bitrix24ErrorCode.INVALID_INPUT,
    })
  })
})
