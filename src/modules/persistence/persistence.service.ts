import { Injectable, Logger } from '@nestjs/common';
import {
  IncomingMessage,
  OutgoingMessage,
  ConversationState,
  ProductMention,
} from '../../common/interfaces';
import { PrismaService } from './prisma.service';

/**
 * PersistenceService handles saving and retrieving messages and conversation data.
 * This data serves dual purposes:
 * 1. Audit trail for compliance and debugging
 * 2. Source of truth for AI conversation history (stateless agent retrieves from DB)
 */
@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save an incoming message to the database
   */
  async saveIncomingMessage(message: IncomingMessage): Promise<void> {
    try {
      // Ensure conversation exists
      await this.prisma.conversation.upsert({
        where: { id: message.conversationId },
        update: {},
        create: {
          id: message.conversationId,
          metadata: message.metadata.conversation || {},
        },
      });

      // Create message record
      await this.prisma.message.create({
        data: {
          conversationId: message.conversationId,
          messageId: message.messageId,
          contactId: message.contactId,
          content: message.content,
          direction: 'incoming',
          messageType: 'text',
          metadata: message.metadata,
          createdAt: message.timestamp,
        },
      });

      this.logger.log('Saved incoming message', {
        messageId: message.messageId,
        conversationId: message.conversationId,
      });
    } catch (error) {
      this.logger.error('Failed to save incoming message', {
        error: error.message,
        messageId: message.messageId,
      });
      // Don't throw - persistence failure shouldn't block message processing
    }
  }

  /**
   * Save an outgoing message to the database
   */
  async saveOutgoingMessage(message: OutgoingMessage): Promise<void> {
    try {
      // Ensure conversation exists
      await this.prisma.conversation.upsert({
        where: { id: message.conversationId },
        update: {},
        create: {
          id: message.conversationId,
        },
      });

      // Create message record
      await this.prisma.message.create({
        data: {
          conversationId: message.conversationId,
          content: message.content,
          direction: 'outgoing',
          messageType: message.messageType,
          metadata: {},
        },
      });

      this.logger.log('Saved outgoing message', {
        conversationId: message.conversationId,
      });
    } catch (error) {
      this.logger.error('Failed to save outgoing message', {
        error: error.message,
        conversationId: message.conversationId,
      });
      // Don't throw - persistence failure shouldn't block message processing
    }
  }

  /**
   * Save conversation metadata
   */
  async saveConversationMetadata(
    conversationId: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    // TODO: Implement Prisma upsert operation
    this.logger.log('Saving conversation metadata', { conversationId });
  }

  /**
   * Get messages by conversation ID
   * Returns messages in chronological order for AI context
   *
   * @param conversationId - The conversation ID
   * @param options - Optional query options
   * @param options.excludeLatest - Exclude N most recent messages (useful to avoid duplication)
   */
  async getMessagesByConversation(
    conversationId: string,
    options?: { excludeLatest?: number },
  ): Promise<any[]> {
    try {
      const messages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          content: true,
          direction: true,
          createdAt: true,
        },
      });

      // Exclude latest N messages if requested
      const filteredMessages =
        options?.excludeLatest && options.excludeLatest > 0
          ? messages.slice(0, -options.excludeLatest)
          : messages;

      this.logger.log('Retrieved conversation history', {
        conversationId,
        totalMessages: messages.length,
        returnedMessages: filteredMessages.length,
        excludedLatest: options?.excludeLatest || 0,
      });

      return filteredMessages;
    } catch (error) {
      this.logger.error('Failed to retrieve conversation history', {
        error: error.message,
        conversationId,
      });
      // Return empty array on error - allows conversation to continue without history
      return [];
    }
  }

  /**
   * Get conversation metadata
   */
  async getConversationMetadata(conversationId: string): Promise<any> {
    // TODO: Implement Prisma query
    this.logger.log('Getting conversation metadata', { conversationId });
    return null;
  }

  /**
   * Get conversation state (product context tracking)
   * Returns null if no state exists or on error (to allow conversation to continue)
   *
   * @param conversationId - The conversation ID
   * @returns ConversationState or null
   */
  async getConversationState(
    conversationId: string,
  ): Promise<ConversationState | null> {
    try {
      const state = await this.prisma.conversationState.findUnique({
        where: { conversationId },
      });

      if (!state) return null;

      // Prisma automatically deserializes JSON - just need type assertion
      const products = (state.products || []) as unknown as ProductMention[];

      this.logger.log('Retrieved conversation state', {
        conversationId,
        hasState: true,
        productsCount: products.length,
      });

      return {
        ...state,
        products,
      };
    } catch (error) {
      this.logger.error('Failed to retrieve conversation state', {
        error: error.message,
        conversationId,
      });
      // Return null on error - allow conversation to continue without state
      return null;
    }
  }

  /**
   * Update conversation state with product mentions
   * Upserts state (creates if doesn't exist, updates if exists)
   * Merges new products with existing ones (deduplicates by productId)
   *
   * @param conversationId - The conversation ID
   * @param newProducts - Array of new product mentions to add
   */
  async updateConversationState(
    conversationId: string,
    newProducts: ProductMention[],
  ): Promise<void> {
    try {
      // First, check if state exists
      const existingState = await this.prisma.conversationState.findUnique({
        where: { conversationId },
      });

      // Merge products (deduplicate by productId)
      let mergedProducts: ProductMention[] = [];

      if (existingState?.products) {
        // Prisma automatically deserializes JSON - just need type assertion
        const existingProducts = (existingState.products || []) as unknown as ProductMention[];
        const existingIds = new Set(existingProducts.map((p) => p.productId));

        // Keep existing products and add only new ones
        mergedProducts = [
          ...existingProducts,
          ...newProducts.filter((p) => !existingIds.has(p.productId)),
        ];
      } else {
        mergedProducts = newProducts;
      }

      // Upsert state
      await this.prisma.conversationState.upsert({
        where: { conversationId },
        update: {
          products: mergedProducts as any, // Prisma Json type
        },
        create: {
          conversationId,
          products: mergedProducts as any, // Prisma Json type
        },
      });

      this.logger.log('Updated conversation state', {
        conversationId,
        newProductsCount: newProducts.length,
        totalProductsCount: mergedProducts.length,
        newProductIds: newProducts.map(p => p.productId),
      });
    } catch (error) {
      this.logger.error('Failed to update conversation state', {
        error: error.message,
        conversationId,
        newProductsCount: newProducts.length,
      });
      // Don't throw - state update failure shouldn't block message processing
    }
  }
}
