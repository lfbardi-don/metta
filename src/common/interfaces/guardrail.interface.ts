export interface GuardrailCheck {
  type: 'pii' | 'toxicity' | 'prompt_injection' | 'business_rules' | 'tone' | 'relevance';
  passed: boolean;
  message?: string;
  score?: number;
}

/**
 * PII Metadata - Maps placeholders to real values
 * Example: { "[EMAIL_1]": "john@example.com", "[DNI_1]": "12.345.678" }
 */
export type PIIMetadata = Record<string, string>;

export interface GuardrailResult {
  allowed: boolean;
  checks: GuardrailCheck[];
  sanitizedContent?: string;
  /**
   * PII metadata extracted from content
   * Maps indexed placeholders (e.g., "[EMAIL_1]") to real values
   * Used to resolve placeholders in tool calls while keeping conversation sanitized
   */
  piiMetadata?: PIIMetadata;
}
