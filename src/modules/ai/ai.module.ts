import { Module } from '@nestjs/common';
import { WorkflowAIService } from './workflow-ai.service';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    GuardrailsModule, // Import guardrails for validation
    IntegrationsModule, // Import integrations (OdooService for future MCP refactor)
  ],
  providers: [WorkflowAIService],
  exports: [WorkflowAIService],
})
export class AIModule {}
