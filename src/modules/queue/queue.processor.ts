import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import {
  SimplifiedSQSMessage,
  fromSimplifiedSQS,
  IncomingMessage,
} from '../../common/interfaces';
import { AIService } from '../ai/ai.service';
import { ChatwootService } from '../integrations/chatwoot/chatwoot.service';
import { PersistenceService } from '../persistence/persistence.service';
import { MessageBatcherService, MessageBatch } from './message-batcher.service';

@Injectable()
export class QueueProcessor implements OnModuleInit {
  private readonly logger = new Logger(QueueProcessor.name);
  private isProcessing = false;

  constructor(
    private readonly queueService: QueueService,
    private readonly aiService: AIService,
    private readonly chatwootService: ChatwootService,
    private readonly persistenceService: PersistenceService,
    private readonly messageBatcher: MessageBatcherService,
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
   *
   * Batching Strategy:
   * - If multiple messages from same conversation arrive in same SQS poll → Process immediately as batch
   * - If single message arrives → Use time-based batcher (5s window for messages arriving later)
   */
  private async processLoop(): Promise<void> {
    while (this.isProcessing) {
      try {
        // Receive messages from SQS (long polling, up to 10 messages)
        const messages = await this.queueService.receiveMessages();

        if (messages.length === 0) {
          // Small delay if no messages (prevents tight loop)
          await this.sleep(1000);
          continue;
        }

        // Group messages by conversationId for intelligent batching
        const messagesByConversation = this.groupMessagesByConversation(messages);

        // Process each conversation's messages
        for (const [
          conversationId,
          conversationMessages,
        ] of messagesByConversation.entries()) {
          if (!this.isProcessing) {
            break; // Stop processing if shutdown requested
          }

          if (conversationMessages.length > 1) {
            // Multiple messages from same conversation in same poll
            // → Process immediately as batch (no waiting)
            this.logger.log(
              `Received ${conversationMessages.length} messages for conversation ${conversationId} in same poll - processing immediately`,
            );
            await this.processBatchImmediately(
              conversationId,
              conversationMessages,
            );
          } else {
            // Single message → Use time-based batcher
            // (allows batching with messages that arrive in next 5 seconds)
            const { sqsMessage, payload } = conversationMessages[0];
            await this.processMessage(sqsMessage);
          }
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
   * Group SQS messages by conversationId
   * Returns Map<conversationId, array of { sqsMessage, payload }>
   */
  private groupMessagesByConversation(
    sqsMessages: any[],
  ): Map<string, Array<{ sqsMessage: any; payload: SimplifiedSQSMessage }>> {
    const grouped = new Map<
      string,
      Array<{ sqsMessage: any; payload: SimplifiedSQSMessage }>
    >();

    for (const sqsMessage of sqsMessages) {
      try {
        // Parse message payload
        const payload =
          this.queueService.parseMessageBody<SimplifiedSQSMessage>(sqsMessage);

        if (!payload || !payload.conversationId) {
          this.logger.warn('Skipping message with missing conversationId', {
            messageId: payload?.messageId || 'unknown',
          });
          // Delete malformed message immediately
          this.queueService
            .deleteMessage(sqsMessage.ReceiptHandle)
            .catch((err) =>
              this.logger.error('Failed to delete malformed message', err),
            );
          continue;
        }

        // Add to conversation group
        if (!grouped.has(payload.conversationId)) {
          grouped.set(payload.conversationId, []);
        }

        grouped.get(payload.conversationId)!.push({ sqsMessage, payload });
      } catch (error) {
        this.logger.error('Error parsing message in grouping', {
          error: error.message,
        });
        // Continue to next message
      }
    }

    return grouped;
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

      // 2. Add message to batch (will be processed when timer expires)
      await this.messageBatcher.addMessage(
        sqsMessage,
        payload,
        async (conversationId, batch) => {
          await this.processBatch(conversationId, batch);
        },
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
   * Process multiple messages from same conversation immediately
   * (no waiting - they arrived in the same SQS poll)
   *
   * This bypasses the time-based MessageBatcherService and processes immediately.
   */
  private async processBatchImmediately(
    conversationId: string,
    messages: Array<{ sqsMessage: any; payload: SimplifiedSQSMessage }>,
  ): Promise<void> {
    const batchSize = messages.length;
    this.logger.log(
      `Processing immediate batch of ${batchSize} message(s) for conversation ${conversationId}`,
    );

    // Create synthetic MessageBatch structure
    const batch: MessageBatch = {
      messages,
      timer: null as any, // No timer for immediate batches
      firstMessageTime: Date.now(),
    };

    // Use existing processBatch logic
    await this.processBatch(conversationId, batch);
  }

  /**
   * Process a batch of messages together
   *
   * Called either:
   * 1. When batch timer expires (from MessageBatcherService)
   * 2. Immediately when multiple messages arrive in same SQS poll (from processBatchImmediately)
   */
  private async processBatch(
    conversationId: string,
    batch: MessageBatch,
  ): Promise<void> {
    const batchSize = batch.messages.length;
    this.logger.log(
      `Processing batch of ${batchSize} message(s) for conversation ${conversationId}`,
    );

    try {
      // 1. Convert all messages to IncomingMessage format
      const incomingMessages: IncomingMessage[] = batch.messages.map((msg) =>
        fromSimplifiedSQS(msg.payload),
      );

      // 2. Save all incoming messages to persistence (audit log)
      for (const incomingMessage of incomingMessages) {
        await this.persistenceService.saveIncomingMessage(incomingMessage);
      }

      // 3. Process ALL messages together with AI
      this.logger.log('Processing batch with AI service');
      const response = await this.aiService.processMessages(incomingMessages);

      // 4. Send single response to Chatwoot
      this.logger.log('Sending batch response to Chatwoot');
      const outgoingMessage = {
        conversationId,
        content: response,
        messageType: 'text' as const,
      };
      await this.chatwootService.sendMessage(outgoingMessage);

      // 5. Save outgoing message to persistence (audit log)
      await this.persistenceService.saveOutgoingMessage(outgoingMessage);

      // 6. Delete ALL SQS messages in batch (only after successful processing)
      for (const { sqsMessage } of batch.messages) {
        await this.queueService.deleteMessage(sqsMessage.ReceiptHandle);
      }

      this.logger.log(
        `Successfully processed batch of ${batchSize} message(s) for conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error('Error processing batch', {
        error: error.message,
        stack: error.stack,
        conversationId,
        batchSize,
      });

      // Don't delete messages from SQS - they will be retried
      // SQS visibility timeout will expire and messages become available again
      this.logger.warn(
        'Batch processing failed - messages will be retried by SQS',
      );

      // Re-throw to allow caller to handle
      throw error;
    } finally {
      // Stop typing indicator when processing completes (success or failure)
      await this.chatwootService.setTypingStatus(conversationId, false);
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
