import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';

// TODO: Uncomment imports when implementing other modules
// import { AIModule } from '../ai/ai.module';
// import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * QueueModule - Entry point of the worker
 * Consumes messages from AWS SQS and processes them
 *
 * TODO: Add imports when implementing:
 * - AIModule (for processing messages)
 * - IntegrationsModule (for ChatwootService to send responses)
 * - GuardrailsModule (already global)
 * - PersistenceModule (already global)
 */
@Module({
  imports: [
    // TODO: Uncomment when implementing
    // AIModule,
    // IntegrationsModule,
  ],
  providers: [QueueService, QueueProcessor],
  exports: [QueueService, QueueProcessor],
})
export class QueueModule {}
