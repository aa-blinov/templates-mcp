import { B24Hook } from '@bitrix24/b24jssdk'

let client: B24Hook | null = null

/**
 * Returns a process-singleton Bitrix24 client backed by the incoming webhook
 * configured via NUXT_BITRIX24_WEBHOOK_URL.
 *
 * Phase 1 uses the webhook flow only. Phase 3 will introduce useBitrix24OAuth()
 * alongside this helper without changing its signature.
 */
export function useBitrix24(): B24Hook {
  if (client) return client

  const { bitrix24WebhookUrl } = useRuntimeConfig()
  if (!bitrix24WebhookUrl) {
    throw new Error('NUXT_BITRIX24_WEBHOOK_URL is not configured')
  }

  client = new B24Hook(bitrix24WebhookUrl)
  return client
}

/**
 * Test-only escape hatch: resets the cached client so unit tests can inject
 * their own mock via dependency injection at the call site.
 */
export function _resetBitrix24ClientForTests(): void {
  client = null
}
