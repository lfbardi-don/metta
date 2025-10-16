import { Injectable, Logger } from '@nestjs/common';
import { OutgoingMessage } from '../../../common/interfaces';

@Injectable()
export class ChatwootService {
  private readonly logger = new Logger(ChatwootService.name);

  /**
   * Send a message to a Chatwoot conversation
   */
  async sendMessage(message: OutgoingMessage): Promise<void> {
    // TODO: Implement Chatwoot API call to send message
    throw new Error('Not implemented');
  }

  /**
   * Get conversation details from Chatwoot
   */
  async getConversation(conversationId: string): Promise<any> {
    // TODO: Implement Chatwoot API call to get conversation
    throw new Error('Not implemented');
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(conversationId: string): Promise<void> {
    // TODO: Implement Chatwoot API call to mark as read
    throw new Error('Not implemented');
  }

  /**
   * Update conversation status
   */
  async updateConversationStatus(
    conversationId: string,
    status: 'open' | 'resolved' | 'pending',
  ): Promise<void> {
    // TODO: Implement Chatwoot API call to update status
    throw new Error('Not implemented');
  }
}
