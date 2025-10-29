import { z } from 'zod';
import { createAgentTool, AgentToolConfig } from './create-agent-tool.helper';
import { AgentContext } from '../interfaces/agent-context.interface';

/**
 * Create a protected AI agent tool that requires authentication
 *
 * This wrapper:
 * 1. Checks authentication status before executing the tool
 * 2. Returns clear error message if not authenticated
 * 3. Provides same interface as createAgentTool for consistency
 *
 * Use this for tools that access private customer data (orders, tracking, payment history, etc.)
 *
 * @example
 * ```typescript
 * const getCustomerOrdersTool = createProtectedTool({
 *   name: 'get_customer_orders',
 *   description: 'Get customer order history. Requires authentication.',
 *   parameters: z.object({
 *     email: z.string().email().describe('Customer email address')
 *   }),
 *   execute: async (params, context) => {
 *     // This only runs if customer is authenticated
 *     return context.services.nuvemshopService.getOrdersByCustomer(params.email);
 *   }
 * });
 * ```
 */
export function createProtectedTool<TParams extends z.ZodTypeAny>(
  config: AgentToolConfig<TParams>,
) {
  // Create wrapped execute function that checks auth first
  const wrappedExecute = async (
    params: z.infer<TParams>,
    context: AgentContext,
  ) => {
    const { authenticationService, logger } = context.services;

    // Check authentication status
    const authStatus = await authenticationService.getAuthStatus(context.conversationId);

    // If not authenticated, return error instructing AI to use verify_dni tool
    if (!authStatus.authenticated) {
      logger?.warn('Protected tool called without authentication', {
        tool: config.name,
        conversationId: context.conversationId,
      });

      throw new Error(
        'AUTHENTICATION_REQUIRED: Customer must verify their identity before accessing this information. ' +
        'Please use the verify_dni tool to authenticate the customer first.',
      );
    }

    // Check if session has expired
    if (authStatus.expired) {
      logger?.warn('Protected tool called with expired session', {
        tool: config.name,
        conversationId: context.conversationId,
      });

      throw new Error(
        'SESSION_EXPIRED: Authentication session has expired. ' +
        'Please ask the customer to verify their DNI again using the verify_dni tool.',
      );
    }

    logger?.debug('Authentication check passed for protected tool', {
      tool: config.name,
      conversationId: context.conversationId,
      remainingMinutes: authStatus.remainingMinutes,
    });

    // Authentication passed - execute the actual tool logic
    return config.execute(params, context);
  };

  // Create the tool using createAgentTool with wrapped execute
  return createAgentTool({
    ...config,
    // Append "(Requires authentication)" to description so AI knows
    description: `${config.description} (Requires authentication)`,
    execute: wrappedExecute,
  });
}
