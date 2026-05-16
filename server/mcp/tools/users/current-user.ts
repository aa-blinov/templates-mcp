import { defineMcpTool } from '@nuxtjs/mcp-toolkit/server'
import { useBitrix24 } from '~/server/utils/bitrix24'
import { toToolError } from '~/server/utils/errors'

/**
 * Returns the Bitrix24 user identity behind the configured incoming webhook.
 * Useful as a smoke test for AI agents to confirm the MCP is wired correctly.
 *
 * Bitrix24 REST: https://apidocs.bitrix24.com/api-reference/user/user-current.html
 */
export default defineMcpTool({
  name: 'bitrix24_current_user',
  description:
    'Get the Bitrix24 user that owns the configured incoming webhook. Use this as a connectivity check or when you need the operator id/name/email before creating tasks or deals.',
  inputSchema: {},
  handler: async () => {
    try {
      const b24 = useBitrix24()
      const response = await b24.callMethod('user.current', {})
      const user = response.getData()?.result

      if (!user) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Bitrix24 returned no user — verify the webhook URL is valid and not revoked.',
            },
          ],
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: user.ID,
                name: user.NAME,
                lastName: user.LAST_NAME,
                email: user.EMAIL,
                isAdmin: user.ADMIN === true,
                portal: user.SERVER_NAME,
              },
              null,
              2,
            ),
          },
        ],
      }
    } catch (err) {
      throw toToolError(err, 'Failed to fetch current Bitrix24 user')
    }
  },
})
