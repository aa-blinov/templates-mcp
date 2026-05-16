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
    // SERVER_NAME mirrors what Bitrix24's user.current REST method returns —
    // the portal hostname. Any string is fine for the mock; the handler maps it
    // to the `portal` field in the response.
    callMethod.mockResolvedValue({
      getData: () => ({
        result: {
          ID: 1,
          NAME: 'Ada',
          LAST_NAME: 'Lovelace',
          EMAIL: 'SomeUser@example.com',
          ADMIN: true,
          SERVER_NAME: 'for-test.bitrix24.com',
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
      email: 'SomeUser@example.com',
      isAdmin: true,
      portal: 'for-test.bitrix24.com',
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
