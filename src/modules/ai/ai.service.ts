import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Agent, run, user, tool, assistant } from '@openai/agents';
import { z } from 'zod';
import { TRIAGE_PROMPT, ORDERS_PROMPT, PRODUCTS_PROMPT } from './prompts';
import { IncomingMessage, MessageContext } from '../../common/interfaces';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { OdooService } from '../integrations/odoo/odoo.service';
import { PersistenceService } from '../persistence/persistence.service';

@Injectable()
export class AIService implements OnModuleInit {
  private readonly logger = new Logger(AIService.name);
  private triageAgent: Agent;

  constructor(
    private readonly guardrailsService: GuardrailsService,
    private readonly odooService: OdooService,
    private readonly persistenceService: PersistenceService,
  ) { }

  /**
   * Create mock order tools for testing handoffs
   * TODO: Replace with real Odoo tools when integration is ready
   */
  private createMockOrderTools() {
    const getOrderTool = tool({
      name: 'get_order',
      description:
        'Get order details and tracking by order number. Returns status, items, delivery info.',
      parameters: z.object({
        orderNumber: z
          .string()
          .describe('The order number (e.g., SO001234)'),
      }),
      execute: async (input) => {
        this.logger.log(`[MOCK] Getting order: ${input.orderNumber}`);
        // Mock data - replace with real OdooService call later
        return JSON.stringify({
          id: 123,
          orderNumber: input.orderNumber,
          status: 'Em trânsito',
          items: [
            {
              productId: 1,
              productName: 'Produto Teste',
              quantity: 2,
              price: 99.9,
            },
          ],
          total: 199.8,
          customer: { name: 'Cliente Teste', email: 'test@example.com' },
          createdAt: new Date().toISOString(),
        });
      },
    });

    const getOrdersByCustomerTool = tool({
      name: 'get_orders_by_customer',
      description:
        'Get all orders for a customer by email address. Returns order history.',
      parameters: z.object({
        email: z.string().email().describe('Customer email address'),
      }),
      execute: async (input) => {
        this.logger.log(
          `[MOCK] Getting orders for customer: ${input.email}`,
        );
        // Mock data - return array of orders
        return JSON.stringify([
          { orderNumber: 'SO001', status: 'Entregue', total: 150.0 },
          { orderNumber: 'SO002', status: 'Em processamento', total: 200.0 },
        ]);
      },
    });

    return [getOrderTool, getOrdersByCustomerTool];
  }

  /**
   * Create mock product tools for testing handoffs
   * TODO: Replace with real Odoo tools when integration is ready
   */
  private createMockProductTools() {
    const getProductTool = tool({
      name: 'get_product',
      description:
        'Get product details by product ID. Returns name, price, stock, description.',
      parameters: z.object({
        productId: z.number().int().describe('Product ID'),
      }),
      execute: async (input) => {
        this.logger.log(`[MOCK] Getting product: ${input.productId}`);
        // Mock data
        return JSON.stringify({
          id: input.productId,
          name: 'Produto Exemplo',
          price: 199.9,
          stock: 45,
          description: 'Descrição do produto teste',
          category: 'Eletrônicos',
        });
      },
    });

    const searchProductsTool = tool({
      name: 'search_products',
      description:
        'Search products by keyword. Returns list of matching products with prices and availability.',
      parameters: z.object({
        query: z.string().min(2).describe('Product name or search keyword'),
      }),
      execute: async (input) => {
        this.logger.log(`[MOCK] Searching products: ${input.query}`);
        // Mock data - return array
        return JSON.stringify([
          { id: 1, name: `${input.query} Premium`, price: 299.9, stock: 10 },
          { id: 2, name: `${input.query} Básico`, price: 149.9, stock: 25 },
        ]);
      },
    });

    return [getProductTool, searchProductsTool];
  }

  async onModuleInit() {
    this.logger.log('Initializing multi-agent system with handoffs...');

    // Create mock tools (will be replaced with real Odoo tools later)
    const orderTools = this.createMockOrderTools();
    const productTools = this.createMockProductTools();

    // Create specialist agents
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
    this.triageAgent = Agent.create({
      name: 'Triage Agent',
      instructions: TRIAGE_PROMPT,
      handoffs: [ordersAgent, productsAgent],
      model: 'gpt-4o-mini',
    });

    // Enable bidirectional handoffs
    ordersAgent.handoffs = [this.triageAgent, productsAgent];
    productsAgent.handoffs = [this.triageAgent, ordersAgent];

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

    // 2. Process with AI agent
    const response = await this.chat(message.content, context);

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

    return response;
  }

  /**
   * Convert database messages to OpenAI Agents SDK format
   */
  private convertToOpenAIFormat(messages: any[]): any[] {
    return messages.map((msg) => msg.direction === 'incoming' ? user(msg.content) : assistant(msg.content));
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

      const result = await run(this.triageAgent, messagesWithNewInput);

      this.logger.log('Agent system completed successfully');

      return result.finalOutput || 'No response generated';
    } catch (error) {
      this.logger.error('Multi-agent error', error.stack);
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
