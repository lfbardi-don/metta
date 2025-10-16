import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Agent, run } from '@openai/agents';
import { AGENT_INSTRUCTIONS } from './prompts';
import { IncomingMessage, MessageContext } from '../../common/interfaces';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { OdooService } from '../integrations/odoo/odoo.service';

@Injectable()
export class AIService implements OnModuleInit {
  private readonly logger = new Logger(AIService.name);
  private customerServiceAgent: Agent;

  constructor(
    private readonly guardrailsService: GuardrailsService,
    private readonly odooService: OdooService,
  ) {}

  async onModuleInit() {
    // TODO: Create tools from OdooService methods
    // const tools = this.createOdooTools();

    this.customerServiceAgent = new Agent({
      name: 'Customer Service Agent',
      instructions: AGENT_INSTRUCTIONS,
      model: 'gpt-4o-mini',
      // tools: tools, // TODO: Add tools when implemented
    });

    this.logger.log('AI Agent initialized');
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
      this.logger.warn('Input validation failed', { checks: inputValidation.checks });
      throw new Error('Message blocked by guardrails');
    }

    // 2. Process with AI agent
    const response = await this.chat(message.content, context);

    // 3. Validate output with guardrails
    const outputValidation = await this.guardrailsService.validateOutput(
      response,
      context,
    );

    if (!outputValidation.allowed) {
      this.logger.warn('Output validation failed', { checks: outputValidation.checks });
      throw new Error('Response blocked by guardrails');
    }

    return response;
  }

  /**
   * Internal chat method that calls the AI agent
   */
  private async chat(
    message: string,
    context?: MessageContext,
  ): Promise<string> {
    try {
      this.logger.log('Processing message with AI agent');

      const response = await run(this.customerServiceAgent, message);
      const output = response.finalOutput || 'No response generated';

      return output;
    } catch (error) {
      this.logger.error('AI Service Error', error);
      throw new Error(`AI Service Error: ${error.message}`);
    }
  }

  /**
   * Create tools from OdooService methods
   * These tools will be available to the AI agent
   */
  private createOdooTools(): any[] {
    // TODO: Implement tool creation
    // Convert OdooService methods into @openai/agents tool format
    // Each tool should have: name, description, parameters schema, and function

    /*
    Example tool structure:
    {
      name: 'getProduct',
      description: 'Get product details from Odoo by product ID',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'number', description: 'Product ID' }
        },
        required: ['productId']
      },
      function: async (params) => {
        return await this.odooService.getProduct(params.productId);
      }
    }
    */

    return [];
  }
}
