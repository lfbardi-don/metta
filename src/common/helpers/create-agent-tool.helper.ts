import { tool } from '@openai/agents';
import { z } from 'zod';
import { AgentContext } from '../interfaces/agent-context.interface';

/**
 * Configuration for creating an agent tool
 */
export interface AgentToolConfig<TParams extends z.ZodTypeAny, TResult = any> {
  /**
   * Tool name in snake_case (e.g., 'get_product', 'search_orders')
   */
  name: string;

  /**
   * Description for the AI agent explaining what the tool does
   */
  description: string;

  /**
   * Zod schema defining the tool's parameters
   */
  parameters: TParams;

  /**
   * Execution function that receives validated params and context
   */
  execute: (
    params: z.infer<TParams>,
    context: AgentContext,
  ) => Promise<TResult> | TResult;
}

/**
 * Create an OpenAI agent tool with standardized error handling and context injection
 *
 * This helper:
 * 1. Converts Zod v4 schemas to JSON Schema using native z.toJSONSchema()
 * 2. Enforces strict mode (all properties required)
 * 3. Provides context injection (services, conversationId, etc.)
 * 4. Standardizes responses as { success, data: result } or { success, error }
 * 5. Centralizes error handling
 *
 * @example
 * ```typescript
 * const getProductTool = createAgentTool({
 *   name: 'get_product',
 *   description: 'Get product details by ID',
 *   parameters: z.object({
 *     productId: z.number().int().positive().describe('Product ID')
 *   }),
 *   execute: async (params, context) => {
 *     const product = await context.services.odooService.getProduct(params.productId);
 *     return product;
 *   }
 * });
 * ```
 */
export function createAgentTool<TParams extends z.ZodTypeAny>(
  config: AgentToolConfig<TParams>,
) {
  // Convert Zod schema to JSON Schema using native Zod v4 method
  // Zod v4 has built-in JSON Schema support, no need for third-party library
  const jsonSchema = z.toJSONSchema(config.parameters) as any;

  // OpenAI strict mode requires ALL properties to be in required array
  // Zod v4's native toJSONSchema() already marks required properties correctly,
  // but we ensure all properties are in the required array for strict mode compliance.
  if (jsonSchema.properties) {
    jsonSchema.required = Object.keys(jsonSchema.properties);
  }

  return tool({
    name: config.name,
    description: config.description,
    parameters: jsonSchema as any,
    execute: async (params, runContext) => {
      try {
        // Validate runContext inside try-catch so errors are caught
        if (!runContext) {
          return {
            success: false,
            error: 'Run context is required',
          };
        }

        const context = runContext.context as AgentContext;
        const logger = context.services.logger;

        logger?.debug('Tool execution started', {
          tool: config.name,
          conversationId: context.conversationId,
        });

        const result = await config.execute(params, context);

        logger?.debug('Tool execution completed', {
          tool: config.name,
          conversationId: context.conversationId,
          success: true,
        });

        // Return structured response with data wrapper
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        // Logger might not be available if context validation failed
        const context = runContext?.context as AgentContext | undefined;
        const logger = context?.services?.logger;

        logger?.error('Tool execution failed', {
          tool: config.name,
          conversationId: context?.conversationId,
          error: error instanceof Error ? error.message : String(error),
        });

        // Return structured error
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
