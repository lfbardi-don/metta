import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentInputItem } from '@openai/agents';
import { runWorkflow } from './workflows/customer-service.workflow';
import {
  IncomingMessage,
  MessageContext,
  ConversationState,
  ProductMention,
  OrderMention,
  CustomerGoal,
  GoalType,
  CustomerAuthState,
} from '../../common/interfaces';
import {
  UseCase,
  UseCaseStatus,
  UseCaseState,
} from '../../common/interfaces/use-case.interface';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { getGuardrailFallbackMessage } from '../guardrails/guardrail-messages.constant';
import { PersistenceService } from '../persistence/persistence.service';
import { PrismaService } from '../persistence/prisma.service';
import { resolvePIIPlaceholders } from '../../common/helpers/resolve-pii.helper';
import { ProductPresentationService } from './product-presentation.service';
import { OrderPresentationService } from './order-presentation.service';
import { ProductExtractionService } from './services/product-extraction.service';
import { UseCaseDetectionService } from './services/use-case-detection.service';
import { USE_CASE_WORKFLOWS } from './config/use-case-workflows.config';

/**
 * Response from AI service with text and optional product images
 * Note: Workflow currently returns empty products array
 */
export interface AIServiceResponse {
  response: string;
  products: Array<any>;
  metadata?: Record<string, any>;
  initialState?: ConversationState['state'] | null; // State before processing (for incoming message audit trail)
  intent?: string; // Detected intent
  thinking?: string; // Chain of thought
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
    private readonly productPresentationService: ProductPresentationService,
    private readonly orderPresentationService: OrderPresentationService,
    private readonly productExtractionService: ProductExtractionService,
    private readonly useCaseDetectionService: UseCaseDetectionService,
    private readonly prisma: PrismaService,
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
    const dbMessages = await this.persistenceService.getMessagesByConversation(
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
    const contentToProcess =
      inputValidation.sanitizedContent ?? message.content;

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

    // 3. Load conversation state (product context tracking)
    const conversationState =
      await this.persistenceService.getConversationState(
        context.conversationId,
      );

    if (conversationState && conversationState.state.products.length > 0) {
      this.logger.log(
        `Loaded conversation state with ${conversationState.state.products.length} product(s)`,
      );
    }

    if (conversationState && conversationState.state.orders?.length > 0) {
      this.logger.log(
        `Loaded conversation state with ${conversationState.state.orders.length} order(s)`,
      );
    }

    // 3.5. Load customer auth state (24-hour window)
    // Try to get email from PII metadata or previous orders
    let authState: CustomerAuthState | null = null;
    const customerEmail = this.extractEmailFromContext(context, conversationState);

    if (customerEmail) {
      authState = await this.persistenceService.getCustomerAuth(customerEmail);
      if (authState) {
        this.logger.log('Customer already authenticated', {
          email: customerEmail,
          expiresAt: authState.expiresAt,
        });
      }
    }

    // Capture initial state (BEFORE processing) for incoming message
    const initialState: ConversationState['state'] = {
      products: conversationState?.state?.products || [],
      orders: conversationState?.state?.orders || [],
      activeGoal: conversationState?.state?.activeGoal || null,
      recentGoals: conversationState?.state?.recentGoals || [],
      lastTopic: conversationState?.state?.lastTopic,
      summary: conversationState?.state?.summary,
      useCases: conversationState?.state?.useCases || {
        activeCases: [],
        completedCases: [],
      },
    };

    // 4. Process with workflow
    // We pass the current active goal if it exists, to provide context
    const workflowResult = await this.runWorkflow(
      resolvedContent,
      context,
      dbMessages,
      conversationState,
      conversationState?.state?.activeGoal,
      authState,
    );

    const { response, products, intent, thinking } = workflowResult;

    // 4.5. Detect or update customer goal based on AI's detected intent
    const goal = this.useCaseDetectionService.detectGoal(
      message.content,
      intent || 'OTHERS',
      context.conversationHistory || [],
      conversationState,
    );

    if (goal) {
      // Normalize Date fields
      if (typeof goal.startedAt === 'string') goal.startedAt = new Date(goal.startedAt);
      if (goal.completedAt && typeof goal.completedAt === 'string') goal.completedAt = new Date(goal.completedAt);
      if (typeof goal.lastActivityAt === 'string') goal.lastActivityAt = new Date(goal.lastActivityAt);

      this.logger.log(`Goal detected/updated: ${goal.type}`, {
        goalId: goal.goalId,
        status: goal.status,
        intent,
      });

      // Add simple progress marker based on response
      await this.addSimpleProgressMarkers(goal, response, products);

      // Save goal state to database
      await this.persistenceService.setActiveGoal(context.conversationId, goal);

      // Update conversation summary if this was a significant interaction
      if (this.isSignificantInteraction(goal, response)) {
        const summary = this.generateSimpleSummary(goal, response);
        await this.persistenceService.updateSummary(
          context.conversationId,
          summary,
        );
      }
    }

    // 5. Validate output with guardrails (context includes conversationHistory)
    const outputValidation = await this.guardrailsService.validateOutput(
      response,
      context,
    );

    if (!outputValidation.allowed) {
      this.logger.warn(
        'Output validation failed - returning fallback message',
        {
          conversationId: context.conversationId,
          failedChecks: outputValidation.checks
            .filter((c) => !c.passed)
            .map((c) => c.type),
        },
      );

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

    // 6. Reload conversation state to get LATEST use case state (after save)
    const finalConversationState = await this.persistenceService.getConversationState(
      context.conversationId,
    );

    return {
      response: finalResponse,
      products,
      intent,
      thinking,
      metadata: {
        state: finalConversationState?.state || { products: [], useCases: { activeCases: [], completedCases: [] } },
      },
      initialState, // State before processing
    };
  }

  /**
   * Internal method that calls the workflow with conversation history and state
   *
   * Note: Current message is already saved to DB before this method is called (in queue.processor),
   * but we fetch history excluding it and add it explicitly to maintain clean separation
   * between "historical context from DB" and "current user input being processed"
   */
  private async runWorkflow(
    message: string,
    context?: MessageContext,
    dbMessages?: any[],
    conversationState?: ConversationState | null,
    goal?: CustomerGoal | null,
    authState?: CustomerAuthState | null,
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
      // Note: User messages use 'input_text', assistant messages use 'output_text'
      const conversationHistory: AgentInputItem[] = historyMessages.map(
        (msg) => {
          const role =
            msg.direction === 'incoming'
              ? ('user' as const)
              : ('assistant' as const);

          return {
            role,
            content:
              role === 'user'
                ? [{ type: 'input_text' as const, text: msg.content }]
                : [{ type: 'output_text' as const, text: msg.content }],
          } as AgentInputItem;
        },
      );

      this.logger.log('Workflow context prepared', {
        historyMessages: conversationHistory.length,
        totalMessages: conversationHistory.length + 1, // +1 for current message
        hasState: !!conversationState,
        stateProductsCount: conversationState?.state?.products?.length || 0,
      });

      // 5. Detect product presentation context
      const queryContext = this.productPresentationService.detectQueryContext(
        message,
        conversationState || null,
      );

      const presentationMode =
        this.productPresentationService.determinePresentationMode(
          queryContext,
          conversationState || null,
        );

      const presentationInstructions =
        this.productPresentationService.generatePresentationInstructions(
          presentationMode,
          queryContext.mentionedProducts,
        );

      this.logger.log('Product presentation context determined', {
        queryType: queryContext.type,
        presentationMode,
        mentionedProducts: queryContext.mentionedProducts.length,
        isFollowUp: queryContext.isFollowUp,
      });

      // 6. Detect order presentation context
      const orderQueryContext = this.orderPresentationService.detectQueryContext(
        message,
        conversationState || null,
      );

      const orderPresentationMode =
        this.orderPresentationService.determinePresentationMode(
          orderQueryContext,
          conversationState || null,
        );

      const orderPresentationInstructions =
        this.orderPresentationService.generatePresentationInstructions(
          orderPresentationMode,
          orderQueryContext.mentionedOrders,
        );

      this.logger.log('Order presentation context determined', {
        queryType: orderQueryContext.type,
        orderPresentationMode,
        mentionedOrders: orderQueryContext.mentionedOrders.length,
        isFollowUp: orderQueryContext.isFollowUp,
        hasAuthState: !!authState,
      });

      // Run workflow with history, state, presentation instructions, auth state, and goal context
      const result = await runWorkflow({
        input_as_text: message,
        conversationHistory,
        conversationState: conversationState || undefined,
        // Product presentation
        presentationMode,
        presentationInstructions,
        // Order presentation (NEW)
        authState: authState || null,
        orderPresentationMode,
        orderPresentationInstructions,
        goal,
      });

      this.logger.log('Workflow completed successfully');

      // Extract structured response
      const output = result.output;
      const response = output.response_text || 'No response generated';
      const intent = output.user_intent;
      const thinking = output.thinking;

      // Extract products from MCP tool calls (real IDs)
      let productMentions: ProductMention[] = [];

      if (result.newItems && result.newItems.length > 0) {
        productMentions = this.productExtractionService.extractProductsFromToolCalls(result.newItems);
      }

      // If no tool calls, check if LLM returned products in structured output
      // (Note: These might lack IDs if not from tools, so we treat them carefully)
      if (productMentions.length === 0 && output.products && output.products.length > 0) {
        productMentions = this.productExtractionService.extractProductsFromStructuredOutput(output.products);
        this.logger.log(`Using structured output products: ${productMentions.length}`);
      }

      // Update conversation state with new product mentions
      if (productMentions.length > 0) {
        await this.persistenceService.updateConversationState(
          context.conversationId,
          productMentions,
        );
      }

      // Extract customer email for order tracking
      const customerEmail = this.extractEmailFromContext(context, conversationState || null);

      // Extract order mentions from tool calls and save to state
      if (result.newItems && result.newItems.length > 0) {
        const orderMentions = this.extractOrderMentionsFromToolCalls(
          result.newItems,
          customerEmail,
        );

        if (orderMentions.length > 0) {
          await this.persistenceService.updateOrderMentions(
            context.conversationId,
            orderMentions,
          );
          this.logger.log(`Saved ${orderMentions.length} order mention(s) to conversation state`);
        }

        // Detect and persist authentication success (24-hour DB session)
        const authResult = this.detectAuthSuccess(result.newItems, customerEmail);
        if (authResult.success && authResult.email) {
          await this.persistenceService.setCustomerAuth(
            authResult.email,
            context.conversationId,
          );
          this.logger.log('Customer authentication saved to DB (24-hour session)', {
            email: authResult.email,
            conversationId: context.conversationId,
          });
        }
      }

      // Retrieve conversation state to include in message metadata
      const updatedConversationState =
        await this.persistenceService.getConversationState(
          context.conversationId,
        );

      return {
        response,
        products: productMentions,
        intent,
        thinking,
        metadata: {
          state: updatedConversationState?.state || { products: [], orders: [] },
        },
      };
    } catch (error) {
      this.logger.error('Workflow error', error.stack);
      throw new Error(`Workflow AI Service Error: ${error.message}`);
    }
  }







  /**
   * Update use case progress based on agent response
   *
   * This implementation marks steps as complete based on keywords and context.
   * It covers all step types defined in use case workflows.
   */
  /**
   * Add simple progress markers to goal (SIMPLIFIED - no brittle keyword matching)
   * Just tracks major milestones based on goal type and presence of products
   */
  private async addSimpleProgressMarkers(
    goal: CustomerGoal,
    response: string,
    products: any[],
  ): Promise<void> {
    if (!goal.progressMarkers) {
      goal.progressMarkers = [];
    }

    const responseLower = response.toLowerCase();

    // Add markers based on goal type and response content
    switch (goal.type) {
      case GoalType.ORDER_INQUIRY:
        if (
          !goal.progressMarkers.includes('order_info_provided') &&
          (responseLower.includes('pedido') || responseLower.includes('orden'))
        ) {
          goal.progressMarkers.push('order_info_provided');
        }
        break;

      case GoalType.PRODUCT_SEARCH:
      case GoalType.PRODUCT_QUESTION:
        if (
          !goal.progressMarkers.includes('products_shown') &&
          products.length > 0
        ) {
          goal.progressMarkers.push('products_shown');
        }
        break;

      case GoalType.STORE_INFO:
        if (!goal.progressMarkers.includes('info_provided')) {
          goal.progressMarkers.push('info_provided');
        }
        break;

      case GoalType.GREETING:
        if (!goal.progressMarkers.includes('greeted')) {
          goal.progressMarkers.push('greeted');
        }
        break;
    }

    // Update lastActivityAt
    goal.lastActivityAt = new Date();
  }

  /**
   * Determine if this interaction is significant enough to update summary
   */
  private isSignificantInteraction(
    goal: CustomerGoal,
    response: string,
  ): boolean {
    // Update summary for order inquiries and product searches
    return (
      goal.type === GoalType.ORDER_INQUIRY ||
      goal.type === GoalType.PRODUCT_SEARCH ||
      goal.type === GoalType.PRODUCT_QUESTION
    );
  }

  /**
   * Generate a simple, human-readable summary
   */
  private generateSimpleSummary(
    goal: CustomerGoal,
    response: string,
  ): string {
    const summaries: Record<GoalType, string> = {
      [GoalType.ORDER_INQUIRY]: `Customer inquiring about order ${goal.context?.orderId || 'details'}`,
      [GoalType.PRODUCT_SEARCH]: `Customer searching for products: ${goal.context?.topic || 'general'}`,
      [GoalType.PRODUCT_QUESTION]: `Customer asking about product details`,
      [GoalType.STORE_INFO]: `Customer asking about store ${goal.context?.topic || 'information'}`,
      [GoalType.GREETING]: `Casual conversation`,
      [GoalType.OTHER]: `General inquiry`,
    };

    return summaries[goal.type] || 'Customer interaction';
  }

  /**
   * DEPRECATED: Old use case progress tracking (kept for backward compatibility)
   * Use addSimpleProgressMarkers() instead
   */
  private updateUseCaseProgress(
    useCase: UseCase,
    response: string,
    context: MessageContext,
  ): void {
    // DEPRECATED - Simplified goal system doesn't use step tracking
    this.logger.warn(
      'updateUseCaseProgress called but deprecated - use goal system instead',
    );
  }

  /**
   * DEPRECATED: Old use case state saving (kept for backward compatibility)
   * Use persistenceService.setActiveGoal() instead
   */
  private async saveUseCaseState(
    conversationId: string,
    useCase: UseCase,
    currentState: ConversationState | null,
  ): Promise<void> {
    // DEPRECATED - Simplified goal system uses different persistence
    this.logger.warn(
      'saveUseCaseState called but deprecated - use goal system instead',
    );
    // Method kept as stub for backward compatibility
    // New code should use: persistenceService.setActiveGoal()
  }

  /**
   * Extract customer email from context (PII metadata or previous orders)
   */
  private extractEmailFromContext(
    context: MessageContext,
    conversationState: ConversationState | null,
  ): string | null {
    // 1. Try to get email from PII metadata (current message)
    if (context.piiMetadata) {
      const emailKeys = Object.keys(context.piiMetadata).filter((k) =>
        k.startsWith('EMAIL_'),
      );
      if (emailKeys.length > 0) {
        const email = context.piiMetadata[emailKeys[0]];
        this.logger.debug('Email found in PII metadata', { email });
        return email;
      }
    }

    // 2. Try to get email from previous orders in conversation state
    if (conversationState?.state?.orders?.length) {
      const mostRecentOrder = conversationState.state.orders[0];
      if (mostRecentOrder.customerEmail) {
        this.logger.debug('Email found in conversation state orders', {
          email: mostRecentOrder.customerEmail,
        });
        return mostRecentOrder.customerEmail;
      }
    }

    // 3. Try to get email from contact metadata
    if (context.metadata?.email) {
      this.logger.debug('Email found in contact metadata', {
        email: context.metadata.email,
      });
      return context.metadata.email;
    }

    return null;
  }

  /**
   * Extract order mentions from workflow tool call results
   */
  extractOrderMentionsFromToolCalls(
    newItems: any[],
    customerEmail: string | null,
  ): OrderMention[] {
    const orderMentions: OrderMention[] = [];

    if (!newItems || newItems.length === 0) {
      return orderMentions;
    }

    for (const item of newItems) {
      // Look for tool call results with order data
      if (item.type === 'tool_call_output' || item.type === 'function_call_output') {
        try {
          const output = typeof item.output === 'string'
            ? JSON.parse(item.output)
            : item.output;

          // Handle single order result
          if (output?.order?.id || output?.id) {
            const order = output.order || output;
            const mention: OrderMention = {
              orderId: String(order.id),
              orderNumber: String(order.number || order.id),
              customerEmail: customerEmail || order.customer?.email || '',
              mentionedAt: new Date(),
              context: this.detectOrderContext(item.name || ''),
              lastStatus: order.status || order.state,
            };
            orderMentions.push(mention);
          }

          // Handle multiple orders result
          if (Array.isArray(output?.orders)) {
            for (const order of output.orders) {
              const mention: OrderMention = {
                orderId: String(order.id),
                orderNumber: String(order.number || order.id),
                customerEmail: customerEmail || order.customer?.email || '',
                mentionedAt: new Date(),
                context: 'inquiry',
                lastStatus: order.status || order.state,
              };
              orderMentions.push(mention);
            }
          }
        } catch (e) {
          // Not JSON or invalid structure, skip
          this.logger.debug('Could not parse tool output for order extraction', { error: e.message });
        }
      }
    }

    this.logger.log(`Extracted ${orderMentions.length} order mention(s) from tool calls`);
    return orderMentions;
  }

  /**
   * Detect order context from tool name
   */
  private detectOrderContext(toolName: string): OrderMention['context'] {
    const nameLower = toolName.toLowerCase();
    if (nameLower.includes('tracking') || nameLower.includes('shipment')) {
      return 'tracking';
    }
    if (nameLower.includes('payment') || nameLower.includes('refund')) {
      return 'payment';
    }
    if (nameLower.includes('return') || nameLower.includes('cancel')) {
      return 'return';
    }
    return 'inquiry';
  }

  /**
   * Detect authentication success from workflow tool call results
   */
  detectAuthSuccess(
    newItems: any[],
    customerEmail: string | null,
  ): { success: boolean; email: string | null } {
    if (!newItems || newItems.length === 0) {
      return { success: false, email: null };
    }

    for (const item of newItems) {
      if (item.type === 'tool_call_output' || item.type === 'function_call_output') {
        const toolName = (item.name || '').toLowerCase();

        // Check for verify_dni or similar auth tools
        if (toolName.includes('verify') || toolName.includes('auth')) {
          try {
            const output = typeof item.output === 'string'
              ? JSON.parse(item.output)
              : item.output;

            // Check for success indicators
            if (
              output?.success === true ||
              output?.verified === true ||
              output?.authenticated === true
            ) {
              // Try to extract email from the auth response
              const authEmail = output?.email || output?.customer?.email || customerEmail;
              this.logger.log('Authentication success detected', {
                toolName,
                email: authEmail,
              });
              return { success: true, email: authEmail };
            }
          } catch (e) {
            // Not JSON or invalid structure, skip
          }
        }
      }
    }

    return { success: false, email: null };
  }
}
