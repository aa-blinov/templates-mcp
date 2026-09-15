import type { LogLevel } from '@bitrix24/b24jssdk'
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { StreamHandler } from '@bitrix24/b24jssdk'

/**
 * Optional file sink for `useLogger()` (`server/utils/logger.ts`), for
 * operators who want a persistent log to grep after an incident (e.g. the
 * timeout reports in issue-style questions: "why did this call hang?") —
 * the default `ConsoleHandler` only reaches stdout/stderr, which most
 * deployments don't retain.
 *
 * Opt-in via `NUXT_LOG_DIR` (unset → no file writes, unchanged default
 * behaviour). Daily-rotated files (`YYYY-MM-DD.log`, same convention as
 * `server/utils/audit-log.ts`'s `NUXT_AUDIT_DIR`), with in-process
 * retention: on each day rollover, files older than `NUXT_LOG_RETENTION_DAYS`
 * (default 14) are deleted. Unlike the audit log, this file's contents are
 * operational debug noise, not a compliance trail, so auto-deletion here is
 * fine — nothing forensic depends on the log outliving its retention window.
 *
 * Writes use the *Sync* fs calls, not the promise API: `StreamHandler.handle`
 * fires `stream.write(message)` without awaiting completion, so an async
 * `_write` would let the process (or a test) observe `handle()` resolving
 * before the line actually lands on disk. Log volume here is low (app +
 * SDK events, not a hot request path), so the sync I/O cost is a non-issue.
 */
const FILE_MODE = 0o640
const DIR_MODE = 0o750
const DEFAULT_RETENTION_DAYS = 14
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.log$/
const DAY_MS = 24 * 60 * 60 * 1000

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Resolves the retention window from `NUXT_LOG_RETENTION_DAYS`. Falls back
 * to {@link DEFAULT_RETENTION_DAYS} for unset/blank/non-positive/NaN values
 * — a misconfigured knob should degrade to "keep two weeks", not "keep
 * everything forever" or "delete today's file".
 */
function resolveRetentionDays(): number {
  const raw = process.env.NUXT_LOG_RETENTION_DAYS?.trim()
  if (!raw) return DEFAULT_RETENTION_DAYS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS
}

/**
 * `Writable` that appends written lines to `<dir>/<YYYY-MM-DD>.log` (UTC
 * day, matching the audit log's rotation key) and prunes stale day-files
 * once per calendar day.
 *
 * ponytail: retention runs on the first write after midnight, not on a
 * timer — a process that never logs across a day boundary just carries one
 * extra day of files until its next write after restart. Good enough for a
 * debug log; add a timer if a long-idle deployment needs tighter pruning.
 */
class RotatingFileStream extends Writable {
  private day = ''
  private dirEnsured = false

  constructor(private readonly dir: string, private readonly retentionDays: number) {
    super()
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      if (!this.dirEnsured) {
        mkdirSync(this.dir, { recursive: true, mode: DIR_MODE })
        this.dirEnsured = true
      }

      const day = today()
      if (day !== this.day) {
        this.day = day
        // Best-effort — a prune failure (e.g. transient EACCES) must not
        // drop the log line that triggered it.
        try {
          this.prune()
        }
        catch (err) {
          console.error(`[bx24-template-mcp] log retention prune failed: ${String(err)}`)
        }
      }

      appendFileSync(path.join(this.dir, `${day}.log`), chunk, { mode: FILE_MODE })
      callback()
    }
    catch (err) {
      callback(err as Error)
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.retentionDays * DAY_MS
    for (const name of readdirSync(this.dir)) {
      const match = DAY_FILE_RE.exec(name)
      if (!match?.[1]) continue
      if (new Date(`${match[1]}T00:00:00Z`).getTime() < cutoff) {
        try {
          unlinkSync(path.join(this.dir, name))
        }
        catch {
          // Already gone, or a transient permission blip — not fatal.
        }
      }
    }
  }
}

/**
 * Builds a `StreamHandler` writing to `NUXT_LOG_DIR`, or `null` when that
 * env var is unset/blank — the caller (`useLogger()`) then skips pushing a
 * file handler entirely, so a deploy that never opts in never touches disk.
 */
export function createLogFileHandler(level: LogLevel): StreamHandler | null {
  const dir = process.env.NUXT_LOG_DIR?.trim()
  if (!dir) return null

  return new StreamHandler(level, { stream: new RotatingFileStream(dir, resolveRetentionDays()) })
}
