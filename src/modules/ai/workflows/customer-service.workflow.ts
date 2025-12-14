/**
 * Metta Customer Service Workflow
 *
 * Multi-agent workflow with explicit classifier and MCP tool integration.
 *
 * IMPORTANT NOTES:
 *
 * 1. PII Handling:
 *    - PII is detected and masked with placeholders in WorkflowAIService
 *    - Placeholders are resolved to real values before calling this workflow
 *    - MCP servers receive real PII values (necessary for tools to work)
 *    - Conversation history in DB remains sanitized with placeholders
 *
 * 2. Authentication:
 *    - Orders Agent instructions reference check_auth_status() and verify_dni()
 *    - These tools ARE implemented in MCP Orders server with Cloudflare KV sessions
 *    - Sessions last 30 minutes (automatic TTL expiration)
 *    - DNI verification: Look up customer by email, compare last 3 digits
 *    - All order tools require valid session before execution
 *
 * 3. Conversation History:
 *    - WorkflowAIService loads history from database
 *    - Converts to AgentInputItem[] format
 *    - Passes via conversationHistory parameter
 *    - Workflow prepends history before current message
 */

import { AgentInputItem, Runner, withTrace } from '@openai/agents';

// Import agents
import {
  mettaClassifier,
  createFaqAgent,
  createGreetingsAgent,
  createHandoffAgent,
  createOrdersAgent,
  createProductsAgent,
  createExchangeAgent,
  inferNextExchangeStep,
} from '../agents';

// Import types
import { WorkflowInput, WorkflowResult } from '../types';

// Re-export types for consumers
export type { WorkflowInput, WorkflowResult, HandoffCallback } from '../types';

/**
 * Main workflow entrypoint
 *
 * Routes customer messages to the appropriate specialist agent based on
 * intent classification.
 */
export const runWorkflow = async (
  workflow: WorkflowInput,
): Promise<WorkflowResult> => {
  return await withTrace('Metta - Customer Service', async () => {
    const state = {
      conversationState: workflow.conversationState || null,
    };
    const conversationHistory: AgentInputItem[] = [
      ...(workflow.conversationHistory || []),
    ];

    // Add goal context to conversation history if active goal exists
    if (workflow.goal) {
      const goal = workflow.goal;
      conversationHistory.unshift({
        role: 'system' as const,
        content: `
ACTIVE GOAL: ${goal.type}
Topic: ${goal.context?.topic || 'general'}
Context: ${goal.context?.orderId ? `Order #${goal.context.orderId}` : 'No specific context'}

Continue helping the customer achieve their goal naturally.
        `.trim(),
      });
    }

    // Add current user message
    conversationHistory.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: workflow.input_as_text,
        },
      ],
    });

    const runner = new Runner({
      traceMetadata: {
        __trace_source__: 'agent-builder',
        workflow_id: 'wf_6908c91cd5ac8190baa31b1799154da102aeda53012b0c18',
      },
    });

    // Run classifier to determine intent
    const classifierResult = await runner.run(mettaClassifier, [
      ...conversationHistory,
    ]);
    conversationHistory.push(
      ...classifierResult.newItems.map((item) => item.rawItem),
    );

    if (!classifierResult.finalOutput) {
      throw new Error('Classifier result is undefined');
    }

    const intent = classifierResult.finalOutput.intent;
    const classifierConfidence = classifierResult.finalOutput.confidence;

    // Route to appropriate agent based on intent
    switch (intent) {
      case 'ORDER_STATUS':
        return await handleOrdersIntent(
          runner,
          conversationHistory,
          state,
          workflow,
          classifierConfidence,
        );

      case 'PRODUCT_INFO':
        return await handleProductsIntent(
          runner,
          conversationHistory,
          state,
          workflow,
          classifierConfidence,
        );

      case 'STORE_INFO':
        return await handleFaqIntent(
          runner,
          conversationHistory,
          state,
          classifierConfidence,
        );

      case 'EXCHANGE_REQUEST':
        return await handleExchangeIntent(
          runner,
          conversationHistory,
          state,
          workflow,
          classifierConfidence,
        );

      case 'HUMAN_HANDOFF':
        return await handleHandoffIntent(
          runner,
          conversationHistory,
          state,
          workflow,
          classifierResult.finalOutput.explanation,
          classifierConfidence,
        );

      default:
        return await handleGreetingsIntent(
          runner,
          conversationHistory,
          state,
          classifierConfidence,
        );
    }
  });
};

/**
 * Handle ORDER_STATUS intent
 */
async function handleOrdersIntent(
  runner: Runner,
  conversationHistory: AgentInputItem[],
  state: { conversationState: any },
  workflow: WorkflowInput,
  classifierConfidence: number,
): Promise<WorkflowResult> {
  const ordersAgent = createOrdersAgent(
    state.conversationState,
    workflow.authState || null,
    workflow.conversationId || '',
    workflow.orderPresentationMode,
    workflow.orderPresentationInstructions,
  );

  const result = await runner.run(ordersAgent, [...conversationHistory]);
  if (!result.finalOutput) {
    throw new Error('Orders agent result is undefined');
  }

  return {
    output: result.finalOutput,
    newItems: result.newItems,
    classifierConfidence,
  };
}

/**
 * Handle PRODUCT_INFO intent
 */
async function handleProductsIntent(
  runner: Runner,
  conversationHistory: AgentInputItem[],
  state: { conversationState: any },
  workflow: WorkflowInput,
  classifierConfidence: number,
): Promise<WorkflowResult> {
  const productsAgent = createProductsAgent(
    state.conversationState,
    workflow.presentationMode,
    workflow.presentationInstructions,
  );

  const result = await runner.run(productsAgent, [...conversationHistory]);
  if (!result.finalOutput) {
    throw new Error('Products agent result is undefined');
  }

  return {
    output: result.finalOutput,
    newItems: result.newItems,
    classifierConfidence,
  };
}

/**
 * Handle STORE_INFO intent (FAQ)
 */
async function handleFaqIntent(
  runner: Runner,
  conversationHistory: AgentInputItem[],
  state: { conversationState: any },
  classifierConfidence: number,
): Promise<WorkflowResult> {
  const faqAgent = createFaqAgent(state.conversationState);
  const result = await runner.run(faqAgent, [...conversationHistory]);
  if (!result.finalOutput) {
    throw new Error('FAQ agent result is undefined');
  }

  return {
    output: result.finalOutput,
    newItems: result.newItems,
    classifierConfidence,
  };
}

/**
 * Handle EXCHANGE_REQUEST intent
 */
async function handleExchangeIntent(
  runner: Runner,
  conversationHistory: AgentInputItem[],
  state: { conversationState: any },
  workflow: WorkflowInput,
  classifierConfidence: number,
): Promise<WorkflowResult> {
  const exchangeState = state.conversationState?.state?.exchangeState || null;

  const exchangeAgent = createExchangeAgent(
    state.conversationState,
    workflow.authState || null,
    workflow.conversationId || '',
    exchangeState,
  );

  const result = await runner.run(exchangeAgent, [...conversationHistory]);
  if (!result.finalOutput) {
    throw new Error('Exchange agent result is undefined');
  }

  // Extract tool calls with their outputs for state inference
  const toolCalls = result.newItems
    .filter((item) => item.type === 'tool_call_item')
    .map((item) => {
      const rawItem = item.rawItem as any;
      const outputItem = result.newItems.find(
        (i) =>
          i.type === 'tool_call_output_item' &&
          (i.rawItem as any).call_id === rawItem.call_id,
      );
      return {
        name: rawItem.name || '',
        arguments: rawItem.arguments,
        output: outputItem ? (outputItem.rawItem as any).output : undefined,
      };
    });

  // Infer next exchange step based on tool calls and response
  const updatedExchangeState = inferNextExchangeStep(
    exchangeState,
    toolCalls,
    result.finalOutput.response_text || '',
  );

  // Persist updated exchange state via callback if available
  if (workflow.onExchangeStateUpdate && workflow.conversationId) {
    await workflow.onExchangeStateUpdate(
      workflow.conversationId,
      updatedExchangeState,
    );
  }

  // Check if transfer_to_human was called
  const handoffCalled = toolCalls.some(
    (call) => call.name === 'transfer_to_human',
  );

  if (handoffCalled && workflow.onHandoff && workflow.conversationId) {
    await workflow.onHandoff(
      workflow.conversationId,
      'Exchange request with all information collected',
    );

    return {
      output: result.finalOutput,
      newItems: result.newItems,
      handoffTriggered: true,
      handoffReason: 'Exchange flow completed - all information collected',
      exchangeState: updatedExchangeState,
      classifierConfidence,
    };
  }

  return {
    output: result.finalOutput,
    newItems: result.newItems,
    exchangeState: updatedExchangeState,
    classifierConfidence,
  };
}

/**
 * Handle HUMAN_HANDOFF intent
 */
async function handleHandoffIntent(
  runner: Runner,
  conversationHistory: AgentInputItem[],
  state: { conversationState: any },
  workflow: WorkflowInput,
  explanation: string,
  classifierConfidence: number,
): Promise<WorkflowResult> {
  const handoffAgent = createHandoffAgent(state.conversationState);
  const result = await runner.run(handoffAgent, [...conversationHistory]);
  if (!result.finalOutput) {
    throw new Error('Handoff agent result is undefined');
  }

  // Trigger handoff callback if provided
  if (workflow.onHandoff && workflow.conversationId) {
    await workflow.onHandoff(workflow.conversationId, explanation);
  }

  return {
    output: result.finalOutput,
    newItems: result.newItems,
    handoffTriggered: true,
    handoffReason: explanation,
    classifierConfidence,
  };
}

/**
 * Handle OTHERS intent (greetings/unknown)
 */
async function handleGreetingsIntent(
  runner: Runner,
  conversationHistory: AgentInputItem[],
  state: { conversationState: any },
  classifierConfidence: number,
): Promise<WorkflowResult> {
  const greetingsAgent = createGreetingsAgent(state.conversationState);
  const result = await runner.run(greetingsAgent, [...conversationHistory]);
  if (!result.finalOutput) {
    throw new Error('Greetings agent result is undefined');
  }

  return {
    output: result.finalOutput,
    newItems: result.newItems,
    classifierConfidence,
  };
}
