/**
 * Task tags — the field a team uses for release markers and priorities.
 *
 * Two things about tags shape everything here:
 *
 *   1. **The wire shape is an id-keyed object, not a list.** `tasks.task.get`
 *      answers `tags: {"197": {"id": 197, "title": "P1"}}`. People think in
 *      titles ("P1", "R260916"), so titles are what the tools surface.
 *
 *   2. **Tags are per project.** The same title is a different tag in another
 *      project: "P1" is id 197 on one board and 229 on the next. Titles are
 *      therefore the only portable handle, which is another reason the tools
 *      never take or return tag ids. A tag filter matches by title and so
 *      crosses projects — narrow it with `groupId` when that matters.
 *
 *   3. **Writing `TAGS` replaces the whole set.** A task tagged `P1` and
 *      `R260916` that gets `TAGS: ["R260923"]` silently loses both — and with
 *      them the priority and the release it belonged to. Adding or removing
 *      one tag therefore has to read the current set and write the merge,
 *      which is exactly what `b24_task_tag_add` / `b24_task_tag_remove` do.
 */

/** One tag entry as it arrives on the wire. */
export interface TagRaw {
  id?: number | string
  title?: string
  ID?: number | string
  TITLE?: string
}

/**
 * Titles of a task's tags, in the order Bitrix24 listed them.
 *
 * Tolerates every shape seen in the wild: the id-keyed object from
 * `tasks.task.get`, a plain array of entries, and a plain array of strings
 * (which is what a `TAGS` write takes, so an echoed update comes back that
 * way).
 */
export function toTagTitles(raw: unknown): string[] {
  if (raw === null || raw === undefined) return []
  const entries = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.values(raw) : []
  const titles: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry.trim() !== '') titles.push(entry)
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const tag = entry as TagRaw
    const title = tag.title ?? tag.TITLE
    if (typeof title === 'string' && title.trim() !== '') titles.push(title)
  }
  return titles
}

/** Tags differing only in case are the same tag to a person. */
function key(tag: string): string {
  return tag.trim().toLowerCase()
}

/** Drop blanks and case-duplicates, keeping the first spelling seen. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed === '') continue
    if (seen.has(key(trimmed))) continue
    seen.add(key(trimmed))
    out.push(trimmed)
  }
  return out
}

export interface TagMerge {
  /** The set to write back, existing tags first. */
  next: string[]
  /** Tags this call actually changes — empty means the write is pointless. */
  changed: string[]
}

/** Existing tags plus the new ones, without touching what was already there. */
export function addTags(current: string[], incoming: string[]): TagMerge {
  const existing = normalizeTags(current)
  const known = new Set(existing.map(key))
  const changed: string[] = []
  for (const tag of normalizeTags(incoming)) {
    if (known.has(key(tag))) continue
    known.add(key(tag))
    changed.push(tag)
  }
  return { next: [...existing, ...changed], changed }
}

/** Existing tags minus the named ones; unknown names change nothing. */
export function removeTags(current: string[], outgoing: string[]): TagMerge {
  const existing = normalizeTags(current)
  const drop = new Set(normalizeTags(outgoing).map(key))
  const next = existing.filter((tag) => !drop.has(key(tag)))
  const changed = existing.filter((tag) => drop.has(key(tag)))
  return { next, changed }
}

export interface TagUsage {
  title: string
  tasks: number
}

/**
 * The tag vocabulary of a set of tasks, most used first.
 *
 * Bitrix24 has no REST method that lists the tags of a project — the
 * `Task\Tag` controller has no `list` action — so the only way to answer
 * "which release markers exist here" is to aggregate over the tasks
 * themselves. Titles are counted case-insensitively but reported in the
 * spelling they first appeared in, the same rule the merge helpers follow.
 */
export function tagUsage(tagsPerTask: string[][]): TagUsage[] {
  const counts = new Map<string, TagUsage>()
  for (const tags of tagsPerTask) {
    // A tag counts once per task even if the task lists it twice.
    for (const title of normalizeTags(tags)) {
      const k = title.trim().toLowerCase()
      const seen = counts.get(k)
      if (seen) seen.tasks += 1
      else counts.set(k, { title: title.trim(), tasks: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.tasks - a.tasks || a.title.localeCompare(b.title))
}
