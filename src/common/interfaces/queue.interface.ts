export interface QueueMessage {
  id: string;
  type: 'webhook' | 'response' | 'error';
  payload: any;
  timestamp: Date;
  retryCount: number;
}

export interface QueueConfig {
  queueUrl: string;
  region: string;
  maxRetries: number;
  visibilityTimeout: number;
}
