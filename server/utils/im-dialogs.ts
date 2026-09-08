/**
 * Projection and local filtering for the read-only IM tools.
 *
 * `im.recent.get` and `im.dialog.messages.get` return wire shapes with mixed
 * casing, ids as numeric strings, and no way to filter or sort on request:
 * the messages endpoint always answers newest-first and pages backwards
 * through `LAST_ID`. Ordering, author and text filtering therefore happen
 * locally, and they live here — as pure functions — so they are unit-testable
 * without a Bitrix24 tenant, the same way `task-comments.ts` is.
 */

import type { BitrixChatMessageRaw } from '~/server/types/bitrix24'
import { toNumber } from '~/server/utils/wire-coerce'

/** One row of `im.recent.get`, as far as we read it. */
export interface RecentRowRaw {
  id?: string | number
  chat_id?: string | number
  type?: string
  title?: string
  unread?: boolean
  message?: { id?: string | number, text?: string, date?: string, author_id?: string | number }
  user?: { id?: string | number, name?: string, last_name?: string, first_name?: string }
  chat?: { id?: string | number, name?: string, type?: string, entity_type?: string }
}

export interface DialogShort {
  dialogId: string
  chatId: number | null
  type: string | null
  entityType: string | null
  title: string | null
  unread: boolean
  lastMessage: {
    id: number | null
    date: string | null
    authorId: number | null
    preview: string | null
  }
}

/** How much of the last message a listing shows — it is a preview, not a read. */
const PREVIEW_CHARS = 200

export function toDialogShort(row: RecentRowRaw): DialogShort {
  const chat = row.chat ?? {}
  const user = row.user ?? {}
  const message = row.message ?? {}
  const personName
    = user.name
    || [user.first_name, user.last_name].filter((part) => typeof part === 'string' && part !== '').join(' ')
  return {
    // `im.recent.get` already returns the id in the shape the read endpoint
    // wants: "chat<id>" for a chat, the bare user id for a person.
    dialogId: String(row.id ?? ''),
    chatId: toNumber(chat.id ?? row.chat_id),
    type: row.type ?? chat.type ?? null,
    entityType: chat.entity_type || null,
    title: row.title || chat.name || personName || null,
    unread: row.unread === true,
    lastMessage: {
      id: toNumber(message.id),
      date: message.date ?? null,
      authorId: toNumber(message.author_id),
      preview: typeof message.text === 'string' ? message.text.slice(0, PREVIEW_CHARS) : null,
    },
  }
}

export function filterDialogs(
  dialogs: DialogShort[],
  options: { kind?: 'all' | 'chat' | 'private', unreadOnly?: boolean } = {},
): DialogShort[] {
  const byKind
    = options.kind === 'chat'
      ? dialogs.filter((row) => row.type === 'chat')
      : options.kind === 'private'
        ? dialogs.filter((row) => row.type === 'user')
        : dialogs
  return options.unreadOnly === true ? byKind.filter((row) => row.unread) : byKind
}

export interface MessageShort {
  id: number
  date: string | null
  authorId: number | null
  authorName: string | null
  isSystem: boolean
  text: string
}

/**
 * `author_id: 0` is Bitrix24's system marker — chat created, joins, leaves,
 * service notices. It is the only dependable system-vs-human signal here, so
 * an absent author counts as system too rather than inventing user #0.
 */
export function toMessageShort(raw: BitrixChatMessageRaw): MessageShort | null {
  const id = toNumber(raw.id)
  if (id === null) return null
  const author = toNumber(raw.author_id)
  const isSystem = author === 0 || author === null
  return {
    id,
    date: typeof raw.date === 'string' && raw.date !== '' ? raw.date : null,
    authorId: isSystem ? null : author,
    authorName: null,
    isSystem,
    text: typeof raw.text === 'string' ? raw.text : '',
  }
}

export interface AuthorTally {
  id: number
  name: string | null
  messages: number
}

export interface MessageSelection {
  systemHidden: number
  matched: number
  page: MessageShort[]
  authors: AuthorTally[]
}

/**
 * Apply the local view over a fetched thread: hide system entries, filter by
 * author and text, order by date, then cut the page.
 *
 * The author roll-up counts the whole matched thread, before paging — it
 * answers "who is in this conversation", which a page cannot.
 */
export function selectMessages(
  messages: MessageShort[],
  options: {
    authorId?: number
    search?: string
    includeSystem?: boolean
    order?: 'asc' | 'desc'
    limit?: number
  } = {},
): MessageSelection {
  const systemHidden = options.includeSystem === true ? 0 : messages.filter((m) => m.isSystem).length
  const visible = options.includeSystem === true ? messages : messages.filter((m) => !m.isSystem)
  const byAuthor
    = options.authorId === undefined ? visible : visible.filter((m) => m.authorId === options.authorId)
  const needle = options.search?.toLowerCase()
  const matched
    = needle === undefined ? byAuthor : byAuthor.filter((m) => m.text.toLowerCase().includes(needle))

  const sorted = [...matched].sort((a, b) => {
    // Fall back to id when a date is missing: ids grow with time in a chat.
    const byDate = (a.date ?? '').localeCompare(b.date ?? '')
    const delta = byDate !== 0 ? byDate : a.id - b.id
    return options.order === 'desc' ? -delta : delta
  })

  const authors = new Map<number, AuthorTally>()
  for (const message of matched) {
    if (message.authorId === null) continue
    const seen = authors.get(message.authorId)
    if (seen) seen.messages += 1
    else authors.set(message.authorId, { id: message.authorId, name: message.authorName, messages: 1 })
  }

  return {
    systemHidden,
    matched: matched.length,
    page: sorted.slice(0, options.limit ?? 50),
    authors: [...authors.values()].sort((a, b) => b.messages - a.messages),
  }
}
