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
 * AppModule connects all modules together
 *
 * Module dependency flow:
 * 1. PersistenceModule (Global) - Database access for all modules
 * 2. GuardrailsModule - Input/output validation
 * 3. IntegrationsModule - Chatwoot webhooks + Odoo tools
 * 4. QueueModule - SQS message processing
 * 5. AIModule - AI agent with Odoo tools and guardrails
 *
 * Data flow:
 * Webhook → Queue → AI (+ Guardrails + Odoo) → Chatwoot
 *                   ↓
 *              Persistence (audit only)
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
    IntegrationsModule, // Chatwoot + Odoo

    // Processing layer
    QueueModule, // SQS processing
    AIModule, // AI agent orchestration
  ],
})
export class AppModule {}
