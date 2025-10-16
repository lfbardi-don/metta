import { Injectable, Logger } from '@nestjs/common';
import { IncomingMessage, OutgoingMessage } from '../../common/interfaces';

/**
 * PersistenceService handles saving messages and conversation data
 * to the database for auditing purposes only.
 * This data is NOT used as context for the AI agent.
 */
@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name);

  /**
   * Save an incoming message to the database
   */
  async saveIncomingMessage(message: IncomingMessage): Promise<void> {
    // TODO: Implement Prisma save operation
    this.logger.log('Saving incoming message', {
      messageId: message.messageId,
      conversationId: message.conversationId,
    });
  }

  /**
   * Save an outgoing message to the database
   */
  async saveOutgoingMessage(message: OutgoingMessage): Promise<void> {
    // TODO: Implement Prisma save operation
    this.logger.log('Saving outgoing message', {
      conversationId: message.conversationId,
    });
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
