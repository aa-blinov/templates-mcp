// Public, unauthenticated probe. Keep payload minimal and stable — the deploy
// workflow polls this endpoint to decide whether to roll back.
const VERSION = '0.1.0'

export default defineEventHandler(() => ({
  status: 'ok',
  service: 'bx24-template-mcp',
  version: VERSION,
  timestamp: new Date().toISOString(),
}))
