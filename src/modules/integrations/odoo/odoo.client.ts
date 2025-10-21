import Odoo from '@fernandoslim/odoo-jsonrpc';
import { Logger } from '@nestjs/common';
import {
  OdooDomain,
  OdooRecord,
  OdooSearchOptions,
} from '../../../common/interfaces';

/**
 * Configuration for OdooClient
 */
export interface OdooClientConfig {
  url: string;
  database: string;
  username: string;
  password: string;
}

/**
 * OdooClient - Reusable wrapper for Odoo JSON-RPC operations
 *
 * Provides a simplified, type-safe interface for interacting with Odoo.
 * Handles connection lifecycle, error handling, and retry logic.
 */
export class OdooClient {
  private readonly logger = new Logger(OdooClient.name);
  private client: Odoo | null = null;
  private connecting: Promise<void> | null = null;
  private readonly config: OdooClientConfig;

  constructor(config: OdooClientConfig) {
    this.config = config;
  }

  /**
   * Ensure connection is established
   */
  private async connect(): Promise<Odoo> {
    if (this.client) {
      return this.client;
    }

    if (!this.connecting) {
      this.connecting = this.initialize();
    }

    await this.connecting;

    if (!this.client) {
      throw new Error('Failed to connect to Odoo');
    }

    return this.client;
  }

  /**
   * Initialize Odoo connection
   */
  private async initialize(): Promise<void> {
    try {
      const url = new URL(this.config.url);
      const baseUrl = `${url.protocol}//${url.hostname}`;
      const port = url.port
        ? parseInt(url.port)
        : url.protocol === 'https:'
          ? 443
          : 80;

      this.logger.log(`Connecting to Odoo at ${baseUrl}:${port}...`);

      this.client = new Odoo({
        baseUrl,
        port,
        db: this.config.database,
        username: this.config.username,
        password: this.config.password,
      });

      await this.client.connect();
      this.logger.log('Successfully connected to Odoo');
    } catch (error) {
      this.logger.error('Failed to connect to Odoo', error);
      this.client = null;
      this.connecting = null;
      throw error;
    }
  }

  /**
   * Search and read records with type safety
   *
   * @param model - Odoo model name (e.g., 'product.product')
   * @param options - Search options (domain, fields, limit, offset, order)
   * @returns Array of records
   *
   * @example
   * const products = await client.searchRead<OdooProduct>('product.product', {
   *   domain: [['name', 'ilike', 'Shirt']],
   *   fields: ['name', 'list_price', 'qty_available'],
   *   limit: 10
   * });
   */
  async searchRead<T extends OdooRecord = OdooRecord>(
    model: string,
    options: OdooSearchOptions = {},
  ): Promise<T[]> {
    const client = await this.connect();
    const {
      domain = [],
      fields = [],
      limit = 100,
      offset = 0,
      order,
    } = options;

    try {
      this.logger.debug(
        `searchRead: ${model}, domain: ${JSON.stringify(domain)}, limit: ${limit}`,
      );

      const result = await client.searchRead(model, domain, fields, {
        limit,
        offset,
        order,
      });

      return (result as T[]) || [];
    } catch (error) {
      this.handleError('searchRead', model, error);
      throw error;
    }
  }

  /**
   * Read records by IDs
   *
   * @param model - Odoo model name
   * @param ids - Single ID or array of IDs
   * @param fields - Fields to retrieve (empty = all fields)
   * @returns Array of records
   *
   * @example
   * const products = await client.read<OdooProduct>('product.product', [1, 2, 3], [
   *   'name', 'list_price', 'default_code'
   * ]);
   */
  async read<T extends OdooRecord = OdooRecord>(
    model: string,
    ids: number | number[],
    fields?: string[],
  ): Promise<T[]> {
    const client = await this.connect();
    const idArray = Array.isArray(ids) ? ids : [ids];

    if (idArray.length === 0) {
      return [];
    }

    try {
      this.logger.debug(`read: ${model}, ids: ${idArray.join(', ')}`);

      const result = await client.read<T>(model, idArray, fields || []);
      return result || [];
    } catch (error) {
      this.handleError('read', model, error);
      throw error;
    }
  }

  /**
   * Create a new record
   *
   * @param model - Odoo model name
   * @param data - Record data (without ID)
   * @returns Created record ID
   *
   * @example
   * const customerId = await client.create('res.partner', {
   *   name: 'John Doe',
   *   email: 'john@example.com'
   * });
   */
  async create<T extends OdooRecord = OdooRecord>(
    model: string,
    data: Omit<Partial<T>, 'id'>,
  ): Promise<number> {
    const client = await this.connect();

    try {
      this.logger.debug(`create: ${model}`);

      const recordId = await client.create(model, data);
      this.logger.log(`Created ${model} record with ID: ${recordId}`);
      return recordId;
    } catch (error) {
      this.handleError('create', model, error);
      throw error;
    }
  }

  /**
   * Update an existing record
   *
   * @param model - Odoo model name
   * @param id - Record ID to update
   * @param data - Updated fields
   * @returns Success boolean
   *
   * @example
   * await client.update('res.partner', 42, {
   *   email: 'newemail@example.com',
   *   mobile: '+1234567890'
   * });
   */
  async update<T extends OdooRecord = OdooRecord>(
    model: string,
    id: number,
    data: Omit<Partial<T>, 'id'>,
  ): Promise<boolean> {
    const client = await this.connect();

    try {
      this.logger.debug(`update: ${model}, id: ${id}`);

      const result = await client.update(model, id, data);
      this.logger.log(`Updated ${model} record ID: ${id}`);
      return result;
    } catch (error) {
      this.handleError('update', model, error);
      throw error;
    }
  }

  /**
   * Delete record(s)
   *
   * @param model - Odoo model name
   * @param ids - Single ID or array of IDs to delete
   * @returns Success boolean
   *
   * @example
   * await client.delete('res.partner', [1, 2, 3]);
   */
  async delete(model: string, ids: number | number[]): Promise<boolean> {
    const client = await this.connect();
    const idArray = Array.isArray(ids) ? ids : [ids];

    if (idArray.length === 0) {
      return true;
    }

    try {
      this.logger.debug(`delete: ${model}, ids: ${idArray.join(', ')}`);

      if (idArray.length === 1) {
        const result = await client.delete(model, idArray[0]);
        this.logger.log(`Deleted ${model} record ID: ${idArray[0]}`);
        return result;
      }

      // Batch delete using unlink
      const result = await client.call_kw(model, 'unlink', [idArray]);
      this.logger.log(`Deleted ${idArray.length} ${model} records`);
      return result === true;
    } catch (error) {
      this.handleError('delete', model, error);
      throw error;
    }
  }

  /**
   * Call any Odoo RPC method
   *
   * @param model - Odoo model name
   * @param method - Method name to call
   * @param args - Positional arguments
   * @param kwargs - Keyword arguments
   * @returns Method result
   *
   * @example
   * // Confirm a sales order
   * await client.callMethod('sale.order', 'action_confirm', [[orderId]]);
   */
  async callMethod(
    model: string,
    method: string,
    args: any[] = [],
    kwargs: Record<string, any> = {},
  ): Promise<any> {
    const client = await this.connect();

    try {
      this.logger.debug(`callMethod: ${model}.${method}`);

      const result = await client.call_kw(model, method, args, kwargs);
      return result;
    } catch (error) {
      this.handleError('callMethod', model, error);
      throw error;
    }
  }

  /**
   * Search for record IDs only (without reading data)
   *
   * @param model - Odoo model name
   * @param domain - Domain filter
   * @param limit - Maximum results
   * @param offset - Skip offset
   * @returns Array of record IDs
   */
  async search(
    model: string,
    domain: OdooDomain = [],
    limit = 100,
    offset = 0,
  ): Promise<number[]> {
    const client = await this.connect();

    try {
      this.logger.debug(
        `search: ${model}, domain: ${JSON.stringify(domain)}, limit: ${limit}`,
      );

      const result = await client.search(model, domain);
      return result || [];
    } catch (error) {
      this.handleError('search', model, error);
      throw error;
    }
  }

  /**
   * Handle and log errors with context
   */
  private handleError(operation: string, model: string, error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for common Odoo errors
    if (errorMessage.includes('Access Denied')) {
      this.logger.error(
        `${operation} failed on ${model}: Access denied - check user permissions`,
      );
    } else if (errorMessage.includes('Unknown field')) {
      this.logger.error(
        `${operation} failed on ${model}: Invalid field requested`,
      );
    } else if (errorMessage.includes('Unknown model')) {
      this.logger.error(`${operation} failed on ${model}: Invalid model name`);
    } else {
      this.logger.error(
        `${operation} failed on ${model}: ${errorMessage}`,
        error.stack,
      );
    }
  }

  /**
   * Disconnect from Odoo (cleanup)
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.logger.log('Disconnecting from Odoo');
      this.client = null;
      this.connecting = null;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }
}
