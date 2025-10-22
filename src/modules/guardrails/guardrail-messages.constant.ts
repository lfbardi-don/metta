import { GuardrailCheck } from '../../common/interfaces';

/**
 * Fallback messages for when guardrails block content
 * These messages are user-friendly and provide guidance without exposing technical details
 */
export const GUARDRAIL_FALLBACK_MESSAGES = {
  // Input failures (user message blocked)
  input: {
    pii: 'Desculpe, detectei informações sensíveis na sua mensagem. Por favor, evite compartilhar dados pessoais desnecessários.',
    toxicity:
      'Desculpe, não posso processar essa mensagem. Por favor, reformule de forma respeitosa.',
    prompt_injection:
      'Desculpe, não posso processar essa mensagem. Por favor, reformule sua pergunta de forma diferente.',
    business_rules:
      'Desculpe, sua mensagem é muito longa. Por favor, seja mais conciso (máximo 10.000 caracteres).',
    tone: 'Desculpe, não consegui processar sua mensagem adequadamente. Pode reformular?',
    relevance:
      'Desculpe, não consegui entender sua solicitação. Pode fornecer mais detalhes?',
    generic:
      'Desculpe, não consegui processar sua mensagem. Pode reformular sua pergunta?',
  },

  // Output failures (AI response blocked)
  output: {
    pii: 'Desculpe, houve um problema ao gerar minha resposta. Como posso ajudar de outra forma?',
    toxicity:
      'Desculpe, houve um problema ao processar sua solicitação. Posso ajudar com algo diferente?',
    tone: 'Desculpe, não consegui gerar uma resposta adequada. Pode reformular sua pergunta?',
    relevance:
      'Desculpe, não consegui entender completamente sua solicitação. Pode fornecer mais detalhes sobre o que você precisa?',
    business_rules:
      'Desculpe, minha resposta ficou muito extensa. Posso resumir ou focar em um aspecto específico?',
    prompt_injection:
      'Desculpe, houve um problema ao gerar minha resposta. Como posso ajudar?',
    generic:
      'Desculpe, encontrei um problema ao gerar minha resposta. Como posso ajudar?',
  },
};

/**
 * Get appropriate fallback message based on which guardrail failed
 *
 * @param stage - Whether input or output validation failed
 * @param checks - Array of guardrail checks performed
 * @returns User-friendly fallback message
 */
export function getGuardrailFallbackMessage(
  stage: 'input' | 'output',
  checks: GuardrailCheck[],
): string {
  // Find first failed check (most critical)
  const failedCheck = checks.find((check) => !check.passed);

  if (!failedCheck) {
    // Fallback to generic if no specific failed check found
    return GUARDRAIL_FALLBACK_MESSAGES[stage].generic;
  }

  const messageMap = GUARDRAIL_FALLBACK_MESSAGES[stage];
  const specificMessage =
    messageMap[failedCheck.type as keyof typeof messageMap];

  // Return specific message or fallback to generic
  return specificMessage || messageMap.generic;
}
