import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentInputItem } from '@openai/agents';
import { runWorkflow } from './workflows/customer-service.workflow';
import {
  IncomingMessage,
  MessageContext,
  ConversationState,
  ProductMention,
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
  initialState?: any; // State before processing (for incoming message audit trail)
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

    // 3.5. Get classifier intent first (need to detect use case)
    const classifierIntent = this.getClassifierIntent(
      resolvedContent,
      context,
      dbMessages,
    );

    this.logger.log(`Classifier intent detected: ${classifierIntent}`);

    // 3.6. Detect or continue use case
    const useCase = this.useCaseDetectionService.detectUseCase(
      message.content,
      classifierIntent,
      context.conversationHistory || [],
      conversationState,
    );

    let useCaseInstructions: string | undefined;
    let initialState: any = null; // State before processing (for incoming message)

    if (useCase) {
      // Normalize Date fields (they come as strings from JSON)
      if (typeof useCase.startedAt === 'string') {
        useCase.startedAt = new Date(useCase.startedAt);
      }
      if (useCase.completedAt && typeof useCase.completedAt === 'string') {
        useCase.completedAt = new Date(useCase.completedAt);
      }
      // Normalize step dates
      useCase.steps.forEach((step) => {
        if (step.completedAt && typeof step.completedAt === 'string') {
          step.completedAt = new Date(step.completedAt);
        }
      });

      this.logger.log(`Processing use case: ${useCase.type}`, {
        useCaseId: useCase.useCaseId,
        status: useCase.status,
        nextStep: this.useCaseDetectionService.getNextStep(useCase)?.stepId,
      });

      // Update use case status to IN_PROGRESS
      useCase.status = UseCaseStatus.IN_PROGRESS;

      // Get workflow instructions for this use case
      const workflow = USE_CASE_WORKFLOWS[useCase.type];
      useCaseInstructions = workflow?.instructions || '';

      // Capture initial state (BEFORE processing) for incoming message
      // This creates a snapshot of the state when the user sent their message
      const tempUseCases: UseCaseState = conversationState?.state?.useCases || {
        activeCases: [],
        completedCases: [],
      };

      // Check if this use case already exists in active cases
      const existingIndex = tempUseCases.activeCases.findIndex(
        (uc) => uc.useCaseId === useCase.useCaseId,
      );

      if (existingIndex >= 0) {
        // Update existing use case
        tempUseCases.activeCases[existingIndex] = useCase;
      } else {
        // Add new use case to active cases
        tempUseCases.activeCases.push(useCase);
      }

      // Construct initial state for incoming message
      initialState = {
        products: conversationState?.state?.products || [],
        useCases: tempUseCases,
      };

      this.logger.log('Initial state captured for incoming message', {
        activeCases: tempUseCases.activeCases.length,
        completedCases: tempUseCases.completedCases.length,
      });
    }

    // 4. Process with workflow (pass dbMessages, state, and use case context)
    const { response, products, metadata: workflowMetadata } = await this.runWorkflow(
      resolvedContent,
      context,
      dbMessages,
      conversationState,
      useCase,
      useCaseInstructions,
    );

    // 4.5. Update use case progress based on agent response
    if (useCase) {
      this.updateUseCaseProgress(useCase, response, context);

      // Check if use case is completed
      if (this.useCaseDetectionService.isUseCaseCompleted(useCase)) {
        useCase.status = UseCaseStatus.COMPLETED;
        useCase.completedAt = new Date();

        this.logger.log(`Use case completed: ${useCase.type}`, {
          useCaseId: useCase.useCaseId,
          duration: useCase.completedAt.getTime() - useCase.startedAt.getTime(),
        });
      }

      // Save use case state (reload to get latest products added during workflow)
      const latestState = await this.persistenceService.getConversationState(
        context.conversationId,
      );
      await this.saveUseCaseState(context.conversationId, useCase, latestState);
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
        state: finalConversationState?.state || { products: [], useCases: { activeCases: [], completedCases: [] } },
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
    useCase?: UseCase | null,
    useCaseInstructions?: string,
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

      // Run workflow with history, state, presentation instructions, and use case context
      const result = await runWorkflow({
        input_as_text: message,
        conversationHistory,
        conversationState: conversationState || undefined,
        presentationMode,
        presentationInstructions,
        useCase,
        useCaseInstructions,
      });

      this.logger.log('Workflow completed successfully');

      // Extract response text
      const response = result.output_text || 'No response generated';

      // TODO: Extract products from workflow execution
      // The workflow doesn't currently track products like the old system
      // This will need to be implemented if product tracking is required
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
        productMentions = this.extractProductMentions(response);
        if (productMentions.length > 0) {
          this.logger.warn(
            `Using text extraction fallback - extracted ${productMentions.length} product(s) without real IDs`,
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
   * Extract product mentions from the workflow response
   *
   * Parses the markdown response to find product cards and extract product information.
   * Product cards follow this format:
   *   ![PRODUCT NAME](image_url)
   *   **PRODUCT NAME**
   *   Precio: $XX,XXX | ...
   *
   * TODO: This is a simple text-based extraction. Ideally, the workflow should
   * return structured data about products shown, or we should track MCP tool calls.
   * For Phase 1, this provides basic tracking to prevent ID hallucination.
   *
   * @param response - The workflow response text
   * @returns Array of ProductMention objects
   */
  private extractProductMentions(response: string): ProductMention[] {
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

        // For now, we extract just the name without the ID
        // The ID will need to come from MCP tool tracking in a future enhancement
        productMentions.push({
          productId: 0, // TODO: Extract from MCP tool results, not text
          productName,
          mentionedAt: new Date(),
          context: 'recommendation',
        });
      }

      // Deduplicate by product name (case-insensitive)
      const uniqueMentions = productMentions.filter(
        (mention, index, self) =>
          index ===
          self.findIndex(
            (m) =>
              m.productName.toLowerCase() === mention.productName.toLowerCase(),
          ),
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
   * Get classifier intent using keyword matching
   *
   * This is called before the full workflow to detect the use case type.
   * Uses simple keyword heuristics to infer intent without running the workflow.
   *
   * TODO: Refactor workflow to expose classifier result directly to avoid this heuristic.
   */
  private getClassifierIntent(
    message: string,
    context: MessageContext,
    dbMessages?: any[],
  ): string {
    // Use keyword inference directly without running workflow
    // This avoids duplicate workflow execution
    return this.inferIntentFromMessage(message);
  }

  /**
   * Infer intent from message using simple keyword matching
   *
   * This is a fallback when we can't get the classifier result directly.
   * TODO: Refactor workflow to expose classifier result
   */
  private inferIntentFromMessage(message: string): string {
    const messageLower = message.toLowerCase();

    // ORDER_STATUS keywords
    if (
      messageLower.includes('pedido') ||
      messageLower.includes('order') ||
      messageLower.includes('seguimiento') ||
      messageLower.includes('tracking') ||
      messageLower.includes('envio') ||
      messageLower.includes('entrega') ||
      messageLower.includes('pago') ||
      messageLower.includes('payment') ||
      messageLower.includes('devolucion') ||
      messageLower.includes('return')
    ) {
      return 'ORDER_STATUS';
    }

    // PRODUCT_INFO keywords
    if (
      messageLower.includes('producto') ||
      messageLower.includes('product') ||
      messageLower.includes('jean') ||
      messageLower.includes('remera') ||
      messageLower.includes('talle') ||
      messageLower.includes('size') ||
      messageLower.includes('stock') ||
      messageLower.includes('precio') ||
      messageLower.includes('price') ||
      messageLower.includes('color')
    ) {
      return 'PRODUCT_INFO';
    }

    // STORE_INFO keywords
    if (
      messageLower.includes('horario') ||
      messageLower.includes('hours') ||
      messageLower.includes('contacto') ||
      messageLower.includes('contact') ||
      messageLower.includes('politica') ||
      messageLower.includes('policy') ||
      messageLower.includes('cambio') ||
      messageLower.includes('exchange')
    ) {
      return 'STORE_INFO';
    }

    // Default to OTHERS
    return 'OTHERS';
  }

  /**
   * Update use case progress based on agent response
   *
   * This implementation marks steps as complete based on keywords and context.
   * It covers all step types defined in use case workflows.
   */
  private updateUseCaseProgress(
    useCase: UseCase,
    response: string,
    context: MessageContext,
  ): void {
    const responseLower = response.toLowerCase();

    // 1. Authentication steps
    if (
      !useCase.steps.find((s) => s.stepId === 'authenticate')?.completed &&
      (responseLower.includes('confirmé tu identidad') ||
        responseLower.includes('confirmed') ||
        responseLower.includes('verificado'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'authenticate');
    }

    // 2. Order identification (implicit when orderId is in context)
    if (
      !useCase.steps.find((s) => s.stepId === 'identify_order')?.completed &&
      useCase.context?.orderId
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'identify_order');
    }

    // 3. Product presentation
    if (
      !useCase.steps.find((s) => s.stepId === 'present_products')?.completed &&
      (responseLower.includes('![') || // Markdown image (product card)
        responseLower.includes('precio:') ||
        responseLower.includes('disponible') ||
        responseLower.includes('stock') ||
        responseLower.includes('talle'))
    ) {
      this.useCaseDetectionService.markStepCompleted(
        useCase,
        'present_products',
      );
    }

    // 4. Order status presentation
    if (
      !useCase.steps.find((s) => s.stepId === 'present_status')?.completed &&
      (responseLower.includes('pedido') ||
        responseLower.includes('orden') ||
        responseLower.includes('estado') ||
        responseLower.includes('en camino') ||
        responseLower.includes('entregado') ||
        responseLower.includes('preparando'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_status');
    }

    // 5. Fetch steps (detect when data is present in response)
    if (
      !useCase.steps.find((s) => s.stepId === 'fetch_status')?.completed &&
      (responseLower.includes('pedido') || responseLower.includes('orden'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'fetch_status');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'fetch_tracking')?.completed &&
      (responseLower.includes('tracking') ||
        responseLower.includes('seguimiento') ||
        responseLower.includes('oca') ||
        responseLower.includes('andreani') ||
        responseLower.includes('correo'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'fetch_tracking');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'fetch_payment')?.completed &&
      (responseLower.includes('pago') ||
        responseLower.includes('payment') ||
        responseLower.includes('pagado') ||
        responseLower.includes('procesado'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'fetch_payment');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'fetch_details')?.completed &&
      (responseLower.includes('detalle') ||
        responseLower.includes('descripción') ||
        responseLower.includes('características'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'fetch_details');
    }

    // 6. Present steps
    if (
      !useCase.steps.find((s) => s.stepId === 'present_tracking')?.completed &&
      (responseLower.includes('tracking') ||
        responseLower.includes('llegará') ||
        responseLower.includes('envío'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_tracking');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'present_payment')?.completed &&
      responseLower.includes('pago')
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_payment');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'present_details')?.completed &&
      responseLower.includes('producto')
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_details');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'present_availability')?.completed &&
      (responseLower.includes('disponible') ||
        responseLower.includes('stock') ||
        responseLower.includes('talle'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_availability');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'present_policy')?.completed &&
      (responseLower.includes('política') ||
        responseLower.includes('devolución') ||
        responseLower.includes('días'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_policy');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'present_hours')?.completed &&
      (responseLower.includes('horario') ||
        responseLower.includes('lunes') ||
        responseLower.includes('abierto'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_hours');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'present_contact')?.completed &&
      (responseLower.includes('contacto') ||
        responseLower.includes('teléfono') ||
        responseLower.includes('email') ||
        responseLower.includes('whatsapp'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'present_contact');
    }

    // 7. Satisfaction/confirmation steps (detect positive responses)
    if (
      !useCase.steps.find((s) => s.stepId === 'check_satisfaction')?.completed &&
      (responseLower.includes('gracias') ||
        responseLower.includes('perfecto') ||
        responseLower.includes('genial') ||
        responseLower.includes('excelente') ||
        responseLower.includes('buenísimo') ||
        responseLower.includes('ok') ||
        responseLower.includes('dale') ||
        responseLower.includes('sí') ||
        responseLower.includes('si,') ||
        responseLower.includes('claro') ||
        responseLower.includes('listo'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'check_satisfaction');
    }

    if (
      !useCase.steps.find((s) => s.stepId === 'confirm_understanding')?.completed &&
      (responseLower.includes('entendido') ||
        responseLower.includes('claro') ||
        responseLower.includes('gracias') ||
        responseLower.includes('ok'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'confirm_understanding');
    }

    // 8. Provide instructions step (for returns, etc.)
    if (
      !useCase.steps.find((s) => s.stepId === 'provide_instructions')?.completed &&
      (responseLower.includes('devolución') ||
        responseLower.includes('cambio') ||
        responseLower.includes('pasos'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'provide_instructions');
    }

    // 9. Verify eligibility step
    if (
      !useCase.steps.find((s) => s.stepId === 'verify_eligibility')?.completed &&
      (responseLower.includes('elegible') ||
        responseLower.includes('puede') ||
        responseLower.includes('día'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'verify_eligibility');
    }

    // 10. Check variants step
    if (
      !useCase.steps.find((s) => s.stepId === 'check_variants')?.completed &&
      (responseLower.includes('talle') ||
        responseLower.includes('color') ||
        responseLower.includes('variante'))
    ) {
      this.useCaseDetectionService.markStepCompleted(useCase, 'check_variants');
    }

    // 11. Auto-complete simple/generic steps (always complete in single turn)
    for (const step of useCase.steps) {
      if (
        !step.completed &&
        (step.stepId === 'understand_need' ||
          step.stepId === 'search_products' ||
          step.stepId === 'identify_product' ||
          step.stepId === 'understand_query' ||
          step.stepId === 'provide_response' ||
          step.stepId === 'respond_greeting' ||
          step.stepId === 'offer_help' ||
          step.stepId === 'search_policy' ||
          step.stepId === 'search_hours' ||
          step.stepId === 'search_contact')
      ) {
        this.useCaseDetectionService.markStepCompleted(useCase, step.stepId);
      }
    }
  }

  /**
   * Save use case state to database
   *
   * Updates the conversation state with the current use case information.
   */
  private async saveUseCaseState(
    conversationId: string,
    useCase: UseCase,
    currentState: ConversationState | null,
  ): Promise<void> {
    const useCases: UseCaseState = currentState?.state?.useCases || {
      activeCases: [],
      completedCases: [],
    };

    // Update or add use case
    const existingIndex = useCases.activeCases.findIndex(
      (uc) => uc.useCaseId === useCase.useCaseId,
    );

    if (useCase.status === UseCaseStatus.COMPLETED) {
      // Move to completed
      if (existingIndex >= 0) {
        useCases.activeCases.splice(existingIndex, 1);
      }
      useCases.completedCases.push(useCase);

      // Keep only last 5 completed cases
      if (useCases.completedCases.length > 5) {
        useCases.completedCases = useCases.completedCases.slice(-5);
      }
    } else {
      // Update active
      if (existingIndex >= 0) {
        useCases.activeCases[existingIndex] = useCase;
      } else {
        useCases.activeCases.push(useCase);
      }
    }

    // Save to database
    await this.prisma.conversationState.upsert({
      where: { conversationId },
      update: {
        state: {
          products: currentState?.state?.products || [],
          useCases,
        } as any,
      },
      create: {
        conversationId,
        state: {
          products: [],
          useCases,
        } as any,
      },
    });

    this.logger.log('Use case state saved', {
      conversationId,
      useCaseId: useCase.useCaseId,
      status: useCase.status,
      activeCases: useCases.activeCases.length,
      completedCases: useCases.completedCases.length,
    });
  }
}
