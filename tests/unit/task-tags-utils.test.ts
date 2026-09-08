import { describe, expect, it } from 'vitest'
import { addTags, normalizeTags, removeTags, tagUsage, toTagTitles } from '../../server/utils/task-tags'

describe('toTagTitles', () => {
  it('reads the id-keyed object tasks.task.get answers with', () => {
    expect(toTagTitles({ 197: { id: 197, title: 'P1' }, 247: { id: 247, title: 'R260916' } })).toEqual([
      'P1',
      'R260916',
    ])
  })

  it('reads a plain array of entries and of strings', () => {
    expect(toTagTitles([{ ID: '5', TITLE: 'P2' }])).toEqual(['P2'])
    expect(toTagTitles(['P1', 'R260916'])).toEqual(['P1', 'R260916'])
  })

  it('treats an absent or empty field as no tags', () => {
    expect(toTagTitles(undefined)).toEqual([])
    expect(toTagTitles(null)).toEqual([])
    expect(toTagTitles({})).toEqual([])
    expect(toTagTitles(['', '  '])).toEqual([])
  })
})

describe('normalizeTags', () => {
  it('drops blanks and case-duplicates, keeping the first spelling', () => {
    expect(normalizeTags([' P1 ', 'p1', '', 'R260916'])).toEqual(['P1', 'R260916'])
  })
})

describe('addTags', () => {
  it('keeps the existing tags — TAGS is a whole-set write', () => {
    const { next, changed } = addTags(['P1', 'R260916'], ['R260923'])

    expect(next).toEqual(['P1', 'R260916', 'R260923'])
    expect(changed).toEqual(['R260923'])
  })

  it('reports nothing changed when the tag is already there', () => {
    const { next, changed } = addTags(['P1'], ['p1'])

    expect(changed).toEqual([])
    expect(next).toEqual(['P1'])
  })

  it('adds several at once and dedupes the input', () => {
    const { changed } = addTags([], ['P1', 'p1', 'R260916'])

    expect(changed).toEqual(['P1', 'R260916'])
  })
})

describe('removeTags', () => {
  it('leaves every other tag in place', () => {
    const { next, changed } = removeTags(['P1', 'R260916', 'R260923'], ['r260916'])

    expect(next).toEqual(['P1', 'R260923'])
    expect(changed).toEqual(['R260916'])
  })

  it('changes nothing for a tag the task does not carry', () => {
    const { next, changed } = removeTags(['P1'], ['R260916'])

    expect(next).toEqual(['P1'])
    expect(changed).toEqual([])
  })

  it('clearing the last tag yields an empty set, not a refusal', () => {
    expect(removeTags(['P1'], ['P1'])).toEqual({ next: [], changed: ['P1'] })
  })
})

describe('tagUsage', () => {
  it('counts tasks per tag, most used first', () => {
    expect(
      tagUsage([
        ['P1', 'R260916'],
        ['P1', 'R260923'],
        ['P1'],
      ]),
    ).toEqual([
      { title: 'P1', tasks: 3 },
      { title: 'R260916', tasks: 1 },
      { title: 'R260923', tasks: 1 },
    ])
  })

  it('folds case but keeps the first spelling, and counts a tag once per task', () => {
    expect(tagUsage([['P1', 'p1'], ['p1']])).toEqual([{ title: 'P1', tasks: 2 }])
  })

  it('ignores tasks without tags', () => {
    expect(tagUsage([[], []])).toEqual([])
  })
})
