/**
 * Nuvemshop/Tiendanube Integration Interfaces
 *
 * API Documentation: https://tiendanube.github.io/api-documentation/
 * Base URL: https://api.nuvemshop.com.br/v1 (Brasil) or https://api.tiendanube.com/v1 (LATAM)
 */

/**
 * Multi-language field type used in Nuvemshop API
 * Examples: { pt: 'texto', es: 'texto', en: 'text' }
 */
export interface NuvemshopMultiLang {
  pt?: string;
  es?: string;
  en?: string;
  [lang: string]: string | undefined;
}

/**
 * Product Variant (SKU/variation of a product)
 * Each product can have multiple variants (size, color, etc.)
 */
export interface NuvemshopVariant {
  id: number;
  image_id: number | null;
  product_id: number;
  position: number;
  price: string; // Decimal as string
  compare_at_price: string | null; // Original price before discount
  promotional_price: string | null; // Promotional price if any
  stock_management: boolean;
  stock: number | null; // Current stock quantity
  weight: string | null; // In kg
  width: string | null;
  height: string | null;
  depth: string | null;
  sku: string | null;
  values: Array<{ pt?: string; es?: string; en?: string }>; // Variant attributes (e.g., "Red", "Large")
  barcode: string | null;
  mpn: string | null; // Manufacturer Part Number
  age_group: string | null;
  gender: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  cost: string | null; // Cost price
  inventory_levels?: any[]; // Inventory management (advanced)
}

/**
 * Product Image
 */
export interface NuvemshopImage {
  id: number;
  product_id: number;
  src: string; // Image URL
  position: number;
  alt: NuvemshopMultiLang[];
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Product Category
 */
export interface NuvemshopCategory {
  id: number;
  name: NuvemshopMultiLang;
  description: NuvemshopMultiLang;
  handle: NuvemshopMultiLang;
  parent: number | null; // Parent category ID
  subcategories: number[]; // Child category IDs
  google_shopping_category: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  seo_title?: NuvemshopMultiLang;
  seo_description?: NuvemshopMultiLang;
}

/**
 * Full Product from Nuvemshop API
 * This mirrors the actual API response structure
 */
export interface NuvemshopProduct {
  id: number;
  name: NuvemshopMultiLang;
  description: NuvemshopMultiLang;
  handle: NuvemshopMultiLang; // URL slug
  attributes: any[]; // Product attributes/specifications
  published: boolean;
  free_shipping: boolean;
  requires_shipping: boolean;
  canonical_url: string;
  video_url: string | null;
  seo_title: NuvemshopMultiLang;
  seo_description: NuvemshopMultiLang;
  brand: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  variants: NuvemshopVariant[];
  tags: string; // Comma-separated tags
  images: NuvemshopImage[];
  categories: NuvemshopCategory[];
}

/**
 * Simplified Product for AI agent responses
 * This is the format the AI will work with
 */
export interface NuvemshopProductSimplified {
  id: number;
  name: string; // Single language (extracted from multi-lang)
  price: number; // From first variant
  stock: number; // Total stock or from first variant
  sku?: string; // From first variant
  description?: string; // Single language
  category?: string; // First category name
  imageUrl?: string; // First image URL
  variants?: {
    id: number;
    sku?: string;
    price: number;
    stock: number;
    attributes?: string; // Human-readable variant attributes
  }[]; // Simplified variants if product has multiple
}

/**
 * API Response wrapper for paginated results
 */
export interface NuvemshopPaginatedResponse<T> {
  results: T[];
  pagination?: {
    page: number;
    per_page: number;
    total: number;
  };
}

/**
 * Search/filter parameters for products
 */
export interface NuvemshopProductSearchParams {
  q?: string; // Search query (name, SKU, description)
  category_id?: number; // Filter by category
  published?: boolean; // Filter by published status
  free_shipping?: boolean; // Filter by free shipping
  min_price?: number; // Minimum price
  max_price?: number; // Maximum price
  sort_by?: 'created-at-ascending' | 'created-at-descending' | 'price-ascending' | 'price-descending' | 'alpha-ascending' | 'alpha-descending';
  per_page?: number; // Results per page (max 200)
  page?: number; // Page number (starts at 1)
}

/**
 * Nuvemshop API client configuration
 */
export interface NuvemshopClientConfig {
  baseUrl: string; // e.g., https://api.nuvemshop.com.br/v1
  storeId: string; // Store ID (e.g., '2092753')
  accessToken: string; // Bearer token
  userAgent: string; // User-Agent header (required by API)
  timeout?: number; // Request timeout in ms (default: 10000)
}

/**
 * Helper to extract single language value from multi-lang field
 * Tries languages in order: pt (Portuguese), es (Spanish), en (English), first available
 */
export function extractLanguage(
  field: NuvemshopMultiLang | undefined,
  preferredLang: 'pt' | 'es' | 'en' = 'pt',
): string | undefined {
  if (!field) return undefined;

  // Try preferred language first
  if (field[preferredLang]) return field[preferredLang];

  // Fallback order: pt -> es -> en -> first available
  return field.pt || field.es || field.en || Object.values(field).find((v) => v);
}

/**
 * Helper to get total stock from all variants
 */
export function getTotalStock(product: NuvemshopProduct): number {
  return product.variants.reduce((total, variant) => {
    return total + (variant.stock || 0);
  }, 0);
}

/**
 * Helper to get price range from variants
 */
export function getPriceRange(product: NuvemshopProduct): { min: number; max: number } {
  const prices = product.variants.map((v) => parseFloat(v.price));
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

// ============================================================================
// ORDERS INTERFACES
// ============================================================================

/**
 * Product within an order
 */
export interface NuvemshopOrderProduct {
  id: number;
  depth: string | null;
  height: string | null;
  name: NuvemshopMultiLang;
  price: string; // Decimal as string
  product_id: number;
  image: {
    id: number;
    product_id: number;
    src: string;
    position: number;
    alt: any[];
    created_at: string;
    updated_at: string;
  } | null;
  quantity: number;
  free_shipping: boolean;
  weight: string;
  width: string | null;
  variant_id: number;
  variant_values: string; // Comma-separated variant attributes (e.g., "Red, Large")
  properties: any[];
  sku: string | null;
}

/**
 * Customer information in an order
 */
export interface NuvemshopCustomerInfo {
  id: number;
  name: string;
  email: string;
  identification: string | null; // CPF, DNI, etc.
  phone: string;
  note: string | null;
  default_address?: {
    address: string;
    city: string;
    country: string;
    created_at: string;
    default: boolean;
    floor: string | null;
    id: number;
    locality: string;
    name: string;
    number: string;
    phone: string;
    province: string;
    updated_at: string;
    zipcode: string;
  };
}

/**
 * Shipping address for an order
 */
export interface NuvemshopShippingAddress {
  address: string;
  city: string;
  country: string;
  created_at: string;
  default: boolean;
  floor: string | null;
  id: number;
  locality: string;
  name: string;
  number: string;
  phone: string;
  province: string;
  updated_at: string;
  zipcode: string;
}

/**
 * Full Order from Nuvemshop API
 * This mirrors the actual API response structure
 */
export interface NuvemshopOrder {
  id: number;
  token: string; // Unique order token
  store_id: string;

  // Contact information
  contact_email: string;
  contact_name: string;
  contact_phone: string;
  contact_identification: string | null;

  // Shipping information
  shipping: string; // Shipping method name
  shipping_option: string;
  shipping_option_code: string;
  shipping_option_reference: string | null;
  shipping_pickup_type: string;
  shipping_store_branch_name: string | null;
  shipping_address: NuvemshopShippingAddress;

  // Payment information
  payment: string; // Payment method name
  payment_status: 'pending' | 'authorized' | 'paid' | 'voided' | 'refunded' | 'abandoned';

  // Status
  status: 'open' | 'closed' | 'cancelled';
  shipping_status: 'unpacked' | 'unfulfilled' | 'fulfilled';

  // Customer
  customer: NuvemshopCustomerInfo;

  // Products
  products: NuvemshopOrderProduct[];

  // Order number and sequence
  number: number; // Sequential order number shown to customers
  cancel_reason: string | null;
  owner_note: string | null;
  cancelled_at: string | null; // ISO 8601
  closed_at: string | null; // ISO 8601
  read_at: string | null; // ISO 8601

  // Financial
  currency: string; // e.g., "BRL", "ARS"
  language: string; // e.g., "pt", "es"
  gateway: string;
  gateway_id: string | null;
  gateway_name: string;

  // Amounts (all as decimal strings)
  shipping_cost_owner: string;
  shipping_cost_customer: string;
  coupon: any[];
  promotional_discount: {
    id: number | null;
    store_id: number;
    order_id: number;
    created_at: string;
    total_discount_amount: string;
    contents: any[];
    promotions_applied: any[];
  };
  subtotal: string;
  discount: string;
  discount_coupon: string;
  discount_gateway: string;
  total: string;
  total_usd: string;
  checkout_enabled: boolean;
  weight: string;

  // Dates
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  completed_at: {
    date: string;
    timezone_type: number;
    timezone: string;
  } | null;

  // Additional fields
  next_action: string;
  payment_details: {
    method: string;
    credit_card_company: string | null;
    installments: number;
  };
  attributes: any[];
  customer_note: string | null;
  landing_url: string;
  client_details: {
    browser_ip: string;
    user_agent: string;
  };

  // App metadata
  app_id: number | null;
}

/**
 * Simplified Order for AI agent responses
 * This structure matches OdooOrder exactly for seamless integration
 */
export interface NuvemshopOrderSimplified {
  id: number;
  orderNumber: string; // e.g., "#1234"
  status: string; // Human-readable combined status
  items: NuvemshopOrderItem[];
  total: number;
  customer: {
    id: number;
    name: string;
    email: string;
    phone?: string;
  };
  createdAt: Date;
}

/**
 * Simplified order item for AI agent responses
 */
export interface NuvemshopOrderItem {
  productId: number;
  productName: string; // Single language (extracted from multi-lang)
  quantity: number;
  price: number;
}

/**
 * Search/filter parameters for orders
 */
export interface NuvemshopOrderSearchParams {
  fields?: string; // Comma-separated list of fields to return
  since_id?: number; // Return orders after this ID
  created_at_min?: string; // ISO 8601 date
  created_at_max?: string; // ISO 8601 date
  updated_at_min?: string; // ISO 8601 date
  updated_at_max?: string; // ISO 8601 date
  status?: 'open' | 'closed' | 'cancelled'; // Order status filter
  payment_status?: 'pending' | 'authorized' | 'paid' | 'voided' | 'refunded' | 'abandoned';
  shipping_status?: 'unpacked' | 'unfulfilled' | 'fulfilled';
  per_page?: number; // Results per page (max 200)
  page?: number; // Page number (starts at 1)
}

// ============================================================================
// CATEGORIES INTERFACES (already defined above in product section, re-export for clarity)
// ============================================================================

/**
 * NuvemshopCategory is already defined above in the products section (line ~55)
 * Categories are used both standalone and as part of product data
 */

/**
 * Simplified Category for AI agent responses
 */
export interface NuvemshopCategorySimplified {
  id: number;
  name: string; // Single language (extracted from multi-lang)
  description?: string; // Single language
  parentId?: number; // Parent category ID if this is a subcategory
  subcategoryIds: number[]; // Child category IDs
}

// ============================================================================
// COUPONS & DISCOUNTS INTERFACES
// ============================================================================

/**
 * Coupon from Nuvemshop API
 * Coupons have codes that customers can apply at checkout
 */
export interface NuvemshopCoupon {
  id: number;
  code: string; // Coupon code (e.g., "SAVE20", "FREESHIP")
  type: 'percentage' | 'absolute'; // Percentage discount or fixed amount
  value: string; // Decimal as string (e.g., "20.00" for 20% or $20)
  valid_from: string | null; // ISO 8601 date or null
  valid_to: string | null; // ISO 8601 date or null
  max_uses: number | null; // Maximum number of uses (null = unlimited)
  max_uses_per_customer: number | null; // Max uses per customer
  used: number; // Number of times already used
  min_price: string | null; // Minimum purchase amount to apply (decimal string)
  categories: number[]; // Category IDs this coupon applies to (empty = all)
  active: boolean; // Whether coupon is active
  delete_at: string | null; // Deletion date if set
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Discount/Promotion from Nuvemshop API
 * Discounts are automatic promotions (no code needed)
 */
export interface NuvemshopDiscount {
  id: number;
  type: 'percentage' | 'absolute'; // Percentage discount or fixed amount
  value: string; // Decimal as string
  valid_from: string; // ISO 8601 date
  valid_to: string; // ISO 8601 date
  applies_to: 'all' | 'categories' | 'products'; // What the discount applies to
  applies_to_ids: number[]; // IDs of categories/products if specific
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Simplified Promotion for AI agent responses
 * Combines coupons and discounts into a unified format
 */
export interface NuvemshopPromotionSimplified {
  id: number;
  code?: string; // Coupon code if this is a coupon (undefined for automatic discounts)
  type: 'percentage' | 'fixed_amount'; // Type of discount
  value: number; // Discount value (20 for 20% or 50 for $50)
  description: string; // Human-readable description (e.g., "20% OFF on purchases over $100")
  minPurchase?: number; // Minimum purchase amount required
  validFrom?: Date; // Start date
  validUntil?: Date; // End date
  isActive: boolean; // Whether promotion is currently active and valid
  usesRemaining?: number; // Remaining uses if limited (undefined = unlimited)
}

// ============================================================================
// STORE INFORMATION INTERFACES
// ============================================================================

/**
 * Store configuration from Nuvemshop API
 * Contains business details, contact info, and store settings
 */
export interface NuvemshopStore {
  id: number;
  name: NuvemshopMultiLang;
  description: NuvemshopMultiLang;
  url: string; // Store URL
  email: string; // Contact email
  phone: string; // Contact phone
  address: string;
  city: string;
  province: string;
  country: string;
  zipcode: string;
  business_name: string;
  business_id: string; // Tax ID (CPF/CNPJ, DNI, etc.)
  main_currency: string; // e.g., "BRL", "ARS"
  languages: string[]; // e.g., ["pt", "es", "en"]
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
  google_plus: string | null;
  pinterest: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  original_domain: string;
  domains: string[]; // Custom domains
}

/**
 * Simplified Store for AI agent responses
 */
export interface NuvemshopStoreSimplified {
  name: string; // Single language
  description?: string; // Single language
  email: string;
  phone: string;
  address: string;
  businessName: string;
  url: string;
  currency: string;
  languages: string[];
  socialMedia?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
  };
}

// ============================================================================
// SHIPPING CARRIER INTERFACES
// ============================================================================

/**
 * Shipping carrier/method from Nuvemshop API
 */
export interface NuvemshopShippingCarrier {
  id: number;
  name: string; // Carrier name (e.g., "Correios", "Mercado Envios")
  callback_url: string;
  types: string; // Shipping types supported
  active: boolean;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Simplified Shipping Carrier for AI agent responses
 */
export interface NuvemshopShippingCarrierSimplified {
  id: number;
  name: string;
  active: boolean;
  types: string;
}

// ============================================================================
// PAYMENT PROVIDER INTERFACES
// ============================================================================

/**
 * Payment provider/gateway from Nuvemshop API
 */
export interface NuvemshopPaymentProvider {
  id: number;
  name: string; // Provider name (e.g., "MercadoPago", "PayPal", "PIX")
  enabled: boolean;
  type: string; // Payment type (e.g., "credit_card", "debit_card", "bank_transfer")
  configuration: any; // Provider-specific configuration
  rates: any; // Fee information (if available)
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Simplified Payment Provider for AI agent responses
 */
export interface NuvemshopPaymentProviderSimplified {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
}

// ============================================================================
// ORDER FULFILLMENT INTERFACES
// ============================================================================

/**
 * Order fulfillment/shipment from Nuvemshop API
 * Contains tracking information and shipment status
 */
export interface NuvemshopFulfillment {
  id: number;
  order_id: number;
  tracking_number: string | null; // Carrier tracking code
  tracking_url: string | null; // URL to track shipment
  estimated_delivery_date: string | null; // ISO 8601
  status: 'fulfilled' | 'in_transit' | 'delivered' | 'failed';
  shipping_carrier_name: string; // Carrier used for shipment
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  line_items: Array<{
    id: number;
    variant_id: number;
    product_id: number;
    quantity: number;
  }>;
}

/**
 * Simplified Fulfillment for AI agent responses
 */
export interface NuvemshopFulfillmentSimplified {
  id: number;
  trackingNumber?: string;
  trackingUrl?: string;
  status: string; // Human-readable status
  carrier: string;
  estimatedDelivery?: Date;
  items: Array<{
    productId: number;
    quantity: number;
  }>;
}

// ============================================================================
// PAYMENT TRANSACTION INTERFACES
// ============================================================================

/**
 * Payment transaction from Nuvemshop API
 * Contains payment processing details
 */
export interface NuvemshopTransaction {
  id: number;
  order_id: number;
  amount: string; // Decimal as string
  currency: string; // e.g., "BRL", "ARS"
  status: 'pending' | 'authorized' | 'paid' | 'failed' | 'refunded' | 'voided';
  gateway: string; // Payment gateway used
  gateway_id: string | null; // Transaction ID from gateway
  payment_mode: string; // e.g., "credit_card", "pix", "boleto"
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  error_code: string | null;
  error_message: string | null;
}

/**
 * Simplified Transaction for AI agent responses
 */
export interface NuvemshopTransactionSimplified {
  id: number;
  amount: number;
  currency: string;
  status: string; // Human-readable status
  paymentMethod: string;
  gateway: string;
  transactionDate: Date;
  errorMessage?: string;
}
