import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { TaskListEnvelope } from '~/server/types/bitrix24'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { batchV2, callV2 } from '~/server/utils/sdk-helpers'
import {
  type StageRaw,
  type StageShort,
  STAGE_NOT_ON_BOARD,
  stageTitleFor,
  toStageList,
} from '~/server/utils/task-stages'
import { toNumber } from '~/server/utils/wire-coerce'
import {
  normalizeBitrix24Filter,
  normalizeBitrix24Order,
  normalizeBitrix24Select,
  toTaskShort,
  type TaskShort,
} from '~/server/utils/tasks'

const DEFAULT_SELECT_CAMEL = ['id', 'title', 'status', 'deadline', 'responsibleId', 'createdDate', 'priority']
const DEFAULT_SELECT_WIRE = normalizeBitrix24Select(DEFAULT_SELECT_CAMEL)

/** `STAGE_ID` is uninterpretable without the board, and the board is the
 *  task's project — so asking for the stage implies asking for the group. */
function withGroupIdForStages(wire: string[]): string[] {
  if (!wire.includes('STAGE_ID') || wire.includes('GROUP_ID')) return wire
  return [...wire, 'GROUP_ID']
}

/**
 * Lists Bitrix24 tasks with filter / order / pagination.
 *
 * Bitrix24 REST: tasks.task.list
 *   https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-list.html
 *
 * This is the classic `tasks.task.*` API, served on the v2 transport
 * (`callV2`). rest-v3 does NOT implement `tasks.task.list` ("restApi:v3 not
 * support method tasks.task.list"), so it must go through v2. The wire
 * contract for `filter` / `order` / `select` is legacy `UPPER_SNAKE_CASE`.
 * We accept camelCase from the LLM (matching every other task tool in this
 * MCP) and translate to UPPER_SNAKE at the boundary via `normalizeBitrix24Key`.
 * Legacy UPPERCASE input is passed through unchanged, so callers that learned
 * the old contract still work.
 *
 * Page size is fixed at 50 by Bitrix24. Use `start` to paginate
 * (start = (pageNumber - 1) * 50).
 */
export default defineMcpTool({
  name: 'b24_task_list',
  description:
    'List Bitrix24 tasks. Filter / order / select keys are camelCase task fields (`responsibleId`, `status`, `deadline`, `groupId`, …) — same convention as every other task tool. Legacy UPPERCASE keys (`RESPONSIBLE_ID`, `STATUS`, …) are also accepted. Page size is fixed at 50 by Bitrix24; use `start` for pagination ((page-1)*50). Returns a trimmed list by default — id/title/status/deadline/responsibleId/createdDate/priority. To read a task BODY, add `description` to `select`: it then comes back in full (never truncated) together with `descriptionInBbcode` — true means the body is BBCode, false means HTML. Bodies run to thousands of characters, so ask for `description` when you actually need to read the task, not for a routine listing; narrow the `filter` first. `groupId`, `stageId`, `createdBy`, `parentId`, `changedDate` and `closedDate` also come back when you put them in `select` (use `parentId` to walk subtasks). Asking for `stageId` gives you the kanban column in readable form: the same call resolves `stageTitle` ("Ждёт релиза") against the board of the project each task belongs to, and brings `groupId` along because a stage id means nothing without its board. `stageTitle: null` with `stageId: "0"` means the task is not on a board at all.',
  inputSchema: {
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Filter object. Keys are camelCase task fields with optional operator prefixes: `!` (not equal), `>=` / `<=` (range), `%` (LIKE). Examples: { responsibleId: 5 } | { "!status": 5 } (not completed) | { ">=deadline": "2026-05-16T00:00:00+03:00" } (deadline today or later) | { "%title": "договор" } (LIKE match on title). UPPERCASE forms (RESPONSIBLE_ID, "!STATUS", …) also accepted. Omit for no filter (returns the most recent 50).',
      ),
    order: z
      .record(z.string(), z.enum(['asc', 'desc']))
      .optional()
      .describe(
        'Sort. Keys are camelCase field names (`deadline`, `priority`, `createdDate`, …; UPPERCASE accepted). Default is { id: "desc" } (newest first).',
      ),
    select: z
      .array(z.string())
      .optional()
      .describe(
        `Fields to return as camelCase names. Defaults to ${DEFAULT_SELECT_CAMEL.join(', ')} — note the default does NOT include the task body. Add \`description\` to get it (plus the \`descriptionInBbcode\` markup flag Bitrix24 ships with it). UPPERCASE forms accepted. Always set this explicitly when you need a predictable shape.`,
      ),
    start: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Pagination offset (0 = first page, 50 = second, …). Omit for first page.'),
  },
  handler: async ({ filter, order, select, start }) => {
    const b24 = useBitrix24Tenant()
    const data = await callV2<TaskListEnvelope>(
      b24,
      'tasks.task.list',
      {
        filter: filter ? normalizeBitrix24Filter(filter) : {},
        order: order ? normalizeBitrix24Order(order) : { ID: 'desc' },
        // Resolving a stage title needs the task's project, so `stageId` in
        // the select quietly brings `GROUP_ID` along. Without it Bitrix24
        // returns the stage id and nothing to interpret it against.
        select: select ? withGroupIdForStages(normalizeBitrix24Select(select)) : DEFAULT_SELECT_WIRE,
        start: start ?? 0,
      },
      'Failed to list Bitrix24 tasks',
    )
    // The projection drops the task body unless it was asked for — see
    // `ToTaskShortOptions.withDescription`. `select` is the operator's
    // request, so match on it rather than on what Bitrix24 happened to
    // return: DESCRIPTION_IN_BBCODE rides along automatically and must not
    // be enough on its own to switch the body on. Accept either casing,
    // matching `normalizeBitrix24Select`'s tolerance.
    const wantsDescription = (select ?? []).some((field) => {
      const normalized = field.trim().toLowerCase()
      return normalized === 'description' || normalized === 'descriptioninbbcode'
    })
    const wantsStage = (select ?? []).some((field) => {
      const normalized = field.trim().toLowerCase().replace(/_/g, '')
      return normalized === 'stageid'
    })

    const tasks: TaskShort[] = (data?.tasks ?? [])
      .map((task) => toTaskShort(task, { withDescription: wantsDescription }))
      .filter((t): t is TaskShort => t !== null)

    // A bare `stageId: "757"` is unreadable: the number only means something
    // against the board it came from, and boards are per project. So when the
    // caller asked for the stage, the titles are resolved in the SAME tool
    // call — one `task.stages.get` per distinct project, all in one batch, so
    // this costs a single extra HTTP roundtrip and never a call per task.
    if (wantsStage && tasks.length > 0) {
      const groupIds = [
        ...new Set(tasks.filter((t) => t.stageId !== undefined).map((t) => toNumber(t.groupId) ?? STAGE_NOT_ON_BOARD)),
      ]
      if (groupIds.length > 0) {
        const rows = await batchV2<Record<string, StageRaw>>(
          b24,
          groupIds.map((groupId) => [
            'task.stages.get',
            // Group 0 is "no project": that task sits on the personal kanban,
            // which `task.stages.get` returns when no entity is passed.
            groupId === STAGE_NOT_ON_BOARD ? {} : { entityId: groupId },
          ]),
          'Failed to read the kanban stages behind the tasks',
        )
        const boards = new Map<number, StageShort[]>()
        rows.forEach((row, index) => {
          const groupId = groupIds[index]
          if (groupId === undefined) return
          // A board that failed to load leaves `stageTitle: null` rather than
          // failing the whole listing — the ids still answer the query.
          boards.set(groupId, row.isSuccess ? toStageList(row.getData()?.result) : [])
        })
        for (const task of tasks) {
          if (task.stageId === undefined) continue
          task.stageTitle = stageTitleFor(boards, toNumber(task.groupId), toNumber(task.stageId))
        }
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            // Bitrix24 normally returns `total` (count across all pages).
            // Fall back to `null` if the API didn't supply it — reporting
            // the page-slice length would silently lie about pagination.
            total: typeof data?.total === 'number' ? data.total : null,
            returned: tasks.length,
            tasks,
          }),
        },
      ],
    }
  },
})
