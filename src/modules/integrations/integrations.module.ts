import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatwootService } from './chatwoot/chatwoot.service';
import { OdooService } from './odoo/odoo.service';
import { NuvemshopService } from './nuvemshop/nuvemshop.service';
import { KnowledgeService } from './knowledge/knowledge.service';

/**
 * IntegrationsModule
 *
 * Provides integrations with external services:
 * - Chatwoot: Send messages (NOT receive webhooks - Lambda handles that)
 * - Odoo: Tools for AI agent to access product/order data
 * - Nuvemshop: Tools for AI agent to access product data from e-commerce platform
 * - Knowledge: Tools for AI agent to access FAQs, policies, and business information
 *
 * Imports ConfigModule to provide environment variables to services.
 */
@Module({
  imports: [ConfigModule],
  providers: [ChatwootService, OdooService, NuvemshopService, KnowledgeService],
  exports: [ChatwootService, OdooService, NuvemshopService, KnowledgeService],
})
export class IntegrationsModule {}
