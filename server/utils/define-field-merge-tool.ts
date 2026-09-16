import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { McpToolAnnotations } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

/**
 * Factory for "add/remove one or more values to a Bitrix24 whole-set field
 * without clobbering the rest" tools — the shape `b24_task_tag_add` /
 * `_remove` and `b24_task_auditor_add` / `_remove` all share: read the
 * task's current field via `tasks.task.get`, merge or diff against the
 * incoming values, write the union/difference back via `tasks.task.update`
 * only if it actually changed, and report which values were newly
 * added/removed vs. already in the expected state.
 *
 * Extracted after those four tools were found ~90% textually identical
 * (ponytail audit) — the only real per-domain differences are the value
 * type (tag title string vs. auditor user id number), how a value is
 * parsed off the wire (`toTagTitles` / `toAuditorIds`), how two values are
 * compared (`equals` — case-insensitive for tag titles, strict for ids),
 * and the merge/diff function itself (`addTags`/`removeTags` /
 * `addAuditors`/`removeAuditors`, all sharing the same
 * `{ next, changed }` return shape by convention).
 *
 * `resultKey` doubles as the response field name (`tags` / `auditors`) AND
 * the camelCase key Bitrix24 returns from `tasks.task.get` for that field
 * (`task.tags` / `task.auditors`) — true for every field this factory has
 * been used for so far; if a future field's response key diverges from its
 * result key, add a separate `wireResponseKey` to the spec rather than
 * assuming.
 */

export interface FieldMerge<TValue> {
  /** The set to write back. */
  next: TValue[]
  /** Values this call actually changes — empty means the write is pointless. */
  changed: TValue[]
}

export interface FieldMergeToolSpec<TValue> {
  /** MCP tool name, e.g. `b24_task_tag_add`. */
  name: string
  /** Full LLM-facing tool description — domain-specific, not generated. */
  description: string
  annotations: McpToolAnnotations
  /** Zod key for the value(s) to add/remove, e.g. `tags` or `auditorId`. */
  itemFieldName: string
  /** Schema for ONE value (the factory wraps it in a `value | value[]` union). */
  itemSchema: z.ZodType<TValue>
  itemDescribe: string
  taskIdDescribe: string
  /** Bitrix24 UPPER_SNAKE field name on the wire, e.g. `TAGS` / `AUDITORS`. */
  wireField: string
  /** Response field name AND the camelCase key `tasks.task.get` returns it under — see file doc. */
  resultKey: string
  /** Coerce whatever `tasks.task.get` / `tasks.task.update` returns for this field into a clean value list. */
  parse: (raw: unknown) => TValue[]
  /** `addTags`/`addAuditors` for the `_add` tool, `removeTags`/`removeAuditors` for `_remove`. */
  merge: (before: TValue[], incoming: TValue[]) => FieldMerge<TValue>
  /** Determines the response shape: `added`/`alreadyPresent` vs `removed`/`notPresent`. */
  verb: 'add' | 'remove'
  /** Two values are the same item — case-insensitive for tag titles, strict `===` for ids. Defaults to `===`. */
  equals?: (a: TValue, b: TValue) => boolean
}

interface TaskFieldEnvelope {
  task?: { id?: string | number, title?: string, [key: string]: unknown }
}

export function defineFieldMergeTool<TValue>(spec: FieldMergeToolSpec<TValue>) {
  const equals = spec.equals ?? ((a: TValue, b: TValue) => a === b)
  const changedKey = spec.verb === 'add' ? 'added' : 'removed'
  const untouchedKey = spec.verb === 'add' ? 'alreadyPresent' : 'notPresent'

  return defineMcpTool({
    name: spec.name,
    annotations: spec.annotations,
    description: spec.description,
    inputSchema: {
      taskId: z.number().int().positive().describe(spec.taskIdDescribe),
      [spec.itemFieldName]: z.union([spec.itemSchema, z.array(spec.itemSchema).min(1)]).describe(spec.itemDescribe),
    },
    handler: async (rawArgs: Record<string, unknown>) => {
      const taskId = rawArgs.taskId as number
      const rawItem = rawArgs[spec.itemFieldName]
      const incoming = Array.isArray(rawItem) ? (rawItem as TValue[]) : [rawItem as TValue]
      const b24 = useBitrix24Tenant()

      const current = await callV2<TaskFieldEnvelope>(
        b24,
        'tasks.task.get',
        { taskId, select: ['ID', 'TITLE', spec.wireField] },
        `Failed to read the ${spec.resultKey} of Bitrix24 task ${taskId}`,
      )
      const task = current?.task
      if (!task) {
        throw new Bitrix24ToolError(`Bitrix24 task ${taskId} not found.`, Bitrix24ErrorCode.INVALID_INPUT)
      }
      const before = spec.parse(task[spec.resultKey] ?? task[spec.wireField])
      const { next, changed } = spec.merge(before, incoming)

      if (changed.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                [changedKey]: [],
                [untouchedKey]: incoming,
                taskId,
                title: task.title ?? null,
                [spec.resultKey]: before,
              }),
            },
          ],
        }
      }

      const updated = await callV2<TaskFieldEnvelope>(
        b24,
        'tasks.task.update',
        { taskId, fields: { [spec.wireField]: next } },
        `Failed to ${spec.verb} ${spec.resultKey} on Bitrix24 task ${taskId}`,
      )
      const untouched = incoming.filter((item) => !changed.some((c) => equals(c, item)))

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              [changedKey]: changed,
              [untouchedKey]: untouched,
              taskId,
              title: task.title ?? null,
              [spec.resultKey]: spec.parse(updated?.task?.[spec.resultKey] ?? updated?.task?.[spec.wireField] ?? next),
            }),
          },
        ],
      }
    },
  })
}
