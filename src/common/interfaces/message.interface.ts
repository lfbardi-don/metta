import { ChatwootWebhookPayload } from './chatwoot-webhook.interface';

export interface IncomingMessage {
  messageId: string;
  conversationId: string;
  contactId: string;
  content: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface OutgoingMessage {
  conversationId: string;
  content: string;
  messageType: 'text' | 'interactive';
}

export interface MessageContext {
  conversationId: string;
  contactId: string;
  metadata: Record<string, any>;
}

/**
 * Helper function to convert Chatwoot webhook payload to IncomingMessage
 * Used by QueueProcessor to standardize messages from SQS
 */
export function fromChatwootWebhook(
  payload: ChatwootWebhookPayload,
): IncomingMessage {
  return {
    messageId: payload.id.toString(),
    conversationId: payload.conversation.id.toString(),
    contactId: payload.sender.id.toString(),
    content: payload.content,
    timestamp: new Date(payload.created_at),
    metadata: {
      event: payload.event,
      messageType: payload.message_type,
      contentType: payload.content_type,
      private: payload.private,
      sender: {
        type: payload.sender.type,
        name: payload.sender.name,
        email: payload.sender.email,
      },
      conversation: {
        displayId: payload.conversation.display_id,
        inboxId: payload.conversation.inbox_id,
        status: payload.conversation.status,
      },
      account: payload.account,
      inbox: payload.inbox,
    },
  };
}
