import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatwootService } from './chatwoot/chatwoot.service';
import { OdooService } from './odoo/odoo.service';

/**
 * IntegrationsModule
 *
 * Provides integrations with external services:
 * - Chatwoot: Send messages (NOT receive webhooks - Lambda handles that)
 * - Odoo: ERP integration (pending MCP refactor)
 *
 * Note: Nuvemshop and Knowledge are now handled by MCP servers (Cloudflare Workers)
 *
 * Imports ConfigModule to provide environment variables to services.
 */
@Module({
  imports: [ConfigModule],
  providers: [ChatwootService, OdooService],
  exports: [ChatwootService, OdooService],
})
export class IntegrationsModule {}
