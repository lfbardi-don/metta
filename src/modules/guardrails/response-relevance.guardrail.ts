import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GuardrailCheck } from '../../common/interfaces';

/**
 * Response Relevance Guardrail
 *
 * Uses gpt-4o-mini to validate that AI responses:
 * - Directly address the user's question
 * - Provide relevant information related to the query
 * - Are not complete non-sequiturs or off-topic
 *
 * Requires user message context for comparison.
 *
 * Cost: ~$0.0002 per check
 * Latency: ~200-500ms
 */
@Injectable()
export class ResponseRelevanceGuardrail {
  private readonly logger = new Logger(ResponseRelevanceGuardrail.name);
  private readonly openai: OpenAI;
  private readonly timeout: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not found - relevance checks will fail');
    }
    this.openai = new OpenAI({ apiKey });
    this.timeout = this.configService.get<number>(
      'GUARDRAILS_LLM_TIMEOUT',
      5000,
    );
  }

  /**
   * Check if response is relevant to user's question
   * Supports both single message and conversation history for context
   */
  async check(
    response: string,
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<GuardrailCheck> {
    // Skip check if no conversation context provided
    if (!conversationHistory || conversationHistory.length === 0) {
      this.logger.warn(
        'No conversation history provided, skipping relevance check',
      );
      return {
        type: 'relevance',
        passed: true,
        message: 'No conversation history provided',
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Format conversation history for the prompt
      const historyText = conversationHistory
        .map(
          (msg) =>
            `${msg.role === 'user' ? 'User' : 'Agent'}: ${msg.content}`,
        )
        .join('\n');

      const prompt = `You are a relevance validator for customer service conversations.

Recent conversation history:
"""
${historyText}
"""

Agent's latest response:
"""
${response}
"""

Considering the FULL conversation context above, determine if the agent's latest response:
1. Logically follows from the conversation flow
2. Addresses what the user needs based on the entire conversation
3. Is relevant to the ongoing discussion

Important: Consider the conversation as a whole. If a user provides information (like an email) that was requested by the agent in a previous message, the agent's response about that topic IS relevant.

Reply with JSON only:
{
  "isRelevant": true/false,
  "reason": "Brief explanation if not relevant"
}`;

      const result = await this.openai.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0, // Deterministic validation
        },
        { signal: controller.signal as any },
      );

      clearTimeout(timeoutId);

      const content = result.choices[0].message.content;
      if (!content) {
        throw new Error('No content in response');
      }

      const analysis = JSON.parse(content);

      this.logger.log(
        `Relevance check: ${analysis.isRelevant ? 'PASSED' : 'FAILED'}`,
        analysis.reason ? { reason: analysis.reason } : {},
      );

      return {
        type: 'relevance',
        passed: analysis.isRelevant,
        message: analysis.reason || 'Response is relevant to conversation',
      };
    } catch (error) {
      // Graceful degradation: allow on error (don't block legitimate responses)
      this.logger.error(`Relevance check failed: ${error.message}`);
      return {
        type: 'relevance',
        passed: true,
        message: `Relevance check failed (allowing through): ${error.message}`,
      };
    }
  }
}
