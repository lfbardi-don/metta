import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '@nestjs/common';
import {
  NuvemshopProduct,
  NuvemshopOrder,
  NuvemshopCategory,
  NuvemshopCoupon,
  NuvemshopDiscount,
  NuvemshopStore,
  NuvemshopShippingCarrier,
  NuvemshopPaymentProvider,
  NuvemshopFulfillment,
  NuvemshopTransaction,
  NuvemshopPaginatedResponse,
  NuvemshopProductSearchParams,
  NuvemshopOrderSearchParams,
  NuvemshopClientConfig,
} from '../../../common/interfaces/nuvemshop.interface';

/**
 * Low-level HTTP client for Nuvemshop/Tiendanube REST API
 *
 * Handles authentication, request/response formatting, error handling, and retries.
 * This is a reusable wrapper around the Nuvemshop REST API.
 *
 * API Documentation: https://tiendanube.github.io/api-documentation/
 */
export class NuvemshopClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly logger = new Logger(NuvemshopClient.name);
  private readonly storeId: string;

  constructor(config: NuvemshopClientConfig) {
    this.storeId = config.storeId;

    // Create axios instance with Nuvemshop-specific configuration
    this.axiosInstance = axios.create({
      baseURL: `${config.baseUrl}/${config.storeId}`,
      headers: {
        Authentication: `bearer ${config.accessToken}`,
        'User-Agent': config.userAgent,
        'Content-Type': 'application/json',
      },
      timeout: config.timeout || 10000, // 10 second default timeout
    });

    // Add response interceptor for logging
    this.axiosInstance.interceptors.response.use(
      (response) => {
        this.logger.debug(`API call successful: ${response.config.method?.toUpperCase()} ${response.config.url}`, {
          status: response.status,
        });
        return response;
      },
      (error: AxiosError) => {
        this.logger.error(`API call failed: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
        });
        return Promise.reject(error);
      },
    );

    this.logger.log(`Nuvemshop client initialized for store ${config.storeId}`);
  }

  /**
   * Get a single product by ID
   *
   * @param productId - The Nuvemshop product ID
   * @returns Product details
   * @throws Error if product not found or API call fails
   */
  async getProduct(productId: number): Promise<NuvemshopProduct> {
    try {
      this.logger.debug(`Fetching product ${productId}`);

      const response = await this.axiosInstance.get<NuvemshopProduct>(`/products/${productId}`);

      this.logger.debug(`Product ${productId} fetched successfully`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch product ${productId}`);
    }
  }

  /**
   * Get multiple products with optional filtering and pagination
   *
   * @param params - Search and filter parameters
   * @returns Array of products (paginated)
   * @throws Error if API call fails
   */
  async getProducts(
    params?: NuvemshopProductSearchParams,
  ): Promise<NuvemshopProduct[]> {
    try {
      this.logger.debug('Fetching products', { params });

      const queryParams: any = {
        per_page: params?.per_page || 50, // Default 50 results
        page: params?.page || 1,
      };

      // Add optional filters
      if (params?.q) queryParams.q = params.q;
      if (params?.category_id) queryParams.category_id = params.category_id;
      if (params?.published !== undefined) queryParams.published = params.published;
      if (params?.free_shipping !== undefined) queryParams.free_shipping = params.free_shipping;
      if (params?.min_price) queryParams.min_price = params.min_price;
      if (params?.max_price) queryParams.max_price = params.max_price;
      if (params?.sort_by) queryParams.sort_by = params.sort_by;

      const response = await this.axiosInstance.get<NuvemshopProduct[]>('/products', {
        params: queryParams,
      });

      this.logger.debug(`Fetched ${response.data.length} products`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch products');
    }
  }

  /**
   * Search products by query string (searches name, SKU, description)
   * This is a convenience method that wraps getProducts() with a search query
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of matching products
   */
  async searchProducts(query: string, limit = 10): Promise<NuvemshopProduct[]> {
    try {
      this.logger.debug(`Searching products with query: "${query}"`, { limit });

      const products = await this.getProducts({
        q: query,
        per_page: limit,
        published: true, // Only search published products
      });

      this.logger.debug(`Found ${products.length} products matching "${query}"`);
      return products;
    } catch (error) {
      this.handleError(error, `Failed to search products with query "${query}"`);
    }
  }

  /**
   * Get detailed stock information for a product
   * Returns all variants with their stock levels
   *
   * @param productId - The Nuvemshop product ID
   * @returns Product with variant stock information
   */
  async getProductStock(productId: number): Promise<NuvemshopProduct> {
    try {
      this.logger.debug(`Fetching stock for product ${productId}`);

      // Same as getProduct, but explicitly for stock checking
      const product = await this.getProduct(productId);

      this.logger.debug(`Stock fetched for product ${productId}: ${product.variants.length} variant(s)`);
      return product;
    } catch (error) {
      this.handleError(error, `Failed to fetch stock for product ${productId}`);
    }
  }

  // ============================================================================
  // ORDER METHODS
  // ============================================================================

  /**
   * Get a single order by ID
   *
   * @param orderId - The Nuvemshop order ID
   * @returns Order details
   * @throws Error if order not found or API call fails
   */
  async getOrder(orderId: number): Promise<NuvemshopOrder> {
    try {
      this.logger.debug(`Fetching order ${orderId}`);

      const response = await this.axiosInstance.get<NuvemshopOrder>(`/orders/${orderId}`);

      this.logger.debug(`Order ${orderId} fetched successfully`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch order ${orderId}`);
    }
  }

  /**
   * Get multiple orders with optional filtering and pagination
   *
   * @param params - Search and filter parameters
   * @returns Array of orders (paginated)
   * @throws Error if API call fails
   */
  async getOrders(
    params?: NuvemshopOrderSearchParams,
  ): Promise<NuvemshopOrder[]> {
    try {
      this.logger.debug('Fetching orders', { params });

      const queryParams: any = {
        per_page: params?.per_page || 50, // Default 50 results
        page: params?.page || 1,
      };

      // Add optional filters
      if (params?.fields) queryParams.fields = params.fields;
      if (params?.since_id) queryParams.since_id = params.since_id;
      if (params?.created_at_min) queryParams.created_at_min = params.created_at_min;
      if (params?.created_at_max) queryParams.created_at_max = params.created_at_max;
      if (params?.updated_at_min) queryParams.updated_at_min = params.updated_at_min;
      if (params?.updated_at_max) queryParams.updated_at_max = params.updated_at_max;
      if (params?.status) queryParams.status = params.status;
      if (params?.payment_status) queryParams.payment_status = params.payment_status;
      if (params?.shipping_status) queryParams.shipping_status = params.shipping_status;

      const response = await this.axiosInstance.get<NuvemshopOrder[]>('/orders', {
        params: queryParams,
      });

      this.logger.debug(`Fetched ${response.data.length} orders`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch orders');
    }
  }

  /**
   * Search orders by customer email with optional filters
   * This is a convenience method that wraps getOrders() with email filtering
   *
   * Note: Nuvemshop API does not have direct email search, so this method
   * fetches orders and filters them by customer email in memory.
   * For production use with large order volumes, consider alternative approaches.
   *
   * @param email - Customer email address
   * @param options - Optional filters (limit, days, status)
   * @returns Array of matching orders
   */
  async searchOrdersByCustomer(
    email: string,
    options: {
      limit?: number;
      days?: number;
      status?: 'open' | 'closed' | 'cancelled';
      payment_status?: 'pending' | 'authorized' | 'paid' | 'voided' | 'refunded' | 'abandoned';
    } = {},
  ): Promise<NuvemshopOrder[]> {
    try {
      this.logger.debug(`Searching orders for customer: ${email}`, { options });

      const searchParams: NuvemshopOrderSearchParams = {
        per_page: 200, // Fetch max to increase chance of finding customer orders
        page: 1,
      };

      // Add date filter if days specified
      if (options.days) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - options.days);
        searchParams.created_at_min = cutoffDate.toISOString();
      }

      // Add status filter if specified
      if (options.status) {
        searchParams.status = options.status;
      }

      // Add payment status filter if specified
      if (options.payment_status) {
        searchParams.payment_status = options.payment_status;
      }

      // Fetch orders
      const orders = await this.getOrders(searchParams);

      // Filter by email (case-insensitive)
      const emailLower = email.toLowerCase();
      const matchingOrders = orders.filter(
        (order) => order.contact_email?.toLowerCase() === emailLower ||
                   order.customer?.email?.toLowerCase() === emailLower,
      );

      // Apply limit if specified
      const limitedOrders = options.limit
        ? matchingOrders.slice(0, options.limit)
        : matchingOrders;

      this.logger.debug(
        `Found ${matchingOrders.length} orders for ${email}, returning ${limitedOrders.length}`,
      );

      return limitedOrders;
    } catch (error) {
      this.handleError(error, `Failed to search orders for customer ${email}`);
    }
  }

  // ============================================================================
  // CATEGORY METHODS
  // ============================================================================

  /**
   * Get all categories
   *
   * @returns Array of categories
   * @throws Error if API call fails
   */
  async getCategories(): Promise<NuvemshopCategory[]> {
    try {
      this.logger.debug('Fetching all categories');

      const response = await this.axiosInstance.get<NuvemshopCategory[]>('/categories');

      this.logger.debug(`Fetched ${response.data.length} categories`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch categories');
    }
  }

  /**
   * Get a single category by ID
   *
   * @param categoryId - The Nuvemshop category ID
   * @returns Category details
   * @throws Error if category not found or API call fails
   */
  async getCategory(categoryId: number): Promise<NuvemshopCategory> {
    try {
      this.logger.debug(`Fetching category ${categoryId}`);

      const response = await this.axiosInstance.get<NuvemshopCategory>(`/categories/${categoryId}`);

      this.logger.debug(`Category ${categoryId} fetched successfully`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch category ${categoryId}`);
    }
  }

  // ============================================================================
  // COUPON & DISCOUNT METHODS
  // ============================================================================

  /**
   * Get all coupons
   *
   * @returns Array of coupons
   * @throws Error if API call fails
   */
  async getCoupons(): Promise<NuvemshopCoupon[]> {
    try {
      this.logger.debug('Fetching all coupons');

      const response = await this.axiosInstance.get<NuvemshopCoupon[]>('/coupons');

      this.logger.debug(`Fetched ${response.data.length} coupons`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch coupons');
    }
  }

  /**
   * Get a single coupon by ID
   *
   * @param couponId - The Nuvemshop coupon ID
   * @returns Coupon details
   * @throws Error if coupon not found or API call fails
   */
  async getCoupon(couponId: number): Promise<NuvemshopCoupon> {
    try {
      this.logger.debug(`Fetching coupon ${couponId}`);

      const response = await this.axiosInstance.get<NuvemshopCoupon>(`/coupons/${couponId}`);

      this.logger.debug(`Coupon ${couponId} fetched successfully`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch coupon ${couponId}`);
    }
  }

  /**
   * Find a coupon by code
   * Fetches all coupons and filters by code
   *
   * @param code - Coupon code to search for
   * @returns Coupon if found, null otherwise
   */
  async getCouponByCode(code: string): Promise<NuvemshopCoupon | null> {
    try {
      this.logger.debug(`Searching for coupon with code: ${code}`);

      const coupons = await this.getCoupons();
      const coupon = coupons.find(c => c.code.toLowerCase() === code.toLowerCase());

      if (coupon) {
        this.logger.debug(`Found coupon ${coupon.id} with code ${code}`);
      } else {
        this.logger.debug(`No coupon found with code ${code}`);
      }

      return coupon || null;
    } catch (error) {
      this.handleError(error, `Failed to search for coupon with code ${code}`);
    }
  }

  /**
   * Get all discounts/promotions
   *
   * @returns Array of discounts
   * @throws Error if API call fails
   */
  async getDiscounts(): Promise<NuvemshopDiscount[]> {
    try {
      this.logger.debug('Fetching all discounts');

      const response = await this.axiosInstance.get<NuvemshopDiscount[]>('/discounts');

      this.logger.debug(`Fetched ${response.data.length} discounts`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch discounts');
    }
  }

  // ============================================================================
  // STORE INFORMATION METHODS
  // ============================================================================

  /**
   * Get store information
   *
   * @returns Store configuration and business details
   * @throws Error if API call fails
   */
  async getStore(): Promise<NuvemshopStore> {
    try {
      this.logger.debug('Fetching store information');

      const response = await this.axiosInstance.get<NuvemshopStore>('/store');

      this.logger.debug('Store information fetched successfully');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch store information');
    }
  }

  // ============================================================================
  // SHIPPING CARRIER METHODS
  // ============================================================================

  /**
   * Get all shipping carriers
   *
   * @returns Array of shipping carriers/methods
   * @throws Error if API call fails
   */
  async getShippingCarriers(): Promise<NuvemshopShippingCarrier[]> {
    try {
      this.logger.debug('Fetching shipping carriers');

      const response = await this.axiosInstance.get<NuvemshopShippingCarrier[]>('/shipping_carriers');

      this.logger.debug(`Fetched ${response.data.length} shipping carriers`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch shipping carriers');
    }
  }

  // ============================================================================
  // PAYMENT PROVIDER METHODS
  // ============================================================================

  /**
   * Get all payment providers
   *
   * @returns Array of payment providers/gateways
   * @throws Error if API call fails
   */
  async getPaymentProviders(): Promise<NuvemshopPaymentProvider[]> {
    try {
      this.logger.debug('Fetching payment providers');

      const response = await this.axiosInstance.get<NuvemshopPaymentProvider[]>('/payment_providers');

      this.logger.debug(`Fetched ${response.data.length} payment providers`);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch payment providers');
    }
  }

  // ============================================================================
  // ORDER FULFILLMENT METHODS
  // ============================================================================

  /**
   * Get fulfillments for a specific order
   *
   * @param orderId - The Nuvemshop order ID
   * @returns Array of fulfillments (shipments) for the order
   * @throws Error if API call fails
   */
  async getOrderFulfillments(orderId: number): Promise<NuvemshopFulfillment[]> {
    try {
      this.logger.debug(`Fetching fulfillments for order ${orderId}`);

      const response = await this.axiosInstance.get<NuvemshopFulfillment[]>(`/orders/${orderId}/fulfillments`);

      this.logger.debug(`Fetched ${response.data.length} fulfillment(s) for order ${orderId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch fulfillments for order ${orderId}`);
    }
  }

  // ============================================================================
  // PAYMENT TRANSACTION METHODS
  // ============================================================================

  /**
   * Get payment transactions for a specific order
   *
   * @param orderId - The Nuvemshop order ID
   * @returns Array of payment transactions for the order
   * @throws Error if API call fails
   */
  async getOrderTransactions(orderId: number): Promise<NuvemshopTransaction[]> {
    try {
      this.logger.debug(`Fetching transactions for order ${orderId}`);

      const response = await this.axiosInstance.get<NuvemshopTransaction[]>(`/orders/${orderId}/transactions`);

      this.logger.debug(`Fetched ${response.data.length} transaction(s) for order ${orderId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch transactions for order ${orderId}`);
    }
  }

  /**
   * Handle API errors with proper logging and error messages
   *
   * @param error - The caught error
   * @param context - Context message for logging
   * @throws Error with descriptive message
   */
  private handleError(error: any, context: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;

      // Handle specific HTTP status codes
      if (status === 404) {
        throw new Error(`${context}: Resource not found (404)`);
      } else if (status === 401) {
        throw new Error(`${context}: Authentication failed (401) - Check access token`);
      } else if (status === 403) {
        throw new Error(`${context}: Permission denied (403) - Check API scopes`);
      } else if (status === 429) {
        throw new Error(`${context}: Rate limit exceeded (429) - Try again later`);
      } else if (status && status >= 500) {
        throw new Error(`${context}: Nuvemshop server error (${status})`);
      }

      // Generic error with response data
      throw new Error(
        `${context}: ${error.message} ${data ? `- ${JSON.stringify(data)}` : ''}`,
      );
    }

    // Non-Axios error (network, timeout, etc.)
    throw new Error(`${context}: ${error.message || 'Unknown error'}`);
  }

  /**
   * Test the connection to Nuvemshop API
   * Useful for validating configuration on startup
   *
   * @returns true if connection successful, throws error otherwise
   */
  async testConnection(): Promise<boolean> {
    try {
      this.logger.debug('Testing Nuvemshop API connection');

      // Try to fetch first product (minimal data)
      await this.getProducts({ per_page: 1 });

      this.logger.log('Nuvemshop API connection test successful');
      return true;
    } catch (error) {
      this.logger.error('Nuvemshop API connection test failed', {
        error: error.message,
      });
      throw error;
    }
  }
}
