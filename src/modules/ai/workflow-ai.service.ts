import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentInputItem } from '@openai/agents';
import { runWorkflow } from './workflows/customer-service.workflow';
import {
  IncomingMessage,
  MessageContext,
  ConversationState,
  ProductMention,
  CustomerGoal,
  GoalType,
  findProductByName,
} from '../../common/interfaces';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { getGuardrailFallbackMessage } from '../guardrails/guardrail-messages.constant';
import { PersistenceService } from '../persistence/persistence.service';
import { PrismaService } from '../persistence/prisma.service';
import { resolvePIIPlaceholders } from '../../common/helpers/resolve-pii.helper';
import { ProductPresentationService } from './product-presentation.service';
import { GoalDetectionService } from './services/goal-detection.service';

/**
 * Response from AI service with text and optional product images
 * Note: Workflow currently returns empty products array
 */
export interface AIServiceResponse {
  response: string;
  products: Array<any>;
  metadata?: Record<string, any>;
  initialState?: ConversationState['state'] | null; // State before processing (for incoming message audit trail)
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
    private readonly goalDetectionService: GoalDetectionService,
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

    // 3.5. Get active goal from conversation state (if it exists)
    const existingGoal = conversationState?.state?.activeGoal;
    if (existingGoal) {
      // Normalize Date fields (they come as strings from JSON)
      if (typeof existingGoal.startedAt === 'string') {
        existingGoal.startedAt = new Date(existingGoal.startedAt);
      }
      if (existingGoal.completedAt && typeof existingGoal.completedAt === 'string') {
        existingGoal.completedAt = new Date(existingGoal.completedAt);
      }
      if (typeof existingGoal.lastActivityAt === 'string') {
        existingGoal.lastActivityAt = new Date(existingGoal.lastActivityAt);
      }

      this.logger.log(`Found existing goal: ${existingGoal.type}`, {
        goalId: existingGoal.goalId,
        status: existingGoal.status,
      });
    }

    // 4. Process with workflow (pass existing goal as context if available)
    const workflowResult = await this.runWorkflow(
      resolvedContent,
      context,
      dbMessages,
      conversationState,
      existingGoal || null,
    );

    const { response, products } = workflowResult;

    // 4.5. Extract classifier intent from workflow result (real AI classification)
    const classifierIntent = workflowResult.classifierIntent || 'OTHERS';
    this.logger.log(`Classifier intent from workflow: ${classifierIntent}`);

    // 4.6. Detect or continue customer goal using REAL classifier result
    const goal = this.goalDetectionService.detectGoal(
      message.content,
      classifierIntent,
      context.conversationHistory || [],
      conversationState,
    );

    // Capture initial state (BEFORE goal update) for incoming message audit trail
    const initialState: ConversationState['state'] = {
      products: conversationState?.state?.products || [],
      activeGoal: existingGoal || null,
      recentGoals: conversationState?.state?.recentGoals || [],
      lastTopic: conversationState?.state?.lastTopic,
      summary: conversationState?.state?.summary,
    };

    // 4.7. Update goal state after processing (SIMPLIFIED - no complex step tracking)
    if (goal) {
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

      this.logger.log(`Goal state updated: ${goal.type}`, {
        goalId: goal.goalId,
        progressMarkers: goal.progressMarkers?.length || 0,
      });
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
      metadata: {
        state: finalConversationState?.state || { products: [] },
      },
      initialState, // State before processing (for incoming message audit trail)
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
  ): Promise<AIServiceResponse & { classifierIntent?: string }> {
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

      // Run workflow with history, state, presentation instructions, and goal context
      const result = await runWorkflow({
        input_as_text: message,
        conversationHistory,
        conversationState: conversationState || undefined,
        presentationMode,
        presentationInstructions,
        goal, // SIMPLIFIED: Pass goal instead of useCase
        // Note: No useCaseInstructions - agent decides behavior based on goal type
      });

      this.logger.log('Workflow completed successfully');

      // Extract response text
      const response = result.output_text || 'No response generated';

      // Empty products array (product mentions extracted separately)
      const products: Array<any> = [];

      // Extract product mentions from MCP tool calls (real IDs) or text (fallback)
      let productMentions: ProductMention[] = [];

      // Primary: Extract from MCP tool calls (has real product IDs)
      if (result.newItems && result.newItems.length > 0) {
        productMentions = this.extractProductsFromToolCalls(result.newItems);

        if (productMentions.length > 0) {
          this.logger.log(
            `Extracted ${productMentions.length} product(s) from MCP tool calls`,
            {
              productIds: productMentions.map((p) => ({
                id: p.productId,
                name: p.productName,
              })),
            },
          );
        } else {
          this.logger.warn(
            'No products found in tool calls, falling back to text extraction',
          );
        }
      } else {
        this.logger.warn(
          'No newItems in workflow result, using text extraction',
        );
      }

      // Fallback: Extract from text if no tool calls found
      // (e.g., when FAQ Agent or Greetings Agent responds)
      if (productMentions.length === 0) {
        productMentions = this.extractProductMentions(response, conversationState);
        if (productMentions.length > 0) {
          this.logger.log(
            `Using text extraction fallback - matched ${productMentions.length} product(s) from conversation state`,
          );
        }
      }

      // Update conversation state with new product mentions
      if (productMentions.length > 0) {
        await this.persistenceService.updateConversationState(
          context.conversationId,
          productMentions,
        );
      }

      // Retrieve conversation state to include in message metadata
      const updatedConversationState =
        await this.persistenceService.getConversationState(
          context.conversationId,
        );

      return {
        response,
        products,
        classifierIntent: result.classifierIntent,
        metadata: {
          state: updatedConversationState?.state || { products: [] },
        },
      };
    } catch (error) {
      this.logger.error('Workflow error', error.stack);
      throw new Error(`Workflow AI Service Error: ${error.message}`);
    }
  }

  /**
   * Extract product mentions from the workflow response (text fallback)
   *
   * Parses the markdown response to find product cards and extract product information.
   * Product cards follow this format:
   *   ![PRODUCT NAME](image_url)
   *   **PRODUCT NAME**
   *   Precio: $XX,XXX | ...
   *
   * This is a FALLBACK method used when MCP tool extraction fails (e.g., FAQ or Greetings agents).
   * It looks up products by name in the conversation state to get real IDs.
   * Products not found in state are SKIPPED (no productId: 0 entries created).
   *
   * @param response - The workflow response text
   * @param conversationState - Current conversation state to lookup products by name
   * @returns Array of ProductMention objects with real IDs from conversation state
   */
  private extractProductMentions(
    response: string,
    conversationState: ConversationState | null | undefined,
  ): ProductMention[] {
    const productMentions: ProductMention[] = [];

    try {
      // Pattern to match product cards with bold product names
      // Matches: **PRODUCT NAME** or **PRODUCT NAME (details)**
      const productNamePattern = /\*\*([A-Z][A-Z\s]+(?:\([^)]+\))?)\*\*/g;

      const matches = Array.from(response.matchAll(productNamePattern));

      for (const match of matches) {
        const productName = match[1].trim();

        // Skip generic headings (not product names)
        if (
          productName.length < 5 ||
          productName.toLowerCase().includes('importante')
        ) {
          continue;
        }

        // Look up product in conversation state by name (fuzzy match)
        const existingProduct = findProductByName(conversationState, productName);

        if (existingProduct) {
          // Found in state - use real product ID
          productMentions.push({
            productId: existingProduct.productId,
            productName: existingProduct.productName, // Use canonical name from state
            mentionedAt: new Date(),
            context: 'recommendation',
          });
        } else {
          // Not found in state - skip (don't create invalid entries)
          this.logger.debug(
            `Product "${productName}" found in text but not in conversation state - skipping`,
          );
        }
      }

      // Deduplicate by product ID
      const uniqueMentions = productMentions.filter(
        (mention, index, self) =>
          index === self.findIndex((m) => m.productId === mention.productId),
      );

      return uniqueMentions;
    } catch (error) {
      this.logger.error('Failed to extract product mentions', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Extract products from MCP tool calls (real product IDs)
   *
   * Parses newItems array from workflow execution to find MCP product tool calls
   * and extracts actual product IDs from their responses.
   *
   * This solves the hallucination problem: instead of extracting product names from
   * markdown text (which loses the IDs), we get the real IDs directly from MCP responses.
   *
   * @param newItems - Array of RunItem from workflow execution
   * @returns Array of ProductMention objects with real product IDs
   */
  private extractProductsFromToolCalls(newItems: any[]): ProductMention[] {
    const productMentions: ProductMention[] = [];
    const now = new Date();

    try {
      // Filter for tool call items with mcp_call and output
      const toolOutputs = newItems.filter(
        (item) =>
          item?.type === 'tool_call_item' &&
          item?.rawItem?.name === 'mcp_call' &&
          item?.rawItem?.output,
      );

      for (const item of toolOutputs) {
        // Get actual MCP tool name from providerData (not 'mcp_call' wrapper)
        const toolName = item.rawItem?.providerData?.name;

        // Only process product-related MCP tools
        if (!toolName || !toolName.includes('nuvemshop_product')) {
          continue;
        }

        // Parse tool output (could be string or object)
        let toolResult;
        if (typeof item.rawItem.output === 'string') {
          try {
            toolResult = JSON.parse(item.rawItem.output);
          } catch (parseError) {
            this.logger.warn(`Failed to parse tool output for ${toolName}`, {
              error: parseError.message,
              outputPreview: item.rawItem.output?.substring(0, 200),
            });
            continue;
          }
        } else {
          toolResult = item.rawItem.output;
        }

        // Extract products based on tool type
        if (toolName === 'search_nuvemshop_products') {
          // Search returns array or { products: [...] }
          const products = Array.isArray(toolResult)
            ? toolResult
            : toolResult.products || [];

          for (const product of products) {
            if (product.id && product.name) {
              productMentions.push({
                productId: product.id,
                productName: product.name,
                mentionedAt: now,
                context: 'search',
              });
            }
          }
        } else if (
          toolName === 'get_nuvemshop_product' ||
          toolName === 'get_nuvemshop_product_by_sku'
        ) {
          // Get returns single product object
          if (toolResult.id && toolResult.name) {
            productMentions.push({
              productId: toolResult.id,
              productName: toolResult.name,
              mentionedAt: now,
              context: 'question',
            });
          }
        }
      }

      // Deduplicate by product ID
      const uniqueMentions = productMentions.filter(
        (mention, index, self) =>
          index === self.findIndex((m) => m.productId === mention.productId),
      );

      return uniqueMentions;
    } catch (error) {
      this.logger.error('Failed to extract products from tool calls', {
        error: error.message,
      });
      return [];
    }
  }

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

}
