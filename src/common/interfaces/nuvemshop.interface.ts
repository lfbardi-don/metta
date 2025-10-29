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
