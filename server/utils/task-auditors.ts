/**
 * Task auditors (observers / наблюдатели) — the `AUDITORS` field.
 *
 * Same shape of problem as `task-tags.ts`, one size simpler: auditors are
 * plain positive user ids, no title-vs-id indirection and no per-project
 * scoping. The one thing that matters: **`AUDITORS` is a whole-set field**
 * on `tasks.task.update` — writing `[12]` onto a task watched by 12 and 47
 * silently drops 47. `b24_task_auditor_add` / `_remove` read the current
 * set, merge, and write the union/difference back (issue #113).
 */

/** Coerce whatever `tasks.task.get` returns for `auditors` into a clean id list. */
export function toAuditorIds(raw: unknown): number[] {
  if (raw === null || raw === undefined) return []
  const entries = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.values(raw) : []
  const ids: number[] = []
  for (const entry of entries) {
    const n = typeof entry === 'number' ? entry : typeof entry === 'string' ? Number.parseInt(entry, 10) : Number.NaN
    if (Number.isInteger(n) && n > 0) ids.push(n)
  }
  return ids
}

export interface AuditorMerge {
  /** The set to write back. */
  next: number[]
  /** Ids this call actually changes — empty means the write is pointless. */
  changed: number[]
}

/** Union `before` with `incoming`, reporting only the ids that were actually new. */
export function addAuditors(before: number[], incoming: number[]): AuditorMerge {
  const seen = new Set(before)
  const changed: number[] = []
  for (const id of incoming) {
    if (seen.has(id)) continue
    seen.add(id)
    changed.push(id)
  }
  return { next: [...before, ...changed], changed }
}

/** Subtract `outgoing` from `before`, reporting only the ids that were actually present. */
export function removeAuditors(before: number[], outgoing: number[]): AuditorMerge {
  const drop = new Set(outgoing)
  const changed = before.filter((id) => drop.has(id))
  const next = before.filter((id) => !drop.has(id))
  return { next, changed }
}
