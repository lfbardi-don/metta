/**
 * Odoo Tools for AI Agents
 *
 * All tools for interacting with Odoo ERP system.
 * Tools are organized by category: Products and Orders/Customers.
 */

import { z } from 'zod';
import { createAgentTool } from '../../../common/helpers/create-agent-tool.helper';

// ============================================================================
// PRODUCT TOOLS
// ============================================================================

/**
 * Tool: Get Product Details
 *
 * Retrieves detailed information about a specific product by its ID from Odoo.
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
    .describe('The Odoo product ID to retrieve'),
});

export const getProductTool = createAgentTool({
  name: 'get_product',
  description:
    'Get product details by product ID. Returns name, price, stock, SKU, description, and category.',
  parameters: getProductSchema,
  execute: async (params, context) => {
    const { odooService } = context.services;
    const product = await odooService.getProduct(params.productId);
    return product;
  },
});

/**
 * Tool: Search Products
 *
 * Searches for products in Odoo by name, SKU, or barcode.
 * Returns a list of matching products with their details.
 *
 * Use this when the customer:
 * - Asks about a product by name (e.g., "Do you have the iPhone 15?")
 * - Wants to find products by SKU or barcode
 * - Needs to browse available products
 */
const searchProductsSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe('Product name, SKU, or barcode to search'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Maximum number of results (default: 10, max: 50)'),
});

export const searchProductsTool = createAgentTool({
  name: 'search_products',
  description:
    'Search products by name, SKU, or barcode. Returns list of matching products with prices and availability.',
  parameters: searchProductsSchema,
  execute: async (params, context) => {
    const { odooService } = context.services;
    const products = await odooService.searchProducts(
      params.query,
      params.limit ?? 10, // Explicit default
    );
    return products;
  },
});

// ============================================================================
// ORDER & CUSTOMER TOOLS
// ============================================================================

/**
 * Tool: Get Order Details
 *
 * Retrieves complete information about a specific order by ID or reference number.
 * Returns order status, items, customer information, total amount, and creation date.
 *
 * Supports two types of identifiers:
 * - Numeric ID (e.g., "123" or 123) - Internal Odoo order ID
 * - Reference (e.g., "SO001") - Order reference/number shown to customers
 *
 * Use this when the customer:
 * - Asks about a specific order (e.g., "Where is my order SO001?")
 * - Wants to check order status
 * - Needs details about order items
 */
const getOrderSchema = z.object({
  orderIdentifier: z
    .string()
    .min(1)
    .describe(
      'Order ID or reference as string (e.g., "123" for ID or "SO12345" for reference)',
    ),
});

export const getOrderTool = createAgentTool({
  name: 'get_order',
  description:
    'Get order details by ID or reference. Accepts order ID as string (e.g., "123") or order reference (e.g., "SO12345"). Returns full order details with status, items, customer info, and total.',
  parameters: getOrderSchema,
  execute: async (params, context) => {
    const { odooService } = context.services;
    const order = await odooService.getOrderByIdentifier(
      params.orderIdentifier,
    );
    return order;
  },
});

/**
 * Tool: Get Customer Orders
 *
 * Retrieves order history for a specific customer identified by email address.
 * Supports various filters for common customer queries.
 *
 * Use this when the customer asks about:
 * - "My orders" or "My order history"
 * - "Recent orders" (use days filter)
 * - "Pending orders" (use status='draft')
 * - "Delivered orders" (use status='done')
 */
const getCustomerOrdersSchema = z.object({
  email: z.string().email().describe('Customer email address'),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe('Maximum number of orders to return (default: 5, max: 20)'),
  days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Only show orders from last N days (e.g., 30 for recent orders)',
    ),
  status: z
    .enum(['draft', 'sale', 'done', 'cancel'])
    .optional()
    .describe(
      'Filter by status: draft (pending), sale (confirmed), done (delivered), cancel (cancelled)',
    ),
});

export const getCustomerOrdersTool = createAgentTool({
  name: 'get_customer_orders',
  description:
    'Get customer order history with optional filters. Use this for "my orders", "recent orders", "pending orders", etc. Returns order list sorted by most recent first.',
  parameters: getCustomerOrdersSchema,
  execute: async (params, context) => {
    const { odooService } = context.services;
    const orders = await odooService.getOrdersByCustomer(params.email, {
      limit: params.limit ?? 5, // Explicit default
      days: params.days, // Optional, undefined is acceptable
      status: params.status, // Optional, undefined is acceptable
    });
    return orders;
  },
});

/**
 * Tool: Get Customer Information
 *
 * Retrieves customer details by customer ID from Odoo.
 * Returns customer name, email, and phone number.
 *
 * Use this when you need to:
 * - Look up customer contact information
 * - Verify customer details
 * - Get customer info after receiving a customer ID from another tool
 */
const getCustomerSchema = z.object({
  customerId: z
    .number()
    .int()
    .positive()
    .describe('The Odoo customer/partner ID'),
});

export const getCustomerTool = createAgentTool({
  name: 'get_customer',
  description:
    'Get customer information by customer ID. Returns name, email, and phone.',
  parameters: getCustomerSchema,
  execute: async (params, context) => {
    const { odooService } = context.services;
    const customer = await odooService.getCustomer(params.customerId);
    return customer;
  },
});

// ============================================================================
// TOOL COLLECTIONS (for agent assignment)
// ============================================================================

/**
 * Get all Odoo tools as an array
 * Used by AIService to assign tools to specialist agents
 */
export const getAllOdooTools = () => [
  getProductTool,
  searchProductsTool,
  getOrderTool,
  getCustomerOrdersTool,
  getCustomerTool,
];

/**
 * Get tools filtered by category
 * Useful for assigning specific tools to specialist agents
 */
export const getProductTools = () => [getProductTool, searchProductsTool];

export const getOrderTools = () => [
  getOrderTool,
  getCustomerOrdersTool,
  getCustomerTool,
];
