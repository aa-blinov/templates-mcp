import { B24Hook } from '@bitrix24/b24jssdk'

let client: B24Hook | null = null

/**
 * Returns a process-singleton Bitrix24 client backed by the incoming webhook
 * configured via NUXT_BITRIX24_WEBHOOK_URL.
 *
 * Phase 1 uses the webhook flow only. Phase 3 will introduce useBitrix24OAuth()
 * alongside this helper without changing its signature.
 *
 * The cache lives in module scope, so tests that need a clean state should
 * `vi.resetModules()` and re-import this module — we deliberately do not
 * export a reset hook to avoid leaking test-only API into production builds.
 */
export function useBitrix24(): B24Hook {
  if (client) return client

  const { bitrix24WebhookUrl } = useRuntimeConfig()
  if (!bitrix24WebhookUrl) {
    throw new Error('NUXT_BITRIX24_WEBHOOK_URL is not configured')
  }

  // SDK 1.1+ no longer accepts a raw URL in the constructor — the helper
  // parses portal host, user id, and secret out of the webhook URL.
  client = B24Hook.fromWebhookUrl(bitrix24WebhookUrl)
  return client
}
