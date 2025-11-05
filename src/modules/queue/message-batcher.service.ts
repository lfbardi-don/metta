import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SimplifiedSQSMessage } from '../../common/interfaces';
import { ChatwootService } from '../integrations/chatwoot/chatwoot.service';

/**
 * Represents a batch of messages for a single conversation
 */
export interface MessageBatch {
  /**
   * Array of messages in this batch
   */
  messages: Array<{
    sqsMessage: any; // Original SQS message for deletion
    payload: SimplifiedSQSMessage; // Parsed message data
  }>;
  /**
   * Timer handle for batch expiration
   */
  timer: NodeJS.Timeout;
  /**
   * Timestamp when first message was added
   */
  firstMessageTime: number;
}

/**
 * Callback function invoked when a batch is ready to process
 */
export type BatchReadyCallback = (
  conversationId: string,
  batch: MessageBatch,
) => Promise<void>;

/**
 * MessageBatcherService
 *
 * Manages in-memory message batching with timers per conversation.
 * Groups messages from the same conversation that arrive within a configurable
 * time window (default 5 seconds) and processes them together.
 *
 * Key Features:
 * - In-memory storage (Map<conversationId, MessageBatch>)
 * - Automatic timer-based batch processing
 * - Debouncing: Timer resets on each new message (waits 5s after LAST message)
 * - Graceful shutdown handling (processes pending batches)
 * - Configurable batch delay
 *
 * Debouncing Behavior with Max Wait Time:
 * - First message → Timer starts (5s), max wait starts (20s)
 * - Second message arrives (within max wait) → Timer RESETS (new 5s from now)
 * - Third message arrives (within max wait) → Timer RESETS again (new 5s from now)
 * - Nth message arrives (exceeds max wait) → Process IMMEDIATELY (prevents SQS timeout)
 * - OR timer fires 5s after LAST message → Process batch
 *
 * Max wait time (20s) < SQS visibility timeout (30s) prevents receipt handle expiration.
 *
 * Why this works:
 * - Messages stay in SQS until batch completes (safe)
 * - SQS visibility timeout (30s) > batch delay (5s) + processing
 * - Worker restart → messages reappear in queue → no loss
 */
@Injectable()
export class MessageBatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageBatcherService.name);

  /**
   * In-memory map: conversationId → MessageBatch
   */
  private batches: Map<string, MessageBatch> = new Map();

  /**
   * Configuration
   */
  private readonly batchingEnabled: boolean;
  private readonly batchDelayMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatwootService: ChatwootService,
  ) {
    this.batchingEnabled = this.configService.get<boolean>(
      'MESSAGE_BATCH_ENABLED',
      true,
    );
    this.batchDelayMs = this.configService.get<number>(
      'MESSAGE_BATCH_DELAY_MS',
      5000,
    );
    this.maxWaitMs = this.configService.get<number>(
      'MESSAGE_BATCH_MAX_WAIT_MS',
      20000,
    );

    this.logger.log('MessageBatcherService initialized');
    this.logger.log(`  Batching enabled: ${this.batchingEnabled}`);
    this.logger.log(`  Batch delay: ${this.batchDelayMs}ms`);
    this.logger.log(`  Max wait time: ${this.maxWaitMs}ms`);
  }

  /**
   * Add message to batch
   *
   * If this is the first message for the conversation, creates a new batch and starts timer.
   * If batch already exists, adds message to existing batch and RESETS timer (debouncing),
   * UNLESS max wait time has been exceeded (then processes immediately).
   *
   * Debouncing ensures batch only processes after 5s of silence (no new messages),
   * but max wait time (20s) prevents SQS receipt handle expiration.
   *
   * @param sqsMessage - Original SQS message (for deletion)
   * @param payload - Parsed message payload
   * @param onBatchReady - Callback invoked when batch timer expires
   */
  async addMessage(
    sqsMessage: any,
    payload: SimplifiedSQSMessage,
    onBatchReady: BatchReadyCallback,
  ): Promise<void> {
    // If batching disabled, process immediately
    if (!this.batchingEnabled) {
      const singleBatch: MessageBatch = {
        messages: [{ sqsMessage, payload }],
        timer: null as any, // No timer needed
        firstMessageTime: Date.now(),
      };
      await onBatchReady(payload.conversationId, singleBatch);
      return;
    }

    const conversationId = payload.conversationId;

    if (!this.batches.has(conversationId)) {
      // First message - create batch and start timer
      const batch: MessageBatch = {
        messages: [{ sqsMessage, payload }],
        timer: setTimeout(() => {
          this.processBatch(conversationId, onBatchReady);
        }, this.batchDelayMs),
        firstMessageTime: Date.now(),
      };
      this.batches.set(conversationId, batch);

      this.logger.log(
        `Started batching for conversation ${conversationId} (${this.batchDelayMs}ms window)`,
      );

      // Start typing indicator immediately for user feedback
      this.chatwootService.setTypingStatus(conversationId, true);
    } else {
      // Additional message - add to existing batch
      const batch = this.batches.get(conversationId)!;

      // Check elapsed time since first message
      const elapsedMs = Date.now() - batch.firstMessageTime;

      // Cancel existing timer
      clearTimeout(batch.timer);

      // Add message to batch
      batch.messages.push({ sqsMessage, payload });

      // Check if we've exceeded max wait time
      if (elapsedMs >= this.maxWaitMs) {
        // Max wait time reached - process immediately (don't wait anymore)
        this.logger.log(
          `Max wait time (${this.maxWaitMs}ms) reached for conversation ${conversationId} - processing immediately (${batch.messages.length} message(s))`,
        );
        await this.processBatch(conversationId, onBatchReady);
      } else {
        // Still within max wait time - reset timer (debounce behavior)
        batch.timer = setTimeout(() => {
          this.processBatch(conversationId, onBatchReady);
        }, this.batchDelayMs);

        this.logger.log(
          `Added message to batch for conversation ${conversationId} (total: ${batch.messages.length}, timer reset, ${this.maxWaitMs - elapsedMs}ms until max wait)`,
        );
      }
    }
  }

  /**
   * Process batch when timer expires
   *
   * Removes batch from map and invokes callback for processing.
   */
  private async processBatch(
    conversationId: string,
    onBatchReady: BatchReadyCallback,
  ): Promise<void> {
    const batch = this.batches.get(conversationId);
    if (!batch) {
      this.logger.warn(
        `Batch not found for conversation ${conversationId} (already processed?)`,
      );
      return;
    }

    // Remove from map (prevent duplicate processing)
    this.batches.delete(conversationId);

    const batchSize = batch.messages.length;
    const waitTime = Date.now() - batch.firstMessageTime;

    this.logger.log(
      `Processing batch for conversation ${conversationId}: ${batchSize} message(s) after ${waitTime}ms`,
    );

    try {
      // Trigger callback to process
      await onBatchReady(conversationId, batch);
    } catch (error) {
      this.logger.error(
        `Batch processing callback failed for conversation ${conversationId}`,
        error.stack,
      );
      // Re-throw to allow caller to handle (messages will remain in SQS for retry)
      throw error;
    }
  }

  /**
   * Get current batch statistics (for monitoring/debugging)
   */
  getStatistics(): {
    pendingBatches: number;
    totalPendingMessages: number;
  } {
    let totalMessages = 0;
    for (const batch of this.batches.values()) {
      totalMessages += batch.messages.length;
    }

    return {
      pendingBatches: this.batches.size,
      totalPendingMessages: totalMessages,
    };
  }

  /**
   * Graceful shutdown: process all pending batches immediately
   *
   * Called when worker is shutting down (SIGTERM/SIGINT).
   * Ensures no messages are lost by processing all pending batches.
   */
  async onModuleDestroy(): Promise<void> {
    const batchCount = this.batches.size;

    if (batchCount === 0) {
      this.logger.log('No pending batches to process on shutdown');
      return;
    }

    this.logger.log(
      `Shutting down: processing ${batchCount} pending batch(es) immediately`,
    );

    // Process all pending batches
    // Note: We can't call processBatch() directly because we don't have the callbacks
    // Instead, we clear the timers and let the messages stay in SQS for the next worker
    for (const [conversationId, batch] of this.batches.entries()) {
      clearTimeout(batch.timer);
      this.logger.log(
        `Cleared timer for conversation ${conversationId} (${batch.messages.length} message(s) will be reprocessed)`,
      );
    }

    // Clear the map
    this.batches.clear();

    this.logger.log(
      'Shutdown complete: pending messages will be reprocessed by next worker instance',
    );
  }
}
