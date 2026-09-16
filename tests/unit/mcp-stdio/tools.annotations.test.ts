import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the MCP client-hint contract (`readOnlyHint` / `destructiveHint` /
 * `idempotentHint` / `openWorldHint`) across every tool — clients use these
 * to decide whether to prompt the operator for confirmation, independent of
 * (and in addition to) this project's own `confirmDelete` gate. Added after
 * an audit found ZERO of the 47 shipped tools set any annotation, despite
 * `@nuxtjs/mcp-toolkit`'s `defineMcpTool` fully supporting them.
 *
 * Same text-scan strategy as `tools.parity.test.ts` (source strings, not
 * `import()`), for the same reason: tool files pull in Nitro virtual
 * modules unreachable from a bare Vitest unit.
 *
 * Two ways a tool file can satisfy the contract:
 *   1. Direct `defineMcpTool({...})` — its own source must contain a literal
 *      `annotations:` key.
 *   2. Built atop `defineActionTool` / `defineTaskLifecycleTool` /
 *      `defineChecklistActionTool` — those factories always inject
 *      `annotations` themselves (unit-tested at the factory level; see
 *      `define-action-tool.test.ts` et al.), so a leaf file delegating to
 *      one of them satisfies the contract without repeating the key.
 *
 * Failure mode this catches: a new tool ships via a bare `defineMcpTool`
 * call with no `annotations`, silently reverting to "client has no hint at
 * all" for that one tool.
 */

const PROJECT_ROOT = resolve(__dirname, '../../..')
const HTTP_TOOLS_DIR = join(PROJECT_ROOT, 'server/mcp/tools')

const FACTORY_MARKERS = ['defineActionTool<', 'defineActionTool(', 'defineTaskLifecycleTool(', 'defineChecklistActionTool(']

async function listHttpToolFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listHttpToolFiles(full)))
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('every MCP tool sets client-hint annotations', () => {
  it('directly, or by delegating to a factory that always injects them', async () => {
    const files = await listHttpToolFiles(HTTP_TOOLS_DIR)
    expect(files.length, 'HTTP tools directory unexpectedly empty').toBeGreaterThan(0)

    const missing: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const usesFactory = FACTORY_MARKERS.some((marker) => source.includes(marker))
      const hasDirectAnnotations = source.includes('annotations:')
      if (!usesFactory && !hasDirectAnnotations) missing.push(file.replace(`${PROJECT_ROOT}/`, ''))
    }

    expect(missing, 'tools with no annotations and no factory delegation — add `annotations: {...}` to defineMcpTool').toEqual([])
  })
})
