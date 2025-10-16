import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { ChatwootService } from './chatwoot.service';

/**
 * ChatwootController - OPTIONAL/TEST ONLY
 *
 * This controller is NOT used in production.
 * Production webhooks are received by AWS Lambda and sent to SQS.
 *
 * This controller is only for:
 * - Local development testing
 * - Simulating messages without Lambda/SQS
 * - Health checks
 */
@Controller('test/chatwoot')
export class ChatwootController {
  private readonly logger = new Logger(ChatwootController.name);

  constructor(private readonly chatwootService: ChatwootService) {}

  /**
   * Health check endpoint
   */
  @Get('health')
  health(): { status: string; service: string } {
    return {
      status: 'ok',
      service: 'chatwoot-integration',
    };
  }

  /**
   * Test endpoint to simulate receiving a message
   * NOT used in production (Lambda handles webhooks)
   */
  @Post('simulate')
  async simulateMessage(
    @Body() payload: any,
  ): Promise<{ status: string; message: string }> {
    this.logger.log('Test message received', {
      event: payload.event,
      conversationId: payload.conversation?.id,
    });

    // In production, this would be processed by QueueProcessor
    // Here we just acknowledge receipt for testing

    return {
      status: 'simulated',
      message: 'This is a test endpoint. Production uses Lambda → SQS → Worker',
    };
  }
}
