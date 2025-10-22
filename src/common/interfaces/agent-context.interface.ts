import { Logger } from '@nestjs/common';
import { OdooService } from '../../modules/integrations/odoo/odoo.service';
import { PIIMetadata } from './guardrail.interface';

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
}
