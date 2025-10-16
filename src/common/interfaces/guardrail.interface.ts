export interface GuardrailCheck {
  type: 'pii' | 'toxicity' | 'prompt_injection' | 'business_rules';
  passed: boolean;
  message?: string;
  score?: number;
}

export interface GuardrailResult {
  allowed: boolean;
  checks: GuardrailCheck[];
  sanitizedContent?: string;
}
