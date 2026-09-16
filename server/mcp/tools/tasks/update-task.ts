import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { SingleTaskEnvelope } from '~/server/types/bitrix24'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { extractTasks, TASK_STATUS } from '~/server/utils/tasks'

const MIN_STATUS = 1 // Bitrix24's floor; TASK_STATUS itself only names 2-7 (1 is legacy/rare).
const MAX_STATUS = Math.max(...Object.values(TASK_STATUS))
// CREATED_BY deliberately excluded: unlike RESPONSIBLE_ID/GROUP_ID it's not
// a field this MCP has confirmed Bitrix24 accepts on tasks.task.update (see
// create-task.ts's issue #125 note — creator attribution is unsettled even
// on create). Validating a field we haven't verified is writable is a guess
// dressed up as a guardrail; add it back once that's confirmed.
const POSITIVE_INT_ID_FIELDS = ['RESPONSIBLE_ID', 'GROUP_ID'] as const
const USER_ID_ARRAY_FIELDS = ['ACCOMPLICES', 'AUDITORS'] as const

function isPositiveIntId(v: unknown): boolean {
  return (typeof v === 'number' && Number.isInteger(v) && v > 0)
    || (typeof v === 'string' && /^[1-9]\d*$/.test(v))
}

/**
 * Value-level guard for a known-risky subset of `fields` (issue #124).
 * Key-shape was already locked down (UPPER_SNAKE_CASE regex below); this
 * catches values that would either bypass the lifecycle tools' own
 * business logic (an out-of-range `STATUS` skips whatever `b24_task_start`
 * / `_complete` / … would have checked) or crash mid-request on a
 * type Bitrix24 doesn't expect (an object where a scalar id belongs).
 *
 * Deliberately narrow — `fields` also carries free-form UF_* custom fields
 * and every other built-in Bitrix24 field, whose shapes we don't model
 * here. Widening this list is cheap (add a case) if another field turns
 * out to need it; validating everything up front is not this project's
 * job — Bitrix24 already rejects malformed wire data with its own error.
 */
function validateTaskFields(fields: Record<string, unknown>, ctx: z.RefinementCtx): void {
  if ('STATUS' in fields) {
    const status = fields.STATUS
    const n = typeof status === 'number' ? status : typeof status === 'string' ? Number(status) : Number.NaN
    if (!Number.isInteger(n) || n < MIN_STATUS || n > MAX_STATUS) {
      ctx.addIssue({
        code: 'custom',
        path: ['STATUS'],
        message: `STATUS must be an integer ${MIN_STATUS}-${MAX_STATUS} (Bitrix24 task status codes). `
          + 'To move a task through its lifecycle, prefer b24_task_start / _complete / _pause / _defer / _renew — '
          + 'they enforce the valid transitions Bitrix24 itself checks; writing STATUS directly bypasses that.',
      })
    }
  }

  for (const key of POSITIVE_INT_ID_FIELDS) {
    if (key in fields && !isPositiveIntId(fields[key])) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be a positive integer user/group id.` })
    }
  }

  for (const key of USER_ID_ARRAY_FIELDS) {
    if (key in fields) {
      const v = fields[key]
      if (!Array.isArray(v) || !v.every(isPositiveIntId)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be an array of positive integer user ids.` })
      }
    }
  }
}

/**
 * Updates a Bitrix24 task in place.
 *
 * Bitrix24 REST: tasks.task.update (classic / v2 transport)
 *   https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-update.html
 *
 * This is the classic `tasks.task.*` API, served on the v2 transport
 * (`callV2`), NOT rest-v3 — the v3 `TaskDto` rejects these UPPERCASE keys with
 * `UNKNOWNDTOPROPERTYEXCEPTION`. The method takes UPPERCASE field keys; we pass
 * `fields` through untouched so the agent has full reach into the field set
 * without us having to enumerate every option.
 */
export default defineMcpTool({
  name: 'b24_task_update',
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  description:
    'Update an existing Bitrix24 task. `fields` is an object of UPPERCASE Bitrix24 task field names (TITLE, DESCRIPTION, DEADLINE, RESPONSIBLE_ID, STATUS, PRIORITY, GROUP_ID, …). Only provide the fields you want to change. Returns the updated task summary.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task id from `b24_task_list` or `b24_task_create`.'),
    fields: z
      .record(
        // Constrain keys to the Bitrix24 UPPER_SNAKE_CASE field shape so an LLM
        // can't smuggle arbitrary strings into the REST payload. Every Bitrix24
        // task field — built-in and user-defined (UF_*) — matches this.
        z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'field keys must be UPPER_SNAKE_CASE (e.g. TITLE, RESPONSIBLE_ID)'),
        z.unknown(),
      )
      .refine((f) => Object.keys(f).length > 0, { message: 'fields must be a non-empty object' })
      .superRefine(validateTaskFields)
      .describe(
        'Fields to change. Keys UPPERCASE: TITLE | DESCRIPTION | DEADLINE (ISO 8601) | RESPONSIBLE_ID (int) | STATUS (int) | PRIORITY ("0"|"1"|"2") | GROUP_ID (int) | ACCOMPLICES / AUDITORS (array of user ids — note these REPLACE the current set, fetch first if you want to add). Example: { "TITLE": "renamed", "DEADLINE": "2026-06-01T18:00:00+03:00", "ACCOMPLICES": [12, 47] }.',
      ),
  },
  handler: async ({ taskId, fields }) => {
    const b24 = useBitrix24Tenant()
    const result = await callV2<SingleTaskEnvelope>(
      b24,
      'tasks.task.update',
      { taskId, fields },
      `Failed to update Bitrix24 task ${taskId}`,
    )
    const [task] = extractTasks(result)

    if (!task) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Task ${taskId} updated, but Bitrix24 returned no task body. Re-list to verify the change landed.`,
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            updated: true,
            id: task.id,
            title: task.title,
            deadline: task.deadline ?? null,
            responsibleId: task.responsibleId ?? null,
            status: task.status ?? null,
          }),
        },
      ],
    }
  },
})
