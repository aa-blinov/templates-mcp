import { z } from 'zod'
import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { Bitrix24ErrorCode, Bitrix24ToolError } from '~/server/utils/errors'
import { useBitrix24Tenant } from '~/server/utils/bitrix24-tenant'
import { callV2 } from '~/server/utils/sdk-helpers'
import { toNumber } from '~/server/utils/wire-coerce'

/**
 * Attach a file to a Bitrix24 task's card (the "Files" block) — either an
 * existing Disk file, or a new one uploaded on the spot. Companion write to
 * `b24_task_file_list`.
 *
 * Bitrix24 REST: tasks.task.files.attach, plus for the upload path
 * disk.storage.getlist / disk.storage.get / disk.folder.uploadfile
 *   https://apidocs.bitrix24.com/api-reference/tasks/tasks-task-files-attach.html
 *   https://apidocs.bitrix24.com/api-reference/disk/folder/disk-folder-upload-file.html
 *
 * Two mutually exclusive input modes:
 *
 *   - `fileId` — attach an existing Disk file. No bytes cross the MCP/LLM
 *     boundary at all (issue #106's preferred path).
 *   - `upload` — upload a NEW file from base64 content, then attach it.
 *     Only the base64 path from issue #106's three options: no
 *     "operator gives a URL, server fetches it" mode — that would mean
 *     fetching an arbitrary caller-supplied URL from the server (SSRF
 *     surface), a decision this tool deliberately doesn't make on its own.
 *     Base64 is capped at {@link MAX_UPLOAD_BYTES} decoded — same trust
 *     boundary as every other tool argument, just needs a hard size cap so
 *     a large "file" doesn't blow up the request payload / token cost of
 *     whatever produced it.
 *
 * The upload path needs a Disk folder to upload INTO, and Bitrix24 has no
 * "upload to a task" shortcut — verified live (2026-09-18) that the target
 * is the task's own PROJECT storage root: `disk.storage.getlist` filtered
 * by `{ENTITY_TYPE: 'group', ENTITY_ID: <task's groupId>}`, then
 * `disk.storage.get`'s `ROOT_OBJECT_ID` is the folder id
 * `disk.folder.uploadfile` wants. This is exactly the same "file and task
 * must share one project's Disk storage" constraint the `fileId` path
 * already documents — uploading just makes it unavoidable rather than an
 * error you can hit. A task with no `groupId` (a personal task) has no
 * project storage to resolve this way, so upload is refused for those;
 * attach an existing `fileId` from the operator's own Disk instead.
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
 * showing up in `b24_task_file_list` right after.
 *
 * No delete-file tool exists for either path — out of scope per issue
 * #106 ("Deleting attachments" is explicitly deferred there). An uploaded
 * file that turns out to be wrong stays on Disk; only the task-attachment
 * relation can be cleaned up (there's no tool for that either yet).
 */

/** 3 MiB decoded. Screenshot/small-doc scale — well above a typical
 *  attachment, well below "someone base64'd a video". */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

interface TaskAttachmentsEnvelope {
  task?: { ufTaskWebdavFiles?: unknown, groupId?: unknown }
}

interface DiskAttachedObjectRaw {
  NAME?: string
  SIZE?: string | number
}

interface DiskStorageRow {
  ID?: string | number
  ROOT_OBJECT_ID?: string | number
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
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description:
    'Attach a file to a Bitrix24 task\'s card (the "Files" block) — the write counterpart to `b24_task_file_list`. Two mutually exclusive modes: `fileId` attaches an EXISTING Disk file (NOT an attachment-relationship id / chat fileId from the other file tools — resolve a real Disk file id via `disk.attachedObject.get`\'s `OBJECT_ID` if you only have one of those); `upload` uploads a NEW file from base64 content (max 3 MiB decoded) and attaches it in one call. The upload path requires the task to belong to a project (`groupId` set) — a personal task has no project Disk storage to upload into. The caller needs at least read access to an existing `fileId`.',
  inputSchema: {
    taskId: z.number().int().positive().describe('Task to attach the file to, e.g. from `b24_task_list`.'),
    fileId: z.number().int().positive().optional().describe('Disk file id of an ALREADY-EXISTING file (NOT an attachedId / chat fileId — see the tool description). Mutually exclusive with `upload`.'),
    upload: z
      .object({
        name: z.string().min(1).max(255).describe('File name, with extension, e.g. "report.pdf".'),
        contentBase64: z.string().min(1).describe('Base64-encoded file content. Decoded size capped at 3 MiB.'),
      })
      .optional()
      .describe('Upload a new file instead of attaching an existing one. Mutually exclusive with `fileId`. Requires the task to belong to a project.'),
  },
  handler: async ({ taskId, fileId, upload }) => {
    if ((fileId === undefined) === (upload === undefined)) {
      throw new Bitrix24ToolError(
        'Provide exactly one of `fileId` (attach an existing Disk file) or `upload` (upload a new one) — not both, not neither.',
        Bitrix24ErrorCode.INVALID_INPUT,
      )
    }

    const b24 = useBitrix24Tenant()
    let targetFileId: number
    let uploaded: boolean

    if (upload) {
      const decodedBytes = Buffer.byteLength(upload.contentBase64, 'base64')
      if (decodedBytes > MAX_UPLOAD_BYTES) {
        throw new Bitrix24ToolError(
          `Upload too large: ${humanSize(decodedBytes)} decoded, cap is ${humanSize(MAX_UPLOAD_BYTES)}. Upload a smaller file, or ask the operator to attach it via the Bitrix24 UI first and pass its Disk \`fileId\` instead.`,
          Bitrix24ErrorCode.INVALID_INPUT,
        )
      }

      const taskMeta = await callV2<TaskAttachmentsEnvelope>(
        b24,
        'tasks.task.get',
        { taskId, select: ['ID', 'GROUP_ID'] },
        `Failed to read Bitrix24 task ${taskId} before uploading a file`,
      )
      const groupId = toNumber(taskMeta?.task?.groupId)
      if (groupId === null || groupId === 0) {
        throw new Bitrix24ToolError(
          `Bitrix24 task ${taskId} has no project (personal task) — there's no project Disk storage to upload into. Attach an existing Disk \`fileId\` instead, or move the task into a project first.`,
          Bitrix24ErrorCode.INVALID_INPUT,
        )
      }

      const storages = await callV2<DiskStorageRow[]>(
        b24,
        'disk.storage.getlist',
        { filter: { ENTITY_TYPE: 'group', ENTITY_ID: String(groupId) } },
        `Failed to resolve the Disk storage of Bitrix24 project ${groupId}`,
      )
      const storage = storages?.[0]
      const rootFolderId = toNumber(storage?.ROOT_OBJECT_ID)
      if (rootFolderId === null) {
        throw new Bitrix24ToolError(
          `Bitrix24 project ${groupId} has no Disk storage — cannot upload a file into it.`,
          Bitrix24ErrorCode.INVALID_INPUT,
        )
      }

      const uploadResult = await callV2<{ ID?: string | number }>(
        b24,
        'disk.folder.uploadfile',
        { id: rootFolderId, data: { NAME: upload.name }, fileContent: [upload.name, upload.contentBase64] },
        `Failed to upload "${upload.name}" to Bitrix24 project ${groupId}'s Disk`,
      )
      const newFileId = toNumber(uploadResult?.ID)
      if (newFileId === null) {
        throw new Bitrix24ToolError(`Uploaded "${upload.name}" but Bitrix24 returned no file id to attach.`)
      }
      targetFileId = newFileId
      uploaded = true
    } else {
      targetFileId = fileId!
      uploaded = false
    }

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
      { taskId, fileId: targetFileId },
      `Failed to attach Disk file ${targetFileId} to Bitrix24 task ${taskId}`,
    )

    const after = await callV2<TaskAttachmentsEnvelope>(
      b24,
      'tasks.task.get',
      { taskId, select: ['ID', 'UF_TASK_WEBDAV_FILES'] },
      `Attached file ${targetFileId} to Bitrix24 task ${taskId}, but failed to re-read the task to confirm it`,
    )
    const afterIds = attachmentIds(after?.task?.ufTaskWebdavFiles)
    const attachedId = afterIds.find((id) => !beforeIds.has(id)) ?? null

    if (attachedId === null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ attached: true, uploaded, taskId, fileId: targetFileId, attachedId: null, name: null, sizeBytes: null, size: null }),
          },
        ],
      }
    }

    const meta = await callV2<DiskAttachedObjectRaw>(
      b24,
      'disk.attachedObject.get',
      { id: attachedId },
      `Attached file ${targetFileId} to Bitrix24 task ${taskId} (attachment ${attachedId}), but failed to read its metadata`,
    )
    const sizeBytes = toNumber(meta?.SIZE)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            attached: true,
            uploaded,
            taskId,
            fileId: targetFileId,
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
