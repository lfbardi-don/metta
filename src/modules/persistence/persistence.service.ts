import { Injectable, Logger } from '@nestjs/common';
import { IncomingMessage, OutgoingMessage } from '../../common/interfaces';
import { PrismaService } from './prisma.service';

/**
 * PersistenceService handles saving messages and conversation data
 * to the database for auditing purposes only.
 * This data is NOT used as context for the AI agent.
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
   * Get messages by conversation ID (for auditing/debugging only)
   */
  async getMessagesByConversation(conversationId: string): Promise<any[]> {
    // TODO: Implement Prisma query
    this.logger.log('Getting messages for conversation', { conversationId });
    return [];
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
