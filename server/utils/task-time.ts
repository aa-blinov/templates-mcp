import type { TaskShort } from '~/server/utils/tasks'

/**
 * Pure summary for a project time report: one row per task, hours from
 * `timeSpentInLogs` (seconds). A task with no logged time keeps its row with
 * `0` hours, so the report lists every task of the project, not only the
 * ones that have time on them.
 */

export interface TaskTimeRow {
  id: number | string
  title?: string
  status?: string
  groupId?: string
  closedDate?: string | null
  timeSpentSeconds: number
  hours: number
}

export interface TaskTimeSummary {
  totalSeconds: number
  totalHours: number
  rows: TaskTimeRow[]
}

const toSeconds = (value: string | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function summarizeTaskTime(tasks: TaskShort[]): TaskTimeSummary {
  let totalSeconds = 0
  const rows = tasks.map((task): TaskTimeRow => {
    const timeSpentSeconds = toSeconds(task.timeSpentInLogs)
    totalSeconds += timeSpentSeconds
    return {
      id: task.id,
      ...(task.title !== undefined ? { title: task.title } : {}),
      ...(task.status !== undefined ? { status: task.status } : {}),
      ...(task.groupId !== undefined ? { groupId: task.groupId } : {}),
      ...(task.closedDate !== undefined ? { closedDate: task.closedDate } : {}),
      timeSpentSeconds,
      hours: Math.round((timeSpentSeconds / 3600) * 100) / 100,
    }
  })
  return {
    totalSeconds,
    // Summed from seconds, not from the rounded per-row hours, so the total
    // does not drift by a few hundredths over a few hundred tasks.
    totalHours: Math.round((totalSeconds / 3600) * 100) / 100,
    rows,
  }
}
