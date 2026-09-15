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

const tool = (await import('../../../../server/mcp/tools/tasks/delete-task')).default as unknown as {
  handler: (input: { taskId: number | number[], confirmDelete?: boolean, force?: boolean }) => Promise<ToolContent>
}

describe('b24_task_delete', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
    fake.v2Batch.mockReset()
  })

  it('single mode: posts tasks.task.delete with taskId (confirmDelete: true)', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(true))
    const result = await tool.handler({ taskId: 4517, confirmDelete: true })

    expect(fake.v2Call).toHaveBeenCalledWith({
      method: 'tasks.task.delete',
      params: { taskId: 4517 },
    })
    expect(fake.v2Batch).not.toHaveBeenCalled()
    expect(JSON.parse(result.content[0]!.text)).toEqual({ deleted: true, taskId: 4517 })
  })

  it('batch mode: one batchV2 round-trip, per-id results', async () => {
    fake.v2Batch.mockResolvedValue({
      isSuccess: true,
      getData: () => [
        fakeOk(true),
        { isSuccess: false, getData: () => ({ result: null }), getErrorMessages: () => ['ACCESSDENIEDEXCEPTION'] },
      ],
      getErrorMessages: () => [],
    })

    const result = await tool.handler({ taskId: [10, 11], confirmDelete: true })
    const payload = JSON.parse(result.content[0]!.text) as {
      batch: boolean
      total: number
      ok: number
      failed: number
      results: { taskId: number, ok: boolean, error?: string }[]
    }

    expect(fake.v2Batch).toHaveBeenCalledWith({
      calls: [
        ['tasks.task.delete', { taskId: 10 }],
        ['tasks.task.delete', { taskId: 11 }],
      ],
      options: { isHaltOnError: false, returnAjaxResult: true },
    })
    expect(payload).toMatchObject({ batch: true, total: 2, ok: 1, failed: 1 })
    expect(payload.results[1]!.error).toMatch(/ACCESSDENIEDEXCEPTION/)
  })

  it('refuses single delete without confirmDelete: true and names the task (Ground Rule #9)', async () => {
    await expect(tool.handler({ taskId: 4517 })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      code: Bitrix24ErrorCode.DELETE_NEEDS_CONFIRM,
      message: expect.stringMatching(/task 4517/) as unknown as string,
    })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('refuses batch delete without confirmDelete: true', async () => {
    await expect(tool.handler({ taskId: [1, 2, 3] })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      code: Bitrix24ErrorCode.DELETE_NEEDS_CONFIRM,
    })
    expect(fake.v2Batch).not.toHaveBeenCalled()
  })

  it('batch mode rejects > 50 ids by default, accepts with force=true', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1)
    await expect(tool.handler({ taskId: ids, confirmDelete: true })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      code: Bitrix24ErrorCode.BATCH_TOO_LARGE,
    })
    expect(fake.v2Batch).not.toHaveBeenCalled()

    fake.v2Batch.mockResolvedValue({ isSuccess: true, getData: () => ids.map(() => fakeOk(true)), getErrorMessages: () => [] })
    const payload = JSON.parse(
      (await tool.handler({ taskId: ids, confirmDelete: true, force: true })).content[0]!.text,
    ) as { total: number, ok: number }
    expect(payload.total).toBe(51)
  })

  it('wraps SDK errors into Bitrix24ToolError on single mode', async () => {
    fake.v2Call.mockRejectedValue(new Error('not found'))
    await expect(tool.handler({ taskId: 99, confirmDelete: true })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      message: 'not found',
    })
  })
})
