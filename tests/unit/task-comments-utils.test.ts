import { describe, expect, it } from 'vitest'
import { toTaskCommentShort } from '../../server/utils/task-comments'

describe('toTaskCommentShort', () => {
  it('maps the UPPERCASE shape returned by task.commentitem.getlist', () => {
    expect(
      toTaskCommentShort(
        {
          POST_MESSAGE_HTML: null,
          ID: '53',
          AUTHOR_ID: '9',
          AUTHOR_NAME: 'Иван Петров',
          AUTHOR_EMAIL: '',
          POST_DATE: '2025-07-31T13:11:53+03:00',
          POST_MESSAGE: '[USER=11]Мария Смирнова[/USER], вы назначены соисполнителем.',
        },
        23,
      ),
    ).toEqual({
      id: 53,
      taskId: 23,
      authorId: 9,
      authorName: 'Иван Петров',
      // Empty AUTHOR_EMAIL normalises to null, not ''.
      authorEmail: null,
      postDate: '2025-07-31T13:11:53+03:00',
      text: '[USER=11]Мария Смирнова[/USER], вы назначены соисполнителем.',
      textHtml: null,
    })
  })

  it('accepts camelCase fields (forwards-compat if Bitrix24 ever swaps casing)', () => {
    expect(
      toTaskCommentShort(
        {
          id: 7,
          authorId: 11,
          authorName: 'Мария Смирнова',
          authorEmail: 'maria@example.com',
          postDate: '2025-08-01T09:00:00+03:00',
          postMessage: 'нашла подходящее решение, выглядит неплохо',
          postMessageHtml: '<p>нашла подходящее решение, выглядит неплохо</p>',
        },
        29,
      ),
    ).toEqual({
      id: 7,
      taskId: 29,
      authorId: 11,
      authorName: 'Мария Смирнова',
      authorEmail: 'maria@example.com',
      postDate: '2025-08-01T09:00:00+03:00',
      text: 'нашла подходящее решение, выглядит неплохо',
      textHtml: '<p>нашла подходящее решение, выглядит неплохо</p>',
    })
  })

  it('never truncates a long body', () => {
    const body = 'а'.repeat(5000)
    expect(toTaskCommentShort({ ID: 1, POST_MESSAGE: body }, 42)?.text).toBe(body)
  })

  it('defaults a missing body to an empty string and unknown author fields to null', () => {
    expect(toTaskCommentShort({ ID: '4' }, 42)).toEqual({
      id: 4,
      taskId: 42,
      authorId: null,
      authorName: null,
      authorEmail: null,
      postDate: null,
      text: '',
      textHtml: null,
    })
  })

  it('returns null for rows without a usable id or non-object rows', () => {
    expect(toTaskCommentShort({ POST_MESSAGE: 'orphan' }, 42)).toBeNull()
    expect(toTaskCommentShort(null, 42)).toBeNull()
    expect(toTaskCommentShort('nope', 42)).toBeNull()
  })
})
