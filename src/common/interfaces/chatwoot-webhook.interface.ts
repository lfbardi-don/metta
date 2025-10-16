/**
 * Payload structure sent by AWS Lambda to SQS
 * This is the parsed Chatwoot webhook event
 */
export interface ChatwootWebhookPayload {
  event: string;
  id: number;
  content: string;
  created_at: string;
  message_type: 'incoming' | 'outgoing';
  private: boolean;
  content_type: string;
  content_attributes?: Record<string, any>;

  sender: {
    type: 'contact' | 'user';
    id: number;
    name: string;
    email?: string;
    phone_number?: string;
  };

  conversation: {
    id: number;
    display_id: number;
    inbox_id: number;
    status: string;
    contact_last_seen_at?: string;
  };

  account: {
    id: number;
    name: string;
  };

  inbox: {
    id: number;
    name: string;
  };
}

/**
 * SQS Message structure from AWS SDK
 */
export interface SQSMessagePayload {
  MessageId: string;
  ReceiptHandle: string;
  Body: string; // JSON string of ChatwootWebhookPayload
  Attributes?: {
    ApproximateReceiveCount?: string;
    SentTimestamp?: string;
    ApproximateFirstReceiveTimestamp?: string;
    [key: string]: string | undefined;
  };
  MessageAttributes?: Record<string, any>;
}
