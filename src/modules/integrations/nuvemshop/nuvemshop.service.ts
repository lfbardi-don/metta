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

  /**
   * Check if service is properly configured and available
   * Used by other modules to determine if Nuvemshop integration is active
   */
  isAvailable(): boolean {
    return !!this.client;
  }
}
