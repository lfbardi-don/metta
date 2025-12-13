import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';
import { MessageBatcherService } from './message-batcher.service';
import { MessageProcessorService } from './services/message-processor.service';
import { AIModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * QueueModule - Entry point of the worker
 * Consumes messages from AWS SQS and processes them
 *
 * Imports:
 * - AIModule (for processing messages)
 * - IntegrationsModule (for ChatwootService to send responses)
 * - GuardrailsModule (already global)
 * - PersistenceModule (already global)
 *
 * Providers:
 * - QueueService (SQS polling)
 * - MessageBatcherService (batching logic)
 * - QueueProcessor (main processing loop)
 * - MessageProcessorService
 */
@Module({
  imports: [AIModule, IntegrationsModule],
  providers: [
    QueueService,
    MessageBatcherService,
    QueueProcessor,
    MessageProcessorService,
  ],
  exports: [QueueService, QueueProcessor, MessageProcessorService],
})
export class QueueModule {}
