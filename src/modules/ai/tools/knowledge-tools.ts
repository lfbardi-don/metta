/**
 * Knowledge Base Tools for AI Agents
 *
 * Tools for retrieving FAQs, policies, and business information.
 * Provides the AI agent with access to store knowledge without cluttering system prompts.
 */

import { z } from 'zod';
import { createAgentTool } from '../../../common/helpers/create-agent-tool.helper';

// ============================================================================
// KNOWLEDGE BASE SEARCH TOOL
// ============================================================================

/**
 * Tool: Search Knowledge Base
 *
 * Searches FAQs and policies in the knowledge base by keyword or topic.
 * Performs intelligent keyword matching across questions, answers, and policy content.
 *
 * Use this when the customer:
 * - Asks general questions about the store, policies, or processes
 * - Needs information about shipping, returns, payments, warranties
 * - Has questions that might be in FAQs
 * - Asks "how do I..." or "what is your..." questions
 */
const searchKnowledgeBaseSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe('Search query or question topic (e.g., "return policy", "shipping time", "payment methods")'),
  category: z
    .enum([
      'general',
      'faq',
      'sizing',
      'shipping',
      'returns',
      'product_care',
      'payments',
      'orders',
    ])
    .optional()
    .describe('Optional category to narrow search. Use "general" or omit for broad search.'),
});

export const searchKnowledgeBaseTool = createAgentTool({
  name: 'search_knowledge_base',
  description:
    'Search the knowledge base for FAQs, policies, and store information. Returns relevant questions, answers, and policy details. Use this for general store questions, policy inquiries, or common customer questions.',
  parameters: searchKnowledgeBaseSchema,
  execute: async (params, context) => {
    const { knowledgeService } = context.services;
    return knowledgeService.search(params.query, params.category);
  },
});

// ============================================================================
// POLICY RETRIEVAL TOOL
// ============================================================================

/**
 * Tool: Get Specific Policy
 *
 * Retrieves the full text of a specific policy by type.
 * Returns detailed policy information including title, content, and last updated date.
 *
 * Use this when the customer:
 * - Explicitly asks for a specific policy (e.g., "What is your return policy?")
 * - Needs detailed information beyond FAQ summaries
 * - Asks about terms, conditions, or guarantees
 */
const getPolicySchema = z.object({
  policyType: z
    .enum([
      'shipping',
      'returns',
      'warranty',
      'privacy',
      'terms_of_service',
      'refund',
    ])
    .describe('Type of policy to retrieve'),
});

export const getPolicyTool = createAgentTool({
  name: 'get_policy',
  description:
    'Get the full text of a specific store policy (shipping, returns, warranty, refund, privacy, or terms of service). Returns complete policy details.',
  parameters: getPolicySchema,
  execute: async (params, context) => {
    const { knowledgeService } = context.services;
    return knowledgeService.getPolicy(params.policyType);
  },
});

// ============================================================================
// BUSINESS INFORMATION TOOL
// ============================================================================

/**
 * Tool: Get Business Information
 *
 * Retrieves store business information including contact details, address,
 * business hours, and social media links.
 *
 * Use this when the customer:
 * - Asks for contact information (phone, email, address)
 * - Wants to know business hours or operating times
 * - Asks "how can I reach you?" or "where are you located?"
 * - Needs social media handles
 */
const getBusinessInfoSchema = z.object({});

export const getBusinessInfoTool = createAgentTool({
  name: 'get_business_info',
  description:
    'Get store business information including contact details (email, phone, WhatsApp), physical address, business hours, and social media links.',
  parameters: getBusinessInfoSchema,
  execute: async (params, context) => {
    const { knowledgeService } = context.services;
    return knowledgeService.getBusinessInfo();
  },
});

// ============================================================================
// TOOL COLLECTIONS FOR AGENT ASSIGNMENT
// ============================================================================

/**
 * Get all knowledge base tools for Triage Agent
 * These tools help answer general questions about the store
 */
export const getKnowledgeTools = () => [
  searchKnowledgeBaseTool,
  getPolicyTool,
  getBusinessInfoTool,
];
