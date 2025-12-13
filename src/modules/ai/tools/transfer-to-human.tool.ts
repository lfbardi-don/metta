import { tool } from '@openai/agents';
import { z } from 'zod';

/**
 * Transfer to Human Tool
 *
 * This tool allows specialist agents (Orders, Products, FAQ) to transfer
 * the conversation to a human agent when they determine it's necessary.
 *
 * Use cases:
 * - Customer becomes very frustrated during interaction
 * - Issue is too complex for the bot to handle
 * - Customer explicitly asks for a human mid-conversation
 * - Specialist determines handoff is needed after initial classification
 *
 * Note: The tool just returns a special response. The actual handoff
 * (calling ChatwootService.assignToTeam) is handled by WorkflowAIService
 * when it detects this tool was called in the workflow result.
 */
export const transferToHumanTool = tool({
  name: 'transfer_to_human',
  description:
    'Transfer the conversation to a human support agent. Use this when: (1) the customer is very frustrated or upset, (2) the issue is too complex to resolve, (3) the customer explicitly asks to speak with a person, (4) you cannot help with their request. When calling this tool, the conversation will be assigned to the human support team.',
  parameters: z.object({
    reason: z
      .string()
      .describe(
        'Brief reason for the transfer (internal, not shown to customer)',
      ),
    summary: z
      .string()
      .nullable()
      .describe(
        'Optional summary of the conversation for the human agent. Pass null if no summary is available.',
      ),
  }),
  execute: async (params: { reason: string; summary: string | null }) => {
    // This tool doesn't actually perform the handoff - it just signals
    // that handoff is needed. WorkflowAIService detects this in newItems
    // and performs the actual handoff via ChatwootService.
    return JSON.stringify({
      handoff_requested: true,
      reason: params.reason,
      summary: params.summary,
      message:
        'Handoff requested. The conversation will be transferred to human support.',
    });
  },
});
