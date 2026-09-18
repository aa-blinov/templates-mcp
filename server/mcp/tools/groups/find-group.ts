import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'

/** Subset of the `sonet_group.get` row shape we surface back to the agent. */
interface GroupRow {
  ID?: string | number
  NAME?: string
  DESCRIPTION?: string
  ACTIVE?: string | boolean
  OWNER_ID?: string | number
  NUMBER_OF_MEMBERS?: string | number
}

function toNum(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
  return Number.isFinite(n) ? n : null
}

/**
 * Find a Bitrix24 workgroup / project by name — resolves the `groupId`
 * every task tool needs (`b24_task_list` filter, `b24_task_create` /
 * `b24_task_update`'s `GROUP_ID`) from what an operator actually says
 * ("создай задачу в проекте Маркетинг").
 *
 * Bitrix24 REST: sonet_group.get (v2 — no v3 equivalent)
 *   https://apidocs.bitrix24.com/api-reference/socialnetwork/sonet-group/sonet-group-get.html
 *
 * Issue #117.
 */
export default defineMcpTool({
  name: 'b24_group_find',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'Find a Bitrix24 workgroup / project by name (LIKE match, case-insensitive on most portals). Use this BEFORE any task tool that needs a `groupId` — operators name projects, not numeric ids. Returns id, name, description, active flag, owner id, and member count for each match.',
  inputSchema: {
    query: z.string().min(1).describe('Project name or a fragment of it, e.g. "Маркетинг", "test".'),
    limit: z.number().int().min(1).max(50).optional().describe('Cap on the returned matches. Default 10.'),
  },
  handler: async ({ query, limit }) => {
    if (!query.trim()) {
      throw new Bitrix24ToolError('Provide a non-empty `query` to search projects by name.', Bitrix24ErrorCode.INVALID_INPUT)
    }

    const b24 = useBitrix24Tenant()
    const all
      = (await callV2<GroupRow[]>(
          b24,
          'sonet_group.get',
          { FILTER: { '%NAME': query }, sort: 'NAME', order: 'ASC' },
          'Failed to search Bitrix24 projects',
        ))
      ?? []

    const cap = limit ?? 10
    const groups = all.slice(0, cap).map((g) => ({
      id: toNum(g.ID),
      name: g.NAME || null,
      description: g.DESCRIPTION || null,
      active: g.ACTIVE === 'Y' || g.ACTIVE === true,
      ownerId: toNum(g.OWNER_ID),
      memberCount: toNum(g.NUMBER_OF_MEMBERS),
    }))

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ returned: groups.length, returnedByApi: all.length, groups }),
        },
      ],
    }
  },
})
