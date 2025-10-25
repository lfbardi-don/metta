import { Injectable, Logger } from '@nestjs/common';
import { IncomingMessage, OutgoingMessage } from '../../common/interfaces';
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
}
