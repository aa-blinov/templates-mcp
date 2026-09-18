import { defineTaskLifecycleTool } from '~/server/utils/task-lifecycle'

/**
 * Unsubscribe the webhook user from a Bitrix24 task's notifications.
 *
 * Bitrix24 REST: tasks.task.stopwatch (classic / v2 transport)
 *   https://apidocs.bitrix24.ru/api-reference/tasks/tasks-task-stop-watch.html
 *
 * Mirror of `b24_task_watch` — see that file's doc. Not a status transition;
 * confirmed idempotent live (repeat call while already not watching
 * succeeds silently). Issue #113.
 */
export default defineTaskLifecycleTool({
  name: 'b24_task_unwatch',
  method: 'tasks.task.stopwatch',
  verb: 'unwatch',
  pastTense: 'unwatched',
  description:
    'Stop watching a Bitrix24 task the caller previously subscribed to — reverses `b24_task_watch`. Use for "перестань следить за задачей N". Safe to call repeatedly — already not watching is a no-op, not an error. To remove a DIFFERENT user\'s observer status, use `b24_task_auditor_remove` instead — this tool only unsubscribes the caller.',
  taskIdHint: 'Task id to stop watching. Get it from `b24_task_list` or `b24_task_create`.',
})
