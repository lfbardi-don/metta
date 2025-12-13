import { AgentInputItem } from '@openai/agents';
import {
  ConversationState,
  CustomerAuthState,
  ExchangeState,
} from '../../../common/interfaces';
import { PresentationMode } from '../templates/product-presentation.templates';
import { OrderPresentationMode } from '../templates/order-presentation.templates';

/**
 * Handoff callback type for triggering human handoff from workflow
 */
export type HandoffCallback = (
  conversationId: string,
  reason?: string,
) => Promise<void>;

/**
 * Callback for persisting exchange state
 */
export type ExchangeStateUpdateCallback = (
  conversationId: string,
  state: ExchangeState,
) => Promise<void>;

/**
 * Workflow input configuration
 */
export type WorkflowInput = {
  /** The customer's message text */
  input_as_text: string;
  /** Previous conversation history for context */
  conversationHistory?: AgentInputItem[];
  /** Conversation state with orders/products discussed */
  conversationState?: ConversationState;
  /** Chatwoot conversation ID (required for order tools) */
  conversationId?: string;
  /** Product presentation mode */
  presentationMode?: PresentationMode;
  /** Product presentation instructions */
  presentationInstructions?: string;
  /** Customer authentication state */
  authState?: CustomerAuthState | null;
  /** Order presentation mode */
  orderPresentationMode?: OrderPresentationMode;
  /** Order presentation instructions */
  orderPresentationInstructions?: string;
  /** Active customer goal */
  goal?: any | null;
  /** Callback for human handoff */
  onHandoff?: HandoffCallback;
  /** Callback for exchange state updates */
  onExchangeStateUpdate?: ExchangeStateUpdateCallback;
};

/**
 * Workflow result with optional handoff flag
 *
 * The output type matches AIResponseSchema which is used by all agents.
 * When handoffTriggered is true, it means the conversation was transferred
 * to human support (either via classifier intent or tool call).
 */
export type WorkflowResult = {
  output: {
    user_intent?: string;
    response_text?: string;
    products?: Array<{ id?: number; name: string; confidence: number }>;
    thinking?: string;
  };
  newItems: any[];
  handoffTriggered?: boolean;
  handoffReason?: string;
  /** Updated exchange state (for persistence) */
  exchangeState?: ExchangeState;
  /** Classifier confidence for unknown use case detection */
  classifierConfidence?: number;
};
