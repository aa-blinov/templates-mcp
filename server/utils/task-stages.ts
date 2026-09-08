/**
 * Kanban stages ("фазы", the board columns) of a Bitrix24 project.
 *
 * Two things make stages awkward to drive from an agent, and both are handled
 * here rather than in the tools:
 *
 *   1. **A stage id means nothing on its own.** `tasks.task.list` returns
 *      `stageId: "757"`; whether that is "Ждёт релиза" or "Готово" depends on
 *      the project. So a move has to be expressed the way a person expresses
 *      it — by column title — and resolved against the board of the task's
 *      own group.
 *
 *   2. **Stages are per-entity.** Each project has its own column set
 *      (`ENTITY_TYPE: 'G'`, `ENTITY_ID` = group id); a personal kanban is a
 *      separate board (`'U'`). Sending a stage id that belongs to another
 *      board is accepted by some endpoints and silently does nothing useful,
 *      so the tools verify membership before moving anything.
 *
 * Resolution is deliberately forgiving on input and strict on ambiguity:
 * a numeric id must exist on the board, a title matches case- and
 * space-insensitively (and `ё`/`е` alike — "Ждёт релиза" is typed both ways),
 * and an unresolvable or ambiguous name comes back as an error that lists the
 * real column titles instead of guessing.
 */

/** One row of `task.stages.get`, as far as we read it. */
export interface StageRaw {
  ID?: string | number
  TITLE?: string
  SORT?: string | number
  COLOR?: string
  SYSTEM_TYPE?: string | null
  ENTITY_ID?: string | number
  ENTITY_TYPE?: string
}

export interface StageShort {
  id: number
  title: string
  sort: number
  color: string | null
  /** `NEW` / `FINISH` mark the columns Bitrix24 treats specially; '' for the rest. */
  systemType: string | null
  entityId: number | null
  entityType: string | null
}

function toInt(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function toStageShort(raw: StageRaw): StageShort | null {
  const id = toInt(raw.ID)
  if (id === null) return null
  return {
    id,
    title: typeof raw.TITLE === 'string' ? raw.TITLE : '',
    sort: toInt(raw.SORT) ?? 0,
    color: raw.COLOR ? `#${String(raw.COLOR).replace(/^#/, '')}` : null,
    systemType: raw.SYSTEM_TYPE ? String(raw.SYSTEM_TYPE) : null,
    entityId: toInt(raw.ENTITY_ID),
    entityType: raw.ENTITY_TYPE ? String(raw.ENTITY_TYPE) : null,
  }
}

/** `task.stages.get` answers with an id-keyed object, not an array. */
export function toStageList(result: unknown): StageShort[] {
  const rows = result && typeof result === 'object' ? Object.values(result as Record<string, StageRaw>) : []
  return rows
    .map(toStageShort)
    .filter((stage): stage is StageShort => stage !== null)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
}

/** Titles are compared loosely: people type "ждет релиза" for "Ждёт релиза". */
export function normalizeStageTitle(title: string): string {
  return title.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

export type StageResolution =
  | { ok: true, stage: StageShort }
  | { ok: false, reason: 'unknown-id' | 'unknown-title' | 'ambiguous-title', matches: StageShort[] }

/**
 * Resolve a stage the way an operator names it: by numeric id, or by column
 * title. Both are checked against the board that was actually fetched, so a
 * stage from another project can never slip through.
 */
export function resolveStage(stages: StageShort[], stage: string | number): StageResolution {
  const asNumber = typeof stage === 'number' ? stage : /^\d+$/.test(stage.trim()) ? Number(stage.trim()) : null
  if (asNumber !== null) {
    const found = stages.find((s) => s.id === asNumber)
    return found ? { ok: true, stage: found } : { ok: false, reason: 'unknown-id', matches: [] }
  }

  const needle = normalizeStageTitle(String(stage))
  const exact = stages.filter((s) => normalizeStageTitle(s.title) === needle)
  if (exact.length === 1) return { ok: true, stage: exact[0]! }
  if (exact.length > 1) return { ok: false, reason: 'ambiguous-title', matches: exact }

  // A prefix match covers "готово" for "Готово ✅" and "ждет" for "Ждёт релиза",
  // but only when it lands on exactly one column — otherwise the operator is
  // told which columns exist instead of getting a coin flip.
  const partial = stages.filter((s) => normalizeStageTitle(s.title).includes(needle))
  if (partial.length === 1) return { ok: true, stage: partial[0]! }
  if (partial.length > 1) return { ok: false, reason: 'ambiguous-title', matches: partial }
  return { ok: false, reason: 'unknown-title', matches: [] }
}

/** One-line board summary for an error message: "741 Новые, 743 Выполняются, …". */
export function describeStages(stages: StageShort[]): string {
  return stages.map((s) => `${s.id} ${s.title}`).join(', ')
}

/** Stage id `0` means the task was never placed on the board. */
export const STAGE_NOT_ON_BOARD = 0

/**
 * Attach the column title to tasks that carry a `stageId`.
 *
 * A listing that returns `stageId: "757"` is machine-readable and useless to
 * a person: the number only means something against the board it came from.
 * Boards are per project, so the caller passes them keyed by group id — and
 * `0` keys the personal kanban, the board a task outside any project sits on.
 *
 * Two states are deliberately distinguished in the output:
 *   - `stageTitle: null` with `stageId: "0"` — the task is not on a board;
 *   - `stageTitle: null` with a real id — the column is gone or belongs to a
 *     board we could not read, which is worth seeing rather than papering over.
 */
export function stageTitleFor(
  boardsByGroup: Map<number, StageShort[]>,
  groupId: number | null,
  stageId: number | null,
): string | null {
  if (stageId === null || stageId === STAGE_NOT_ON_BOARD) return null
  const board = boardsByGroup.get(groupId ?? STAGE_NOT_ON_BOARD)
  if (!board) return null
  return board.find((stage) => stage.id === stageId)?.title ?? null
}
