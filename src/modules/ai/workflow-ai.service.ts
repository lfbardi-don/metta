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
import { GuardrailsService } from '../guardrails/guardrails.service';
import { getGuardrailFallbackMessage } from '../guardrails/guardrail-messages.constant';
import { PersistenceService } from '../persistence/persistence.service';
import { resolvePIIPlaceholders } from '../../common/helpers/resolve-pii.helper';

/**
 * Response from AI service with text and optional product images
 * Note: Workflow currently returns empty products array
 */
export interface AIServiceResponse {
  response: string;
  products: Array<any>;
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

    // 3. Load conversation state (product context tracking)
    const conversationState = await this.persistenceService.getConversationState(
      context.conversationId,
    );

    if (conversationState && conversationState.products.length > 0) {
      this.logger.log(
        `Loaded conversation state with ${conversationState.products.length} product(s)`,
      );
    }

    // 4. Process with workflow (pass dbMessages and state to avoid re-fetching)
    const { response, products } = await this.runWorkflow(
      resolvedContent,
      context,
      dbMessages,
      conversationState,
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
      const conversationHistory: AgentInputItem[] = historyMessages.map((msg) => {
        const role = msg.direction === 'incoming' ? ('user' as const) : ('assistant' as const);

        return {
          role,
          content: role === 'user'
            ? [{ type: 'input_text' as const, text: msg.content }]
            : [{ type: 'output_text' as const, text: msg.content }],
        } as AgentInputItem;
      });

      this.logger.log('Workflow context prepared', {
        historyMessages: conversationHistory.length,
        totalMessages: conversationHistory.length + 1, // +1 for current message
        hasState: !!conversationState,
        stateProductsCount: conversationState?.products?.length || 0,
      });

      // Run workflow with history and state
      const result = await runWorkflow({
        input_as_text: message,
        conversationHistory,
        conversationState: conversationState || undefined,
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

      // DEBUG: Log result structure
      this.logger.log('Workflow result structure:', {
        hasNewItems: !!result.newItems,
        newItemsLength: result.newItems?.length || 0,
        newItemsTypes: result.newItems?.map((item) => item?.type) || [],
      });

      // Primary: Extract from MCP tool calls (has real product IDs)
      if (result.newItems && result.newItems.length > 0) {
        this.logger.log(
          `Attempting to extract products from ${result.newItems.length} workflow items`,
        );

        productMentions = this.extractProductsFromToolCalls(result.newItems);

        if (productMentions.length > 0) {
          this.logger.log(
            `✅ Extracted ${productMentions.length} product(s) from MCP tool calls with real IDs`,
            {
              productIds: productMentions.map((p) => ({
                id: p.productId,
                name: p.productName,
              })),
            },
          );
        } else {
          this.logger.warn('❌ No products found in tool calls, falling back to text extraction');
        }
      } else {
        this.logger.warn('❌ No newItems in workflow result, using text extraction');
      }

      // Fallback: Extract from text if no tool calls found
      // (e.g., when FAQ Agent or Greetings Agent responds)
      if (productMentions.length === 0) {
        productMentions = this.extractProductMentions(response);
        if (productMentions.length > 0) {
          this.logger.warn(
            `⚠️ Using text extraction (fallback) - extracted ${productMentions.length} product(s) with IDs = 0`,
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

      return { response, products };
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
        if (productName.length < 5 || productName.toLowerCase().includes('importante')) {
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
            (m) => m.productName.toLowerCase() === mention.productName.toLowerCase(),
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
      // DEBUG: Log all item types
      this.logger.log('DEBUG: newItems breakdown:', {
        totalItems: newItems.length,
        itemTypes: newItems.map((item, idx) => ({
          index: idx,
          type: item?.type,
          hasRawItem: !!item?.rawItem,
          rawItemName: item?.rawItem?.name,
          hasOutput: !!item?.output,
          rawItemType: item?.rawItem?.type,
        })),
      });

      // DEBUG: Check if tool_call_item has embedded output
      const toolCallItems = newItems.filter((item) => item?.type === 'tool_call_item');
      for (const item of toolCallItems) {
        this.logger.log('DEBUG: tool_call_item details:', {
          name: item?.rawItem?.name,
          type: item?.rawItem?.type,
          hasOutput: !!item?.rawItem?.output,
          hasResult: !!item?.result,
          keys: Object.keys(item?.rawItem || {}),
        });

        // If this is mcp_call with output, show what's inside
        if (item?.rawItem?.name === 'mcp_call' && item?.rawItem?.output) {
          this.logger.log('DEBUG: mcp_call output preview:', {
            outputType: typeof item.rawItem.output,
            outputPreview: JSON.stringify(item.rawItem.output).substring(0, 500),
            hasProviderData: !!item?.rawItem?.providerData,
            providerDataKeys: Object.keys(item?.rawItem?.providerData || {}),
          });
        }
      }

      // Filter for tool call items with mcp_call and output
      const toolOutputs = newItems.filter(
        (item) =>
          item?.type === 'tool_call_item' &&
          item?.rawItem?.name === 'mcp_call' &&
          item?.rawItem?.output,
      );

      this.logger.log(`DEBUG: Found ${toolOutputs.length} mcp_call tool_call_item(s) with output`);

      for (const item of toolOutputs) {
        // Get actual MCP tool name from providerData (not 'mcp_call' wrapper)
        const toolName = item.rawItem?.providerData?.name;

        this.logger.log('DEBUG: Processing tool output:', {
          toolName,
          hasOutput: !!item.rawItem.output,
          outputType: typeof item.rawItem.output,
        });

        // Only process product-related MCP tools
        if (!toolName || !toolName.includes('nuvemshop_product')) {
          this.logger.log(`DEBUG: Skipping tool (not a product tool): ${toolName}`);
          continue;
        }

        this.logger.log(`DEBUG: Processing product tool: ${toolName}`);

        // Parse tool output (could be string or object)
        let toolResult;
        if (typeof item.rawItem.output === 'string') {
          try {
            toolResult = JSON.parse(item.rawItem.output);
            this.logger.log('DEBUG: Parsed JSON output successfully');
          } catch (parseError) {
            this.logger.warn(`Failed to parse tool output for ${toolName}`, {
              error: parseError.message,
              outputPreview: item.rawItem.output?.substring(0, 200),
            });
            continue;
          }
        } else {
          toolResult = item.rawItem.output;
          this.logger.log('DEBUG: Output is already an object');
        }

        this.logger.log('DEBUG: Tool result structure:', {
          isArray: Array.isArray(toolResult),
          hasProducts: !!toolResult?.products,
          keys: Object.keys(toolResult || {}),
        });

        // Extract products based on tool type
        if (toolName === 'search_nuvemshop_products') {
          // Search returns array or { products: [...] }
          const products = Array.isArray(toolResult)
            ? toolResult
            : toolResult.products || [];

          this.logger.log(`DEBUG: Found ${products.length} product(s) in search result`);

          for (const product of products) {
            this.logger.log('DEBUG: Product in result:', {
              hasId: !!product.id,
              hasName: !!product.name,
              id: product.id,
              name: product.name,
            });

            if (product.id && product.name) {
              productMentions.push({
                productId: product.id,
                productName: product.name,
                mentionedAt: now,
                context: 'search',
              });
              this.logger.log(`DEBUG: ✅ Added product: ${product.name} (ID: ${product.id})`);
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
}
