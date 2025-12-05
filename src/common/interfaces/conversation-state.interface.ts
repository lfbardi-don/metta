import { UseCaseState } from './use-case.interface';

/**
 * Represents a product mention in the conversation
 * Used to track products shown to customers and prevent LLM ID hallucination
 */
export interface ProductMention {
  /** Nuvemshop product ID (numeric) */
  productId: number;

  /** Product name for fuzzy matching (e.g., "TINI DARK BLUE DESTROYED") */
  productName: string;

  /** When this product was mentioned */
  mentionedAt: Date;

  /** Context of the mention */
  context: 'search' | 'question' | 'interest' | 'recommendation';
}

/**
 * Represents an order mention in the conversation
 * Used to track orders discussed and prevent LLM ID hallucination
 */
export interface OrderMention {
  /** Order ID (Nuvemshop internal ID - large number) */
  orderId: string;

  /** Order number for display (e.g., "1234" - sequential number) */
  orderNumber: string;

  /** Customer email associated with this order */
  customerEmail: string;

  /** When this order was mentioned */
  mentionedAt: Date;

  /** Context of the mention */
  context: 'inquiry' | 'tracking' | 'payment' | 'return';

  /** Last known order status (for quick reference without re-fetching) */
  lastStatus?: string;
}

/**
 * Goal Types - Simplified customer intent categories
 *
 * Reduced from 12 use case types to 7 focused goal types.
 */
export enum GoalType {
  /** Order-related inquiries (status, tracking, payment, returns) */
  ORDER_INQUIRY = 'order_inquiry',

  /** Product discovery and search */
  PRODUCT_SEARCH = 'product_search',

  /** Product-specific questions (size, availability, details) */
  PRODUCT_QUESTION = 'product_question',

  /** Store information (policies, hours, contact) */
  STORE_INFO = 'store_info',

  /** Casual conversation and greetings */
  GREETING = 'greeting',

  /** Other intents */
  OTHER = 'other',
}

/**
 * Exchange State - Tracks the progress of a product exchange flow
 *
 * Based on REGLA 4 from metta_policies.md v2.0:
 * PASO 0: Identificación del cliente y pedido (nombre + número de pedido)
 * PASO 1: Identificar qué producto se quiere cambiar
 * PASO 2: Preguntar por qué talle/color quiere cambiarlo
 * PASO 3: Verificar stock
 * PASO 4: Confirmar producto final del cambio
 * PASO 5: Pedir sucursal de Correo Argentino o dirección
 * PASO 6: Explicar política de cambios
 * PASO 7: Derivar a humano (ÚNICO momento de derivación)
 */
export type ExchangeStep =
  | 'identify_customer'    // PASO 0: Pedir nombre + número de pedido
  | 'validate_order'       // PASO 0: Consultar pedido en Tienda Nube
  | 'select_product'       // PASO 1: Cuál producto quiere cambiar
  | 'get_new_product'      // PASO 2: Por qué talle/color
  | 'check_stock'          // PASO 3: Verificar stock
  | 'confirm_exchange'     // PASO 4: Confirmar producto final
  | 'get_address'          // PASO 5: Sucursal o dirección
  | 'explain_policy'       // PASO 6: Explicar política de envío
  | 'ready_for_handoff';   // PASO 7: Derivar a humano

export interface ExchangeProductInfo {
  name?: string;
  size?: string;
  color?: string;
  sku?: string;
  productId?: number;
  hasStock?: boolean;
}

export interface ExchangeState {
  /** Current step in the exchange flow */
  step: ExchangeStep;

  /** Authentication status (PASO 0) */
  isAuthenticated?: boolean;

  /** Order info from Tienda Nube */
  orderNumber?: string;
  orderId?: string;
  orderDate?: string;
  orderStatus?: string;
  orderItems?: ExchangeProductInfo[];

  /** Product to exchange (PASO 1) */
  originalProduct?: ExchangeProductInfo;

  /** New product desired (PASO 2-4) */
  newProduct?: ExchangeProductInfo;

  /** Alternative products offered (if original choice not in stock) */
  alternativesOffered?: ExchangeProductInfo[];

  /** Shipping info (PASO 5) */
  shippingAddress?: string;
  correoArgentinoBranch?: string;

  /** Policy explained (PASO 6) */
  policyExplained?: boolean;

  /** Validation attempts (máx 2 antes de derivar) */
  validationAttempts?: number;

  /** Timestamps */
  startedAt?: Date;
  lastUpdatedAt?: Date;
}

/**
 * Customer Goal - Simplified journey tracking
 *
 * Replaces complex UseCase with steps. Focuses on WHAT the customer wants,
 * not HOW we're processing it.
 */
export interface CustomerGoal {
  /** Unique identifier */
  goalId: string;

  /** Goal category */
  type: GoalType;

  /** Current status (simplified: only 2 states) */
  status: 'active' | 'completed';

  /** When goal was detected */
  startedAt: Date;

  /** When goal was completed (if applicable) */
  completedAt?: Date;

  /** Last activity timestamp (for timeout detection) */
  lastActivityAt: Date;

  /** Minimal context needed between turns */
  context: {
    /** Order ID for order-related goals */
    orderId?: string;

    /** Product IDs for product-related goals */
    productIds?: number[];

    /** Free-form topic description */
    topic?: string;
  };

  /** Optional progress breadcrumbs for debugging */
  progressMarkers?: string[];

  /** Original message that started this goal */
  detectedFrom?: string;
}

/**
 * Conversation state tracking (UPDATED)
 * Persists product context and customer goals across messages
 *
 * Note: state field is stored as JSONB in PostgreSQL.
 * Prisma automatically serializes/deserializes - just use type assertion when reading.
 */
export interface ConversationState {
  /** Primary key (UUID) */
  id: string;

  /** Conversation ID (unique) */
  conversationId: string;

  /** State object containing products, orders, goals, and context (stored as JSONB) */
  state: {
    /** Products mentioned (prevents hallucination) */
    products: ProductMention[];

    /** Orders mentioned (prevents hallucination) */
    orders: OrderMention[];

    /** Active customer goal (simplified from useCases) */
    activeGoal?: CustomerGoal | null;

    /** Recently completed goals (last 3) */
    recentGoals?: CustomerGoal[];

    /** Active exchange flow state (REGLA 4) */
    exchangeState?: ExchangeState | null;

    /** Last conversation topic for continuity */
    lastTopic?: string;

    /** Last agent that handled the conversation */
    lastAgentType?: string;

    /** Human-readable summary for debugging/escalation */
    summary?: string;

    /** Escalation flag */
    needsHumanHelp?: boolean;

    /** Reason for escalation */
    escalationReason?: string;

    /** DEPRECATED: Use activeGoal instead */
    useCases?: UseCaseState;
  };

  /** Created timestamp */
  createdAt: Date;

  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Helper to find product by name (fuzzy matching with .contains)
 */
export function findProductByName(
  state: ConversationState | null,
  searchName: string,
): ProductMention | null {
  if (!state || !state.state?.products?.length) return null;

  const searchLower = searchName.toLowerCase();
  return (
    state.state.products.find((p) =>
      p.productName.toLowerCase().includes(searchLower),
    ) || null
  );
}

/**
 * Helper to find product by exact ID
 */
export function findProductById(
  state: ConversationState | null,
  productId: number,
): ProductMention | null {
  if (!state || !state.state?.products?.length) return null;

  return state.state.products.find((p) => p.productId === productId) || null;
}

/**
 * Helper to find order by order number (display number)
 */
export function findOrderByNumber(
  state: ConversationState | null,
  orderNumber: string,
): OrderMention | null {
  if (!state || !state.state?.orders?.length) return null;

  // Normalize order number (remove # if present)
  const normalizedNumber = orderNumber.replace(/^#/, '');
  return (
    state.state.orders.find((o) => o.orderNumber === normalizedNumber) || null
  );
}

/**
 * Helper to find order by order ID (Nuvemshop internal ID)
 */
export function findOrderById(
  state: ConversationState | null,
  orderId: string,
): OrderMention | null {
  if (!state || !state.state?.orders?.length) return null;

  return state.state.orders.find((o) => o.orderId === orderId) || null;
}

/**
 * Helper to get the most recent order mentioned
 */
export function getMostRecentOrder(
  state: ConversationState | null,
): OrderMention | null {
  if (!state || !state.state?.orders?.length) return null;

  return state.state.orders.reduce((latest, current) => {
    const latestTime = new Date(latest.mentionedAt).getTime();
    const currentTime = new Date(current.mentionedAt).getTime();
    return currentTime > latestTime ? current : latest;
  });
}
