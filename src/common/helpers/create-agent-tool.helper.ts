import { tool } from '@openai/agents';
import { z } from 'zod';
import { AgentContext } from '../interfaces/agent-context.interface';
import { PIIMetadata } from '../interfaces/guardrail.interface';

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
 * Recursively resolve PII placeholders in parameters
 * Replaces indexed placeholders (e.g., "[EMAIL_1]") with real values from metadata
 *
 * @param params - Tool parameters that may contain placeholders
 * @param metadata - PII metadata mapping placeholders to real values
 * @returns Parameters with resolved placeholders
 */
function resolvePIIPlaceholders(params: any, metadata?: PIIMetadata): any {
  if (!metadata || Object.keys(metadata).length === 0) {
    return params;
  }

  if (typeof params === 'string') {
    // Check if entire string is a placeholder
    if (metadata[params]) {
      return metadata[params];
    }
    // Also replace placeholders within strings
    let resolved = params;
    for (const [placeholder, value] of Object.entries(metadata)) {
      resolved = resolved.replace(placeholder, value);
    }
    return resolved;
  }

  if (Array.isArray(params)) {
    return params.map((item) => resolvePIIPlaceholders(item, metadata));
  }

  if (typeof params === 'object' && params !== null) {
    const resolved: any = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = resolvePIIPlaceholders(value, metadata);
    }
    return resolved;
  }

  return params;
}

/**
 * Create an OpenAI agent tool with standardized error handling and context injection
 *
 * This helper:
 * 1. Converts Zod v4 schemas to JSON Schema using native z.toJSONSchema()
 * 2. Enforces strict mode (all properties required)
 * 3. Provides context injection (services, conversationId, etc.)
 * 4. Resolves PII placeholders in parameters before execution
 * 5. Standardizes responses as { success, data: result } or { success, error }
 * 6. Centralizes error handling
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

        // Resolve PII placeholders in params before execution
        const resolvedParams = resolvePIIPlaceholders(params, context.piiMetadata);

        logger?.debug('Tool execution started', {
          tool: config.name,
          conversationId: context.conversationId,
          hadPlaceholders: context.piiMetadata ? Object.keys(context.piiMetadata).length > 0 : false,
        });

        const result = await config.execute(resolvedParams, context);

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
