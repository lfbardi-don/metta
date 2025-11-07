/**
 * Use Case Types - Customer Journey Goals
 *
 * Represents different types of customer goals that can be tracked
 * throughout a conversation.
 */
export enum UseCaseType {
  // Order-related
  CHECK_ORDER_STATUS = 'check_order_status',
  TRACK_SHIPMENT = 'track_shipment',
  REQUEST_RETURN = 'request_return',
  VERIFY_PAYMENT = 'verify_payment',

  // Product-related
  FIND_PRODUCT = 'find_product',
  CHECK_SIZE_AVAILABILITY = 'check_size_availability',
  GET_PRODUCT_DETAILS = 'get_product_details',

  // Information
  LEARN_RETURN_POLICY = 'learn_return_policy',
  GET_STORE_HOURS = 'get_store_hours',
  CONTACT_SUPPORT = 'contact_support',

  // General
  GREETING = 'greeting',
  OTHER = 'other',
}

/**
 * Use Case Status
 *
 * Tracks the current state of a use case in its lifecycle.
 */
export enum UseCaseStatus {
  PENDING = 'pending', // Detected but not started
  IN_PROGRESS = 'in_progress', // Actively being worked on
  COMPLETED = 'completed', // Successfully finished
  BLOCKED = 'blocked', // Waiting for user input (e.g., authentication)
  ABANDONED = 'abandoned', // User moved to different topic
}

/**
 * Use Case Step
 *
 * Represents a single step in a use case workflow.
 */
export interface UseCaseStep {
  stepId: string; // e.g., "authenticate", "fetch_order", "provide_tracking"
  description: string; // Human-readable description
  completed: boolean;
  completedAt?: Date;
  data?: Record<string, any>; // Step-specific data
}

/**
 * Use Case
 *
 * Represents a complete customer journey goal with its steps and context.
 */
export interface UseCase {
  useCaseId: string; // UUID
  type: UseCaseType;
  status: UseCaseStatus;
  startedAt: Date;
  completedAt?: Date;

  // Steps for this use case
  steps: UseCaseStep[];

  // Context data (e.g., order ID, product ID, search query)
  context: Record<string, any>;

  // Metadata
  metadata?: Record<string, any>;
}

/**
 * Use Case State
 *
 * Contains all active and recently completed use cases for a conversation.
 */
export interface UseCaseState {
  activeCases: UseCase[]; // Currently active use cases
  completedCases: UseCase[]; // Recently completed (for reference)
}
