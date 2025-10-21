import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatwootService } from './chatwoot/chatwoot.service';
import { OdooService } from './odoo/odoo.service';

/**
 * IntegrationsModule
 *
 * Provides integrations with external services:
 * - Chatwoot: Send messages (NOT receive webhooks - Lambda handles that)
 * - Odoo: Tools for AI agent to access product/order data
 *
 * Imports ConfigModule to provide environment variables to services.
 */
@Module({
  imports: [ConfigModule],
  providers: [ChatwootService, OdooService],
  exports: [ChatwootService, OdooService],
})
export class IntegrationsModule {}
