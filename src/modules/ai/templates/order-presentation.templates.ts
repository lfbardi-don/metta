/**
 * Order Presentation Templates
 *
 * Defines different presentation formats for orders based on conversation context.
 * Used by OrderPresentationService to generate context-aware instructions.
 *
 * Similar to product-presentation.templates.ts but for order queries.
 */

export type OrderPresentationMode =
  | 'FULL_ORDER' // Complete order details with items, status, tracking
  | 'TRACKING_ONLY' // Just tracking information (no items, price repeated)
  | 'STATUS_ONLY' // Just status update (minimal info)
  | 'PAYMENT_ONLY' // Just payment/transaction info
  | 'COMPACT'; // Brief reference for multiple orders or follow-ups

/**
 * FULL_ORDER - Complete order presentation
 * Used for: Initial order lookup, explicit re-show requests, orders not recently mentioned
 */
export const FULL_ORDER_INSTRUCTIONS = `
**PRESENTATION MODE: FULL_ORDER**

Show complete order details with all information.

Format order as:
\`\`\`
**Pedido #{orderNumber}**
Estado: {status}
Fecha: {date}

📦 Productos:
- {quantity}x {productName} - \${price}
- ...

💰 Total: \${total}

🚚 Envío: {shippingStatus}
{if tracking: Tracking: {trackingNumber} ({carrier})}
{if estimatedDelivery: Entrega estimada: {estimatedDelivery}}
\`\`\`

Rules:
- Always include order number prominently
- Show all items with quantities and prices
- Include shipping status and tracking if available
- Format prices with $ and thousands separator (e.g., $55,000)
- Use emojis sparingly for visual organization
- Show maximum 1 order in full detail per response
`;

/**
 * TRACKING_ONLY - Just tracking information
 * Used for: Follow-up tracking queries about recently mentioned orders
 */
export const TRACKING_ONLY_INSTRUCTIONS = `
**PRESENTATION MODE: TRACKING_ONLY**

The user is asking about tracking for an order that was recently discussed.

DO NOT show full order details again. DO NOT repeat items or prices.

Response format:
\`\`\`
Tu pedido #{orderNumber} está {shippingStatus}.
{if tracking: Podés seguirlo con el código: {trackingNumber} ({carrier})}
{if estimatedDelivery: Entrega estimada: {estimatedDelivery}}
\`\`\`

Rules:
- Be natural and conversational
- Only provide tracking-related information
- Do NOT repeat order items or total
- Include carrier link if available
- Keep response concise
`;

/**
 * STATUS_ONLY - Just status update
 * Used for: Quick status checks on recently mentioned orders
 */
export const STATUS_ONLY_INSTRUCTIONS = `
**PRESENTATION MODE: STATUS_ONLY**

The user is asking about the status of an order that was recently discussed.

DO NOT show full order details again. DO NOT repeat tracking if already provided.

Response format:
\`\`\`
Tu pedido #{orderNumber}: {status}
{if statusChanged: Actualizado {timeAgo}}
\`\`\`

Rules:
- Be natural and conversational
- Only provide status-related information
- Do NOT repeat items, prices, or tracking unless specifically asked
- Keep response very brief
`;

/**
 * PAYMENT_ONLY - Just payment/transaction information
 * Used for: Payment-specific queries about recently mentioned orders
 */
export const PAYMENT_ONLY_INSTRUCTIONS = `
**PRESENTATION MODE: PAYMENT_ONLY**

The user is asking about payment for an order that was recently discussed.

DO NOT show full order details again.

Response format:
\`\`\`
Pedido #{orderNumber} - Estado de pago: {paymentStatus}
{if paymentMethod: Método: {paymentMethod}}
{if lastTransaction: Última transacción: {transactionDate} - {transactionStatus}}
{if refund: Reembolso: {refundStatus} - \${refundAmount}}
\`\`\`

Rules:
- Focus only on payment-related information
- Include transaction history if relevant
- Do NOT repeat order items or shipping info
- Be clear about any pending actions needed
`;

/**
 * COMPACT - Brief order reference
 * Used for: Order lists, multiple order discussions, quick references
 */
export const COMPACT_INSTRUCTIONS = `
**PRESENTATION MODE: COMPACT**

The user is discussing multiple orders or needs a quick reference.

Format each order as a single line:
\`\`\`
**#{orderNumber}** - {status} - \${total} - {date}
\`\`\`

For order lists, show as:
\`\`\`
Tus pedidos recientes:
- **#1234** - Entregado - $45,000 - 15/11
- **#1235** - En camino - $32,000 - 20/11
- **#1236** - Preparando - $28,000 - 22/11
\`\`\`

Rules:
- One line per order
- Show only essential info (number, status, total, date)
- Do NOT show items or detailed tracking
- Useful for comparisons or order lists
`;

/**
 * Get instructions for a specific presentation mode
 */
export function getOrderPresentationInstructions(
  mode: OrderPresentationMode,
): string {
  switch (mode) {
    case 'FULL_ORDER':
      return FULL_ORDER_INSTRUCTIONS;
    case 'TRACKING_ONLY':
      return TRACKING_ONLY_INSTRUCTIONS;
    case 'STATUS_ONLY':
      return STATUS_ONLY_INSTRUCTIONS;
    case 'PAYMENT_ONLY':
      return PAYMENT_ONLY_INSTRUCTIONS;
    case 'COMPACT':
      return COMPACT_INSTRUCTIONS;
    default:
      return FULL_ORDER_INSTRUCTIONS;
  }
}
