import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nuxtjs/mcp-toolkit/server', () => ({
  defineMcpTool: <T,>(spec: T) => spec,
}))

const callMethod = vi.fn()

vi.mock('~/server/utils/bitrix24', () => ({
  useBitrix24: () => ({ callMethod }),
}))

const tool = (await import('../../../server/mcp/tools/users/current-user')).default as {
  handler: (input: Record<string, never>) => Promise<unknown>
}

describe('bitrix24_current_user', () => {
  beforeEach(() => {
    callMethod.mockReset()
  })

  it('calls user.current and returns the shaped user payload', async () => {
    callMethod.mockResolvedValue({
      getData: () => ({
        result: {
          ID: 1,
          NAME: 'Ada',
          LAST_NAME: 'Lovelace',
          EMAIL: '[email protected]',
          ADMIN: true,
          SERVER_NAME: 'b24-m0fhhz.bitrix24.ru',
        },
      }),
    })

    const result = (await tool.handler({})) as {
      content: { type: 'text'; text: string }[]
    }

    expect(callMethod).toHaveBeenCalledWith('user.current', {})
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload).toEqual({
      id: 1,
      name: 'Ada',
      lastName: 'Lovelace',
      email: '[email protected]',
      isAdmin: true,
      portal: 'b24-m0fhhz.bitrix24.ru',
    })
  })

  it('returns a friendly message when Bitrix24 has no result', async () => {
    callMethod.mockResolvedValue({ getData: () => ({}) })

    const result = await tool.handler({})

    expect(result).toMatch(/no user/i)
  })

  it('wraps SDK errors into Bitrix24ToolError', async () => {
    callMethod.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 'UNAUTHORIZED' }))

    await expect(tool.handler({})).rejects.toMatchObject({
      name: 'Bitrix24ToolError',
      message: 'Unauthorized',
      code: 'UNAUTHORIZED',
    })
  })
})
