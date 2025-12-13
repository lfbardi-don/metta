import { hostedMcpTool } from '@openai/agents';

/**
 * Helper to wrap tools with logging
 */
function wrapToolForLogging(tool: any): any {
  if (Array.isArray(tool)) {
    return tool.map(wrapToolForLogging);
  }
  if (tool.tools && Array.isArray(tool.tools)) {
    // It's a ToolSet
    tool.tools = tool.tools.map(wrapToolForLogging);
    return tool;
  }
  if (tool.function && typeof tool.function.execute === 'function') {
    const originalExecute = tool.function.execute;
    tool.function.execute = async (...args: any[]) => {
      console.log(
        `[Tool Call] ${tool.function.name}`,
        JSON.stringify(args, null, 2),
      );
      try {
        const result = await originalExecute.apply(tool.function, args);
        console.log(
          `[Tool Result] ${tool.function.name}`,
          JSON.stringify(result, null, 2),
        );
        return result;
      } catch (error) {
        console.error(`[Tool Error] ${tool.function.name}`, error);
        throw error;
      }
    };
  }
  return tool;
}

/**
 * NuvemShop Orders MCP Tool
 *
 * Provides access to order-related functions:
 * - check_auth_status: Check customer authentication status
 * - verify_dni: Verify customer identity with DNI
 * - get_last_order: Get customer's most recent order
 */
export const ordersMcpTool = wrapToolForLogging(
  hostedMcpTool({
    serverLabel: 'NuvemShop_Orders',
    serverUrl: 'https://nuvemshop-orders.luisfbardi.workers.dev/sse',
    allowedTools: ['check_auth_status', 'verify_dni', 'get_last_order'],
    requireApproval: 'never',
  }),
);

/**
 * NuvemShop Products MCP Tool
 *
 * Provides access to product catalog functions:
 * - search_nuvemshop_products: Search products with filters
 * - get_nuvemshop_product: Get product by ID
 * - get_nuvemshop_product_by_sku: Get product by SKU
 * - get_nuvemshop_categories: List product categories
 */
export const productsMcpTool = wrapToolForLogging(
  hostedMcpTool({
    serverLabel: 'NuvemShop_Products',
    serverUrl: 'https://nuvemshop-products.luisfbardi.workers.dev/sse',
    allowedTools: [
      'search_nuvemshop_products',
      'get_nuvemshop_product',
      'get_nuvemshop_product_by_sku',
      'get_nuvemshop_categories',
    ],
    requireApproval: 'never',
  }),
);
