import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import {
  ChatwootWebhookPayload,
  fromChatwootWebhook,
} from '../../common/interfaces';

// TODO: Uncomment when implementing
// import { AIService } from '../ai/ai.service';
// import { ChatwootService } from '../integrations/chatwoot/chatwoot.service';
// import { PersistenceService } from '../persistence/persistence.service';

@Injectable()
export class QueueProcessor implements OnModuleInit {
  private readonly logger = new Logger(QueueProcessor.name);
  private isProcessing = false;

  constructor(
    private readonly queueService: QueueService,
    // TODO: Inject when implementing
    // private readonly aiService: AIService,
    // private readonly chatwootService: ChatwootService,
    // private readonly persistenceService: PersistenceService,
  ) {}

  async onModuleInit() {
    this.logger.log('Queue processor initialized');

    // Auto-start processing on module initialization
    const workerEnabled = process.env.WORKER_ENABLED !== 'false';
    if (workerEnabled) {
      this.startProcessing();
    } else {
      this.logger.warn('Worker is disabled (WORKER_ENABLED=false)');
    }
  }

  /**
   * Start the message processing loop
   * This runs continuously until the application is stopped
   */
  async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      this.logger.warn('Processing already started');
      return;
    }

    this.isProcessing = true;
    this.queueService.startPolling();
    this.logger.log('Started processing messages from queue');

    // Main processing loop
    this.processLoop();
  }

  /**
   * Stop processing messages
   * Called on graceful shutdown
   */
  stopProcessing(): void {
    this.isProcessing = false;
    this.queueService.stopPolling();
    this.logger.log('Stopped processing messages');
  }

  /**
   * Main processing loop
   * Continuously polls for messages and processes them
   */
  private async processLoop(): Promise<void> {
    while (this.isProcessing) {
      try {
        // Receive messages from SQS (long polling)
        const messages = await this.queueService.receiveMessages();

        // Process each message
        for (const message of messages) {
          if (!this.isProcessing) {
            break; // Stop processing if shutdown requested
          }

          await this.processMessage(message);
        }

        // Small delay if no messages (prevents tight loop)
        if (messages.length === 0) {
          await this.sleep(1000);
        }
      } catch (error) {
        this.logger.error('Error in processing loop', error);
        // Wait before retrying on error
        await this.sleep(5000);
      }
    }

    this.logger.log('Processing loop ended');
  }

  /**
   * Process a single SQS message
   */
  private async processMessage(sqsMessage: any): Promise<void> {
    const receiptHandle = sqsMessage.ReceiptHandle;
    let payload: ChatwootWebhookPayload | null = null;

    try {
      // 1. Parse message body
      payload =
        this.queueService.parseMessageBody<ChatwootWebhookPayload>(sqsMessage);

      if (!payload) {
        this.logger.error('Failed to parse message body');
        // Delete malformed message
        await this.queueService.deleteMessage(receiptHandle);
        return;
      }

      this.logger.log(
        `Processing message: ${payload.event} - Conv: ${payload.conversation.id}`,
      );

      // 2. Filter: Only process incoming messages
      if (payload.message_type !== 'incoming') {
        this.logger.debug(
          `Skipping ${payload.message_type} message (not incoming)`,
        );
        await this.queueService.deleteMessage(receiptHandle);
        return;
      }

      // 3. Filter: Only process message_created events
      if (payload.event !== 'message_created') {
        this.logger.debug(`Skipping ${payload.event} event`);
        await this.queueService.deleteMessage(receiptHandle);
        return;
      }

      // 4. Convert to IncomingMessage
      const incomingMessage = fromChatwootWebhook(payload);

      // 5. Process with AI (TODO: Implement)
      this.logger.log('TODO: Process with AI service');
      // const response = await this.aiService.processMessage(incomingMessage);

      // 6. Send response to Chatwoot (TODO: Implement)
      this.logger.log('TODO: Send response to Chatwoot');
      // await this.chatwootService.sendMessage({
      //   conversationId: incomingMessage.conversationId,
      //   content: response,
      //   messageType: 'text'
      // });

      // 7. Save to persistence (TODO: Implement)
      this.logger.log('TODO: Save to persistence');
      // await this.persistenceService.saveIncomingMessage(incomingMessage);

      // 8. Success! Delete message from queue
      await this.queueService.deleteMessage(receiptHandle);
      this.logger.log(
        `Successfully processed message ${payload.id} from conversation ${payload.conversation.id}`,
      );
    } catch (error) {
      this.logger.error('Error processing message', {
        error: error.message,
        stack: error.stack,
        payload: payload
          ? {
              id: payload.id,
              event: payload.event,
              conversationId: payload.conversation?.id,
            }
          : 'unknown',
      });

      // TODO: Implement retry logic
      // Check retry count from SQS attributes
      // If max retries exceeded, send to DLQ or log for manual review
      // Otherwise, let message become visible again (automatic retry)

      // For now, let SQS handle retry via visibility timeout
      this.logger.warn('Message will be retried automatically by SQS');
    }
  }

  /**
   * Get processing status
   */
  isRunning(): boolean {
    return this.isProcessing;
  }

  /**
   * Helper to sleep/delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
