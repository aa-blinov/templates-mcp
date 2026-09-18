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
  handler: (input: { taskId: number, fileId?: number, upload?: { name: string, contentBase64: string } }) => Promise<ToolContent>
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
      uploaded: false,
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
    expect(payload).toEqual({ attached: true, uploaded: false, taskId: 42, fileId: 999, attachedId: null, name: null, sizeBytes: null, size: null })
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

  it('rejects when neither fileId nor upload is given', async () => {
    await expect(tool.handler({ taskId: 42 })).rejects.toMatchObject({ name: 'Bitrix24ToolError' })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('rejects when both fileId and upload are given', async () => {
    await expect(
      tool.handler({ taskId: 42, fileId: 5, upload: { name: 'x.txt', contentBase64: 'aGk=' } }),
    ).rejects.toMatchObject({ name: 'Bitrix24ToolError' })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('rejects an upload over the size cap before any network call', async () => {
    const big = 'A'.repeat(6_000_000) // ~4.5MB decoded, over the 3MB cap
    await expect(
      tool.handler({ taskId: 42, upload: { name: 'big.bin', contentBase64: big } }),
    ).rejects.toMatchObject({ name: 'Bitrix24ToolError' })
    expect(fake.v2Call).not.toHaveBeenCalled()
  })

  it('uploads a new file: resolves the task\'s project storage, uploads, then attaches it', async () => {
    const contentBase64 = Buffer.from('hello world').toString('base64')
    fake.v2Call
      // resolve task's groupId
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, groupId: '1' } }))
      // resolve the project's Disk storage
      .mockResolvedValueOnce(fakeOk([{ ID: '21', ROOT_OBJECT_ID: '117' }]))
      // upload into the root folder
      .mockResolvedValueOnce(fakeOk({ ID: 19099, NAME: 'note.txt' }))
      // before: no attachments yet
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: null } }))
      // the attach call itself
      .mockResolvedValueOnce(fakeOk(true))
      // after: the new attachment
      .mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: [3579] } }))
      // resolve the new attachment's metadata
      .mockResolvedValueOnce(fakeOk({ ID: '3579', NAME: 'note.txt', SIZE: '11', CREATE_TIME: null, CREATED_BY: '9' }))

    const result = await tool.handler({ taskId: 42, upload: { name: 'note.txt', contentBase64 } })

    expect(fake.v2Call).toHaveBeenNthCalledWith(2, {
      method: 'disk.storage.getlist',
      params: { filter: { ENTITY_TYPE: 'group', ENTITY_ID: '1' } },
    })
    expect(fake.v2Call).toHaveBeenNthCalledWith(3, {
      method: 'disk.folder.uploadfile',
      params: { id: 117, data: { NAME: 'note.txt' }, fileContent: ['note.txt', contentBase64] },
    })
    expect(fake.v2Call).toHaveBeenNthCalledWith(5, {
      method: 'tasks.task.files.attach',
      params: { taskId: 42, fileId: 19099 },
    })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({
      attached: true,
      uploaded: true,
      taskId: 42,
      fileId: 19099,
      attachedId: 3579,
      name: 'note.txt',
      sizeBytes: 11,
      size: '11 B',
    })
  })

  it('rejects an upload for a task with no project (personal task — no Disk storage to upload into)', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, groupId: null } }))
    await expect(
      tool.handler({ taskId: 42, upload: { name: 'x.txt', contentBase64: 'aGk=' } }),
    ).rejects.toMatchObject({ name: 'Bitrix24ToolError' })
  })
})
