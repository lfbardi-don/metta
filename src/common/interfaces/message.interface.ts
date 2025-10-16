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
