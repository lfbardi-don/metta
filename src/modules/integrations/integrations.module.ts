import { Module } from '@nestjs/common';
import { ChatwootService } from './chatwoot/chatwoot.service';
import { ChatwootController } from './chatwoot/chatwoot.controller';
import { OdooService } from './odoo/odoo.service';

/**
 * IntegrationsModule
 *
 * Provides integrations with external services:
 * - Chatwoot: Send messages (NOT receive webhooks - Lambda handles that)
 * - Odoo: Tools for AI agent to access product/order data
 *
 * Note: ChatwootController is optional, only for local testing
 */
@Module({
  controllers: [ChatwootController], // Optional: only for testing
  providers: [ChatwootService, OdooService],
  exports: [ChatwootService, OdooService],
})
export class IntegrationsModule {}
