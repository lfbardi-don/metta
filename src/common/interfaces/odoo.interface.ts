/**
 * Odoo base record with ID
 */
export interface OdooRecord {
  id: number;
  [key: string]: any;
}

/**
 * Odoo domain filter type
 * Format: [field, operator, value] or '|' for OR operator, '&' for AND
 */
export type OdooDomain = Array<
  [string, string, string | number | boolean | null | any[]] | string
>;

/**
 * Many2one field format in Odoo: [id, display_name]
 */
export type OdooMany2One = [number, string] | false;

/**
 * Search options for Odoo queries
 */
export interface OdooSearchOptions {
  domain?: OdooDomain;
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

/**
 * Product model (product.product in Odoo)
 */
export interface OdooProduct extends OdooRecord {
  name: string;
  list_price: number;
  default_code?: string; // Internal reference/SKU
  qty_available?: number; // Stock quantity
  categ_id?: OdooMany2One; // Product category
  description?: string;
  description_sale?: string;
  barcode?: string;
  type?: 'consu' | 'service' | 'product'; // Product type
  sale_ok?: boolean; // Can be sold
  purchase_ok?: boolean; // Can be purchased
}

/**
 * Simplified product for AI agent responses
 */
export interface OdooProductSimplified {
  id: number;
  name: string;
  price: number;
  stock: number;
  sku?: string;
  description?: string;
  category?: string;
}

/**
 * Customer/Partner model (res.partner in Odoo)
 */
export interface OdooPartner extends OdooRecord {
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  street?: string;
  city?: string;
  state_id?: OdooMany2One; // State/Province
  country_id?: OdooMany2One; // Country
  zip?: string;
  is_company: boolean;
  vat?: string; // Tax ID
}

/**
 * Simplified customer for AI agent responses
 */
export interface OdooCustomer {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

/**
 * Sales Order model (sale.order in Odoo)
 */
export interface OdooSaleOrder extends OdooRecord {
  name: string; // Order reference
  partner_id: OdooMany2One; // Customer
  date_order: string; // Order date (ISO format)
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  state: 'draft' | 'sent' | 'sale' | 'done' | 'cancel'; // Order state
  order_line?: number[]; // Order line IDs
  invoice_status?: 'invoiced' | 'to invoice' | 'no';
  delivery_status?: 'pending' | 'partial' | 'full';
}

/**
 * Sales Order Line model (sale.order.line in Odoo)
 */
export interface OdooSaleOrderLine extends OdooRecord {
  order_id: OdooMany2One; // Sales order
  product_id: OdooMany2One; // Product
  product_uom_qty: number; // Quantity
  price_unit: number; // Unit price
  price_subtotal: number; // Subtotal without tax
  price_total: number; // Subtotal with tax
  discount?: number; // Discount percentage
}

/**
 * Simplified order for AI agent responses
 */
export interface OdooOrder {
  id: number;
  orderNumber: string;
  status: string;
  items: OdooOrderItem[];
  total: number;
  customer: OdooCustomer;
  createdAt: Date;
}

/**
 * Simplified order item for AI agent responses
 */
export interface OdooOrderItem {
  productId: number;
  productName: string;
  quantity: number;
  price: number;
}

/**
 * Common Odoo domain operators
 */
export const OdooOperators = {
  EQUALS: '=',
  NOT_EQUALS: '!=',
  GREATER: '>',
  GREATER_OR_EQUAL: '>=',
  LESS: '<',
  LESS_OR_EQUAL: '<=',
  LIKE: 'like', // Case-sensitive
  ILIKE: 'ilike', // Case-insensitive
  IN: 'in',
  NOT_IN: 'not in',
  IS_SET: '!=', // With value false
  IS_NOT_SET: '=', // With value false
} as const;
