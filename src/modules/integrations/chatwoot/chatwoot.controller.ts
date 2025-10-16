import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ChatwootService } from './chatwoot.service';

@Controller('webhooks/chatwoot')
export class ChatwootController {
  private readonly logger = new Logger(ChatwootController.name);

  constructor(private readonly chatwootService: ChatwootService) {}

  /**
   * Webhook endpoint for Chatwoot events
   */
  @Post()
  async handleWebhook(@Body() payload: any): Promise<{ status: string }> {
    // TODO: Process webhook payload
    // TODO: Send to queue for async processing
    this.logger.log('Webhook received', { payload });

    return { status: 'received' };
  }
}
