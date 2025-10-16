import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { SQSMessagePayload } from '../../common/interfaces';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private sqsClient: SQSClient;
  private queueUrl: string;
  private isRunning = false;
  private pollingInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly maxNumberOfMessages: number;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeout: number;

  constructor(private readonly configService: ConfigService) {
    // Initialize SQS Client
    this.sqsClient = new SQSClient({
      region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
          '',
        ),
      },
    });

    this.queueUrl = this.configService.get<string>('SQS_QUEUE_URL', '');
    this.maxNumberOfMessages = this.configService.get<number>(
      'SQS_MAX_MESSAGES',
      10,
    );
    this.waitTimeSeconds = this.configService.get<number>(
      'SQS_WAIT_TIME_SECONDS',
      20,
    );
    this.visibilityTimeout = this.configService.get<number>(
      'SQS_VISIBILITY_TIMEOUT',
      30,
    );
  }

  async onModuleInit() {
    this.logger.log('Queue service initialized');
    this.logger.log(`Queue URL: ${this.queueUrl}`);
    this.logger.log(`Max messages per poll: ${this.maxNumberOfMessages}`);
    this.logger.log(`Wait time: ${this.waitTimeSeconds}s`);
  }

  async onModuleDestroy() {
    this.stopPolling();
    this.logger.log('Queue service destroyed');
  }

  /**
   * Start polling for messages
   * Called by QueueProcessor
   */
  startPolling(): void {
    if (this.isRunning) {
      this.logger.warn('Polling already running');
      return;
    }

    this.isRunning = true;
    this.logger.log('Started polling SQS queue');
  }

  /**
   * Stop polling for messages
   * Called on graceful shutdown
   */
  stopPolling(): void {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.logger.log('Stopped polling SQS queue');
  }

  /**
   * Check if queue service is running
   */
  isPolling(): boolean {
    return this.isRunning;
  }

  /**
   * Receive messages from SQS queue
   * Uses long polling for efficiency
   */
  async receiveMessages(): Promise<Message[]> {
    if (!this.isRunning) {
      return [];
    }

    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.maxNumberOfMessages,
        WaitTimeSeconds: this.waitTimeSeconds,
        VisibilityTimeout: this.visibilityTimeout,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
      });

      const response = await this.sqsClient.send(command);

      if (response.Messages && response.Messages.length > 0) {
        this.logger.log(`Received ${response.Messages.length} message(s)`);
      }

      return response.Messages || [];
    } catch (error) {
      this.logger.error('Error receiving messages from SQS', error);
      // Wait a bit before next poll on error
      await this.sleep(5000);
      return [];
    }
  }

  /**
   * Delete message from queue after successful processing
   */
  async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.sqsClient.send(command);
      this.logger.debug('Message deleted from queue');
    } catch (error) {
      this.logger.error('Error deleting message from SQS', error);
      throw error;
    }
  }

  /**
   * Change message visibility timeout
   * Used when processing takes longer or needs retry
   */
  async changeMessageVisibility(
    receiptHandle: string,
    timeout: number,
  ): Promise<void> {
    try {
      const command = new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: timeout,
      });

      await this.sqsClient.send(command);
      this.logger.debug(`Message visibility changed to ${timeout} seconds`);
    } catch (error) {
      this.logger.error('Error changing message visibility', error);
      throw error;
    }
  }

  /**
   * Parse SQS message body to ChatwootWebhookPayload
   */
  parseMessageBody<T = any>(message: Message): T | null {
    try {
      if (!message.Body) {
        this.logger.warn('Message has no body');
        return null;
      }

      return JSON.parse(message.Body) as T;
    } catch (error) {
      this.logger.error('Error parsing message body', error);
      return null;
    }
  }

  /**
   * Helper to sleep/delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
