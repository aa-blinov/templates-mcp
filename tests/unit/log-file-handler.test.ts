import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LogLevel } from '@bitrix24/b24jssdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogFileHandler } from '../../server/utils/log-file-handler'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'log-file-handler-test-'))
})

afterEach(async () => {
  delete process.env.NUXT_LOG_DIR
  delete process.env.NUXT_LOG_RETENTION_DAYS
  await rm(tmpDir, { recursive: true, force: true })
})

function todayFile(): string {
  return `${new Date().toISOString().slice(0, 10)}.log`
}

describe('createLogFileHandler', () => {
  it('returns null when NUXT_LOG_DIR is unset — no file ever gets written', () => {
    expect(createLogFileHandler(LogLevel.INFO)).toBeNull()
  })

  it('writes a log line into today\'s rotated file', async () => {
    process.env.NUXT_LOG_DIR = tmpDir
    const handler = createLogFileHandler(LogLevel.INFO)
    expect(handler).not.toBeNull()

    await handler!.handle({
      channel: 'test',
      level: LogLevel.INFO,
      levelName: 'INFO',
      message: 'hello',
      context: {},
      extra: {},
      timestamp: new Date(),
    })

    const file = path.join(tmpDir, todayFile())
    const content = await readFile(file, 'utf8')
    expect(content).toContain('hello')
  })

  it('prunes day-files older than the retention window on the next write', async () => {
    process.env.NUXT_LOG_DIR = tmpDir
    process.env.NUXT_LOG_RETENTION_DAYS = '1'

    // Plant a stale file (well past the 1-day window) and a bogus non-day
    // file that must be left alone.
    await mkdir(tmpDir, { recursive: true })
    await writeFile(path.join(tmpDir, '2000-01-01.log'), 'stale\n')
    await writeFile(path.join(tmpDir, 'not-a-day-file.log'), 'keep me\n')

    const handler = createLogFileHandler(LogLevel.INFO)
    await handler!.handle({
      channel: 'test',
      level: LogLevel.INFO,
      levelName: 'INFO',
      message: 'trigger rotation',
      context: {},
      extra: {},
      timestamp: new Date(),
    })

    const entries = await readdir(tmpDir)
    expect(entries).not.toContain('2000-01-01.log')
    expect(entries).toContain('not-a-day-file.log')
    expect(entries).toContain(todayFile())
  })
})
