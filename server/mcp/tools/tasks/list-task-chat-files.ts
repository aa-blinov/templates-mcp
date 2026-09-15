import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { BitrixChatFileRaw, ChatMessagesEnvelope, SingleTaskEnvelope } from '~/server/types/bitrix24'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * List files/images posted in a Bitrix24 task's chat — "what screenshots /
 * attachments are in the discussion of task N?"
 *
 * Bitrix24 REST: tasks.task.get (for `chatId`) + im.dialog.messages.get
 *
 * A pasted screenshot arrives as a chat message with empty `text` and
 * `params: { FILE_ID: [...] }`; the file's own metadata (name, size,
 * dimensions, uploader, and signed URLs) lives in the response's separate
 * `files` collection — `im.dialog.messages.get`'s `messages` array alone
 * never carries it. `b24_task_comment_list` already calls this endpoint
 * for text but discards `files`; this tool reads the same response and
 * projects that instead.
 *
 * **`files` is keyed by position (`"0"`, `"1"`, …), NOT by file id** —
 * verified live (2026-09-15, task #4145's chat): a page with 7 files came
 * back as `{"0": {...}, "1": {...}, …, "6": {...}}`, each entry's OWN `id`
 * field carrying the real file id that a message's `FILE_ID` points at.
 * Looking the entry up by `files[String(fileId)]` silently returns nothing
 * (or the wrong entry) — this tool builds a lookup from each entry's `id`
 * instead of trusting the outer key.
 *
 * Metadata + URLs only, matching the design this MCP already uses for
 * everything else that touches Disk (see `logger-redactor.ts`'s
 * `DISK_URL_RE`): no bytes and no base64 ever cross the MCP/LLM boundary
 * here — the model is a router for files, not a pipe. `downloadUrl` /
 * `previewUrl` are Bitrix24's own signed, ready-to-fetch links; they carry
 * a `_esd=`/`signature=` token, which the logger redactor scrubs before it
 * reaches any log sink, but the tool itself returns them to the caller
 * as-is (same posture as every other Bitrix24 signed link this project
 * surfaces).
 *
 * Only reads a task's CHAT store — a task on the legacy forum has no
 * `chatId` and this tool returns an empty list for it (forum comments
 * carry no file-attachment metadata via this REST surface at all).
 *
 * Verified live (2026-09-15) against task #4145's chat (id 6429): three
 * screenshots posted mid-thread, each recovered with name/size/dimensions/
 * uploader — see the PR description for the (redacted) sample.
 */

/** Chat page size. Bitrix24 caps `im.dialog.messages.get` at 200 per call. */
const CHAT_PAGE = 200
/** How many chat pages to walk before giving up and saying so. */
const CHAT_MAX_PAGES = 5

interface ChatFileRow {
  fileId: number
  messageId: number
  name: string | null
  type: string | null
  extension: string | null
  sizeBytes: number | null
  size: string | null
  width: number | null
  height: number | null
  uploadedBy: string | null
  uploadedById: number | null
  uploadedAt: string | null
  downloadUrl: string | null
  previewUrl: string | null
}

/** "160749" → "157.0 KB" — operators think in KB/MB, not raw bytes. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function projectFile(fileId: number, messageId: number, raw: BitrixChatFileRaw): ChatFileRow {
  const sizeBytes = toNumber(raw.size)
  return {
    fileId,
    messageId,
    name: raw.name ?? null,
    type: raw.type ?? null,
    extension: raw.extension ?? null,
    sizeBytes,
    size: sizeBytes === null ? null : humanSize(sizeBytes),
    width: raw.image?.width ?? null,
    height: raw.image?.height ?? null,
    uploadedBy: raw.authorName ?? null,
    uploadedById: toNumber(raw.authorId),
    uploadedAt: raw.date ?? null,
    downloadUrl: raw.urlDownload ?? null,
    previewUrl: raw.urlPreview ?? null,
  }
}

export default defineMcpTool({
  name: 'b24_task_chat_file_list',
  description:
    'List files and images posted in a Bitrix24 task\'s CHAT (screenshots pasted into the discussion, PDFs shared mid-thread, etc.) — "what was attached to the conversation on task N?". Returns metadata only: name, type, human-readable size + bytes, image dimensions when applicable, who uploaded it and when, plus `downloadUrl` (fetch the actual bytes) and `previewUrl` (thumbnail, images only) — Bitrix24\'s own signed, ready-to-fetch links. Never returns file bytes or base64 — treat the returned URL as the handle and fetch it outside the model when the operator needs the actual file. Only covers the task\'s CHAT store (tasks created since the portal moved to the chat-based task card); a task still on the legacy forum has no chat and returns an empty list — its attachments, if any, are not reachable through this tool. Files attached directly to the task object (not through chat) are a separate, not-yet-implemented surface (issue #106).',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task id to read chat files from, e.g. from `b24_task_list`.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .optional()
      .describe('Max number of files to return, newest-first. Omit to return everything found.'),
  },
  handler: async ({ taskId, limit }) => {
    const b24 = useBitrix24Tenant()

    const meta = await callV2<SingleTaskEnvelope & { task?: Record<string, unknown> }>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'CHAT_ID'] },
      `Failed to read Bitrix24 task ${taskId} before listing its chat files`,
    )
    const chatId = toNumber((meta?.task as Record<string, unknown> | undefined)?.chatId)

    if (chatId === null || chatId <= 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ taskId, matches: 0, files: [] }),
          },
        ],
      }
    }

    const rows: ChatFileRow[] = []
    let truncated = false
    let lastId: number | undefined

    for (let page = 0; page < CHAT_MAX_PAGES; page++) {
      const params: Record<string, unknown> = { DIALOG_ID: `chat${chatId}`, LIMIT: CHAT_PAGE }
      if (lastId !== undefined) params.LAST_ID = lastId
      const chat = await callV2<ChatMessagesEnvelope>(
        b24,
        'im.dialog.messages.get',
        params,
        `Failed to read the chat files of Bitrix24 task ${taskId}`,
      )
      const messages = Array.isArray(chat?.messages) ? chat.messages : []
      if (messages.length === 0) break

      // Keyed by position, not by file id (see the file-level doc comment
      // above) — index by each entry's own `id` instead.
      const filesById = new Map<number, BitrixChatFileRaw>()
      for (const raw of Object.values(chat?.files ?? {})) {
        const id = toNumber(raw.id)
        if (id !== null) filesById.set(id, raw)
      }

      for (const message of messages) {
        const fileIds = message.params?.FILE_ID
        if (!Array.isArray(fileIds)) continue
        const messageId = toNumber(message.id)
        if (messageId === null) continue
        for (const rawId of fileIds) {
          const fileId = toNumber(rawId)
          if (fileId === null) continue
          const raw = filesById.get(fileId)
          if (!raw) continue
          rows.push(projectFile(fileId, messageId, raw))
        }
      }

      if (messages.length < CHAT_PAGE) break
      const oldest = messages
        .map((m) => toNumber(m.id))
        .filter((id): id is number => id !== null)
        .reduce<number | null>((min, id) => (min === null || id < min ? id : min), null)
      if (oldest === null) break
      lastId = oldest
      if (page === CHAT_MAX_PAGES - 1) truncated = true
    }

    const page = limit === undefined ? rows : rows.slice(0, limit)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            taskId,
            totalFound: rows.length,
            matches: page.length,
            ...(truncated ? { chatTruncated: true } : {}),
            files: page,
          }),
        },
      ],
    }
  },
})
