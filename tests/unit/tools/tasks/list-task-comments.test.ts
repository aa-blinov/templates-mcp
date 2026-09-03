import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeOk, fakeOkEmpty, makeFakeBitrix24 } from '../../_helpers/bitrix24-mock'

vi.mock('@nuxtjs/mcp-toolkit/server', () => ({
  defineMcpTool: <T,>(spec: T) => spec,
}))

const fake = makeFakeBitrix24()

vi.mock('~/server/utils/bitrix24-tenant', () => ({
  useBitrix24Tenant: () => fake.b24,
}))

interface ToolContent {
  content: { type: 'text', text: string }[]
}

const tool = (await import('../../../../server/mcp/tools/tasks/list-task-comments')).default as unknown as {
  handler: (input: {
    taskId: number
    order?: 'asc' | 'desc'
    authorId?: number
    limit?: number
    offset?: number
  }) => Promise<ToolContent>
}

/** Three comments, deliberately out of date order on the wire. */
const WIRE = [
  {
    ID: '111',
    AUTHOR_ID: '9',
    AUTHOR_NAME: 'Иван',
    AUTHOR_EMAIL: '',
    POST_DATE: '2025-07-31T16:38:53+03:00',
    POST_MESSAGE: 'Крайний срок изменен на: 1 августа, 18:00',
    POST_MESSAGE_HTML: null,
  },
  {
    ID: '51',
    AUTHOR_ID: '9',
    AUTHOR_NAME: 'Иван',
    AUTHOR_EMAIL: '',
    POST_DATE: '2025-07-31T13:11:12+03:00',
    POST_MESSAGE: 'первый',
    POST_MESSAGE_HTML: null,
  },
  {
    ID: '53',
    AUTHOR_ID: '11',
    AUTHOR_NAME: 'Мария',
    AUTHOR_EMAIL: '',
    POST_DATE: '2025-07-31T13:11:53+03:00',
    POST_MESSAGE: 'второй',
    POST_MESSAGE_HTML: null,
  },
]

function payload(result: ToolContent) {
  return JSON.parse(result.content[0]!.text)
}

describe('b24_task_comment_list', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
    fake.v3Call.mockReset()
  })

  it('calls task.commentitem.getlist with TASKID only (the endpoint rejects ORDER/FILTER)', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(WIRE))

    await tool.handler({ taskId: 23, order: 'desc', authorId: 9, limit: 1 })

    expect(fake.v2Call).toHaveBeenCalledTimes(1)
    expect(fake.v3Call).not.toHaveBeenCalled()
    expect(fake.v2Call.mock.calls[0]![0]).toEqual({
      method: 'task.commentitem.getlist',
      params: { TASKID: 23 },
    })
  })

  it('returns the whole thread oldest-first with full bodies and named authors', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(WIRE))

    const result = payload(await tool.handler({ taskId: 23 }))

    expect(result.taskId).toBe(23)
    expect(result.total).toBe(3)
    expect(result.matched).toBe(3)
    expect(result.returned).toBe(3)
    expect(result.offset).toBe(0)
    expect(result.comments.map((c: { id: number }) => c.id)).toEqual([51, 53, 111])
    expect(result.comments[0]).toEqual({
      id: 51,
      taskId: 23,
      authorId: 9,
      authorName: 'Иван',
      authorEmail: null,
      postDate: '2025-07-31T13:11:12+03:00',
      text: 'первый',
      textHtml: null,
    })
  })

  it('orders newest-first on order: "desc"', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(WIRE))
    const result = payload(await tool.handler({ taskId: 23, order: 'desc' }))
    expect(result.comments.map((c: { id: number }) => c.id)).toEqual([111, 53, 51])
  })

  it('filters by authorId locally and reports total vs matched', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(WIRE))

    const result = payload(await tool.handler({ taskId: 23, authorId: 11 }))

    expect(result.total).toBe(3)
    expect(result.matched).toBe(1)
    expect(result.comments.map((c: { id: number }) => c.id)).toEqual([53])
    // The roll-up covers the whole thread, not just the filtered slice.
    expect(result.authors).toEqual([
      { id: 9, name: 'Иван', comments: 2 },
      { id: 11, name: 'Мария', comments: 1 },
    ])
  })

  it('pages with limit / offset without shortening any comment', async () => {
    fake.v2Call.mockResolvedValue(fakeOk(WIRE))

    const result = payload(await tool.handler({ taskId: 23, limit: 1, offset: 1 }))

    expect(result.returned).toBe(1)
    expect(result.offset).toBe(1)
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].id).toBe(53)
    expect(result.comments[0].text).toBe('второй')
  })

  it('handles an empty thread and an empty SDK payload', async () => {
    fake.v2Call.mockResolvedValue(fakeOk([] as unknown[]))
    expect(payload(await tool.handler({ taskId: 4153 }))).toMatchObject({
      total: 0,
      returned: 0,
      authors: [],
      comments: [],
    })

    fake.v2Call.mockResolvedValue(fakeOkEmpty())
    expect(payload(await tool.handler({ taskId: 4153 }))).toMatchObject({ total: 0, comments: [] })
  })

  it('accepts the legacy { result: [...] } envelope shape', async () => {
    fake.v2Call.mockResolvedValue(fakeOk({ result: WIRE }))
    expect(payload(await tool.handler({ taskId: 23 })).total).toBe(3)
  })

  it('wraps SDK errors into Bitrix24ToolError', async () => {
    fake.v2Call.mockRejectedValue(new Error('ACTION_FAILED_TO_BE_PROCESSED'))
    await expect(tool.handler({ taskId: 23 })).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      message: 'ACTION_FAILED_TO_BE_PROCESSED',
    })
  })
})
