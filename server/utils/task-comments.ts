import type { BitrixTaskCommentRaw } from '~/server/types/bitrix24'
import { pick, toNumber } from '~/server/utils/wire-coerce'

/**
 * Pure parser for `task.commentitem.*` response items. Mirrors what
 * `toTaskShort` / `toChecklistItemShort` / `toElapsedTimeShort` do for their
 * domains: narrow the agent-facing shape, coerce stringified ids, keep the
 * wire-format quirks out of the tool body.
 *
 * The comment BODY is never truncated here — reading a task's discussion is
 * the whole point of the tool, and a cut-off comment silently changes what
 * the operator is told. Callers that need to bound the response do it by
 * returning fewer comments (`limit` / `offset`), never by shortening one.
 *
 * Returns `null` when the wire shape carries no usable `id` — same fail-soft
 * convention as the sibling parsers.
 */

export interface TaskCommentShort {
  id: number
  /** Not echoed by Bitrix24 on the item — filled in by the caller. */
  taskId: number
  authorId: number | null
  /** Shipped by Bitrix24 next to the id, so "from whom" needs no extra call. */
  authorName: string | null
  authorEmail: string | null
  postDate: string | null
  /** Full BBCode body, verbatim. */
  text: string
  /** Bitrix24's pre-rendered HTML — `null` for UI-written comments. */
  textHtml: string | null
}

export function toTaskCommentShort(raw: unknown, taskId: number): TaskCommentShort | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as BitrixTaskCommentRaw & Record<string, unknown>
  const id = toNumber(pick(r, 'id', 'ID'))
  if (id === null) return null
  return {
    id,
    taskId,
    authorId: toNumber(pick(r, 'authorId', 'AUTHOR_ID')),
    // Empty string means "Bitrix24 has no value" for both author fields —
    // normalise to null so the agent doesn't render an empty attribution.
    authorName: pick<string>(r, 'authorName', 'AUTHOR_NAME') || null,
    authorEmail: pick<string>(r, 'authorEmail', 'AUTHOR_EMAIL') || null,
    postDate: pick<string>(r, 'postDate', 'POST_DATE') || null,
    text: pick<string>(r, 'postMessage', 'POST_MESSAGE') ?? '',
    textHtml: pick<string>(r, 'postMessageHtml', 'POST_MESSAGE_HTML') || null,
  }
}
