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

const tool = (await import('../../../../server/mcp/tools/tasks/list-group-task-time')).default as unknown as {
  handler: (input: { groupId: number }) => Promise<ToolContent>
}

const task = (id: number, seconds: string) => ({
  id: String(id),
  title: `task ${id}`,
  status: '5',
  groupId: '95',
  closedDate: '2026-10-09T10:00:00+05:00',
  timeSpentInLogs: seconds,
})

describe('b24_group_task_time_list', () => {
  beforeEach(() => {
    fake.v2Call.mockReset()
  })

  it('pages tasks.task.list by 50 until the total is reached and sums the hours', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => task(i + 1, '3600'))
    const secondPage = [task(51, '0'), task(52, '1800'), task(53, '0')]
    fake.v2Call
      .mockResolvedValueOnce(fakeOk({ tasks: firstPage, total: 53 }))
      .mockResolvedValueOnce(fakeOk({ tasks: secondPage, total: 53 }))

    const result = await tool.handler({ groupId: 95 })

    expect(fake.v2Call).toHaveBeenCalledTimes(2)
    expect(fake.v2Call.mock.calls[0]![0]).toMatchObject({
      method: 'tasks.task.list',
      params: { filter: { GROUP_ID: 95 }, order: { ID: 'ASC' }, start: 0 },
    })
    expect(fake.v2Call.mock.calls[1]![0]).toMatchObject({ params: { start: 50 } })

    const body = JSON.parse(result.content[0]!.text)
    expect(body.groupId).toBe(95)
    expect(body.returned).toBe(53)
    expect(body.totalHours).toBe(50 + 0.5)
    expect(body.tasks[50]).toEqual({
      id: '51',
      title: 'task 51',
      status: '5',
      groupId: '95',
      closedDate: '2026-10-09T10:00:00+05:00',
      timeSpentSeconds: 0,
      hours: 0,
    })
  })

  it('returns tasks with no time as 0-hour rows and stops after one page when total is small', async () => {
    fake.v2Call.mockResolvedValueOnce(fakeOk({ tasks: [task(1, '0')], total: 1 }))

    const result = await tool.handler({ groupId: 105 })

    expect(fake.v2Call).toHaveBeenCalledTimes(1)
    const body = JSON.parse(result.content[0]!.text)
    expect(body).toEqual({
      groupId: 105,
      returned: 1,
      totalHours: 0,
      tasks: [
        { id: '1', title: 'task 1', status: '5', groupId: '95', closedDate: '2026-10-09T10:00:00+05:00', timeSpentSeconds: 0, hours: 0 },
      ],
    })
  })
})
