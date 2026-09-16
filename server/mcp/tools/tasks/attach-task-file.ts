import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Attach an existing Disk file to a Bitrix24 task's card (the "Files"
 * block) — "прикрепи файл N к задаче". Companion write to
 * `b24_task_file_list`.
 *
 * Bitrix24 REST: tasks.task.files.attach
 *   https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-files-attach.html
 *
 * Only the "attach an existing Disk `fileId`" path from issue #106 — no
 * bytes cross the MCP/LLM boundary, matching that issue's own ranked
 * preference (existing-fileId first, upload-from-URL second, base64 last
 * and size-capped). Uploading a NEW file (from a URL or base64) is a
 * separate, not-yet-implemented follow-up; this tool requires the operator
 * (or an upstream tool) to already have a Disk file id — get one from
 * `b24_task_file_list` / `b24_task_chat_file_list` (their `attachedId` /
 * `fileId` are attachment-relationship ids, NOT Disk file ids; resolve a
 * Disk file id via `disk.attachedObject.get`'s `OBJECT_ID` if attaching
 * the same file elsewhere).
 *
 * `tasks.task.files.attach`'s own return value is not something this tool
 * trusts blindly (Bitrix24 REST responses for attach/relation calls vary
 * in shape across methods) — instead it reads `UF_TASK_WEBDAV_FILES`
 * before and after the attach call and diffs the two, so the reported
 * `attachedId` is always the id Bitrix24 actually added, not a guess at
 * the attach call's response shape.
 *
 * **The file and the task must live in the same project's Disk storage**
 * (docs say nothing about this — found by live testing, not documented).
 * Every Bitrix24 workgroup has its own Disk storage
 * (`disk.storage.get(id)` → `ENTITY_TYPE: "group"`, `ENTITY_ID: <groupId>`);
 * a file uploaded in one project's storage cannot be attached to a task
 * that belongs to a different project — the call fails with a generic
 * `400 Unexpected error` that names neither the file nor the reason.
 * Verified live (2026-09-16): the identical call that failed against a
 * task in project "test" (group 1) succeeded immediately against a task
 * in the file's own project (group 111), returning `{ attachmentId }` and
 * showing up in `b24_task_file_list` right after. A task with no `groupId`
 * (a personal task) most likely can only take files from the operator's
 * own personal Disk storage, by the same logic — untested, since this
 * portal's throwaway tasks were all created inside a project.
 */

interface TaskAttachmentsEnvelope {
  task?: { ufTaskWebdavFiles?: unknown }
}

interface DiskAttachedObjectRaw {
  NAME?: string
  SIZE?: string | number
}

function attachmentIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map((id) => toNumber(id)).filter((id): id is number => id !== null)
}

/** "2048" → "2.0 KB" — operators think in KB/MB, not raw bytes. */
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

export default defineMcpTool({
  name: 'b24_task_file_attach',
  description:
    'Attach an existing Bitrix24 Disk file to a task\'s card (the "Files" block) — the write counterpart to `b24_task_file_list`. `fileId` is a Disk file id, NOT an attachment-relationship id (`attachedId`) and NOT a chat `fileId` from `b24_task_chat_file_list` — resolve one via `disk.attachedObject.get`\'s `OBJECT_ID` field if you only have an attachment/chat file id. IMPORTANT: the file must live in the SAME project\'s Disk storage as the task (a workgroup\'s files and its tasks share one storage) — attaching a file from another project fails with a generic, unhelpful error naming neither the file nor the reason; if that happens, the fix is to find/upload the file inside the target task\'s own project first. The caller (webhook user) needs at least read access to the file. Only attaches an ALREADY-EXISTING Disk file — uploading a brand-new file is not supported by this tool.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to attach the file to, e.g. from `b24_task_list`.'),
    fileId: z.number().int().positive().describe('Disk file id (NOT an attachedId / chat fileId — see the tool description).'),
  },
  handler: async ({ taskId, fileId }) => {
    const b24 = useBitrix24Tenant()

    const before = await callV2<TaskAttachmentsEnvelope>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'UF_TASK_WEBDAV_FILES'] },
      `Failed to read Bitrix24 task ${taskId} before attaching a file`,
    )
    const beforeIds = new Set(attachmentIds(before?.task?.ufTaskWebdavFiles))

    await callV2<unknown>(
      b24,
      'tasks.task.files.attach',
      { taskId, fileId },
      `Failed to attach Disk file ${fileId} to Bitrix24 task ${taskId}`,
    )

    const after = await callV2<TaskAttachmentsEnvelope>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'UF_TASK_WEBDAV_FILES'] },
      `Attached file ${fileId} to Bitrix24 task ${taskId}, but failed to re-read the task to confirm it`,
    )
    const afterIds = attachmentIds(after?.task?.ufTaskWebdavFiles)
    const attachedId = afterIds.find((id) => !beforeIds.has(id)) ?? null

    if (attachedId === null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ attached: true, taskId, fileId, attachedId: null, name: null, sizeBytes: null, size: null }),
          },
        ],
      }
    }

    const meta = await callV2<DiskAttachedObjectRaw>(
      b24,
      'disk.attachedObject.get',
      { id: attachedId },
      `Attached file ${fileId} to Bitrix24 task ${taskId} (attachment ${attachedId}), but failed to read its metadata`,
    )
    const sizeBytes = toNumber(meta?.SIZE)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            attached: true,
            taskId,
            fileId,
            attachedId,
            name: meta?.NAME ?? null,
            sizeBytes,
            size: sizeBytes === null ? null : humanSize(sizeBytes),
          }),
        },
      ],
    }
  },
})
