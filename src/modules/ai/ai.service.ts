import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, run, user, assistant } from '@openai/agents';
import { TRIAGE_PROMPT, ORDERS_PROMPT, PRODUCTS_PROMPT } from './prompts';
import {
  IncomingMessage,
  MessageContext,
  AgentContext,
  OdooProductSimplified,
  NuvemshopProductSimplified,
} from '../../common/interfaces';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { getGuardrailFallbackMessage } from '../guardrails/guardrail-messages.constant';
import { OdooService } from '../integrations/odoo/odoo.service';
import { NuvemshopService } from '../integrations/nuvemshop/nuvemshop.service';
import { PersistenceService } from '../persistence/persistence.service';
import { AuthenticationService } from '../authentication/authentication.service';
import { getProductTools, getOrderTools } from './tools/odoo-tools';
import {
  getNuvemshopProductTools,
  getNuvemshopOrderTools,
  getNuvemshopCategoryTools,
  getNuvemshopPromotionTools,
  getNuvemshopStoreTools,
  getNuvemshopFulfillmentTools,
} from './tools/nuvemshop-tools';
import { verifyDNITool, checkAuthStatusTool } from './tools/authentication';

/**
 * Response from AI service with text and optional product images
 */
export interface AIServiceResponse {
  response: string;
  products: Array<OdooProductSimplified | NuvemshopProductSimplified>;
}

@Injectable()
export class AIService implements OnModuleInit {
  private readonly logger = new Logger(AIService.name);
  private triageAgent: Agent;
  private productIntegration: 'odoo' | 'nuvemshop';

  constructor(
    private readonly configService: ConfigService,
    private readonly guardrailsService: GuardrailsService,
    private readonly odooService: OdooService,
    private readonly nuvemshopService: NuvemshopService,
    private readonly persistenceService: PersistenceService,
    private readonly authenticationService: AuthenticationService,
  ) { }

  async onModuleInit() {
    this.logger.log('Initializing multi-agent system with handoffs...');

    // Read feature flag to determine which product integration to use
    this.productIntegration = this.configService.get<string>('PRODUCT_INTEGRATION', 'nuvemshop') as 'odoo' | 'nuvemshop';

    this.logger.log(`Product integration: ${this.productIntegration.toUpperCase()}`);

    // Get tools based on feature flag (applies to both products AND orders)
    // For Nuvemshop, combine order tools with fulfillment tools (tracking, payment history)
    // ALWAYS add authentication tools for securing order access
    const orderTools = this.productIntegration === 'nuvemshop'
      ? [
          verifyDNITool,
          checkAuthStatusTool,
          ...getNuvemshopOrderTools(),
          ...getNuvemshopFulfillmentTools(),
        ]
      : [
          verifyDNITool,
          checkAuthStatusTool,
          ...getOrderTools(),
        ];

    // For Nuvemshop, combine product tools with category and promotion tools
    const productTools = this.productIntegration === 'nuvemshop'
      ? [
          ...getNuvemshopProductTools(),
          ...getNuvemshopCategoryTools(),
          ...getNuvemshopPromotionTools(),
        ]
      : getProductTools();

    // For Nuvemshop, add store tools to Triage Agent for general info questions
    const triageTools = this.productIntegration === 'nuvemshop'
      ? getNuvemshopStoreTools()
      : [];

    this.logger.log(`Assigned ${orderTools.length} tools to Orders Agent (${this.productIntegration})`);
    this.logger.log(`Assigned ${productTools.length} tools to Products Agent (${this.productIntegration})`);
    this.logger.log(`Assigned ${triageTools.length} tools to Triage Agent (${this.productIntegration})`);

    // Create specialist agents
    // Note: No outputType - agents return plain text per prompt instructions
    const ordersAgent = new Agent({
      name: 'Orders Agent',
      instructions: ORDERS_PROMPT,
      handoffDescription:
        'Specialist for order tracking, delivery status, order modifications, returns. Transfer here when customer asks about their orders or deliveries.',
      tools: orderTools,
      model: 'gpt-4o-mini',
    });

    const productsAgent = new Agent({
      name: 'Products Agent',
      instructions: PRODUCTS_PROMPT,
      handoffDescription:
        'Specialist for product information, pricing, availability, recommendations. Transfer here when customer asks about products, prices, or stock.',
      tools: productTools,
      model: 'gpt-4o-mini',
    });

    // Create triage agent (entry point)
    // For Nuvemshop, Triage Agent has store info tools for general questions
    // All agents rely on prompt engineering for clean output format
    this.triageAgent = new Agent({
      name: 'Triage Agent',
      instructions: TRIAGE_PROMPT,
      handoffs: [ordersAgent, productsAgent],
      tools: triageTools,
      model: 'gpt-4o-mini',
    });

    // Enable bidirectional handoffs
    // Note: Using 'as any' due to SDK limitation with circular Agent type references
    ordersAgent.handoffs = [this.triageAgent as any, productsAgent];
    productsAgent.handoffs = [this.triageAgent as any, ordersAgent];

    this.logger.log(
      'Multi-agent system ready: Triage → [Orders Agent, Products Agent]',
    );
  }

  /**
   * Process multiple incoming messages together (batched)
   * This is used when multiple messages arrive in quick succession
   *
   * @param messages - Array of incoming messages (in chronological order)
   * @returns Single AI response addressing all messages
   */
  async processMessages(messages: IncomingMessage[]): Promise<AIServiceResponse> {
    if (messages.length === 0) {
      throw new Error('processMessages called with empty array');
    }

    // Process using the last (most recent) message as the primary one
    // All messages will be saved to conversation history before processing
    const lastMessage = messages[messages.length - 1];

    return this.processMessage(lastMessage);
  }

  /**
   * Process an incoming message through the AI agent
   * This is the main entry point for the AI module
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

    // 2. Process with AI agent (pass dbMessages to avoid re-fetching)
    const { response, products } = await this.chat(
      contentToProcess,
      context,
      dbMessages,
    );

    // 3. Validate output with guardrails (context includes conversationHistory)
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
   * Convert database messages to OpenAI Agents SDK format
   */
  private convertToOpenAIFormat(messages: any[]): any[] {
    return messages.map((msg) =>
      msg.direction === 'incoming' ? user(msg.content) : assistant(msg.content),
    );
  }

  /**
   * Internal chat method that calls the multi-agent system with conversation history
   * Starts with Triage Agent, which may handoff to specialist agents
   *
   * Note: Current message is already saved to DB before this method is called (in queue.processor),
   * but we fetch history excluding it and add it explicitly to maintain clean separation
   * between "historical context from DB" and "current user input being processed"
   */
  private async chat(
    message: string,
    context?: MessageContext,
    dbMessages?: any[],
  ): Promise<AIServiceResponse> {
    try {
      if (!context?.conversationId) {
        throw new Error('conversationId is required for chat');
      }

      this.logger.log('Starting multi-agent routing', {
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

      const history = this.convertToOpenAIFormat(historyMessages);

      // Add current message explicitly (clean separation: history + current input)
      const messagesToProcess = [...history, user(message)];

      this.logger.log('Agent context prepared', {
        historyMessages: history.length,
        totalMessages: messagesToProcess.length,
      });

      // Create agent context with services and PII metadata
      const agentContext: AgentContext = {
        conversationId: context.conversationId,
        contactId: context.contactId,
        services: {
          odooService: this.odooService,
          nuvemshopService: this.nuvemshopService,
          authenticationService: this.authenticationService,
          logger: this.logger,
        },
        metadata: context.metadata,
        piiMetadata: context.piiMetadata, // Pass PII metadata for tool resolution
        returnedProducts: [], // Initialize empty array for product tracking
      };

      // Run agent with context for tool injection
      const result = await run(this.triageAgent, messagesToProcess, {
        context: agentContext,
      });

      this.logger.log('Agent system completed successfully');

      // finalOutput is plain string - agents follow prompt instructions for clean format
      const response = result.finalOutput || 'No response generated';

      // Extract products from context (populated by tools during execution)
      const products = agentContext.returnedProducts || [];

      this.logger.log(
        `Extracted ${products.length} product(s) from agent execution`,
      );

      return { response, products };
    } catch (error) {
      this.logger.error('Multi-agent error', error.stack);
      throw new Error(`AI Service Error: ${error.message}`);
    }
  }

}
