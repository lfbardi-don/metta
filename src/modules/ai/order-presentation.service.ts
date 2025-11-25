import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationState,
  OrderMention,
} from '../../common/interfaces';
import {
  OrderPresentationMode,
  getOrderPresentationInstructions,
} from './templates/order-presentation.templates';

/**
 * Types of user queries about orders
 */
export type OrderQueryType =
  | 'ORDER_LOOKUP' // Initial order lookup or general inquiry
  | 'TRACKING_QUERY' // Where is my order? Tracking number?
  | 'STATUS_QUERY' // What's the status? What happened?
  | 'PAYMENT_QUERY' // Payment status, refund, transaction
  | 'ORDER_LIST' // My orders, order history
  | 'RE_SHOW'; // Show again, repeat

/**
 * Context information about the user's order query
 */
export interface OrderQueryContext {
  type: OrderQueryType;
  mentionedOrders: OrderMention[]; // Orders mentioned in the query
  isFollowUp: boolean; // Is this a follow-up about previously shown orders?
  extractedOrderNumber?: string; // Order number extracted from message
}

/**
 * OrderPresentationService
 *
 * Determines how orders should be presented based on conversation context.
 * Implements code-driven logic to avoid unnecessary repetition of order information.
 *
 * Strategy:
 * - First mention → FULL_ORDER (complete information)
 * - Tracking query about recent order → TRACKING_ONLY (no items/prices)
 * - Status query about recent order → STATUS_ONLY (minimal)
 * - Payment query about recent order → PAYMENT_ONLY (transaction focus)
 * - Multiple orders / list → COMPACT (one-liner format)
 * - Recently mentioned = within last 10 minutes
 */
@Injectable()
export class OrderPresentationService {
  private readonly logger = new Logger(OrderPresentationService.name);

  // Time window to consider an order as "recently mentioned" (in minutes)
  private readonly RECENT_MENTION_WINDOW_MINUTES = 10;

  /**
   * Detect the type and context of the user's order query
   */
  detectQueryContext(
    userMessage: string,
    conversationState: ConversationState | null,
  ): OrderQueryContext {
    const messageLower = userMessage.toLowerCase();

    // Detect query type based on patterns
    const queryType = this.detectQueryType(messageLower);

    // Extract order number from message if present
    const extractedOrderNumber = this.extractOrderNumber(userMessage);

    // Extract orders mentioned in the message
    const mentionedOrders = this.extractMentionedOrders(
      userMessage,
      conversationState,
    );

    // Check if this is a follow-up about orders already shown
    const isFollowUp =
      mentionedOrders.length > 0 &&
      mentionedOrders.some((o) =>
        this.wasRecentlyMentioned(o.orderId, conversationState),
      );

    this.logger.log('Order query context detected', {
      queryType,
      mentionedOrdersCount: mentionedOrders.length,
      mentionedOrderIds: mentionedOrders.map((o) => o.orderId),
      extractedOrderNumber,
      isFollowUp,
    });

    return {
      type: queryType,
      mentionedOrders,
      isFollowUp,
      extractedOrderNumber,
    };
  }

  /**
   * Determine presentation mode based on query context
   */
  determinePresentationMode(
    queryContext: OrderQueryContext,
    conversationState: ConversationState | null,
  ): OrderPresentationMode {
    const { type, mentionedOrders, isFollowUp } = queryContext;

    // RE_SHOW - Always show full order when explicitly requested
    if (type === 'RE_SHOW') {
      this.logger.log(
        'Presentation mode: FULL_ORDER (explicit re-show request)',
      );
      return 'FULL_ORDER';
    }

    // ORDER_LIST - Now returns FULL_ORDER since we can only show one order
    // The API only supports get_last_order (no order history)
    if (type === 'ORDER_LIST') {
      this.logger.log('Presentation mode: FULL_ORDER (order list request - limited to last order only)');
      return 'FULL_ORDER';
    }

    // TRACKING_QUERY - Use TRACKING_ONLY if order was recently mentioned
    if (type === 'TRACKING_QUERY') {
      if (isFollowUp) {
        this.logger.log(
          'Presentation mode: TRACKING_ONLY (tracking query for recent order)',
        );
        return 'TRACKING_ONLY';
      } else {
        this.logger.log(
          'Presentation mode: FULL_ORDER (tracking query for new order)',
        );
        return 'FULL_ORDER';
      }
    }

    // STATUS_QUERY - Use STATUS_ONLY if order was recently mentioned
    if (type === 'STATUS_QUERY') {
      if (isFollowUp) {
        this.logger.log(
          'Presentation mode: STATUS_ONLY (status query for recent order)',
        );
        return 'STATUS_ONLY';
      } else {
        this.logger.log(
          'Presentation mode: FULL_ORDER (status query for new order)',
        );
        return 'FULL_ORDER';
      }
    }

    // PAYMENT_QUERY - Use PAYMENT_ONLY if order was recently mentioned
    if (type === 'PAYMENT_QUERY') {
      if (isFollowUp) {
        this.logger.log(
          'Presentation mode: PAYMENT_ONLY (payment query for recent order)',
        );
        return 'PAYMENT_ONLY';
      } else {
        this.logger.log(
          'Presentation mode: FULL_ORDER (payment query for new order)',
        );
        return 'FULL_ORDER';
      }
    }

    // ORDER_LOOKUP - Default to FULL_ORDER
    this.logger.log('Presentation mode: FULL_ORDER (order lookup)');
    return 'FULL_ORDER';
  }

  /**
   * Generate specific presentation instructions for the Orders Agent
   */
  generatePresentationInstructions(
    mode: OrderPresentationMode,
    mentionedOrders: OrderMention[],
  ): string {
    let instructions = getOrderPresentationInstructions(mode);

    // Add context about mentioned orders if applicable
    if (mentionedOrders.length > 0 && mode !== 'FULL_ORDER') {
      const orderInfo = mentionedOrders
        .map(
          (o) =>
            `- **Order #${o.orderNumber}** (ID: ${o.orderId}) - ${o.lastStatus || 'unknown status'} - mentioned ${this.formatTimeAgo(o.mentionedAt)}`,
        )
        .join('\n');

      instructions += `\n\n**Orders Being Discussed:**\n${orderInfo}\n`;
      instructions += `\nUse these order IDs when calling MCP tools. DO NOT ask for order number again.\n`;
    }

    return instructions;
  }

  /**
   * Check if an order was mentioned recently (within time window)
   */
  private wasRecentlyMentioned(
    orderId: string,
    conversationState: ConversationState | null,
  ): boolean {
    if (!conversationState || !conversationState.state.orders) {
      return false;
    }

    const order = conversationState.state.orders.find(
      (o) => o.orderId === orderId,
    );
    if (!order) {
      return false;
    }

    const now = new Date();
    const mentionedAt = new Date(order.mentionedAt);
    const diffMinutes = (now.getTime() - mentionedAt.getTime()) / 1000 / 60;

    const isRecent = diffMinutes <= this.RECENT_MENTION_WINDOW_MINUTES;

    this.logger.debug(
      `Order ${orderId} mentioned ${diffMinutes.toFixed(1)} minutes ago - Recent: ${isRecent}`,
    );

    return isRecent;
  }

  /**
   * Detect query type based on message patterns
   */
  private detectQueryType(messageLower: string): OrderQueryType {
    // TRACKING_QUERY patterns
    const trackingPatterns = [
      /dónde está/i,
      /donde esta/i,
      /seguimiento/i,
      /tracking/i,
      /llegó/i,
      /llego/i,
      /cuándo llega/i,
      /cuando llega/i,
      /envío/i,
      /envio/i,
      /entrega/i,
      /código de seguimiento/i,
      /numero de tracking/i,
      /rastrear/i,
      /está en camino/i,
    ];

    if (trackingPatterns.some((pattern) => pattern.test(messageLower))) {
      return 'TRACKING_QUERY';
    }

    // STATUS_QUERY patterns
    const statusPatterns = [
      /estado/i,
      /qué pasó/i,
      /que paso/i,
      /status/i,
      /cómo está/i,
      /como esta/i,
      /qué pasó con/i,
      /actualización/i,
      /noticias/i,
    ];

    if (statusPatterns.some((pattern) => pattern.test(messageLower))) {
      return 'STATUS_QUERY';
    }

    // PAYMENT_QUERY patterns
    const paymentPatterns = [
      /pago/i,
      /pagué/i,
      /pague/i,
      /cobro/i,
      /reembolso/i,
      /devolucion/i,
      /transacción/i,
      /tarjeta/i,
      /factura/i,
      /comprobante/i,
      /rechazado/i,
      /aprobado/i,
    ];

    if (paymentPatterns.some((pattern) => pattern.test(messageLower))) {
      return 'PAYMENT_QUERY';
    }

    // ORDER_LIST patterns
    const listPatterns = [
      /mis pedidos/i,
      /historial/i,
      /compras/i,
      /últimos pedidos/i,
      /pedidos recientes/i,
      /todas mis compras/i,
      /ver pedidos/i,
    ];

    if (listPatterns.some((pattern) => pattern.test(messageLower))) {
      return 'ORDER_LIST';
    }

    // RE_SHOW patterns
    const reShowPatterns = [
      /mostrar.*de nuevo/i,
      /ver.*otra vez/i,
      /repetir/i,
      /volver a mostrar/i,
      /podés.*mostrar.*de nuevo/i,
    ];

    if (reShowPatterns.some((pattern) => pattern.test(messageLower))) {
      return 'RE_SHOW';
    }

    // Default to ORDER_LOOKUP
    return 'ORDER_LOOKUP';
  }

  /**
   * Extract order number from user message
   */
  private extractOrderNumber(userMessage: string): string | undefined {
    // Match patterns like: #1234, pedido 1234, orden 1234, order 1234
    const patterns = [
      /#(\d+)/,
      /pedido\s*#?(\d+)/i,
      /orden\s*#?(\d+)/i,
      /order\s*#?(\d+)/i,
      /compra\s*#?(\d+)/i,
      /número\s*#?(\d+)/i,
      /numero\s*#?(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Extract orders mentioned in the user message using fuzzy matching
   */
  private extractMentionedOrders(
    userMessage: string,
    conversationState: ConversationState | null,
  ): OrderMention[] {
    if (!conversationState || !conversationState.state.orders?.length) {
      return [];
    }

    const mentionedOrders: OrderMention[] = [];
    const messageLower = userMessage.toLowerCase();

    // Extract order number from message
    const extractedNumber = this.extractOrderNumber(userMessage);

    // Check if any orders in state match the extracted number
    if (extractedNumber) {
      const matchingOrder = conversationState.state.orders.find(
        (o) => o.orderNumber === extractedNumber,
      );
      if (matchingOrder) {
        mentionedOrders.push(matchingOrder);
      }
    }

    // Handle references like "ese pedido", "mi pedido", "el pedido"
    const referencePatterns = [
      /ese pedido/i,
      /mi pedido/i,
      /el pedido/i,
      /la orden/i,
      /mi orden/i,
      /mi compra/i,
    ];

    if (referencePatterns.some((pattern) => pattern.test(messageLower))) {
      // If generic reference, use the most recently mentioned order
      if (mentionedOrders.length === 0 && conversationState.state.orders.length > 0) {
        const mostRecent = conversationState.state.orders.reduce(
          (latest, current) => {
            const latestTime = new Date(latest.mentionedAt).getTime();
            const currentTime = new Date(current.mentionedAt).getTime();
            return currentTime > latestTime ? current : latest;
          },
        );
        mentionedOrders.push(mostRecent);
      }
    }

    return mentionedOrders;
  }

  /**
   * Format time ago in human-readable format
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const mentionedAt = new Date(date);
    const diffMinutes = Math.floor(
      (now.getTime() - mentionedAt.getTime()) / 1000 / 60,
    );

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
