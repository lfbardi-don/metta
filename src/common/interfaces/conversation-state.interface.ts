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

  /** State object containing products, goals, and context (stored as JSONB) */
  state: {
    /** Products mentioned (prevents hallucination) */
    products: ProductMention[];

    /** Active customer goal (simplified from useCases) */
    activeGoal?: CustomerGoal | null;

    /** Recently completed goals (last 3) */
    recentGoals?: CustomerGoal[];

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
