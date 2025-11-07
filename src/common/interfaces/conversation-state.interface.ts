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
 * Conversation state tracking
 * Persists product context across messages to prevent LLM hallucination
 *
 * Note: state field is stored as JSONB in PostgreSQL.
 * Prisma automatically serializes/deserializes - just use type assertion when reading.
 */
export interface ConversationState {
  /** Primary key (UUID) */
  id: string;

  /** Conversation ID (unique) */
  conversationId: string;

  /** State object containing products, use cases, and future context (stored as JSONB) */
  state: {
    products: ProductMention[];
    useCases?: UseCaseState; // Use case tracking
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
