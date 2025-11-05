import { Injectable, Logger } from '@nestjs/common';
import { ConversationState, ProductMention, findProductByName } from '../../common/interfaces';
import { PresentationMode, getPresentationInstructions } from './templates/product-presentation.templates';

/**
 * Types of user queries about products
 */
export type QueryType = 'INITIAL_SEARCH' | 'SIZE_QUERY' | 'COMPARISON' | 'ATTRIBUTE_QUERY' | 'RE_SHOW';

/**
 * Context information about the user's query
 */
export interface QueryContext {
  type: QueryType;
  mentionedProducts: ProductMention[];  // Products mentioned in the query
  isFollowUp: boolean;  // Is this a follow-up about previously shown products?
}

/**
 * ProductPresentationService
 *
 * Determines how products should be presented based on conversation context.
 * Implements code-driven logic to avoid unnecessary repetition of product information.
 *
 * Strategy:
 * - First mention → FULL_CARD (complete information with image)
 * - Size query about recent product → SIZE_ONLY (no image, just size info)
 * - Comparison → COMPACT (brief format without images)
 * - Attribute query → TEXT_ONLY (direct answer)
 * - Recently mentioned = within last 10 minutes
 */
@Injectable()
export class ProductPresentationService {
  private readonly logger = new Logger(ProductPresentationService.name);

  // Time window to consider a product as "recently mentioned" (in minutes)
  private readonly RECENT_MENTION_WINDOW_MINUTES = 10;

  /**
   * Detect the type and context of the user's query
   */
  detectQueryContext(
    userMessage: string,
    conversationState: ConversationState | null
  ): QueryContext {
    const messageLower = userMessage.toLowerCase();

    // Detect query type based on patterns
    const queryType = this.detectQueryType(messageLower);

    // Extract products mentioned in the message
    const mentionedProducts = this.extractMentionedProducts(userMessage, conversationState);

    // Check if this is a follow-up about products already shown
    const isFollowUp = mentionedProducts.length > 0 &&
                       mentionedProducts.some(p => this.wasRecentlyMentioned(p.productId, conversationState));

    this.logger.log('Query context detected', {
      queryType,
      mentionedProductsCount: mentionedProducts.length,
      mentionedProductIds: mentionedProducts.map(p => p.productId),
      isFollowUp
    });

    return {
      type: queryType,
      mentionedProducts,
      isFollowUp
    };
  }

  /**
   * Determine presentation mode based on query context
   *
   * Key decision criteria:
   * - SIZE_QUERY: Use "product exists in state" (any time) not "recent" (10-min window)
   * - COMPARISON/ATTRIBUTE: Use "recent" (10-min window) for context-aware formatting
   */
  determinePresentationMode(
    queryContext: QueryContext,
    conversationState: ConversationState | null
  ): PresentationMode {
    const { type, mentionedProducts, isFollowUp } = queryContext;

    // RE_SHOW - Always show full cards when explicitly requested
    if (type === 'RE_SHOW') {
      this.logger.log('Presentation mode: FULL_CARD (explicit re-show request)');
      return 'FULL_CARD';
    }

    // SIZE_QUERY - Check if product was EVER mentioned (not just recently)
    // Rationale: If customer saw product before (even 1 hour ago), no need for full card again
    if (type === 'SIZE_QUERY') {
      if (mentionedProducts.length > 0) {
        // Product exists in state (mentioned at any time) → SIZE_ONLY
        this.logger.log('Presentation mode: SIZE_ONLY (size query for known product)');
        return 'SIZE_ONLY';
      } else {
        // Product never mentioned → FULL_CARD (first time showing it)
        this.logger.log('Presentation mode: FULL_CARD (size query for new product)');
        return 'FULL_CARD';
      }
    }

    // COMPARISON - Check recency (10-minute window)
    // Rationale: Recent products → compact format; Old products → refresh with full cards
    if (type === 'COMPARISON') {
      if (isFollowUp) {
        this.logger.log('Presentation mode: COMPACT (comparison of recent products)');
        return 'COMPACT';
      } else {
        this.logger.log('Presentation mode: FULL_CARD (comparison of non-recent products)');
        return 'FULL_CARD';
      }
    }

    // ATTRIBUTE_QUERY - Check recency (10-minute window)
    // Rationale: Recent products → text-only answer; Old products → show card with attribute
    if (type === 'ATTRIBUTE_QUERY') {
      if (isFollowUp) {
        this.logger.log('Presentation mode: TEXT_ONLY (attribute query for recent product)');
        return 'TEXT_ONLY';
      } else {
        this.logger.log('Presentation mode: FULL_CARD (attribute query for non-recent product)');
        return 'FULL_CARD';
      }
    }

    // INITIAL_SEARCH - Always show full cards for new searches
    if (type === 'INITIAL_SEARCH') {
      this.logger.log('Presentation mode: FULL_CARD (initial search)');
      return 'FULL_CARD';
    }

    // Default fallback
    this.logger.log('Presentation mode: FULL_CARD (default fallback)');
    return 'FULL_CARD';
  }

  /**
   * Generate specific presentation instructions for the Products Agent
   */
  generatePresentationInstructions(
    mode: PresentationMode,
    mentionedProducts: ProductMention[]
  ): string {
    let instructions = getPresentationInstructions(mode);

    // Add context about mentioned products if applicable
    if (mentionedProducts.length > 0 && mode !== 'FULL_CARD') {
      const productInfo = mentionedProducts.map(p =>
        `- **${p.productName}** (ID: ${p.productId}) - mentioned ${this.formatTimeAgo(p.mentionedAt)}`
      ).join('\n');

      instructions += `\n\n**Products Being Discussed:**\n${productInfo}\n`;
      instructions += `\nUse these product IDs when calling MCP tools. DO NOT search for these products again.\n`;
    }

    return instructions;
  }

  /**
   * Check if a product was mentioned recently (within time window)
   */
  private wasRecentlyMentioned(
    productId: number,
    conversationState: ConversationState | null
  ): boolean {
    if (!conversationState || !conversationState.state.products) {
      return false;
    }

    const product = conversationState.state.products.find(p => p.productId === productId);
    if (!product) {
      return false;
    }

    const now = new Date();
    const mentionedAt = new Date(product.mentionedAt);
    const diffMinutes = (now.getTime() - mentionedAt.getTime()) / 1000 / 60;

    const isRecent = diffMinutes <= this.RECENT_MENTION_WINDOW_MINUTES;

    this.logger.debug(`Product ${productId} mentioned ${diffMinutes.toFixed(1)} minutes ago - Recent: ${isRecent}`);

    return isRecent;
  }

  /**
   * Detect query type based on message patterns
   */
  private detectQueryType(messageLower: string): QueryType {
    // SIZE_QUERY patterns
    const sizePatterns = [
      /tiene.*talle/i,
      /talles.*disponible/i,
      /stock.*talle/i,
      /qué talles/i,
      /en talle \d+/i,
      /viene en (talle|talles)/i
    ];

    if (sizePatterns.some(pattern => pattern.test(messageLower))) {
      return 'SIZE_QUERY';
    }

    // COMPARISON patterns
    const comparisonPatterns = [
      /diferencia.*entre/i,
      /cuál.*mejor/i,
      /comparar/i,
      /(primero|segundo|tercero).*(vs|contra|con)/i,
      /entre.*y/i
    ];

    if (comparisonPatterns.some(pattern => pattern.test(messageLower))) {
      return 'COMPARISON';
    }

    // ATTRIBUTE_QUERY patterns
    const attributePatterns = [
      /viene en (negro|azul|rojo|blanco|gris|verde|rosa|violeta)/i,
      /tiene.*bolsillos/i,
      /es.*elastizado/i,
      /material/i,
      /de qué.*está hecho/i,
      /qué color/i,
      /tiene.*cierre/i
    ];

    if (attributePatterns.some(pattern => pattern.test(messageLower))) {
      return 'ATTRIBUTE_QUERY';
    }

    // RE_SHOW patterns
    const reShowPatterns = [
      /mostrar.*de nuevo/i,
      /ver.*otra vez/i,
      /repetir/i,
      /volver a mostrar/i,
      /podés.*mostrar.*de nuevo/i
    ];

    if (reShowPatterns.some(pattern => pattern.test(messageLower))) {
      return 'RE_SHOW';
    }

    // Default to INITIAL_SEARCH
    return 'INITIAL_SEARCH';
  }

  /**
   * Extract products mentioned in the user message using fuzzy matching
   */
  private extractMentionedProducts(
    userMessage: string,
    conversationState: ConversationState | null
  ): ProductMention[] {
    if (!conversationState || !conversationState.state.products.length) {
      return [];
    }

    const mentionedProducts: ProductMention[] = [];
    const messageLower = userMessage.toLowerCase();

    // Try to find products by name (fuzzy matching)
    for (const product of conversationState.state.products) {
      // Split product name into words for flexible matching
      const nameWords = product.productName.toLowerCase().split(' ');

      // Check if significant words from product name appear in message
      const significantWords = nameWords.filter(word => word.length > 3); // Ignore short words like "DE", "EN"

      if (significantWords.some(word => messageLower.includes(word))) {
        mentionedProducts.push(product);
      }
    }

    // Also handle positional references (el primero, el segundo, etc.)
    const positionalMatch = userMessage.match(/(el )?(primero|segundo|tercero)/i);
    if (positionalMatch && conversationState.state.products.length > 0) {
      const position = positionalMatch[2].toLowerCase();
      const index = { 'primero': 0, 'segundo': 1, 'tercero': 2 }[position];

      if (index !== undefined && conversationState.state.products[index]) {
        const product = conversationState.state.products[index];
        if (!mentionedProducts.find(p => p.productId === product.productId)) {
          mentionedProducts.push(product);
        }
      }
    }

    return mentionedProducts;
  }

  /**
   * Format time ago in human-readable format
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const mentionedAt = new Date(date);
    const diffMinutes = Math.floor((now.getTime() - mentionedAt.getTime()) / 1000 / 60);

    if (diffMinutes < 1) {
      return 'just now';
    } else if (diffMinutes === 1) {
      return '1 minute ago';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minutes ago`;
    } else {
      const diffHours = Math.floor(diffMinutes / 60);
      return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    }
  }
}
