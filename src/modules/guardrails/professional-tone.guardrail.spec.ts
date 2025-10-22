import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProfessionalToneGuardrail } from './professional-tone.guardrail';
import OpenAI from 'openai';

jest.mock('openai');

describe('ProfessionalToneGuardrail', () => {
  let guardrail: ProfessionalToneGuardrail;
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
        ProfessionalToneGuardrail,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guardrail = module.get<ProfessionalToneGuardrail>(
      ProfessionalToneGuardrail,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should pass professional responses', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isProfessional: true,
                reason: 'Response is professional and courteous',
              }),
            },
          },
        ],
      } as any);

      const response = "I'd be happy to help you find the perfect product!";
      const result = await guardrail.check(response);

      expect(result.type).toBe('tone');
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

    it('should fail rude responses', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isProfessional: false,
                reason: 'Response contains rude language',
              }),
            },
          },
        ],
      } as any);

      const response = 'Why are you asking such stupid questions?';
      const result = await guardrail.check(response);

      expect(result.type).toBe('tone');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('rude');
    });

    it('should fail sarcastic responses', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                isProfessional: false,
                reason: 'Response contains sarcasm inappropriate for customer service',
              }),
            },
          },
        ],
      } as any);

      const response = 'Oh great, another person who can\'t read the manual.';
      const result = await guardrail.check(response);

      expect(result.type).toBe('tone');
      expect(result.passed).toBe(false);
    });

    it('should gracefully degrade on OpenAI API errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('API timeout'),
      );

      const response = 'Test response';
      const result = await guardrail.check(response);

      // Should pass through on error (graceful degradation)
      expect(result.type).toBe('tone');
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

      const response = 'Test response';
      const result = await guardrail.check(response);

      // Should pass through on error
      expect(result.type).toBe('tone');
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

      const response = 'Test response';
      const result = await guardrail.check(response);

      // Should pass through on error
      expect(result.type).toBe('tone');
      expect(result.passed).toBe(true);
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
                isProfessional: true,
                reason: 'Professional',
              }),
            },
          },
        ],
      } as any);

      await guardrail.check('Test');

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          signal: mockAbortController.signal,
        }),
      );
    });
  });
});
