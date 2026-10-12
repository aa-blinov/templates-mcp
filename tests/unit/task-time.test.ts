import { describe, expect, it } from 'vitest'
import { summarizeTaskTime } from '../../server/utils/task-time'
import { toTaskShort } from '../../server/utils/tasks'

describe('toTaskShort timeSpentInLogs', () => {
  it('projects TIME_SPENT_IN_LOGS when Bitrix24 ships it (camelCase and UPPERCASE)', () => {
    expect(toTaskShort({ id: 1, timeSpentInLogs: '1800' })?.timeSpentInLogs).toBe('1800')
    expect(toTaskShort({ ID: '1', TIME_SPENT_IN_LOGS: '0' })?.timeSpentInLogs).toBe('0')
  })

  it('leaves the field out of a default listing', () => {
    expect(toTaskShort({ ID: '1', TITLE: 'demo' })).not.toHaveProperty('timeSpentInLogs')
  })
})

describe('summarizeTaskTime', () => {
  it('keeps tasks without time as 0-hour rows and sums the total from seconds', () => {
    const summary = summarizeTaskTime([
      { id: 1, title: 'a', status: '5', closedDate: '2026-10-09T10:00:00+05:00', timeSpentInLogs: '5400' },
      { id: 2, title: 'b', status: '2', timeSpentInLogs: '0' },
      { id: 3, title: 'c', status: '3' },
    ])
    expect(summary.rows.map((r) => [r.id, r.hours])).toEqual([[1, 1.5], [2, 0], [3, 0]])
    expect(summary.totalSeconds).toBe(5400)
    expect(summary.totalHours).toBe(1.5)
    expect(summary.rows[0]).toEqual({
      id: 1,
      title: 'a',
      status: '5',
      closedDate: '2026-10-09T10:00:00+05:00',
      timeSpentSeconds: 5400,
      hours: 1.5,
    })
    expect(summary.rows[1]).not.toHaveProperty('closedDate')
  })

  it('rounds hours to two decimals and totals from seconds, not from rounded rows', () => {
    // 1000 s is 0.2778 h, so each row shows 0.28 but the total must be
    // 3000 s = 0.83 h, not 3 * 0.28 = 0.84.
    const tasks = Array.from({ length: 3 }, (_, i) => ({ id: i, timeSpentInLogs: '1000' }))
    const summary = summarizeTaskTime(tasks)
    expect(summary.rows[0]!.hours).toBe(0.28)
    expect(summary.totalHours).toBe(0.83)
  })

  it('treats a missing or malformed value as zero time', () => {
    expect(summarizeTaskTime([{ id: 1, timeSpentInLogs: 'x' }]).totalSeconds).toBe(0)
  })
})
