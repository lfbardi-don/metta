import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GuardrailCheck } from '../../common/interfaces';

/**
 * Professional Tone Guardrail
 *
 * Uses gpt-4o-mini to validate that AI responses are:
 * - Professional and courteous
 * - Friendly but not overly casual
 * - Free of sarcasm, rudeness, or inappropriate language
 * - Appropriate for customer service context
 *
 * Cost: ~$0.0002 per check
 * Latency: ~200-500ms
 */
@Injectable()
export class ProfessionalToneGuardrail {
  private readonly logger = new Logger(ProfessionalToneGuardrail.name);
  private readonly openai: OpenAI;
  private readonly timeout: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not found - tone checks will fail');
    }
    this.openai = new OpenAI({ apiKey });
    this.timeout = this.configService.get<number>(
      'GUARDRAILS_LLM_TIMEOUT',
      5000,
    );
  }

  /**
   * Check if response has professional tone
   */
  async check(response: string): Promise<GuardrailCheck> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.timeout,
      );

      const prompt = `You are a tone validator for customer service responses.

Analyze the following response and determine if it is:
1. Professional and courteous
2. Friendly but not overly casual
3. Free of sarcasm, rudeness, or inappropriate language
4. Appropriate for a customer service context (helping customers with orders, products, etc.)

Response to analyze:
"""
${response}
"""

Reply with JSON only:
{
  "isProfessional": true/false,
  "reason": "Brief explanation if not professional"
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
        `Tone check: ${analysis.isProfessional ? 'PASSED' : 'FAILED'}`,
        analysis.reason ? { reason: analysis.reason } : {},
      );

      return {
        type: 'tone',
        passed: analysis.isProfessional,
        message: analysis.reason || 'Professional tone validated',
      };
    } catch (error) {
      // Graceful degradation: allow on error (don't block legitimate responses)
      this.logger.error(`Tone check failed: ${error.message}`);
      return {
        type: 'tone',
        passed: true,
        message: `Tone check failed (allowing through): ${error.message}`,
      };
    }
  }
}
