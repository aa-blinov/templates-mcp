import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const B24HookMock = vi.fn()

vi.mock('@bitrix24/b24jssdk', () => ({
  B24Hook: B24HookMock,
}))

const runtimeConfig: { bitrix24WebhookUrl: string } = { bitrix24WebhookUrl: '' }

vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)

const { useBitrix24, _resetBitrix24ClientForTests } = await import(
  '../../server/utils/bitrix24'
)

describe('useBitrix24', () => {
  beforeEach(() => {
    B24HookMock.mockReset()
    B24HookMock.mockImplementation(function (this: { url: string }, url: string) {
      this.url = url
    })
    _resetBitrix24ClientForTests()
  })

  afterEach(() => {
    runtimeConfig.bitrix24WebhookUrl = ''
  })

  it('throws when the webhook URL is missing', () => {
    expect(() => useBitrix24()).toThrow(/NUXT_BITRIX24_WEBHOOK_URL/)
  })

  it('constructs B24Hook with the webhook URL on first call', () => {
    runtimeConfig.bitrix24WebhookUrl = 'https://example.bitrix24.ru/rest/1/abc/'
    useBitrix24()
    expect(B24HookMock).toHaveBeenCalledWith('https://example.bitrix24.ru/rest/1/abc/')
  })

  it('returns the same instance on subsequent calls (singleton)', () => {
    runtimeConfig.bitrix24WebhookUrl = 'https://example.bitrix24.ru/rest/1/abc/'
    const first = useBitrix24()
    const second = useBitrix24()
    expect(first).toBe(second)
    expect(B24HookMock).toHaveBeenCalledTimes(1)
  })
})
