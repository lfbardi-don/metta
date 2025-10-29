import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NuvemshopClient } from './nuvemshop.client';
import {
  NuvemshopClientConfig,
  NuvemshopProduct,
  NuvemshopProductSimplified,
  NuvemshopOrder,
  NuvemshopOrderSimplified,
  NuvemshopOrderItem,
  NuvemshopCategory,
  NuvemshopCategorySimplified,
  NuvemshopCoupon,
  NuvemshopDiscount,
  NuvemshopPromotionSimplified,
  NuvemshopStore,
  NuvemshopStoreSimplified,
  NuvemshopShippingCarrier,
  NuvemshopShippingCarrierSimplified,
  NuvemshopPaymentProvider,
  NuvemshopPaymentProviderSimplified,
  NuvemshopFulfillment,
  NuvemshopFulfillmentSimplified,
  NuvemshopTransaction,
  NuvemshopTransactionSimplified,
  extractLanguage,
  getTotalStock,
  NuvemshopVariant,
} from '../../../common/interfaces/nuvemshop.interface';

/**
 * NuvemshopService provides methods that will be exposed as tools to the AI agent
 * Each method here can be called by the @openai/agents SDK
 *
 * Methods return simplified interfaces suitable for AI agent consumption.
 */
@Injectable()
export class NuvemshopService implements OnModuleInit {
  private readonly logger = new Logger(NuvemshopService.name);
  private client: NuvemshopClient;
  private preferredLanguage: 'pt' | 'es' | 'en' = 'pt'; // Default to Portuguese

  constructor(private readonly configService: ConfigService) {}

  /**
   * Initialize Nuvemshop client on module startup
   */
  async onModuleInit() {
    const config: NuvemshopClientConfig = {
      baseUrl: this.configService.get<string>('NUVEMSHOP_API_URL', ''),
      storeId: this.configService.get<string>('NUVEMSHOP_STORE_ID', ''),
      accessToken: this.configService.get<string>('NUVEMSHOP_ACCESS_TOKEN', ''),
      userAgent: this.configService.get<string>('NUVEMSHOP_USER_AGENT', 'Metta AI Bot'),
      timeout: 10000,
    };

    // Validate configuration
    if (!config.baseUrl || !config.storeId || !config.accessToken) {
      this.logger.warn(
        'Nuvemshop configuration incomplete. Service will be unavailable.',
      );
      this.logger.warn(
        'Required env vars: NUVEMSHOP_API_URL, NUVEMSHOP_STORE_ID, NUVEMSHOP_ACCESS_TOKEN',
      );
      return;
    }

    // Extract preferred language from config (optional)
    const langConfig = this.configService.get<string>('NUVEMSHOP_LANGUAGE', 'pt');
    if (langConfig === 'es' || langConfig === 'en') {
      this.preferredLanguage = langConfig;
    }

    this.client = new NuvemshopClient(config);

    // Test connection on startup (optional, helps catch auth issues early)
    try {
      await this.client.testConnection();
      this.logger.log('NuvemshopService initialized and connection verified');
    } catch (error) {
      this.logger.error(
        'NuvemshopService initialized but connection test failed',
        error,
      );
    }
  }

  /**
   * Get product details by ID
   * This will be exposed as a tool for the AI agent
   *
   * @param productId - The Nuvemshop product ID
   * @returns Simplified product information
   */
  async getProduct(productId: number): Promise<NuvemshopProductSimplified> {
    this.logger.log(`Getting product ${productId}`);

    try {
      const product = await this.client.getProduct(productId);
      return this.mapProductToSimplified(product);
    } catch (error) {
      this.logger.error(`Failed to get product ${productId}`, error);
      throw new Error(
        `Failed to retrieve product: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Search products by query (searches name, SKU, description)
   * This will be exposed as a tool for the AI agent
   *
   * Smart search features:
   * - If plural query (ending in 's') returns no results, automatically tries singular
   * - Case-insensitive search via API
   * - Only returns published products
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of simplified product information
   */
  async searchProducts(
    query: string,
    limit = 10,
  ): Promise<NuvemshopProductSimplified[]> {
    this.logger.log(`Searching products: ${query}`);

    try {
      // First attempt: search with original query
      let products = await this.client.searchProducts(query, limit);

      // Smart fallback: if no results and query ends with 's', try singular form
      if (products.length === 0 && query.toLowerCase().endsWith('s')) {
        const singularQuery = query.slice(0, -1);
        this.logger.log(
          `No results for "${query}", trying singular form: "${singularQuery}"`,
        );
        products = await this.client.searchProducts(singularQuery, limit);
      }

      // Additional fallback: if still no results and query ends with 'es', try without 'es'
      if (products.length === 0 && query.toLowerCase().endsWith('es')) {
        const singularQuery = query.slice(0, -2);
        this.logger.log(
          `No results for "${query}", trying without "es": "${singularQuery}"`,
        );
        products = await this.client.searchProducts(singularQuery, limit);
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
   * Get detailed stock information for a product
   * Returns product with all variant stock levels
   *
   * @param productId - The Nuvemshop product ID
   * @returns Simplified product information with detailed stock per variant
   */
  async getProductStock(productId: number): Promise<NuvemshopProductSimplified> {
    this.logger.log(`Getting stock for product ${productId}`);

    try {
      const product = await this.client.getProductStock(productId);
      return this.mapProductToSimplified(product, { includeVariants: true });
    } catch (error) {
      this.logger.error(`Failed to get stock for product ${productId}`, error);
      throw new Error(
        `Failed to retrieve product stock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Helper: Map raw Nuvemshop product to simplified format for AI
   *
   * @param product - Raw product from API
   * @param options - Mapping options (includeVariants, etc.)
   * @returns Simplified product suitable for AI agent
   */
  private mapProductToSimplified(
    product: NuvemshopProduct,
    options: { includeVariants?: boolean } = {},
  ): NuvemshopProductSimplified {
    // Extract single-language values
    const name = extractLanguage(product.name, this.preferredLanguage) || 'Unknown Product';
    const description = extractLanguage(product.description, this.preferredLanguage);

    // Get first/main variant for basic product info
    const mainVariant = product.variants[0];
    const price = mainVariant ? parseFloat(mainVariant.price) : 0;
    const sku = mainVariant?.sku || undefined;

    // Calculate total stock across all variants
    const totalStock = getTotalStock(product);

    // Get first image URL
    const imageUrl = product.images.length > 0 ? product.images[0].src : undefined;

    // Get category name (first category if multiple)
    const category = product.categories.length > 0
      ? extractLanguage(product.categories[0].name, this.preferredLanguage)
      : undefined;

    // Build simplified product
    const simplified: NuvemshopProductSimplified = {
      id: product.id,
      name,
      price,
      stock: totalStock,
      sku,
      description,
      category,
      imageUrl,
    };

    // Include variant details if requested (useful for stock checking)
    if (options.includeVariants && product.variants.length > 1) {
      simplified.variants = product.variants.map((variant) =>
        this.mapVariantToSimplified(variant),
      );
    }

    return simplified;
  }

  /**
   * Helper: Map variant to simplified format
   */
  private mapVariantToSimplified(variant: NuvemshopVariant) {
    // Build human-readable variant attributes
    const attributes = variant.values
      .map((v) => extractLanguage(v, this.preferredLanguage))
      .filter(Boolean)
      .join(', ');

    return {
      id: variant.id,
      sku: variant.sku || undefined,
      price: parseFloat(variant.price),
      stock: variant.stock || 0,
      attributes: attributes || undefined,
    };
  }

  // ============================================================================
  // ORDER METHODS
  // ============================================================================

  /**
   * Get order details by ID or order number (smart lookup)
   * This will be exposed as a tool for the AI agent
   *
   * @param identifier - Order ID (number like 123 or "123") or order number (number)
   * @returns Simplified order information with items and customer
   */
  async getOrderByIdentifier(
    identifier: string | number,
  ): Promise<NuvemshopOrderSimplified> {
    this.logger.log(`Getting order by identifier: ${identifier}`);

    try {
      // Smart detection: if string is numeric, convert to number for ID search
      let searchValue: number;

      if (typeof identifier === 'string') {
        // Check if string is purely numeric (e.g., "123")
        const numericValue = Number(identifier);
        if (isNaN(numericValue)) {
          throw new Error(`Invalid order identifier: ${identifier}`);
        }
        searchValue = numericValue;
      } else {
        searchValue = identifier;
      }

      // Fetch order by ID
      const order = await this.client.getOrder(searchValue);

      return this.mapOrderToSimplified(order);
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
   * @param email - Customer email address (may be a PII placeholder like "[EMAIL_1]")
   * @param options - Optional filters (limit, days, status)
   * @returns Array of simplified order information
   */
  async getOrdersByCustomer(
    email: string,
    options: {
      limit?: number;
      days?: number;
      status?: 'open' | 'closed' | 'cancelled';
    } = {},
  ): Promise<NuvemshopOrderSimplified[]> {
    const { limit = 5, days, status } = options;
    this.logger.log(
      `Getting orders for customer: ${email} (limit: ${limit}, days: ${days}, status: ${status})`,
    );

    try {
      // Search orders by customer email
      const orders = await this.client.searchOrdersByCustomer(email, {
        limit,
        days,
        status,
      });

      // Map to simplified format
      return orders.map((order) => this.mapOrderToSimplified(order));
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
   * Note: Nuvemshop orders include full customer info, so this method
   * fetches a recent order for the customer to extract their information.
   *
   * @param customerId - The Nuvemshop customer ID
   * @returns Simplified customer information
   */
  async getCustomer(customerId: number): Promise<{
    id: number;
    name: string;
    email: string;
    phone?: string;
  }> {
    this.logger.log(`Getting customer ${customerId}`);

    try {
      // Fetch orders and find one with matching customer ID
      const orders = await this.client.getOrders({ per_page: 200 });
      const customerOrder = orders.find((order) => order.customer?.id === customerId);

      if (!customerOrder || !customerOrder.customer) {
        throw new Error(`Customer ${customerId} not found`);
      }

      const customer = customerOrder.customer;

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      };
    } catch (error) {
      this.logger.error(`Failed to get customer ${customerId}`, error);
      throw new Error(
        `Failed to retrieve customer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Helper: Map raw Nuvemshop order to simplified format for AI
   *
   * @param order - Raw order from API
   * @returns Simplified order suitable for AI agent
   */
  private mapOrderToSimplified(order: NuvemshopOrder): NuvemshopOrderSimplified {
    // Map order items
    const items: NuvemshopOrderItem[] = order.products.map((product) => ({
      productId: product.product_id,
      productName: extractLanguage(product.name, this.preferredLanguage) || 'Unknown Product',
      quantity: product.quantity,
      price: parseFloat(product.price),
    }));

    // Map status to human-readable format
    const status = this.mapOrderStatus(
      order.status,
      order.payment_status,
      order.shipping_status,
    );

    return {
      id: order.id,
      orderNumber: `#${order.number}`,
      status,
      items,
      total: parseFloat(order.total),
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
      },
      createdAt: new Date(order.created_at),
    };
  }

  /**
   * Helper: Map Nuvemshop order statuses to human-readable combined status
   *
   * Nuvemshop has 3 separate statuses:
   * - status: 'open' | 'closed' | 'cancelled'
   * - payment_status: 'pending' | 'authorized' | 'paid' | 'voided' | 'refunded' | 'abandoned'
   * - shipping_status: 'unpacked' | 'unfulfilled' | 'fulfilled'
   *
   * @param status - Order status
   * @param paymentStatus - Payment status
   * @param shippingStatus - Shipping status
   * @returns Human-readable combined status
   */
  private mapOrderStatus(
    status: string,
    paymentStatus: string,
    shippingStatus: string,
  ): string {
    // Cancelled takes priority
    if (status === 'cancelled') {
      return 'Cancelled';
    }

    // Closed and fulfilled = completed
    if (status === 'closed' && shippingStatus === 'fulfilled') {
      return 'Completed';
    }

    // Payment status combinations
    if (paymentStatus === 'pending' || paymentStatus === 'abandoned') {
      return 'Pending Payment';
    }

    if (paymentStatus === 'voided' || paymentStatus === 'refunded') {
      return paymentStatus === 'voided' ? 'Payment Voided' : 'Refunded';
    }

    // Paid orders - check shipping status
    if (paymentStatus === 'paid' || paymentStatus === 'authorized') {
      if (shippingStatus === 'fulfilled') {
        return 'Paid & Shipped';
      }
      if (shippingStatus === 'unpacked' || shippingStatus === 'unfulfilled') {
        return 'Paid - Preparing Shipment';
      }
    }

    // Default: Open
    if (status === 'open') {
      return 'Open';
    }

    // Fallback
    return `${status.charAt(0).toUpperCase() + status.slice(1)}`;
  }

  // ============================================================================
  // CATEGORY METHODS
  // ============================================================================

  /**
   * Get all categories
   * This will be exposed as a tool for the AI agent
   *
   * @returns Array of simplified category information
   */
  async getCategories(): Promise<NuvemshopCategorySimplified[]> {
    this.logger.log('Getting all categories');

    try {
      const categories = await this.client.getCategories();
      return categories.map((category) => this.mapCategoryToSimplified(category));
    } catch (error) {
      this.logger.error('Failed to get categories', error);
      throw new Error(
        `Failed to retrieve categories: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get category by ID
   * This will be exposed as a tool for the AI agent
   *
   * @param categoryId - The Nuvemshop category ID
   * @returns Simplified category information
   */
  async getCategory(categoryId: number): Promise<NuvemshopCategorySimplified> {
    this.logger.log(`Getting category ${categoryId}`);

    try {
      const category = await this.client.getCategory(categoryId);
      return this.mapCategoryToSimplified(category);
    } catch (error) {
      this.logger.error(`Failed to get category ${categoryId}`, error);
      throw new Error(
        `Failed to retrieve category: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Search products by category
   * This will be exposed as a tool for the AI agent
   *
   * @param categoryId - The category ID to filter by
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of simplified product information
   */
  async searchProductsByCategory(
    categoryId: number,
    limit = 10,
  ): Promise<NuvemshopProductSimplified[]> {
    this.logger.log(`Searching products in category ${categoryId}`);

    try {
      // Fetch products filtered by category
      const products = await this.client.getProducts({
        category_id: categoryId,
        per_page: limit,
        published: true, // Only published products
      });

      this.logger.log(`Found ${products.length} product(s) in category ${categoryId}`);

      return products.map((product) => this.mapProductToSimplified(product));
    } catch (error) {
      this.logger.error(`Failed to search products in category ${categoryId}`, error);
      throw new Error(
        `Failed to search products by category: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Helper: Map raw Nuvemshop category to simplified format for AI
   */
  private mapCategoryToSimplified(category: NuvemshopCategory): NuvemshopCategorySimplified {
    return {
      id: category.id,
      name: extractLanguage(category.name, this.preferredLanguage) || 'Unknown Category',
      description: extractLanguage(category.description, this.preferredLanguage),
      parentId: category.parent || undefined,
      subcategoryIds: category.subcategories || [],
    };
  }

  // ============================================================================
  // COUPON & PROMOTION METHODS
  // ============================================================================

  /**
   * Get all active promotions (coupons + discounts)
   * This will be exposed as a tool for the AI agent
   *
   * @returns Array of simplified promotion information
   */
  async getActivePromotions(): Promise<NuvemshopPromotionSimplified[]> {
    this.logger.log('Getting active promotions');

    try {
      // Fetch both coupons and discounts
      const [coupons, discounts] = await Promise.all([
        this.client.getCoupons(),
        this.client.getDiscounts(),
      ]);

      // Filter and map active coupons
      const activeCoupons = coupons
        .filter((coupon) => this.isCouponActive(coupon))
        .map((coupon) => this.mapCouponToPromotion(coupon));

      // Map active discounts
      const activeDiscounts = discounts
        .filter((discount) => this.isDiscountActive(discount))
        .map((discount) => this.mapDiscountToPromotion(discount));

      // Combine and sort by value (highest first)
      const allPromotions = [...activeCoupons, ...activeDiscounts].sort((a, b) => b.value - a.value);

      this.logger.log(`Found ${allPromotions.length} active promotion(s)`);

      return allPromotions;
    } catch (error) {
      this.logger.error('Failed to get active promotions', error);
      throw new Error(
        `Failed to retrieve active promotions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Validate a coupon code
   * This will be exposed as a tool for the AI agent
   *
   * @param code - Coupon code to validate
   * @returns Validation result with promotion details if valid
   */
  async validateCoupon(code: string): Promise<{
    valid: boolean;
    promotion?: NuvemshopPromotionSimplified;
    reason?: string;
  }> {
    this.logger.log(`Validating coupon code: ${code}`);

    try {
      const coupon = await this.client.getCouponByCode(code);

      if (!coupon) {
        return {
          valid: false,
          reason: 'Coupon code not found',
        };
      }

      if (!coupon.active) {
        return {
          valid: false,
          reason: 'Coupon is not active',
        };
      }

      if (!this.isCouponActive(coupon)) {
        return {
          valid: false,
          reason: 'Coupon has expired or is not yet valid',
        };
      }

      if (coupon.max_uses !== null && coupon.used >= coupon.max_uses) {
        return {
          valid: false,
          reason: 'Coupon has reached maximum uses',
        };
      }

      return {
        valid: true,
        promotion: this.mapCouponToPromotion(coupon),
      };
    } catch (error) {
      this.logger.error(`Failed to validate coupon code: ${code}`, error);
      throw new Error(
        `Failed to validate coupon: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Helper: Check if coupon is currently active based on dates
   */
  private isCouponActive(coupon: NuvemshopCoupon): boolean {
    if (!coupon.active) return false;

    const now = new Date();

    // Check valid_from
    if (coupon.valid_from) {
      const validFrom = new Date(coupon.valid_from);
      if (now < validFrom) return false;
    }

    // Check valid_to
    if (coupon.valid_to) {
      const validTo = new Date(coupon.valid_to);
      if (now > validTo) return false;
    }

    // Check max uses
    if (coupon.max_uses !== null && coupon.used >= coupon.max_uses) {
      return false;
    }

    return true;
  }

  /**
   * Helper: Check if discount is currently active based on dates
   */
  private isDiscountActive(discount: NuvemshopDiscount): boolean {
    const now = new Date();

    const validFrom = new Date(discount.valid_from);
    const validTo = new Date(discount.valid_to);

    return now >= validFrom && now <= validTo;
  }

  /**
   * Helper: Map coupon to simplified promotion format
   */
  private mapCouponToPromotion(coupon: NuvemshopCoupon): NuvemshopPromotionSimplified {
    const value = parseFloat(coupon.value);
    const minPurchase = coupon.min_price ? parseFloat(coupon.min_price) : undefined;

    // Build human-readable description
    let description = `${coupon.code}: `;
    if (coupon.type === 'percentage') {
      description += `${value}% OFF`;
    } else {
      description += `$${value.toFixed(2)} OFF`;
    }
    if (minPurchase) {
      description += ` on purchases over $${minPurchase.toFixed(2)}`;
    }

    return {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type === 'percentage' ? 'percentage' : 'fixed_amount',
      value,
      description,
      minPurchase,
      validFrom: coupon.valid_from ? new Date(coupon.valid_from) : undefined,
      validUntil: coupon.valid_to ? new Date(coupon.valid_to) : undefined,
      isActive: this.isCouponActive(coupon),
      usesRemaining: coupon.max_uses !== null ? coupon.max_uses - coupon.used : undefined,
    };
  }

  /**
   * Helper: Map discount to simplified promotion format
   */
  private mapDiscountToPromotion(discount: NuvemshopDiscount): NuvemshopPromotionSimplified {
    const value = parseFloat(discount.value);

    // Build human-readable description
    let description = 'Automatic promotion: ';
    if (discount.type === 'percentage') {
      description += `${value}% OFF`;
    } else {
      description += `$${value.toFixed(2)} OFF`;
    }

    if (discount.applies_to === 'categories') {
      description += ' on selected categories';
    } else if (discount.applies_to === 'products') {
      description += ' on selected products';
    }

    return {
      id: discount.id,
      type: discount.type === 'percentage' ? 'percentage' : 'fixed_amount',
      value,
      description,
      validFrom: new Date(discount.valid_from),
      validUntil: new Date(discount.valid_to),
      isActive: this.isDiscountActive(discount),
    };
  }

  // ============================================================================
  // STORE INFORMATION METHODS
  // ============================================================================

  /**
   * Get store information in simplified format for AI
   *
   * @returns Simplified store information with contact details and policies
   * @throws Error if API call fails
   */
  async getStoreInfo(): Promise<NuvemshopStoreSimplified> {
    try {
      this.logger.log('Fetching store information');

      const store = await this.client.getStore();

      const simplified: NuvemshopStoreSimplified = {
        name: extractLanguage(store.name, this.preferredLanguage) || 'Store',
        description: extractLanguage(store.description, this.preferredLanguage),
        email: store.email,
        phone: store.phone,
        address: `${store.address}, ${store.city}, ${store.province} ${store.zipcode}, ${store.country}`,
        businessName: store.business_name,
        url: store.url,
        currency: store.main_currency,
        languages: store.languages,
        socialMedia: {
          facebook: store.facebook || undefined,
          twitter: store.twitter || undefined,
          instagram: store.instagram || undefined,
        },
      };

      this.logger.log('Store information retrieved successfully');
      return simplified;
    } catch (error) {
      this.logger.error('Failed to fetch store information', error.stack);
      throw error;
    }
  }

  // ============================================================================
  // SHIPPING CARRIER METHODS
  // ============================================================================

  /**
   * Get shipping options/carriers in simplified format for AI
   *
   * @returns List of available shipping methods
   * @throws Error if API call fails
   */
  async getShippingOptions(): Promise<NuvemshopShippingCarrierSimplified[]> {
    try {
      this.logger.log('Fetching shipping options');

      const carriers = await this.client.getShippingCarriers();

      // Filter for active carriers and simplify
      const simplified = carriers
        .filter((carrier) => carrier.active)
        .map((carrier) => ({
          id: carrier.id,
          name: carrier.name,
          active: carrier.active,
          types: carrier.types,
        }));

      this.logger.log(`Found ${simplified.length} active shipping option(s)`);
      return simplified;
    } catch (error) {
      this.logger.error('Failed to fetch shipping options', error.stack);
      throw error;
    }
  }

  // ============================================================================
  // PAYMENT PROVIDER METHODS
  // ============================================================================

  /**
   * Get payment methods/providers in simplified format for AI
   *
   * @returns List of enabled payment methods
   * @throws Error if API call fails
   */
  async getPaymentMethods(): Promise<NuvemshopPaymentProviderSimplified[]> {
    try {
      this.logger.log('Fetching payment methods');

      const providers = await this.client.getPaymentProviders();

      // Filter for enabled providers and simplify
      const simplified = providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          enabled: provider.enabled,
        }));

      this.logger.log(`Found ${simplified.length} enabled payment method(s)`);
      return simplified;
    } catch (error) {
      this.logger.error('Failed to fetch payment methods', error.stack);
      throw error;
    }
  }

  // ============================================================================
  // ORDER FULFILLMENT METHODS
  // ============================================================================

  /**
   * Get order tracking information (fulfillments) for a specific order
   *
   * @param orderIdentifier - Order ID as string or number
   * @returns Simplified fulfillment information with tracking details
   * @throws Error if order not found or API call fails
   */
  async getOrderTracking(orderIdentifier: string | number): Promise<NuvemshopFulfillmentSimplified[]> {
    try {
      this.logger.log(`Fetching tracking information for order ${orderIdentifier}`);

      // Parse identifier and get order to validate it exists
      const orderId = typeof orderIdentifier === 'string'
        ? parseInt(orderIdentifier, 10)
        : orderIdentifier;

      if (isNaN(orderId)) {
        throw new Error(`Invalid order identifier: ${orderIdentifier}`);
      }

      // Get fulfillments for this order
      const fulfillments = await this.client.getOrderFulfillments(orderId);

      // Map to simplified format
      const simplified = fulfillments.map((fulfillment) => ({
        id: fulfillment.id,
        trackingNumber: fulfillment.tracking_number || undefined,
        trackingUrl: fulfillment.tracking_url || undefined,
        status: this.mapFulfillmentStatus(fulfillment.status),
        carrier: fulfillment.shipping_carrier_name,
        estimatedDelivery: fulfillment.estimated_delivery_date
          ? new Date(fulfillment.estimated_delivery_date)
          : undefined,
        items: fulfillment.line_items.map((item) => ({
          productId: item.product_id,
          quantity: item.quantity,
        })),
      }));

      this.logger.log(`Found ${simplified.length} fulfillment(s) for order ${orderId}`);
      return simplified;
    } catch (error) {
      this.logger.error(`Failed to fetch tracking for order ${orderIdentifier}`, error.stack);
      throw error;
    }
  }

  /**
   * Map fulfillment status to human-readable format
   */
  private mapFulfillmentStatus(status: NuvemshopFulfillment['status']): string {
    const statusMap: Record<NuvemshopFulfillment['status'], string> = {
      fulfilled: 'Fulfilled',
      in_transit: 'In Transit',
      delivered: 'Delivered',
      failed: 'Failed',
    };

    return statusMap[status] || status;
  }

  // ============================================================================
  // PAYMENT TRANSACTION METHODS
  // ============================================================================

  /**
   * Get payment transaction history for a specific order
   *
   * @param orderIdentifier - Order ID as string or number
   * @returns Simplified transaction history with payment details
   * @throws Error if order not found or API call fails
   */
  async getOrderPaymentHistory(orderIdentifier: string | number): Promise<NuvemshopTransactionSimplified[]> {
    try {
      this.logger.log(`Fetching payment history for order ${orderIdentifier}`);

      // Parse identifier and get order to validate it exists
      const orderId = typeof orderIdentifier === 'string'
        ? parseInt(orderIdentifier, 10)
        : orderIdentifier;

      if (isNaN(orderId)) {
        throw new Error(`Invalid order identifier: ${orderIdentifier}`);
      }

      // Get transactions for this order
      const transactions = await this.client.getOrderTransactions(orderId);

      // Map to simplified format
      const simplified = transactions.map((transaction) => ({
        id: transaction.id,
        amount: parseFloat(transaction.amount),
        currency: transaction.currency,
        status: this.mapTransactionStatus(transaction.status),
        paymentMethod: transaction.payment_mode,
        gateway: transaction.gateway,
        transactionDate: new Date(transaction.created_at),
        errorMessage: transaction.error_message || undefined,
      }));

      this.logger.log(`Found ${simplified.length} transaction(s) for order ${orderId}`);
      return simplified;
    } catch (error) {
      this.logger.error(`Failed to fetch payment history for order ${orderIdentifier}`, error.stack);
      throw error;
    }
  }

  /**
   * Map transaction status to human-readable format
   */
  private mapTransactionStatus(status: NuvemshopTransaction['status']): string {
    const statusMap: Record<NuvemshopTransaction['status'], string> = {
      pending: 'Pending',
      authorized: 'Authorized',
      paid: 'Paid',
      failed: 'Failed',
      refunded: 'Refunded',
      voided: 'Voided',
    };

    return statusMap[status] || status;
  }

  /**
   * Check if service is properly configured and available
   * Used by other modules to determine if Nuvemshop integration is active
   */
  isAvailable(): boolean {
    return !!this.client;
  }
}
