import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  OutgoingMessage,
  OutgoingMessageWithAttachments,
  MessageAttachment,
  OutgoingCardMessage,
} from '../../../common/interfaces';
import FormData from 'form-data';
import { Readable } from 'stream';

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
   * Send a message with attachments to a Chatwoot conversation
   * Downloads attachments from provided URLs and uploads them to Chatwoot
   *
   * NOTE: For product images, prefer using sendCardMessage() instead.
   * Cards are faster (no download/upload) and provide better UX with interactive buttons.
   * This method is kept for backward compatibility and non-product attachments.
   */
  async sendMessageWithAttachments(
    message: OutgoingMessageWithAttachments,
  ): Promise<void> {
    try {
      const endpoint = `/api/v1/accounts/${this.accountId}/conversations/${message.conversationId}/messages`;

      this.logger.log(
        `Sending message with ${message.attachments?.length || 0} attachment(s) to conversation ${message.conversationId}`,
      );

      // Create form data
      const form = new FormData();
      form.append('content', message.content);
      form.append('message_type', 'outgoing');
      form.append('private', 'false');

      // Download and attach each file
      if (message.attachments && message.attachments.length > 0) {
        for (const [index, attachment] of message.attachments.entries()) {
          try {
            const fileStream = await this.downloadAttachment(attachment);
            const filename =
              attachment.filename ||
              `attachment_${index}.${this.getFileExtension(attachment)}`;
            form.append('attachments[]', fileStream, { filename });

            this.logger.debug(
              `Added attachment ${index + 1}/${message.attachments.length}: ${filename}`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to download attachment ${index + 1}, skipping`,
              {
                url: attachment.url,
                error: error.message,
              },
            );
            // Continue with other attachments even if one fails
          }
        }
      }

      // Send request with multipart/form-data
      const apiUrl = this.configService.get<string>('CHATWOOT_API_URL', '');
      const apiKey = this.configService.get<string>('CHATWOOT_API_KEY', '');

      const response = await axios.post(`${apiUrl}${endpoint}`, form, {
        headers: {
          ...form.getHeaders(),
          api_access_token: apiKey,
        },
        timeout: 30000, // 30 second timeout for file uploads
      });

      this.logger.log(
        `Message with attachments sent successfully. Message ID: ${response.data.id}`,
      );
    } catch (error) {
      this.logger.error('Failed to send message with attachments to Chatwoot', {
        conversationId: message.conversationId,
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `Failed to send message with attachments to Chatwoot: ${error.message}`,
      );
    }
  }

  /**
   * Download an attachment from a URL and return it as a stream
   */
  private async downloadAttachment(
    attachment: MessageAttachment,
  ): Promise<Readable> {
    try {
      this.logger.debug(`Downloading attachment from: ${attachment.url}`);

      const response = await axios.get(attachment.url, {
        responseType: 'stream',
        timeout: 10000, // 10 second timeout for download
      });

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to download attachment from ${attachment.url}`,
        {
          error: error.message,
        },
      );
      throw new Error(`Failed to download attachment: ${error.message}`);
    }
  }

  /**
   * Get file extension based on attachment type
   */
  private getFileExtension(attachment: MessageAttachment): string {
    if (attachment.type === 'image') {
      return 'jpg'; // Default to jpg for images
    }
    return 'bin'; // Default for other files
  }

  /**
   * Send an interactive card message to a Chatwoot conversation
   * Cards support images via direct URLs (no download/upload required)
   * and can include action buttons
   */
  async sendCardMessage(message: OutgoingCardMessage): Promise<void> {
    try {
      const endpoint = `/api/v1/accounts/${this.accountId}/conversations/${message.conversationId}/messages`;

      this.logger.log(
        `Sending card message with ${message.content_attributes.items.length} card(s) to conversation ${message.conversationId}`,
      );

      const response = await this.axiosInstance.post(endpoint, {
        content: message.content,
        content_type: 'cards',
        content_attributes: {
          items: message.content_attributes.items.map((card) => ({
            media_url: card.media_url,
            title: card.title,
            description: card.description,
            actions: card.actions || [],
          })),
        },
        message_type: 'outgoing',
        private: false,
      });

      this.logger.log(
        `Card message sent successfully. Message ID: ${response.data.id}`,
      );
    } catch (error) {
      this.logger.error('Failed to send card message to Chatwoot', {
        conversationId: message.conversationId,
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `Failed to send card message to Chatwoot: ${error.message}`,
      );
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
   * Horário comercial de atendimento humano
   * Lunes a Viernes 09:00 - 17:00 (Argentina)
   */
  isWithinBusinessHours(): boolean {
    const now = new Date();
    const argentinaTime = new Date(
      now.toLocaleString('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
      }),
    );

    const dayOfWeek = argentinaTime.getDay();
    const hour = argentinaTime.getHours();

    // 0 = Domingo, 6 = Sábado
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // 09:00 - 17:00
    return hour >= 9 && hour < 17;
  }

  /**
   * Assign a conversation to a specific agent and add labels for human handoff
   * Only works during business hours (9-17 L-V Argentina)
   *
   * @param conversationId - The Chatwoot conversation ID
   * @param agentId - The agent ID to assign (optional, uses CHATWOOT_HANDOFF_AGENT_ID if not provided)
   * @param labels - The labels to add (defaults to ['requiere_atencion', 'cambio'])
   * @returns Object with success status and whether it was within business hours
   */
  async assignToAgentWithLabel(
    conversationId: string,
    agentId?: number,
    labels?: string[],
  ): Promise<{
    success: boolean;
    withinBusinessHours: boolean;
    message: string;
  }> {
    // Check business hours first
    const withinBusinessHours = this.isWithinBusinessHours();

    if (!withinBusinessHours) {
      this.logger.log(
        '[HANDOFF] Outside business hours - handoff not executed',
        {
          conversationId,
          currentTimeArgentina: new Date().toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
          }),
        },
      );

      return {
        success: false,
        withinBusinessHours: false,
        message: 'Handoff skipped - outside business hours (9-17 L-V)',
      };
    }

    const handoffAgentId =
      agentId ||
      this.configService.get<number>('CHATWOOT_HANDOFF_AGENT_ID', 150903);

    const handoffLabels = labels || ['requiere_atencion'];

    const apiUrl = this.configService.get<string>('CHATWOOT_API_URL', '');

    try {
      // 1. Assign to agent
      const assignEndpoint = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/assignments`;

      this.logger.log('[HANDOFF] Assigning conversation to agent', {
        conversationId,
        agentId: handoffAgentId,
        labels: handoffLabels,
        fullUrl: `${apiUrl}${assignEndpoint}`,
      });

      await this.axiosInstance.post(assignEndpoint, {
        assignee_id: handoffAgentId,
      });

      this.logger.log('[HANDOFF] Agent assignment successful', {
        conversationId,
        agentId: handoffAgentId,
      });

      // 2. Add labels
      const labelEndpoint = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/labels`;

      await this.axiosInstance.post(labelEndpoint, {
        labels: handoffLabels,
      });

      this.logger.log('[HANDOFF] Labels added successfully', {
        conversationId,
        labels: handoffLabels,
      });

      return {
        success: true,
        withinBusinessHours: true,
        message: `Assigned to agent ${handoffAgentId} with labels ${handoffLabels.join(', ')}`,
      };
    } catch (error) {
      this.logger.error('[HANDOFF] Failed to assign conversation', {
        conversationId,
        agentId: handoffAgentId,
        labels: handoffLabels,
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      throw new Error(`Failed to assign conversation: ${error.message}`);
    }
  }

  /**
   * @deprecated Use assignToAgentWithLabel instead
   * Assign a conversation to a team for human handoff
   */
  async assignToTeam(conversationId: string, teamId?: number): Promise<void> {
    const result = await this.assignToAgentWithLabel(conversationId);
    if (!result.success && result.withinBusinessHours) {
      throw new Error(result.message);
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
