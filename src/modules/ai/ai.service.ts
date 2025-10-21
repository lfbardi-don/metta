import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Agent, run, user, assistant } from '@openai/agents';
import { TRIAGE_PROMPT, ORDERS_PROMPT, PRODUCTS_PROMPT } from './prompts';
import {
  IncomingMessage,
  MessageContext,
  AgentContext,
} from '../../common/interfaces';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { OdooService } from '../integrations/odoo/odoo.service';
import { PersistenceService } from '../persistence/persistence.service';
import { getProductTools, getOrderTools } from './tools/odoo-tools';

@Injectable()
export class AIService implements OnModuleInit {
  private readonly logger = new Logger(AIService.name);
  private triageAgent: Agent;

  constructor(
    private readonly guardrailsService: GuardrailsService,
    private readonly odooService: OdooService,
    private readonly persistenceService: PersistenceService,
  ) { }

  async onModuleInit() {
    this.logger.log('Initializing multi-agent system with handoffs...');

    // Get tools using new tool creation pattern
    const orderTools = getOrderTools();
    const productTools = getProductTools();

    this.logger.log(`Assigned ${orderTools.length} tools to Orders Agent`);
    this.logger.log(`Assigned ${productTools.length} tools to Products Agent`);

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
    // All agents rely on prompt engineering for clean output format
    this.triageAgent = new Agent({
      name: 'Triage Agent',
      instructions: TRIAGE_PROMPT,
      handoffs: [ordersAgent, productsAgent],
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
   * Process an incoming message through the AI agent
   * This is the main entry point for the AI module
   */
  async processMessage(message: IncomingMessage): Promise<string> {
    const context: MessageContext = {
      conversationId: message.conversationId,
      contactId: message.contactId,
      metadata: message.metadata,
    };

    // 1. Validate input with guardrails
    const inputValidation = await this.guardrailsService.validateInput(
      message.content,
      context,
    );

    if (!inputValidation.allowed) {
      this.logger.warn('Input validation failed', {
        checks: inputValidation.checks,
      });
      throw new Error('Message blocked by guardrails');
    }

    // Use sanitized content if PII was detected and masked
    const contentToProcess = inputValidation.sanitizedContent ?? message.content;

    if (inputValidation.sanitizedContent) {
      this.logger.log('Using sanitized input (PII masked)');
    }

    // 2. Process with AI agent
    const response = await this.chat(contentToProcess, context);

    // 3. Validate output with guardrails
    const outputValidation = await this.guardrailsService.validateOutput(
      response,
      context,
    );

    if (!outputValidation.allowed) {
      this.logger.warn('Output validation failed', {
        checks: outputValidation.checks,
      });
      throw new Error('Response blocked by guardrails');
    }

    // Use sanitized output if PII was detected and masked
    const finalResponse = outputValidation.sanitizedContent ?? response;

    if (outputValidation.sanitizedContent) {
      this.logger.log('Using sanitized output (PII masked)');
    }

    return finalResponse;
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
   */
  private async chat(
    message: string,
    context?: MessageContext,
  ): Promise<string> {
    try {
      if (!context?.conversationId) {
        throw new Error('conversationId is required for chat');
      }

      this.logger.log('Starting multi-agent routing', {
        conversationId: context.conversationId,
      });

      const dbMessages =
        await this.persistenceService.getMessagesByConversation(
          context.conversationId,
        );

      const history = this.convertToOpenAIFormat(dbMessages);

      const messagesWithNewInput = [...history, user(message)];

      this.logger.log('Agent context prepared', {
        historyMessages: history.length,
        totalMessages: messagesWithNewInput.length,
      });

      // Create agent context with services
      const agentContext: AgentContext = {
        conversationId: context.conversationId,
        contactId: context.contactId,
        services: {
          odooService: this.odooService,
          logger: this.logger,
        },
        metadata: context.metadata,
      };

      // Run agent with context for tool injection
      const result = await run(this.triageAgent, messagesWithNewInput, {
        context: agentContext,
      });

      this.logger.log('Agent system completed successfully');

      // finalOutput is plain string - agents follow prompt instructions for clean format
      return result.finalOutput || 'No response generated';
    } catch (error) {
      this.logger.error('Multi-agent error', error.stack);
      throw new Error(`AI Service Error: ${error.message}`);
    }
  }

}
