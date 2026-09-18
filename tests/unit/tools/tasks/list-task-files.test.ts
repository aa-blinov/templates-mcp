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

const tool = (await import('../../../../server/mcp/tools/tasks/list-task-files')).default as unknown as {
  handler: (input: { taskId: number }) => Promise<ToolContent>
}

describe('b24_task_file_list', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
    fake.v2Batch.mockReset()
  })

  it('returns [] when the task has no UF_TASK_WEBDAV_FILES attachments', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, ufTaskWebdavFiles: null } }))
    const result = await tool.handler({ taskId: 42 })
    expect(JSON.parse(result.content[0]!.text)).toEqual({ taskId: 42, returned: 0, files: [] })
    expect(fake.v2Batch).not.toHaveBeenCalled()
  })

  it('resolves each attachment id via a batched disk.attachedObject.get, human-readable size', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 4199, ufTaskWebdavFiles: [3497] } }))
    fake.v2Batch.mockResolvedValueOnce({
      isSuccess: true,
      getData: () => [
        fakeOk({
          ID: '3497',
          OBJECT_ID: '18591',
          MODULE_ID: 'tasks',
          ENTITY_TYPE: 'tasks_task',
          ENTITY_ID: '4199',
          CREATE_TIME: '2026-09-04T12:02:00+03:00',
          CREATED_BY: '309',
          DOWNLOAD_URL: 'https://x.bitrix24.ru/bitrix/tools/disk/uf.php?attachedId=3497&auth[ap]=SECRET&action=download',
          NAME: 'image (12).png',
          SIZE: '14767',
        }),
      ],
      getErrorMessages: () => [],
    })

    const result = await tool.handler({ taskId: 4199 })

    expect(fake.v2Batch).toHaveBeenCalledWith({
      calls: [['disk.attachedObject.get', { id: 3497 }]],
      options: { isHaltOnError: false, returnAjaxResult: true },
    })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({
      taskId: 4199,
      returned: 1,
      files: [
        {
          attachedId: 3497,
          name: 'image (12).png',
          sizeBytes: 14767,
          size: '14.4 KB',
          createdAt: '2026-09-04T12:02:00+03:00',
          createdById: 309,
          downloadUrl: 'https://x.bitrix24.ru/bitrix/tools/disk/uf.php?attachedId=3497&auth[ap]=SECRET&action=download',
        },
      ],
    })
  })

  it('skips a failed batch row instead of failing the whole call', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 1, ufTaskWebdavFiles: [10, 11] } }))
    fake.v2Batch.mockResolvedValueOnce({
      isSuccess: true,
      getData: () => [
        fakeOk({ ID: '10', NAME: 'ok.png', SIZE: '100', DOWNLOAD_URL: 'https://x/', CREATE_TIME: null, CREATED_BY: null }),
        { isSuccess: false, getData: () => ({ result: null }), getErrorMessages: () => ['ACCESS_DENIED'] },
      ],
      getErrorMessages: () => [],
    })

    const result = await tool.handler({ taskId: 1 })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.returned).toBe(1)
    expect(payload.files[0].attachedId).toBe(10)
  })
})
