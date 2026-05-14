export default defineEventHandler(() => ({
  status: 'ok',
  service: 'bx24-mcp',
  version: useRuntimeConfig().public?.version ?? '0.1.0',
  timestamp: new Date().toISOString(),
}))
