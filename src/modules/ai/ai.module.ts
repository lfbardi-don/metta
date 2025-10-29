import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthenticationModule } from '../authentication/authentication.module';

@Module({
  imports: [
    GuardrailsModule, // Import guardrails for validation
    IntegrationsModule, // Import integrations to access OdooService + NuvemshopService
    AuthenticationModule, // Import authentication for DNI verification
  ],
  providers: [AIService],
  exports: [AIService],
})
export class AIModule {}
