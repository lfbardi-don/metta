import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentInputItem } from '@openai/agents';
import { runWorkflow } from './workflows/customer-service.workflow';
import {
  IncomingMessage,
  MessageContext,
  OdooProductSimplified,
  NuvemshopProductSimplified,
} from '../../common/interfaces';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { getGuardrailFallbackMessage } from '../guardrails/guardrail-messages.constant';
import { PersistenceService } from '../persistence/persistence.service';
import { resolvePIIPlaceholders } from '../../common/helpers/resolve-pii.helper';

/**
 * Response from AI service with text and optional product images
 */
export interface AIServiceResponse {
  response: string;
  products: Array<OdooProductSimplified | NuvemshopProductSimplified>;
}

/**
 * WorkflowAIService
 *
 * NestJS wrapper for the new multi-agent workflow architecture.
 * Integrates with existing guardrails, persistence, and authentication systems.
 *
 * Flow:
 * 1. Load conversation history from database
 * 2. Run input guardrails (PII, toxicity, prompt injection, business rules)
 * 3. Convert history to workflow format
 * 4. Call runWorkflow() with sanitized content and history
 * 5. Run output guardrails (tone, relevance, PII leak)
 * 6. Return sanitized response
 */
@Injectable()
export class WorkflowAIService {
  private readonly logger = new Logger(WorkflowAIService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly guardrailsService: GuardrailsService,
    private readonly persistenceService: PersistenceService,
  ) {}

  /**
   * Process an incoming message through the workflow-based AI system
   * This is the main entry point for the workflow AI module
   */
  async processMessage(message: IncomingMessage): Promise<AIServiceResponse> {
    const context: MessageContext = {
      conversationId: message.conversationId,
      contactId: message.contactId,
      metadata: message.metadata,
    };

    // Load conversation history for context-aware guardrails
    const dbMessages =
      await this.persistenceService.getMessagesByConversation(
        context.conversationId,
      );

    // Extract last 4 messages for relevance validation
    // Using ORIGINAL content (not sanitized) so LLM can understand context
    if (dbMessages.length > 0) {
      context.conversationHistory = dbMessages.slice(-4).map((msg) => ({
        role: msg.direction === 'incoming' ? 'user' : 'assistant',
        content: msg.content,
      }));

      this.logger.log(
        `Loaded ${context.conversationHistory.length} message(s) for context`,
      );
    }

    // 1. Validate input with guardrails
    const inputValidation = await this.guardrailsService.validateInput(
      message.content,
      context,
    );

    if (!inputValidation.allowed) {
      this.logger.warn('Input validation failed - returning fallback message', {
        conversationId: context.conversationId,
        failedChecks: inputValidation.checks
          .filter((c) => !c.passed)
          .map((c) => c.type),
      });

      const fallbackMessage = getGuardrailFallbackMessage(
        'input',
        inputValidation.checks,
      );
      return { response: fallbackMessage, products: [] };
    }

    // Use sanitized content if PII was detected and masked
    const contentToProcess = inputValidation.sanitizedContent ?? message.content;

    if (inputValidation.sanitizedContent) {
      this.logger.log('Using sanitized input (PII masked with placeholders)');
    }

    // Add PII metadata to context for tool placeholder resolution
    if (inputValidation.piiMetadata) {
      context.piiMetadata = inputValidation.piiMetadata;
      this.logger.log(
        `PII metadata available: ${Object.keys(inputValidation.piiMetadata).length} placeholder(s)`,
      );
    }

    // 2. Resolve PII placeholders before sending to workflow
    // MCP servers (Cloudflare Workers) don't have access to NestJS context,
    // so we resolve placeholders to real values before calling MCP tools
    const resolvedContent = resolvePIIPlaceholders(
      contentToProcess,
      context.piiMetadata,
    );

    if (context.piiMetadata && Object.keys(context.piiMetadata).length > 0) {
      this.logger.log(
        'Resolved PII placeholders for MCP tools (real values sent to workflow)',
      );
    }

    // 3. Process with workflow (pass dbMessages to avoid re-fetching)
    const { response, products } = await this.runWorkflow(
      resolvedContent,
      context,
      dbMessages,
    );

    // 4. Validate output with guardrails (context includes conversationHistory)
    const outputValidation = await this.guardrailsService.validateOutput(
      response,
      context,
    );

    if (!outputValidation.allowed) {
      this.logger.warn('Output validation failed - returning fallback message', {
        conversationId: context.conversationId,
        failedChecks: outputValidation.checks
          .filter((c) => !c.passed)
          .map((c) => c.type),
      });

      const fallbackMessage = getGuardrailFallbackMessage(
        'output',
        outputValidation.checks,
      );
      return { response: fallbackMessage, products: [] };
    }

    // Use sanitized output if PII was detected and masked
    const finalResponse = outputValidation.sanitizedContent ?? response;

    if (outputValidation.sanitizedContent) {
      this.logger.log('Using sanitized output (PII masked)');
    }

    return { response: finalResponse, products };
  }

  /**
   * Internal method that calls the workflow with conversation history
   *
   * Note: Current message is already saved to DB before this method is called (in queue.processor),
   * but we fetch history excluding it and add it explicitly to maintain clean separation
   * between "historical context from DB" and "current user input being processed"
   */
  private async runWorkflow(
    message: string,
    context?: MessageContext,
    dbMessages?: any[],
  ): Promise<AIServiceResponse> {
    try {
      if (!context?.conversationId) {
        throw new Error('conversationId is required for workflow');
      }

      this.logger.log('Starting workflow execution', {
        conversationId: context.conversationId,
      });

      // Use provided messages or fetch them (excluding latest to avoid duplication)
      // Current message is already in DB, but we add it explicitly below
      const messages =
        dbMessages ??
        (await this.persistenceService.getMessagesByConversation(
          context.conversationId,
          { excludeLatest: 1 },
        ));

      // If dbMessages was provided, exclude the latest message
      // (it's the current message that was just saved before calling processMessage)
      const historyMessages =
        dbMessages && dbMessages.length > 0
          ? dbMessages.slice(0, -1)
          : messages;

      // Convert database messages to AgentInputItem[] format
      const conversationHistory: AgentInputItem[] = historyMessages.map((msg) => ({
        role: msg.direction === 'incoming' ? 'user' : 'assistant',
        content: [
          {
            type: 'input_text',
            text: msg.content,
          },
        ],
      }));

      this.logger.log('Workflow context prepared', {
        historyMessages: conversationHistory.length,
        totalMessages: conversationHistory.length + 1, // +1 for current message
      });

      // Run workflow with history
      const result = await runWorkflow({
        input_as_text: message,
        conversationHistory,
      });

      this.logger.log('Workflow completed successfully');

      // Extract response text
      const response = result.output_text || 'No response generated';

      // TODO: Extract products from workflow execution
      // The workflow doesn't currently track products like the old system
      // This will need to be implemented if product tracking is required
      const products: Array<OdooProductSimplified | NuvemshopProductSimplified> = [];

      return { response, products };
    } catch (error) {
      this.logger.error('Workflow error', error.stack);
      throw new Error(`Workflow AI Service Error: ${error.message}`);
    }
  }
}
