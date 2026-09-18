import { defineTaskLifecycleTool } from '~/server/utils/task-lifecycle'

/**
 * Subscribe the webhook user to a Bitrix24 task's notifications.
 *
 * Bitrix24 REST: tasks.task.startwatch (classic / v2 transport)
 *   https://apidocs.bitrix24.ru/api-reference/tasks/tasks-task-start-watch.html
 *
 * Not a status transition — verified live it never touches `status`. Under
 * the hood it's the same mechanism as `b24_task_auditor_add` (adds the
 * caller to `AUDITORS`), but this is the *self*-subscribe shortcut: no
 * `auditorId` to pass, no read-merge-write, just "follow this task for me".
 * Confirmed idempotent live: a repeat call while already watching succeeds
 * silently with the same end state, unlike the true lifecycle verbs which
 * error "action not allowed" on a same-state repeat. Issue #113.
 */
export default defineTaskLifecycleTool({
  name: 'b24_task_watch',
  method: 'tasks.task.startwatch',
  verb: 'watch',
  pastTense: 'watched',
  description:
    'Start watching a Bitrix24 task — subscribes the caller to its notifications without changing its status, responsible user, or any other field. Use for "следи за задачей N" / "подпишись на эту задачу". Safe to call repeatedly — already watching is a no-op, not an error. Counterpart: `b24_task_unwatch`. To watch on someone ELSE\'s behalf (add a specific user as an observer), use `b24_task_auditor_add` instead — this tool only subscribes the caller.',
  taskIdHint: 'Task id to watch. Get it from `b24_task_list` or `b24_task_create`.',
})
