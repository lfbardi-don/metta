/**
 * SQS Queue configuration
 */
export interface QueueConfig {
  queueUrl: string;
  region: string;
  maxNumberOfMessages: number;
  waitTimeSeconds: number; // Long polling
  visibilityTimeout: number;
  maxRetries: number;
}

/**
 * SQS Processing result
 */
export interface ProcessingResult {
  success: boolean;
  messageId: string;
  error?: Error;
  shouldRetry: boolean;
}
