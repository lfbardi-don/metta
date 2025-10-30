/**
 * Nuvemshop/Tiendanube Tools for AI Agents
 *
 * All tools for interacting with Nuvemshop/Tiendanube e-commerce platform.
 * Includes Product and Order operations (read-only).
 */

import { z } from 'zod';
import { createAgentTool } from '../../../common/helpers/create-agent-tool.helper';
import { createProtectedTool } from '../../../common/helpers/create-protected-tool.helper';

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
  description: `Search products in Nuvemshop catalog by name or SKU. Returns list of matching published products with prices, stock, and images.

IMPORTANT - Query Optimization:
Before searching, transform natural language into concise search terms:
- Use SINGULAR form: "jean" not "jeans", "remera" not "remeras"
- Remove articles/prepositions: "jeans de tiro alto" → "jean tiro alto"
- Keep 2-3 key terms: [product type] + [main attributes] only

Examples:
  "jeans de tiro alto" → use "jean tiro alto"
  "remeras negras con cuello" → use "remera negra cuello"
  "vestido para fiesta" → use "vestido fiesta"
  "pantalones cómodos" → use "pantalon comodo"

Returns: Published products with name, price, stock, images, description.
Search covers: product name, SKU, and description fields.

The service automatically applies fallback strategies if no results are found (broader terms, singular forms).`,
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

/**
 * Tool: Search Products by Size from Nuvemshop
 *
 * Searches for products and ONLY returns those that have the requested size/variant in stock.
 * This tool performs code-level filtering to ensure customers only see available sizes.
 *
 * Use this when the customer specifies a size:
 * - "Tienen jeans en talle 42?"
 * - "Jean skinny size 38"
 * - "Me gustaría ver remeras talle L"
 * - "Hay disponibilidad en talle 40?"
 *
 * IMPORTANT: This tool filters at the code level - products without the requested size
 * will not be returned at all, preventing errors in showing unavailable items.
 */
const searchProductsWithSizeSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe('Product search term (e.g., "jean", "skinny", "remera negra")'),
  size: z
    .string()
    .min(1)
    .describe('Required size/talle (e.g., "42", "38", "40", "M", "L")'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Maximum number of results to return (default: 10, max: 50)'),
});

export const searchNuvemshopProductsWithSizeTool = createAgentTool({
  name: 'search_nuvemshop_products_with_size',
  description:
    'Search products in Nuvemshop that have a specific size/talle in stock. ONLY returns products where the requested size is available. Use when customer specifies a size requirement.',
  parameters: searchProductsWithSizeSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const products = await nuvemshopService.searchProductsWithSize(
      params.query,
      params.size,
      params.limit ?? 10,
    );

    // Add products to context for image extraction
    if (!context.returnedProducts) {
      context.returnedProducts = [];
    }
    context.returnedProducts.push(...products);

    return products;
  },
});

// ============================================================================
// CATEGORY TOOLS
// ============================================================================

/**
 * Tool: Get All Categories from Nuvemshop
 *
 * Retrieves a complete list of all product categories in the store.
 * Returns category hierarchy with parent/child relationships.
 *
 * Use this when the customer:
 * - Asks to browse categories (e.g., "What categories do you have?")
 * - Wants to see product organization
 * - Needs to understand the store structure
 */
const getCategoriesSchema = z.object({});

export const getNuvemshopCategoriesTool = createAgentTool({
  name: 'get_nuvemshop_categories',
  description:
    'Get list of all product categories from Nuvemshop. Returns category names with IDs and parent/child relationships. Use this to show available categories or help customers browse products.',
  parameters: getCategoriesSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const categories = await nuvemshopService.getCategories();
    return categories;
  },
});

/**
 * Tool: Search Products by Category in Nuvemshop
 *
 * Retrieves products within a specific category.
 * Useful for filtered product browsing and category-specific recommendations.
 *
 * Use this when the customer:
 * - Asks about products in a category (e.g., "Show me electronics")
 * - Wants to browse a specific product type
 * - Needs recommendations within a category
 */
const searchProductsByCategorySchema = z.object({
  categoryId: z
    .number()
    .int()
    .positive()
    .describe('The Nuvemshop category ID to filter by'),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe('Maximum number of products to return (default: 10, max: 50)'),
});

export const searchNuvemshopProductsByCategoryTool = createAgentTool({
  name: 'search_nuvemshop_products_by_category',
  description:
    'Search products in a specific category from Nuvemshop. Returns product list with prices, stock, and images. Use this for category-based browsing and recommendations.',
  parameters: searchProductsByCategorySchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const products = await nuvemshopService.searchProductsByCategory(
      params.categoryId,
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

// ============================================================================
// PROMOTION & COUPON TOOLS
// ============================================================================

/**
 * Tool: Get Active Promotions from Nuvemshop
 *
 * Retrieves all currently active promotions, coupons, and discounts.
 * Filters out expired or inactive promotions automatically.
 *
 * Use this when the customer:
 * - Asks "Do you have any promotions?" or "Are there any discounts?"
 * - Wants to know about available deals
 * - Needs information about active coupons
 */
const getActivePromotionsSchema = z.object({});

export const getNuvemshopPromotionsTool = createAgentTool({
  name: 'get_nuvemshop_promotions',
  description:
    'Get all active promotions, coupons, and discounts from Nuvemshop. Returns only currently valid promotions with codes, values, and descriptions. Use this to inform customers about available deals.',
  parameters: getActivePromotionsSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const promotions = await nuvemshopService.getActivePromotions();
    return promotions;
  },
});

/**
 * Tool: Validate Coupon Code in Nuvemshop
 *
 * Checks if a coupon code is valid and can be used.
 * Validates code existence, activation status, date range, and usage limits.
 *
 * Use this when the customer:
 * - Asks if a coupon code works (e.g., "Is SAVE20 still valid?")
 * - Wants to check coupon details
 * - Reports that a coupon isn't working
 */
const validateCouponSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe('The coupon code to validate (e.g., "SAVE20", "FREESHIP")'),
});

export const validateNuvemshopCouponTool = createAgentTool({
  name: 'validate_nuvemshop_coupon',
  description:
    'Check if a coupon code is valid in Nuvemshop. Validates existence, active status, date range, and usage limits. Returns validity status with reason if invalid.',
  parameters: validateCouponSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const result = await nuvemshopService.validateCoupon(params.code);
    return result;
  },
});

// ============================================================================
// STORE INFORMATION TOOLS
// ============================================================================

/**
 * Tool: Get Store Information from Nuvemshop
 *
 * Retrieves store details including contact information, business hours, and policies.
 * Returns store name, email, phone, address, and social media links.
 *
 * Use this when the customer:
 * - Asks "What are your store hours?" or "How can I contact you?"
 * - Wants to know the store's physical location
 * - Needs general store information
 */
const getStoreInfoSchema = z.object({});

export const getNuvemshopStoreInfoTool = createAgentTool({
  name: 'get_nuvemshop_store_info',
  description:
    'Get store information from Nuvemshop including name, contact details (email, phone), address, and social media links. Use this to provide store hours, contact information, or business details.',
  parameters: getStoreInfoSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const storeInfo = await nuvemshopService.getStoreInfo();
    return storeInfo;
  },
});

/**
 * Tool: Get Shipping Options from Nuvemshop
 *
 * Retrieves available shipping methods and carriers.
 * Returns list of active shipping options with carrier names.
 *
 * Use this when the customer:
 * - Asks "What shipping methods do you offer?"
 * - Wants to know about delivery options
 * - Needs information about carriers (Correios, Mercado Envios, etc.)
 */
const getShippingOptionsSchema = z.object({});

export const getNuvemshopShippingOptionsTool = createAgentTool({
  name: 'get_nuvemshop_shipping_options',
  description:
    'Get available shipping methods and carriers from Nuvemshop. Returns list of active shipping options with carrier names and types. Use this to answer questions about delivery methods.',
  parameters: getShippingOptionsSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const shippingOptions = await nuvemshopService.getShippingOptions();
    return shippingOptions;
  },
});

/**
 * Tool: Get Payment Methods from Nuvemshop
 *
 * Retrieves available payment methods and providers.
 * Returns list of enabled payment options (credit cards, PIX, etc.).
 *
 * Use this when the customer:
 * - Asks "What payment methods do you accept?"
 * - Wants to know about accepted credit cards
 * - Needs information about payment options (PIX, boleto, etc.)
 */
const getPaymentMethodsSchema = z.object({});

export const getNuvemshopPaymentMethodsTool = createAgentTool({
  name: 'get_nuvemshop_payment_methods',
  description:
    'Get available payment methods from Nuvemshop. Returns list of enabled payment options including credit cards, PIX, boleto, and other payment gateways. Use this to answer payment questions.',
  parameters: getPaymentMethodsSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const paymentMethods = await nuvemshopService.getPaymentMethods();
    return paymentMethods;
  },
});

// ============================================================================
// ORDER TRACKING & PAYMENT HISTORY TOOLS
// ============================================================================

/**
 * Tool: Get Order Tracking Information from Nuvemshop
 *
 * Retrieves tracking numbers and shipment details for a specific order.
 * Returns tracking information, carrier details, and delivery estimates.
 *
 * Use this when the customer:
 * - Asks "Where is my order?" or "What's my tracking number?"
 * - Wants shipment status updates
 * - Needs estimated delivery date
 */
const getOrderTrackingSchema = z.object({
  orderIdentifier: z
    .string()
    .min(1)
    .describe('Order ID as string (e.g., "123") or order number'),
});

export const getNuvemshopOrderTrackingTool = createProtectedTool({
  name: 'get_nuvemshop_order_tracking',
  description:
    'Get tracking information for an order from Nuvemshop. Returns tracking numbers, carrier details, shipment status, and estimated delivery date. Use this for "Where is my order?" questions.',
  parameters: getOrderTrackingSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const tracking = await nuvemshopService.getOrderTracking(params.orderIdentifier);
    return tracking;
  },
});

/**
 * Tool: Get Payment History for Order from Nuvemshop
 *
 * Retrieves payment transaction history for a specific order.
 * Returns payment status, transaction details, and refund information.
 *
 * Use this when the customer:
 * - Asks "Was my payment processed?" or "Did my payment go through?"
 * - Wants refund status information
 * - Needs payment transaction details
 * - Reports payment issues
 */
const getPaymentHistorySchema = z.object({
  orderIdentifier: z
    .string()
    .min(1)
    .describe('Order ID as string (e.g., "123") or order number'),
});

export const getNuvemshopPaymentHistoryTool = createProtectedTool({
  name: 'get_nuvemshop_payment_history',
  description:
    'Get payment transaction history for an order from Nuvemshop. Returns payment status, transaction details, amounts, payment methods, and any error messages. Use this to troubleshoot payment issues.',
  parameters: getPaymentHistorySchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const transactions = await nuvemshopService.getOrderPaymentHistory(params.orderIdentifier);
    return transactions;
  },
});

// ============================================================================
// ORDER & CUSTOMER TOOLS
// ============================================================================

/**
 * Tool: Get Order Details from Nuvemshop
 *
 * Retrieves complete information about a specific order by ID or order number.
 * Returns order status, items, customer information, total amount, and creation date.
 *
 * Use this when the customer:
 * - Asks about a specific order (e.g., "Where is my order #1234?")
 * - Wants to check order status
 * - Needs details about order items
 */
const getOrderSchema = z.object({
  orderIdentifier: z
    .string()
    .min(1)
    .describe(
      'Order ID as string (e.g., "123") or order number (e.g., "1234")',
    ),
});

export const getNuvemshopOrderTool = createProtectedTool({
  name: 'get_nuvemshop_order',
  description:
    'Get order details from Nuvemshop by ID or order number. Accepts order ID as string (e.g., "123"). Returns full order details with status, items, customer info, and total.',
  parameters: getOrderSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const order = await nuvemshopService.getOrderByIdentifier(
      params.orderIdentifier,
    );
    return order;
  },
});

/**
 * Tool: Get Customer Orders from Nuvemshop
 *
 * Retrieves order history for a specific customer identified by email address.
 * Supports various filters for common customer queries.
 *
 * Use this when the customer asks about:
 * - "My orders" or "My order history"
 * - "Recent orders" (use days filter)
 * - "Pending orders" or "Completed orders" (use status)
 *
 * IMPORTANT: Email parameter may be a placeholder like [EMAIL_1].
 * Pass it AS-IS to the tool - the system will automatically resolve it.
 */
const getCustomerOrdersSchema = z.object({
  email: z.string().email().describe('Customer email address (may be placeholder like [EMAIL_1])'),
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
    .enum(['open', 'closed', 'cancelled'])
    .optional()
    .describe(
      'Filter by status: open (active), closed (completed), cancelled',
    ),
});

export const getNuvemshopCustomerOrdersTool = createProtectedTool({
  name: 'get_nuvemshop_customer_orders',
  description:
    'Get customer order history from Nuvemshop with optional filters. Use this for "my orders", "recent orders", "pending orders", etc. Returns order list sorted by most recent first. Email may be placeholder like [EMAIL_1].',
  parameters: getCustomerOrdersSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const orders = await nuvemshopService.getOrdersByCustomer(params.email, {
      limit: params.limit ?? 5, // Explicit default
      days: params.days, // Optional, undefined is acceptable
      status: params.status, // Optional, undefined is acceptable
    });
    return orders;
  },
});

/**
 * Tool: Get Customer Information from Nuvemshop
 *
 * Retrieves customer details by customer ID from Nuvemshop.
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
    .describe('The Nuvemshop customer ID'),
});

export const getNuvemshopCustomerTool = createProtectedTool({
  name: 'get_nuvemshop_customer',
  description:
    'Get customer information from Nuvemshop by customer ID. Returns name, email, and phone.',
  parameters: getCustomerSchema,
  execute: async (params, context) => {
    const { nuvemshopService } = context.services;
    const customer = await nuvemshopService.getCustomer(params.customerId);
    return customer;
  },
});

// ============================================================================
// TOOL COLLECTIONS (for agent assignment)
// ============================================================================

/**
 * Get core Nuvemshop tools (products, orders, customers)
 *
 * Note: This returns the 6 essential tools for basic e-commerce operations.
 * For specialized functionality, use the specific collection functions:
 * - getNuvemshopCategoryTools() - Category browsing (2 tools)
 * - getNuvemshopPromotionTools() - Promotions and coupons (2 tools)
 * - getNuvemshopStoreTools() - Store information (3 tools)
 * - getNuvemshopFulfillmentTools() - Tracking and payment history (2 tools)
 *
 * Total available tools: 15 (6 core + 9 specialized)
 */
export const getNuvemshopCoreTools = () => [
  getNuvemshopProductTool,
  searchNuvemshopProductsTool,
  getNuvemshopProductStockTool,
  getNuvemshopOrderTool,
  getNuvemshopCustomerOrdersTool,
  getNuvemshopCustomerTool,
];

/**
 * Get product-specific tools
 * Useful for assigning to Products Agent
 */
export const getNuvemshopProductTools = () => [
  getNuvemshopProductTool,
  searchNuvemshopProductsTool,
  searchNuvemshopProductsWithSizeTool,
  getNuvemshopProductStockTool,
];

/**
 * Get order-specific tools
 * Useful for assigning to Orders Agent
 */
export const getNuvemshopOrderTools = () => [
  getNuvemshopOrderTool,
  getNuvemshopCustomerOrdersTool,
  getNuvemshopCustomerTool,
];

/**
 * Get category-specific tools
 * Useful for assigning to Products Agent
 */
export const getNuvemshopCategoryTools = () => [
  getNuvemshopCategoriesTool,
  searchNuvemshopProductsByCategoryTool,
];

/**
 * Get promotion-specific tools
 * Useful for assigning to Products Agent or Triage Agent
 */
export const getNuvemshopPromotionTools = () => [
  getNuvemshopPromotionsTool,
  validateNuvemshopCouponTool,
];

/**
 * Get store information tools
 * Useful for assigning to Triage Agent (general store questions)
 */
export const getNuvemshopStoreTools = () => [
  getNuvemshopStoreInfoTool,
  getNuvemshopShippingOptionsTool,
  getNuvemshopPaymentMethodsTool,
];

/**
 * Get order fulfillment and payment history tools
 * Useful for assigning to Orders Agent (order-specific questions)
 */
export const getNuvemshopFulfillmentTools = () => [
  getNuvemshopOrderTrackingTool,
  getNuvemshopPaymentHistoryTool,
];
