import { z } from 'zod';
import { createAgentTool } from '../../../../common/helpers/create-agent-tool.helper';

/**
 * Tool: Verify customer DNI for authentication
 *
 * This tool:
 * 1. Takes customer email (auto-resolved from PII metadata) and DNI last digits
 * 2. Looks up customer in Nuvemshop/Odoo by email
 * 3. Verifies DNI digits match customer records
 * 4. Creates authenticated session (30 min) if successful
 *
 * Usage by AI agent:
 * - When customer asks about orders/tracking without being authenticated
 * - After collecting email (from conversation) and DNI last digits (from user)
 * - Before calling any protected tools (get_customer_orders, get_order_tracking, etc.)
 */
export const verifyDNITool = createAgentTool({
  name: 'verify_dni',
  description:
    'Verify customer identity using DNI (last 3 digits) to enable access to private order information. ' +
    'Call this when customer asks about orders, tracking, or payment history and is not yet authenticated. ' +
    'After successful verification, customer can access protected order data.',
  parameters: z.object({
    email: z
      .string()
      .email()
      .describe(
        'Customer email address. This may be a PII placeholder like [EMAIL_1] which will be auto-resolved.',
      ),
    dniLastDigits: z
      .string()
      .length(3)
      .regex(/^\d+$/, 'DNI digits must be numeric')
      .describe(
        'Last 3 digits of customer DNI/CPF. Ask customer to provide these digits for verification.',
      ),
  }),
  execute: async (params, context) => {
    const { authenticationService, logger } = context.services;

    logger?.log('Verifying customer DNI', {
      conversationId: context.conversationId,
      email: params.email.includes('[EMAIL') ? params.email : '[REDACTED]',
    });

    // Call authentication service to verify DNI
    const result = await authenticationService.verifyDNI(
      context.conversationId,
      params.email,
      params.dniLastDigits,
    );

    if (result.verified) {
      logger?.log('DNI verification successful', {
        conversationId: context.conversationId,
        sessionExpiresAt: result.sessionExpiresAt,
      });

      return {
        success: true,
        message: 'Customer identity verified successfully. You can now access their order information.',
        sessionDuration: '30 minutes',
        expiresAt: result.sessionExpiresAt?.toISOString(),
      };
    } else {
      logger?.warn('DNI verification failed', {
        conversationId: context.conversationId,
        error: result.error,
      });

      return {
        success: false,
        message:
          result.error ||
          'DNI verification failed. Please ask customer to provide the correct last 3 digits.',
      };
    }
  },
});
