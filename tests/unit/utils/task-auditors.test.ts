import { describe, expect, it } from 'vitest'
import { addAuditors, removeAuditors, toAuditorIds } from '../../../server/utils/task-auditors'

describe('toAuditorIds', () => {
  it('parses a plain array of numbers', () => {
    expect(toAuditorIds([12, 47])).toEqual([12, 47])
  })

  it('parses a plain array of numeric strings (wire shape)', () => {
    expect(toAuditorIds(['12', '47'])).toEqual([12, 47])
  })

  it('parses an id-keyed object (alternate wire shape)', () => {
    expect(toAuditorIds({ 0: 12, 1: 47 })).toEqual([12, 47])
  })

  it('drops non-numeric / non-positive / zero entries', () => {
    expect(toAuditorIds([12, 'bob', -1, 0, Number.NaN, 47])).toEqual([12, 47])
  })

  it('returns [] for null/undefined', () => {
    expect(toAuditorIds(null)).toEqual([])
    expect(toAuditorIds(undefined)).toEqual([])
  })
})

describe('addAuditors', () => {
  it('appends new ids, keeping existing order first', () => {
    expect(addAuditors([12], [47, 9])).toEqual({ next: [12, 47, 9], changed: [47, 9] })
  })

  it('reports nothing changed when every id is already present', () => {
    expect(addAuditors([12, 47], [47])).toEqual({ next: [12, 47], changed: [] })
  })

  it('de-dupes ids repeated within `incoming` itself', () => {
    expect(addAuditors([], [9, 9, 12])).toEqual({ next: [9, 12], changed: [9, 12] })
  })
})

describe('removeAuditors', () => {
  it('drops the requested ids, keeping the rest in order', () => {
    expect(removeAuditors([12, 47, 9], [47])).toEqual({ next: [12, 9], changed: [47] })
  })

  it('reports nothing changed when none of the ids were present', () => {
    expect(removeAuditors([12], [99])).toEqual({ next: [12], changed: [] })
  })

  it('removing the last auditor yields an empty set (valid — clears the field)', () => {
    expect(removeAuditors([12], [12])).toEqual({ next: [], changed: [12] })
  })
})
