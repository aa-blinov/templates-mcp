import { createError, defineEventHandler, getHeader, getRequestURL } from 'h3'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)

  if (!url.pathname.startsWith('/mcp')) return

  const expected = useRuntimeConfig().mcpAuthToken
  if (!expected) {
    throw createError({
      statusCode: 500,
      statusMessage: 'MCP auth token is not configured on the server',
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
