import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  GuardrailResult,
  GuardrailCheck,
  MessageContext,
} from '../../common/interfaces';

/**
 * PII Detection result
 */
interface PIIMatch {
  type: 'email' | 'phone' | 'credit_card' | 'ssn';
  value: string;
  start: number;
  end: number;
}

/**
 * Moderation result from OpenAI API
 */
interface ModerationResult {
  flagged: boolean;
  categories: string[];
  score: number;
}

@Injectable()
export class GuardrailsService {
  private readonly logger = new Logger(GuardrailsService.name);
  private readonly openai: OpenAI;

  // Configuration flags
  private readonly piiCheckEnabled: boolean;
  private readonly toxicityCheckEnabled: boolean;
  private readonly injectionCheckEnabled: boolean;
  private readonly businessRulesEnabled: boolean;
  private readonly moderationTimeout: number;
  private readonly moderationFallback: 'warn' | 'block';

  // PII Detection Patterns
  private readonly piiPatterns = {
    // Email pattern (RFC 5322 simplified)
    email:
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

    // Phone patterns (US and international) - requires separators or parentheses to avoid matching card numbers
    phone:
      /(?:\+?\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,

    // Credit card patterns (Visa, MC, Amex, Discover)
    creditCard:
      /\b(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2})|3[47]\d{2})[\s-]?\d{4}[\s-]?\d{4}[\s-]?(?:\d{4}|\d{3})\b/g,

    // SSN pattern (US) - requires separators
    ssn: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
  };

  // Prompt Injection Patterns
  private readonly injectionPatterns = [
    // Direct instruction override
    /ignore\s+(previous|all|above)\s+(instructions?|prompts?|rules?)/i,
    /disregard\s+(previous|all|above)\s+(instructions?|prompts?|rules?)/i,
    /forget\s+(previous|all|above)\s+(instructions?|prompts?|rules?)/i,

    // Role confusion
    /you\s+are\s+now\s+(a|an)\s+/i,
    /act\s+as\s+(a|an)\s+/i,
    /pretend\s+(to\s+be|you\s+are)\s+/i,
    /roleplay\s+as\s+/i,

    // System prompt manipulation
    /new\s+(instruction|directive|command|rule)s?:/i,
    /system\s*:\s*/i,
    /\[system\]/i,
    /\<\|system\|\>/i,

    // Jailbreak attempts
    /DAN\s+mode/i, // "Do Anything Now"
    /developer\s+mode/i,
    /god\s+mode/i,

    // Delimiter/token manipulation
    /###\s*new\s+(instruction|rule)/i,
    /---\s*new\s+(instruction|rule)/i,
  ];

  constructor(private readonly configService: ConfigService) {
    // Initialize OpenAI client
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not found - moderation checks will fail');
    }
    this.openai = new OpenAI({ apiKey });

    // Load configuration
    this.piiCheckEnabled = this.configService.get<boolean>(
      'GUARDRAILS_ENABLE_PII_CHECK',
      true,
    );
    this.toxicityCheckEnabled = this.configService.get<boolean>(
      'GUARDRAILS_ENABLE_TOXICITY_CHECK',
      true,
    );
    this.injectionCheckEnabled = this.configService.get<boolean>(
      'GUARDRAILS_ENABLE_INJECTION_CHECK',
      true,
    );
    this.businessRulesEnabled = this.configService.get<boolean>(
      'GUARDRAILS_ENABLE_BUSINESS_RULES',
      true,
    );
    this.moderationTimeout = this.configService.get<number>(
      'OPENAI_MODERATION_TIMEOUT',
      5000,
    );
    this.moderationFallback = this.configService.get<'warn' | 'block'>(
      'GUARDRAILS_MODERATION_FALLBACK',
      'warn',
    );

    this.logger.log('Guardrails service initialized with configuration:');
    this.logger.log(`  PII Check: ${this.piiCheckEnabled}`);
    this.logger.log(`  Toxicity Check: ${this.toxicityCheckEnabled}`);
    this.logger.log(`  Injection Check: ${this.injectionCheckEnabled}`);
    this.logger.log(`  Business Rules: ${this.businessRulesEnabled}`);
  }

  /**
   * Detect PII in text
   */
  private detectPII(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    // Email detection
    const emailMatches = text.matchAll(this.piiPatterns.email);
    for (const match of emailMatches) {
      matches.push({
        type: 'email',
        value: match[0],
        start: match.index!,
        end: match.index! + match[0].length,
      });
    }

    // Phone detection
    const phoneMatches = text.matchAll(this.piiPatterns.phone);
    for (const match of phoneMatches) {
      matches.push({
        type: 'phone',
        value: match[0],
        start: match.index!,
        end: match.index! + match[0].length,
      });
    }

    // Credit card detection
    const cardMatches = text.matchAll(this.piiPatterns.creditCard);
    for (const match of cardMatches) {
      // Additional validation: credit card should pass Luhn algorithm
      const cardNumber = match[0].replace(/[\s-]/g, '');
      if (this.validateLuhn(cardNumber)) {
        matches.push({
          type: 'credit_card',
          value: match[0],
          start: match.index!,
          end: match.index! + match[0].length,
        });
      }
    }

    // SSN detection
    const ssnMatches = text.matchAll(this.piiPatterns.ssn);
    for (const match of ssnMatches) {
      matches.push({
        type: 'ssn',
        value: match[0],
        start: match.index!,
        end: match.index! + match[0].length,
      });
    }

    return matches;
  }

  /**
   * Luhn algorithm for credit card validation
   */
  private validateLuhn(cardNumber: string): boolean {
    let sum = 0;
    let isEven = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i], 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Sanitize PII by replacing with placeholders
   */
  private sanitizePII(text: string): string {
    let sanitized = text;
    const matches = this.detectPII(text);

    // Sort matches by start position (descending) to replace from end to start
    // This prevents index shifting issues
    matches.sort((a, b) => b.start - a.start);

    for (const match of matches) {
      const placeholder = this.getPIIPlaceholder(match.type);
      sanitized =
        sanitized.slice(0, match.start) +
        placeholder +
        sanitized.slice(match.end);
    }

    return sanitized;
  }

  /**
   * Get placeholder for PII type
   */
  private getPIIPlaceholder(type: PIIMatch['type']): string {
    const placeholders = {
      email: '[EMAIL]',
      phone: '[PHONE]',
      credit_card: '[CREDIT_CARD]',
      ssn: '[SSN]',
    };
    return placeholders[type];
  }

  /**
   * Detect prompt injection attempts
   */
  private detectPromptInjection(text: string): {
    detected: boolean;
    patterns: string[];
  } {
    const detectedPatterns: string[] = [];

    for (const pattern of this.injectionPatterns) {
      if (pattern.test(text)) {
        detectedPatterns.push(pattern.source);
      }
    }

    return {
      detected: detectedPatterns.length > 0,
      patterns: detectedPatterns,
    };
  }

  /**
   * Check content with OpenAI Moderation API
   */
  private async checkModeration(text: string): Promise<ModerationResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.moderationTimeout,
      );

      const response = await this.openai.moderations.create(
        { input: text },
        { signal: controller.signal as any },
      );

      clearTimeout(timeoutId);

      const result = response.results[0];
      const flaggedCategories = Object.entries(result.categories)
        .filter(([_, flagged]) => flagged)
        .map(([category]) => category);

      // Get highest category score
      const scores = Object.values(result.category_scores);
      const maxScore = Math.max(...scores);

      return {
        flagged: result.flagged,
        categories: flaggedCategories,
        score: maxScore,
      };
    } catch (error) {
      this.logger.error('Moderation API call failed:', error.message);

      // Fallback behavior
      if (this.moderationFallback === 'warn') {
        this.logger.warn(
          'Moderation check failed - allowing through (fallback: warn)',
        );
        return { flagged: false, categories: [], score: 0 };
      } else {
        this.logger.warn(
          'Moderation check failed - blocking (fallback: block)',
        );
        return {
          flagged: true,
          categories: ['moderation_api_error'],
          score: 1,
        };
      }
    }
  }

  /**
   * Validate incoming message before sending to AI
   * Checks for PII, toxicity, prompt injection, etc.
   */
  async validateInput(
    message: string,
    context: MessageContext,
  ): Promise<GuardrailResult> {
    this.logger.log(
      `Validating input message for conversation ${context.conversationId}`,
    );

    const checks: GuardrailCheck[] = [];
    let sanitizedContent = message;

    // 1. PII Check (moderate mode - sanitize and continue)
    if (this.piiCheckEnabled) {
      const piiMatches = this.detectPII(message);
      const hasPII = piiMatches.length > 0;

      if (hasPII) {
        this.logger.warn(
          `PII detected in input (${piiMatches.length} matches): ${piiMatches.map((m) => m.type).join(', ')}`,
        );
        sanitizedContent = this.sanitizePII(message);
        this.logger.log('PII sanitized - continuing with masked content');
      }

      checks.push({
        type: 'pii',
        passed: true, // Always pass in moderate mode (we sanitize)
        message: hasPII
          ? `Detected and sanitized ${piiMatches.length} PII item(s)`
          : 'No PII detected',
      });
    }

    // 2. Prompt Injection Check
    if (this.injectionCheckEnabled) {
      const injectionResult = this.detectPromptInjection(sanitizedContent);

      if (injectionResult.detected) {
        this.logger.warn(
          `Prompt injection detected: ${injectionResult.patterns.length} pattern(s) matched`,
        );
      }

      checks.push({
        type: 'prompt_injection',
        passed: !injectionResult.detected,
        message: injectionResult.detected
          ? `Detected ${injectionResult.patterns.length} injection pattern(s)`
          : 'No injection detected',
      });
    }

    // 3. Toxicity Check (OpenAI Moderation API)
    if (this.toxicityCheckEnabled) {
      const moderation = await this.checkModeration(sanitizedContent);

      if (moderation.flagged) {
        this.logger.warn(
          `Toxic content detected: ${moderation.categories.join(', ')}`,
        );
      }

      checks.push({
        type: 'toxicity',
        passed: !moderation.flagged,
        message: moderation.flagged
          ? `Flagged for: ${moderation.categories.join(', ')}`
          : 'No toxic content detected',
        score: moderation.score,
      });
    }

    // 4. Business Rules
    if (this.businessRulesEnabled) {
      const maxInputLength = 10000;
      const tooLong = sanitizedContent.length > maxInputLength;

      if (tooLong) {
        this.logger.warn(
          `Message exceeds max length: ${sanitizedContent.length} > ${maxInputLength}`,
        );
      }

      checks.push({
        type: 'business_rules',
        passed: !tooLong,
        message: tooLong
          ? `Message too long (${sanitizedContent.length} chars, max ${maxInputLength})`
          : 'Business rules passed',
      });
    }

    const allowed = checks.every((check) => check.passed);

    this.logger.log(
      `Input validation ${allowed ? 'PASSED' : 'FAILED'} - ${checks.filter((c) => !c.passed).length} check(s) failed`,
    );

    return {
      allowed,
      checks,
      sanitizedContent: sanitizedContent !== message ? sanitizedContent : undefined,
    };
  }

  /**
   * Validate AI response before sending to user
   * Ensures response is appropriate and safe
   */
  async validateOutput(
    response: string,
    context: MessageContext,
  ): Promise<GuardrailResult> {
    this.logger.log(
      `Validating output response for conversation ${context.conversationId}`,
    );

    const checks: GuardrailCheck[] = [];
    let sanitizedContent = response;

    // 1. PII Check (ensure no PII leakage)
    if (this.piiCheckEnabled) {
      const piiMatches = this.detectPII(response);
      const hasPII = piiMatches.length > 0;

      if (hasPII) {
        this.logger.warn(
          `PII detected in output (${piiMatches.length} matches): ${piiMatches.map((m) => m.type).join(', ')}`,
        );
        sanitizedContent = this.sanitizePII(response);
        this.logger.log('PII sanitized in output');
      }

      checks.push({
        type: 'pii',
        passed: true, // Always pass (we sanitize)
        message: hasPII
          ? `Detected and sanitized ${piiMatches.length} PII item(s)`
          : 'No PII detected',
      });
    }

    // 2. Toxicity Check
    if (this.toxicityCheckEnabled) {
      const moderation = await this.checkModeration(sanitizedContent);

      if (moderation.flagged) {
        this.logger.warn(
          `Toxic content in output: ${moderation.categories.join(', ')}`,
        );
      }

      checks.push({
        type: 'toxicity',
        passed: !moderation.flagged,
        message: moderation.flagged
          ? `Flagged for: ${moderation.categories.join(', ')}`
          : 'No toxic content detected',
        score: moderation.score,
      });
    }

    // 3. Business Rules
    if (this.businessRulesEnabled) {
      const maxOutputLength = 5000;
      const tooLong = sanitizedContent.length > maxOutputLength;

      if (tooLong) {
        this.logger.warn(
          `Response exceeds max length: ${sanitizedContent.length} > ${maxOutputLength}`,
        );
      }

      checks.push({
        type: 'business_rules',
        passed: !tooLong,
        message: tooLong
          ? `Response too long (${sanitizedContent.length} chars, max ${maxOutputLength})`
          : 'Business rules passed',
      });
    }

    const allowed = checks.every((check) => check.passed);

    this.logger.log(
      `Output validation ${allowed ? 'PASSED' : 'FAILED'} - ${checks.filter((c) => !c.passed).length} check(s) failed`,
    );

    return {
      allowed,
      checks,
      sanitizedContent: sanitizedContent !== response ? sanitizedContent : undefined,
    };
  }

  /**
   * Sanitize content by removing or masking sensitive information
   */
  async sanitize(content: string): Promise<string> {
    this.logger.log('Sanitizing content');

    if (!this.piiCheckEnabled) {
      return content;
    }

    const sanitized = this.sanitizePII(content);

    if (sanitized !== content) {
      const piiMatches = this.detectPII(content);
      this.logger.log(
        `Sanitized ${piiMatches.length} PII item(s): ${piiMatches.map((m) => m.type).join(', ')}`,
      );
    }

    return sanitized;
  }
}
