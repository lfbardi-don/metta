import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { OutgoingMessage } from '../../../common/interfaces';

@Injectable()
export class ChatwootService {
  private readonly logger = new Logger(ChatwootService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly accountId: string;

  constructor(private readonly configService: ConfigService) {
    const apiUrl = this.configService.get<string>('CHATWOOT_API_URL', '');
    const apiKey = this.configService.get<string>('CHATWOOT_API_KEY', '');
    this.accountId = this.configService.get<string>('CHATWOOT_ACCOUNT_ID', '');

    // Create axios instance with default config
    this.axiosInstance = axios.create({
      baseURL: apiUrl,
      headers: {
        api_access_token: apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });

    this.logger.log('Chatwoot service initialized');
  }

  /**
   * Send a message to a Chatwoot conversation
   */
  async sendMessage(message: OutgoingMessage): Promise<void> {
    try {
      const endpoint = `/api/v1/accounts/${this.accountId}/conversations/${message.conversationId}/messages`;

      this.logger.log(
        `Sending message to conversation ${message.conversationId}`,
      );

      const response = await this.axiosInstance.post(endpoint, {
        content: message.content,
        message_type: message.messageType === 'text' ? 'outgoing' : 'outgoing',
        private: false,
      });

      this.logger.log(
        `Message sent successfully. Message ID: ${response.data.id}`,
      );
    } catch (error) {
      this.logger.error('Failed to send message to Chatwoot', {
        conversationId: message.conversationId,
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(`Failed to send message to Chatwoot: ${error.message}`);
    }
  }

  /**
   * Set typing indicator status for a conversation
   * @param conversationId - The Chatwoot conversation ID
   * @param isTyping - true to show typing indicator, false to hide it
   */
  async setTypingStatus(
    conversationId: string,
    isTyping: boolean,
  ): Promise<void> {
    try {
      const endpoint = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/toggle_typing_status`;

      this.logger.debug(
        `Setting typing status to ${isTyping ? 'ON' : 'OFF'} for conversation ${conversationId}`,
      );

      await this.axiosInstance.post(endpoint, {
        typing_status: isTyping ? 'on' : 'off',
      });

      this.logger.debug(
        `Typing status set to ${isTyping ? 'ON' : 'OFF'} for conversation ${conversationId}`,
      );
    } catch (error) {
      // Fail silently - typing indicator is non-critical
      // Don't block message processing if typing API fails
      this.logger.warn(
        `Failed to set typing status for conversation ${conversationId}`,
        {
          isTyping,
          error: error.message,
          status: error.response?.status,
        },
      );
    }
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
