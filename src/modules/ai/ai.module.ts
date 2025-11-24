import { Module } from '@nestjs/common';
import { WorkflowAIService } from './workflow-ai.service';
import { ProductPresentationService } from './product-presentation.service';
import { OrderPresentationService } from './order-presentation.service';
import { ProductExtractionService } from './services/product-extraction.service';
import { UseCaseDetectionService } from './services/use-case-detection.service';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    GuardrailsModule, // Import guardrails for validation
    IntegrationsModule, // Import integrations (OdooService for future MCP refactor)
  ],
  providers: [
    WorkflowAIService,
    ProductPresentationService,
    OrderPresentationService,
    ProductExtractionService,
    UseCaseDetectionService, // Use case tracking service
  ],
  exports: [
    WorkflowAIService,
    ProductPresentationService,
    OrderPresentationService,
    ProductExtractionService,
  ],
})
export class AIModule {}
