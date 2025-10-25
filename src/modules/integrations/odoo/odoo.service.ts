import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OdooClient, OdooClientConfig } from './odoo.client';
import {
  OdooProduct,
  OdooProductSimplified,
  OdooOrder,
  OdooOrderItem,
  OdooCustomer,
  OdooPartner,
  OdooSaleOrder,
  OdooSaleOrderLine,
  OdooMany2One,
} from '../../../common/interfaces';

/**
 * OdooService provides methods that will be exposed as tools to the AI agent
 * Each method here can be called by the @openai/agents SDK
 *
 * Methods return simplified interfaces suitable for AI agent consumption.
 */
@Injectable()
export class OdooService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OdooService.name);
  private client: OdooClient;

  constructor(private readonly configService: ConfigService) { }

  /**
   * Initialize Odoo client on module startup
   */
  async onModuleInit() {
    const config: OdooClientConfig = {
      url: this.configService.get<string>('ODOO_URL', ''),
      database: this.configService.get<string>('ODOO_DATABASE', ''),
      username: this.configService.get<string>('ODOO_USERNAME', ''),
      password: this.configService.get<string>('ODOO_PASSWORD', ''),
    };

    // Validate configuration
    if (
      !config.url ||
      !config.database ||
      !config.username ||
      !config.password
    ) {
      this.logger.warn(
        'Odoo configuration incomplete. Service will be unavailable.',
      );
      this.logger.warn(
        'Required env vars: ODOO_URL, ODOO_DATABASE, ODOO_USERNAME, ODOO_PASSWORD',
      );
      return;
    }

    this.client = new OdooClient(config);
    this.logger.log('OdooService initialized');
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    if (this.client) {
      await this.client.disconnect();
    }
  }

  /**
   * Get product details by ID
   * This will be exposed as a tool for the AI agent
   *
   * @param productId - The Odoo product ID
   * @returns Simplified product information
   */
  async getProduct(productId: number): Promise<OdooProductSimplified> {
    this.logger.log(`Getting product ${productId}`);

    try {
      const products = await this.client.read<OdooProduct>(
        'product.product',
        productId,
        [
          'name',
          'list_price',
          'qty_available',
          'default_code',
          'description_sale',
          'categ_id',
          'barcode',
          'image_1920', // High-resolution product image
        ],
      );

      if (products.length === 0) {
        throw new Error(`Product ${productId} not found`);
      }

      const product = products[0];
      return this.mapProductToSimplified(product);
    } catch (error) {
      this.logger.error(`Failed to get product ${productId}`, error);
      throw new Error(
        `Failed to retrieve product: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Search products by query (searches name, SKU, and barcode)
   * This will be exposed as a tool for the AI agent
   *
   * Smart search features:
   * - If plural query (ending in 's') returns no results, automatically tries singular
   * - Case-insensitive search via ilike operator
   * - Searches across name, SKU, and barcode fields
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of simplified product information
   */
  async searchProducts(
    query: string,
    limit = 10,
  ): Promise<OdooProductSimplified[]> {
    this.logger.log(`Searching products: ${query}`);

    try {
      // Helper function to perform the actual search
      const performSearch = async (searchTerm: string) => {
        return await this.client.searchRead<OdooProduct>(
          'product.product',
          {
            domain: [
              '|',
              '|',
              ['name', 'ilike', searchTerm],
              ['default_code', 'ilike', searchTerm],
              ['barcode', 'ilike', searchTerm],
            ],
            fields: [
              'name',
              'list_price',
              'qty_available',
              'default_code',
              'description_sale',
              'categ_id',
              'barcode',
              'image_1920', // High-resolution product image
            ],
            limit,
          },
        );
      };

      // First attempt: search with original query
      let products = await performSearch(query);

      // Smart fallback: if no results and query ends with 's', try singular form
      if (products.length === 0 && query.toLowerCase().endsWith('s')) {
        const singularQuery = query.slice(0, -1);
        this.logger.log(
          `No results for "${query}", trying singular form: "${singularQuery}"`,
        );
        products = await performSearch(singularQuery);
      }

      // Additional fallback: if still no results and query ends with 'es', try without 'es'
      if (products.length === 0 && query.toLowerCase().endsWith('es')) {
        const singularQuery = query.slice(0, -2);
        this.logger.log(
          `No results for "${query}", trying without "es": "${singularQuery}"`,
        );
        products = await performSearch(singularQuery);
      }

      this.logger.log(`Found ${products.length} product(s) matching "${query}"`);

      return products.map((product) => this.mapProductToSimplified(product));
    } catch (error) {
      this.logger.error(`Failed to search products: ${query}`, error);
      throw new Error(
        `Failed to search products: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get order details by ID or reference (smart lookup)
   * This will be exposed as a tool for the AI agent
   *
   * @param identifier - Order ID (number like 123 or "123") or reference (string like "SO001")
   * @returns Simplified order information with items and customer
   */
  async getOrderByIdentifier(
    identifier: string | number,
  ): Promise<OdooOrder> {
    this.logger.log(`Getting order by identifier: ${identifier}`);

    try {
      // Smart detection: if string is numeric, convert to number for ID search
      let searchValue: string | number = identifier;
      let searchById = typeof identifier === 'number';

      if (typeof identifier === 'string') {
        // Check if string is purely numeric (e.g., "123")
        const numericValue = Number(identifier);
        if (!isNaN(numericValue) && identifier.trim() === numericValue.toString()) {
          searchValue = numericValue;
          searchById = true;
        }
      }

      // Determine search criteria based on final determination
      const domain: Array<[string, string, any] | string> = searchById
        ? [['id', '=', searchValue]]
        : [['name', '=', searchValue]];

      // Search for the order
      const orders = await this.client.searchRead<OdooSaleOrder>('sale.order', {
        domain,
        fields: [
          'name',
          'partner_id',
          'date_order',
          'amount_total',
          'state',
          'order_line',
        ],
        limit: 1,
      });

      if (orders.length === 0) {
        throw new Error(`Order ${identifier} not found`);
      }

      const order = orders[0];

      // Get order lines
      const orderLines = await this.getOrderLines(order.order_line || []);

      // Get customer information
      const customerId = this.extractMany2OneId(order.partner_id);
      const customer = customerId ? await this.getCustomer(customerId) : null;

      return {
        id: order.id,
        orderNumber: order.name,
        status: this.mapOrderState(order.state),
        items: orderLines,
        total: order.amount_total,
        customer: customer || {
          id: 0,
          name: 'Unknown',
          email: '',
        },
        createdAt: new Date(order.date_order),
      };
    } catch (error) {
      this.logger.error(`Failed to get order ${identifier}`, error);
      throw new Error(
        `Failed to retrieve order: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get orders by customer email with optional filters
   * This will be exposed as a tool for the AI agent
   *
   * @param email - Customer email address
   * @param options - Optional filters (limit, days, status)
   * @returns Array of simplified order information
   */
  async getOrdersByCustomer(
    email: string,
    options: {
      limit?: number;
      days?: number;
      status?: 'draft' | 'sale' | 'done' | 'cancel';
    } = {},
  ): Promise<OdooOrder[]> {
    const { limit = 5, days, status } = options;
    this.logger.log(
      `Getting orders for customer: ${email} (limit: ${limit}, days: ${days}, status: ${status})`,
    );

    try {
      // First, find the customer by email
      const partners = await this.client.searchRead<OdooPartner>(
        'res.partner',
        {
          domain: [['email', '=', email]],
          fields: ['id', 'name', 'email'],
          limit: 1,
        },
      );

      if (partners.length === 0) {
        this.logger.warn(`No customer found with email: ${email}`);
        return [];
      }

      const partnerId = partners[0].id;

      // Build domain with optional filters
      const domain: Array<[string, string, any] | string> = [
        ['partner_id', '=', partnerId],
      ];

      // Add date filter if days specified
      if (days) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const dateStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD
        domain.push(['date_order', '>=', dateStr]);
      }

      // Add status filter if specified
      if (status) {
        // Map user-friendly status to Odoo state
        const odooState =
          status === 'sale' ? 'sale' : status === 'done' ? 'done' : status;
        domain.push(['state', '=', odooState]);
      }

      // Get orders for this customer
      const orders = await this.client.searchRead<OdooSaleOrder>('sale.order', {
        domain,
        fields: [
          'name',
          'partner_id',
          'date_order',
          'amount_total',
          'state',
          'order_line',
        ],
        order: 'date_order desc',
        limit,
      });

      // Map to simplified format (fetch order lines for each)
      const simplifiedOrders: OdooOrder[] = [];
      for (const order of orders) {
        const orderLines = await this.getOrderLines(order.order_line || []);

        simplifiedOrders.push({
          id: order.id,
          orderNumber: order.name,
          status: this.mapOrderState(order.state),
          items: orderLines,
          total: order.amount_total,
          customer: {
            id: partners[0].id,
            name: partners[0].name,
            email: partners[0].email || '',
          },
          createdAt: new Date(order.date_order),
        });
      }

      return simplifiedOrders;
    } catch (error) {
      this.logger.error(`Failed to get orders for customer: ${email}`, error);
      throw new Error(
        `Failed to retrieve customer orders: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get customer information by ID
   * This will be exposed as a tool for the AI agent
   *
   * @param customerId - The Odoo partner/customer ID
   * @returns Simplified customer information
   */
  async getCustomer(customerId: number): Promise<OdooCustomer> {
    this.logger.log(`Getting customer ${customerId}`);

    try {
      const partners = await this.client.read<OdooPartner>(
        'res.partner',
        customerId,
        ['name', 'email', 'phone', 'mobile'],
      );

      if (partners.length === 0) {
        throw new Error(`Customer ${customerId} not found`);
      }

      const partner = partners[0];
      return {
        id: partner.id,
        name: partner.name,
        email: partner.email || '',
        phone: partner.phone || partner.mobile,
      };
    } catch (error) {
      this.logger.error(`Failed to get customer ${customerId}`, error);
      throw new Error(
        `Failed to retrieve customer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Helper: Get order lines by IDs
   */
  private async getOrderLines(lineIds: number[]): Promise<OdooOrderItem[]> {
    if (lineIds.length === 0) {
      return [];
    }

    const lines = await this.client.read<OdooSaleOrderLine>(
      'sale.order.line',
      lineIds,
      ['product_id', 'product_uom_qty', 'price_unit'],
    );

    return lines.map((line) => ({
      productId: this.extractMany2OneId(line.product_id) || 0,
      productName: this.extractMany2OneName(line.product_id) || 'Unknown',
      quantity: line.product_uom_qty,
      price: line.price_unit,
    }));
  }

  /**
   * Helper: Map raw Odoo product to simplified format
   */
  private mapProductToSimplified(product: OdooProduct): OdooProductSimplified {
    // Construct image URL if product has an image
    let imageUrl: string | undefined = undefined;
    if (product.image_1920 && typeof product.image_1920 === 'string') {
      const odooUrl = this.configService.get<string>('ODOO_URL', '');
      imageUrl = `${odooUrl}/web/image?model=product.product&id=${product.id}&field=image_1920`;
    }

    return {
      id: product.id,
      name: product.name,
      price: product.list_price,
      stock: product.qty_available || 0,
      sku: product.default_code,
      description: product.description_sale || product.description,
      category: product.categ_id
        ? this.extractMany2OneName(product.categ_id)
        : undefined,
      imageUrl,
    };
  }

  /**
   * Helper: Map Odoo order state to human-readable status
   */
  private mapOrderState(state: string): string {
    const stateMap: Record<string, string> = {
      draft: 'Draft',
      sent: 'Quotation Sent',
      sale: 'Confirmed',
      done: 'Completed',
      cancel: 'Cancelled',
    };
    return stateMap[state] || state;
  }

  /**
   * Helper: Extract ID from Many2one field
   */
  private extractMany2OneId(field: OdooMany2One): number | null {
    return Array.isArray(field) ? field[0] : null;
  }

  /**
   * Helper: Extract display name from Many2one field
   */
  private extractMany2OneName(field: OdooMany2One): string | undefined {
    return Array.isArray(field) ? field[1] : undefined;
  }
}
