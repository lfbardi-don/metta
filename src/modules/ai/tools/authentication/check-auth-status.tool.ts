import { z } from 'zod';
import { createAgentTool } from '../../../../common/helpers/create-agent-tool.helper';

/**
 * Tool: Check authentication status
 *
 * This tool:
 * 1. Checks if customer has an active authenticated session
 * 2. Returns session details (expiration time, remaining minutes)
 * 3. Helps AI agent decide whether to request authentication
 *
 * Usage by AI agent:
 * - Before attempting to access protected order data
 * - To inform customer about session status
 * - To determine if re-authentication is needed (session expired)
 */
export const checkAuthStatusTool = createAgentTool({
  name: 'check_auth_status',
  description:
    'Check if customer is currently authenticated to access private order information. ' +
    'Use this before calling protected tools to avoid authentication errors. ' +
    'Returns session status and expiration time if authenticated.',
  parameters: z.object({
    // No parameters needed - uses conversationId from context
  }),
  execute: async (params, context) => {
    const { authenticationService, logger } = context.services;

    logger?.debug('Checking authentication status', {
      conversationId: context.conversationId,
    });

    const authStatus = await authenticationService.getAuthStatus(context.conversationId);

    if (authStatus.authenticated) {
      logger?.debug('Customer is authenticated', {
        conversationId: context.conversationId,
        remainingMinutes: authStatus.remainingMinutes,
      });

      return {
        authenticated: true,
        message: 'Customer is authenticated and can access private order information.',
        expiresAt: authStatus.expiresAt?.toISOString(),
        remainingMinutes: authStatus.remainingMinutes,
      };
    } else if (authStatus.expired) {
      logger?.debug('Customer session has expired', {
        conversationId: context.conversationId,
      });

      return {
        authenticated: false,
        expired: true,
        message:
          'Customer authentication session has expired. Please ask customer to verify their DNI again using verify_dni tool.',
      };
    } else {
      logger?.debug('Customer is not authenticated', {
        conversationId: context.conversationId,
      });

      return {
        authenticated: false,
        message:
          'Customer is not authenticated. To access order information, ask for their email and last 3 digits of DNI, then use the verify_dni tool.',
      };
    }
  },
});
