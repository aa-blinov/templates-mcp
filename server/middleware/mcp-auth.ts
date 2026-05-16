import { createError, defineEventHandler, getHeader, getRequestURL } from 'h3'

export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event)

  // Only guard /mcp and /mcp/* — paths like /mcphacked must not bypass auth
  // but also must not require it (404 from the router is fine).
  if (pathname !== '/mcp' && !pathname.startsWith('/mcp/')) return

  const expected = useRuntimeConfig().mcpAuthToken
  if (!expected) {
    // Service-unavailable: not configured, not the caller's fault. Surfacing
    // 500 here would leak misconfiguration to anonymous callers.
    throw createError({
      statusCode: 503,
      statusMessage: 'MCP endpoint is not available',
    })
  }

  const header = getHeader(event, 'authorization')
  if (!header) {
    throw createError({ statusCode: 401, statusMessage: 'Missing Authorization header' })
  }

  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()

  if (!token || !timingSafeEqual(token, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid bearer token' })
  }
})

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
