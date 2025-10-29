import { Logger } from '@nestjs/common';
import { OdooService } from '../../modules/integrations/odoo/odoo.service';
import { NuvemshopService } from '../../modules/integrations/nuvemshop/nuvemshop.service';
import { AuthenticationService } from '../../modules/authentication/authentication.service';
import { PIIMetadata } from './guardrail.interface';
import { OdooProductSimplified } from './odoo.interface';
import { NuvemshopProductSimplified } from './nuvemshop.interface';

/**
 * Context passed to all agent tools via the execute function
 * Provides access to services and request metadata
 */
export interface AgentContext {
  /**
   * Chatwoot conversation ID for the current interaction
   */
  conversationId: string;

  /**
   * Optional contact ID from Chatwoot (as string)
   */
  contactId?: string;

  /**
   * Services available to tools
   */
  services: {
    /**
     * Odoo ERP service for product, order, and customer operations
     */
    odooService: OdooService;

    /**
     * Nuvemshop/Tiendanube e-commerce service for product operations
     */
    nuvemshopService: NuvemshopService;

    /**
     * Authentication service for customer identity verification
     * Used to secure access to private order data using DNI verification
     */
    authenticationService: AuthenticationService;

    /**
     * Logger instance for structured logging
     */
    logger: Logger;
  };

  /**
   * Optional metadata for the request
   */
  metadata?: Record<string, any>;

  /**
   * PII metadata extracted from user input
   * Maps placeholders (e.g., "[EMAIL_1]") to real values
   * Used internally by tool helper to resolve placeholders before execution
   */
  piiMetadata?: PIIMetadata;

  /**
   * Products returned by tools during execution
   * Used to extract product images for sending with the response
   * Can include products from Odoo or Nuvemshop
   */
  returnedProducts?: Array<OdooProductSimplified | NuvemshopProductSimplified>;
}
