import { Body, Controller, Post } from '@nestjs/common';
import { AIService } from './ai.service';

export class ChatRequestDto {
  message: string;
}

export class ChatResponseDto {
  output: string;
}

@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Post('chat')
  async chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
    if (!body.message || body.message.trim() === '') {
      throw new Error('Message is required');
    }

    const output = await this.aiService.chatSimple(body.message);
    return { output };
  }
}
