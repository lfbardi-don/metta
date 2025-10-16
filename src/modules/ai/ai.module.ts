import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    GuardrailsModule, // Import guardrails for validation
    IntegrationsModule, // Import integrations to access OdooService
  ],
  providers: [AIService],
  exports: [AIService],
})
export class AIModule {}
