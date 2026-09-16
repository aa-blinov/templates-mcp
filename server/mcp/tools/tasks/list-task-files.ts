import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import type { SingleTaskEnvelope } from '~/server/types/bitrix24'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { batchV2, callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * List files attached directly to a Bitrix24 task's card (the "Files"
 * block in the task UI) — distinct from `b24_task_chat_file_list`, which
 * reads screenshots/files posted in the task's CHAT discussion. A task can
 * have attachments in either place, both, or neither.
 *
 * Bitrix24 REST: tasks.task.get (`UF_TASK_WEBDAV_FILES`) + batched
 * disk.attachedObject.get
 *
 * `UF_TASK_WEBDAV_FILES` is not returned by default — must be selected
 * explicitly — and yields attachment-relationship ids, not file ids or
 * metadata. Each id is resolved via `disk.attachedObject.get`, batched in
 * one round-trip (never one call per file).
 *
 * SECURITY — read this before touching `downloadUrl`: the `DOWNLOAD_URL`
 * `disk.attachedObject.get` returns for this attachment mechanism embeds
 * `auth[ap]=<value>`, and that value is **the portal's actual webhook
 * secret** — not a scoped, expiring, per-file token like the `_esd=` /
 * `signature=` links `b24_task_chat_file_list` returns from the IM/chat
 * surface. Verified live (2026-09-15): a real attachment's `DOWNLOAD_URL`
 * carried the same secret configured in `NUXT_BITRIX24_WEBHOOK_URL`.
 * Returning it hands out full API access, not just file access. This tool
 * returns it anyway — an explicit operator decision, not an oversight —
 * because the operator needs a working download link and no unprivileged
 * alternative link was found on this REST surface. `logger-redactor.ts`'s
 * `DISK_AUTH_PARAM_RE` scrubs it from every log sink regardless (logs and
 * the tool's own return value are different surfaces — redacting the
 * former does not require withholding the latter). A caller embedding
 * `downloadUrl` verbatim into any log, transcript, or third-party surface
 * downstream of this tool's response is reintroducing the exact leak this
 * comment warns about — treat it as credential-bearing everywhere it goes.
 */

interface DiskAttachedObjectRaw {
  ID?: string | number
  NAME?: string
  SIZE?: string | number
  CREATE_TIME?: string | null
  CREATED_BY?: string | number | null
  DOWNLOAD_URL?: string
}

interface TaskFileRow {
  attachedId: number
  name: string | null
  sizeBytes: number | null
  size: string | null
  createdAt: string | null
  createdById: number | null
  downloadUrl: string | null
}

/** "14767" → "14.4 KB" — operators think in KB/MB, not raw bytes. */
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

function projectFile(attachedId: number, raw: DiskAttachedObjectRaw): TaskFileRow {
  const sizeBytes = toNumber(raw.SIZE)
  return {
    attachedId,
    name: raw.NAME ?? null,
    sizeBytes,
    size: sizeBytes === null ? null : humanSize(sizeBytes),
    createdAt: raw.CREATE_TIME ?? null,
    createdById: toNumber(raw.CREATED_BY),
    downloadUrl: raw.DOWNLOAD_URL ?? null,
  }
}

export default defineMcpTool({
  name: 'b24_task_file_list',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'List files attached directly to a Bitrix24 task\'s card (the "Files" block in the task UI) — distinct from `b24_task_chat_file_list`, which covers files posted in the task\'s chat discussion instead; a task can have attachments in either place, both, or neither, so check both when the operator asks "what\'s attached to this task". Returns name, human-readable size + bytes, who attached it and when, and `downloadUrl`. WARNING: unlike the chat-file tool, `downloadUrl` here embeds this portal\'s actual webhook secret (Bitrix24\'s legacy Disk mechanism, not a scoped per-file token) — treat it as credential-bearing, not just a file link, when passing it anywhere.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task id to read card attachments from, e.g. from `b24_task_list`.'),
  },
  handler: async ({ taskId }) => {
    const b24 = useBitrix24Tenant()

    const meta = await callV2<SingleTaskEnvelope & { task?: Record<string, unknown> }>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'UF_TASK_WEBDAV_FILES'] },
      `Failed to read Bitrix24 task ${taskId} before listing its files`,
    )
    const rawIds = (meta?.task as Record<string, unknown> | undefined)?.ufTaskWebdavFiles
    const attachedIds = Array.isArray(rawIds)
      ? rawIds.map((id) => toNumber(id)).filter((id): id is number => id !== null)
      : []

    if (attachedIds.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ taskId, matches: 0, files: [] }),
          },
        ],
      }
    }

    const rows = await batchV2<DiskAttachedObjectRaw>(
      b24,
      attachedIds.map((id) => ['disk.attachedObject.get', { id }]),
      `Failed to read the metadata of ${attachedIds.length} file(s) attached to Bitrix24 task ${taskId}`,
    )

    const files: TaskFileRow[] = []
    rows.forEach((row, index) => {
      if (!row.isSuccess) return // ACCESS_DENIED / deleted attachment — skip, don't fail the whole listing
      const attachedId = attachedIds[index]
      if (attachedId === undefined) return
      const raw = row.getData()?.result
      if (!raw) return
      files.push(projectFile(attachedId, raw))
    })

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ taskId, matches: files.length, files }),
        },
      ],
    }
  },
})
