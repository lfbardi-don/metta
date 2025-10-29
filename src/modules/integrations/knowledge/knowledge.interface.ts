/**
 * Knowledge Base Interfaces
 *
 * Defines the structure for FAQs, policies, and business information
 * stored in the knowledge base for AI agent retrieval.
 */

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: KnowledgeCategory;
  keywords: string[];
}

export interface Policy {
  id: string;
  type: PolicyType;
  title: string;
  content: string;
  lastUpdated?: Date;
}

export interface BusinessInfo {
  name: string;
  description?: string;
  contact: {
    email?: string;
    phone?: string;
    whatsapp?: string;
  };
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  businessHours?: {
    monday?: string;
    tuesday?: string;
    wednesday?: string;
    thursday?: string;
    friday?: string;
    saturday?: string;
    sunday?: string;
  };
  socialMedia?: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
    tiktok?: string;
  };
}

export type KnowledgeCategory =
  | 'general'
  | 'faq'
  | 'sizing'
  | 'shipping'
  | 'returns'
  | 'product_care'
  | 'payments'
  | 'orders';

export type PolicyType =
  | 'shipping'
  | 'returns'
  | 'warranty'
  | 'privacy'
  | 'terms_of_service'
  | 'refund';

export interface KnowledgeSearchResult {
  success: boolean;
  data?: {
    results: Array<FAQ | Policy>;
    count: number;
  };
  error?: string;
}

export interface PolicyResult {
  success: boolean;
  data?: Policy;
  error?: string;
}

export interface BusinessInfoResult {
  success: boolean;
  data?: BusinessInfo;
  error?: string;
}
