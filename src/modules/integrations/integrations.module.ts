import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatwootService } from './chatwoot/chatwoot.service';
import { OdooService } from './odoo/odoo.service';
import { NuvemshopService } from './nuvemshop/nuvemshop.service';

/**
 * IntegrationsModule
 *
 * Provides integrations with external services:
 * - Chatwoot: Send messages (NOT receive webhooks - Lambda handles that)
 * - Odoo: Tools for AI agent to access product/order data
 * - Nuvemshop: Tools for AI agent to access product data from e-commerce platform
 *
 * Imports ConfigModule to provide environment variables to services.
 */
@Module({
  imports: [ConfigModule],
  providers: [ChatwootService, OdooService, NuvemshopService],
  exports: [ChatwootService, OdooService, NuvemshopService],
})
export class IntegrationsModule {}
