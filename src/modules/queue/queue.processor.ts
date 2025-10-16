import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import {
  SimplifiedSQSMessage,
  fromSimplifiedSQS,
} from '../../common/interfaces';
import { AIService } from '../ai/ai.service';
import { ChatwootService } from '../integrations/chatwoot/chatwoot.service';
import { PersistenceService } from '../persistence/persistence.service';

@Injectable()
export class QueueProcessor implements OnModuleInit {
  private readonly logger = new Logger(QueueProcessor.name);
  private isProcessing = false;

  constructor(
    private readonly queueService: QueueService,
    private readonly aiService: AIService,
    private readonly chatwootService: ChatwootService,
    private readonly persistenceService: PersistenceService,
  ) {}

  async onModuleInit() {
    this.logger.log('Queue processor initialized');

    // Auto-start processing on module initialization
    this.startProcessing();
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
    let payload: SimplifiedSQSMessage | null = null;

    try {
      // 1. Parse message body
      payload =
        this.queueService.parseMessageBody<SimplifiedSQSMessage>(sqsMessage);

      if (!payload) {
        this.logger.error('Failed to parse message body');
        // Delete malformed message
        await this.queueService.deleteMessage(receiptHandle);
        return;
      }

      // Validate required fields
      if (!payload.messageId || !payload.conversationId || !payload.userText) {
        this.logger.error('Payload missing required fields', {
          payloadKeys: Object.keys(payload),
          payload: payload,
        });
        // Delete malformed message
        await this.queueService.deleteMessage(receiptHandle);
        return;
      }

      this.logger.log(
        `Processing message ${payload.messageId} from conversation ${payload.conversationId}`,
      );

      // 2. Convert to IncomingMessage
      const incomingMessage = fromSimplifiedSQS(payload);

      // 3. Save incoming message to persistence (audit log)
      await this.persistenceService.saveIncomingMessage(incomingMessage);

      // 4. Process with AI
      this.logger.log('Processing with AI service');
      const response = await this.aiService.processMessage(incomingMessage);

      // 5. Send response to Chatwoot
      this.logger.log('Sending response to Chatwoot');
      const outgoingMessage = {
        conversationId: incomingMessage.conversationId,
        content: response,
        messageType: 'text' as const,
      };
      await this.chatwootService.sendMessage(outgoingMessage);

      // 6. Save outgoing message to persistence (audit log)
      await this.persistenceService.saveOutgoingMessage(outgoingMessage);

      // 7. Success! Delete message from queue
      await this.queueService.deleteMessage(receiptHandle);
      this.logger.log(
        `Successfully processed message ${payload.messageId} from conversation ${payload.conversationId}`,
      );
    } catch (error) {
      this.logger.error('Error processing message', {
        error: error.message,
        stack: error.stack,
        payload: payload
          ? {
              messageId: payload.messageId,
              conversationId: payload.conversationId,
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
