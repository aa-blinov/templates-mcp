import { describe, expect, it } from 'vitest'
import {
  filterDialogs,
  selectMessages,
  toDialogShort,
  toMessageShort,
} from '../../server/utils/im-dialogs'

describe('toDialogShort', () => {
  it('keeps the dialog id in the shape the read endpoint wants', () => {
    const chat = toDialogShort({
      id: 'chat42',
      type: 'chat',
      title: 'Проектный чат',
      chat: { id: '121', type: 'chat', entity_type: '' },
      message: { id: '9001', text: 'ок', date: '2026-08-31T08:04:00+03:00', author_id: '9' },
    })

    expect(chat).toEqual({
      dialogId: 'chat42',
      chatId: 121,
      type: 'chat',
      // An empty entity_type normalises to null, not ''.
      entityType: null,
      title: 'Проектный чат',
      unread: false,
      lastMessage: {
        id: 9001,
        date: '2026-08-31T08:04:00+03:00',
        authorId: 9,
        preview: 'ок',
      },
    })
  })

  it('names a one-to-one dialog after the person when no title is sent', () => {
    const dialog = toDialogShort({
      id: '7',
      type: 'user',
      user: { id: '7', first_name: 'Иван', last_name: 'Петров' },
      unread: true,
    })

    expect(dialog.dialogId).toBe('7')
    expect(dialog.title).toBe('Иван Петров')
    expect(dialog.unread).toBe(true)
    expect(dialog.lastMessage.preview).toBeNull()
  })

  it('previews the last message instead of returning it whole', () => {
    const dialog = toDialogShort({ id: 'chat1', message: { text: 'я'.repeat(500) } })

    expect(dialog.lastMessage.preview).toHaveLength(200)
  })
})

describe('filterDialogs', () => {
  const dialogs = [
    toDialogShort({ id: 'chat1', type: 'chat', title: 'Общий чат' }),
    toDialogShort({ id: '7', type: 'user', title: 'Иван Петров', unread: true }),
    toDialogShort({ id: 'chat573', type: 'chat', title: 'EORA | Sentry', unread: true }),
  ]

  it('keeps group chats only', () => {
    expect(filterDialogs(dialogs, { kind: 'chat' }).map((d) => d.dialogId)).toEqual(['chat1', 'chat573'])
  })

  it('keeps people only', () => {
    expect(filterDialogs(dialogs, { kind: 'private' }).map((d) => d.dialogId)).toEqual(['7'])
  })

  it('combines kind with unreadOnly', () => {
    expect(filterDialogs(dialogs, { kind: 'chat', unreadOnly: true }).map((d) => d.dialogId)).toEqual([
      'chat573',
    ])
  })

  it('returns everything without options', () => {
    expect(filterDialogs(dialogs)).toHaveLength(3)
  })
})

describe('toMessageShort', () => {
  it('marks author_id 0 as a system entry and drops the author', () => {
    expect(toMessageShort({ id: '7', author_id: '0', text: 'Чат создан', date: '2026-09-01T10:00:00+03:00' }))
      .toEqual({
        id: 7,
        date: '2026-09-01T10:00:00+03:00',
        authorId: null,
        authorName: null,
        isSystem: true,
        text: 'Чат создан',
      })
  })

  it('treats an absent author as system rather than inventing user 0', () => {
    expect(toMessageShort({ id: '8', text: 'служебное' })?.isSystem).toBe(true)
  })

  it('refuses a row without a usable id', () => {
    expect(toMessageShort({ author_id: '9', text: 'без id' })).toBeNull()
  })
})

describe('selectMessages', () => {
  const thread = [
    toMessageShort({ id: '1', author_id: '0', text: 'Чат создан', date: '2026-09-01T10:00:00+03:00' })!,
    toMessageShort({ id: '2', author_id: '9', text: 'нужно обсудить подписки', date: '2026-09-01T10:05:00+03:00' })!,
    toMessageShort({ id: '3', author_id: '7', text: 'давайте', date: '2026-09-01T10:06:00+03:00' })!,
    toMessageShort({ id: '4', author_id: '9', text: 'ок', date: '2026-09-01T10:07:00+03:00' })!,
  ]

  it('hides system entries by default and counts them', () => {
    const selection = selectMessages(thread)

    expect(selection.matched).toBe(3)
    expect(selection.systemHidden).toBe(1)
    expect(selection.page.map((m) => m.id)).toEqual([2, 3, 4])
  })

  it('includes system entries on request', () => {
    const selection = selectMessages(thread, { includeSystem: true })

    expect(selection.systemHidden).toBe(0)
    expect(selection.page.map((m) => m.id)).toEqual([1, 2, 3, 4])
  })

  it('orders newest-first on demand', () => {
    expect(selectMessages(thread, { order: 'desc' }).page.map((m) => m.id)).toEqual([4, 3, 2])
  })

  it('filters by author and by text, case-insensitively', () => {
    expect(selectMessages(thread, { authorId: 9 }).page.map((m) => m.id)).toEqual([2, 4])
    expect(selectMessages(thread, { search: 'ДАВАЙТЕ' }).page.map((m) => m.id)).toEqual([3])
  })

  it('tallies authors over the whole matched thread, not the returned page', () => {
    const selection = selectMessages(thread, { limit: 1 })

    expect(selection.page).toHaveLength(1)
    expect(selection.authors).toEqual([
      { id: 9, name: null, messages: 2 },
      { id: 7, name: null, messages: 1 },
    ])
  })
})
