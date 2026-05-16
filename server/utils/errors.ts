/**
 * Bitrix24 SDK errors carry a `.message` and sometimes a `.code` describing the
 * REST error. We rethrow them as structured Errors so MCP tool handlers can
 * surface meaningful messages to the AI agent without leaking internals like
 * webhook URLs or stack traces.
 */
export class Bitrix24ToolError extends Error {
  override readonly name = 'Bitrix24ToolError'
  readonly code: string

  constructor(message: string, code = 'BITRIX24_ERROR') {
    super(message)
    this.code = code
  }
}

export function toToolError(err: unknown, fallback = 'Bitrix24 request failed'): Bitrix24ToolError {
  if (err instanceof Bitrix24ToolError) return err

  if (err instanceof Error) {
    const code = (err as { code?: string }).code ?? 'BITRIX24_ERROR'
    return new Bitrix24ToolError(err.message || fallback, code)
  }

  return new Bitrix24ToolError(fallback)
}
