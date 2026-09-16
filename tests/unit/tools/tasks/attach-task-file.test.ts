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

const tool = (await import('../../../../server/mcp/tools/tasks/attach-task-file')).default as unknown as {
  handler: (input: { taskId: number, fileId: number }) => Promise<ToolContent>
}

describe('b24_task_file_attach', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('attaches an existing Disk file, diffs UF_TASK_WEBDAV_FILES before/after, and echoes the new attachment\'s metadata', async () => {
    fake.v2Call
      // before: task already has attachment 10
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: [10] } }))
      // the attach call itself
      .mockResolvedValueOnce(fakeOk(true))
      // after: attachment 10 and the new 11
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: [10, 11] } }))
      // resolve the new attachment's metadata
      .mockResolvedValueOnce(
        fakeOk({ ID: '11', NAME: 'report.pdf', SIZE: '2048', CREATE_TIME: '2026-09-15T10:00:00+03:00', CREATED_BY: '9' }),
      )

    const result = await tool.handler({ taskId: 42, fileId: 999 })

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'tasks.task.files.attach',
      params: { taskId: 42, fileId: 999 },
    })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({
      attached: true,
      taskId: 42,
      fileId: 999,
      attachedId: 11,
      name: 'report.pdf',
      sizeBytes: 2048,
      size: '2.0 KB',
    })
  })

  it('reports attached: true with attachedId: null when the diff finds no new id (Bitrix24 accepted it but the set looks unchanged)', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: [10] } }))
      .mockResolvedValueOnce(fakeOk(true))
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: [10] } }))

    const result = await tool.handler({ taskId: 42, fileId: 999 })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({ attached: true, taskId: 42, fileId: 999, attachedId: null, name: null, sizeBytes: null, size: null })
  })

  it('wraps SDK errors (e.g. no read access to the Disk file) into Bitrix24ToolError', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: [] } }))
      .mockRejectedValueOnce(new Error('ACCESS_DENIED'))

    await expect(tool.handler({ taskId: 42, fileId: 999 })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      message: 'ACCESS_DENIED',
    })
  })
})
