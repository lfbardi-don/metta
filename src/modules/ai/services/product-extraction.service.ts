import { Injectable, Logger } from '@nestjs/common';
import { ProductMention } from '../../../common/interfaces';

@Injectable()
export class ProductExtractionService {
  private readonly logger = new Logger(ProductExtractionService.name);

  /**
   * Extract products from MCP tool calls (real product IDs)
   *
   * Parses newItems array from workflow execution to find MCP product tool calls
   * and extracts actual product IDs from their responses.
   *
   * @param newItems - Array of RunItem from workflow execution
   * @returns Array of ProductMention objects with real product IDs
   */
  extractProductsFromToolCalls(newItems: any[]): ProductMention[] {
    const productMentions: ProductMention[] = [];
    const now = new Date();

    try {
      // Filter for tool call items with mcp_call and output
      const toolOutputs = newItems.filter(
        (item) =>
          item?.type === 'tool_call_item' &&
          item?.rawItem?.name === 'mcp_call' &&
          item?.rawItem?.output,
      );

      for (const item of toolOutputs) {
        // Get actual MCP tool name from providerData (not 'mcp_call' wrapper)
        const toolName = item.rawItem?.providerData?.name;

        // Only process product-related MCP tools
        if (!toolName || !toolName.includes('nuvemshop_product')) {
          continue;
        }

        // Parse tool output (could be string or object)
        let toolResult;
        if (typeof item.rawItem.output === 'string') {
          try {
            toolResult = JSON.parse(item.rawItem.output);
          } catch (parseError) {
            this.logger.warn(`Failed to parse tool output for ${toolName}`, {
              error: parseError.message,
              outputPreview: item.rawItem.output?.substring(0, 200),
            });
            continue;
          }
        } else {
          toolResult = item.rawItem.output;
        }

        // Extract products based on tool type
        if (toolName === 'search_nuvemshop_products') {
          // Search returns array or { products: [...] }
          const products = Array.isArray(toolResult)
            ? toolResult
            : toolResult.products || [];

          for (const product of products) {
            if (product.id && product.name) {
              productMentions.push({
                productId: product.id,
                productName: product.name,
                mentionedAt: now,
                context: 'search',
              });
            }
          }
        } else if (
          toolName === 'get_nuvemshop_product' ||
          toolName === 'get_nuvemshop_product_by_sku'
        ) {
          // Get returns single product object
          if (toolResult.id && toolResult.name) {
            productMentions.push({
              productId: toolResult.id,
              productName: toolResult.name,
              mentionedAt: now,
              context: 'question',
            });
          }
        }
      }

      // Deduplicate by product ID
      const uniqueMentions = productMentions.filter(
        (mention, index, self) =>
          index === self.findIndex((m) => m.productId === mention.productId),
      );

      return uniqueMentions;
    } catch (error) {
      this.logger.error('Failed to extract products from tool calls', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Extract products from structured AI response (fallback)
   *
   * @param structuredProducts - Array of products returned by the LLM in JSON
   * @returns Array of ProductMention objects
   */
  extractProductsFromStructuredOutput(
    structuredProducts: any[],
  ): ProductMention[] {
    if (!structuredProducts || structuredProducts.length === 0) {
      return [];
    }

    return structuredProducts.map((p) => ({
      productId: p.id || 0,
      productName: p.name,
      mentionedAt: new Date(),
      context: 'recommendation',
    }));
  }
}
