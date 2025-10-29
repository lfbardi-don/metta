import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '@nestjs/common';
import {
  NuvemshopProduct,
  NuvemshopPaginatedResponse,
  NuvemshopProductSearchParams,
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
