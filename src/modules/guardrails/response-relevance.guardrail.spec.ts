import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResponseRelevanceGuardrail } from './response-relevance.guardrail';
import OpenAI from 'openai';

jest.mock('openai');

describe('ResponseRelevanceGuardrail', () => {
  let guardrail: ResponseRelevanceGuardrail;
  let mockOpenAI: jest.Mocked<OpenAI>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          OPENAI_API_KEY: 'test-api-key',
          GUARDRAILS_LLM_TIMEOUT: 5000,
        };
        return config[key] ?? defaultValue;
      }),
    };

    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    } as any;

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
      () => mockOpenAI,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseRelevanceGuardrail,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guardrail = module.get<ResponseRelevanceGuardrail>(
      ResponseRelevanceGuardrail,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should pass when response addresses user question', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isRelevant: true,
                reason: 'Response directly addresses the product inquiry',
              }),
            },
          },
        ],
      } as any);

      const userMessage = 'What is the price of product #123?';
      const response = 'Product #123 costs $49.99';
      const result = await guardrail.check(response, userMessage);

      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(true);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        expect.any(Object),
      );
    });

    it('should fail when response is off-topic', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isRelevant: false,
                reason: 'Response does not address the order status question',
              }),
            },
          },
        ],
      } as any);

      const userMessage = 'Where is my order #456?';
      const response = 'Our store has many great products available!';
      const result = await guardrail.check(response, userMessage);

      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('address');
    });

    it('should skip check when no user message provided', async () => {
      const response = 'Any response';
      const result = await guardrail.check(response);

      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(true);
      expect(result.message).toContain('No user message context');
      expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    });

    it('should skip check when user message is empty string', async () => {
      const response = 'Any response';
      const result = await guardrail.check(response, '');

      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(true);
      expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    });

    it('should gracefully degrade on OpenAI API errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('API timeout'),
      );

      const userMessage = 'What is the price?';
      const response = 'The price is $10';
      const result = await guardrail.check(response, userMessage);

      // Should pass through on error (graceful degradation)
      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(true);
      expect(result.message).toContain('allowing through');
    });

    it('should handle empty response content gracefully', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      } as any);

      const userMessage = 'Test question';
      const response = 'Test response';
      const result = await guardrail.check(response, userMessage);

      // Should pass through on error
      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(true);
    });

    it('should handle invalid JSON gracefully', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'not valid json',
            },
          },
        ],
      } as any);

      const userMessage = 'Test question';
      const response = 'Test response';
      const result = await guardrail.check(response, userMessage);

      // Should pass through on error
      expect(result.type).toBe('relevance');
      expect(result.passed).toBe(true);
    });

    it('should include both user message and response in prompt', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isRelevant: true,
                reason: 'Relevant',
              }),
            },
          },
        ],
      } as any);

      const userMessage = 'Where is my order?';
      const response = 'Your order is being processed';

      await guardrail.check(response, userMessage);

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const promptContent = callArgs.messages[0].content;

      expect(promptContent).toContain(userMessage);
      expect(promptContent).toContain(response);
    });

    it('should use configured timeout', async () => {
      const mockAbortController = {
        abort: jest.fn(),
        signal: {},
      };
      jest.spyOn(global, 'AbortController').mockImplementation(
        () => mockAbortController as any,
      );

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isRelevant: true,
                reason: 'Relevant',
              }),
            },
          },
        ],
      } as any);

      await guardrail.check('Response', 'Question');

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          signal: mockAbortController.signal,
        }),
      );
    });
  });
});
