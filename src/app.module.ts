import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Core modules
import { PersistenceModule } from './modules/persistence/persistence.module';
import { GuardrailsModule } from './modules/guardrails/guardrails.module';

// Integration modules
import { IntegrationsModule } from './modules/integrations/integrations.module';

// Processing modules
import { QueueModule } from './modules/queue/queue.module';
import { AIModule } from './modules/ai/ai.module';

/**
 * AppModule - Root module for Metta Worker
 *
 * Metta is a SQS Worker, NOT an API server:
 * - AWS Lambda receives Chatwoot webhooks → sends to SQS
 * - This worker polls SQS → processes messages → sends responses to Chatwoot
 *
 * Module dependency flow:
 * 1. PersistenceModule (@Global) - Database access (audit only)
 * 2. GuardrailsModule - Input/output validation
 * 3. IntegrationsModule - Chatwoot (send only) + Odoo tools
 * 4. QueueModule - SQS consumer (ENTRY POINT)
 * 5. AIModule - AI agent with Odoo tools and guardrails
 *
 * Data flow:
 * Lambda → SQS → QueueModule → AI (+ Guardrails + Odoo) → Chatwoot
 *                                ↓
 *                           Persistence (audit)
 */
@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Core modules (foundation layer)
    PersistenceModule, // @Global - available everywhere
    GuardrailsModule,

    // Integration layer
    IntegrationsModule, // Chatwoot (send) + Odoo (tools)

    // Processing layer - ENTRY POINT
    QueueModule, // SQS consumer - starts processing on init
    AIModule, // AI agent orchestration
  ],
})
export class AppModule {}
