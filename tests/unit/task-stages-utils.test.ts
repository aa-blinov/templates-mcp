import { describe, expect, it } from 'vitest'
import {
  describeStages,
  normalizeStageTitle,
  resolveStage,
  STAGE_NOT_ON_BOARD,
  stageTitleFor,
  toStageList,
  toStageShort,
} from '../../server/utils/task-stages'

/** The shape `task.stages.get` really answers with: an id-keyed object. */
const BOARD = {
  741: { ID: '741', TITLE: 'Новые', SORT: '100', COLOR: '00C4FB', SYSTEM_TYPE: 'NEW', ENTITY_ID: '42', ENTITY_TYPE: 'G' },
  757: { ID: '757', TITLE: 'Ждёт релиза', SORT: '500', COLOR: 'ffab00', SYSTEM_TYPE: '', ENTITY_ID: '42', ENTITY_TYPE: 'G' },
  749: { ID: '749', TITLE: 'Готово', SORT: '700', COLOR: '47d1e2', SYSTEM_TYPE: 'FINISH', ENTITY_ID: '42', ENTITY_TYPE: 'G' },
  743: { ID: '743', TITLE: 'Выполняются', SORT: '400', COLOR: '2fc6f6', SYSTEM_TYPE: '', ENTITY_ID: '42', ENTITY_TYPE: 'G' },
}

describe('toStageShort', () => {
  it('coerces the stringified wire shape and prefixes the colour', () => {
    expect(toStageShort(BOARD[741])).toEqual({
      id: 741,
      title: 'Новые',
      sort: 100,
      color: '#00C4FB',
      systemType: 'NEW',
      entityId: 42,
      entityType: 'G',
    })
  })

  it('normalises an empty SYSTEM_TYPE to null', () => {
    expect(toStageShort(BOARD[757])?.systemType).toBeNull()
  })

  it('refuses a row without an id', () => {
    expect(toStageShort({ TITLE: 'Без id' })).toBeNull()
  })
})

describe('toStageList', () => {
  it('turns the id-keyed object into a list ordered by SORT', () => {
    expect(toStageList(BOARD).map((s) => s.title)).toEqual([
      'Новые',
      'Выполняются',
      'Ждёт релиза',
      'Готово',
    ])
  })

  it('tolerates an empty or non-object result', () => {
    expect(toStageList({})).toEqual([])
    expect(toStageList(null)).toEqual([])
  })
})

describe('normalizeStageTitle', () => {
  it('folds case, ё/е and repeated spaces', () => {
    expect(normalizeStageTitle('  Ждёт   Релиза ')).toBe('ждет релиза')
  })
})

describe('resolveStage', () => {
  const stages = toStageList(BOARD)

  it('resolves a numeric id that exists on the board', () => {
    const resolved = resolveStage(stages, 757)
    expect(resolved.ok && resolved.stage.title).toBe('Ждёт релиза')
  })

  it('resolves a numeric id passed as a string', () => {
    const resolved = resolveStage(stages, '749')
    expect(resolved.ok && resolved.stage.id).toBe(749)
  })

  it('refuses an id from another board instead of moving blindly', () => {
    const resolved = resolveStage(stages, 791)
    expect(resolved).toEqual({ ok: false, reason: 'unknown-id', matches: [] })
  })

  it('matches a title the way a person types it', () => {
    for (const typed of ['Ждёт релиза', 'ждет релиза', 'ЖДЕТ РЕЛИЗА', '  ждёт  релиза ']) {
      const resolved = resolveStage(stages, typed)
      expect(resolved.ok && resolved.stage.id).toBe(757)
    }
  })

  it('accepts a unique prefix', () => {
    const resolved = resolveStage(stages, 'готов')
    expect(resolved.ok && resolved.stage.id).toBe(749)
  })

  it('reports ambiguity with the candidates rather than picking one', () => {
    const twoColumns = toStageList({
      1: { ID: '1', TITLE: 'Ждёт релиза', SORT: '100' },
      2: { ID: '2', TITLE: 'Ждёт дизайна', SORT: '200' },
    })
    const resolved = resolveStage(twoColumns, 'ждет')
    expect(resolved.ok).toBe(false)
    expect(!resolved.ok && resolved.reason).toBe('ambiguous-title')
    expect(!resolved.ok && resolved.matches.map((s) => s.id)).toEqual([1, 2])
  })

  it('reports an unknown title', () => {
    const resolved = resolveStage(stages, 'В ревью')
    expect(resolved).toEqual({ ok: false, reason: 'unknown-title', matches: [] })
  })
})

describe('describeStages', () => {
  it('lists id and title for an error message', () => {
    expect(describeStages(toStageList(BOARD))).toBe(
      '741 Новые, 743 Выполняются, 757 Ждёт релиза, 749 Готово',
    )
  })
})

describe('stageTitleFor', () => {
  const boards = new Map([
    [42, toStageList(BOARD)],
    [0, toStageList({ 9: { ID: '9', TITLE: 'Личное', SORT: '100' } })],
  ])

  it('names the column of the task’s own project', () => {
    expect(stageTitleFor(boards, 42, 757)).toBe('Ждёт релиза')
  })

  it('reads the personal kanban for a task outside any project', () => {
    expect(stageTitleFor(boards, 0, 9)).toBe('Личное')
    expect(stageTitleFor(boards, null, 9)).toBe('Личное')
  })

  it('returns null for stage 0 — the task is not on a board', () => {
    expect(stageTitleFor(boards, 42, STAGE_NOT_ON_BOARD)).toBeNull()
  })

  it('returns null instead of guessing when the board is unknown', () => {
    expect(stageTitleFor(boards, 99, 791)).toBeNull()
  })

  it('returns null when the column is gone from a board we did read', () => {
    expect(stageTitleFor(boards, 42, 999)).toBeNull()
  })
})
