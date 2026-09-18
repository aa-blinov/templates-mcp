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

const tool = (await import('../../../../server/mcp/tools/tasks/list-task-chat-files')).default as unknown as {
  handler: (input: { taskId: number, limit?: number }) => Promise<ToolContent>
}

describe('b24_task_chat_file_list', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('returns [] with a note when the task has no chat (chatId null)', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ task: { id: 42, chatId: null } }))
    const result = await tool.handler({ taskId: 42 })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({ taskId: 42, total: 0, returned: 0, files: [] })
    expect(fake.v2Call).toHaveBeenCalledTimes(1)
  })

  it('projects the files{} blob, resolved against each message\'s FILE_ID, human-readable size, never returns bytes', async () => {
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 4145, chatId: 6429 } }))
      .mockResolvedValueOnce(
        fakeOk({
          chat_id: 6429,
          messages: [
            { id: 245049, chat_id: 6429, author_id: 9, date: '2026-09-04T16:45:32+03:00', text: '', params: { FILE_ID: [18657] } },
            { id: 244121, chat_id: 6429, author_id: 9, date: '2026-09-03T17:13:15+03:00', text: 'a normal comment, no file' },
          ],
          users: [{ id: 9, name: 'Александр Блинов' }],
          // Verified-live shape: `files` is keyed by POSITION ("0", "1", …),
          // not by file id — each entry's own `id` is the real handle.
          files: {
            0: {
              id: 18657,
              type: 'image',
              name: 'image (5).png',
              extension: 'png',
              size: 160749,
              image: { width: 1280, height: 835 },
              authorId: 9,
              authorName: 'Александр Блинов',
              date: '2026-09-04T16:45:32+03:00',
              urlDownload: 'https://x.bitrix24.ru/...&_esd=SECRET_TOKEN',
              urlPreview: 'https://x.bitrix24.ru/...&signature=SECRET_SIG',
            },
          },
        }),
      )

    const result = await tool.handler({ taskId: 4145 })
    const payload = JSON.parse(result.content[0]!.text)

    expect(payload.taskId).toBe(4145)
    expect(payload.returned).toBe(1)
    expect(payload.files).toEqual([
      {
        fileId: 18657,
        messageId: 245049,
        name: 'image (5).png',
        type: 'image',
        extension: 'png',
        sizeBytes: 160749,
        size: '157.0 KB',
        width: 1280,
        height: 835,
        uploadedBy: 'Александр Блинов',
        uploadedById: 9,
        uploadedAt: '2026-09-04T16:45:32+03:00',
        downloadUrl: 'https://x.bitrix24.ru/...&_esd=SECRET_TOKEN',
        previewUrl: 'https://x.bitrix24.ru/...&signature=SECRET_SIG',
      },
    ])
    // Never a bytes/base64 field — the tool is a router, not a pipe.
    expect(JSON.stringify(payload)).not.toMatch(/base64|content.*bytes/i)
  })

  it('caps results to `limit`', async () => {
    const files: Record<string, unknown> = {}
    const messages = Array.from({ length: 5 }, (_, i) => {
      const fileId = 100 + i
      // Positional key ("0", "1", …), deliberately NOT equal to fileId —
      // catches a lookup-by-outer-key regression that a coincidentally
      // matching key/id would hide.
      files[i] = { id: fileId, type: 'file', name: `f${i}.pdf`, extension: 'pdf', size: 10, date: '2026-01-01T00:00:00+03:00' }
      return { id: i, chat_id: 6429, author_id: 9, date: '2026-01-01T00:00:00+03:00', text: '', params: { FILE_ID: [fileId] } }
    })
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ task: { id: 1, chatId: 6429 } }))
      .mockResolvedValueOnce(fakeOk({ chat_id: 6429, messages, users: [], files }))

    const result = await tool.handler({ taskId: 1, limit: 2 })
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.returned).toBe(2)
    expect(payload.total).toBe(5)
  })
})
