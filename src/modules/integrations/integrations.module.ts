import { Module } from '@nestjs/common';
import { ChatwootService } from './chatwoot/chatwoot.service';
import { ChatwootController } from './chatwoot/chatwoot.controller';
import { OdooService } from './odoo/odoo.service';

@Module({
  controllers: [ChatwootController],
  providers: [ChatwootService, OdooService],
  exports: [ChatwootService, OdooService],
})
export class IntegrationsModule {}
