/**
 * Nuvemshop/Tiendanube Tools for AI Agents
 *
 * All tools for interacting with Nuvemshop/Tiendanube e-commerce platform.
 * Currently focused on Product operations (read-only).
 */

import { z } from 'zod';
import { createAgentTool } from '../../../common/helpers/create-agent-tool.helper';

// ============================================================================
// PRODUCT TOOLS
// ============================================================================

/**
 * Tool: Get Product Details from Nuvemshop
 *
 * Retrieves detailed information about a specific product by its ID from Nuvemshop.
 * Returns product name, price, stock availability, SKU, description, and category.
 *
 * Use this when the customer asks about a specific product they already know the ID for,
 * or after a search to get full details about a product.
 */
const getProductSchema = z.object({
  productId: z
    .number()
    .int()
    .positive()
    .describe('The Nuvemshop product ID to retrieve'),
});

export const getNuvemshopProductTool = createAgentTool({
  name: 'get_nuvemshop_product',
  description:
    'Get product details from Nuvemshop by product ID. Returns name, price, stock, SKU, description, category, and image URL.',
  parameters: getProductSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const product = await nuvemshopService.getProduct(params.productId);

    // Add product to context for image extraction
    if (!context.returnedProducts) {
      context.returnedProducts = [];
    }
    context.returnedProducts.push(product);

    return product;
  },
});

/**
 * Tool: Search Products in Nuvemshop
 *
 * Searches for products in Nuvemshop by name, SKU, or description.
 * Returns a list of matching published products with their details.
 *
 * Use this when the customer:
 * - Asks about a product by name (e.g., "Do you have Nike sneakers?")
 * - Wants to find products by SKU
 * - Needs to browse available products
 * - Asks about product availability
 */
const searchProductsSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe('Product name or SKU to search'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Maximum number of results (default: 10, max: 50)'),
});

export const searchNuvemshopProductsTool = createAgentTool({
  name: 'search_nuvemshop_products',
  description:
    'Search products in Nuvemshop by name or SKU. Returns list of matching published products with prices, stock, and images. Only searches active/published products.',
  parameters: searchProductsSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const products = await nuvemshopService.searchProducts(
      params.query,
      params.limit ?? 10, // Explicit default
    );

    // Add products to context for image extraction
    if (!context.returnedProducts) {
      context.returnedProducts = [];
    }
    context.returnedProducts.push(...products);

    return products;
  },
});

/**
 * Tool: Get Product Stock Information from Nuvemshop
 *
 * Retrieves detailed stock information for a specific product.
 * Returns product details with variant-level stock information if the product has multiple variants.
 *
 * Use this when the customer asks:
 * - "How many units do you have in stock?"
 * - "Is this product available?"
 * - "Do you have this in different sizes/colors?" (variants)
 * - Needs to check inventory levels
 */
const getProductStockSchema = z.object({
  productId: z
    .number()
    .int()
    .positive()
    .describe('The Nuvemshop product ID to check stock for'),
});

export const getNuvemshopProductStockTool = createAgentTool({
  name: 'get_nuvemshop_product_stock',
  description:
    'Get detailed stock information for a product in Nuvemshop. Returns product details with stock levels for all variants. Use this to check inventory availability.',
  parameters: getProductStockSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const product = await nuvemshopService.getProductStock(params.productId);

    // Add product to context for image extraction
    if (!context.returnedProducts) {
      context.returnedProducts = [];
    }
    context.returnedProducts.push(product);

    return product;
  },
});

// ============================================================================
// TOOL COLLECTIONS (for agent assignment)
// ============================================================================

/**
 * Get all Nuvemshop tools as an array
 * Used by AIService to assign tools to specialist agents
 */
export const getAllNuvemshopTools = () => [
  getNuvemshopProductTool,
  searchNuvemshopProductsTool,
  getNuvemshopProductStockTool,
];

/**
 * Get product-specific tools
 * Useful for assigning to Products Agent
 */
export const getNuvemshopProductTools = () => [
  getNuvemshopProductTool,
  searchNuvemshopProductsTool,
  getNuvemshopProductStockTool,
];
