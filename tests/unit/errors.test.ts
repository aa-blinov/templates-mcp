import { describe, expect, it } from 'vitest'
import { Bitrix24ToolError, toToolError } from '../../server/utils/errors'

describe('toToolError', () => {
  it('returns the same instance when given a Bitrix24ToolError', () => {
    const original = new Bitrix24ToolError('boom', 'CUSTOM')
    const wrapped = toToolError(original)
    expect(wrapped).toBe(original)
  })

  it('wraps a generic Error preserving its message', () => {
    const wrapped = toToolError(new Error('network down'))
    expect(wrapped).toBeInstanceOf(Bitrix24ToolError)
    expect(wrapped.message).toBe('network down')
    expect(wrapped.code).toBe('BITRIX24_ERROR')
  })

  it('lifts a numeric/string code property from the source error', () => {
    const err = Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
    const wrapped = toToolError(err)
    expect(wrapped.code).toBe('NOT_FOUND')
  })

  it('falls back to the supplied default for non-Error values', () => {
    const wrapped = toToolError('something', 'fallback message')
    expect(wrapped.message).toBe('fallback message')
    expect(wrapped.code).toBe('BITRIX24_ERROR')
  })
})
